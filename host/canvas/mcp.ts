import { createMcpHandler, McpServer, type McpHttpHandler, type ServerContext } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { ConversationService } from "../conversations.ts";
import { CANVAS_SERVER_NAME } from "../acp/harnesses.ts";
import { BACKGROUNDED_COMMAND_NEEDS_NO_WAIT, JobWaitRefused, jobWaitToolDescription } from "../job-waits.ts";
import { canvasInstructions, canvasUseGuidance, namesItsOwnConversation, NO_CANVAS_PLUGINS, titleGuidance, type CanvasPluginGuidance } from "./guidance.ts";
import { TITLE_CONVERSATION_TOOL } from "./tool-names.ts";
import type { CanvasPlugins } from "./plugins.ts";
import { readJobWaitRequest, waitSetUpReply } from "../../shared/job-waits.ts";
import { answerAsToolResult, type CanvasService, type RenderOutcome } from "./service.ts";
import { ANTIGRAVITY_ASK_WAIT_MS } from "../config.ts";
import { MIRADOR_VERSION } from "../../shared/version.ts";
import type { CanvasUse, HarnessId } from "../../shared/model.ts";
import type { AppDocuments } from "../apps/documents.ts";
import { appToolsGuidance, registerAppTools } from "../apps/tools.ts";
import type { PluginCatalog } from "../plugin-catalog.ts";
import { registerPluginInstallTool } from "./plugin-install-tool.ts";
import type { Store } from "../store.ts";
import { registerUsageStatsTool } from "./usage-stats-tool.ts";
import { registerPlanUsageTool } from "./plan-usage-tool.ts";
import { registerLandTool } from "./land-tool.ts";

const PROGRESS_HEARTBEAT_MS = 15_000;

const optionShape = {
  label: z.string().min(1),
  description: z.string().optional(),
  html: z.string().optional(),
  recommended: z.boolean().optional(),
};

const askQuestionShape = {
  html: z.string().optional(),
  allowOther: z.boolean().optional(),
  optionWidth: z.number().int().positive().optional(),
};

/** Ask's fields are described once, where the single question takes them, so the agent doesn't read each text twice. */
const describedFields = <Shape extends Record<string, z.ZodType>>(shape: Shape, descriptions: Record<keyof Shape, string>): Shape =>
  Object.fromEntries(Object.entries(shape).map(([field, schema]) => [field, schema.describe(descriptions[field as keyof Shape])])) as Shape;

const describedOptionSchema = z.object(
  describedFields(optionShape, {
    label: "Short name of the option; returned verbatim when chosen.",
    description: "One or two sentences on the trade-off.",
    html: "Optional HTML preview of this option (mockup, diagram drawn in HTML and CSS, inline SVG or Mermaid rather than ASCII art, code sample).",
    recommended: "True on the one option you recommend, rather than a mark in its label. The user sees it marked, and in a spoken conversation it is read first.",
  }),
);

const describedAskQuestionShape = describedFields(askQuestionShape, {
  html: "Optional HTML shown above the options: the explanation or mockup the question is about, with any diagram drawn in HTML and CSS, inline SVG or Mermaid, not ASCII art. Put it here rather than in a show call just before.",
  allowOther: "Let the user type an answer that is not one of the options.",
  optionWidth:
    "Optional least width of each answer box in CSS pixels, for options whose descriptions need more room. Boxes still sit side by side while they fit and never get wider than the canvas. Without it they are at least 200px, or as wide as the widest preview.",
});

function describeRender(itemId: string, render: RenderOutcome) {
  if (render === "no-viewer") {
    return `Saved to the canvas as item ${itemId}. Nobody is viewing this conversation right now, so rendering was not verified; if the page reports errors when the user opens it, you will hear of them with their next message.`;
  }
  if (render.errors.length === 0) return `Shown to the user as canvas item ${itemId}; it rendered without script errors.`;
  return `Shown to the user as canvas item ${itemId}, but the page reported errors:\n${render.errors.map((error) => `- ${error}`).join("\n")}`;
}

/**
 * With tool search on, Claude Code hides MCP tools until the agent searches for them, and an agent
 * that doesn't know the canvas exists rarely does. This marks the canvas tools as always loaded.
 */
const loadedUpFront = { "anthropic/alwaysLoad": true };

/**
 * Codex's auto review spends a model call on each tool call that may change the user's machine, before running it. The
 * canvas tools only show things in Mirador, so Codex conversations hear so and skip that review.
 */
const SHOWS_ONLY_IN_MIRADOR = { annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } };

const reviewFreeFor = (harness: HarnessId | undefined) => (harness === "codex" ? SHOWS_ONLY_IN_MIRADOR : {});

const ANSWER_STILL_TO_COME =
  "The user hasn't answered yet. The question stays open in their browser, and their answer will arrive as their next message. End your turn now without assuming an answer.";

const toolError = (text: string) => ({ isError: true, content: [{ type: "text" as const, text }] });

/** opencode 2 names the session that calls a tool, its subagents' included. */
const OPENCODE_SESSION_META = "ai.opencode/sessionID";

const hasApps = (apps: AppDocuments | null): apps is AppDocuments => apps !== null && apps.installed().length > 0;

const withAppTools = (guidance: CanvasPluginGuidance, apps: AppDocuments | null): CanvasPluginGuidance =>
  hasApps(apps) ? { ...guidance, instructions: [...guidance.instructions, appToolsGuidance(apps)] } : guidance;

/**
 * Copilot has no system prompt Mirador can append to, so the canvas use guidance Claude Code, pi and Codex get there
 * comes in the canvas server's instructions.
 */
export function canvasServerInstructions(harness: HarnessId | undefined, canvasUse: CanvasUse, assetsOrigin: string, plugins: CanvasPluginGuidance) {
  const parts = [canvasInstructions(assetsOrigin, plugins)];
  if (harness === "copilot" && canvasUse === "often") parts.push(canvasUseGuidance(plugins));
  if (!namesItsOwnConversation(harness)) parts.push(titleGuidance());
  return parts.join("\n\n");
}

function buildCanvasServer(
  conversationId: string,
  canvas: CanvasService,
  conversations: ConversationService,
  assetsOrigin: string,
  apps: AppDocuments | null,
  canvasPlugins: CanvasPlugins | null,
  catalog: PluginCatalog | null,
  store: Store | null,
  antigravityAskWaitMs: number,
) {
  const harness = store?.findConversation(conversationId)?.harness;
  const askWaitLimitMs = harness === "antigravity" ? antigravityAskWaitMs : null;
  const reviewFree = reviewFreeFor(harness);
  const server = new McpServer(
    { name: CANVAS_SERVER_NAME, version: MIRADOR_VERSION },
    {
      instructions: canvasServerInstructions(
        harness,
        store?.canvasUse() ?? "often",
        assetsOrigin,
        withAppTools(canvasPlugins?.guidanceFor(conversationId) ?? NO_CANVAS_PLUGINS, apps),
      ),
    },
  );

  /**
   * The conversations on one opencode agent process each add their canvas server under the same name, and opencode keeps
   * only the last one added: every call reaches that conversation's address, whichever conversation made it.
   */
  const callingConversation = async ({ mcpReq }: ServerContext) => {
    const sessionId = mcpReq._meta?.[OPENCODE_SESSION_META];
    return (typeof sessionId === "string" && (await conversations.conversationOfSession(sessionId))) || conversationId;
  };

  server.registerTool(
    "show",
    {
      description:
        "Render an HTML page in the user's browser canvas (diagrams, mockups, comparisons, charts, 3D). Prefer this over ASCII art or long text explanations, and draw diagrams on the page with HTML and CSS, inline SVG or Mermaid, never as ASCII art in a <pre>. The page runs sandboxed without network access; three.js, D3 and Mermaid are available (see the server instructions).",
      inputSchema: z.object({
        title: z.string().min(1).describe("Short title shown above the page."),
        html: z.string().min(1).describe("A complete HTML document or an HTML fragment with inline CSS/JS."),
      }),
      _meta: loadedUpFront,
      ...reviewFree,
    },
    async ({ title, html }, ctx) => {
      const { item, render } = await canvas.show(await callingConversation(ctx), { title, html });
      return { content: [{ type: "text", text: describeRender(item.id, render) }] };
    },
  );

  server.registerTool(
    "ask",
    {
      description:
        "Ask the user to choose between options in their browser, optionally with an HTML preview per option and a shared HTML context page. Use this instead of asking multiple-choice questions in plain text. Depending on the user's setting, the choice is returned as this tool's result or arrives as the user's next message (the result tells you which). When you have two or more things to ask, pass questions instead of question and options, one entry per question with its own options: the user answers them page by page, and all their answers come back together. Never fold several questions into one question, and never offer options such as \"Accept all\" or \"Change some answers\" that stand for several answers: the user then has no way to say which.",
      inputSchema: z.object({
        ...describedAskQuestionShape,
        question: z.string().min(1).optional().describe("The question, when you ask just one."),
        options: z.array(describedOptionSchema).min(2).max(8).optional().describe("The choices to the question, when you ask just one."),
        questions: z
          .array(z.object({ ...askQuestionShape, question: z.string().min(1), options: z.array(z.object(optionShape)).min(2).max(8) }))
          .min(2)
          .max(10)
          .optional()
          .describe(
            "Two or more questions in the order to ask them, each with its own options; give these instead of question and options whenever you have more than one thing to ask. Their fields mean what the single question's do.",
          ),
      }),
      _meta: loadedUpFront,
      ...reviewFree,
    },
    async ({ questions, question, options, ...rest }, ctx) => {
      if (questions && (question || options)) return toolError("Give either question and options, or questions, not both.");
      if (!questions && (!question || !options)) return toolError("Give question and options, or questions.");
      if (questions && Object.values(rest).some((value) => value !== undefined))
        return toolError("With questions, give html, allowOther and optionWidth on each question, not next to questions.");
      if ((questions ?? [{ options: options! }]).some((asked) => asked.options.filter((option) => option.recommended).length > 1))
        return toolError("Recommend at most one option of each question.");
      const caller = await callingConversation(ctx);
      const item = canvas.openAsk(caller, questions ? { questions } : { question: question!, options: options!, ...rest });
      if (conversations.get(caller).askMode === "next-message") {
        return {
          content: [
            {
              type: "text",
              text: "The question is now showing in the user's browser. Their answer will arrive as their next message. End your turn now without assuming an answer.",
            },
          ],
        };
      }
      const progressToken = ctx.mcpReq._meta?.progressToken;
      let beats = 0;
      const heartbeat =
        progressToken === undefined
          ? undefined
          : setInterval(() => {
              beats += 1;
              ctx.mcpReq
                .notify({
                  method: "notifications/progress",
                  params: { progressToken, progress: beats, message: "Waiting for the user's choice" },
                })
                .catch(() => {});
            }, PROGRESS_HEARTBEAT_MS);
      try {
        const answer = askWaitLimitMs === null ? await canvas.waitForAnswer(item, ctx.mcpReq.signal) : await canvas.waitForAnswerWithin(item, ctx.mcpReq.signal, askWaitLimitMs);
        return { content: [{ type: "text", text: answer ? answerAsToolResult(answer) : ANSWER_STILL_TO_COME }] };
      } finally {
        clearInterval(heartbeat);
      }
    },
  );

  server.registerTool(
    "when_done",
    {
      description: jobWaitToolDescription(),
      inputSchema: z.object({
        pid: z.number().optional().describe(`The process to wait for, by the pid \`$!\` gave right after you started it. ${BACKGROUNDED_COMMAND_NEEDS_NO_WAIT}`),
        container: z.string().optional().describe("Or the Docker or Podman container to wait for, by its name or id."),
        host: z.string().optional().describe("For a job on another machine: user@host, or a name from your ssh config. Mirador checks on it over ssh."),
        message: z.string().optional().describe("Your instruction for picking up the work once the job ends. Without one, the message says the job ended."),
        resume: z
          .boolean()
          .optional()
          .describe("false when the user should decide what happens next: Mirador then only tells them, and you get nothing. True by default."),
      }),
      _meta: loadedUpFront,
      ...reviewFree,
    },
    async ({ pid, container, host, message, resume }, ctx) => {
      if ((pid === undefined) === (container === undefined)) return toolError("Name the job: either its pid or its container.");
      const job = pid === undefined ? { kind: "container", name: container } : { kind: "process", pid };
      const request = readJobWaitRequest({ job, sshHost: host ?? null, message: message ?? null, resume: resume ?? true });
      if (typeof request === "string") return toolError(request);
      try {
        return { content: [{ type: "text", text: waitSetUpReply(await conversations.waitForJob(await callingConversation(ctx), request)) }] };
      } catch (error) {
        if (error instanceof JobWaitRefused) return toolError(error.message);
        throw error;
      }
    },
  );

  server.registerTool(
    TITLE_CONVERSATION_TOOL,
    {
      description:
        "Name this conversation in Mirador's sidebar, which otherwise shows the first line of the user's message. Call it once, when the first turn's work is done, with a few words saying what the conversation is about. A name the user gives the conversation always stays.",
      inputSchema: z.object({
        title: z.string().min(1).describe("A few words saying what this conversation is about, in the language the user writes in."),
      }),
      _meta: loadedUpFront,
      ...reviewFree,
    },
    async ({ title }, ctx) => {
      const named = conversations.retitleFromAgent(await callingConversation(ctx), title);
      const text = named === null ? "The user has named this conversation; their name stays." : `This conversation is now titled “${named}”.`;
      return { content: [{ type: "text", text }] };
    },
  );

  if (hasApps(apps)) registerAppTools(server, apps, conversations, callingConversation);
  canvasPlugins?.registerTools(server, conversationId, callingConversation, reviewFree);
  if (catalog && catalog.notInstalled().length > 0) registerPluginInstallTool(server, catalog, canvas, callingConversation);
  if (store) registerUsageStatsTool(server, store, callingConversation, () => canvasPlugins?.toolTitles() ?? {}, reviewFree);
  if (store) registerPlanUsageTool(server, store, conversations, callingConversation, reviewFree);
  if (store?.findConversation(conversationId)?.worktree) registerLandTool(server, conversations, callingConversation, loadedUpFront);

  return server;
}

export class CanvasMcpEndpoints {
  private readonly handlers = new Map<string, McpHttpHandler>();

  constructor(
    private readonly canvas: CanvasService,
    private readonly conversations: ConversationService,
    private readonly assetsOrigin: string,
    private readonly apps: AppDocuments | null = null,
    private readonly canvasPlugins: CanvasPlugins | null = null,
    private readonly catalog: PluginCatalog | null = null,
    private readonly store: Store | null = null,
    private readonly antigravityAskWaitMs = ANTIGRAVITY_ASK_WAIT_MS,
  ) {}

  handle(conversationId: string, request: Request) {
    return this.handlerFor(conversationId).fetch(request);
  }

  forget(conversationId: string) {
    this.handlers.delete(conversationId);
  }

  /** The profile's conversations list their tools again, once a save turned one of its plugins on or off; Claude Code does at once. */
  toolsChangedForProfile(profileId: string) {
    for (const [conversationId, handler] of this.handlers) {
      if (this.store?.findConversation(conversationId)?.profileId === profileId) handler.notify.toolsChanged();
    }
  }

  private handlerFor(conversationId: string) {
    let handler = this.handlers.get(conversationId);
    if (!handler) {
      handler = createMcpHandler(() =>
        buildCanvasServer(conversationId, this.canvas, this.conversations, this.assetsOrigin, this.apps, this.canvasPlugins, this.catalog, this.store, this.antigravityAskWaitMs),
      );
      this.handlers.set(conversationId, handler);
    }
    return handler;
  }
}
