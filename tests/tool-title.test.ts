import { expect, test } from "bun:test";
import type { SessionUpdate } from "@agentclientprotocol/sdk/unstable";
import type { StoredEvent } from "../shared/model.ts";
import { buildTimeline, type ToolBlock } from "../shared/timeline.ts";
import { readableToolTitle } from "../shared/tool-title.ts";

test("an MCP tool reads as server · tool, and a plugin's tool on the canvas server as the plugin's title · tool", () => {
  const plugins = { delegate: "Delegate" };
  expect(readableToolTitle("mcp__canvas__delegate", plugins)).toBe("Delegate · delegate");
  expect(readableToolTitle("mcp__canvas__show", plugins)).toBe("canvas · show");
  expect(readableToolTitle("mcp__github__delegate", plugins)).toBe("github · delegate");
  expect(readableToolTitle("Read a.ts", plugins)).toBe("Read a.ts");
});

test("a use_tool call reads as the plugin's title · the tool it ran, named in its input, under each agent's prefix", () => {
  const plugins = { review: "Code review" };
  const input = { tool: "review", input: { title: "Retry payments" } };
  expect(readableToolTitle("mcp__canvas__use_tool", plugins, input)).toBe("Code review · review");
  expect(readableToolTitle("canvas_use_tool", plugins, input)).toBe("Code review · review");
  expect(readableToolTitle("mcp_canvas_use_tool", plugins, input)).toBe("Code review · review");
  expect(readableToolTitle("mcp__canvas__use_tool", plugins, { tool: "show_card" })).toBe("canvas · show_card");
  expect(readableToolTitle("mcp__canvas__use_tool", plugins)).toBe("canvas · use_tool");
  expect(readableToolTitle("mcp__canvas__use_tool", plugins, {})).toBe("canvas · use_tool");
  expect(readableToolTitle("mcp__github__use_tool", plugins, input)).toBe("github · use_tool");
  expect(readableToolTitle("mcp__canvas__use_tool", plugins, { server: "canvas", tool: "use_tool", arguments: input })).toBe("Code review · review");
});

const shownTitleOf = (updates: object[], pluginToolTitles: Record<string, string>) => {
  const events: StoredEvent[] = updates.map((update, index) => ({ seq: index + 1, at: index, event: { type: "acp", update: update as SessionUpdate } }));
  const [block] = buildTimeline(events) as ToolBlock[];
  return readableToolTitle(block!.title, pluginToolTitles, block!.rawInput);
};

test("Claude Code's MCP calls, which claude-agent-acp titles server: tool, read by the tool's own name, a use_tool call as the tool it ran", () => {
  const claudeCodeCall = (toolCallId: string, toolName: string, title: string) => ({ toolCallId, title, kind: "other", _meta: { claudeCode: { toolName } } });
  const useTool = claudeCodeCall("call_1", "mcp__canvas__use_tool", "canvas: use_tool");
  expect(
    shownTitleOf(
      [
        { sessionUpdate: "tool_call", ...useTool, name: "mcp__canvas__use_tool", status: "pending", rawInput: {} },
        { sessionUpdate: "tool_call_update", ...useTool, rawInput: { tool: "show_card", input: { title: "Greeting" } } },
        { sessionUpdate: "tool_call_update", toolCallId: "call_1", status: "completed" },
      ],
      { show_card: "Board" },
    ),
  ).toBe("Board · show_card");
  expect(shownTitleOf([{ sessionUpdate: "tool_call", ...claudeCodeCall("call_2", "mcp__github__list_issues", "github: list_issues"), status: "pending" }], {})).toBe("github · list_issues");
  expect(shownTitleOf([{ sessionUpdate: "tool_call", ...claudeCodeCall("call_3", "Read", "Read a.ts"), kind: "read", status: "pending" }], {})).toBe("Read a.ts");
});
