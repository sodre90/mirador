import { expect, test } from "bun:test";
import { readableToolTitle } from "../shared/tool-title.ts";

test("an MCP tool reads as server · tool, and a plugin's tool on the canvas server as the plugin's title · tool", () => {
  const plugins = { delegate: "Delegate" };
  expect(readableToolTitle("mcp__canvas__delegate", plugins)).toBe("Delegate · delegate");
  expect(readableToolTitle("mcp__canvas__show", plugins)).toBe("canvas · show");
  expect(readableToolTitle("mcp__github__delegate", plugins)).toBe("github · delegate");
  expect(readableToolTitle("Read a.ts", plugins)).toBe("Read a.ts");
});
