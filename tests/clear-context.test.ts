import { expect, test } from "bun:test";
import { queuedBeforeClear, sessionHasRecord } from "../host/conversations.ts";
import type { ConversationEvent, QueuedMessage } from "../shared/model.ts";

const stored = (...events: ConversationEvent[]) => events.map((event, seq) => ({ seq, at: seq, event }));
const queued = (...texts: string[]): QueuedMessage[] => texts.map((text, index) => ({ id: `m${index}`, text, imageIds: [] }));

test("after a /clear, the agent has a record of its session only once it worked on a message there", () => {
  const before = [{ type: "user-message", text: "hello" }, { type: "turn-end", stopReason: "end_turn" }] as const;
  expect(sessionHasRecord(stored(...before))).toBe(true);
  expect(sessionHasRecord(stored(...before, { type: "context-cleared" }))).toBe(false);
  expect(sessionHasRecord(stored(...before, { type: "context-cleared" }, { type: "turn-end", stopReason: "end_turn" }))).toBe(true);
});

test("messages queued after a /clear wait for it, rather than join the turn it ends", () => {
  expect(queuedBeforeClear(queued("one", "two")).map(({ text }) => text)).toEqual(["one", "two"]);
  expect(queuedBeforeClear(queued("one", " /clear ", "after")).map(({ text }) => text)).toEqual(["one"]);
  expect(queuedBeforeClear(queued("/clear", "after"))).toEqual([]);
});
