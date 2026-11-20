import { lstatSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { HostProblemError } from "../shared/host-problems.ts";
import { replyOf } from "../shared/last-words.ts";
import type { CanvasItem, Conversation, Launch } from "../shared/model.ts";
import {
  allowedByPreset,
  isPermissionPreset,
  taskAllowanceOf,
  type AskedPermission,
  type PermissionPreset,
  type RoomApprovalAnswer,
} from "../shared/room-permissions.ts";
import {
  AGENT_TAGGED_TURNS_AFTER_A_PERSON,
  agentTaggedTurnsAfter,
  catchUpPrompt,
  isRoomRole,
  mayWriteAs,
  personMessageBehind,
  roomHistory,
  shownOnRoomCanvas,
  taskOf,
  writtenByAgent,
  type Room,
  type RoomApproval,
  type RoomAuthor,
  type RoomHistoryQuery,
  type RoomMessage,
  type RoomRole,
  type RoomThread,
  type RoomTimeline,
} from "../shared/rooms.ts";
import type { RoomPermissionRules, WaitingPermission } from "./conversations.ts";
import type { Hub } from "./hub.ts";
import type { Store } from "./store.ts";
import type { SystemNotifications } from "./system-notifications.ts";

/** What a room needs of the conversations its agents work in. */
export interface RoomSessions {
  startInRoom(roomId: string, workspaceId: string, launch: Launch, title: string): Conversation;
  /** `authorId` is the person who wrote the message; none when an agent's answer tagged the agent. */
  send(conversationId: string, text: string, imageIds: string[], options: { authorId?: string; afterTurn: boolean; roomMessageId: string }): Promise<void>;
  delete(conversationId: string): void;
  waitingPermissions(conversationId: string): WaitingPermission[];
  answerPermission(conversationId: string, permissionId: string, allowed: boolean): void;
  followRoomPreset(conversationId: string): Promise<void>;
}

/** What came of an agent naming agents to tag in its answer: those it will tag, and those it can't, by name. */
export interface TagsNamed {
  tagged: string[];
  itself: boolean;
  unknown: string[];
  /** The other agents of the room, by name, for an agent that named one wrong. */
  others: string[];
}

const OWNER_WITHOUT_A_NAME = "Owner";
const PERSON_WITHOUT_A_NAME = "A person without a name";
const AGENT_GONE = "An agent no longer in the room";

const distinct = (ids: string[]) => [...new Set(ids)];
const hasAgent = (room: Room, profileId: string) => room.agents.some((agent) => agent.profileId === profileId);
const sameName = (named: string, name: string) => named.trim().replace(/^@/, "").toLowerCase() === name.toLowerCase();

const leadsOut = (relativePath: string) => relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath);

function realPathOrNull(path: string) {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

/** A link on the way can lead out of the workspace, so the real place of the nearest existing entry decides; null where none can be read. */
function realPlaceOf(path: string): string | null {
  try {
    lstatSync(path);
  } catch {
    return dirname(path) === path ? null : realPlaceOf(dirname(path));
  }
  return realPathOrNull(path);
}

/**
 * The rooms of this machine: their messages go to every page that shows the room and cost no tokens, until one tags an
 * agent or follows up in its thread. Then the agent's conversation in the room is sent what it has not seen of the room,
 * and the final answer of the turn that takes is posted to the room, in the thread. An agent's answer can tag other agents
 * of the room as a person's message does, a few turns at most after a person last wrote.
 *
 * What the agents may do without asking is the room's permission preset; whatever else they ask waits for an approver,
 * who can let the same kind of request through for the rest of the task's turn.
 */
export class RoomService implements RoomPermissionRules {
  /** The agents each conversation's answer tags, named while its turn on a room message runs. */
  private readonly tagsForAnswers = new Map<string, { answering: string; profileIds: string[] }>();
  /** What an approver let through for the rest of each conversation's turn, by `taskAllowanceOf`. */
  private readonly allowedForTurn = new Map<string, Set<string>>();

  constructor(
    private readonly store: Store,
    private readonly hub: Hub,
    private readonly sessions: RoomSessions,
    private readonly notifications: Pick<SystemNotifications, "notify">,
  ) {}

  list(): Room[] {
    return this.store.listRooms();
  }

  create(name: string, workspaceId: string, profileIds: string[], permissions: PermissionPreset): Room {
    if (!this.store.findWorkspace(workspaceId)) throw new HostProblemError({ code: "workspace-gone" });
    const room = {
      id: crypto.randomUUID(),
      name: this.roomName(name),
      workspaceId,
      agents: this.existingProfiles(profileIds).map((profileId) => ({ profileId, conversationId: null })),
      permissions: knownPreset(permissions),
      people: [],
      createdAt: Date.now(),
    };
    this.store.insertRoom(room);
    return this.publish(room.id);
  }

  rename(roomId: string, name: string) {
    this.existingRoom(roomId);
    this.store.renameRoom(roomId, this.roomName(name));
    this.publish(roomId);
  }

  /** An agent taken out of the room goes with its conversation there; one added later starts afresh. */
  setAgents(roomId: string, profileIds: string[]) {
    const staying = new Set(this.existingProfiles(profileIds));
    this.existingRoom(roomId)
      .agents.filter(({ profileId, conversationId }) => !staying.has(profileId) && conversationId !== null)
      .forEach(({ conversationId }) => this.sessions.delete(conversationId!));
    this.store.setRoomAgents(roomId, [...staying]);
    this.publish(roomId);
    this.waitingChanged(roomId);
  }

  /** Holds from the agents' next requests on; an agent's open session switches to the preset's mode at once. */
  setPermissions(roomId: string, permissions: PermissionPreset) {
    const room = this.existingRoom(roomId);
    this.store.setRoomPermissions(roomId, knownPreset(permissions));
    this.publish(roomId);
    room.agents.forEach(({ conversationId }) => conversationId && void this.sessions.followRoomPreset(conversationId).catch(() => {}));
  }

  /** Lets the person into the room with the role, or gives them that role there, from their next message on. */
  setPersonRole(roomId: string, personId: string, role: RoomRole) {
    this.existingRoom(roomId);
    if (!isRoomRole(role)) throw new Error(`There is no room role "${role}".`);
    if (personId === this.store.ownerId() || !this.store.listPeople().some(({ id }) => id === personId)) throw new HostProblemError({ code: "room-person-unknown" });
    this.store.setRoomPersonRole(roomId, personId, role);
    this.peopleChanged(roomId);
  }

  /** The person's open pages lose the room at once. */
  removePerson(roomId: string, personId: string) {
    this.existingRoom(roomId);
    this.store.removeRoomPerson(roomId, personId);
    this.peopleChanged(roomId);
  }

  delete(roomId: string) {
    const room = this.existingRoom(roomId);
    room.agents.forEach(({ conversationId }) => conversationId && this.sessions.delete(conversationId));
    this.store.deleteRoom(roomId);
    this.hub.broadcast({ type: "room.deleted", roomId });
    if (room.people.length > 0) this.peopleListed();
  }

  /** Whether the room's preset, or what an approver let through for the rest of the turn, lets the request through without asking. */
  allowsByItself(conversationId: string, asked: AskedPermission): boolean {
    const room = this.roomOf(conversationId);
    if (!room) return false;
    return this.allowedForTurn.get(conversationId)?.has(taskAllowanceOf(asked)) === true || allowedByPreset(room.permissions, asked, (path) => this.insideWorkspace(room, path));
  }

  waitingChanged(roomId: string) {
    this.hub.broadcast({ type: "room.approvals", roomId, approvals: this.approvals(roomId) });
  }

  /** The requests the room's agents wait on, oldest first. */
  approvals(roomId: string): RoomApproval[] {
    const room = this.store.findRoom(roomId);
    if (!room) return [];
    const messagesById = new Map(this.store.listRoomMessages(roomId).map((message) => [message.id, message]));
    return room.agents
      .flatMap(({ profileId, conversationId }) =>
        conversationId ? this.sessions.waitingPermissions(conversationId).map((waiting) => this.approvalOf(room, profileId, conversationId, waiting, messagesById)) : [],
      )
      .toSorted((a, b) => a.at - b.at);
  }

  allApprovals(): RoomApproval[] {
    return this.list().flatMap(({ id }) => this.approvals(id));
  }

  /** Allowing for the task lets the same kind of request through until the turn ends, the ones already waiting in it too. */
  approve(conversationId: string, permissionId: string, answer: RoomApprovalAnswer, personId: string) {
    const room = this.roomOf(conversationId);
    if (!room) throw new HostProblemError({ code: "room-gone" });
    this.assertMayApprove(room, personId);
    const waiting = this.sessions.waitingPermissions(conversationId).find(({ request }) => request.permissionId === permissionId);
    if (!waiting) throw new HostProblemError({ code: "permission-no-longer-pending" });
    if (answer === "allow-for-task") this.allowForTurn(conversationId, waiting.asked);
    else this.sessions.answerPermission(conversationId, permissionId, answer === "allow");
  }

  /** Who may answer a room's agents' requests, on the room's thread view as on its strip. */
  assertMayApproveIn(conversationId: string, personId: string) {
    const room = this.roomOf(conversationId);
    if (room) this.assertMayApprove(room, personId);
  }

  timeline(roomId: string): RoomTimeline {
    this.existingRoom(roomId);
    return { messages: this.store.listRoomMessages(roomId), threads: this.store.listRoomThreads(roomId) };
  }

  /** The pages and questions the room's agents made in their conversations there, oldest first. */
  canvas(roomId: string): CanvasItem[] {
    return this.existingRoom(roomId)
      .agents.flatMap(({ conversationId }) => (conversationId ? this.store.listCanvasItems(conversationId) : []))
      .filter(shownOnRoomCanvas)
      .toSorted((a, b) => a.createdAt - b.createdAt);
  }

  /**
   * A person's message, in the room or as a follow-up in a thread. Each agent it tags gets a thread of its own for it,
   * and with the thread's agent of a follow-up, is sent what it has missed of the room.
   */
  write(roomId: string, personId: string, text: string, tags: string[], threadId: string | null): RoomMessage {
    const room = this.existingRoom(roomId);
    this.assertMayWrite(room, personId, tags, threadId);
    const tagged = distinct(tags);
    const thread = threadId === null ? null : this.followedUp(room, threadId, tagged);
    if (tagged.some((profileId) => !this.answers(room, profileId))) throw new HostProblemError({ code: "room-message-misaddressed" });
    const message = this.store.appendRoomMessage({ id: crypto.randomUUID(), roomId, at: Date.now(), author: { personId }, text: text.trim(), tags: tagged, threadId });
    this.post(message, tagged);
    (thread ? [thread.profileId] : tagged).forEach((profileId) => this.ask(room, profileId, message, personId));
    return message;
  }

  /**
   * Posts the final answer of the agent's turn to the room, in the thread of the message the turn answers. It takes the
   * place of an answer of the same agent to that message whose turn did not finish, as a turn that went on from there
   * finished it. A finished answer tags the agents the turn named, unless agents already took too many turns on each
   * other's tags since a person wrote: then it names them as dropped.
   */
  turnEnded(conversationId: string, turnSeq: number) {
    this.allowedForTurn.delete(conversationId);
    const conversation = this.store.findConversation(conversationId);
    if (!conversation?.roomId || conversation.profileId === null) return;
    const room = this.store.findRoom(conversation.roomId);
    const asked = this.askedIn(conversationId, turnSeq);
    const thread = asked && this.threadOf(asked, conversation.profileId);
    if (!room || !asked || !thread) return;
    const reply = replyOf(this.store.listEventsFrom(conversationId, turnSeq));
    const finished = reply.ended === "finished";
    const named = finished ? this.takeTagsFor(conversationId, asked.id).filter((profileId) => this.answers(room, profileId)) : [];
    const passedOn = this.agentsMayGoOn(room.id, asked, named.length) ? named : [];
    const answer = {
      roomId: room.id,
      at: Date.now(),
      author: { profileId: conversation.profileId },
      text: reply.text ?? "",
      tags: passedOn,
      threadId: thread.id,
      answers: asked.id,
      ...(reply.ended !== "finished" && { ended: reply.ended }),
      ...(passedOn.length < named.length && { tagsDropped: named }),
    };
    const unfinished = this.unfinishedAnswer(asked, conversation.profileId);
    const posted = unfinished ? this.store.rewriteRoomMessage({ ...answer, id: unfinished.id }) : this.store.appendRoomMessage({ ...answer, id: crypto.randomUUID() });
    this.post(posted, passedOn);
    passedOn.forEach((profileId) => this.ask(room, profileId, posted, undefined));
    if (finished && this.writtenByAnApprover(room, asked)) this.notifications.notify(conversationId, { kind: "finished" });
  }

  /**
   * The room_tag tool: the agents of the room, by name, that the caller's final answer of the turn under way tags; they
   * replace those it named before in that turn. Null for a conversation that is no agent's in a room.
   */
  nameTagsForAnswer(conversationId: string, names: string[]): TagsNamed | null {
    const conversation = this.store.findConversation(conversationId);
    const room = conversation?.roomId ? this.store.findRoom(conversation.roomId) : undefined;
    const answering = this.askedIn(conversationId, Number.MAX_SAFE_INTEGER);
    if (!conversation || !room || !answering) return null;
    const others = room.agents.filter(({ profileId }) => profileId !== conversation.profileId && this.answers(room, profileId)).map(({ profileId }) => this.store.findProfile(profileId)!);
    const ownName = conversation.profileId === null ? undefined : this.store.findProfile(conversation.profileId)?.name;
    const itself = ownName !== undefined && names.some((named) => sameName(named, ownName));
    const tagged = others.filter(({ name }) => names.some((named) => sameName(named, name)));
    const unknown = names.filter((named) => !(ownName !== undefined && sameName(named, ownName)) && !others.some(({ name }) => sameName(named, name)));
    this.tagsForAnswers.set(conversationId, { answering: answering.id, profileIds: tagged.map(({ id }) => id) });
    return { tagged: tagged.map(({ name }) => name), itself, unknown, others: others.map(({ name }) => name) };
  }

  /** The room_history tool: older messages of the room the caller was sent, framed as its catch-ups. Null for a conversation that is no agent's in a room. */
  readBack(conversationId: string, query: RoomHistoryQuery): string | null {
    const conversation = this.store.findConversation(conversationId);
    if (!conversation?.roomId || conversation.profileId === null || !this.store.findRoom(conversation.roomId)) return null;
    const sent = this.store.listRoomMessagesBetween(conversation.roomId, 0, this.store.roomSeenThrough(conversation.roomId, conversation.profileId));
    return roomHistory(sent, query, (author) => this.nameOf(author));
  }

  private approvalOf(room: Room, profileId: string, conversationId: string, { request, asked: { toolKind, paths }, at }: WaitingPermission, messagesById: Map<string, RoomMessage>): RoomApproval {
    const asked = this.askedIn(conversationId, Number.MAX_SAFE_INTEGER);
    return {
      roomId: room.id,
      conversationId,
      profileId,
      request,
      file: toolKind === "execute" ? null : (paths[0] ?? null),
      at,
      threadId: (asked && this.threadOf(asked, profileId)?.id) ?? null,
      task: asked ? taskOf(asked, messagesById) : null,
      approvers: this.approversOf(room),
    };
  }

  /** Today the owner alone answers what a room's agents ask. */
  private approversOf(_room: Room) {
    return [this.store.ownerId()];
  }

  private assertMayApprove(room: Room, personId: string) {
    if (!this.approversOf(room).includes(personId)) throw new HostProblemError({ code: "room-approval-not-yours" });
  }

  /** The owner writes anything in every room; anyone else as their role there lets them, and nothing in a room they are not in. */
  private assertMayWrite(room: Room, personId: string, tags: string[], threadId: string | null) {
    if (personId === this.store.ownerId()) return;
    const role = room.people.find((person) => person.personId === personId)?.role;
    if (!role) throw new HostProblemError({ code: "room-gone" });
    if (!mayWriteAs(role, tags, threadId)) throw new HostProblemError({ code: "room-guests-only-write" });
  }

  /** Someone waits for the answer: an approver who tagged the agent, or followed up in its thread. */
  private writtenByAnApprover(room: Room, asked: RoomMessage) {
    return !writtenByAgent(asked.author) && this.approversOf(room).includes(asked.author.personId);
  }

  private allowForTurn(conversationId: string, asked: AskedPermission) {
    const allowance = taskAllowanceOf(asked);
    this.allowedForTurn.set(conversationId, new Set([...(this.allowedForTurn.get(conversationId) ?? []), allowance]));
    this.sessions
      .waitingPermissions(conversationId)
      .filter((waiting) => taskAllowanceOf(waiting.asked) === allowance)
      .forEach(({ request }) => this.sessions.answerPermission(conversationId, request.permissionId, true));
  }

  private roomOf(conversationId: string) {
    const roomId = this.store.findConversation(conversationId)?.roomId;
    return roomId ? this.store.findRoom(roomId) : undefined;
  }

  private insideWorkspace(room: Room, path: string) {
    const workspace = this.store.findWorkspace(room.workspaceId);
    const root = workspace ? realPathOrNull(workspace.path) : null;
    const place = workspace ? realPlaceOf(resolve(workspace.path, path)) : null;
    return root !== null && place !== null && !leadsOut(relative(root, place));
  }

  private ask(room: Room, profileId: string, message: RoomMessage, personId: string | undefined) {
    const agent = room.agents.find((each) => each.profileId === profileId)!;
    const conversationId = agent.conversationId ?? this.startSession(room, profileId);
    const unseen = this.store
      .listRoomMessagesBetween(room.id, this.store.roomSeenThrough(room.id, profileId), message.seq)
      .filter(({ author }) => !(writtenByAgent(author) && author.profileId === profileId));
    const prompt = catchUpPrompt({
      roomName: room.name,
      unseen,
      nameOf: (author) => this.nameOf(author),
      firstInRoom: agent.conversationId === null,
      otherAgents: this.otherAgentNames(room, profileId),
    });
    this.store.markRoomSeen(room.id, profileId, message.seq);
    this.sessions.send(conversationId, prompt, [], { authorId: personId, afterTurn: true, roomMessageId: message.id }).catch(() => {});
  }

  /** The message goes to every page that shows the room, with a thread for each agent it tags. */
  private post(message: RoomMessage, tagged: string[]) {
    const threads = tagged.map((profileId) => ({ id: crypto.randomUUID(), roomId: message.roomId, messageId: message.id, profileId }));
    threads.forEach((started) => this.store.insertRoomThread(started));
    this.hub.publishToRoom(message.roomId, { type: "room.message", message, threads });
  }

  private takeTagsFor(conversationId: string, answering: string) {
    const named = this.tagsForAnswers.get(conversationId);
    this.tagsForAnswers.delete(conversationId);
    return named?.answering === answering ? named.profileIds : [];
  }

  private agentsMayGoOn(roomId: string, asked: RoomMessage, tagging: number) {
    const timeline = this.timeline(roomId);
    const personMessage = personMessageBehind(asked, new Map(timeline.messages.map((message) => [message.id, message])));
    return agentTaggedTurnsAfter(timeline, personMessage) + tagging <= AGENT_TAGGED_TURNS_AFTER_A_PERSON;
  }

  private unfinishedAnswer(asked: RoomMessage, profileId: string) {
    const latest = this.store
      .listRoomMessages(asked.roomId)
      .findLast(({ answers, author }) => answers === asked.id && writtenByAgent(author) && author.profileId === profileId);
    return latest?.ended === undefined ? undefined : latest;
  }

  private otherAgentNames(room: Room, profileId: string) {
    return room.agents.flatMap((agent) => (agent.profileId === profileId ? [] : (this.store.findProfile(agent.profileId)?.name ?? [])));
  }

  /** An agent of the room whose profile is still there to take a turn. */
  private answers(room: Room, profileId: string) {
    return hasAgent(room, profileId) && this.store.findProfile(profileId) !== undefined;
  }

  /** The thread a follow-up goes to: one of the room's, whose agent is still in it, written to without tags. */
  private followedUp(room: Room, threadId: string, tags: string[]) {
    const thread = this.store.findRoomThread(threadId);
    if (thread?.roomId !== room.id || !this.answers(room, thread.profileId) || tags.length > 0) throw new HostProblemError({ code: "room-message-misaddressed" });
    return thread;
  }

  private startSession(room: Room, profileId: string) {
    const profile = this.store.findProfile(profileId);
    if (!profile) throw new HostProblemError({ code: "room-message-misaddressed" });
    const { id } = this.sessions.startInRoom(room.id, room.workspaceId, { harness: profile.harness, profileId }, `${room.name}: ${profile.name}`);
    this.store.setRoomAgentConversation(room.id, profileId, id);
    this.publish(room.id);
    return id;
  }

  /** The room message the turn answers: the one that began it, or, for a turn that went on from one a stop or a wait cut short, the one before. */
  private askedIn(conversationId: string, turnSeq: number) {
    const roomMessageId = this.store
      .listEventsOfTypes(conversationId, ["user-message"])
      .flatMap(({ seq, event }) => (seq <= turnSeq && event.type === "user-message" && event.roomMessageId ? [event.roomMessageId] : []))
      .at(-1);
    return roomMessageId === undefined ? undefined : this.store.findRoomMessage(roomMessageId);
  }

  /** The thread the agent answers the message in: the one the message started for it, or the thread a person's follow-up was written in. */
  private threadOf(message: RoomMessage, profileId: string): RoomThread | undefined {
    const started = this.store.listRoomThreads(message.roomId).find((thread) => thread.messageId === message.id && thread.profileId === profileId);
    if (started) return started;
    return message.threadId !== null && message.answers === undefined ? this.store.findRoomThread(message.threadId) : undefined;
  }

  private nameOf(author: RoomAuthor) {
    if (writtenByAgent(author)) return this.store.findProfile(author.profileId)?.name ?? AGENT_GONE;
    const named = this.store.listPeople().find(({ id }) => id === author.personId)?.name;
    return named || (author.personId === this.store.ownerId() ? OWNER_WITHOUT_A_NAME : PERSON_WITHOUT_A_NAME);
  }

  private existingRoom(roomId: string) {
    const room = this.store.findRoom(roomId);
    if (!room) throw new HostProblemError({ code: "room-gone" });
    return room;
  }

  private existingProfiles(profileIds: string[]) {
    return distinct(profileIds).filter((profileId) => this.store.findProfile(profileId) !== undefined);
  }

  private roomName(name: string) {
    const trimmed = name.trim();
    if (!trimmed) throw new HostProblemError({ code: "room-needs-a-name" });
    return trimmed;
  }

  private peopleChanged(roomId: string) {
    this.publish(roomId);
    this.peopleListed();
  }

  /** Who shares a room decides whom each person other than the owner sees, so their pages hear of people again. */
  private peopleListed() {
    this.hub.broadcast({ type: "people.listed", people: this.store.listPeople() });
  }

  private publish(roomId: string) {
    const room = this.existingRoom(roomId);
    this.hub.broadcast({ type: "room.upserted", room });
    return room;
  }
}

function knownPreset(permissions: PermissionPreset) {
  if (!isPermissionPreset(permissions)) throw new Error(`There is no permission preset "${permissions}".`);
  return permissions;
}
