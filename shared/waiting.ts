import type { Conversation, WaitingFor } from "./model.ts";

export type WaitingTone = "decision" | "failed" | "done" | "unread";

export const waitingTones: Record<WaitingFor, WaitingTone> = {
  permission: "decision",
  question: "decision",
  error: "failed",
  finished: "done",
  unread: "unread",
};

export const waitingLabels: Record<WaitingTone, string> = {
  decision: "Needs you",
  failed: "Failed",
  done: "Done",
  unread: "Unread",
};

export const tonesByUrgency: WaitingTone[] = ["decision", "failed", "done", "unread"];

const urgencyOf = ({ waitingFor }: Conversation) => (waitingFor ? tonesByUrgency.indexOf(waitingTones[waitingFor]) : -1);

export const mostUrgentTone = (waiting: WaitingFor[]) =>
  tonesByUrgency.find((tone) => waiting.some((waitingFor) => waitingTones[waitingFor] === tone));

export const isWaiting = ({ waitingFor }: Conversation) => waitingFor !== null;

/** Done, Failed and Unread last until you open the conversation or mark it read; a decision lasts until you make it. */
export const lastsUntilOpened = (waitingFor: WaitingFor | null) => waitingFor !== null && waitingTones[waitingFor] !== "decision";

/** A running turn takes the dot from a mark that lasts until opened, which the pill still shows; a decision keeps the dot, as it needs you now. */
export const waitingShowsOnDot = ({ waitingFor, status }: Conversation) => waitingFor !== null && !(lastsUntilOpened(waitingFor) && status === "running");

/** What the desktop app hears of the conversations waiting for you: how many, and the tone of the most urgent. */
export interface WaitingSummary {
  count: number;
  mostUrgent: WaitingTone | null;
}

export const summarizeWaiting = (waiting: WaitingFor[]): WaitingSummary => ({ count: waiting.length, mostUrgent: mostUrgentTone(waiting) ?? null });

export const countWaiting = (conversations: Conversation[]) => conversations.filter(isWaiting).length;

/** Decisions first, since those agents are stuck until you answer; otherwise in the order given. */
export const waitingByUrgency = (conversations: Conversation[]) =>
  conversations.filter(isWaiting).sort((a, b) => urgencyOf(a) - urgencyOf(b));
