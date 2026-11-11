import { expect, test } from "bun:test";
import { queuedBeforeSessionChange } from "../host/conversations.ts";
import { sessionHasRecord } from "../shared/conversation-begun.ts";
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
  expect(queuedBeforeSessionChange(queued("one", "two")).map(({ text }) => text)).toEqual(["one", "two"]);
  expect(queuedBeforeSessionChange(queued("one", " /clear ", "after")).map(({ text }) => text)).toEqual(["one"]);
  expect(queuedBeforeSessionChange(queued("/clear", "after"))).toEqual([]);
});

test("messages queued after a /reload wait for it too, so they reach the agent with its settings read anew", () => {
  expect(queuedBeforeSessionChange(queued("one", "/reload", "after", "/clear")).map(({ text }) => text)).toEqual(["one"]);
  expect(queuedBeforeSessionChange(queued("/reload please", "after")).map(({ text }) => text)).toEqual(["/reload please", "after"]);
});

test("a /reload keeps the agent's record of its session, which it resumes", () => {
  const worked = [{ type: "user-message", text: "hello" }, { type: "turn-end", stopReason: "end_turn" }] as const;
  expect(sessionHasRecord(stored(...worked, { type: "agent-reloaded" }))).toBe(true);
});
