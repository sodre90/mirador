import { expect, test } from "bun:test";
import type { SessionUpdate } from "@agentclientprotocol/sdk";
import { cancelledReplyChunks, type CancelledReplyChunks } from "../host/conversations.ts";

const chunk = (text: string, messageId?: string): SessionUpdate => ({ sessionUpdate: "agent_message_chunk", content: { type: "text", text }, messageId });
const heldTexts = (pending: CancelledReplyChunks) => pending.held!.map((update) => (update as { content: { text: string } }).content.text);

test("every late chunk of the reply a stopped turn was already streaming is dropped, nothing held back for it", () => {
  for (const turnRunning of [false, true]) {
    let pending: CancelledReplyChunks = { messageId: "msg-cut-off" };
    for (const text of ["Here", " is the", " answer"]) {
      const verdict = cancelledReplyChunks(pending, chunk(text, "msg-cut-off"), turnRunning);
      expect(verdict.drop).toBe(true);
      expect(verdict.pending!.held).toBeUndefined();
      pending = verdict.pending!;
    }
  }
});

test("a reply beginning after a stop that saw no chunk, while no turn runs, is the cancelled turn's and is dropped whole", () => {
  const started = cancelledReplyChunks({ messageId: null }, chunk("Late", "msg-orphan"), false);
  expect(started).toEqual({ drop: true, pending: { messageId: "msg-orphan" } });
  expect(cancelledReplyChunks(started.pending!, chunk(" answer", "msg-orphan"), false).drop).toBe(true);
});

test("a reply beginning in the next turn after a stop that saw no chunk is held back whole while it streams under its id", () => {
  const started = cancelledReplyChunks({ messageId: null }, chunk("Answering", "msg-unknown"), true);
  expect(started.drop).toBe(true);
  expect(started.pending!.messageId).toBe("msg-unknown");
  const continued = cancelledReplyChunks(started.pending!, chunk(" at once", "msg-unknown"), true);
  expect(continued.drop).toBe(true);
  expect(heldTexts(continued.pending!)).toEqual(["Answering", " at once"]);
});

test("a reply with another id ends the claim: the held-back one was the cancelled turn's orphan, this one shows", () => {
  const heldBack = cancelledReplyChunks({ messageId: null }, chunk("Answering", "msg-orphan"), true).pending!;
  const verdict = cancelledReplyChunks(heldBack, chunk("Answered after the stop", "msg-next-turn"), true);
  expect(verdict).toEqual({ drop: false, pending: null });
});

test("a chunk with no id ends the claim and shows, as nothing could tell it from the next turn's", () => {
  expect(cancelledReplyChunks({ messageId: null }, chunk("No id"), true)).toEqual({ drop: false, pending: null });
  expect(cancelledReplyChunks({ messageId: "msg-cut-off" }, chunk("No id"), false)).toEqual({ drop: false, pending: null });
});
