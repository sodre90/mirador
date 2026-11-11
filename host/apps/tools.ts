import type { McpServer, ServerContext } from "@modelcontextprotocol/server";
import { normalize } from "node:path";
import * as z from "zod/v4";
import type { ConversationService } from "../conversations.ts";
import { takenUpWords, type AppDocuments, type TakenUp } from "./documents.ts";
import { AppProblem } from "./plugins.ts";

const toolError = (text: string) => ({ isError: true, content: [{ type: "text" as const, text }] });
const toolText = (text: string) => ({ content: [{ type: "text" as const, text }] });

const appNameSchema = z.string().optional().describe("The app, when more than one is open in this conversation.");

const installedNames = (apps: AppDocuments) => apps.installed().map(({ name, title }) => `${name} (${title})`).join(", ");

/**
 * The canvas instructions' line on the app tools. Few conversations open an app, so with tool search on, Claude Code
 * leaves the tools out until the agent searches for them, and this line is how the agent knows they are there.
 */
export const appToolsGuidance = (apps: AppDocuments) =>
  `- app_open: open an app the user installed (${installedNames(apps)}) on a file of this workspace, where the user sees it live; then app_state reads its document, apply changes it and app_run runs its tasks.`;

/**
 * The same four tools in every conversation, whichever apps are open there: the tool list never changes, so agents
 * that cache it stay right. Registered only when the owner installed an app plugin.
 */
export function registerAppTools(
  server: McpServer,
  apps: AppDocuments,
  conversations: ConversationService,
  callingConversation: (ctx: ServerContext) => Promise<string>,
) {
  const names = installedNames(apps);
  const answered = async (ctx: ServerContext, answer: (conversationId: string) => Promise<string> | string) => {
    try {
      return toolText(await answer(await callingConversation(ctx)));
    } catch (error) {
      if (error instanceof AppProblem) return toolError(error.message);
      throw error;
    }
  };

  server.registerTool(
    "app_open",
    {
      description: `Open an app the user installed in Mirador on a file of this workspace, for this conversation; the user sees it live in a tab of their canvas here. Another conversation of the same folder has its own app open, and what you do here doesn't move it. Two conversations that open the same file work on the same document, whose changes reach both. A file that doesn't exist yet is started. An app may also open on a file it edits, such as a video for a video editor, with its document beside it. Installed apps: ${names}. Then read the document with app_state and change it with apply.`,
      inputSchema: z.object({
        app: z.string().describe("The app's name, e.g. one of those installed."),
        file: z.string().min(1).describe("The document's path, or the path of a file the app edits, relative to the workspace."),
      }),
    },
    ({ app, file }, ctx) =>
      answered(ctx, async (conversationId) => {
        const opened = await apps.open(conversationId, app, file);
        const forFile = opened.file === normalize(file) ? "" : `, the document for ${normalize(file)}`;
        return `${opened.title} is open on ${opened.file}${forFile}; the user sees it in the canvas.\n\n${apps.describe(conversationId, opened.app)}`;
      }),
  );

  server.registerTool(
    "apply",
    {
      description:
        "Change the document of the app open in this conversation with one operation. The app checks it and applies it in turn with the user's own changes, and the result says what changed or what was wrong. Never edit the app's file to change it: an operation is recorded as yours and can be undone. app_state says which operations the app takes.",
      inputSchema: z.object({
        op: z.record(z.string(), z.unknown()).describe('The operation, as the app defines it, e.g. { "op": "add", "by": 2 }.'),
        app: appNameSchema,
      }),
    },
    ({ op, app }, ctx) =>
      answered(ctx, async (conversationId) => {
        const change = await apps.apply(conversationId, app, op, { kind: "agent", conversationId, turnSeq: conversations.latestTurnSeq(conversationId) });
        return `${takenUpWords(change.takenUp)}${change.file}: ${change.summary}`;
      }),
  );

  server.registerTool(
    "app_run",
    {
      description:
        "Run one of the tasks of the app open in this conversation, such as a render, and wait until it ends; the app's tab comes forward, where the user sees its progress and can stop it. app_state lists the app's tasks. Run one when your operations are done and the user should see their result.",
      inputSchema: z.object({
        task: z.string().describe("The task's name, as app_state lists it."),
        app: appNameSchema,
      }),
    },
    ({ task, app }, ctx) =>
      answered(ctx, async (conversationId) => {
        const { ended, takenUp } = apps.startTask(conversationId, app, task, { kind: "agent", conversationId, turnSeq: conversations.latestTurnSeq(conversationId) });
        return `${takenUpWords(takenUp)}${await ended}`;
      }),
  );

  server.registerTool(
    "app_state",
    {
      description: "The document of the app open in this conversation, in words, with its latest changes, the user's included. Read it before changing the document, and again when an operation names something that isn't there.",
      inputSchema: z.object({ app: appNameSchema }),
    },
    ({ app }, ctx) => answered(ctx, (conversationId) => apps.describe(conversationId, app)),
  );
}

export type { TakenUp };
