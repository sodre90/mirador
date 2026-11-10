export const USAGE_STATS_TOOL = "usage_stats";
export const TITLE_CONVERSATION_TOOL = "title_conversation";

/** None of them changes files or runs commands for the agent, so none is worth a permission prompt. */
export const PRE_ALLOWED_CANVAS_TOOLS = ["show", "ask", "when_done", USAGE_STATS_TOOL, TITLE_CONVERSATION_TOOL];

export const APP_TOOLS = ["app_open", "apply", "app_state", "app_run"];

/** The canvas server's own tools, whose names a plugin's tools can't take. */
export const BUILT_IN_CANVAS_TOOLS = [...PRE_ALLOWED_CANVAS_TOOLS, ...APP_TOOLS];

/** A canvas tool's own name, as each agent prefixes it: `mcp__canvas__ask` in Claude Code, `canvas_ask` in opencode, `mcp_canvas_ask` in Antigravity. */
export const canvasToolName = (tool: string) => /^(?:mcp__canvas__|mcp_canvas_|canvas__|canvas_)(.+)$/.exec(tool)?.[1] ?? null;
