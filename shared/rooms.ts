import type { StoredEvent } from "./model.ts";

/** An agent of a room, by its profile, and the conversation it works on the room's tasks in, made the first time it is tagged. */
export interface RoomAgent {
  profileId: string;
  conversationId: string | null;
}

/** Where people of this machine and its agents write together; nothing reaches an agent until a message tags it. */
export interface Room {
  id: string;
  name: string;
  /** The workspace its agents work in. */
  workspaceId: string;
  agents: RoomAgent[];
  createdAt: number;
}

export type RoomAuthor = { personId: string } | { profileId: string };

export type RoomAnswerEnd = "stopped" | "failed";

export interface RoomMessage {
  id: string;
  roomId: string;
  /** Its place in the room, counting from 1. */
  seq: number;
  at: number;
  author: RoomAuthor;
  text: string;
  /** The room's agents it tags, by profile id. */
  tags: string[];
  /** The thread it was written in: a follow-up, or an agent's answer. */
  threadId: string | null;
  /** Only on an agent's answer: the message it answers. */
  answers?: string;
  /** Only on the answer of a turn that did not finish. */
  ended?: RoomAnswerEnd;
}

/** One task of one agent: the message that tagged it, then the follow-ups written to it there. */
export interface RoomThread {
  id: string;
  roomId: string;
  messageId: string;
  profileId: string;
}

export interface RoomTimeline {
  messages: RoomMessage[];
  threads: RoomThread[];
}

export const writtenByAgent = (author: RoomAuthor): author is { profileId: string } => "profileId" in author;

/** The messages the room shows itself: those written in it and the agents' answers; follow-ups show in their threads. */
export const shownInRoom = (message: RoomMessage) => message.threadId === null || message.answers !== undefined;

/** A thread's messages, the one that started it first. */
export const messagesOfThread = (timeline: RoomTimeline, thread: RoomThread) =>
  timeline.messages.filter(({ id, threadId }) => id === thread.messageId || threadId === thread.id);

/** The messages in the room or in its threads that no answer of their agent followed yet, oldest first, each with that agent. */
export function unanswered({ messages, threads }: RoomTimeline): { message: RoomMessage; thread: RoomThread }[] {
  const answered = new Set(messages.flatMap(({ answers }) => (answers === undefined ? [] : [answers])));
  const threadById = new Map(threads.map((thread) => [thread.id, thread]));
  return messages
    .filter((message) => !writtenByAgent(message.author) && !answered.has(message.id))
    .flatMap((message) => {
      if (message.threadId !== null) {
        const thread = threadById.get(message.threadId);
        return thread ? [{ message, thread }] : [];
      }
      return threads.filter(({ messageId }) => messageId === message.id).map((thread) => ({ message, thread }));
    });
}

/** The events of the agent's turn on a room message: those after the message reached it, up to the next room message that did. */
export function eventsAnswering(events: StoredEvent[], messageId: string): StoredEvent[] {
  const reached = events.findIndex(({ event }) => event.type === "user-message" && event.roomMessageId === messageId);
  if (reached === -1) return [];
  const after = events.slice(reached + 1);
  const next = after.findIndex(({ event }) => event.type === "user-message" && event.roomMessageId !== undefined);
  return next === -1 ? after : after.slice(0, next);
}

export const ROOM_CATCH_UP_LIMIT = 50;
export const ROOM_MESSAGES_HEADING = "New messages in the room, the last one for you:";

const timeOf = (at: number) => `${new Date(at).toISOString().slice(0, 16).replace("T", " ")} UTC`;

function introduction(roomName: string, taggedBy: string) {
  return [
    `You are an attendee of the room "${roomName}" in Mirador, where people and AI agents write to each other.`,
    `${taggedBy} tagged you there.`,
    "Your final answer of each turn is posted to the room for everyone in it to read, so write it to them.",
    "",
  ];
}

/**
 * What goes to an agent when a message asks something of it: the room's messages it has not seen, the latest
 * `ROOM_CATCH_UP_LIMIT` of them, each with its author and time, ending with the one it is asked; its first prompt in the
 * room begins by telling it where it is.
 */
export function catchUpPrompt({
  roomName,
  unseen,
  nameOf,
  firstInRoom,
}: {
  roomName: string;
  unseen: RoomMessage[];
  nameOf: (author: RoomAuthor) => string;
  firstInRoom: boolean;
}) {
  const shown = unseen.slice(-ROOM_CATCH_UP_LIMIT);
  const leftOut = unseen.length - shown.length;
  const asked = unseen.at(-1)!;
  return [
    ...(firstInRoom ? introduction(roomName, nameOf(asked.author)) : []),
    ROOM_MESSAGES_HEADING,
    ...(leftOut > 0 ? [`(${leftOut} earlier messages left out)`] : []),
    ...shown.map(({ at, author, text }) => `[${timeOf(at)}] ${nameOf(author)}: ${text}`),
  ].join("\n");
}
