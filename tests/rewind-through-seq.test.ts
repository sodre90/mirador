import { describe, expect, test } from "bun:test";
import type { ServerMessage } from "../shared/protocol.ts";
import type { StoredEvent } from "../shared/model.ts";
import { initialState, reducer, selectedOpen, type AppState } from "../web/state.ts";

const event = (seq: number): StoredEvent => ({ seq, at: seq, event: { type: "user-message", text: `message ${seq}` } });
const selecting = (state: AppState, conversationId: string | null) => reducer(state, { type: "select", conversationId });
const serve = (state: AppState, message: ServerMessage) => reducer(state, { type: "server", message });
const seqsShown = (state: AppState) => selectedOpen(state)?.events.map(({ seq }) => seq);

/** A page showing conversation `a` with events numbered `seqs`. */
function pageShowing(seqs: number[]): AppState {
  const history: ServerMessage = { type: "conversation.history", conversationId: "a", events: seqs.map(event), canvas: [] };
  return serve(selecting(initialState, "a"), history);
}

/** A host that rewinds a page: `throughSeq` is the last seq the rewind took away, when the host names it. */
const rewoundFrom = (fromSeq: number, throughSeq?: number): ServerMessage => ({
  type: "conversation.rewound",
  conversationId: "a",
  fromSeq,
  ...(throughSeq !== undefined && { throughSeq }),
});
const rewindDoneFrom = (fromSeq: number, throughSeq?: number): ServerMessage => ({
  type: "conversation.rewind-done",
  requestId: "r1",
  conversationId: "a",
  fromSeq,
  ...(throughSeq !== undefined && { throughSeq }),
});

describe("a rewind with throughSeq", () => {
  test.each([
    ["conversation.rewound", rewoundFrom],
    ["conversation.rewind-done", rewindDoneFrom],
  ])("%s drops the events from fromSeq through throughSeq, and keeps an event numbered after throughSeq", (_, rewind) => {
    let state = pageShowing([1, 2, 3, 4]);
    state = serve(state, { type: "conversation.event", conversationId: "a", event: { seq: 5, at: 5, event: { type: "agent-process-ended" } } });
    state = serve(state, rewind(3, 4));
    expect(seqsShown(state)).toEqual([1, 2, 5]);
  });

  test("drops the range between fromSeq and throughSeq, and keeps a numbered event after it", () => {
    expect(seqsShown(serve(pageShowing([1, 2, 3]), rewoundFrom(2, 3)))).toEqual([1]);
    expect(seqsShown(serve(pageShowing([1, 2, 3, 6]), rewoundFrom(2, 3)))).toEqual([1, 6]);
  });

  test("a range that holds no event the page shows drops nothing", () => {
    const state = serve(pageShowing([1, 2]), rewoundFrom(5, 4));
    expect(seqsShown(state)).toEqual([1, 2]);
  });
});

describe("a rewind without throughSeq, from an older host", () => {
  test.each([
    ["conversation.rewound", rewoundFrom],
    ["conversation.rewind-done", rewindDoneFrom],
  ])("%s drops every event from fromSeq on, as it always did", (_, rewind) => {
    let state = pageShowing([1, 2, 3, 4]);
    state = serve(state, { type: "conversation.event", conversationId: "a", event: { seq: 5, at: 5, event: { type: "agent-process-ended" } } });
    state = serve(state, rewind(3));
    expect(seqsShown(state)).toEqual([1, 2]);
  });
});
