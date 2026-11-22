import { lstatSync, realpathSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { HostProblemError } from "../shared/host-problems.ts";
import { replyOf } from "../shared/last-words.ts";
import type { CanvasItem, Conversation, Launch } from "../shared/model.ts";
import type { RoomUsage } from "../shared/room-usage.ts";
import { mentionsIn, type RoomMention } from "../shared/room-mentions.ts";
import { AGENT_GONE, nameTaken, OWNER_WITHOUT_A_NAME, PERSON_WITHOUT_A_NAME, personGoesBy } from "../shared/people.ts";
import {
  allowedByPreset,
  isPermissionPreset,
  reachedByTaskAllowance,
  taskAllowanceOf,
  worksOnFiles,
  type AskedPermission,
  type PermissionPreset,
  type RoomApprovalAnswer,
} from "../shared/room-permissions.ts";
import {
  AGENT_TAGGED_TURNS_AFTER_A_PERSON,
  agentTaggedTurnsAfter,
  asksAgentsAs,
  authorRoleOf,
  catchUpPrompt,
  catchUpShown,
  isRoomRole,
  keptFromAgents,
  mayWriteAs,
  personMessageBehind,
  PROFILES_MODEL,
  ROOM_MESSAGE_MOST_CHARACTERS,
  roomHistory,
  roomMessageLength,
  shownOnRoomCanvas,
  taskOf,
  taskWaits,
  writtenByAgent,
  type AuthorOf,
  type Room,
  type RoomApproval,
  type RoomAgentModel,
  type RoomAuthor,
  type RoomHistoryQuery,
  type RoomMessage,
  type RoomMessageSentAlong,
  type RoomRole,
  type RoomTaskApproval,
  type RoomThread,
  type RoomTimeline,
} from "../shared/rooms.ts";
import { shownAsWritten } from "../shared/written-text.ts";
import type { RoomRules, TurnListener, WaitingPermission } from "./conversations.ts";
import type { Hub } from "./hub.ts";
import { SenderLimit } from "./join-requests.ts";
import { EVENTS_OF_TURNS, roomUsage } from "./room-usage.ts";
import type { Store } from "./store.ts";
import type { SystemNotifications } from "./system-notifications.ts";

/** What a room needs of the conversations its agents work in. */
export interface RoomSessions {
  startInRoom(roomId: string, workspaceId: string, launch: Launch, title: string): Conversation;
  /** `authorId` is the person who wrote the message; none when an agent's answer tagged the agent. */
  send(conversationId: string, text: string, imageIds: string[], options: { authorId?: string; afterTurn: boolean; roomMessageId: string }): Promise<void>;
  deleteWithAllItHolds(conversationId: string): void;
  waitingPermissions(conversationId: string): WaitingPermission[];
  answerPermission(conversationId: string, permissionId: string, allowed: boolean): void;
  followRoomPreset(conversationId: string): Promise<void>;
  followRoomAgentModel(conversationId: string): Promise<void>;
}

/** What came of an agent naming agents to tag in its answer: those it will tag, and those it can't, by name. */
export interface TagsNamed {
  tagged: string[];
  itself: boolean;
  unknown: string[];
  /** The other agents of the room, by name, for an agent that named one wrong. */
  others: string[];
}

/** How many messages a person other than the owner may write in rooms a minute. */
export const MOST_ROOM_MESSAGES_A_MINUTE = 30;

/** Told of each message that goes up in a room: the people it tags that it didn't tag before, and its author's name. */
export type PostListener = (message: RoomMessage, newlyTagged: RoomMention[], by: string) => void;

export type TaskAnswer = "allow" | "deny";

const distinct = (ids: string[]) => [...new Set(ids)];
const hasAgent = (room: Room, profileId: string) => room.agents.some((agent) => agent.profileId === profileId);
const sameName = (named: string, name: string) => named.trim().replace(/^@/, "").toLowerCase() === name.toLowerCase();

const leadsOut = (relativePath: string) => relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath);
const isWithin = (root: string, place: string) => !leadsOut(relative(root, place));
const overlap = (one: string, other: string) => isWithin(one, other) || isWithin(other, one);

function realPathOrNull(path: string) {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

/** The home a path an agent names may start from, with ~ or ~ and the name of the user the host runs as; null for a user the host can't name. */
export interface HostsHome {
  directory: string;
  user: string | null;
}

function userRunningTheHost() {
  try {
    return userInfo().username;
  } catch {
    return null;
  }
}

const NAMES_A_HOME = /^~([^/\\]*)(?=$|[/\\])/;
const EXPANDS_A_VARIABLE = /\$[\w{]|%\w+%/;
const IS_A_URL = /^[a-z][a-z\d+.-]+:\/\//i;

/**
 * The absolute path a path an agent names stands for, taken from `base` unless it starts from a home: ~, or ~ and the
 * name of the user the host runs as, is that user's home. Null for a path that may stand for another place than it
 * reads as, so it counts as outside: one that starts from another user's home or in a form not known here, or one
 * holding a variable or a URL that a tool may expand.
 */
export function absolutePathNamed(path: string, base: string, home: HostsHome): string | null {
  if (EXPANDS_A_VARIABLE.test(path) || IS_A_URL.test(path)) return null;
  const fromHome = NAMES_A_HOME.exec(path);
  if (!fromHome) return resolve(base, path);
  const [startingFromHome, user] = fromHome;
  if (user !== "" && user !== home.user) return null;
  return resolve(home.directory, `.${path.slice(startingFromHome.length)}`);
}

function exists(path: string) {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * A link on the way can lead out of the workspace, so an entry's real place decides. One not made yet is judged by its
 * folder, which must exist: deeper, folders made on the way could be links leading anywhere. Null where neither can be read.
 */
function realPlaceOf(path: string): string | null {
  if (exists(path)) return realPathOrNull(path);
  const folder = dirname(path);
  const realFolder = folder !== path && exists(folder) ? realPathOrNull(folder) : null;
  return realFolder === null ? null : join(realFolder, basename(path));
}

/**
 * The rooms of this machine: their messages go to every page that shows the room and cost no tokens, until one tags an
 * agent or follows up in its thread. Then the agent's conversation in the room is sent what it has not seen of the room,
 * and the final answer of the turn that takes is posted to the room, in the thread. An agent's answer can tag other agents
 * of the room as a person's message does, a few turns at most after a person last wrote.
 *
 * What the agents may do without asking is the room's permission preset, and never anything in Mirador's own data;
 * whatever else they ask waits for an approver, who can let the same kind of request through for the rest of the task's
 * turn. A task a person other than the owner gives the agents waits for an approver too, unless the room lets people's
 * tasks start by themselves.
 */
export class RoomService implements RoomRules, TurnListener {
  /** What an approver let through for the rest of each conversation's turn, by `taskAllowanceOf`. */
  private readonly allowedForTurn = new Map<string, Set<string>>();
  private outOfEveryRoom: (personIds: string[]) => void = () => {};
  private postListener: PostListener = () => {};

  constructor(
    private readonly store: Store,
    private readonly hub: Hub,
    private readonly sessions: RoomSessions,
    private readonly notifications: Pick<SystemNotifications, "notify">,
    /** Mirador's data directory, with its tokens and database, which the agents never reach without asking. */
    private readonly dataDir: string,
    private readonly writing = new SenderLimit(Date.now, MOST_ROOM_MESSAGES_A_MINUTE),
    private readonly home: HostsHome = { directory: homedir(), user: userRunningTheHost() },
  ) {
    store.forgetRoomAgentsAnswering();
  }

  list(): Room[] {
    return this.store.listRooms();
  }

  /** Told of the people a change took out of the last room they were in. */
  hearPeopleOutOfEveryRoomWith(listener: (personIds: string[]) => void) {
    this.outOfEveryRoom = listener;
  }

  hearPostsWith(listener: PostListener) {
    this.postListener = listener;
  }

  /** A person an invite just let into the room: pages hear of them as of one the owner let in. */
  personCameIn(roomId: string) {
    this.peopleChanged(roomId);
  }

  /** `models` holds the model and effort chosen for each agent by its profile id; an agent not in it takes its profile's. */
  create(name: string, workspaceId: string, profileIds: string[], permissions: PermissionPreset, models: Record<string, RoomAgentModel> = {}): Room {
    if (!this.store.findWorkspace(workspaceId)) throw new HostProblemError({ code: "workspace-gone" });
    const room = {
      id: crypto.randomUUID(),
      name: this.roomName(name),
      workspaceId,
      agents: this.existingProfiles(profileIds).map((profileId) => ({ profileId, conversationId: null, answering: null, ...checkedModel(models[profileId] ?? PROFILES_MODEL) })),
      permissions: knownPreset(permissions),
      people: [],
      peoplesTasksWait: true,
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
      .forEach(({ conversationId }) => this.sessions.deleteWithAllItHolds(conversationId!));
    this.store.setRoomAgents(roomId, [...staying]);
    this.publish(roomId);
    this.waitingChanged(roomId);
  }

  /** From the agent's next session in the room on, and in its open one at once; an agent not in the room has none to change. */
  setAgentModel(roomId: string, profileId: string, model: RoomAgentModel) {
    const agent = this.existingRoom(roomId).agents.find((each) => each.profileId === profileId);
    if (!agent) return;
    this.store.setRoomAgentModel(roomId, profileId, checkedModel(model));
    this.publish(roomId);
    if (agent.conversationId) void this.sessions.followRoomAgentModel(agent.conversationId).catch(() => {});
  }

  /**
   * The room's agents work in the workspace from their next task on: each one's conversation in the room goes, so that
   * its agent starts afresh there and is introduced to the room again.
   */
  setWorkspace(roomId: string, workspaceId: string) {
    const room = this.existingRoom(roomId);
    if (!this.store.findWorkspace(workspaceId)) throw new HostProblemError({ code: "workspace-gone" });
    if (workspaceId === room.workspaceId) return;
    room.agents.forEach(({ conversationId }) => conversationId && this.sessions.deleteWithAllItHolds(conversationId));
    this.store.setRoomWorkspace(roomId, workspaceId);
    this.publish(roomId);
    this.waitingChanged(roomId);
  }

  /** The rooms whose agents work in the workspace, which can't be removed while they do. */
  assertNoneWorkIn(workspaceId: string) {
    const working = this.list().filter((room) => room.workspaceId === workspaceId);
    if (working.length > 0) throw new HostProblemError({ code: "workspace-has-rooms", rooms: working.map(({ name }) => name) });
  }

  /** Holds from the agents' next requests on; an agent's open session switches to the preset's mode at once. */
  setPermissions(roomId: string, permissions: PermissionPreset) {
    const room = this.existingRoom(roomId);
    this.store.setRoomPermissions(roomId, knownPreset(permissions));
    this.publish(roomId);
    room.agents.forEach(({ conversationId }) => conversationId && void this.sessions.followRoomPreset(conversationId).catch(() => {}));
  }

  /** From the next task of a person other than the owner on; the tasks already waiting go on waiting. */
  setPeoplesTasksWait(roomId: string, wait: boolean) {
    this.existingRoom(roomId);
    this.store.setRoomPeoplesTasksWait(roomId, wait);
    this.publish(roomId);
  }

  /**
   * Lets the person into the room with the role, unless their name reads as one already there, or gives them that role
   * there, from their next message on; made a guest, they ask the agents nothing, so their tasks still waiting are declined.
   */
  setPersonRole(roomId: string, personId: string, role: RoomRole) {
    const room = this.existingRoom(roomId);
    if (!isRoomRole(role)) throw new Error(`There is no room role "${role}".`);
    if (personId === this.store.ownerId() || !this.store.listPeople().some(({ id }) => id === personId)) throw new HostProblemError({ code: "room-person-unknown" });
    const comingIn = !room.people.some((person) => person.personId === personId);
    if (comingIn && this.nameTakenIn(room, personId)) throw new HostProblemError({ code: "room-person-name-taken" });
    this.store.setRoomPersonRole(roomId, personId, role);
    this.peopleChanged(roomId);
    this.declineTasksNoLongerAsked(roomId);
  }

  /** The person's open pages lose the room at once, and their tasks still waiting are declined; out of their last room, they lose their devices here too. */
  removePerson(roomId: string, personId: string) {
    this.existingRoom(roomId);
    if (personId === this.store.ownerId()) throw new HostProblemError({ code: "room-person-unknown" });
    this.store.removeRoomPerson(roomId, personId);
    this.peopleChanged(roomId);
    this.declineTasksNoLongerAsked(roomId);
    this.tellOfPeopleInNoRoom([personId]);
  }

  delete(roomId: string) {
    const room = this.existingRoom(roomId);
    room.agents.forEach(({ conversationId }) => conversationId && this.sessions.deleteWithAllItHolds(conversationId));
    this.store.deleteRoom(roomId);
    this.hub.broadcast({ type: "room.deleted", roomId });
    if (room.people.length === 0) return;
    this.peopleListed();
    this.tellOfPeopleInNoRoom(room.people.map(({ personId }) => personId));
  }

  /**
   * Whether the room's preset, or what an approver let through for the rest of the turn, lets the request through without
   * asking; never one that may reach Mirador's own data.
   */
  allowsByItself(conversationId: string, asked: AskedPermission): boolean {
    const room = this.roomOf(conversationId);
    if (!room || this.mayReachMiradorsData(room, asked)) return false;
    const freelyReachable = (path: string) => this.freelyReachable(room, path);
    const allowedForTheTask = this.allowedForTurn.get(conversationId)?.has(taskAllowanceOf(asked)) === true && reachedByTaskAllowance(asked, freelyReachable);
    return allowedForTheTask || allowedByPreset(room.permissions, asked, freelyReachable);
  }

  waitingChanged(roomId: string) {
    this.hub.broadcast({ type: "room.approvals", roomId, approvals: this.approvals(roomId), tasks: this.tasksWaiting(roomId) });
  }

  /** The tasks of people other than the owner that wait for an approver, oldest first. */
  tasksWaiting(roomId: string): RoomTaskApproval[] {
    const room = this.store.findRoom(roomId);
    if (!room) return [];
    const ownerId = this.store.ownerId();
    return this.store.listRoomTasksWaiting(roomId).map((message) => ({
      roomId,
      messageId: message.id,
      profileIds: this.agentsAsked(message),
      personId: (message.author as { personId: string }).personId,
      role: authorRoleOf(message, ownerId),
      text: message.text,
      sentAlong: this.sentAlongWith(room, message),
      at: message.at,
      approvers: this.approversOf(room),
    }));
  }

  allTasksWaiting(): RoomTaskApproval[] {
    return this.list().flatMap(({ id }) => this.tasksWaiting(id));
  }

  /**
   * Allowing a waiting task sends it to the agents it asks that are still in the room, each with what it has missed of
   * the room by now, as a tag does; denying it posts a declined answer in each of their threads, and no agent hears of it.
   * A task whose writer may no longer ask it of the agents is declined, whatever the answer.
   */
  answerTask(roomId: string, messageId: string, answer: TaskAnswer, personId: string) {
    const room = this.existingRoom(roomId);
    this.assertMayApprove(room, personId);
    if (answer !== "allow" && answer !== "deny") throw new Error(`There is no answer "${answer}" to a task.`);
    const waiting = this.store.findRoomMessage(messageId);
    if (waiting?.roomId !== roomId || !taskWaits(waiting) || writtenByAgent(waiting.author)) throw new HostProblemError({ code: "room-task-not-waiting" });
    if (answer === "allow" && this.writerMayStillAsk(room, waiting)) this.allowTask(room, waiting);
    else this.declineTask(room, waiting);
    this.waitingChanged(roomId);
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

  /** Allowing for the task lets the same kind of request through until the turn ends, the ones already waiting in it too; one that reads or changes files outside the workspace still asks. */
  approve(conversationId: string, permissionId: string, answer: RoomApprovalAnswer, personId: string) {
    const room = this.roomOf(conversationId);
    if (!room) throw new HostProblemError({ code: "room-gone" });
    this.assertMayApprove(room, personId);
    const waiting = this.sessions.waitingPermissions(conversationId).find(({ request }) => request.permissionId === permissionId);
    if (!waiting) throw new HostProblemError({ code: "permission-no-longer-pending" });
    if (answer === "allow-for-task") this.allowForTurn(conversationId, waiting);
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

  /**
   * What the room's agents took for their turns since then, read from their conversations in the room: an agent taken
   * out of it, or a workspace the room left, takes its conversation there with it, and what it took.
   */
  usage(roomId: string, since: number | null): RoomUsage {
    const agents = this.existingRoom(roomId).agents.map(({ profileId, conversationId }) => ({
      profileId,
      events: conversationId ? this.store.listEventsOfTypes(conversationId, EVENTS_OF_TURNS) : [],
    }));
    return roomUsage(roomId, since, agents, this.store.listRoomMessages(roomId));
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
   * and with the thread's agent of a follow-up, is sent what it has missed of the room; unless a person other than the
   * owner wrote it in a room whose people's tasks wait, when it waits for an approver instead.
   */
  write(roomId: string, personId: string, text: string, tags: string[], threadId: string | null): RoomMessage {
    const room = this.existingRoom(roomId);
    const role = this.roleWriting(room, personId, tags, threadId);
    const written = role === null ? text : shownAsWritten(text);
    if (roomMessageLength(written) > ROOM_MESSAGE_MOST_CHARACTERS) throw new HostProblemError({ code: "room-message-too-long", most: ROOM_MESSAGE_MOST_CHARACTERS });
    const tagged = distinct(tags);
    const thread = threadId === null ? null : this.followedUp(room, threadId, tagged);
    if (tagged.some((profileId) => !this.answers(room, profileId))) throw new HostProblemError({ code: "room-message-misaddressed" });
    if (role !== null && !this.writing.allows(personId)) throw new HostProblemError({ code: "room-writing-too-fast" });
    const asked = thread ? [thread.profileId] : tagged;
    const waits = role !== null && room.peoplesTasksWait && asked.length > 0;
    const message = this.store.appendRoomMessage({
      id: crypto.randomUUID(),
      roomId,
      at: Date.now(),
      author: { personId },
      ...(role !== null && { authorRole: role }),
      text: written.trim(),
      tags: tagged,
      ...this.mentionsOf(room, written, { personId }),
      threadId,
      ...(waits && { taskHeld: "waiting" as const }),
    });
    this.post(message, tagged);
    if (waits) this.holdTask(room, message, asked);
    else asked.forEach((profileId) => this.ask(room, profileId, message, personId));
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
    this.showAnswering(conversation.roomId, conversationId, null);
    const namedInTurn = this.store.takeRoomAnswerTags(conversationId);
    const room = this.store.findRoom(conversation.roomId);
    const asked = this.askedIn(conversationId, turnSeq);
    const thread = asked && this.threadOf(asked, conversation.profileId);
    if (!room || !asked || !thread) return;
    const reply = replyOf(this.store.listEventsFrom(conversationId, turnSeq));
    const finished = reply.ended === "finished";
    const named = finished ? this.tagsFor(namedInTurn, room, asked).filter((profileId) => this.answers(room, profileId)) : [];
    const passedOn = this.agentsMayGoOn(room.id, asked, named.length) ? named : [];
    const answer = {
      roomId: room.id,
      at: Date.now(),
      author: { profileId: conversation.profileId },
      text: reply.text ?? "",
      tags: passedOn,
      ...this.mentionsOf(room, reply.text ?? "", { profileId: conversation.profileId }),
      threadId: thread.id,
      answers: asked.id,
      ...(reply.ended !== "finished" && { ended: reply.ended }),
      ...(passedOn.length < named.length && { tagsDropped: named }),
    };
    const unfinished = this.unfinishedAnswer(asked, conversation.profileId);
    const posted = unfinished ? this.store.rewriteRoomMessage({ ...answer, id: unfinished.id }) : this.store.appendRoomMessage({ ...answer, id: crypto.randomUUID() });
    this.post(posted, passedOn, unfinished?.mentions ?? []);
    passedOn.forEach((profileId) => this.ask(room, profileId, posted, undefined));
    if (finished && this.writtenByAnApprover(room, asked)) this.notifications.notify(conversationId, { kind: "finished" });
  }

  /**
   * An agent whose new session lost all it was told in the room is introduced again, with the room's messages through the
   * one its turn answers: in place of that message's catch-up, or ahead of any other prompt, as the answer to its question.
   */
  reintroduced(conversationId: string, turnSeq: number, text: string): string {
    const conversation = this.store.findConversation(conversationId);
    const room = conversation?.roomId ? this.store.findRoom(conversation.roomId) : undefined;
    const asked = this.askedIn(conversationId, turnSeq);
    if (!room || !asked || !conversation?.profileId) return text;
    const introduction = this.catchUp(room, conversation.profileId, this.roomThrough(room, asked), asked, true);
    return this.catchUpBegan(conversationId, turnSeq, asked) ? introduction : `${introduction}\n\n${text}`;
  }

  /** The turn began with the message's catch-up: the conversation's first prompt that carried the message. */
  private catchUpBegan(conversationId: string, turnSeq: number, asked: RoomMessage) {
    return this.store.listEventsOfTypes(conversationId, ["user-message"]).find(({ event }) => event.type === "user-message" && event.roomMessageId === asked.id)?.seq === turnSeq;
  }

  /** The room shows the agent at work on the message its turn answers, a turn that goes on from an answer it gave too. */
  turnStarted(conversationId: string, turnSeq: number) {
    const roomId = this.store.findConversation(conversationId)?.roomId;
    const asked = roomId && this.askedIn(conversationId, turnSeq);
    if (asked) this.showAnswering(roomId, conversationId, asked.id);
  }

  private showAnswering(roomId: string, conversationId: string, answering: string | null) {
    if (!this.store.findRoom(roomId)) return;
    this.store.setRoomAgentAnswering(conversationId, answering);
    this.publish(roomId);
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
    this.store.setRoomAnswerTags(conversationId, answering.id, tagged.map(({ id }) => id));
    return { tagged: tagged.map(({ name }) => name), itself, unknown, others: others.map(({ name }) => name) };
  }

  /** The room_history tool: older messages of the room the caller was sent, framed as its catch-ups. Null for a conversation that is no agent's in a room. */
  readBack(conversationId: string, query: RoomHistoryQuery): string | null {
    const conversation = this.store.findConversation(conversationId);
    if (!conversation?.roomId || conversation.profileId === null || !this.store.findRoom(conversation.roomId)) return null;
    const sent = this.store.listRoomMessagesBetween(conversation.roomId, 0, this.store.roomSeenThrough(conversation.roomId, conversation.profileId));
    return roomHistory(sent.filter((message) => !keptFromAgents(message)), query, this.authorOf);
  }

  private approvalOf(room: Room, profileId: string, conversationId: string, { request, asked: { toolKind, paths }, at }: WaitingPermission, messagesById: Map<string, RoomMessage>): RoomApproval {
    const asked = this.askedIn(conversationId, Number.MAX_SAFE_INTEGER);
    return {
      roomId: room.id,
      conversationId,
      profileId,
      request,
      file: toolKind === "execute" ? null : (paths[0] ?? null),
      outsideWorkspace: worksOnFiles(toolKind) && paths.some((path) => !this.freelyReachable(room, path)),
      at,
      threadId: (asked && this.threadOf(asked, profileId)?.id) ?? null,
      task: asked ? taskOf(asked, messagesById, this.store.ownerId()) : null,
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

  /**
   * The owner writes anything in every room; anyone else as their role there lets them, and nothing in a room they are
   * not in. The writer's role in the room, null for the owner.
   */
  private roleWriting(room: Room, personId: string, tags: string[], threadId: string | null): RoomRole | null {
    if (personId === this.store.ownerId()) return null;
    const role = room.people.find((person) => person.personId === personId)?.role;
    if (!role) throw new HostProblemError({ code: "room-gone" });
    if (!mayWriteAs(role, tags, threadId)) throw new HostProblemError({ code: "room-guests-only-write" });
    return role;
  }

  /** Someone waits for the answer: an approver who tagged the agent, or followed up in its thread. */
  private writtenByAnApprover(room: Room, asked: RoomMessage) {
    return !writtenByAgent(asked.author) && this.approversOf(room).includes(asked.author.personId);
  }

  private allowForTurn(conversationId: string, answered: WaitingPermission) {
    this.allowedForTurn.set(conversationId, new Set([...(this.allowedForTurn.get(conversationId) ?? []), taskAllowanceOf(answered.asked)]));
    this.sessions
      .waitingPermissions(conversationId)
      .filter((waiting) => waiting.request.permissionId === answered.request.permissionId || this.allowsByItself(conversationId, waiting.asked))
      .forEach(({ request }) => this.sessions.answerPermission(conversationId, request.permissionId, true));
  }

  private roomOf(conversationId: string) {
    const roomId = this.store.findConversation(conversationId)?.roomId;
    return roomId ? this.store.findRoom(roomId) : undefined;
  }

  /** Inside the room's workspace, once links are followed; a path that may stand for another place than it reads as is not. */
  private freelyReachable(room: Room, path: string) {
    const workspace = this.store.findWorkspace(room.workspaceId);
    const root = workspace ? realPathOrNull(workspace.path) : null;
    const place = workspace ? this.realPlaceNamed(path, workspace.path) : null;
    return root !== null && place !== null && isWithin(root, place);
  }

  private realPlaceNamed(path: string, base: string) {
    const named = absolutePathNamed(path, base, this.home);
    return named === null ? null : realPlaceOf(named);
  }

  /** A file tool that names no file may reach any; otherwise, whether a path it names leads into Mirador's data. */
  private mayReachMiradorsData(room: Room, { toolKind, paths }: AskedPermission) {
    if (paths.length === 0) return worksOnFiles(toolKind);
    return paths.some((path) => this.leadsIntoMiradorsData(room, path));
  }

  /** Whether the path, once links are followed, lies in Mirador's data directory or holds it; a path that leads nowhere readable, or may stand for another place than it reads as, might. */
  private leadsIntoMiradorsData(room: Room, path: string) {
    const workspace = this.store.findWorkspace(room.workspaceId);
    const place = this.realPlaceNamed(path, workspace?.path ?? process.cwd());
    const data
 = realPathOrNull(this.dataDir) ?? resolve(this.dataDir);
    return place === null || overlap(data, place);
  }

  /** The agents a message asks: those it tags, or the agent of the thread it follows up in. */
  private agentsAsked(message: RoomMessage) {
    if (message.threadId === null || message.answers !== undefined) return message.tags;
    const thread = this.store.findRoomThread(message.threadId);
    return thread ? [thread.profileId] : [];
  }

  private allowTask(room: Room, waiting: RoomMessage) {
    const task = this.store.answerRoomTask(waiting.id, null)!;
    this.hub.publishToRoom(room.id, { type: "room.message", message: task, threads: [] });
    const writerId = (task.author as { personId: string }).personId;
    this.agentsAsked(task)
      .filter((profileId) => this.answers(room, profileId))
      .forEach((profileId) => this.ask(room, profileId, task, writerId));
  }

  private declineTask(room: Room, waiting: RoomMessage) {
    const task = this.store.answerRoomTask(waiting.id, "declined")!;
    this.hub.publishToRoom(room.id, { type: "room.message", message: task, threads: [] });
    this.agentsAsked(task)
      .filter((profileId) => this.answers(room, profileId))
      .forEach((profileId) => this.decline(task, profileId));
  }

  /**
   * Whether the person's name reads as the owner's, another person's in the room or who wrote there, or one of its
   * agents', whom the room shows and frames by name.
   */
  private nameTakenIn(room: Room, personId: string) {
    const people = this.store.listPeople();
    const others = new Set([this.store.ownerId(), ...room.people.map((person) => person.personId), ...this.store.writersIn(room.id)].filter((id) => id !== personId));
    const named = people.find(({ id }) => id === personId)?.name ?? "";
    const agents = room.agents.flatMap(({ profileId }) => this.store.findProfile(profileId)?.name ?? []);
    return nameTaken(named, [...people.filter(({ id }) => others.has(id)).map(({ name }) => name), ...agents]);
  }

  /** The writer is still in the room, in a role that lets them ask what the task asks. */
  private writerMayStillAsk(room: Room, task: RoomMessage) {
    if (writtenByAgent(task.author)) return false;
    const { personId } = task.author;
    const role = room.people.find((person) => person.personId === personId)?.role;
    return role !== undefined && mayWriteAs(role, task.tags, task.threadId);
  }

  /** The tasks still waiting whose writers left the room, or may no longer ask them, are declined at once. */
  private declineTasksNoLongerAsked(roomId: string) {
    const room = this.existingRoom(roomId);
    const noLongerAsked = this.store.listRoomTasksWaiting(roomId).filter((task) => !this.writerMayStillAsk(room, task));
    noLongerAsked.forEach((task) => this.declineTask(room, task));
    if (noLongerAsked.length > 0) this.waitingChanged(roomId);
  }

  /** The task waits, and approvers hear of it as of a request: through the conversation of the first agent it asks. */
  private holdTask(room: Room, task: RoomMessage, asked: string[]) {
    const agent = room.agents.find(({ profileId }) => profileId === asked[0])!;
    const conversationId = agent.conversationId ?? this.startSession(room, agent.profileId);
    const { role, name } = this.authorOf(task);
    this.notifications.notify(conversationId, { kind: "permission", tool: `a task of ${name}, ${role}` });
    this.waitingChanged(room.id);
  }

  /** The declined task's answer, which no agent wrote: it tells the room the agent was never asked. */
  private decline(task: RoomMessage, profileId: string) {
    const thread = this.threadOf(task, profileId);
    if (!thread) return;
    const declined = this.store.appendRoomMessage({
      id: crypto.randomUUID(),
      roomId: task.roomId,
      at: Date.now(),
      author: { profileId },
      text: "",
      tags: [],
      threadId: thread.id,
      answers: task.id,
      ended: "declined",
    });
    this.post(declined, []);
  }

  /** The room's messages up to and with the one the agent is asked that it has not seen and may read; never its own. */
  private unseenBy(room: Room, profileId: string, asked: RoomMessage) {
    return this.store
      .listRoomMessagesBetween(room.id, this.store.roomSeenThrough(room.id, profileId), asked.seq)
      .filter((each) => !keptFromAgents(each) && !(writtenByAgent(each.author) && each.author.profileId === profileId));
  }

  /** What an agent introduced to the room reads of it: every message through the one it is asked that agents may read, its own too. */
  private roomThrough(room: Room, asked: RoomMessage) {
    return this.store.listRoomMessagesBetween(room.id, 0, asked.seq).filter((each) => !keptFromAgents(each));
  }

  private catchUp(room: Room, profileId: string, unseen: RoomMessage[], asked: RoomMessage, introduced: boolean) {
    return catchUpPrompt({
      roomName: room.name,
      unseen: unseen.length > 0 ? unseen : [asked],
      authorOf: this.authorOf,
      ...(introduced && { introducedAs: this.nameOf({ profileId }) }),
      otherAgents: this.otherAgentNames(room, profileId),
    });
  }

  /** What the catch-ups of the agents a waiting task asks would show them besides the task, were it allowed now. */
  private sentAlongWith(room: Room, task: RoomMessage): RoomMessageSentAlong[] {
    const ownerId = this.store.ownerId();
    const riding = this.agentsAsked(task)
      .filter((profileId) => this.answers(room, profileId))
      .flatMap((profileId) => catchUpShown([...this.unseenBy(room, profileId, task), task], this.authorOf).slice(0, -1));
    return [...new Map(riding.map((message) => [message.id, message])).values()]
      .toSorted((a, b) => a.seq - b.seq)
      .map((message) => ({ messageId: message.id, author: message.author, role: authorRoleOf(message, ownerId), text: message.text }));
  }

  /** What rides along with a waiting task changes as its agents read the room, and as an answer is written anew. */
  private tasksMayCarryOthers(roomId: string) {
    if (this.store.listRoomTasksWaiting(roomId).length > 0) this.waitingChanged(roomId);
  }

  /** An agent new to the room, or on a new conversation there, is introduced to it with the room's messages so far. */
  private ask(room: Room, profileId: string, message: RoomMessage, personId: string | undefined) {
    const agent = room.agents.find((each) => each.profileId === profileId)!;
    const conversationId = agent.conversationId ?? this.startSession(room, profileId);
    const introduced = agent.conversationId === null || this.store.roomSeenThrough(room.id, profileId) === 0;
    const prompt = this.catchUp(room, profileId, introduced ? this.roomThrough(room, message) : this.unseenBy(room, profileId, message), message, introduced);
    this.store.markRoomSeen(room.id, profileId, message.seq);
    this.sessions.send(conversationId, prompt, [], { authorId: personId, afterTurn: true, roomMessageId: message.id }).catch(() => {});
    this.tasksMayCarryOthers(room.id);
  }

  /** The message goes to every page that shows the room, with a thread for each agent it tags; the people it tags now and didn't before are told of it. */
  private post(message: RoomMessage, tagged: string[], taggedBefore: RoomMention[] = []) {
    const threads = tagged.map((profileId) => ({ id: crypto.randomUUID(), roomId: message.roomId, messageId: message.id, profileId }));
    threads.forEach((started) => this.store.insertRoomThread(started));
    this.hub.publishToRoom(message.roomId, { type: "room.message", message, threads });
    this.tasksMayCarryOthers(message.roomId);
    const newlyTagged = (message.mentions ?? []).filter(({ personId }) => !taggedBefore.some((before) => before.personId === personId));
    this.postListener(message, newlyTagged, this.nameOf(message.author));
  }

  /**
   * The people of the room the text tags by an @ and their name as they go by now, which a rename can't change later:
   * the owner and the room's people, never the writer, nor anyone without a name or whose name reads as another's here.
   */
  private mentionsOf(room: Room, text: string, author: RoomAuthor): Pick<RoomMessage, "mentions"> {
    const people = this.store.listPeople();
    const inRoom = [{ personId: this.store.ownerId() }, ...room.people.filter(({ nameClash }) => nameClash === undefined)];
    const taggable = inRoom.flatMap(({ personId }) => {
      const name = people.find(({ id }) => id === personId)?.name ?? "";
      return writtenByAgent(author) || author.personId !== personId ? [{ personId, name }] : [];
    });
    const mentions = mentionsIn(text, taggable);
    return mentions.length > 0 ? { mentions } : {};
  }

  /**
   * The agents the turn named to tag, kept through a restart of the host and taken however the turn ends, so a stopped
   * turn's leave none for a later one; they tag only while the person the answer works for may tag agents themselves.
   */
  private tagsFor(named: { answering: string; profileIds: string[] } | undefined, room: Room, answering: RoomMessage) {
    return named?.answering === answering.id && this.personBehindMayTag(room, answering) ? named.profileIds : [];
  }

  /** The owner may tag agents in every room, and a member in theirs; an agent's answer works for the person whose message began its chain. */
  private personBehindMayTag(room: Room, answering: RoomMessage) {
    const { author } = personMessageBehind(answering, new Map(this.store.listRoomMessages(room.id).map((message) => [message.id, message])));
    if (writtenByAgent(author)) return false;
    return author.personId === this.store.ownerId() || room.people.some(({ personId, role }) => personId === author.personId && asksAgentsAs(role));
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

  /** The role the host knows a message's author by, and their name, as agents are told them. */
  private readonly authorOf: AuthorOf = (message) => ({ role: authorRoleOf(message, this.store.ownerId()), name: this.nameOf(message.author) });

  private nameOf(author: RoomAuthor) {
    if (writtenByAgent(author)) return this.store.findProfile(author.profileId)?.name ?? AGENT_GONE;
    const person = this.store.listPeople().find(({ id }) => id === author.personId);
    return author.personId === this.store.ownerId() ? person?.name || OWNER_WITHOUT_A_NAME : personGoesBy(person, PERSON_WITHOUT_A_NAME);
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

  private tellOfPeopleInNoRoom(personIds: string[]) {
    const inNoRoom = this.store.peopleInNoRoom(personIds);
    if (inNoRoom.length > 0) this.outOfEveryRoom(inNoRoom);
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

/** Far longer than any model or effort an agent names, so that nothing longer is kept. */
const LONGEST_MODEL_CHOICE = 200;

const choiceOrNone = (value: unknown) => {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > LONGEST_MODEL_CHOICE) throw new Error("A model or effort is a name, or none.");
  return value.trim() || null;
};

function checkedModel({ model, effort }: RoomAgentModel): RoomAgentModel {
  return { model: choiceOrNone(model), effort: choiceOrNone(effort) };
}

function knownPreset(permissions: PermissionPreset) {
  if (!isPermissionPreset(permissions)) throw new Error(`There is no permission preset "${permissions}".`);
  return permissions;
}
