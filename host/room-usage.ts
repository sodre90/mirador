import { endsTurnWithSpend, type StoredEvent, type TurnUsage } from "../shared/model.ts";
import type { RoomUsage, Spend } from "../shared/room-usage.ts";
import { personIdBehind, type RoomMessage } from "../shared/rooms.ts";

type Cost = NonNullable<Spend["cost"]>;

/** An agent of the room and the events of its conversation there that tell its turns: the messages it was sent, and what ended each turn. */
export interface AgentInRoom {
  profileId: string;
  events: StoredEvent[];
}

export const EVENTS_OF_TURNS = ["user-message", "turn-end", "error"] as const;

/** One turn an agent of the room took: when it ended, what it took, and the person whose message it goes back to, if any. */
interface RoomTurn {
  profileId: string;
  personId: string | null;
  endedAt: number;
  tokens: TurnUsage | null;
  cost: Cost | null;
}

const NO_TOKENS: TurnUsage = { inputTokens: 0, outputTokens: 0, cachedReadTokens: 0, cachedWriteTokens: 0 };
const NOTHING_SPENT: Spend = { turns: 0, tokens: NO_TOKENS, cost: null };

/**
 * A turn's own cost: what the agent said its conversation cost by the turn's end, less what it said by the end of the
 * turn before. One that counts afresh, as an agent started again does, or in another currency, counts from nothing.
 */
function costOfTurn(before: Cost | undefined, soFar: Cost | undefined): Cost | null {
  if (!soFar) return null;
  if (!before || before.currency !== soFar.currency || soFar.amount < before.amount) return soFar;
  return { amount: soFar.amount - before.amount, currency: soFar.currency };
}

/** The person whose message a turn on the room message goes back to: its writer, or for an agent's answer, the writer of the message its chain began with (stopping at a brought agent's bringer). */
function personBehind(roomMessageId: string | undefined, messagesById: Map<string, RoomMessage>): string | null {
  const asked = roomMessageId === undefined ? undefined : messagesById.get(roomMessageId);
  return asked ? personIdBehind(asked, messagesById) : null;
}

/**
 * The agent's turns, each tied to the room message it answers: the last one sent to the agent before it ended, so that a
 * turn that went on from an answer, as after a question, counts toward the same message.
 */
function turnsOf({ profileId, events }: AgentInRoom, messagesById: Map<string, RoomMessage>): RoomTurn[] {
  const turns: RoomTurn[] = [];
  let answering: string | undefined;
  let costSoFarBefore: Cost | undefined;
  for (const { at, event } of events) {
    if (event.type === "user-message") answering = event.roomMessageId ?? answering;
    if (!endsTurnWithSpend(event)) continue;
    turns.push({ profileId, personId: personBehind(answering, messagesById), endedAt: at, tokens: event.usage ?? null, cost: costOfTurn(costSoFarBefore, event.costSoFar) });
    costSoFarBefore = event.costSoFar ?? costSoFarBefore;
  }
  return turns;
}

const costAdded = (sum: Cost | null, cost: Cost | null): Cost | null => {
  if (!cost) return sum;
  if (!sum) return cost;
  return sum.currency === cost.currency ? { amount: sum.amount + cost.amount, currency: sum.currency } : sum;
};

const tokensAdded = (sum: TurnUsage, tokens: TurnUsage | null): TurnUsage => ({
  inputTokens: sum.inputTokens + (tokens?.inputTokens ?? 0),
  outputTokens: sum.outputTokens + (tokens?.outputTokens ?? 0),
  cachedReadTokens: sum.cachedReadTokens + (tokens?.cachedReadTokens ?? 0),
  cachedWriteTokens: sum.cachedWriteTokens + (tokens?.cachedWriteTokens ?? 0),
});

const spendOf = (turns: RoomTurn[]): Spend =>
  turns.reduce((spend, { tokens, cost }) => ({ turns: spend.turns + 1, tokens: tokensAdded(spend.tokens, tokens), cost: costAdded(spend.cost, cost) }), NOTHING_SPENT);

const allTokens = ({ tokens }: Spend) => tokens.inputTokens + tokens.outputTokens + tokens.cachedReadTokens + tokens.cachedWriteTokens;

/**
 * What the room's agents took for the turns they ended since `since`: in all, by agent in the room's order, and by the
 * person behind each turn, the one who took most first. Turns no person's message is behind count in the first two alone.
 */
export function roomUsage(roomId: string, since: number | null, agents: AgentInRoom[], messages: RoomMessage[]): RoomUsage {
  const messagesById = new Map(messages.map((message) => [message.id, message]));
  const turns = agents.flatMap((agent) => turnsOf(agent, messagesById)).filter(({ endedAt }) => since === null || endedAt >= since);
  const byPerson = Map.groupBy(
    turns.filter(({ personId }) => personId !== null),
    ({ personId }) => personId!,
  );
  return {
    roomId,
    since,
    total: spendOf(turns),
    agents: agents.map(({ profileId }) => ({ profileId, spend: spendOf(turns.filter((turn) => turn.profileId === profileId)) })),
    people: [...byPerson].map(([personId, theirs]) => ({ personId, spend: spendOf(theirs) })).toSorted((a, b) => allTokens(b.spend) - allTokens(a.spend)),
  };
}
