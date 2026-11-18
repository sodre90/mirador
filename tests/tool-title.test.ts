import { expect, test } from "bun:test";
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
