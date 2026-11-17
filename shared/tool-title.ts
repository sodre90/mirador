import type { ToolCallUpdate } from "@agentclientprotocol/sdk/unstable";

/**
 * codex-acp sends an MCP tool's call as a command titled `mcp.<server>.<tool>`; it goes by the name Claude Code gives
 * such calls, `mcp__<server>__<tool>`.
 */
export function codexMcpToolName(update: { _meta?: { [key: string]: unknown } | null; rawInput?: unknown }) {
  if (update._meta?.is_mcp_tool_call !== true) return null;
  const { server, tool } = (update.rawInput ?? {}) as { server?: unknown; tool?: unknown };
  return typeof server === "string" && typeof tool === "string" ? `mcp__${server}__${tool}` : null;
}

/**
 * Antigravity names an MCP tool `mcp_<server>_<tool>` and titles its call "Run mcp_<server>_<tool>"; it goes by Claude
 * Code's name, `mcp__<server>__<tool>`. The server's name ends at the first underscore, as the canvas server's does.
 */
export function antigravityMcpToolName(update: { name?: unknown; title?: string | null }) {
  const { name, title } = update;
  if (typeof name !== "string" || title !== `Run ${name}`) return null;
  const [, server, tool] = /^mcp_([^_]+)_(.+)$/.exec(name) ?? [];
  return server && tool ? `mcp__${server}__${tool}` : null;
}

/** An MCP tool's call by Claude Code's name for it, from the agents that name or title such calls otherwise. */
export const mcpToolNameOf = (update: { _meta?: { [key: string]: unknown } | null; rawInput?: unknown; name?: unknown; title?: string | null }) =>
  codexMcpToolName(update) ?? antigravityMcpToolName(update);

/** The one canvas tool through which agents run the plugin tools that are not in their tool list. */
export const USE_TOOL_TOOL = "use_tool";

/** A canvas tool's own name, as each agent prefixes it: `mcp__canvas__ask` in Claude Code, `canvas_ask` in opencode, `mcp_canvas_ask` in Antigravity. */
export const canvasToolName = (tool: string) => /^(?:mcp__canvas__|mcp_canvas_|canvas__|canvas_)(.+)$/.exec(tool)?.[1] ?? null;

/** A use_tool call's payload: codex-acp puts an MCP call's arguments under `arguments`, beside the server and tool it names. */
export const useToolPayloadOf = (rawInput: unknown): { tool?: unknown; input?: unknown } => {
  const given = (rawInput ?? {}) as { server?: unknown; tool?: unknown; arguments?: unknown };
  const payload =
    given.server === "canvas" && given.tool === USE_TOOL_TOOL && typeof given.arguments === "object" && given.arguments !== null ? given.arguments : given;
  return payload as { tool?: unknown; input?: unknown };
};

/** The tool a use_tool call names in its input, when it has one yet. */
const toolNamedIn = (rawInput: unknown): string | null => {
  const { tool } = useToolPayloadOf(rawInput);
  return typeof tool === "string" && tool !== "" ? tool : null;
};

/**
 * An MCP tool's call as "server · tool", or for a plugin's tool on the canvas server, "plugin's title · tool". A use_tool
 * call reads as the tool it ran, named in its raw input, whichever prefix the agent gives it.
 */
export function readableToolTitle(title: string, pluginToolTitles: Record<string, string>, rawInput?: unknown) {
  const wrapped = canvasToolName(title) === USE_TOOL_TOOL ? toolNamedIn(rawInput) : null;
  const mcpTool = title.match(/^mcp__(.+?)__(.+)$/);
  if (!mcpTool) return wrapped === null ? title : `${pluginToolTitles[wrapped] ?? "canvas"} · ${wrapped}`;
  const [, server = "", tool = ""] = mcpTool;
  const shown = wrapped ?? tool;
  const plugin = server === "canvas" ? pluginToolTitles[shown] : undefined;
  return `${plugin ?? server} · ${shown}`;
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
