import { lstatSync, realpathSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { HostProblemError } from "../shared/host-problems.ts";
import { replyOf } from "../shared/last-words.ts";
import { harnessIds, type CanvasItem, type Conversation, type HarnessId, type Launch, type Profile } from "../shared/model.ts";
import type { RoomUsage } from "../shared/room-usage.ts";
import { agentsTaggedIn, mentionsIn, type RoomMention, type TaggableAgent } from "../shared/room-mentions.ts";
import {
  ALL_OF_CLAUDE_SETUP,
  CLAUDE_SETUP_PARTS,
  claudeSetupIn,
  isVariableName,
  narrows,
  narrowsClaudeSetup,
  profileVariablesInRoom,
  type ClaudeSetup,
  type VariablesChosen,
} from "../shared/room-agent-setup.ts";
import { AGENT_GONE, nameRefused, nameTaken, OWNER_WITHOUT_A_NAME, PERSON_WITHOUT_A_NAME, personGoesBy, personName, readsAsMiradorsWords } from "../shared/people.ts";
import {
  allowedByPreset,
  asksForNothing,
  changesClaudeSetup,
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
  approvesAs,
  approvesIn,
  asksAgentsAs,
  authorRoleOf,
  broughtAgentName,
  isBroughtAnswerEnd,
  MOST_AGENTS_BROUGHT,
  catchUpPrompt,
  catchUpShown,
  isRoomRole,
  mayWriteAs,
  personIdBehind,
  personMessageBehind,
  PROFILES_MODEL,
  readByAgentsOf,
  ROOM_MESSAGE_MOST_CHARACTERS,
  roomHistory,
  roomMessageLength,
  shownOnRoomCanvas,
  taskOf,
  taskWaits,
  writtenByAgent,
  type AuthorOf,
  type BroughtAgent,
  type BroughtAnswerEnd,
  type Room,
  type RoomAnswerEnd,
  type RoomAgent,
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
import {
  keepingNetworkOf,
  narrowsSandbox,
  networkWhileOn,
  NO_SANDBOX,
  roomSandbox,
  sandboxSettingIn,
  sameSandbox,
  isHeldChangeAnswer,
  type HeldChangeAnswer,
  type SandboxBlocker,
  type SandboxCheck,
  type SandboxNetwork,
  type SandboxSetting,
} from "../shared/sandbox.ts";
import { assertSandboxCanRun, NO_SANDBOX_CONTROL, profileSandboxBlocker, type SandboxControl } from "./sandbox/sandbox-control.ts";
import { sandboxLeft, sandboxLeftWritableFolders } from "./sandbox/hooks-off.ts";
import { isRoomWorkspaceAnswer, type RoomWorkspaceAnswer, type RoomWorkspaceApproval, type RoomWorkspaceCall } from "../shared/room-workspace.ts";
import { shownAsWritten } from "../shared/written-text.ts";
import { firstGraphemes } from "../shared/text-cut.ts";
import type { RoomRules, TurnListener, WaitingPermission } from "./conversations.ts";
import type { Hub, SocketData } from "./hub.ts";
import { SenderLimit } from "./join-requests.ts";
import { EVENTS_OF_TURNS, roomUsage } from "./room-usage.ts";
import { RoomWorkspaceCalls, type WorkspaceCallSent, type WorkspaceCallUnderWay } from "./room-workspace/calls.ts";
import { inRoomsSandbox } from "./room-workspace/sandbox-place.ts";
import { onThisComputer, type WorkspacePlace } from "./room-workspace/workspace-place.ts";
import type { RoomBroughtTask, Store } from "./store.ts";
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
  /** The room's catch-ups waiting in the conversation's queue, taken out of it. */
  takeQueuedRoomPrompts(conversationId: string): QueuedRoomPrompt[];
  /** The agent takes up its changed setup on a fresh session of a fresh process, and is introduced to the room again; a change that leaves it with less stops its turn. */
  startAfreshInRoom(conversationId: string, change: { stopsTurn: boolean }): void;
}

/** A catch-up waiting in an agent's queue: the room message it asks and who asked it. */
export interface QueuedRoomPrompt {
  roomMessageId: string;
  authorId?: string;
}

const choicesStillNamed = (chosen: VariablesChosen, names: string[]) => Object.fromEntries(Object.entries(chosen).filter(([name]) => names.includes(name)));

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

/** How often a person may bring an agent into a room a minute, all rooms together. */
export const MOST_AGENTS_BROUGHT_A_MINUTE = 6;

/** How often a person's Mirador may say a minute that an agent they brought began on a task, all rooms together. */
export const MOST_BROUGHT_TASK_STARTS_A_MINUTE = 30;

/** The numbers a brought agent's name may take after it when the room already has one of that name. */
const NUMBERS_AFTER_A_TAKEN_NAME = [2, 3, 4, 5, 6, 7, 8, 9];

/** What a person's Mirador says, cut to what a room message may hold, its end marked. */
function cutToRoomMessage(text: string) {
  if (roomMessageLength(text) <= ROOM_MESSAGE_MOST_CHARACTERS) return text.trim();
  return `${firstGraphemes(text.trim().slice(0, ROOM_MESSAGE_MOST_CHARACTERS - 1), ROOM_MESSAGE_MOST_CHARACTERS).replace(/[\uD800-\uDBFF]$/, "")}…`;
}

/** Told of each message that goes up in a room: the people it tags that it didn't tag before, and its author's name. */
export type PostListener = (message: RoomMessage, newlyTagged: RoomMention[], by: string) => void;

export type WaitingListener = (roomId: string, approvals: RoomApproval[], tasks: RoomTaskApproval[], workspace: RoomWorkspaceApproval[]) => void;

export type TaskAnswer = "allow" | "deny";

const distinct = (ids: string[]) => [...new Set(ids)];
const hasAgent = (room: Room, profileId: string) => room.agents.some((agent) => agent.profileId === profileId);
const broughtBy = (personId: string) => (agent: RoomAgent): agent is RoomAgent & { brought: BroughtAgent } => agent.brought?.personId === personId;
const worksInWorkspace = (room: Room, agentId: string) => room.agents.some(({ profileId, brought }) => profileId === agentId && brought?.workspace === "allowed");
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
  private waitingListener: WaitingListener = () => {};
  private sandboxes = NO_SANDBOX_CONTROL;
  private readonly workspaceCalls: RoomWorkspaceCalls;

  constructor(
    private readonly store: Store,
    private readonly hub: Hub,
    private readonly sessions: RoomSessions,
    private readonly notifications: Pick<SystemNotifications, "notify" | "roomTaskHeld">,
    /** Mirador's data directory, with its tokens and database, which the agents never reach without asking. */
    private readonly dataDir: string,
    /** What commands that agents people brought run in the rooms' workspaces get of this computer's environment. */
    commandEnvironment: () => Record<string, string> = () => ({}),
    private readonly writing = new SenderLimit(Date.now, MOST_ROOM_MESSAGES_A_MINUTE),
    private readonly home: HostsHome = { directory: homedir(), user: userRunningTheHost() },
    private readonly bringing = new SenderLimit(Date.now, MOST_AGENTS_BROUGHT_A_MINUTE),
    private readonly broughtTaskStarts = new SenderLimit(Date.now, MOST_BROUGHT_TASK_STARTS_A_MINUTE),
  ) {
    store.forgetRoomAgentsAnswering();
    this.workspaceCalls = new RoomWorkspaceCalls(store, hub, {
      threadOf: (asked, agentId) => this.threadOf(asked, agentId),
      waitingChanged: (roomId) => this.waitingChanged(roomId),
      callWaits: (room, agentId) => this.workspaceWaits(room, agentId),
      placeOf: (room, agentId) => this.workspacePlaceOf(room, agentId, commandEnvironment),
    });
  }

  /** What agents people brought have under way in the rooms' workspaces ends with the host. */
  shutdown() {
    this.workspaceCalls.shutdown();
  }

  list(): Room[] {
    return this.store.listRooms();
  }

  keepsSandboxesWith(sandboxes: SandboxControl) {
    this.sandboxes = sandboxes;
  }

  /** Told of the people a change took out of the last room they were in. */
  hearPeopleOutOfEveryRoomWith(listener: (personIds: string[]) => void) {
    this.outOfEveryRoom = listener;
  }

  hearPostsWith(listener: PostListener) {
    this.postListener = listener;
  }

  /** Told each time what waits in a room for its approvers changes. */
  hearWaitingWith(listener: WaitingListener) {
    this.waitingListener = listener;
  }

  /** A person an invite just let into the room: pages hear of them as of one the owner let in, cleaning up if an existing member's role was lowered. */
  personCameIn(roomId: string, personId?: string, previousRole?: RoomRole | null) {
    const room = this.store.findRoom(roomId);
    if (room && personId && previousRole) {
      const role = room.people.find((person) => person.personId === personId)?.role;
      if (role && !asksAgentsAs(role)) this.takeOutAgentsOf(roomId, personId);
      else if (role && approvesAs(previousRole) && !approvesAs(role)) this.workspaceIsAskedForAgainOf(room, personId);
      this.declineTasksNoLongerAsked(roomId);
      this.waitingChanged(roomId);
    }
    this.peopleChanged(roomId);
  }

  /** `models` holds the model and effort chosen for each agent by its profile id; an agent not in it takes its profile's. */
  create(name: string, workspaceId: string, profileIds: string[], permissions: PermissionPreset, models: Record<string, RoomAgentModel> = {}): Room {
    if (!this.store.findWorkspace(workspaceId)) throw new HostProblemError({ code: "workspace-gone" });
    const room = {
      id: crypto.randomUUID(),
      name: this.roomName(name),
      workspaceId,
      agents: this.existingProfiles(profileIds).map((profileId) => ({ profileId, conversationId: null, answering: null, ...checkedModel(models[profileId] ?? PROFILES_MODEL), variables: {}, wholeHostEnvironment: false })),
      permissions: knownPreset(permissions),
      people: [],
      peoplesTasksWait: true,
      claudeSetup: ALL_OF_CLAUDE_SETUP,
      agentsReadGuests: true,
      membersBringAgents: true,
      sandbox: NO_SANDBOX,
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
    if (!agent || agent.brought) return;
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
    this.sandboxLeaves(room);
    this.workspaceIsAskedForAgain(room);
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
   * The room's Claude Code agents that already work there start afresh on it: at once when idle or left with less,
   * otherwise once their turn is over.
   */
  setClaudeSetup(roomId: string, setup: ClaudeSetup) {
    const room = this.existingRoom(roomId);
    const chosen = claudeSetupIn(setup);
    if (CLAUDE_SETUP_PARTS.every((part) => chosen[part] === room.claudeSetup[part])) return;
    this.store.setRoomClaudeSetup(roomId, chosen);
    this.publish(roomId);
    const stopsTurn = narrowsClaudeSetup(room.claudeSetup, chosen);
    room.agents.filter(({ profileId }) => this.store.findProfile(profileId)?.harness === "claude").forEach((agent) => this.startAfresh(agent, stopsTurn));
  }

  /**
   * Whether the agent gets its profile's value of the variable, which the profile sets and may keep from it; choices for
   * names the profile no longer sets go. One that already works in the room starts afresh, as with `setClaudeSetup`.
   */
  chooseAgentVariable(roomId: string, profileId: string, name: string, given: boolean) {
    if (!isVariableName(name) || typeof given !== "boolean") throw new Error("A variable is chosen by its name, given or not.");
    const agent = this.existingRoom(roomId).agents.find((each) => each.profileId === profileId);
    const profile = this.store.findProfile(profileId);
    if (!agent || !profile) return;
    const variables = profileVariablesInRoom(profile.harness, profile.environment, agent.variables);
    const before = variables.find((variable) => variable.name === name);
    if (!before) throw new Error("A variable is chosen among those its profile sets.");
    if (before.fixed) return;
    this.store.setRoomAgentVariables(roomId, profileId, { ...choicesStillNamed(agent.variables, variables.map((variable) => variable.name)), [name]: given });
    this.publish(roomId);
    if (given !== before.given) this.startAfresh(agent, narrows(before.given, given));
  }

  /** Whether the agent gets all of the host's environment; one that already works in the room starts afresh, as with `setClaudeSetup`. */
  setAgentWholeHostEnvironment(roomId: string, profileId: string, given: boolean) {
    if (typeof given !== "boolean") throw new Error("The host's whole environment is given or not.");
    const agent = this.existingRoom(roomId).agents.find((each) => each.profileId === profileId);
    if (!agent || agent.brought || agent.wholeHostEnvironment === given) return;
    this.store.setRoomAgentWholeHostEnvironment(roomId, profileId, given);
    this.publish(roomId);
    this.startAfresh(agent, narrows(agent.wholeHostEnvironment, given));
  }

  /** From the agents' next catch-up on, those already waiting for their turn too, and what rides along with the tasks waiting. */
  setAgentsReadGuests(roomId: string, read: boolean) {
    this.existingRoom(roomId);
    if (typeof read !== "boolean") throw new Error("Agents read guests or not.");
    this.store.setRoomAgentsReadGuests(roomId, read);
    this.publish(roomId);
    if (!read) this.existingRoom(roomId).agents.forEach((agent) => this.catchUpAgainWhatWaits(roomId, agent));
    this.tasksMayCarryOthers(roomId);
  }

  /** The agent's catch-ups waiting for its turn are taken back and made again, as the room now has them read. */
  private catchUpAgainWhatWaits(roomId: string, { profileId, conversationId }: RoomAgent) {
    const waiting = conversationId ? this.sessions.takeQueuedRoomPrompts(conversationId) : [];
    if (!conversationId || waiting.length === 0) return;
    this.store.setRoomSeenThrough(roomId, profileId, this.askedIn(conversationId, Number.MAX_SAFE_INTEGER)?.seq ?? 0);
    waiting.forEach(({ roomMessageId, authorId }) => {
      const asked = this.store.findRoomMessage(roomMessageId);
      if (asked) this.ask(this.existingRoom(roomId), profileId, asked, authorId);
    });
  }

  /**
   * The room's agents run in a sandbox of their own from their next start on, or on this computer again: each starts
   * afresh, at once where the change leaves it with less. A sandbox is turned on only where nothing stands in its way,
   * and one that shares this computer's kernel only where the owner allowed that.
   */
  async setSandbox(roomId: string, given: SandboxSetting) {
    const room = this.existingRoom(roomId);
    const sandbox = keepingNetworkOf(room.sandbox, sandboxSettingIn(given));
    if (sameSandbox(sandbox, room.sandbox)) return;
    if (sandbox.on && !room.sandbox.on) assertSandboxCanRun(await this.sandboxCheck(roomId), sandbox);
    const now = this.existingRoom(roomId);
    if (!sandbox.on) this.sandboxLeaves(now);
    const stopsTurn = narrowsSandbox(now.sandbox, sandbox);
    if (sandbox.on !== now.sandbox.on) this.workspaceIsAskedForAgain(now);
    else if (stopsTurn) this.allEndInWorkspace(now);
    this.store.setRoomSandbox(roomId, sandbox);
    this.sandboxes.networkChanged(roomSandbox(roomId));
    this.publish(roomId);
    this.waitingChanged(roomId);
    const ownAgents = now.agents.filter(({ brought }) => !brought);
    ownAgents.forEach((agent) => this.startAfresh(agent, stopsTurn));
    if (sandbox.on) this.sandboxes.prepare(ownAgents.flatMap(({ profileId }) => this.store.findProfile(profileId) ?? []));
  }

  /** What the room's sandbox reaches besides the model and Mirador, while it is on: from now on, in sessions under way too. */
  setSandboxNetwork(roomId: string, network: SandboxNetwork) {
    const room = this.existingRoom(roomId);
    if (!room.sandbox.on || room.sandbox.network === network) return;
    this.store.setRoomSandbox(roomId, { ...room.sandbox, network });
    this.sandboxes.networkChanged(roomSandbox(roomId));
    this.publish(roomId);
    this.waitingChanged(roomId);
  }

  /** A sandbox leaving its workspace and its folders read and write leaves the repositories' hooks off in them a while yet. */
  private sandboxLeaves(room: Room) {
    if (!room.sandbox.on) return;
    const workspace = this.store.findWorkspace(room.workspaceId);
    if (workspace) sandboxLeft(this.store, workspace.path);
    sandboxLeftWritableFolders(this.store, roomSandbox(room.id));
  }

  async sandboxCheck(roomId: string): Promise<SandboxCheck> {
    const room = this.existingRoom(roomId);
    const workspace = this.store.findWorkspace(room.workspaceId);
    const workspaceRefused = workspace ? await this.sandboxes.workspaceRefusal(workspace.path, room.sandbox.on ? undefined : roomSandbox(roomId)) : null;
    const agentsRefused = room.agents.flatMap((agent) => this.sandboxBlockerOf(agent) ?? []);
    return { availability: this.sandboxes.availability(), blockers: [...agentsRefused, ...(workspaceRefused ? [workspaceRefused] : [])] };
  }

  /** An agent someone brought runs on their own computer, so no sandbox here is its business; in one, no agent gets this computer's whole environment. */
  private sandboxBlockerOf({ profileId, brought, variables }: RoomAgent): SandboxBlocker | null {
    const profile = this.store.findProfile(profileId);
    if (brought || !profile) return null;
    return profileSandboxBlocker(profile, { variables, wholeHostEnvironment: false });
  }

  async answerHeldChange(roomId: string, changeId: string, answer: HeldChangeAnswer) {
    this.existingRoom(roomId);
    if (!isHeldChangeAnswer(answer)) throw new Error("A held change is allowed or discarded.");
    await this.sandboxes.answerHeldChange(roomSandbox(roomId), changeId, answer);
  }

  private startAfresh({ conversationId }: RoomAgent, stopsTurn: boolean) {
    if (conversationId) this.sessions.startAfreshInRoom(conversationId, { stopsTurn });
  }

  /**
   * Lets the person into the room with the role, unless their name reads as one already there, or gives them that role
   * there, from their next message on; made a guest, they ask the agents nothing, so their tasks still waiting are declined.
   * Who approves follows their role, so what waits in the room is told again.
   */
  setPersonRole(roomId: string, personId: string, role: RoomRole) {
    const room = this.existingRoom(roomId);
    if (!isRoomRole(role)) throw new Error(`There is no room role "${role}".`);
    if (personId === this.store.ownerId() || !this.store.listPeople().some(({ id }) => id === personId)) throw new HostProblemError({ code: "room-person-unknown" });
    const comingIn = !room.people.some((person) => person.personId === personId);
    if (comingIn && this.nameTakenIn(room, personId)) throw new HostProblemError({ code: "room-person-name-taken" });
    this.store.setRoomPersonRole(roomId, personId, role);
    if (!asksAgentsAs(role)) this.takeOutAgentsOf(roomId, personId);
    else if (approvesIn(room, personId) && !approvesAs(role)) this.workspaceIsAskedForAgainOf(room, personId);
    this.peopleChanged(roomId);
    this.declineTasksNoLongerAsked(roomId);
    this.waitingChanged(roomId);
  }

  /** The person's open pages lose the room at once, and their tasks still waiting are declined; out of their last room, they lose their devices here too. */
  removePerson(roomId: string, personId: string) {
    this.existingRoom(roomId);
    if (personId === this.store.ownerId()) throw new HostProblemError({ code: "room-person-unknown" });
    this.takeOutAgentsOf(roomId, personId);
    this.store.removeRoomPerson(roomId, personId);
    this.peopleChanged(roomId);
    this.declineTasksNoLongerAsked(roomId);
    this.waitingChanged(roomId);
    this.tellOfPeopleInNoRoom([personId]);
  }

  delete(roomId: string) {
    const room = this.existingRoom(roomId);
    room.agents.forEach(({ conversationId }) => conversationId && this.sessions.deleteWithAllItHolds(conversationId));
    this.workspaceCalls.endAll((sent) => sent.roomId === roomId);
    void this.sandboxes.ownerGone(roomSandbox(roomId));
    this.sandboxLeaves(room);
    this.store.deleteRoom(roomId);
    this.hub.broadcast({ type: "room.deleted", roomId });
    if (room.people.length === 0) return;
    this.peopleListed();
    this.tellOfPeopleInNoRoom(room.people.map(({ personId }) => personId));
  }

  /** Whether the room's members may bring agents of their own Miradors; turned off, the agents they brought go at once. */
  setMembersBringAgents(roomId: string, allowed: boolean) {
    if (typeof allowed !== "boolean") throw new Error("Members bring agents or not.");
    this.existingRoom(roomId);
    this.store.setRoomMembersBringAgents(roomId, allowed);
    if (!allowed) this.existingRoom(roomId).agents.filter(({ brought }) => brought).forEach((agent) => this.takeOut(this.existingRoom(roomId), agent));
    this.publish(roomId);
  }

  /**
   * An agent a member brings from their own Mirador, where it runs, under the name of its profile there, cleaned as a
   * person's is and numbered when the room already has one that reads the same; the id this machine knows it by. One
   * brought to work in the room's workspace, here, does so only once the owner or an approver lets it.
   */
  bringAgent(roomId: string, personId: string, name: string, harness: HarnessId, worksInRoom = false): string {
    const room = this.existingRoom(roomId);
    const role = room.people.find((person) => person.personId === personId)?.role;
    if (!role || !asksAgentsAs(role) || !room.membersBringAgents) throw new HostProblemError({ code: "room-bringing-not-yours" });
    if (typeof name !== "string" || !harnessIds.includes(harness) || typeof worksInRoom !== "boolean") throw new Error("An agent is brought by its name and kind.");
    if (room.agents.filter(broughtBy(personId)).length >= MOST_AGENTS_BROUGHT) throw new HostProblemError({ code: "room-agents-brought-too-many" });
    if (!this.bringing.allows(personId)) throw new HostProblemError({ code: "room-bringing-too-fast" });
    const agentId = crypto.randomUUID();
    this.store.addBroughtAgent(roomId, agentId, { personId, name: this.freeAgentName(room, personId, name), harness, ...(worksInRoom && { workspace: "asked" as const }) }, this.hub.carriesAgentsOf(personId));
    this.publish(roomId);
    if (worksInRoom) {
      this.waitingChanged(roomId);
      this.workspaceWaits(this.existingRoom(roomId), agentId);
    }
    return agentId;
  }

  /** The owner or an approver lets the agent someone brought for it work in the room's workspace, or no longer, which ends what it has under way there. */
  answerWorkspace(roomId: string, agentId: string, answer: RoomWorkspaceAnswer, personId: string) {
    const room = this.existingRoom(roomId);
    this.assertMayApprove(room, personId);
    if (!isRoomWorkspaceAnswer(answer)) throw new Error("An agent is let into the workspace or not.");
    if (!room.agents.some(({ profileId, brought }) => profileId === agentId && brought?.workspace !== undefined)) throw new HostProblemError({ code: "brought-agent-gone" });
    this.store.setBroughtAgentWorkspace(roomId, agentId, answer === "allow" ? "allowed" : "declined");
    if (answer === "decline") this.endsInWorkspace(roomId, agentId);
    this.publish(roomId);
    this.waitingChanged(roomId);
  }

  answerWorkspaceCall(roomId: string, callId: string, answer: TaskAnswer, personId: string) {
    const room = this.existingRoom(roomId);
    this.assertMayApprove(room, personId);
    if (answer !== "allow" && answer !== "deny") throw new Error(`There is no answer "${answer}" to a call.`);
    this.workspaceCalls.answer(roomId, callId, answer, personId);
  }

  workspaceCalled(sent: WorkspaceCallSent) {
    return this.workspaceCalls.called(sent);
  }

  workspaceCallStopped(stopped: Omit<WorkspaceCallSent, "taskId" | "call">) {
    this.workspaceCalls.stopped(stopped);
  }

  /** What agents people brought did in the room's workspace, and have under way there. */
  workspaceCallsIn(roomId: string): RoomWorkspaceCall[] {
    return this.store.listWorkspaceCalls(roomId);
  }

  /** What agents people brought wait on for an approver, to work in the room's workspace: those still to be let in first. */
  workspaceWaiting(roomId: string): RoomWorkspaceApproval[] {
    const room = this.store.findRoom(roomId);
    if (!room) return [];
    const approvers = this.approversOf(room);
    const asking = room.agents.filter(({ brought }) => brought?.workspace === "asked").map(({ profileId }) => ({ asks: "access" as const, roomId, agentId: profileId, at: 0, approvers, sandboxNetwork: networkWhileOn(room.sandbox) }));
    return [...asking, ...this.workspaceCalls.waitingIn(roomId).map((call) => this.workspaceCallWaiting(call, room, approvers))];
  }

  allWorkspaceWaiting(): RoomWorkspaceApproval[] {
    return this.list().flatMap(({ id }) => this.workspaceWaiting(id));
  }

  private workspaceCallWaiting({ shown, whole, messageId, inSandbox }: WorkspaceCallUnderWay, { sandbox }: Room, approvers: string[]): RoomWorkspaceApproval {
    const { id, roomId, agentId, threadId, at, kind, about } = shown;
    const asked = this.store.findRoomMessage(messageId);
    const messagesById = new Map(this.store.listRoomMessages(roomId).map((message) => [message.id, message]));
    return { asks: "call", roomId, agentId, callId: id, threadId, at, kind, about, shown: whole, sandboxNetwork: inSandbox ? sandbox.network : null, task: asked ? taskOf(asked, messagesById, this.store.ownerId()) : null, approvers };
  }

  /** Approvers hear of it as of a request. */
  private workspaceWaits(room: Room, agentId: string) {
    this.notifications.roomTaskHeld(room, { kind: "permission", tool: `the room's workspace, for ${this.nameOf({ profileId: agentId })}` });
  }

  /** Where the agent someone brought works in the room's workspace: in the room's sandbox alone where it has one, else on this computer; null where the workspace is gone. */
  private workspacePlaceOf(room: Room, agentId: string, commandEnvironment: () => Record<string, string>): WorkspacePlace | null {
    const given = this.store.findWorkspace(room.workspaceId)?.path;
    const workspace = given === undefined ? null : realPathOrNull(given);
    if (workspace === null) return null;
    if (!room.sandbox.on) return onThisComputer(workspace, this.dataDir, commandEnvironment);
    const owner = roomSandbox(room.id);
    const worksHere = ({ id }: Profile) => room.agents.some(({ profileId }) => profileId === id);
    const profiles = this.store.listProfiles().toSorted((a, b) => Number(worksHere(b)) - Number(worksHere(a)));
    return inRoomsSandbox(workspace, {
      launch: (command) => this.sandboxes.launchForBrought({ owner, agentId, allowsSharedKernel: room.sandbox.allowsSharedKernel, profiles, workingDirectory: workspace, command }),
      stop: () => this.sandboxes.stopBrought(owner, agentId),
    });
  }

  /** What the agent someone brought has under way in the room's workspace ends, and all that runs of it there with its VM. */
  private endsInWorkspace(roomId: string, agentId: string) {
    this.workspaceCalls.endAll((sent) => sent.roomId === roomId && sent.agentId === agentId);
    void this.sandboxes.stopBrought(roomSandbox(roomId), agentId);
  }

  private allEndInWorkspace({ id, agents }: Room) {
    agents.filter(({ brought }) => brought?.workspace !== undefined).forEach(({ profileId }) => this.endsInWorkspace(id, profileId));
  }

  /** The agents let into the room's workspace are asked about again, as it is another folder, or no longer the same place. */
  private workspaceIsAskedForAgain(room: Room) {
    this.allEndInWorkspace(room);
    this.store.askForWorkspaceAgain(room.id);
  }

  /** Who approves no longer may have let their own agents in, and the tasks they gave them through: the agents are asked about again. */
  private workspaceIsAskedForAgainOf(room: Room, personId: string) {
    room.agents.filter(broughtBy(personId)).forEach(({ profileId }) => this.endsInWorkspace(room.id, profileId));
    this.store.askForWorkspaceAgainOf(room.id, personId);
  }

  /** Its bringer, or the owner, takes the agent out: the tasks it has not answered say so in their threads. */
  takeAgentOut(roomId: string, agentId: string, personId: string) {
    const room = this.existingRoom(roomId);
    const agent = room.agents.find((each) => each.profileId === agentId && each.brought);
    if (!agent?.brought) throw new HostProblemError({ code: "brought-agent-gone" });
    if (personId !== this.store.ownerId() && agent.brought.personId !== personId) throw new HostProblemError({ code: "room-agent-not-yours" });
    this.takeOut(room, agent);
    this.publish(roomId);
  }

  /**
   * The person's own Mirador says it takes the tasks of the agents they brought on this socket: the first time it says
   * so there, they show as here, and are sent again what they have not answered.
   */
  broughtAgentsHere(socket: Pick<SocketData, "personId" | "isOwner" | "carriesAgents">) {
    if (socket.isOwner || socket.carriesAgents) return;
    socket.carriesAgents = true;
    this.store.setBroughtAgentsHere(socket.personId, true).forEach((roomId) => this.publish(roomId));
    this.store.roomBroughtTasksOf(socket.personId).forEach((task) => this.sendBroughtTask(socket.personId, task));
  }

  /** The person's own Mirador went: their agents show as away, working on nothing the room sees, until it is back. */
  bringerLeft(personId: string) {
    if (this.hub.carriesAgentsOf(personId)) return;
    this.workspaceCalls.endAll((sent) => sent.personId === personId);
    this.store.setBroughtAgentsHere(personId, false).forEach((roomId) => this.publish(roomId));
  }

  /** The agent the person brought began a turn on a task this machine sent it: the room shows it answering, once, and only so often. */
  broughtTaskStarted(personId: string, roomId: string, agentId: string, taskId: string) {
    const room = this.existingRoom(roomId);
    const agent = this.broughtAgentOf(room, agentId, personId);
    const task = this.store.findRoomBroughtTask(taskId);
    if (task?.roomId !== roomId || task.agentId !== agentId) throw new HostProblemError({ code: "room-brought-task-unknown" });
    if (agent.answering === task.messageId || !this.broughtTaskStarts.allows(personId)) return;
    this.store.setRoomAgentAnsweringIn(roomId, agentId, task.messageId);
    this.publish(roomId);
  }

  /**
   * The final answer of the agent the person brought, to a task this machine sent it and that is not answered yet, goes
   * up in the task's thread as its own agents' answers do: cleaned and cut as a person's text, tagging the people and
   * agents it names after an @, a few turns at most after a person last wrote; or how it ended without one. It is its
   * bringer's word: it tags agents only as they may, and while people's tasks wait, a tag of any agent but theirs waits
   * as their task for an approver.
   */
  broughtTaskAnswered(personId: string, roomId: string, agentId: string, taskId: string, text: string, ended: BroughtAnswerEnd | null) {
    const room = this.existingRoom(roomId);
    const agent = this.broughtAgentOf(room, agentId, personId);
    if (typeof text !== "string" || !(ended === null || isBroughtAnswerEnd(ended))) throw new Error("An answer is its text, and how it ended unless it finished.");
    const task = this.store.takeRoomBroughtTask(taskId, roomId, agentId);
    if (!task) throw new HostProblemError({ code: "room-brought-task-unknown" });
    this.workspaceCalls.endAll((sent) => sent.roomId === roomId && sent.taskId === taskId);
    if (agent.brought?.workspace !== undefined) void this.sandboxes.turnEnded(roomSandbox(roomId)).catch((error: unknown) => console.error(`looking at the held files of the room ${roomId} failed:`, error));
    this.store.setRoomAgentAnsweringIn(roomId, agentId, null);
    this.publish(roomId);
    const asked = this.store.findRoomMessage(task.messageId);
    const thread = asked && this.threadOf(asked, agentId);
    if (!asked || !thread) return;
    const written = cutToRoomMessage(shownAsWritten(text));
    const author = { profileId: agentId };
    const named = ended === null && this.mayTag(room, personId) && this.personBehindMayTag(room, asked) ? this.agentsTaggedBy(room, agentId, written) : [];
    const passedOn = this.agentsMayGoOn(room.id, asked, named.length) ? named : [];
    const waits = this.waitsAsBringersTask(room, personId, passedOn);
    const answer = this.store.appendRoomMessage({
      id: crypto.randomUUID(),
      roomId,
      at: Date.now(),
      author,
      text: written,
      tags: passedOn,
      ...this.mentionsOf(room, written, author),
      threadId: thread.id,
      answers: asked.id,
      ...(ended !== null && { ended }),
      ...(passedOn.length < named.length && { tagsDropped: named }),
      ...(waits && { taskHeld: "waiting" as const }),
      broughtBy: personId,
    });
    this.post(answer, passedOn);
    if (waits) this.holdTask(room, answer, passedOn);
    else passedOn.forEach((profileId) => this.ask(room, profileId, answer, undefined));
  }

  /**
   * While people's tasks wait, a brought agent's answer that tags any agent but those its bringer brought waits as their
   * task, unless its bringer approves; one that tags an agent let into the room's workspace always does.
   */
  private waitsAsBringersTask(room: Room, bringerId: string, tagged: string[]) {
    if (tagged.some((profileId) => worksInWorkspace(room, profileId))) return true;
    const theirs = new Set(room.agents.filter(broughtBy(bringerId)).map(({ profileId }) => profileId));
    return room.peoplesTasksWait && !approvesIn(room, bringerId) && tagged.some((profileId) => !theirs.has(profileId));
  }

  /**
   * Whether the room's preset, or what an approver let through for the rest of the turn, lets the request through without
   * asking; never one that may reach Mirador's own data or change Claude Code's setup, unless the room asks for nothing.
   */
  allowsByItself(conversationId: string, asked: AskedPermission): boolean {
    const room = this.roomOf(conversationId);
    if (room && asksForNothing(room.permissions)) return true;
    if (!room || this.mayReachMiradorsData(room, asked) || changesClaudeSetup(asked, (path) => this.placeInWorkspace(room, path))) return false;
    const freelyReachable = (path: string) => this.freelyReachable(room, path);
    const allowedForTheTask = this.allowedForTurn.get(conversationId)?.has(taskAllowanceOf(asked)) === true && reachedByTaskAllowance(asked, freelyReachable);
    return allowedForTheTask || allowedByPreset(room.permissions, asked, freelyReachable);
  }

  waitingChanged(roomId: string) {
    const approvals = this.approvals(roomId);
    const tasks = this.tasksWaiting(roomId);
    const workspace = this.workspaceWaiting(roomId);
    this.hub.broadcast({ type: "room.approvals", roomId, approvals, tasks, workspace });
    this.waitingListener(roomId, approvals, tasks, workspace);
  }

  /** The tasks of people other than the owner, or of the agents they brought, that wait for an approver, oldest first. */
  tasksWaiting(roomId: string): RoomTaskApproval[] {
    const room = this.store.findRoom(roomId);
    if (!room) return [];
    return this.store.listRoomTasksWaiting(roomId).map((message) => ({
      roomId,
      messageId: message.id,
      profileIds: this.agentsAsked(message),
      ...this.taskGiverOf(message),
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
    if (waiting?.roomId !== roomId || !taskWaits(waiting)) throw new HostProblemError({ code: "room-task-not-waiting" });
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

  /** How many of the requests the room's agents wait on, and of people's tasks, wait there for an approver. */
  countWaiting(roomId: string): number {
    const room = this.store.findRoom(roomId);
    if (!room) return 0;
    const requests = room.agents.flatMap(({ conversationId }) => (conversationId ? this.sessions.waitingPermissions(conversationId) : []));
    return requests.length + this.store.listRoomTasksWaiting(roomId).length + this.workspaceWaiting(roomId).length;
  }

  allApprovals(): RoomApproval[] {
    return this.list().flatMap(({ id }) => this.approvals(id));
  }

  /**
   * Answers a request of the room's own agent, named by its profile, as people other than the owner never learn its
   * conversation. Allowing for the task lets the same kind of request through until the turn ends, the ones already
   * waiting in it too; one that reads or changes files outside the workspace still asks.
   */
  approve(roomId: string, profileId: string, permissionId: string, answer: RoomApprovalAnswer, personId: string) {
    const room = this.existingRoom(roomId);
    this.assertMayApprove(room, personId);
    const conversationId = room.agents.find((agent) => agent.profileId === profileId && !agent.brought)?.conversationId;
    if (!conversationId) throw new HostProblemError({ code: "permission-no-longer-pending" });
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
    const agents = this.existingRoom(roomId).agents.filter(({ brought }) => !brought).map(({ profileId, conversationId }) => ({
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
   * owner or an approver wrote it in a room whose people's tasks wait, or to an agent let into the room's workspace,
   * when it waits for an approver instead.
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
    const approves = role === null || approvesAs(role);
    const waits = !approves && asked.length > 0 && (room.peoplesTasksWait || asked.some((profileId) => worksInWorkspace(room, profileId)));
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
    else asked.forEach((profileId) => this.ask(room, profileId, message, personId, approves));
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
    if (finished && this.writtenByTheOwner(asked)) this.notifications.notify(conversationId, { kind: "finished" });
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
    const others = this.agentsNamed(room).filter(({ agentId }) => agentId !== conversation.profileId && this.answers(room, agentId));
    const ownName = conversation.profileId === null ? undefined : this.store.findProfile(conversation.profileId)?.name;
    const itself = ownName !== undefined && names.some((named) => sameName(named, ownName));
    const tagged = others.filter(({ name }) => names.some((named) => sameName(named, name)));
    const unknown = names.filter((named) => !(ownName !== undefined && sameName(named, ownName)) && !others.some(({ name }) => sameName(named, name)));
    this.store.setRoomAnswerTags(conversationId, answering.id, tagged.map(({ agentId }) => agentId));
    return { tagged: tagged.map(({ name }) => name), itself, unknown, others: others.map(({ name }) => name) };
  }

  /** The room_history tool: older messages of the room the caller was sent, framed as its catch-ups. Null for a conversation that is no agent's in a room. */
  readBack(conversationId: string, query: RoomHistoryQuery): string | null {
    const conversation = this.store.findConversation(conversationId);
    const room = conversation?.roomId ? this.store.findRoom(conversation.roomId) : undefined;
    if (!conversation || !room || conversation.profileId === null) return null;
    const sent = this.store.listRoomMessagesBetween(room.id, 0, this.store.roomSeenThrough(room.id, conversation.profileId));
    return roomHistory(sent.filter(readByAgentsOf(room, this.store.ownerId())), query, this.authorOf);
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

  /** The owner, and the room's approvers, answer what its agents ask. */
  private approversOf(room: Room) {
    return [this.store.ownerId(), ...room.people.filter(({ role }) => approvesAs(role)).map(({ personId }) => personId)];
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

  /** The owner waits for the answer: they tagged the agent, or followed up in its thread, and this machine tells them. */
  private writtenByTheOwner(asked: RoomMessage) {
    return !writtenByAgent(asked.author) && asked.author.personId === this.store.ownerId();
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

  private placeInWorkspace(room: Room, path: string) {
    return this.realPlaceNamed(path, this.store.findWorkspace(room.workspaceId)?.path ?? process.cwd());
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

  /** Whose task a waiting message is: its writer's, or, for a brought agent's answer, its bringer's, a member. */
  private taskGiverOf(task: RoomMessage): Pick<RoomTaskApproval, "personId" | "role" | "byAgent"> {
    if (writtenByAgent(task.author)) return { personId: task.broughtBy!, role: "member", byAgent: task.author.profileId };
    return { personId: task.author.personId, role: authorRoleOf(task, this.store.ownerId()) };
  }

  private allowTask(room: Room, waiting: RoomMessage) {
    const task = this.store.answerRoomTask(waiting.id, null)!;
    this.hub.publishToRoom(room.id, { type: "room.message", message: task, threads: [] });
    const writerId = writtenByAgent(task.author) ? undefined : task.author.personId;
    this.agentsAsked(task)
      .filter((profileId) => this.answers(room, profileId))
      .forEach((profileId) => this.ask(room, profileId, task, writerId, true));
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
    const agents = this.agentsNamed(room).map(({ name }) => name);
    return nameTaken(named, [...people.filter(({ id }) => others.has(id)).map(({ name }) => name), ...agents]);
  }

  /** The writer, or the bringer of the agent that wrote it, is still in the room, in a role that lets them ask what the task asks. */
  private writerMayStillAsk(room: Room, task: RoomMessage) {
    if (task.broughtBy !== undefined) {
      const { author } = task;
      if (writtenByAgent(author) && room.agents.every(({ profileId }) => profileId !== author.profileId)) return false;
      return this.mayTag(room, task.broughtBy);
    }
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

  /** The task waits, and approvers hear of it as of a request: through the conversation of the first of the room's own agents it asks, or from the room. */
  private holdTask(room: Room, task: RoomMessage, asked: string[]) {
    const agent = room.agents.find(({ profileId, brought }) => !brought && asked.includes(profileId));
    const { role, name } = this.authorOf(task);
    const waiting = { kind: "permission" as const, tool: `a task of ${name}, ${role}` };
    if (agent) this.notifications.notify(agent.conversationId ?? this.startSession(room, agent.profileId), waiting);
    else this.notifications.roomTaskHeld(room, waiting);
    this.waitingChanged(room.id);
  }

  /** The declined task's answer, which no agent wrote: it tells the room the agent was never asked. */
  private decline(task: RoomMessage, profileId: string) {
    this.postEnding(task, profileId, "declined");
  }

  /** An answer without words, which says in the task's thread how the task ended without reaching the agent. */
  private postEnding(task: RoomMessage, profileId: string, ended: RoomAnswerEnd) {
    const thread = this.threadOf(task, profileId);
    if (!thread) return;
    const ending = this.store.appendRoomMessage({
      id: crypto.randomUUID(),
      roomId: task.roomId,
      at: Date.now(),
      author: { profileId },
      text: "",
      tags: [],
      threadId: thread.id,
      answers: task.id,
      ended,
    });
    this.post(ending, []);
  }

  /** The agent of the room the person brought; anyone else's, or one gone, is not theirs to act for. */
  private broughtAgentOf(room: Room, agentId: string, personId: string) {
    const agent = room.agents.find((each) => each.profileId === agentId && each.brought);
    if (!agent?.brought) throw new HostProblemError({ code: "brought-agent-gone" });
    if (agent.brought.personId !== personId) throw new HostProblemError({ code: "room-agent-not-yours" });
    return agent;
  }

  /** The agents the person brought into the room go, as when taken out. */
  private takeOutAgentsOf(roomId: string, personId: string) {
    const room = this.existingRoom(roomId);
    const theirs = room.agents.filter(broughtBy(personId));
    theirs.forEach((agent) => this.takeOut(this.existingRoom(roomId), agent));
    if (theirs.length > 0) this.publish(roomId);
  }

  /** The agents the person brought into any room go, as when taken out. */
  takeOutAgentsOfEverywhere(personId: string) {
    this.store.roomsOf(personId).forEach(({ id }) => this.takeOutAgentsOf(id, personId));
  }

  private takeOut(room: Room, agent: RoomAgent) {
    const heldForOrBy = this.store
      .listRoomTasksWaiting(room.id)
      .filter(
        (task) =>
          (writtenByAgent(task.author) && task.author.profileId === agent.profileId) ||
          (this.agentsAsked(task).includes(agent.profileId) && this.agentsAsked(task).every((id) => id === agent.profileId || !this.answers(room, id))),
      );
    heldForOrBy.forEach((task) => this.declineTask(room, task));
    this.store.roomBroughtTasksOfAgent(room.id, agent.profileId).forEach(({ messageId }) => {
      const asked = this.store.findRoomMessage(messageId);
      if (asked) this.postEnding(asked, agent.profileId, "taken-out");
    });
    this.endsInWorkspace(room.id, agent.profileId);
    this.store.removeBroughtAgent(room.id, agent.profileId);
    if (agent.brought?.workspace !== undefined || heldForOrBy.length > 0) this.waitingChanged(room.id);
  }

  /**
   * The person's name as it would be on a brought agent: their own name and the agent's, which may not be blank, has to
   * read as no name Mirador puts in an author's place and pass the rules a person's name does, and is numbered when it
   * reads as another of the room's.
   */
  private freeAgentName(room: Room, personId: string, asked: string) {
    const name = personName(shownAsWritten(asked));
    if (!name) throw new Error("An agent is brought under a name.");
    const refused = nameRefused(name);
    if (refused) throw new HostProblemError({ code: refused });
    const bringer = this.nameOf({ personId });
    const taken = this.namesIn(room);
    const free = [name, ...NUMBERS_AFTER_A_TAKEN_NAME.map((number) => `${name} ${number}`)].find((each) => !readsAsMiradorsWords(each) && !nameTaken(broughtAgentName(bringer, each), taken));
    if (free === undefined) throw new HostProblemError({ code: "room-agent-name-taken" });
    return free;
  }

  /** Whom the room shows and frames by name: its owner, its people and who wrote there, and its agents; besides a person, without them and the agents they brought. */
  private namesIn(room: Room, besides: string | null = null) {
    const people = this.store.listPeople();
    const inRoom = new Set([this.store.ownerId(), ...room.people.map(({ personId }) => personId), ...this.store.writersIn(room.id)].filter((id) => id !== besides));
    const theirAgents = new Set(besides === null ? [] : room.agents.filter(broughtBy(besides)).map(({ profileId }) => profileId));
    const agents = this.agentsNamed(room).filter(({ agentId }) => !theirAgents.has(agentId));
    return [...people.filter(({ id }) => inRoom.has(id)).map(({ name }) => name), ...agents.map(({ name }) => name)];
  }

  /** Whether the agents the person brought would read, under this new name of theirs, as no one else in their rooms. */
  broughtAgentsFreeUnder(personId: string, name: string) {
    return this.store.roomsOf(personId).every((room) => {
      const taken = this.namesIn(room, personId);
      return room.agents.filter(broughtBy(personId)).every(({ brought }) => !nameTaken(broughtAgentName(name, brought.name), taken));
    });
  }

  /** Every agent of the room by the name the room calls it: its profile's, or for one a person brought, theirs and its own. */
  private agentsNamed(room: Room): TaggableAgent[] {
    return room.agents.flatMap((agent) => {
      const name = agent.brought ? broughtAgentName(this.nameOf({ personId: agent.brought.personId }), agent.brought.name) : this.store.findProfile(agent.profileId)?.name;
      return name === undefined ? [] : [{ agentId: agent.profileId, name }];
    });
  }

  /** The other agents of the room a brought agent's answer tags by an @ and their name. */
  private agentsTaggedBy(room: Room, agentId: string, text: string) {
    return agentsTaggedIn(text, this.peopleTaggable(room, { profileId: agentId }), this.agentsNamed(room)).filter((each) => each !== agentId && this.answers(room, each));
  }

  private sendBroughtTask(personId: string, task: RoomBroughtTask) {
    this.hub.sendToAgentsOf(personId, {
      type: "room.brought-task",
      personId,
      roomId: task.roomId,
      agentId: task.agentId,
      taskId: task.id,
      text: task.prompt,
      byName: task.byName,
      byRole: task.byRole,
      fromYou: task.fromBringer,
    });
  }

  /**
   * A task for an agent a person brought goes to their own Mirador as one of the room's own agents would be sent it, with
   * who wrote it in what role, once; while that Mirador is away, the task's thread says so and the agent reads it later.
   */
  private askBrought(room: Room, agent: RoomAgent, brought: BroughtAgent, message: RoomMessage, letThrough: boolean) {
    if (!this.hub.carriesAgentsOf(brought.personId)) return this.postEnding(message, agent.profileId, "away");
    const introduced = this.store.roomSeenThrough(room.id, agent.profileId) === 0;
    const prompt = this.catchUp(room, agent.profileId, introduced ? this.roomThrough(room, message) : this.unseenBy(room, agent.profileId, message), message, introduced);
    this.store.markRoomSeen(room.id, agent.profileId, message.seq);
    const { name, role } = this.authorOf(message);
    const task: RoomBroughtTask = {
      id: crypto.randomUUID(),
      roomId: room.id,
      agentId: agent.profileId,
      messageId: message.id,
      prompt,
      byName: name,
      byRole: role,
      fromBringer: !writtenByAgent(message.author) && message.author.personId === brought.personId,
      letThrough,
      sentAt: Date.now(),
    };
    this.store.insertRoomBroughtTask(task);
    this.sendBroughtTask(brought.personId, task);
    this.tasksMayCarryOthers(room.id);
  }

  /** The room's messages up to and with the one the agent is asked that it has not seen and may read; never its own. */
  private unseenBy(room: Room, profileId: string, asked: RoomMessage) {
    const readByAgents = readByAgentsOf(room, this.store.ownerId());
    return this.store
      .listRoomMessagesBetween(room.id, this.store.roomSeenThrough(room.id, profileId), asked.seq)
      .filter((each) => readByAgents(each) && !(writtenByAgent(each.author) && each.author.profileId === profileId));
  }

  /** What an agent introduced to the room reads of it: every message through the one it is asked that agents may read, its own too. */
  private roomThrough(room: Room, asked: RoomMessage) {
    return this.store.listRoomMessagesBetween(room.id, 0, asked.seq).filter(readByAgentsOf(room, this.store.ownerId()));
  }

  private catchUp(room: Room, profileId: string, unseen: RoomMessage[], asked: RoomMessage, introduced: boolean) {
    return catchUpPrompt({
      roomName: room.name,
      unseen: unseen.length > 0 ? unseen : [asked],
      authorOf: this.authorOf,
      ...(introduced && { introducedAs: this.nameOf({ profileId }) }),
      otherAgents: this.otherAgentNames(room, profileId),
      attendance: room.agents.some((agent) => agent.profileId === profileId && agent.brought) ? "brought" : "own",
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

  /**
   * An agent new to the room, or on a new conversation there, is introduced to it with the room's messages so far.
   * `letThrough` says the owner or an approver wrote or allowed the message; no agent's tag is.
   */
  private ask(room: Room, profileId: string, message: RoomMessage, personId: string | undefined, letThrough = false) {
    const agent = room.agents.find((each) => each.profileId === profileId)!;
    if (agent.brought) return this.askBrought(room, agent, agent.brought, message, letThrough);
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
    const mentions = mentionsIn(text, this.peopleTaggable(room, author), this.agentsNamed(room));
    return mentions.length > 0 ? { mentions } : {};
  }

  /** The people of the room a message of the author can tag: the owner and the room's people, never the writer, nor anyone whose name reads as another's here. */
  private peopleTaggable(room: Room, author: RoomAuthor) {
    const people = this.store.listPeople();
    const inRoom = [{ personId: this.store.ownerId() }, ...room.people.filter(({ nameClash }) => nameClash === undefined)];
    return inRoom.flatMap(({ personId }) => {
      const name = people.find(({ id }) => id === personId)?.name ?? "";
      return writtenByAgent(author) || author.personId !== personId ? [{ personId, name }] : [];
    });
  }

  /**
   * The agents the turn named to tag, kept through a restart of the host and taken however the turn ends, so a stopped
   * turn's leave none for a later one; they tag only while the person the answer works for may tag agents themselves.
   */
  private tagsFor(named: { answering: string; profileIds: string[] } | undefined, room: Room, answering: RoomMessage) {
    return named?.answering === answering.id && this.personBehindMayTag(room, answering) ? named.profileIds : [];
  }

  /** An agent's answer works for the person whose message began its chain, stopping at a brought agent's bringer. */
  private personBehindMayTag(room: Room, answering: RoomMessage) {
    const personId = personIdBehind(answering, new Map(this.store.listRoomMessages(room.id).map((message) => [message.id, message])));
    return personId !== null && this.mayTag(room, personId);
  }

  /** The owner may tag agents in every room, and a member in theirs. */
  private mayTag(room: Room, personId: string) {
    return personId === this.store.ownerId() || room.people.some((person) => person.personId === personId && asksAgentsAs(person.role));
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
    return this.agentsNamed(room).flatMap(({ agentId, name }) => (agentId === profileId ? [] : [name]));
  }

  /** An agent of the room whose profile is still there to take a turn, or one a person brought, whose Mirador answers for it. */
  private answers(room: Room, profileId: string) {
    return hasAgent(room, profileId) && (room.agents.some((agent) => agent.profileId === profileId && agent.brought) || this.store.findProfile(profileId) !== undefined);
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

  private nameOf(author: RoomAuthor): string {
    if (writtenByAgent(author)) return this.store.findProfile(author.profileId)?.name ?? this.broughtAgentNamed(author.profileId) ?? AGENT_GONE;
    const person = this.store.listPeople().find(({ id }) => id === author.personId);
    return author.personId === this.store.ownerId() ? person?.name || OWNER_WITHOUT_A_NAME : personGoesBy(person, PERSON_WITHOUT_A_NAME);
  }

  private broughtAgentNamed(agentId: string): string | undefined {
    const brought = this.store.findBroughtAgent(agentId);
    return brought && broughtAgentName(this.nameOf({ personId: brought.personId }), brought.name);
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
