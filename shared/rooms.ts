import type { CanvasItem, PendingPermissionRequest, StoredEvent } from "./model.ts";
import type { PermissionPreset } from "./room-permissions.ts";
import { cutWithEllipsis } from "./text-cut.ts";
import { LINE_BREAKS, oneLine } from "./written-text.ts";

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

/** Who wrote a room's message, as agents are told and the room shows it: the machine's owner, a person by their role in the room when they wrote it, or an agent. */
export type RoomAuthorRole = "owner" | RoomRole | "agent";

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
  /** Whether a task a person other than the owner gives its agents waits for an approver to allow it before any agent is sent it. */
  peoplesTasksWait: boolean;
  createdAt: number;
}

/** Whether someone of this role may write this: anything for a member, and for a guest nothing that makes an agent take a turn. */
export const mayWriteAs = (role: RoomRole, tags: string[], threadId: string | null) => role === "member" || (tags.length === 0 && threadId === null);

/** The most a message written in a room may hold, as the host counts it: its text with the spaces around it trimmed. */
export const ROOM_MESSAGE_MOST_CHARACTERS = 20_000;

export const roomMessageLength = (text: string) => text.trim().length;

export type RoomAuthor = { personId: string } | { profileId: string };

/** How an agent's answer ended other than finishing: its turn stopped or failed, or the task was declined and never reached the agent. */
export type RoomAnswerEnd = "stopped" | "failed" | "declined";

/** Where a task of a person other than the owner stands while no agent may be sent it: waiting for an approver, or declined by one. */
export type TaskHeld = "waiting" | "declined";

export interface RoomMessage {
  id: string;
  roomId: string;
  /** Its place in the room, counting from 1. */
  seq: number;
  at: number;
  author: RoomAuthor;
  /** Only on a message of a person other than the owner: their role in the room when they wrote it. */
  authorRole?: RoomRole;
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
  /** Only on a task of a person other than the owner that no agent it asks has been sent: it waits for an approver, or one declined it. */
  taskHeld?: TaskHeld;
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

/** Whose task an agent's turn works on: the person whose message it goes back to, their role then, and how that message begins. */
export interface RoomTask {
  personId: string;
  role: RoomAuthorRole;
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
  /** Whether it reads or changes files outside the room's workspace, which "Allow for this task" doesn't reach. */
  outsideWorkspace: boolean;
  /** When it began waiting. */
  at: number;
  /** The thread of the turn it waits in; null when no room message began the turn. */
  threadId: string | null;
  task: RoomTask | null;
  approvers: string[];
}

/** A task a person other than the owner gave the room's agents, which none of them is sent until an approver allows it. */
export interface RoomTaskApproval {
  roomId: string;
  messageId: string;
  /** The agents it asks: those the message tags, or the agent of the thread it follows up in. */
  profileIds: string[];
  personId: string;
  role: RoomAuthorRole;
  /** The whole message, so the approver reads all of what the agents would be asked. */
  text: string;
  /** The room's other messages the agents it asks have not read, which they are sent with it once it is allowed, oldest first. */
  sentAlong: RoomMessageSentAlong[];
  /** When it began waiting. */
  at: number;
  approvers: string[];
}

export interface RoomMessageSentAlong {
  messageId: string;
  author: RoomAuthor;
  role: RoomAuthorRole;
  text: string;
}

export const ROOM_HISTORY_TOOL = "room_history";
export const ROOM_TAG_TOOL = "room_tag";

export const writtenByAgent = (author: RoomAuthor): author is { profileId: string } => "profileId" in author;

/** The role a message's author wrote it in: the owner's and the agents' are theirs anywhere, everyone else's the one they had in the room. */
export const authorRoleOf = ({ author, authorRole }: RoomMessage, ownerId: string | null): RoomAuthorRole => {
  if (writtenByAgent(author)) return "agent";
  return author.personId === ownerId ? "owner" : authorRole!;
};

/**
 * What a person other than the owner is told in place of the id of an agent's conversation in a room: it tells that
 * agent's pages and questions apart from the others', and names no conversation.
 */
export const agentStandIn = (roomId: string, profileId: string) => `${roomId}/${profileId}`;

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
export function taskOf(asked: RoomMessage, messagesById: Map<string, RoomMessage>, ownerId: string): RoomTask | null {
  const behind = personMessageBehind(asked, messagesById);
  const { author, text } = behind;
  if (writtenByAgent(author)) return null;
  return { personId: author.personId, role: authorRoleOf(behind, ownerId), text: cutWithEllipsis(oneLine(text), TASK_TEXT_SHOWN) };
}

/** The turns agents took on other agents' tags after this message of a person: one for each thread started on an agent's answer that goes back to it. */
export function agentTaggedTurnsAfter({ messages, threads }: RoomTimeline, personMessage: RoomMessage): number {
  const messagesById = new Map(messages.map((message) => [message.id, message]));
  return threads.filter(({ messageId }) => {
    const tagging = messagesById.get(messageId);
    return tagging !== undefined && writtenByAgent(tagging.author) && personMessageBehind(tagging, messagesById).id === personMessage.id;
  }).length;
}

/** A declined task's answer stands for a turn that never happened. */
export const isDeclined = ({ ended }: RoomMessage) => ended === "declined";

export const taskWaits = ({ taskHeld }: RoomMessage) => taskHeld === "waiting";

/** No agent reads a task an approver has not allowed, nor the line that says one was declined. */
export const keptFromAgents = (message: RoomMessage) => message.taskHeld !== undefined || isDeclined(message);

/** The pages and questions each agent's answer brought onto the room's canvas: those its agent made since its answer before. */
export function canvasItemsOfAnswers(messages: RoomMessage[], items: CanvasItem[], conversationOf: (profileId: string) => string | null | undefined): Map<string, CanvasItem[]> {
  const answers = messages.flatMap((message) => (writtenByAgent(message.author) && !isDeclined(message) ? [{ answer: message, profileId: message.author.profileId }] : []));
  return new Map(
    answers.map(({ answer, profileId }, index) => {
      const conversationId = conversationOf(profileId);
      const since = answers.slice(0, index).findLast((earlier) => earlier.profileId === profileId)?.answer.at ?? 0;
      return [answer.id, items.filter((item) => item.conversationId === conversationId && item.createdAt > since && item.createdAt <= answer.at)];
    }),
  );
}

export const ROOM_CATCH_UP_LIMIT = 50;

/** Of the messages an agent has not seen, those its catch-up shows it: the latest `ROOM_CATCH_UP_LIMIT`. */
export const catchUpShown = (unseen: RoomMessage[]) => unseen.slice(-ROOM_CATCH_UP_LIMIT);

export const ROOM_MESSAGES_HEADING = "New messages in the room, the last one for you:";

const timeOf = (at: number) => `${new Date(at).toISOString().slice(0, 16).replace("T", " ")} UTC`;

/** A message's author as an agent is told of them: the role the host knows them by, and their name. */
export interface FramedAuthor {
  role: RoomAuthorRole;
  name: string;
}

export type AuthorOf = (message: RoomMessage) => FramedAuthor;

/** The role comes first, where the host alone writes it, so that no name can pass for another role. */
const authorLine = ({ role, name }: FramedAuthor) => `[${role}] ${oneLine(name)}`;

/**
 * A message as an agent reads it: a line with its number, its author's role and name, and its time, then every line of
 * its text after `> `, so that no text written in the room can pass for the start of another message or another author.
 */
export function framedMessage(message: RoomMessage, authorOf: AuthorOf) {
  const { seq, at, text } = message;
  const lines = text.split(LINE_BREAKS).map((line) => (line ? `> ${line}` : ">"));
  return [`#${seq} ${authorLine(authorOf(message))}, ${timeOf(at)}:`, ...lines].join("\n");
}

function introduction(roomName: string, taggedBy: FramedAuthor, otherAgents: string[]) {
  return [
    `You are an attendee of the room "${oneLine(roomName)}" in Mirador, where people and AI agents write to each other.`,
    `${authorLine(taggedBy)} tagged you there.`,
    "Your final answer of each turn is posted to the room for everyone in it to read, so write it to them.",
    otherAgents.length > 0 ? `The room's other agents are ${otherAgents.map(oneLine).join(", ")}.` : "No other agent is in the room yet.",
    `To pass work on to another agent, name it with the ${ROOM_TAG_TOOL} tool before you end your turn: your final answer then tags it, and it answers in a thread of its own.`,
    `Each time, you are sent only the messages you have not seen yet; the ${ROOM_HISTORY_TOOL} tool reads older ones.`,
    'Each message comes as a line with its number, its author\'s role in brackets, their name and the time, then its text, every line of it after "> ". Mirador writes the role: [owner] is the person whose machine you work on and who owns the room, [member] and [guest] are people the owner let into the room, and [agent] is one of the room\'s AI agents.',
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
  authorOf,
  firstInRoom,
  otherAgents,
}: {
  roomName: string;
  unseen: RoomMessage[];
  authorOf: AuthorOf;
  firstInRoom: boolean;
  otherAgents: string[];
}) {
  const shown = catchUpShown(unseen);
  const leftOut = unseen.length - shown.length;
  const asked = unseen.at(-1)!;
  return [
    ...(firstInRoom ? introduction(roomName, authorOf(asked), otherAgents) : []),
    ROOM_MESSAGES_HEADING,
    ...(leftOut > 0 ? [`(${leftOut} earlier messages left out)`] : []),
    ...shown.map((message) => framedMessage(message, authorOf)),
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
export function roomHistory(sent: RoomMessage[], { before, beforeTime, search, limit = ROOM_HISTORY_COUNT }: RoomHistoryQuery, authorOf: AuthorOf) {
  const searched = search?.trim().toLowerCase();
  const matching = sent.filter(
    (message) => (before === undefined || message.seq < before) && (beforeTime === undefined || message.at < beforeTime) && (!searched || message.text.toLowerCase().includes(searched)),
  );
  if (matching.length === 0) return "No message you were sent in the room matches.";
  const latest = matching.slice(-Math.min(Math.max(limit, 1), ROOM_HISTORY_MOST)).toReversed();
  const shown = takeWhileFitting(
    latest.map((message) => framedMessage(message, authorOf)),
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
