import { expect, test } from "bun:test";
import type { Conversation, StoredEvent } from "../shared/model.ts";
import { KEPT_CONVERSATIONS, initialState, reducer, selectedOpen, type AppState } from "../web/state.ts";

const selecting = (state: AppState, conversationId: string | null) => reducer(state, { type: "select", conversationId });
const event = (seq: number): StoredEvent => ({ seq, at: seq, event: { type: "user-message", text: `message ${seq}` } });
const keptIds = (state: AppState) => state.kept.map(({ conversationId }) => conversationId);

test("the page keeps the conversations selected last, the selected one first, and lets the oldest go", () => {
  const ids = Array.from({ length: KEPT_CONVERSATIONS + 1 }, (_, index) => `c${index}`);
  const state = ids.reduce(selecting, initialState);
  expect(keptIds(state)).toEqual(ids.slice(1).reverse());
  expect(keptIds(selecting(state, "c3"))).toEqual(["c3", "c5", "c4", "c2", "c1"]);
});

test("events reach a kept conversation while another is shown, and it shows them when selected again", () => {
  const history = { type: "conversation.history" as const, conversationId: "a", events: [event(1)], canvas: [] };
  let state = reducer(selecting(initialState, "a"), { type: "server", message: history });
  state = selecting(state, "b");
  state = reducer(state, { type: "server", message: { type: "conversation.event", conversationId: "a", event: event(2) } });
  expect(selectedOpen(state)?.conversationId).toBe("b");
  expect(selectedOpen(selecting(state, "a"))).toMatchObject({ loaded: true, events: [event(1), event(2)] });
});

test("a deleted conversation is no longer kept, and the others stay", () => {
  const state = ["a", "b"].reduce(selecting, initialState);
  const afterDeleting = reducer(state, { type: "server", message: { type: "conversation.deleted", conversationId: "a" } });
  expect(keptIds(afterDeleting)).toEqual(["b"]);
  expect(afterDeleting.selectedConversationId).toBe("b");
});

test("leaving the open conversation goes back to the one open before it that has no mark opening would clear", () => {
  const conversations = [
    { id: "a", waitingFor: null },
    { id: "b", waitingFor: "unread" },
    { id: "c", waitingFor: "question" },
    { id: "d", waitingFor: null },
  ] as Conversation[];
  const state = ["a", "c", "b", "d"].reduce(selecting, { ...initialState, conversations });
  const leaving = (from: AppState, conversationId: string) => reducer(from, { type: "leave-conversation", conversationId });
  expect(leaving(state, "d").selectedConversationId).toBe("c");
  expect(leaving(state, "b"), "a conversation that is not open stays where it is").toBe(state);
  const onlyMarked = ["b", "d"].reduce(selecting, { ...initialState, conversations });
  expect(leaving(onlyMarked, "d").selectedConversationId).toBeNull();
});

test("a reply streamed into a kept conversation is held as one event, however many chunks it came in", () => {
  const history = { type: "conversation.history" as const, conversationId: "a", events: [event(1)], canvas: [] };
  const chunk = (seq: number): StoredEvent => ({ seq, at: seq, event: { type: "acp", update: { sessionUpdate: "agent_message_chunk", messageId: "m1", content: { type: "text", text: `word${seq} ` } } } });
  const streamed = Array.from({ length: 500 }, (_, index) => chunk(index + 2));
  const state = streamed.reduce(
    (before, stored) => reducer(before, { type: "server", message: { type: "conversation.event", conversationId: "a", event: stored } }),
    reducer(selecting(initialState, "a"), { type: "server", message: history }),
  );
  const held = selectedOpen(state)!.events;
  expect(held.map(({ seq }) => seq)).toEqual([1, 501]);
  expect(held[1]).toMatchObject({ event: { update: { content: { text: streamed.map((_, index) => `word${index + 2} `).join("") } } } });
});

test("picking the open conversation again counts as a pick, so the sidebar can bring it back into view, and keeps it as it is", () => {
  const opened = selecting(initialState, "a");
  const pickedAgain = selecting(opened, "a");
  expect(pickedAgain.conversationsPicked).toBe(opened.conversationsPicked + 1);
  expect(pickedAgain.kept).toBe(opened.kept);
});
