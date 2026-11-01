import { expect, test } from "bun:test";
import type { SessionUpdate } from "@agentclientprotocol/sdk";
import type { ConversationEvent, StoredEvent } from "../shared/model.ts";
import { buildTimeline, withChunksCoalesced, withStreamedEvent } from "../shared/timeline.ts";

const stored = (events: ConversationEvent[]): StoredEvent[] => events.map((event, index) => ({ seq: index + 1, at: (index + 1) * 1000, event }));
const acp = (update: SessionUpdate): ConversationEvent => ({ type: "acp", update });
const chunk = (kind: "agent_message_chunk" | "agent_thought_chunk", messageId: string, text: string, meta?: Record<string, unknown>) =>
  acp({ sessionUpdate: kind, messageId, content: { type: "text", text }, ...(meta && { _meta: meta }) });

/** A small deterministic generator, so a failing case can be run again. */
function random(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2 ** 31;
    return state / 2 ** 31;
  };
}

/** A turn of the kinds of events a reply streams, with the odd cases mixed in: repeats, notices, subagents, images. */
function streamedTurn(next: () => number): ConversationEvent[] {
  const pick = <T>(items: T[]) => items[Math.floor(next() * items.length)]!;
  const sentSoFar = new Map<string, string>();
  const events: ConversationEvent[] = [{ type: "user-message", text: "go" }];
  for (let index = 0; index < 60; index++) {
    const messageId = pick(["m1", "m2"]);
    const roll = next();
    if (roll < 0.45) {
      const text = pick(["Hel", "lo", " ", "", "lo", "\n\n", "Hello"]);
      sentSoFar.set(messageId, (sentSoFar.get(messageId) ?? "") + text);
      events.push(chunk("agent_message_chunk", messageId, text));
    } else if (roll < 0.55) events.push(chunk("agent_message_chunk", messageId, sentSoFar.get(messageId) ?? "x"));
    else if (roll < 0.7) events.push(chunk("agent_thought_chunk", messageId, pick(["think", "ing", " "])));
    else if (roll < 0.75) events.push(chunk("agent_message_chunk", messageId, "**Notice:** hook", { claudeCode: { kind: "informational" } }));
    else if (roll < 0.8) events.push(acp({ sessionUpdate: "tool_call", toolCallId: "task", title: "Task", status: "in_progress", _meta: { claudeCode: { toolName: "Task" } } }));
    else if (roll < 0.88) events.push(chunk("agent_message_chunk", messageId, pick(["sub", "agent"]), { claudeCode: { parentToolUseId: "task" } }));
    else if (roll < 0.92) events.push(acp({ sessionUpdate: "agent_message_chunk", messageId, content: { type: "image", mimeType: "image/png", data: "AA==" } }));
    else if (roll < 0.96) events.push({ type: "error", message: `failed: ${sentSoFar.get(messageId) ?? ""}` });
    else events.push({ type: "turn-end", stopReason: "end_turn" });
  }
  return events;
}

test("the coalesced history makes the same timeline as the chunks, down to each entry's key and time", () => {
  for (let seed = 1; seed <= 300; seed++) {
    const next = random(seed);
    const events = stored([...streamedTurn(next), ...streamedTurn(next)]);
    expect({ seed, timeline: buildTimeline(withChunksCoalesced(events)) }).toEqual({ seed, timeline: buildTimeline(events) });
  }
});

test("a message's chunks go out as one, under the last chunk's number, and other events as they are", () => {
  const events = stored([
    { type: "user-message", text: "hi" },
    chunk("agent_thought_chunk", "m1", "Let me "),
    chunk("agent_thought_chunk", "m1", "think."),
    chunk("agent_message_chunk", "m1", "Hel"),
    chunk("agent_message_chunk", "m1", "lo"),
    chunk("agent_message_chunk", "m1", "!"),
    { type: "turn-end", stopReason: "end_turn" },
  ]);
  const coalesced = withChunksCoalesced(events);
  expect(coalesced.map(({ seq }) => seq)).toEqual([1, 3, 6, 7]);
  expect(coalesced[2]).toMatchObject({ at: 6000, event: { update: { content: { text: "Hello!" }, _meta: { "mirador/coalesced": { chunks: 3, firstSeq: 4, firstAt: 4000 } } } } });
});

test("a long reply streamed a few words a chunk becomes one event", () => {
  const words = Array.from({ length: 5_000 }, (_, index) => `word${index} `);
  const events = stored([{ type: "user-message", text: "go" }, ...words.map((word) => chunk("agent_message_chunk", "m1", word))]);
  const coalesced = withChunksCoalesced(events);
  expect(coalesced).toHaveLength(2);
  expect(buildTimeline(coalesced)).toEqual(buildTimeline(events));
});

test("a message that goes on after a tool call with the very text it had so far is not taken for a gateway's repeat", () => {
  const events = stored([
    { type: "user-message", text: "go" },
    chunk("agent_message_chunk", "m1", "a"),
    chunk("agent_message_chunk", "m1", "b"),
    acp({ sessionUpdate: "tool_call", toolCallId: "t1", title: "Read", status: "completed" }),
    chunk("agent_message_chunk", "m1", "a"),
    chunk("agent_message_chunk", "m1", "b"),
  ]);
  expect(buildTimeline(withChunksCoalesced(events))).toEqual(buildTimeline(events));
});

test("live chunks joined one at a time to a history that stops anywhere hold what the whole history coalesced holds", () => {
  for (let seed = 1; seed <= 120; seed++) {
    const next = random(seed);
    const events = stored([...streamedTurn(next), ...streamedTurn(next)]);
    const whole = withChunksCoalesced(events);
    for (let split = 0; split <= events.length; split++) {
      const held = events.slice(split).reduce(withStreamedEvent, withChunksCoalesced(events.slice(0, split)));
      expect({ seed, split, held }).toEqual({ seed, split, held: whole });
    }
  }
});

test("a reply that goes on streaming after the history loaded stays one event, under its newest chunk's number", () => {
  const events = stored([{ type: "user-message", text: "hi" }, chunk("agent_message_chunk", "m1", "Hel"), chunk("agent_message_chunk", "m1", "lo"), chunk("agent_message_chunk", "m1", "!")]);
  const held = events.slice(2).reduce(withStreamedEvent, withChunksCoalesced(events.slice(0, 2)));
  expect(held.map(({ seq }) => seq)).toEqual([1, 4]);
  expect(held[1]).toMatchObject({ at: 4000, event: { update: { content: { text: "Hello!" }, _meta: { "mirador/coalesced": { chunks: 3, firstSeq: 2, firstAt: 2000 } } } } });
});
