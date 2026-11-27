import type { McpServer, ServerContext } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { ROOM_EDIT_TOOL, ROOM_READ_TOOL, ROOM_RUN_TOOL, workspaceCallIn, type WorkspaceCall } from "../../shared/room-workspace.ts";
import type { BroughtAgents } from "../brought-agents.ts";
import { withProgressHeartbeat } from "./progress-heartbeat.ts";

/** What the room workspace tools need of the agents you brought. */
export type RoomsWorkspaces = Pick<BroughtAgents, "callInWorkspace">;

const TOO_LARGE = "That is more than one call takes: shorten the path or the command, or make the change in parts.";

const toolReply = (done: boolean, text: string) => ({ isError: !done, content: [{ type: "text" as const, text }] });

const path = z.string().min(1).describe("A path in the room's workspace, from its top folder, such as src/main.ts; . is the top folder itself.");

/** Only for the agent you brought to work in a room's workspace, which has no other tools for files or commands. */
export function registerRoomWorkspaceTools(
  server: McpServer,
  workspaces: RoomsWorkspaces,
  callingConversation: (ctx: ServerContext) => Promise<string>,
  extras: { _meta: Record<string, unknown> },
) {
  const askTheRoomsMachine = async (asked: WorkspaceCall, ctx: ServerContext) => {
    const call = workspaceCallIn(asked);
    if (!call) return toolReply(false, TOO_LARGE);
    const conversationId = await callingConversation(ctx);
    const { done, text } = await withProgressHeartbeat(ctx, "Waiting for the room's machine", () => workspaces.callInWorkspace(conversationId, call, ctx.mcpReq.signal));
    return toolReply(done, text);
  };

  server.registerTool(
    ROOM_READ_TOOL,
    {
      description: "Read a text file of the room's workspace, on the room's machine, from a line on; or, for a folder, the names in it.",
      inputSchema: z.object({
        path,
        from_line: z.number().int().min(1).optional().describe("The line to start at, 1 when left out. A long file comes in parts; go on from where one ends."),
      }),
      ...extras,
    },
    ({ path, from_line }, ctx) => askTheRoomsMachine({ kind: "read", path, fromLine: from_line ?? 1 }, ctx),
  );

  server.registerTool(
    ROOM_EDIT_TOOL,
    {
      description:
        "Change a text file of the room's workspace, on the room's machine: give old and new to replace a text that is in the file exactly once, or content to write the whole file, a new one too. Someone who approves in the room reads each change and allows or denies it before it is made, so make each worth reading.",
      inputSchema: z.object({
        path,
        old: z.string().optional().describe("The text to replace, exactly as the file has it."),
        new: z.string().optional().describe("What to put in its place."),
        content: z.string().optional().describe("The whole text of the file, instead of old and new."),
      }),
      ...extras,
    },
    async ({ path, old, new: replacement, content }, ctx) => {
      const replaces = old !== undefined && replacement !== undefined && content === undefined;
      const writes = content !== undefined && old === undefined && replacement === undefined;
      if (!replaces && !writes) return toolReply(false, "Give old and new, or content alone.");
      return askTheRoomsMachine(writes ? { kind: "write", path, content } : { kind: "edit", path, old: old!, new: replacement! }, ctx);
    },
  );

  server.registerTool(
    ROOM_RUN_TOOL,
    {
      description:
        "Run a command in the top folder of the room's workspace, on the room's machine, with its shell, without input and for ten minutes at most; what it leaves running is stopped. Someone who approves in the room reads each command and allows or denies it before it runs.",
      inputSchema: z.object({ command: z.string().min(1).describe("The command, as one would type it in a shell.") }),
      ...extras,
    },
    ({ command }, ctx) => askTheRoomsMachine({ kind: "run", command }, ctx),
  );
}
