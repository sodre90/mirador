import type { StoredEvent } from "./model.ts";

/** The user messages that joined a turn but went out again after it, as the agent never answered them. */
export const returnedSteerSeqs = (events: StoredEvent[]) =>
  new Set(events.flatMap(({ event }) => (event.type === "steered-messages-returned" ? event.seqs : [])));
