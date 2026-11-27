import type { ModelRequestSample, TurnSample, UsageHistory } from "../shared/canvas-plugins.ts";
import { endsTurnWithSpend, type StoredEvent } from "../shared/model.ts";
import { inLimitedParallel } from "./limited-parallel.ts";
import type { Store } from "./store.ts";

/** A stored turn end, or an error that ended a turn, as a plugin reads the turn; null for any other event. */
export function turnSampleOf(conversationId: string, { at, event }: StoredEvent): TurnSample | null {
  if (!endsTurnWithSpend(event)) return null;
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

export type ModelRequestsOf = (conversationId: string, since: number) => Promise<ModelRequestSample[]>;

/** A transcript's first reading takes up to 32 MB, so a profile's many are read a few at a time. */
const TRANSCRIPTS_READ_AT_ONCE = 6;

export function usageHistoryOf(store: Store, conversationId: string, modelRequestsOf: ModelRequestsOf): UsageHistory {
  const profileTurnEnds = (since: number) => {
    const conversation = store.findConversation(conversationId);
    return conversation ? store.listTurnEnds({ profileId: conversation.profileId }, since) : [];
  };
  return {
    turns: (since = 0) => samplesOf(store.listTurnEnds({ conversationId }, since)),
    profileTurns: (since) => samplesOf(profileTurnEnds(since)),
    requests: (since = 0) => modelRequestsOf(conversationId, since),
    profileRequests: async (since) => {
      const conversationIds = new Set(profileTurnEnds(since).map((end) => end.conversationId));
      const requests = await inLimitedParallel([...conversationIds], TRANSCRIPTS_READ_AT_ONCE, (id) => modelRequestsOf(id, since));
      return requests.flat().toSorted((a, b) => a.startedAt - b.startedAt);
    },
  };
}
