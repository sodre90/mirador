import { describe, expect, test } from "bun:test";
import { roomUsage, type AgentInRoom } from "../host/room-usage.ts";
import type { ConversationEvent, StoredEvent, TurnUsage } from "../shared/model.ts";
import type { Spend } from "../shared/room-usage.ts";
import type { RoomMessage } from "../shared/rooms.ts";

const roomMessage = (id: string, seq: number, author: RoomMessage["author"], extra: Partial<RoomMessage> = {}): RoomMessage => ({
  id,
  roomId: "launch",
  seq,
  at: seq,
  author,
  text: id,
  tags: [],
  threadId: null,
  ...extra,
});

/**
 * The owner tags Builder, whose answer tags Reviewer; Mia, a member, tags Builder, and follows up in its thread. Gus, a
 * guest, only writes.
 */
const messages = [
  roomMessage("owners-task", 1, { personId: "owner" }, { tags: ["builder"] }),
  roomMessage("builders-answer", 2, { profileId: "builder" }, { tags: ["reviewer"], threadId: "t1", answers: "owners-task" }),
  roomMessage("mias-task", 3, { personId: "mia" }, { authorRole: "member", tags: ["builder"] }),
  roomMessage("guss-note", 4, { personId: "gus" }, { authorRole: "guest" }),
  roomMessage("mias-follow-up", 5, { personId: "mia" }, { authorRole: "member", threadId: "t2" }),
];

const tokens = (inputTokens: number, outputTokens: number, cachedReadTokens = 0, cachedWriteTokens = 0): TurnUsage => ({ inputTokens, outputTokens, cachedReadTokens, cachedWriteTokens });
const usd = (amount: number) => ({ amount, currency: "USD" });

const events = (...written: [number, ConversationEvent][]): StoredEvent[] => written.map(([at, event], index) => ({ seq: index + 1, at, event }));
const sent = (roomMessageId?: string): ConversationEvent => ({ type: "user-message", text: "catch-up", ...(roomMessageId && { roomMessageId }) });

const builder: AgentInRoom = {
  profileId: "builder",
  events: events(
    [1_000, sent("owners-task")],
    [2_000, { type: "turn-end", stopReason: "end_turn", usage: tokens(100, 20, 1_000, 50), costSoFar: usd(0.1) }],
    [3_000, sent("mias-task")],
    [4_000, { type: "turn-end", stopReason: "end_turn", usage: tokens(200, 40), costSoFar: usd(0.3) }],
    [4_500, { type: "user-message", text: "My answer to your question" }],
    [5_000, { type: "turn-end", stopReason: "end_turn", usage: tokens(10, 5), costSoFar: usd(0.35) }],
    [6_000, sent("mias-follow-up")],
    [7_000, { type: "error", message: "boom", endsTurn: true, usage: tokens(50, 0), costSoFar: usd(0.05) }],
  ),
};
const reviewer: AgentInRoom = {
  profileId: "reviewer",
  events: events([2_500, sent("builders-answer")], [2_600, { type: "turn-end", stopReason: "end_turn", usage: tokens(300, 60) }]),
};
const idle: AgentInRoom = { profileId: "idle", events: [] };

/** The cost rounded to a tenth of a cent, as sums of fractions of a dollar come out a hair off. */
const rounded = ({ turns, tokens, cost }: Spend) => ({ turns, tokens, cost: cost && { ...cost, amount: Math.round(cost.amount * 1000) / 1000 } });

describe("what a room's agents took", () => {
  test("sums each agent's turns, and each person's whose message they go back to: an agent another tagged counts toward the person who began the chain", () => {
    const usage = roomUsage("launch", null, [builder, reviewer, idle], messages);
    expect(rounded(usage.total)).toEqual({ turns: 5, tokens: tokens(660, 125, 1_000, 50), cost: usd(0.4) });
    expect(usage.agents.map(({ profileId, spend }) => [profileId, rounded(spend)])).toEqual([
      ["builder", { turns: 4, tokens: tokens(360, 65, 1_000, 50), cost: usd(0.4) }],
      ["reviewer", { turns: 1, tokens: tokens(300, 60), cost: null }],
      ["idle", { turns: 0, tokens: tokens(0, 0), cost: null }],
    ]);
    expect(usage.people.map(({ personId, spend }) => [personId, rounded(spend)])).toEqual([
      ["owner", { turns: 2, tokens: tokens(400, 80, 1_000, 50), cost: usd(0.1) }],
      ["mia", { turns: 3, tokens: tokens(260, 45), cost: usd(0.3) }],
    ]);
  });

  test("counts a turn that went on from an answer toward the message it answered, and a cost that started afresh from nothing", () => {
    const usage = roomUsage("launch", null, [builder], messages);
    const mia = usage.people.find(({ personId }) => personId === "mia")!;
    expect(rounded(mia.spend).cost).toEqual(usd(0.3));
    expect(mia.spend.turns).toBe(3);
  });

  test("over a period counts the turns that ended in it, each turn's cost still its own", () => {
    const usage = roomUsage("launch", 3_500, [builder, reviewer], messages);
    expect(usage.since).toBe(3_500);
    expect(rounded(usage.total)).toEqual({ turns: 3, tokens: tokens(260, 45), cost: usd(0.3) });
    expect(usage.people.map(({ personId }) => personId)).toEqual(["mia"]);
    expect(usage.agents.map(({ profileId, spend }) => [profileId, spend.turns])).toEqual([
      ["builder", 3],
      ["reviewer", 0],
    ]);
  });

  test("counts a turn no person's message is behind toward its agent and the room alone", () => {
    const orphan: AgentInRoom = { profileId: "builder", events: events([1, sent("gone")], [2, { type: "turn-end", stopReason: "end_turn", usage: tokens(7, 3) }]) };
    const usage = roomUsage("launch", null, [orphan], messages);
    expect([usage.total.turns, usage.agents[0]!.spend.turns, usage.people]).toEqual([1, 1, []]);
  });
});
