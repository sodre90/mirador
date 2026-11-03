import type { ToolCallUpdate } from "@agentclientprotocol/sdk";

/**
 * codex-acp sends an MCP tool's call as a command titled `mcp.<server>.<tool>`; it goes by the name Claude Code gives
 * such calls, `mcp__<server>__<tool>`.
 */
export function codexMcpToolName(update: { _meta?: { [key: string]: unknown } | null; rawInput?: unknown }) {
  if (update._meta?.is_mcp_tool_call !== true) return null;
  const { server, tool } = (update.rawInput ?? {}) as { server?: unknown; tool?: unknown };
  return typeof server === "string" && typeof tool === "string" ? `mcp__${server}__${tool}` : null;
}

/** An MCP tool's call as "server · tool", or for a plugin's tool on the canvas server, "plugin's title · tool". */
export function readableToolTitle(title: string, pluginToolTitles: Record<string, string>) {
  const mcpTool = title.match(/^mcp__(.+?)__(.+)$/);
  if (!mcpTool) return title;
  const [, server = "", tool = ""] = mcpTool;
  const plugin = server === "canvas" ? pluginToolTitles[tool] : undefined;
  return `${plugin ?? server} · ${tool}`;
}

/** The tool an update is of, by the name its agent gives it. */
export const toolNameOf = (update: ToolCallUpdate & { name?: unknown }) => {
  const claudeName = ((update._meta?.claudeCode ?? {}) as { toolName?: unknown }).toolName;
  if (typeof claudeName === "string") return claudeName;
  const codexMcp = codexMcpToolName(update);
  if (codexMcp) return codexMcp;
  if (typeof update.name === "string" && update.name) return update.name;
  return update.title || update.kind || "unknown";
};
