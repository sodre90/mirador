import { expect, test } from "bun:test";
import type { ToolCallUpdate } from "@agentclientprotocol/sdk";
import { withReportedToolCall } from "../host/acp/reported-tool-call.ts";

const diff = { type: "diff" as const, path: "/work/a.ts", oldText: "one", newText: "two" };

test("a permission request that names a tool call by its id takes its kind, content and locations from the reports before it", () => {
  const reports: ToolCallUpdate[] = [
    { toolCallId: "t1", title: "Edit", kind: "edit" },
    { toolCallId: "t1", title: "Edit a.ts", content: [diff], locations: [{ path: "/work/a.ts" }] },
  ];
  const requested: ToolCallUpdate = { toolCallId: "t1", title: "Edit a.ts", rawInput: { file_path: "/work/a.ts" } };
  expect(withReportedToolCall(requested, reports)).toEqual({ toolCallId: "t1", title: "Edit a.ts", rawInput: { file_path: "/work/a.ts" }, kind: "edit", content: [diff], locations: [{ path: "/work/a.ts" }] });
});

test("what the request carries itself stands over what was reported", () => {
  const ownDiff = { ...diff, newText: "three" };
  const requested: ToolCallUpdate = { toolCallId: "t1", kind: "edit", content: [ownDiff] };
  expect(withReportedToolCall(requested, [{ toolCallId: "t1", kind: "other", content: [diff] }])).toEqual({ toolCallId: "t1", kind: "edit", content: [ownDiff] });
});

test("a request for a tool call never reported stays as it came", () => {
  const requested: ToolCallUpdate = { toolCallId: "t1", title: "Run ls", rawInput: { command: "ls" } };
  expect(withReportedToolCall(requested, [])).toEqual(requested);
});
