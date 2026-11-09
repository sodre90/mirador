import { describe, expect, test } from "bun:test";
import type { PermissionOption, ToolCallUpdate } from "@agentclientprotocol/sdk/unstable";
import { optionThatAllows } from "../host/conversations.ts";
import { canvasToolAskedFor, isPreAllowedCanvasTool } from "../host/canvas/permission.ts";

const option = (optionId: string, kind: PermissionOption["kind"]): PermissionOption => ({ optionId, name: optionId, kind });

test("YOLO allows once when it can, always only when nothing else allows, and never picks a rejection", () => {
  expect(optionThatAllows([option("always", "allow_always"), option("once", "allow_once"), option("no", "reject_once")])).toBe("once");
  expect(optionThatAllows([option("no", "reject_once"), option("always", "allow_always")])).toBe("always");
  expect(optionThatAllows([option("no", "reject_once"), option("never", "reject_always")])).toBeNull();
});

describe("canvas tools the host allows without asking", () => {
  const call = (title: string, extra: Partial<ToolCallUpdate> = {}): ToolCallUpdate => ({ toolCallId: "t1", title, ...extra });

  test("each agent's title for a canvas tool names it", () => {
    expect(canvasToolAskedFor(call("mcp__canvas__review"), [])).toBe("review");
    expect(canvasToolAskedFor(call("canvas_checklist"), [])).toBe("checklist");
    expect(canvasToolAskedFor(call("canvas-tour"), [])).toBe("tour");
    expect(canvasToolAskedFor(call("Run", { rawInput: { server: "canvas", tool: "update_checklist" }, _meta: { is_mcp_tool_call: true } }), [])).toBe("update_checklist");
  });

  test("Copilot's bare title is read through the report it sent before the request", () => {
    expect(canvasToolAskedFor(call("ping"), [])).toBeNull();
    expect(canvasToolAskedFor(call("ping"), [call("canvas-ping", { kind: "other" })])).toBe("ping");
  });

  test("another server's tool or a built-in one is no canvas tool", () => {
    expect(canvasToolAskedFor(call("mcp__github__review"), [])).toBeNull();
    expect(canvasToolAskedFor(call("Bash"), [call("Bash")])).toBeNull();
    expect(canvasToolAskedFor(call("canvasser-show"), [])).toBeNull();
  });

  test("a shell command titled like a canvas tool is no canvas tool", () => {
    expect(canvasToolAskedFor(call("canvas_show", { kind: "execute" }), [])).toBeNull();
    expect(canvasToolAskedFor(call("canvas-show"), [call("canvas-show", { kind: "execute" })])).toBeNull();
  });

  test("the pre-allowed tools and the plugins' tools are allowed, other canvas tools are asked about", () => {
    expect(isPreAllowedCanvasTool("show", [])).toBe(true);
    expect(isPreAllowedCanvasTool("review", ["review", "tour"])).toBe(true);
    expect(isPreAllowedCanvasTool("review", [])).toBe(false);
    expect(isPreAllowedCanvasTool("app_run", ["review"])).toBe(false);
    expect(isPreAllowedCanvasTool(null, ["review"])).toBe(false);
  });
});
