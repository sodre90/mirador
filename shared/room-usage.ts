import type { TurnUsage } from "./model.ts";

/** What some turns took: their tokens, as their agents reported them, and their cost where the agents report one. */
export interface Spend {
  turns: number;
  tokens: TurnUsage;
  cost: { amount: number; currency: string } | null;
}

/**
 * What a room's agents took for their turns since a time: in all, by agent, and by the person whose message started
 * each turn; a turn of an agent another agent tagged counts toward the person whose message began the chain.
 */
export interface RoomUsage {
  roomId: string;
  /** Epoch milliseconds; null for every turn the room's agents took. */
  since: number | null;
  total: Spend;
  agents: { profileId: string; spend: Spend }[];
  people: { personId: string; spend: Spend }[];
}

const DAY_MS = 86_400_000;

/** The stretches the owner reads a room's usage over, each how far back it reaches; null for all of it. */
export const ROOM_USAGE_PERIODS = { week: 7 * DAY_MS, month: 30 * DAY_MS, all: null } as const;

export type RoomUsagePeriod = keyof typeof ROOM_USAGE_PERIODS;

export const sinceOf = (period: RoomUsagePeriod, now: number) => {
  const reach = ROOM_USAGE_PERIODS[period];
  return reach === null ? null : now - reach;
};
