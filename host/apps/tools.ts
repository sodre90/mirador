import type { McpServer, ServerContext } from "@modelcontextprotocol/server";
import { normalize } from "node:path";
import * as z from "zod/v4";
import type { BroughtPluginCallResult, BroughtRoomPluginCatalog } from "../../shared/brought-plugins.ts";
import { agentStandIn } from "../../shared/rooms.ts";
import { withProgressHeartbeat } from "../canvas/progress-heartbeat.ts";
import type { ConversationService } from "../conversations.ts";
import { toPosix } from "../paths.ts";
import type { ApproveHostAction } from "../rooms.ts";
import { takenUpWords, type AppDocuments, type TakenUp } from "./documents.ts";
import { AppProblem } from "./plugins.ts";

const toolError = (text: string) => ({ isError: true, content: [{ type: "text" as const, text }] });
const toolText = (text: string) => ({ content: [{ type: "text" as const, text }] });

const appNameSchema = z.string().optional().describe("The app, when more than one is open in this conversation.");

const installedAppsOf = (apps: AppDocuments, onlyNames?: readonly string[]) => (onlyNames ? apps.installedFor(onlyNames) : apps.installed());

const installedNames = (apps: AppDocuments, onlyNames?: readonly string[]) =>
  installedAppsOf(apps, onlyNames)
    .map(({ name, title }) => `${name} (${title})`)
    .join(", ");

/** What an app does, in a line, as the official catalog says it; null for an app the catalog doesn't list. */
export type AppTagline = (app: string) => string | null;

/**
 * The canvas instructions' line on the app tools. Few conversations open an app, so with tool search on, Claude Code
 * leaves the tools out until the agent searches for them, and this line is how the agent knows they are there.
 */
export const appToolsGuidance = (apps: AppDocuments, taglineOf: AppTagline = () => null, onlyNames?: readonly string[]) => {
  const installed = installedAppsOf(apps, onlyNames);
  const opens = `- app_open: open an app the user installed (${installedNames(apps, onlyNames)}) on a file of this workspace, where the user sees it live; then app_state reads its document, apply changes it and app_run runs its tasks.`;
  const described = installed.flatMap(({ name }) => {
    const tagline = taglineOf(name);
    return tagline ? [`  - ${name}: ${tagline}`] : [];
  });
  return [opens, ...described].join("\n");
};

/**
 * The same four tools in every conversation, whichever apps are open there: the tool list never changes, so agents
 * that cache it stay right. Registered only when the owner installed an app plugin (or enabled one for a room).
 */
export function registerAppTools(
  server: McpServer,
  apps: AppDocuments,
  conversations: ConversationService,
  callingConversation: (ctx: ServerContext) => Promise<string>,
  onlyNames?: readonly string[],
  approveHostAction?: ApproveHostAction,
) {
  const names = installedNames(apps, onlyNames);
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
        const asked = toPosix(normalize(file));
        const forFile = opened.file === asked ? "" : `, the document for ${asked}`;
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
        if (approveHostAction) {
          const target = apps.describeTaskForApproval(conversationId, app, task);
          const allowed = await withProgressHeartbeat(ctx, "Waiting for room approval", () =>
            approveHostAction(conversationId, {
              title: `Run ${target.appTitle} task “${target.taskTitle}”`,
              detail: `${target.app}:${task} on ${target.file}`,
              allowanceKey: `app_run:${target.app}:${task}`,
              signal: ctx.mcpReq.signal,
            }),
          );
          if (!allowed) throw new AppProblem("Whoever approves in the room said no.");
        }
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

export function broughtAppCatalogFor(apps: AppDocuments, roomPlugins: readonly string[], taglineOf: AppTagline = () => null): BroughtRoomPluginCatalog {
  const enabled = apps.installedFor(roomPlugins);
  if (enabled.length === 0) return { tools: [], instructions: [] };
  const names = installedNames(apps, roomPlugins);
  return {
    tools: [
      {
        name: "app_open",
        description: `Open an app enabled in this room on a file of the room's workspace; everyone in the room sees it live on the canvas. Installed apps: ${names}.`,
        inputSchema: {
          type: "object",
          properties: {
            app: { type: "string", description: "The app's name, e.g. one of those enabled in this room." },
            file: { type: "string", minLength: 1, description: "The document's path, or the path of a file the app edits, relative to the workspace." },
          },
          required: ["app", "file"],
        },
      },
      {
        name: "apply",
        description: "Change the document of the app open in this room with one operation. app_state says which operations the app takes.",
        inputSchema: {
          type: "object",
          properties: {
            op: { type: "object", description: 'The operation, as the app defines it, e.g. { "op": "add", "by": 2 }.' },
            app: { type: "string", description: "The app, when more than one is open in this room." },
          },
          required: ["op"],
        },
      },
      {
        name: "app_run",
        description: "Run one of the tasks of the app open in this room, such as a render, and wait until it ends. app_state lists the app's tasks.",
        inputSchema: {
          type: "object",
          properties: {
            task: { type: "string", description: "The task's name, as app_state lists it." },
            app: { type: "string", description: "The app, when more than one is open in this room." },
          },
          required: ["task"],
        },
      },
      {
        name: "app_state",
        description: "The document of the app open in this room, in words, with its latest changes.",
        inputSchema: {
          type: "object",
          properties: {
            app: { type: "string", description: "The app, when more than one is open in this room." },
          },
        },
      },
    ],
    instructions: [appToolsGuidance(apps, taglineOf, roomPlugins)],
  };
}

/** Runs one of the four app tools on behalf of a brought agent in a room (after any approver gate). */
export async function runBroughtAppTool(
  apps: AppDocuments,
  roomId: string,
  agentId: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<BroughtPluginCallResult> {
  const standIn = agentStandIn(roomId, agentId);
  try {
    if (toolName === "app_open") {
      if (typeof args.app !== "string" || typeof args.file !== "string" || !args.file) throw new AppProblem("Give app and file.");
      const opened = await apps.open(standIn, args.app, args.file);
      const asked = toPosix(normalize(args.file));
      const forFile = opened.file === asked ? "" : `, the document for ${asked}`;
      return { done: true, text: `${opened.title} is open on ${opened.file}${forFile}; everyone in the room sees it on the canvas.\n\n${apps.describe(standIn, opened.app)}` };
    }
    if (toolName === "apply") {
      if (typeof args.op !== "object" || args.op === null || Array.isArray(args.op)) throw new AppProblem("Give an operation object in op.");
      const app = typeof args.app === "string" ? args.app : undefined;
      const change = await apps.apply(standIn, app, args.op, { kind: "agent", conversationId: standIn, turnSeq: 0 });
      return { done: true, text: `${takenUpWords(change.takenUp)}${change.file}: ${change.summary}` };
    }
    if (toolName === "app_run") {
      if (typeof args.task !== "string" || !args.task) throw new AppProblem("Give the task name.");
      const app = typeof args.app === "string" ? args.app : undefined;
      const { ended, takenUp } = apps.startTask(standIn, app, args.task, { kind: "agent", conversationId: standIn, turnSeq: 0 });
      return { done: true, text: `${takenUpWords(takenUp)}${await ended}` };
    }
    if (toolName === "app_state") {
      const app = typeof args.app === "string" ? args.app : undefined;
      return { done: true, text: apps.describe(standIn, app) };
    }
    return { done: false, text: `Unknown app tool: ${toolName}.` };
  } catch (error) {
    if (error instanceof AppProblem) return { done: false, text: error.message };
    throw error;
  }
}

export type { TakenUp };
