import { expect, test } from "bun:test";
import type * as acp from "@agentclientprotocol/sdk";
import { UnknownSessionUpdates } from "../host/unknown-session-updates.ts";

const note = (sessionId: string, text: string): acp.SessionNotification => ({
  sessionId,
  update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } },
});

const texts = (pending: acp.SessionNotification[]) =>
  pending.flatMap(({ update }) => (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text" ? [update.content.text] : []));

test("a session that never attaches cannot grow the bridge without end: the oldest updates give way", () => {
  const updates = new UnknownSessionUpdates(4);
  for (const text of "abcdefgh") updates.remember(note("ses_gone", text));
  expect(updates.size).toBe(4);
  expect(texts(updates.take("ses_gone"))).toEqual(["e", "f", "g", "h"]);
  expect(updates.size).toBe(0);
  expect(updates.take("ses_gone")).toEqual([]);
});

test("a bridge full from two sessions drops from the session that has waited longest, leaving the newer one whole", () => {
  const updates = new UnknownSessionUpdates(3);
  updates.remember(note("ses_first", "a"));
  updates.remember(note("ses_first", "b"));
  updates.remember(note("ses_second", "c"));
  updates.remember(note("ses_second", "d"));
  expect(updates.size).toBe(3);
  expect(texts(updates.take("ses_first"))).toEqual(["b"]);
  expect(texts(updates.take("ses_second"))).toEqual(["c", "d"]);
});

test("an update waiting for one session is taken only by that session, in the order it arrived", () => {
  const updates = new UnknownSessionUpdates();
  updates.remember(note("ses_a", "1"));
  updates.remember(note("ses_b", "2"));
  updates.remember(note("ses_a", "3"));
  expect(texts(updates.take("ses_a"))).toEqual(["1", "3"]);
  expect(updates.size).toBe(1);
  expect(texts(updates.take("ses_b"))).toEqual(["2"]);
  expect(updates.size).toBe(0);
});
