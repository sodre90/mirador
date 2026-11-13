import type { ToolCallUpdate } from "@agentclientprotocol/sdk/unstable";
import { mcpToolNameOf } from "../../shared/tool-title.ts";
import { CANVAS_SERVER_NAME } from "../acp/harnesses.ts";
import { PRE_ALLOWED_CANVAS_TOOLS } from "./tool-names.ts";

/**
 * A canvas tool's name as each agent titles its call: `mcp__canvas__ask` in Claude Code, `canvas_ask` in opencode,
 * `canvas-ask` in Copilot, `mcp.canvas.ask` in Codex. Codex and Antigravity name the tool apart from the title, as
 * `mcp__canvas__ask` once read.
 */
const CANVAS_TOOL_TITLE = new RegExp(`^(?:mcp__${CANVAS_SERVER_NAME}__|${CANVAS_SERVER_NAME}__|${CANVAS_SERVER_NAME}_|${CANVAS_SERVER_NAME}-|mcp\\.${CANVAS_SERVER_NAME}\\.)(.+)$`);

/**
 * The canvas tool a permission request is for, if any. Copilot asks with the bare tool name ("ping") after reporting
 * the call as "canvas-ping", so the reports of the same tool call are read too; a bare title alone never counts. A call
 * of another kind, such as a shell command titled with its command line, is never a canvas tool.
 */
export function canvasToolAskedFor(request: ToolCallUpdate, reports: ToolCallUpdate[]): string | null {
  const calls = [request, ...reports];
  const titledAsAnotherKind = calls.some(({ kind }) => kind && kind !== "other");
  for (const call of calls) {
    const mcpName = mcpToolNameOf(call);
    const tool = CANVAS_TOOL_TITLE.exec(mcpName ?? (titledAsAnotherKind ? "" : (call.title ?? "")))?.[1];
    if (tool) return tool;
  }
  return null;
}

/** Claude Code pre-allows these in the session's allowed tools; the other agents are asked, so the host answers for them. */
export const isPreAllowedCanvasTool = (tool: string | null, pluginToolNames: string[]) =>
  tool !== null && (PRE_ALLOWED_CANVAS_TOOLS.includes(tool) || pluginToolNames.includes(tool));
