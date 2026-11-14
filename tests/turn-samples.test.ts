import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { usageHistoryOf } from "../host/turn-samples.ts";
import type { ConversationEvent } from "../shared/model.ts";
import { storeWithConversation } from "./canvas-plugin-host.ts";

const usage = { inputTokens: 12, outputTokens: 340, cachedReadTokens: 90_000, cachedWriteTokens: 2_000 };

/** c1 and c2 on profile p1, c3 on none. */
function storeWithThreeConversations() {
  const store = storeWithConversation();
  const c1 = store.findConversation("c1")!;
  store.updateConversation({ ...c1, profileId: "p1" });
  store.insertConversation({ ...c1, id: "c2", profileId: "p1" });
  store.insertConversation({ ...c1, id: "c3", profileId: null });
  return store;
}

function appendAt(store: ReturnType<typeof storeWithConversation>, conversationId: string, at: number, event: ConversationEvent) {
  setSystemTime(new Date(at));
  store.appendEvent(conversationId, event);
}

afterEach(() => setSystemTime());

describe("a conversation's turns, as a plugin reads them", () => {
  test("are its turn ends and the errors that ended turns, with what Mirador saw of each", () => {
    const store = storeWithThreeConversations();
    appendAt(store, "c1", 1_000, { type: "user-message", text: "go" });
    appendAt(store, "c1", 9_000, {
      type: "turn-end",
      stopReason: "end_turn",
      usage,
      model: "opus",
      startedAt: 1_100,
      toolCalls: 3,
      context: { used: 92_352, size: 200_000 },
      costSoFar: { amount: 0.42, currency: "USD" },
    });
    appendAt(store, "c1", 10_000, { type: "error", message: "beside the turn" });
    appendAt(store, "c1", 20_000, { type: "error", message: "limit", usageLimit: { resetsAt: null }, endsTurn: true, startedAt: 12_000, toolCalls: 0 });
    appendAt(store, "c1", 30_000, { type: "turn-end", stopReason: "cancelled" });

    expect(usageHistoryOf(store, "c1").turns()).toEqual([
      {
        conversationId: "c1",
        startedAt: 1_100,
        endedAt: 9_000,
        model: "opus",
        tokens: usage,
        toolCalls: 3,
        context: { used: 92_352, size: 200_000 },
        costSoFar: { amount: 0.42, currency: "USD" },
      },
      { conversationId: "c1", startedAt: 12_000, endedAt: 20_000, model: null, tokens: null, toolCalls: 0, context: null, costSoFar: null },
      { conversationId: "c1", startedAt: null, endedAt: 30_000, model: null, tokens: null, toolCalls: null, context: null, costSoFar: null },
    ]);
  });

  test("since a time, are the turns that ended then or later", () => {
    const store = storeWithThreeConversations();
    for (const at of [1_000, 2_000, 3_000]) appendAt(store, "c1", at, { type: "turn-end", stopReason: "end_turn" });
    expect(usageHistoryOf(store, "c1").turns(2_000).map(({ endedAt }) => endedAt)).toEqual([2_000, 3_000]);
  });

  test("of its profile, are every conversation's on that profile, oldest first", () => {
    const store = storeWithThreeConversations();
    appendAt(store, "c2", 1_000, { type: "turn-end", stopReason: "end_turn" });
    appendAt(store, "c1", 2_000, { type: "turn-end", stopReason: "end_turn" });
    appendAt(store, "c3", 3_000, { type: "turn-end", stopReason: "end_turn" });
    appendAt(store, "c2", 4_000, { type: "turn-end", stopReason: "end_turn" });
    const history = usageHistoryOf(store, "c1");
    expect(history.profileTurns(0).map(({ conversationId, endedAt }) => [conversationId, endedAt])).toEqual([
      ["c2", 1_000],
      ["c1", 2_000],
      ["c2", 4_000],
    ]);
    expect(history.profileTurns(2_000).map(({ endedAt }) => endedAt)).toEqual([2_000, 4_000]);
    expect(usageHistoryOf(store, "c3").profileTurns(0).map(({ conversationId }) => conversationId)).toEqual(["c3"]);
    expect(usageHistoryOf(store, "deleted").profileTurns(0)).toEqual([]);
  });
});
