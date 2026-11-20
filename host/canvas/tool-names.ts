export { canvasToolName, USE_TOOL_TOOL } from "../../shared/tool-title.ts";
import { ROOM_HISTORY_TOOL, ROOM_TAG_TOOL } from "../../shared/rooms.ts";
import { USE_TOOL_TOOL } from "../../shared/tool-title.ts";

export const USAGE_STATS_TOOL = "usage_stats";
export const PLAN_USAGE_TOOL = "plan_usage";
export const TITLE_CONVERSATION_TOOL = "title_conversation";
export const LAND_TOOL = "land";
/** Brings a plugin that loads on request into the conversation: its instructions, and the names of its tools, which run through use_tool. */
export const PLUGIN_LOAD_TOOL = "plugin_load";

/** None of them changes files or runs commands for the agent, so none is worth a permission prompt. */
export const PRE_ALLOWED_CANVAS_TOOLS = ["show", "ask", "when_done", USAGE_STATS_TOOL, PLAN_USAGE_TOOL, TITLE_CONVERSATION_TOOL, USE_TOOL_TOOL, ROOM_HISTORY_TOOL, ROOM_TAG_TOOL];

export const APP_TOOLS = ["app_open", "apply", "app_state", "app_run"];

/** The canvas server's own tools, whose names a plugin's tools can't take. */
export const BUILT_IN_CANVAS_TOOLS = [...PRE_ALLOWED_CANVAS_TOOLS, ...APP_TOOLS, LAND_TOOL, PLUGIN_LOAD_TOOL];
