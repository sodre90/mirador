import type { Conversation, WaitingFor } from "./model.ts";
import type { RoomApproval, RoomJoiner, RoomTaskApproval } from "./rooms.ts";
import type { HeldChange } from "./sandbox.ts";

export type WaitingTone = "decision" | "failed" | "done" | "unread";

export const waitingTones: Record<WaitingFor, WaitingTone> = {
  permission: "decision",
  question: "decision",
  error: "failed",
  finished: "done",
  unread: "unread",
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

export interface WaitingConversation {
  conversationId: string;
  title: string;
  /** Still called by the default name, which the desktop app shows in its own language. */
  untitled?: true;
  workspace: string;
  tone: WaitingTone;
}

/** What the desktop app hears of the conversations waiting for you: how many, the tone of the most urgent, and which, most urgent first. */
export interface WaitingSummary {
  count: number;
  mostUrgent: WaitingTone | null;
  conversations: WaitingConversation[];
}

export function summarizeWaiting(waiting: WaitingConversation[]): WaitingSummary {
  const conversations = waiting.toSorted((a, b) => tonesByUrgency.indexOf(a.tone) - tonesByUrgency.indexOf(b.tone));
  return { count: conversations.length, mostUrgent: conversations[0]?.tone ?? null, conversations };
}

export const countWaiting = (conversations: Conversation[]) => conversations.filter(isWaiting).length;

/** What a page knows of the rooms that may wait for the person it shows them to. */
export interface RoomsWaiting {
  you: string | null;
  roomApprovals: RoomApproval[];
  roomTasksWaiting: RoomTaskApproval[];
  roomConversations: Conversation[];
  roomJoiners: RoomJoiner[];
  heldChanges: HeldChange[];
}

/** What a room waits on you for, the most pressing first: an answer an agent or a person's task is stuck on, an agent config change its sandbox holds, then someone at its door. */
export type RoomWait = "answer" | "held-change" | "door";

const mostPressingPerRoom = (waits: [string, RoomWait][]): ReadonlyMap<string, RoomWait> => new Map(waits.toReversed());

/**
 * The rooms that wait for you, each with what it waits for most: an agent's request or question for you to answer, a
 * person's task for you to allow, a change its sandbox holds, or someone at its door. Only the owner's page holds the
 * agents' conversations, whose questions the owner alone answers, and is told of held changes and of the door.
 */
export const roomsWaitingFor = ({ you, roomApprovals, roomTasksWaiting, roomConversations, roomJoiners, heldChanges }: RoomsWaiting) =>
  mostPressingPerRoom([
    ...[...roomApprovals, ...roomTasksWaiting].filter(({ approvers }) => you !== null && approvers.includes(you)).map(({ roomId }): [string, RoomWait] => [roomId, "answer"]),
    ...roomConversations.flatMap(({ roomId, waitingFor }): [string, RoomWait][] => (roomId && waitingFor === "question" ? [[roomId, "answer"]] : [])),
    ...heldChanges.flatMap(({ owner }): [string, RoomWait][] => (owner.kind === "room" ? [[owner.id, "held-change"]] : [])),
    ...roomJoiners.map(({ roomId }): [string, RoomWait] => [roomId, "door"]),
  ]);

/** Decisions first, since those agents are stuck until you answer; otherwise in the order given. */
export const waitingByUrgency = (conversations: Conversation[]) =>
  conversations.filter(isWaiting).sort((a, b) => urgencyOf(a) - urgencyOf(b));
