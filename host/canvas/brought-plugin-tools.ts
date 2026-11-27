import { fromJsonSchema, type McpServer, type ServerContext } from "@modelcontextprotocol/server";
import type { BroughtPluginCallResult, BroughtRoomPluginCatalog } from "../../shared/brought-plugins.ts";
import { ROOM_EDIT_TOOL, ROOM_READ_TOOL, ROOM_RUN_TOOL } from "../../shared/room-workspace.ts";
import { withProgressHeartbeat } from "./progress-heartbeat.ts";

/** What the proxied room plugin tools need of the agents you brought. */
export interface BroughtRoomPlugins {
  pluginCatalogFor(conversationId: string): BroughtRoomPluginCatalog | null;
  callRoomPlugin(conversationId: string, tool: string, args: Record<string, unknown>, signal: AbortSignal): Promise<BroughtPluginCallResult>;
}

/** Built-in tools a remote room host may never shadow on the bringer's canvas MCP server. */
const RESERVED_LOCAL_TOOLS = new Set(["show", "ask", ROOM_READ_TOOL, ROOM_EDIT_TOOL, ROOM_RUN_TOOL]);

/** Registers the room host's enabled canvas and app plugin tools on a brought agent's local canvas MCP server. */
export function registerBroughtPluginTools(
  server: McpServer,
  broughtPlugins: BroughtRoomPlugins,
  conversationId: string,
  callingConversation: (ctx: ServerContext) => Promise<string>,
  extras: { _meta: Record<string, unknown> },
) {
  const catalog = broughtPlugins.pluginCatalogFor(conversationId);
  if (!catalog || catalog.tools.length === 0) return;
  for (const tool of catalog.tools) {
    if (RESERVED_LOCAL_TOOLS.has(tool.name)) continue;
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: fromJsonSchema(tool.inputSchema),
        ...extras,
      },
      async (args, ctx) => {
        const caller = await callingConversation(ctx);
        const input = typeof args === "object" && args !== null && !Array.isArray(args) ? (args as Record<string, unknown>) : {};
        const { done, text } = await withProgressHeartbeat(ctx, "Waiting for the room's plugin", () =>
          broughtPlugins.callRoomPlugin(caller, tool.name, input, ctx.mcpReq.signal),
        );
        return { isError: !done, content: [{ type: "text" as const, text }] };
      },
    );
  }
}
