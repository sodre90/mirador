import type { TurnSample, UsageHistory } from "../shared/canvas-plugins.ts";
import type { StoredEvent } from "../shared/model.ts";
import type { Store } from "./store.ts";

/** A stored turn end, or an error that ended a turn, as a plugin reads the turn; null for any other event. */
export function turnSampleOf(conversationId: string, { at, event }: StoredEvent): TurnSample | null {
  if (event.type !== "turn-end" && !(event.type === "error" && event.endsTurn)) return null;
  return {
    conversationId,
    startedAt: event.startedAt ?? null,
    endedAt: at,
    model: event.model ?? null,
    tokens: event.usage ?? null,
    toolCalls: event.toolCalls ?? null,
    context: event.context ?? null,
    costSoFar: event.costSoFar ?? null,
  };
}

const samplesOf = (ends: (StoredEvent & { conversationId: string })[]) => ends.flatMap((end) => turnSampleOf(end.conversationId, end) ?? []);

export function usageHistoryOf(store: Store, conversationId: string): UsageHistory {
  return {
    turns: (since = 0) => samplesOf(store.listTurnEnds({ conversationId }, since)),
    profileTurns: (since) => {
      const conversation = store.findConversation(conversationId);
      return conversation ? samplesOf(store.listTurnEnds({ profileId: conversation.profileId }, since)) : [];
    },
  };
}
