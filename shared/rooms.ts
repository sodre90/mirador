import type { CanvasItem, PendingPermissionRequest, StoredEvent } from "./model.ts";
import type { PermissionPreset } from "./room-permissions.ts";
import { cutWithEllipsis } from "./text-cut.ts";

/** An agent of a room, by its profile, and the conversation it works on the room's tasks in, made the first time it is tagged. */
export interface RoomAgent {
  profileId: string;
  conversationId: string | null;
}

/**
 * What a person other than the machine's owner may do in a room, which the owner owns: a member writes, tags its agents
 * and follows up in their threads; a guest only writes.
 */
export type RoomRole = "member" | "guest";

export const ROOM_ROLES: RoomRole[] = ["member", "guest"];

export const isRoomRole = (value: unknown): value is RoomRole => ROOM_ROLES.includes(value as RoomRole);

/** A person the owner let into a room, other than the owner. */
export interface RoomPerson {
  personId: string;
  role: RoomRole;
}

/** Where people of this machine and its agents write together; nothing reaches an agent until a message tags it. */
export interface Room {
  id: string;
  name: string;
  /** The workspace its agents work in. */
  workspaceId: string;
  agents: RoomAgent[];
  /** What its agents may do without asking. */
  permissions: PermissionPreset;
  /** The people in it besides the owner; a person who is not the owner sees only themselves here. */
  people: RoomPerson[];
  createdAt: number;
}

/** Whether someone of this role may write this: anything for a member, and for a guest nothing that makes an agent take a turn. */
export const mayWriteAs = (role: RoomRole, tags: string[], threadId: string | null) => role === "member" || (tags.length === 0 && threadId === null);

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
  /** Only on an agent's answer whose tags were dropped, as agents had tagged each other too often since a person wrote: the agents it named. */
  tagsDropped?: string[];
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

/** Whose task an agent's turn works on: the person whose message it goes back to, with how that message begins. */
export interface RoomTask {
  personId: string;
  text: string;
}

/** A permission request an agent of the room waits on, for the people the host says may answer it. */
export interface RoomApproval {
  roomId: string;
  conversationId: string;
  profileId: string;
  request: PendingPermissionRequest;
  /** The file it would change, as the agent names it; null for a tool that names none. */
  file: string | null;
  /** When it began waiting. */
  at: number;
  /** The thread of the turn it waits in; null when no room message began the turn. */
  threadId: string | null;
  task: RoomTask | null;
  approvers: string[];
}

export const ROOM_HISTORY_TOOL = "room_history";
export const ROOM_TAG_TOOL = "room_tag";

export const writtenByAgent = (author: RoomAuthor): author is { profileId: string } => "profileId" in author;

/** The messages the room shows itself: those written in it and the agents' answers; follow-ups show in their threads. */
export const shownInRoom = (message: RoomMessage) => message.threadId === null || message.answers !== undefined;

/** A room's canvas holds its agents' pages and questions; plugins' items stay with the conversation that made them. */
export const shownOnRoomCanvas = (item: CanvasItem) => item.kind !== "plugin";

const isFollowUp = (message: RoomMessage) => message.threadId !== null && message.answers === undefined;

/** A thread's messages, the one that started it first. */
export const messagesOfThread = (timeline: RoomTimeline, thread: RoomThread) =>
  timeline.messages.filter(({ id, threadId }) => id === thread.messageId || threadId === thread.id);

/** What the thread's agent was asked there: the message that started the thread, an agent's answer too, then the follow-ups. */
export const askedInThread = (timeline: RoomTimeline, thread: RoomThread) =>
  messagesOfThread(timeline, thread).filter((message) => message.id === thread.messageId || isFollowUp(message));

/** The messages in the room or in its threads that the agent of their thread has not answered yet, oldest first, each with that thread. */
export function unanswered({ messages, threads }: RoomTimeline): { message: RoomMessage; thread: RoomThread }[] {
  const answered = new Set(messages.flatMap(({ answers, author }) => (answers !== undefined && writtenByAgent(author) ? [`${answers} ${author.profileId}`] : [])));
  const threadById = new Map(threads.map((thread) => [thread.id, thread]));
  const threadsAsked = (message: RoomMessage) =>
    isFollowUp(message) ? [threadById.get(message.threadId!)].filter((thread) => thread !== undefined) : threads.filter(({ messageId }) => messageId === message.id);
  return messages.flatMap((message) =>
    threadsAsked(message)
      .filter(({ profileId }) => !answered.has(`${message.id} ${profileId}`))
      .map((thread) => ({ message, thread })),
  );
}

const roomMessageReaching = ({ event }: StoredEvent) => (event.type === "user-message" ? event.roomMessageId : undefined);

/**
 * The events of the agent's turns on a room message: those after the message first reached it, up to the next room
 * message that did, and again after each later message of the conversation that went on with it, such as the answer to
 * a question its turn asked.
 */
export function eventsAnswering(events: StoredEvent[], messageId: string): StoredEvent[] {
  const stretches = events.reduce<{ messageId: string; events: StoredEvent[] }[]>((found, stored) => {
    const reaching = roomMessageReaching(stored);
    if (reaching !== undefined) return [...found, { messageId: reaching, events: [stored] }];
    found.at(-1)?.events.push(stored);
    return found;
  }, []);
  return stretches
    .filter((stretch) => stretch.messageId === messageId)
    .flatMap((stretch) => stretch.events)
    .slice(1);
}

/** The room message the agent's turn under way at `at` answers: the last that reached it by then. */
export const roomMessageAnsweredAt = (userMessages: StoredEvent[], at: number) =>
  userMessages
    .filter((stored) => stored.at <= at)
    .map(roomMessageReaching)
    .findLast((messageId) => messageId !== undefined);

/** At most this many turns of agents that other agents tagged may follow a message of a person. */
export const AGENT_TAGGED_TURNS_AFTER_A_PERSON = 8;

/** The message of a person that a chain of agents' answers goes back to. */
export function personMessageBehind(message: RoomMessage, messagesById: Map<string, RoomMessage>): RoomMessage {
  const answered = message.answers === undefined ? undefined : messagesById.get(message.answers);
  return writtenByAgent(message.author) && answered ? personMessageBehind(answered, messagesById) : message;
}

const TASK_TEXT_SHOWN = 80;

/** The task a turn on this message works on: the person behind a chain of agents' answers is the one it is for. */
export function taskOf(asked: RoomMessage, messagesById: Map<string, RoomMessage>): RoomTask | null {
  const { author, text } = personMessageBehind(asked, messagesById);
  if (writtenByAgent(author)) return null;
  return { personId: author.personId, text: cutWithEllipsis(text.replace(/\s+/g, " ").trim(), TASK_TEXT_SHOWN) };
}

/** The turns agents took on other agents' tags after this message of a person: one for each thread started on an agent's answer that goes back to it. */
export function agentTaggedTurnsAfter({ messages, threads }: RoomTimeline, personMessage: RoomMessage): number {
  const messagesById = new Map(messages.map((message) => [message.id, message]));
  return threads.filter(({ messageId }) => {
    const tagging = messagesById.get(messageId);
    return tagging !== undefined && writtenByAgent(tagging.author) && personMessageBehind(tagging, messagesById).id === personMessage.id;
  }).length;
}

/** The pages and questions each agent's answer brought onto the room's canvas: those its agent made since its answer before. */
export function canvasItemsOfAnswers(messages: RoomMessage[], items: CanvasItem[], conversationOf: (profileId: string) => string | null | undefined): Map<string, CanvasItem[]> {
  return new Map(
    messages.flatMap((answer, index) => {
      const { author } = answer;
      if (!writtenByAgent(author)) return [];
      const conversationId = conversationOf(author.profileId);
      const since = messages.slice(0, index).findLast((earlier) => writtenByAgent(earlier.author) && earlier.author.profileId === author.profileId)?.at ?? 0;
      return [[answer.id, items.filter((item) => item.conversationId === conversationId && item.createdAt > since && item.createdAt <= answer.at)]];
    }),
  );
}

export const ROOM_CATCH_UP_LIMIT = 50;
export const ROOM_MESSAGES_HEADING = "New messages in the room, the last one for you:";

const timeOf = (at: number) => `${new Date(at).toISOString().slice(0, 16).replace("T", " ")} UTC`;

/** On one line, so that a name can't start a line of a prompt as if it were a message's. */
const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

const LINE_BREAKS = /\r\n?|[\n\v\f\u0085\u2028\u2029]/;

/**
 * A message as an agent reads it: a line with its number, author and time, then every line of its text after `> `, so
 * that no text written in the room can pass for the start of another message.
 */
export function framedMessage({ seq, at, author, text }: RoomMessage, nameOf: (author: RoomAuthor) => string) {
  const lines = text.split(LINE_BREAKS).map((line) => (line ? `> ${line}` : ">"));
  return [`#${seq} ${oneLine(nameOf(author))}, ${timeOf(at)}:`, ...lines].join("\n");
}

function introduction(roomName: string, taggedBy: string, otherAgents: string[]) {
  return [
    `You are an attendee of the room "${oneLine(roomName)}" in Mirador, where people and AI agents write to each other.`,
    `${oneLine(taggedBy)} tagged you there.`,
    "Your final answer of each turn is posted to the room for everyone in it to read, so write it to them.",
    otherAgents.length > 0 ? `The room's other agents are ${otherAgents.map(oneLine).join(", ")}.` : "No other agent is in the room yet.",
    `To pass work on to another agent, name it with the ${ROOM_TAG_TOOL} tool before you end your turn: your final answer then tags it, and it answers in a thread of its own.`,
    `Each time, you are sent only the messages you have not seen yet; the ${ROOM_HISTORY_TOOL} tool reads older ones.`,
    'Each message comes as a line with its number, author and time, then its text, every line of it after "> ".',
    "",
  ];
}

/**
 * What goes to an agent when a message asks something of it: the room's messages it has not seen, the latest
 * `ROOM_CATCH_UP_LIMIT` of them, each framed with its number, author and time, ending with the one it is asked; its
 * first prompt in the room begins by telling it where it is, who else is there and how to reach them.
 */
export function catchUpPrompt({
  roomName,
  unseen,
  nameOf,
  firstInRoom,
  otherAgents,
}: {
  roomName: string;
  unseen: RoomMessage[];
  nameOf: (author: RoomAuthor) => string;
  firstInRoom: boolean;
  otherAgents: string[];
}) {
  const shown = unseen.slice(-ROOM_CATCH_UP_LIMIT);
  const leftOut = unseen.length - shown.length;
  const asked = unseen.at(-1)!;
  return [
    ...(firstInRoom ? introduction(roomName, nameOf(asked.author), otherAgents) : []),
    ROOM_MESSAGES_HEADING,
    ...(leftOut > 0 ? [`(${leftOut} earlier messages left out)`] : []),
    ...shown.map((message) => framedMessage(message, nameOf)),
  ].join("\n");
}

export const ROOM_HISTORY_COUNT = 20;
export const ROOM_HISTORY_MOST = 50;
/** Long answers add up: the read-back holds the latest messages that fit in this many characters, at least one. */
export const ROOM_HISTORY_CHARACTERS = 40_000;

export interface RoomHistoryQuery {
  /** Only messages before the one of this number. */
  before?: number;
  /** Only messages written before this time. */
  beforeTime?: number;
  /** Only messages whose text holds this, in any case. */
  search?: string;
  /** How many of the latest messages that match, at most. */
  limit?: number;
}

const takeWhileFitting = (framed: string[], characters: number) =>
  framed.filter((_, index) => index === 0 || framed.slice(0, index + 1).reduce((total, each) => total + each.length, 0) <= characters);

/** Older messages of the room for an agent that asks: the latest of those it was sent that match, oldest first, framed as its catch-ups are. */
export function roomHistory(sent: RoomMessage[], { before, beforeTime, search, limit = ROOM_HISTORY_COUNT }: RoomHistoryQuery, nameOf: (author: RoomAuthor) => string) {
  const searched = search?.trim().toLowerCase();
  const matching = sent.filter(
    (message) => (before === undefined || message.seq < before) && (beforeTime === undefined || message.at < beforeTime) && (!searched || message.text.toLowerCase().includes(searched)),
  );
  if (matching.length === 0) return "No message you were sent in the room matches.";
  const latest = matching.slice(-Math.min(Math.max(limit, 1), ROOM_HISTORY_MOST)).toReversed();
  const shown = takeWhileFitting(
    latest.map((message) => framedMessage(message, nameOf)),
    ROOM_HISTORY_CHARACTERS,
  );
  const earlier = matching.length - shown.length;
  const oldestShown = latest[shown.length - 1]!;
  const earlierLine = `${earlier} earlier ${earlier === 1 ? "message matches" : "messages match"} too: ask again with before ${oldestShown.seq}.`;
  return [...(earlier > 0 ? [earlierLine] : []), ...shown.toReversed()].join("\n");
}

/** A time as the room shows them, in UTC, such as 2026-11-20 09:00, or with a zone of its own; null when it reads as none. */
export function roomTimeOf(written: string): number | null {
  const trimmed = written.trim().replace(/\s*UTC$/i, "");
  const local = /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? `${trimmed}T00:00` : trimmed.replace(" ", "T");
  const at = Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(local) ? local : `${local}Z`);
  return Number.isNaN(at) ? null : at;
}
