import { expect, test } from "bun:test";
import type { ToolCallUpdate } from "@agentclientprotocol/sdk/unstable";
import { awaitsItsInput, ToolCallReportsHeard, withReportedToolCall } from "../host/acp/reported-tool-call.ts";

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

test("an edit waits for its input until a report holds its change", () => {
  expect(awaitsItsInput({ toolCallId: "t1", title: "Preparing file…", kind: "edit", content: [] }), "reported as it started").toBe(true);
  expect(awaitsItsInput({ toolCallId: "t1", title: "Write a.ts", kind: "edit", content: [], locations: [{ path: "/work/a.ts" }] }), "its file streamed in, its text not yet").toBe(true);
  expect(awaitsItsInput({ toolCallId: "t1", kind: "edit", content: [diff] })).toBe(false);
  const cell = { type: "content" as const, content: { type: "text" as const, text: "print(1)" } };
  expect(awaitsItsInput({ toolCallId: "t1", kind: "edit", content: [cell] }), "a notebook cell edit shows its cell, not a diff").toBe(false);
  expect(awaitsItsInput({ toolCallId: "t1", title: "Run ls", kind: "execute" })).toBe(false);
});

test("a wait for a tool call's next report ends with that report, not another call's", async () => {
  const heard = new ToolCallReportsHeard();
  let ended = false;
  const waiting = heard.next("t1", 60_000, new AbortController().signal).then(() => (ended = true));
  heard.heard("t2");
  await Bun.sleep(0);
  expect(ended).toBe(false);
  heard.heard("t1");
  await waiting;
  expect(ended).toBe(true);
});

test("a wait for a report that never comes ends at its timeout or when the request is withdrawn", async () => {
  const heard = new ToolCallReportsHeard();
  const startedAt = Date.now();
  await heard.next("t1", 20, new AbortController().signal);
  expect(Date.now() - startedAt).toBeGreaterThanOrEqual(15);
  const withdrawn = new AbortController();
  const waiting = heard.next("t1", 60_000, withdrawn.signal);
  withdrawn.abort();
  await waiting;
});
