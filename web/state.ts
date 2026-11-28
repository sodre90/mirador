import type { EditorState } from "../shared/editors.ts";
import { DEFAULT_CONVERSATIONS_SHOWN, DEFAULT_OLDER_AFTER, DEFAULT_SIDE_CHAT_ACCESS, type ConversationsShown, type OlderAfter, type SideChatAccess } from "../shared/model.ts";
import type { CanvasItem, CanvasUse, KeepAwake, KeepDeletedCanvas, ClaudeProgram, Conversation, HarnessId, JoinRequest, Machine, MachineSeen, MachineStatus, Person, Profile, PromptTemplate, StoredEvent, Workspace, WorkspaceGroup } from "../shared/model.ts";
import { DEFAULT_MORNING_MINUTES, type ReminderMode } from "../shared/reminders.ts";
import type { ReminderUndo } from "./reminders.ts";
import type { PushRelaySetting } from "../shared/push.ts";
import type { NewerVersion } from "../shared/newer-version.ts";
import { appKey, type AppDocumentState, type AppliedPluginUpdate, type InstalledApp, type OpenApp, type PluginUpdate, type PluginUpdateMode, type RevokedPlugin } from "../shared/apps.ts";
import type { ServerMessage } from "../shared/protocol.ts";
import type { Turn } from "../shared/reverts.ts";
import { CUSTOM_ORDER, type ConversationOrder } from "../shared/conversation-order.ts";
import type { ConfigFileStatus } from "../shared/settings-file.ts";
import { turnTimesOf, type HeldTurnTimes } from "./navigation.ts";
import { inSidebarOrder } from "../shared/sidebar-order.ts";
import { withStreamedEvent } from "../shared/timeline.ts";
import { defaultVoiceSettings, type VoiceSettings } from "../shared/voice.ts";
import type { VoiceEngineStatus } from "../shared/voice-engine.ts";
import { lastsUntilOpened } from "../shared/waiting.ts";
import type { WorkspaceIcon } from "../shared/workspace-icon.ts";
import { describedText, hostErrorText } from "./host-error.ts";
import type { RoomSettingsTab } from "./i18n/en/rooms.ts";
import type { RoomBroughtStep, RoomWorkspaceApproval, RoomWorkspaceCall } from "../shared/room-workspace.ts";
import { agentStandIn, shownOnRoomCanvas, type Room, type RoomApproval, type RoomInvite, type RoomJoiner, type RoomPresence, type RoomTaskApproval, type RoomTimeline } from "../shared/rooms.ts";
import type { RoomReading } from "../shared/room-reading.ts";
import type { BroughtAgentHere, BroughtTaskWaiting } from "../shared/brought-agents.ts";
import type { RoomQuestionVotes } from "../shared/room-votes.ts";
import { NO_SANDBOX_ENGINES, roomSandbox, sameOwner, workspaceSandbox, type HeldChange, type OwnedSetup, type SandboxEngines, type SandboxFolders, type SandboxOwner } from "../shared/sandbox.ts";

export interface OpenConversation {
  conversationId: string;
  loaded: boolean;
  /** The newest part of the history at first; earlier parts come as the reader scrolls up to them. */
  events: StoredEvent[];
  /** The host holds events before these. */
  hasEarlier: boolean;
  canvas: CanvasItem[];
}

/** A host from before the editor setting opens files in IDEA. */
const UNKNOWN_EDITOR: EditorState = { setting: { editor: "idea" }, found: [], opensIn: "IDEA" };

export type Overlay =
  | { kind: "palette" }
  /** `text` and `mode` come from a /later or /remind whose time the picker could not read. */
  | { kind: "reminder"; conversationId: string; text?: string; mode?: ReminderMode }
  | { kind: "help" }
  | { kind: "search" }
  /** `pluginRow` opens that profile on its Plugins tab, with that plugin's row open. */
  | { kind: "profiles"; pluginRow?: { profileId: string; plugin: string } }
  | { kind: "machines" }
  | { kind: "plugins" }
  | { kind: "sessions"; workspaceId: string }
  | { kind: "workspace-color"; workspaceId: string }
  | { kind: "worktrees"; workspaceId: string }
  | { kind: "workspace-sandbox"; workspaceId: string }
  | { kind: "add-workspace" }
  | { kind: "add-workspace-group"; parentId: string | null }
  | { kind: "new-room" }
  /** A room's settings, at one of their tabs. */
  | { kind: "room"; roomId: string; tab?: RoomSettingsTab }
  /** Making an invite into the room for one person. */
  | { kind: "room-invite"; roomId: string }
  /** Joining someone else's room with the invite they sent. */
  | { kind: "join-room" }
  /** An agent of one of your profiles into a room of a machine you joined as a person. */
  | { kind: "bring-agent"; machineId: string; roomId: string }
  /** `rewind` takes the conversation and the files back; without it only the files are put back. */
  | { kind: "revert"; conversationId: string; turn: Turn; rewind?: boolean }
  | { kind: "settings"; page?: SettingsPage };

/** A part of Settings to open at, rather than at the top. */
export type SettingsPage = "appearance" | "conversations" | "agents" | "voice" | "terminal" | "canvas" | "layout" | "devices" | "notifications" | "transfer" | "about";

export type DevicesListed = Extract<ServerMessage, { type: "devices.listed" }>;

/** A room's messages and threads, with the pages and questions of its canvas. */
export type RoomTimelineWithCanvas = RoomTimeline & { canvas: CanvasItem[]; votes: RoomQuestionVotes[]; workspaceCalls: RoomWorkspaceCall[]; broughtSteps: RoomBroughtStep[] };

/** A plugin's tab in a workspace, as its host code last said. */
export interface PluginTabState {
  seq: number;
  shown: boolean;
  state: unknown;
  problem: string | null;
}

/** What a row's menu, or the Older fold, asks to delete together, as its prompt opens. */
export type DeleteTogetherRequest = {
  /** Kept apart from the row, so the prompt still names the workspace once that row is gone. */
  workspaceId: string;
  conversationIds: string[];
  /** Those left out, as they or what they hold are at work or wait for the user. */
  staying: number;
} & (
  | {
      which: "others" | "below";
      /** The row whose menu asked, which the prompt sits beside. */
      fromConversationId: string;
      /** Its title as the menu opened, which names it while the prompt asks, even once it is gone. */
      fromTitle: string;
    }
  /** The Older fold asked, so the prompt sits beside its line. */
  | { which: "older" }
);

export type DeletingTogether = DeleteTogetherRequest & {
  /** Sent to the host, which deletes them, or first asks about the uncommitted files their worktrees hold. */
  sent: boolean;
  /** What the host asked before deleting them: the uncommitted files their worktrees hold. */
  asked: { conversationIds: string[]; uncommittedFiles: number; branches: string[] } | null;
};

/** The host deleted one of those it was sent, so the prompt's work is done. */
const deletedTogether = (deleting: DeletingTogether | null, conversationId: string) => Boolean(deleting?.sent && deleting.conversationIds.includes(conversationId));

/** The host's ask names no request, so it answers the prompt's only when the prompt sent and it names none but the prompt's. */
const answersDeletingTogether = (deleting: DeletingTogether | null, conversationIds: string[]): deleting is DeletingTogether =>
  Boolean(deleting?.sent && conversationIds.every((id) => deleting.conversationIds.includes(id)));

export interface AppState {
  workspaces: Workspace[];
  workspaceGroups: WorkspaceGroup[];
  /** By workspace id, as the host finds them. */
  workspaceIcons: Record<string, WorkspaceIcon | null>;
  conversations: Conversation[];
  rooms: Room[];
  /** The agents' conversations in rooms, which no list of conversations shows. */
  roomConversations: Conversation[];
  /** The requests the agents of every room wait on, oldest first in each room. */
  roomApprovals: RoomApproval[];
  /** The tasks of people other than the owner that wait for an approver, oldest first in each room. */
  roomTasksWaiting: RoomTaskApproval[];
  /** What agents people brought wait on for an approver, to work in the rooms' workspaces, on this machine. */
  roomWorkspaceWaiting: RoomWorkspaceApproval[];
  /** The room invites nobody has used yet, soonest to expire first; those of a deleted room went with it. */
  roomInvites: RoomInvite[];
  /** Who waits at the door of which room for the owner to let them in, as the host last listed them. */
  roomJoiners: RoomJoiner[];
  /** On a page of a person other than the owner: the rooms here they wait to be let into. */
  waitingToJoin: string[];
  /** Where setting up each room's and workspace's sandbox stands on this computer. */
  sandboxSetups: OwnedSetup[];
  /** The agent config file changes sandboxed agents made, held for the owner's answer. */
  heldChanges: HeldChange[];
  /** The rooms and workspaces whose sandbox stopped as they hold as many changes as one may. */
  sandboxesHoldingTooMany: SandboxOwner[];
  /** The folders of this computer each room or workspace gave its sandbox. */
  sandboxFolders: SandboxFolders[];
  /** The agents you brought into rooms of other machines, and the tasks of others that wait for your OK. */
  broughtAgents: BroughtAgentHere[];
  broughtTasks: BroughtTaskWaiting[];
  /** Whether this page shows the rooms of other machines, and so the conversations of the agents you brought there in their rooms rather than in any list. */
  broughtShownInRooms: boolean;
  /** The conversations of the agents you brought, and of what was forked or asked beside them, while `broughtShownInRooms`; no list of conversations shows them. */
  broughtConversations: Conversation[];
  /** The conversations of the agents you brought into the room of another machine that is shown, subscribed as the kept conversations are. */
  broughtWork: OpenConversation[];
  /** The agent you brought whose work shows beside its room, by its conversation. */
  broughtWorkShown: string | null;
  /** Counts the openings of rooms of other machines, so each is told to the host, also of the room shown already. */
  joinedRoomOpenings: number;
  /** The rooms someone other than the owner is in now. */
  roomsWithPeopleHere: string[];
  /** How far you have read each of your rooms, and what waits for you there. */
  roomReadings: RoomReading[];
  /** The room shown in the main pane instead of a conversation. */
  selectedRoomId: string | null;
  /** The door of a room on someone else's machine this computer's owner waits at, or was turned away from, shown in the main pane instead. */
  selectedKnock: { machineId: string; roomId: string } | null;
  /** The room of someone else's machine shown in the main pane instead; with no room, the first that machine lists, or what it needs to be joined. */
  selectedJoinedRoom: { machineId: string; roomId: string | null } | null;
  /** The shown room's messages and threads, and the pages and questions of its canvas, once the host sent them. */
  roomTimeline: (RoomTimelineWithCanvas & { roomId: string }) | null;
  /** Who is in the shown room now, and who of them writes there, once the host said. */
  roomPresence: (RoomPresence & { roomId: string }) | null;
  /** The agents' conversations whose threads are shown beside their room, subscribed as the kept conversations are. */
  threadConversations: OpenConversation[];
  profiles: Profile[];
  promptTemplates: PromptTemplate[];
  canvasUse: CanvasUse;
  keepAwake: KeepAwake;
  keepDeletedCanvas: KeepDeletedCanvas;
  /** Minutes after midnight that "morning" means for reminders. */
  reminderMorning: number;
  conversationOrder: ConversationOrder;
  /** The settings file the host read as it started; null when there is to be none, unknown to an older host. */
  configFile: ConfigFileStatus | null | undefined;
  olderAfter: OlderAfter;
  conversationsShown: ConversationsShown;
  sideChatAccess: SideChatAccess;
  heldTurnTimes: HeldTurnTimes | null;
  /** The reminder this page set last, until its toast goes. */
  reminderUndo: (ReminderUndo & { id: number }) | null;
  claudeProgram: ClaudeProgram;
  /** The program the host opens scripts in, as text; empty for the system's text editor. */
  scriptProgram: string;
  sandboxEngines: SandboxEngines;
  /** The base image of the sandboxes that name none of their own; null for Mirador's own. */
  sandboxBaseImage: string | null;
  /** The editor the host opens files at a line in, and the ones it finds. */
  editor: EditorState;
  /** The name Settings gave this machine; null while it goes by its computer's name. */
  machineName: string | null;
  computerName: string;
  pushRelay: PushRelaySetting;
  /** The user's profile picture as a small square PNG data URL; null when they set none. */
  avatar: string | null;
  /** Everyone who writes in the host's conversations, the owner first. */
  people: Person[];
  /** Whose picture `avatar` is; null until the snapshot. */
  ownerId: string | null;
  /** The person this page signed in as; null until the snapshot. */
  you: string | null;
  voiceSettings: VoiceSettings;
  voiceEngine: VoiceEngineStatus;
  /** The agents the host's machine has a program for, which a new profile can run. */
  installedAgents: HarnessId[];
  /** The version of the host serving this page. */
  version: string;
  canvasAssetsOrigin: string;
  agentsCanvasAssetsOrigin: string;
  machines: Machine[];
  machineStatuses: MachineStatus[];
  /** Machines kept out of the rail, though one of this computer's machines has joined them. */
  hiddenMachines: MachineSeen[];
  /** Devices asking to join this host, for this page to approve. */
  joinRequests: JoinRequest[];
  /** The devices that joined this host, who is connected now, and how other devices reach it. */
  devices: DevicesListed | null;
  homeDir: string;
  selectedConversationId: string | null;
  /** Counts every time a conversation is picked, the open one again included, so the sidebar brings it back into view each time. */
  conversationsPicked: number;
  /** The conversations opened last, the selected one first: they stay subscribed and drawn, so switching back is instant. */
  kept: OpenConversation[];
  /** The side chats shown beside a conversation, subscribed as the kept conversations are. */
  sideChats: OpenConversation[];
  awaitingConversationIn: string | null;
  overlay: Overlay | null;
  notices: { id: number; text: string }[];
  noticesEverShown: number;
  /** A file outside the workspace that the agent did not change, which a link of a conversation leads to and opens once the owner agrees. */
  fileToOpen: { conversationId: string; file: string } | null;
  /** A conversation the user asked to delete, whose worktree holds uncommitted files that would go with it. */
  worktreeToDelete: { conversationId: string; uncommittedFiles: number; branches: string[] } | null;
  /** A workspace the user asked to remove, whose conversations' worktrees hold uncommitted files that would go with it. */
  workspaceToDelete: { workspaceId: string; uncommittedFiles: number } | null;
  /** Conversations a row's menu or the Older fold would delete together, listed for the user to confirm. */
  deletingTogether: DeletingTogether | null;
  /** The host process run this page last heard from; another one means the host restarted, maybe with new code. */
  hostRunId: string | null;
  hostCodeChanged: boolean;
  /** The plugins running at a release the catalog revoked since the host started, until a restart stops them. */
  revokedPlugins: RevokedPlugin[];
  hostRestarting: boolean;
  desktopAppOutdated: boolean;
  newerVersion: NewerVersion | null;
  pluginUpdates: PluginUpdate[];
  pluginUpdateMode: PluginUpdateMode;
  pluginsUpdatedAtStart: AppliedPluginUpdate[];
  installedApps: InstalledApp[];
  openApps: OpenApp[];
  /** Where the canvas assets serve each plugin's canvas view, by plugin name. */
  canvasViews: Record<string, string>;
  /** The plugins that have a window of their own: their titles by name. */
  pluginWindows: Record<string, string>;
  /** The plugins that have a workspace tab: their titles by name. */
  workspaceTabs: Record<string, string>;
  /** Each workspace's plugin tabs, by workspace id, then plugin name: only those of workspaces the page subscribed to. */
  pluginTabs: Record<string, Record<string, PluginTabState>>;
  /** The documents of the apps this page shows, by appKey: it gets them only while subscribed. */
  appDocuments: Record<string, AppDocumentState>;
}

export type AppAction =
  | { type: "server"; message: ServerMessage }
  | { type: "select"; conversationId: string | null }
  | { type: "hold-turn-times"; held: boolean }
  | { type: "leave-conversation"; conversationId: string }
  | { type: "keep-side-chats"; conversationIds: string[] }
  | { type: "select-room"; roomId: string }
  | { type: "select-knock"; machineId: string; roomId: string }
  | { type: "select-joined-room"; machineId: string; roomId: string | null }
  | { type: "leave-joined-room"; machineId: string; roomId: string }
  | { type: "keep-thread-conversations"; conversationIds: string[] }
  | { type: "keep-brought-work"; conversationIds: string[] }
  | { type: "show-brought-work"; conversationId: string | null }
  | { type: "awaiting-conversation"; workspaceId: string }
  | { type: "open-overlay"; overlay: Overlay }
  | { type: "close-overlay" }
  | { type: "dismiss-notice"; id: number }
  | { type: "dismiss-file-to-open" }
  | { type: "dismiss-worktree-to-delete" }
  | { type: "dismiss-workspace-to-delete" }
  | { type: "delete-together"; deleting: DeleteTogetherRequest }
  | { type: "deleting-together-sent" }
  | { type: "dismiss-deleting-together" }
  | { type: "reminder-set"; undo: ReminderUndo }
  | { type: "dismiss-reminder-undo" };

/** Nothing of someone else's machine is shown in the main pane. */
const NOTHING_ELSEWHERE = { selectedKnock: null, selectedJoinedRoom: null, broughtWorkShown: null } satisfies Partial<AppState>;

export const initialState: AppState = {
  workspaces: [],
  workspaceGroups: [],
  workspaceIcons: {},
  conversations: [],
  rooms: [],
  roomConversations: [],
  broughtShownInRooms: false,
  broughtConversations: [],
  broughtWork: [],
  joinedRoomOpenings: 0,
  roomApprovals: [],
  roomTasksWaiting: [],
  roomWorkspaceWaiting: [],
  roomInvites: [],
  roomJoiners: [],
  waitingToJoin: [],
  sandboxSetups: [],
  heldChanges: [],
  sandboxesHoldingTooMany: [],
  sandboxFolders: [],
  broughtAgents: [],
  broughtTasks: [],
  roomsWithPeopleHere: [],
  roomReadings: [],
  selectedRoomId: null,
  ...NOTHING_ELSEWHERE,
  roomTimeline: null,
  roomPresence: null,
  threadConversations: [],
  profiles: [],
  promptTemplates: [],
  canvasUse: "often",
  keepAwake: "never",
  keepDeletedCanvas: "30-days",
  reminderMorning: DEFAULT_MORNING_MINUTES,
  conversationOrder: CUSTOM_ORDER,
  configFile: undefined,
  olderAfter: DEFAULT_OLDER_AFTER,
  conversationsShown: DEFAULT_CONVERSATIONS_SHOWN,
  sideChatAccess: DEFAULT_SIDE_CHAT_ACCESS,
  heldTurnTimes: null,
  reminderUndo: null,
  claudeProgram: { configured: "", found: null, version: null, installFolders: "", installCommand: "" },
  scriptProgram: "",
  sandboxEngines: NO_SANDBOX_ENGINES,
  sandboxBaseImage: null,
  editor: UNKNOWN_EDITOR,
  machineName: null,
  computerName: "",
  pushRelay: { address: null, tokenSet: false, grantRelay: null, miradorRelay: null },
  avatar: null,
  people: [],
  ownerId: null,
  you: null,
  voiceSettings: defaultVoiceSettings,
  voiceEngine: { setup: { state: "unsupported", reason: "" }, servers: { speech: "stopped", voiceModel: "stopped", speaking: "stopped" }, onDisk: [], memoryBytes: 0 },
  installedAgents: [],
  version: "",
  canvasAssetsOrigin: "",
  agentsCanvasAssetsOrigin: "",
  machines: [],
  machineStatuses: [],
  hiddenMachines: [],
  joinRequests: [],
  devices: null,
  homeDir: "",
  selectedConversationId: null,
  conversationsPicked: 0,
  kept: [],
  sideChats: [],
  awaitingConversationIn: null,
  overlay: null,
  hostRunId: null,
  hostCodeChanged: false,
  revokedPlugins: [],
  hostRestarting: false,
  desktopAppOutdated: false,
  newerVersion: null,
  pluginUpdates: [],
  pluginUpdateMode: "ask",
  pluginsUpdatedAtStart: [],
  installedApps: [],
  openApps: [],
  canvasViews: {},
  pluginWindows: {},
  workspaceTabs: {},
  pluginTabs: {},
  appDocuments: {},
  notices: [],
  noticesEverShown: 0,
  fileToOpen: null,
  worktreeToDelete: null,
  workspaceToDelete: null,
  deletingTogether: null,
};

export function initialStateFor(conversationId: string | null, roomId: string | null = null, joinedRoom: AppState["selectedJoinedRoom"] = null, broughtShownInRooms = false): AppState {
  const start = { ...initialState, broughtShownInRooms };
  if (joinedRoom) return selectJoinedRoom(start, joinedRoom);
  return roomId ? selectRoom(start, roomId) : select(start, conversationId);
}

/** Whether the conversation shows in its room rather than in any list: an agent's of a room here, or, where this page shows other machines' rooms, one you brought. */
const shownInRoom = ({ broughtShownInRooms }: Pick<AppState, "broughtShownInRooms">, conversation: Conversation) =>
  conversation.roomId !== undefined || (broughtShownInRooms && (conversation.broughtIntoRoom === true || conversation.worksInRoomsWorkspace === true));

function upsert<T extends { id: string }>(items: T[], item: T) {
  return items.some((existing) => existing.id === item.id)
    ? items.map((existing) => (existing.id === item.id ? item : existing))
    : [...items, item];
}

export const KEPT_CONVERSATIONS = 5;

/** The documents still open somewhere: a closed one's whole state, which can be large, is no use to any view and goes. */
function openDocumentsOnly(documents: Record<string, AppDocumentState>, openApps: OpenApp[]) {
  const open = new Set(openApps.map(({ documentId }) => documentId));
  return Object.fromEntries(Object.entries(documents).filter(([documentId]) => open.has(documentId)));
}

export const selectedOpen = (state: AppState) => state.kept.find(({ conversationId }) => conversationId === state.selectedConversationId) ?? null;

/** The conversation open most recently before it whose Done, Failed or Unread mark opening it would not clear; null for none. */
function conversationToReturnTo(state: AppState, leaving: string) {
  const hasNoMarkToClear = (conversationId: string) => {
    const conversation = state.conversations.find(({ id }) => id === conversationId);
    return conversation !== undefined && !lastsUntilOpened(conversation.waitingFor);
  };
  return state.kept.find(({ conversationId }) => conversationId !== leaving && hasNoMarkToClear(conversationId))?.conversationId ?? null;
}

function select(state: AppState, conversationId: string | null): AppState {
  if (conversationId === null) return { ...state, ...NOTHING_ELSEWHERE, selectedConversationId: null };
  const opened = state.kept.find((open) => open.conversationId === conversationId) ?? state.sideChats.find((open) => open.conversationId === conversationId) ?? notLoaded(conversationId);
  const others = state.kept.filter((open) => open !== opened);
  return { ...leavingRoom(state), ...NOTHING_ELSEWHERE, selectedConversationId: conversationId, kept: [opened, ...others].slice(0, KEPT_CONVERSATIONS) };
}

const selectKnock = (state: AppState, machineId: string, roomId: string): AppState => ({ ...leavingRoom(state), ...NOTHING_ELSEWHERE, selectedConversationId: null, selectedKnock: { machineId, roomId } });

const selectJoinedRoom = (state: AppState, joinedRoom: NonNullable<AppState["selectedJoinedRoom"]>): AppState => ({
  ...leavingRoom(state),
  ...NOTHING_ELSEWHERE,
  selectedConversationId: null,
  selectedJoinedRoom: joinedRoom,
  joinedRoomOpenings: state.joinedRoomOpenings + 1,
});

const withoutJoinedRoomOfNoMachine = (state: AppState): AppState =>
  state.machines.some(({ id }) => id === state.selectedJoinedRoom?.machineId) ? state : { ...state, selectedJoinedRoom: null };

const roomsListedWithJoinedRoom = ({ selectedJoinedRoom, machineStatuses }: AppState) => machineStatuses.find(({ machineId }) => machineId === selectedJoinedRoom?.machineId)?.rooms ?? [];
const joinedRoomShownIsListed = (state: AppState) => roomsListedWithJoinedRoom(state).some(({ id }) => id === state.selectedJoinedRoom?.roomId);

/** Someone else's machine that lists rooms, but not the one of it that is shown, has it no more; listing none, its own place says why. */
const withoutJoinedRoomGone = (state: AppState): AppState =>
  state.selectedJoinedRoom?.roomId && roomsListedWithJoinedRoom(state).length > 0 && !joinedRoomShownIsListed(state) ? { ...state, selectedJoinedRoom: null } : state;

/** A room joined just now opens before its machine lists it. */
function withMachineStatus(state: AppState, status: MachineStatus): AppState {
  const next = { ...state, machineStatuses: [...state.machineStatuses.filter(({ machineId }) => machineId !== status.machineId), status] };
  return joinedRoomShownIsListed(state) ? withoutJoinedRoomGone(next) : next;
}

/**
 * An agent's conversation in a room opens as its room, which is where it shows, as a notification about it does; a page
 * loaded on one does so once the snapshot says which room it is in. One of an agent you brought opens its room on the
 * other machine with its work beside it; what was forked or asked beside it has no room to open, so nothing changes.
 */
function selectShowing(state: AppState, conversationId: string | null): AppState {
  const roomId = state.roomConversations.find(({ id }) => id === conversationId)?.roomId;
  if (roomId) return selectRoom(state, roomId);
  if (!state.broughtConversations.some(({ id }) => id === conversationId)) return select(state, conversationId);
  const brought = state.broughtAgents.find((agent) => agent.conversationId === conversationId);
  return brought ? { ...selectJoinedRoom(state, { machineId: brought.machineId, roomId: brought.roomId }), broughtWorkShown: conversationId } : state;
}

function selectRoom(state: AppState, roomId: string): AppState {
  if (state.selectedRoomId === roomId) return { ...state, ...NOTHING_ELSEWHERE, selectedConversationId: null };
  return { ...state, ...NOTHING_ELSEWHERE, selectedConversationId: null, selectedRoomId: roomId, roomTimeline: null, roomPresence: null, threadConversations: [] };
}

const leavingRoom = (state: AppState): AppState =>
  state.selectedRoomId === null ? state : { ...state, selectedRoomId: null, roomTimeline: null, roomPresence: null, threadConversations: [] };

function keepingThreadConversations(state: AppState, conversationIds: string[]): AppState {
  if (conversationIds.join(" ") === state.threadConversations.map(({ conversationId }) => conversationId).join(" ")) return state;
  const alreadyOpen = (conversationId: string) => state.threadConversations.find((open) => open.conversationId === conversationId);
  return { ...state, threadConversations: conversationIds.map((conversationId) => alreadyOpen(conversationId) ?? notLoaded(conversationId)) };
}

function keepingBroughtWork(state: AppState, conversationIds: string[]): AppState {
  if (conversationIds.join(" ") === state.broughtWork.map(({ conversationId }) => conversationId).join(" ")) return state;
  const alreadyOpen = (conversationId: string) => state.broughtWork.find((open) => open.conversationId === conversationId);
  return { ...state, broughtWork: conversationIds.map((conversationId) => alreadyOpen(conversationId) ?? notLoaded(conversationId)) };
}

function withRoomTimeline(state: AppState, roomId: string, change: (timeline: RoomTimelineWithCanvas) => RoomTimelineWithCanvas): AppState {
  return state.roomTimeline?.roomId === roomId ? { ...state, roomTimeline: { roomId, ...change(state.roomTimeline) } } : state;
}

/** The room's canvas shows the pages and questions of its agents still in it; one taken out takes its own along. */
const madeByAgentOf =
  ({ id, agents }: Room) =>
  (item: CanvasItem) =>
    agents.some(({ conversationId, profileId, brought }) => conversationId === item.conversationId || (brought !== undefined && agentStandIn(id, profileId) === item.conversationId));

/**
 * An agent's page or question goes on the canvas of the room its conversation is in, while the page shows that room;
 * the room's agents name their conversation there, or, to a person other than the owner, its stand-in.
 */
function withRoomCanvasItem(state: AppState, item: CanvasItem): AppState {
  const roomId = state.rooms.find((room) => madeByAgentOf(room)(item))?.id;
  if (!roomId || !shownOnRoomCanvas(item)) return state;
  return withRoomTimeline(state, roomId, (timeline) => ({ ...timeline, canvas: upsert(timeline.canvas, withThisPagesAssetsOrigin(state, item)) }));
}

const notLoaded = (conversationId: string): OpenConversation => ({ conversationId, loaded: false, events: [], hasEarlier: false, canvas: [] });

function withOpen(state: AppState, conversationId: string, change: (open: OpenConversation) => OpenConversation) {
  const changed = (opened: OpenConversation[]) =>
    opened.some((open) => open.conversationId === conversationId) ? opened.map((open) => (open.conversationId === conversationId ? change(open) : open)) : opened;
  const kept = changed(state.kept);
  const sideChats = changed(state.sideChats);
  const threadConversations = changed(state.threadConversations);
  const broughtWork = changed(state.broughtWork);
  return kept === state.kept && sideChats === state.sideChats && threadConversations === state.threadConversations && broughtWork === state.broughtWork
    ? state
    : { ...state, kept, sideChats, threadConversations, broughtWork };
}

/** Keeps the history of these side chats, and lets go of the rest; a conversation already kept brings the history it has. */
function keepingSideChats(state: AppState, conversationIds: string[]): AppState {
  if (conversationIds.join(" ") === state.sideChats.map(({ conversationId }) => conversationId).join(" ")) return state;
  const alreadyOpen = (conversationId: string) =>
    state.sideChats.find((open) => open.conversationId === conversationId) ?? state.kept.find((open) => open.conversationId === conversationId);
  return { ...state, sideChats: conversationIds.map((conversationId) => alreadyOpen(conversationId) ?? notLoaded(conversationId)) };
}

/**
 * Agents write the canvas library address they were given into their pages; this page may load them from another one.
 * Every occurrence is swapped, in text and scripts too: the address can sit anywhere a page builds a URL, and showing
 * this page's address in its place is harmless.
 */
function withThisPagesAssetsOrigin(state: AppState, item: CanvasItem): CanvasItem {
  const { agentsCanvasAssetsOrigin: written, canvasAssetsOrigin: reachable } = state;
  return !written || written === reachable ? item : (JSON.parse(JSON.stringify(item).replaceAll(written, reachable)) as CanvasItem);
}

/** A room's or workspace's held changes as they are now, in place of those it held before. */
function withHeldChangesOf(state: AppState, owner: SandboxOwner, changes: HeldChange[], full: boolean): Pick<AppState, "heldChanges" | "sandboxesHoldingTooMany"> {
  const ofOthers = <T>(items: T[], ownerOf: (item: T) => SandboxOwner) => items.filter((item) => !sameOwner(ownerOf(item), owner));
  return {
    heldChanges: [...ofOthers(state.heldChanges, (change) => change.owner), ...changes],
    sandboxesHoldingTooMany: [...ofOthers(state.sandboxesHoldingTooMany, (holding) => holding), ...(full ? [owner] : [])],
  };
}

/** Ids never repeat, so dismissing a notice by its id cannot take a later one with it. */
function withNotice(state: AppState, text: string): AppState {
  const id = state.noticesEverShown + 1;
  return { ...state, notices: [...state.notices, { id, text }], noticesEverShown: id };
}

function applyServerMessage(state: AppState, message: ServerMessage): AppState {
  switch (message.type) {
    case "snapshot": {
      const exists = (conversationId: string | null) => message.conversations.some(({ id }) => id === conversationId);
      const next = {
        ...state,
        workspaces: [...message.workspaces].sort(inSidebarOrder),
        workspaceGroups: [...message.workspaceGroups].sort(inSidebarOrder),
        conversations: message.conversations.filter((conversation) => !shownInRoom(state, conversation)),
        roomConversations: message.conversations.filter(({ roomId }) => roomId),
        broughtConversations: message.conversations.filter((conversation) => !conversation.roomId && shownInRoom(state, conversation)),
        rooms: message.rooms,
        roomApprovals: message.roomApprovals,
        roomTasksWaiting: message.roomTasksWaiting,
        roomWorkspaceWaiting: message.roomWorkspaceWaiting,
        roomInvites: message.roomInvites,
        roomJoiners: message.roomJoiners,
        sandboxSetups: message.sandboxSetups ?? [],
        heldChanges: message.heldChanges,
        sandboxesHoldingTooMany: message.sandboxesHoldingTooMany,
        sandboxFolders: message.sandboxFolders,
        broughtAgents: message.broughtAgents,
        broughtTasks: message.broughtTasks,
        profiles: message.profiles,
        promptTemplates: message.promptTemplates,
        canvasUse: message.canvasUse,
        keepAwake: message.keepAwake ?? "never",
        keepDeletedCanvas: message.keepDeletedCanvas ?? "30-days",
        reminderMorning: message.reminderMorning ?? DEFAULT_MORNING_MINUTES,
        conversationOrder: message.conversationOrder ?? CUSTOM_ORDER,
        olderAfter: message.olderAfter,
        conversationsShown: message.conversationsShown,
        sideChatAccess: message.sideChatAccess,
        configFile: message.configFile,
        claudeProgram: message.claudeProgram,
        scriptProgram: message.scriptProgram,
        sandboxEngines: message.sandboxEngines,
        sandboxBaseImage: message.sandboxBaseImage,
        editor: message.editor ?? UNKNOWN_EDITOR,
        machineName: message.machineName ?? null,
        computerName: message.computerName ?? "",
        pushRelay: message.pushRelay,
        avatar: message.avatar,
        people: message.people,
        ownerId: message.ownerId,
        you: message.you,
        installedAgents: message.installedAgents,
        version: message.version,
        canvasAssetsOrigin: message.canvasAssetsOrigin,
        agentsCanvasAssetsOrigin: message.agentsCanvasAssetsOrigin,
        machines: message.machines,
        machineStatuses: message.machineStatuses,
        hiddenMachines: message.hiddenMachines,
        homeDir: message.homeDir,
        hostRunId: message.hostRunId,
        hostCodeChanged: message.hostCodeChanged,
        revokedPlugins: message.revokedPlugins ?? [],
        desktopAppOutdated: message.desktopAppOutdated,
        newerVersion: message.newerVersion,
        pluginUpdates: message.pluginUpdates ?? [],
        pluginUpdateMode: message.pluginUpdateMode ?? "ask",
        pluginsUpdatedAtStart: message.pluginsUpdatedAtStart ?? [],
        installedApps: message.installedApps,
        openApps: message.openApps,
        canvasViews: message.canvasViews,
        pluginWindows: message.pluginWindows ?? {},
        workspaceTabs: message.workspaceTabs ?? {},
        kept: state.kept.filter(({ conversationId }) => exists(conversationId)),
        sideChats: state.sideChats.filter(({ conversationId }) => exists(conversationId)),
        threadConversations: state.threadConversations.filter(({ conversationId }) => exists(conversationId)),
        broughtWork: state.broughtWork.filter(({ conversationId }) => exists(conversationId)),
      };
      const roomStays = message.rooms.some(({ id }) => id === state.selectedRoomId);
      const withRoom = withoutJoinedRoomGone(withoutJoinedRoomOfNoMachine(roomStays ? next : leavingRoom(next)));
      const shownElsewhere = [...next.roomConversations, ...next.broughtConversations].some(({ id }) => id === state.selectedConversationId);
      if (shownElsewhere) {
        const leaving = { ...withRoom, kept: withRoom.kept.filter(({ conversationId }) => conversationId !== state.selectedConversationId) };
        const shown = selectShowing(leaving, state.selectedConversationId);
        return shown.selectedConversationId === state.selectedConversationId ? { ...shown, selectedConversationId: null } : shown;
      }
      return exists(state.selectedConversationId) ? withRoom : { ...withRoom, selectedConversationId: null };
    }
    case "plugin-tab.state": {
      const { workspaceId, plugin, seq, shown, state: tabState, problem } = message;
      if (seq < (state.pluginTabs[workspaceId]?.[plugin]?.seq ?? -Infinity)) return state;
      return { ...state, pluginTabs: { ...state.pluginTabs, [workspaceId]: { ...state.pluginTabs[workspaceId], [plugin]: { seq, shown, state: tabState, problem } } } };
    }
    case "apps.open":
      return { ...state, openApps: message.openApps, appDocuments: openDocumentsOnly(state.appDocuments, message.openApps) };
    case "plugins.views":
      return { ...state, installedApps: message.installedApps, canvasViews: message.canvasViews };
    case "app.state":
      return { ...state, appDocuments: { ...state.appDocuments, [message.state.documentId]: message.state } };
    case "workspace.upserted":
      return { ...state, workspaces: upsert(state.workspaces, message.workspace).sort(inSidebarOrder) };
    case "workspace.deleted":
      return {
        ...state,
        workspaces: state.workspaces.filter(({ id }) => id !== message.workspaceId),
        workspaceToDelete: state.workspaceToDelete?.workspaceId === message.workspaceId ? null : state.workspaceToDelete,
        ...withHeldChangesOf(state, workspaceSandbox(message.workspaceId), [], false),
      };
    case "workspace.icon":
      return { ...state, workspaceIcons: { ...state.workspaceIcons, [message.workspaceId]: message.icon } };
    case "workspace-group.upserted":
      return { ...state, workspaceGroups: upsert(state.workspaceGroups, message.group).sort(inSidebarOrder) };
    case "workspace-group.deleted":
      return { ...state, workspaceGroups: state.workspaceGroups.filter(({ id }) => id !== message.groupId) };
    case "conversation.upserted": {
      if (message.conversation.roomId) return { ...state, roomConversations: upsert(state.roomConversations, message.conversation) };
      if (shownInRoom(state, message.conversation)) return { ...state, broughtConversations: upsert(state.broughtConversations, message.conversation) };
      const isNew = !state.conversations.some(({ id }) => id === message.conversation.id);
      const next = { ...state, conversations: upsert(state.conversations, message.conversation) };
      if (isNew && state.awaitingConversationIn === message.conversation.workspaceId) {
        return select({ ...next, awaitingConversationIn: null }, message.conversation.id);
      }
      return next;
    }
    case "conversation.deleted": {
      const next = {
        ...state,
        conversations: state.conversations.filter(({ id }) => id !== message.conversationId),
        roomConversations: state.roomConversations.filter(({ id }) => id !== message.conversationId),
        broughtConversations: state.broughtConversations.filter(({ id }) => id !== message.conversationId),
        broughtWork: state.broughtWork.filter(({ conversationId }) => conversationId !== message.conversationId),
        broughtWorkShown: state.broughtWorkShown === message.conversationId ? null : state.broughtWorkShown,
        kept: state.kept.filter(({ conversationId }) => conversationId !== message.conversationId),
        sideChats: state.sideChats.filter(({ conversationId }) => conversationId !== message.conversationId),
        threadConversations: state.threadConversations.filter(({ conversationId }) => conversationId !== message.conversationId),
        deletingTogether: deletedTogether(state.deletingTogether, message.conversationId) ? null : state.deletingTogether,
      };
      return state.selectedConversationId === message.conversationId ? select(next, null) : next;
    }
    case "conversation.history":
      return withOpen(state, message.conversationId, () => ({
        conversationId: message.conversationId,
        loaded: true,
        events: message.events,
        hasEarlier: message.hasEarlier ?? false,
        canvas: message.canvas.map((item) => withThisPagesAssetsOrigin(state, item)),
      }));
    case "conversation.earlier":
      return withOpen(state, message.conversationId, (open) =>
        open.events[0]?.seq === message.beforeSeq ? { ...open, events: [...message.events, ...open.events], hasEarlier: message.hasEarlier } : open,
      );
    case "conversation.event":
      return withOpen(state, message.conversationId, (open) => {
        const lastSeq = open.events.at(-1)?.seq ?? 0;
        return message.event.seq <= lastSeq ? open : { ...open, events: withStreamedEvent(open.events, message.event) };
      });
    case "conversation.rewound":
    case "conversation.rewind-done":
      return withOpen(state, message.conversationId, (open) => ({ ...open, events: open.events.filter(({ seq }) => seq < message.fromSeq) }));
    case "canvas.upserted":
      return withRoomCanvasItem(
        withOpen(state, message.item.conversationId, (open) => ({ ...open, canvas: upsert(open.canvas, withThisPagesAssetsOrigin(state, message.item)) })),
        message.item,
      );
    case "profile.upserted":
      return { ...state, profiles: upsert(state.profiles, message.profile).sort((a, b) => a.name.localeCompare(b.name)) };
    case "profile.deleted":
      return { ...state, profiles: state.profiles.filter(({ id }) => id !== message.profileId) };
    case "prompt-template.upserted":
      return { ...state, promptTemplates: upsert(state.promptTemplates, message.template).sort((a, b) => a.name.localeCompare(b.name)) };
    case "settings.canvas-use":
      return { ...state, canvasUse: message.canvasUse };
    case "settings.keep-awake":
      return { ...state, keepAwake: message.keepAwake };
    case "settings.plugin-update-mode":
      return { ...state, pluginUpdateMode: message.mode };
    case "plugins.updated-at-start":
      return { ...state, pluginsUpdatedAtStart: message.updates };
    case "plugins.revoked-running":
      return { ...state, revokedPlugins: message.plugins };
    case "settings.reminder-morning":
      return { ...state, reminderMorning: message.minutes };
    case "settings.conversation-order":
      return { ...state, conversationOrder: message.order };
    case "settings.older-after":
      return { ...state, olderAfter: message.olderAfter };
    case "settings.conversations-shown":
      return { ...state, conversationsShown: message.shown };
    case "settings.side-chat-access":
      return { ...state, sideChatAccess: message.sideChatAccess };
    case "settings.keep-deleted-canvas":
      return { ...state, keepDeletedCanvas: message.keep };
    case "settings.claude-program":
      return { ...state, claudeProgram: message.claudeProgram };
    case "settings.script-program":
      return { ...state, scriptProgram: message.scriptProgram };
    case "settings.sandbox-engines":
      return { ...state, sandboxEngines: message.sandboxEngines };
    case "settings.sandbox-base-image":
      return { ...state, sandboxBaseImage: message.baseImage };
    case "settings.editor":
      return { ...state, editor: message.editor };
    case "settings.machine-name":
      return { ...state, machineName: message.machineName };
    case "settings.push-relay":
      return { ...state, pushRelay: message.pushRelay };
    case "settings.avatar":
      return { ...state, avatar: message.image };
    case "people.listed":
      return { ...state, people: message.people };
    case "voice.settings":
      return { ...state, voiceSettings: message.settings };
    case "voice.engine":
      return { ...state, voiceEngine: message.engine };
    case "prompt-template.deleted":
      return { ...state, promptTemplates: state.promptTemplates.filter(({ id }) => id !== message.templateId) };
    case "error":
      return withNotice(message.problem?.code === "worktree-needs-repository" ? { ...state, awaitingConversationIn: null } : state, hostErrorText(message));
    case "files.ask-to-open":
      return { ...state, fileToOpen: { conversationId: message.conversationId, file: message.file } };
    case "conversation.delete-asks":
      return { ...state, worktreeToDelete: { conversationId: message.conversationId, uncommittedFiles: message.uncommittedFiles, branches: message.branches } };
    case "workspace.delete-asks":
      return { ...state, workspaceToDelete: { workspaceId: message.workspaceId, uncommittedFiles: message.uncommittedFiles } };
    case "conversations.delete-asks": {
      const asked = { conversationIds: message.conversationIds, uncommittedFiles: message.uncommittedFiles, branches: message.branches };
      return answersDeletingTogether(state.deletingTogether, message.conversationIds) ? { ...state, deletingTogether: { ...state.deletingTogether, sent: false, asked } } : state;
    }
    case "fs.completions":
    case "pong":
    case "profile.saved":
    case "profile.choices.got":
    case "profile.tested":
    case "plugin.profile-checked":
    case "sessions.listed":
    case "sessions.searched":
    case "sessions.failed":
    case "canvas.exported":
    case "canvas.saved-to-project":
    case "canvas.export-failed":
    case "changes.listed":
    case "changes.diffed":
    case "changes.files-listed":
    case "changes.committable-listed":
    case "changes.landable-listed":
    case "changes.landed":
    case "changes.committed":
    case "changes.failed":
    case "slash-commands.listed":
    case "conversation.fork-checked":
    case "conversation.side-chat.started":
    case "prompt-history.listed":
    case "mentions.suggested":
    case "tool-output.got":
    case "tool-raw-output.got":
    case "async-task.output.got":
    case "conversation.found":
    case "statusline.rendered":
    case "subagent-usage.got":
    case "terminals.listed":
    case "terminal.opened":
    case "terminal.replayed":
    case "terminal.output":
    case "terminal.exited":
    case "terminal.cleared":
    case "terminal.busy":
    case "system-notification":
    case "waiting.counted":
    case "running-turns.counted":
    case "devices.invited":
    case "address.found":
    case "search.results":
    case "machine.join-asked":
    case "machine.join-answered":
    case "settings.saved":
    case "settings.exported":
    case "settings.export-saved":
    case "settings.import-planned":
    case "settings.imported":
    case "app.storage":
    case "plugins.listed":
    case "plugins.changed":
    case "plugins.commits-found":
    case "plugins.offered":
    case "newer-version.checked":
    case "newer-version.pulled":
    case "plugins.settings":
    case "canvas.item-acted":
    case "canvas.command-ran":
    case "app.file-opened":
    case "plugin-window.state":
    case "plugin-window.acted":
    case "plugin-tab.acted":
    case "conversation.revert-previewed":
    case "conversation.reverted":
    case "conversation.revert-failed":
    case "conversation.rewind-previewed":
    case "conversation.rewind-failed":
      return state;
    case "join-request.answered":
    case "machine.added":
      return message.problem ? withNotice(state, describedText(message.problem, message.problemAbout)) : state;
    case "join-requests.listed":
      return { ...state, joinRequests: message.joinRequests };
    case "devices.listed":
      return { ...state, devices: message };
    case "machines.changed":
      return withoutJoinedRoomOfNoMachine({ ...state, machines: message.machines });
    case "machines.hidden":
      return { ...state, hiddenMachines: message.machines };
    case "machine.status":
      return withMachineStatus(state, message.status);
    case "host.code-changed":
      return { ...state, hostCodeChanged: true };
    case "host.restarting":
      return { ...state, hostRestarting: true };
    case "desktop-app.outdated":
      return { ...state, desktopAppOutdated: message.outdated };
    case "newer-version.found":
      return { ...state, newerVersion: message.newerVersion };
    case "plugin-updates.found":
      return { ...state, pluginUpdates: message.pluginUpdates };
    case "room.created":
    case "room.invited":
      return state;
    case "room-invites.listed":
      return { ...state, roomInvites: message.invites };
    case "room-joiners.listed":
      return { ...state, roomJoiners: message.joiners };
    case "rooms.waiting-to-join":
      return { ...state, waitingToJoin: message.roomIds };
    case "rooms.people-here":
      return { ...state, roomsWithPeopleHere: message.roomIds };
    case "room.upserted":
      return withRoomTimeline({ ...state, rooms: upsert(state.rooms, message.room) }, message.room.id, (timeline) => ({ ...timeline, canvas: timeline.canvas.filter(madeByAgentOf(message.room)) }));
    case "room.deleted": {
      const next = {
        ...state,
        rooms: state.rooms.filter(({ id }) => id !== message.roomId),
        roomApprovals: state.roomApprovals.filter(({ roomId }) => roomId !== message.roomId),
        roomTasksWaiting: state.roomTasksWaiting.filter(({ roomId }) => roomId !== message.roomId),
        roomWorkspaceWaiting: state.roomWorkspaceWaiting.filter(({ roomId }) => roomId !== message.roomId),
        roomInvites: state.roomInvites.filter(({ roomId }) => roomId !== message.roomId),
        roomJoiners: state.roomJoiners.filter(({ roomId }) => roomId !== message.roomId),
        ...withHeldChangesOf(state, roomSandbox(message.roomId), [], false),
      };
      return state.selectedRoomId === message.roomId ? leavingRoom(next) : next;
    }
    case "room.timeline": {
      const { roomId, messages, threads, canvas, votes, workspaceCalls, broughtSteps = [] } = message;
      return state.selectedRoomId === roomId
        ? { ...state, roomTimeline: { roomId, messages, threads, votes, workspaceCalls, broughtSteps, canvas: canvas.map((item) => withThisPagesAssetsOrigin(state, item)) } }
        : state;
    }
    case "room.votes":
      return withRoomTimeline(state, message.roomId, (timeline) => ({ ...timeline, votes: [...timeline.votes.filter(({ itemId }) => itemId !== message.votes.itemId), message.votes] }));
    case "rooms.reading":
      return { ...state, roomReadings: message.readings };
    case "room.alert":
      return state;
    case "room.message":
      return withRoomTimeline(state, message.message.roomId, (timeline) => {
        const knownThreads = new Set(timeline.threads.map(({ id }) => id));
        return {
          ...timeline,
          messages: [...timeline.messages.filter(({ id }) => id !== message.message.id), message.message].sort((a, b) => a.seq - b.seq),
          threads: [...timeline.threads, ...message.threads.filter(({ id }) => !knownThreads.has(id))],
        };
      });
    case "room.approvals":
      return {
        ...state,
        roomApprovals: [...state.roomApprovals.filter(({ roomId }) => roomId !== message.roomId), ...message.approvals],
        roomTasksWaiting: [...state.roomTasksWaiting.filter(({ roomId }) => roomId !== message.roomId), ...message.tasks],
        roomWorkspaceWaiting: [...state.roomWorkspaceWaiting.filter(({ roomId }) => roomId !== message.roomId), ...message.workspace],
      };
    case "room.workspace-call-shown":
      return withRoomTimeline(state, message.call.roomId, (timeline) => ({ ...timeline, workspaceCalls: upsert(timeline.workspaceCalls, message.call) }));
    case "room.brought-step-shown":
      return withRoomTimeline(state, message.step.roomId, (timeline) => ({ ...timeline, broughtSteps: upsert(timeline.broughtSteps, message.step) }));
    case "room.workspace-answered":
    case "room.plugin-tools":
    case "room.plugin-answered":
      return state;
    case "sandbox.setup":
      // A host that hasn't restarted since the page was rebuilt says no owner.
      if (message.owner === undefined) return state;
      return { ...state, sandboxSetups: [...state.sandboxSetups.filter(({ owner }) => !sameOwner(owner, message.owner)), { owner: message.owner, setup: message.setup }] };
    case "sandbox.held-changes":
      return { ...state, ...withHeldChangesOf(state, message.owner, message.changes, message.full) };
    case "sandbox.folders":
      return { ...state, sandboxFolders: [...state.sandboxFolders.filter(({ owner }) => !sameOwner(owner, message.folders.owner)), message.folders] };
    case "room.sandbox-checked":
    case "workspace.sandbox-checked":
    case "sandbox.held-change-text":
    case "sandbox.folder-added":
    case "sandbox.folder-access-set":
      return state;
    case "room.presence": {
      const { roomId, here, writing } = message;
      return state.selectedRoomId === roomId ? { ...state, roomPresence: { roomId, here, writing } } : state;
    }
    case "room.usage.got":
    case "room.agent-brought":
    case "room.brought-task":
    case "room.brought-ask-answered":
    case "machine.agent-brought":
      return state;
    case "brought-agents.listed":
      return { ...state, broughtAgents: message.agents, broughtTasks: message.tasks };
  }
}

export function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "server":
      return applyServerMessage(state, action.message);
    case "hold-turn-times":
      return { ...state, heldTurnTimes: action.held ? turnTimesOf(state.conversations) : null };
    case "select":
      return {
        ...(action.conversationId === state.selectedConversationId && state.selectedKnock === null && state.selectedJoinedRoom === null ? state : selectShowing(state, action.conversationId)),
        conversationsPicked: state.conversationsPicked + 1,
      };
    case "leave-conversation":
      return action.conversationId === state.selectedConversationId ? select(state, conversationToReturnTo(state, action.conversationId)) : state;
    case "keep-side-chats":
      return keepingSideChats(state, action.conversationIds);
    case "select-room":
      return selectRoom(state, action.roomId);
    case "select-knock":
      return selectKnock(state, action.machineId, action.roomId);
    case "select-joined-room":
      return selectJoinedRoom(state, { machineId: action.machineId, roomId: action.roomId });
    case "leave-joined-room":
      return state.selectedJoinedRoom?.machineId === action.machineId && [null, action.roomId].includes(state.selectedJoinedRoom.roomId) ? { ...state, selectedJoinedRoom: null } : state;
    case "keep-thread-conversations":
      return keepingThreadConversations(state, action.conversationIds);
    case "keep-brought-work":
      return keepingBroughtWork(state, action.conversationIds);
    case "show-brought-work":
      return { ...state, broughtWorkShown: action.conversationId };
    case "awaiting-conversation":
      return { ...state, awaitingConversationIn: action.workspaceId };
    case "open-overlay":
      return { ...state, overlay: action.overlay };
    case "close-overlay":
      return { ...state, overlay: null };
    case "dismiss-notice":
      return { ...state, notices: state.notices.filter(({ id }) => id !== action.id) };
    case "dismiss-file-to-open":
      return { ...state, fileToOpen: null };
    case "dismiss-worktree-to-delete":
      return { ...state, worktreeToDelete: null };
    case "dismiss-workspace-to-delete":
      return { ...state, workspaceToDelete: null };
    case "delete-together":
      return { ...state, deletingTogether: { ...action.deleting, sent: false, asked: null } };
    case "deleting-together-sent":
      return state.deletingTogether ? { ...state, deletingTogether: { ...state.deletingTogether, sent: true } } : state;
    case "dismiss-deleting-together":
      return { ...state, deletingTogether: null };
    case "reminder-set":
      return { ...state, reminderUndo: { ...action.undo, id: (state.reminderUndo?.id ?? 0) + 1 } };
    case "dismiss-reminder-undo":
      return { ...state, reminderUndo: null };
  }
}
