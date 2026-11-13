import type { EditorState } from "../shared/editors.ts";
import type { CanvasItem, CanvasUse, KeepAwake, KeepDeletedCanvas, ClaudeProgram, Conversation, HarnessId, JoinRequest, Machine, MachineSeen, MachineStatus, Profile, PromptTemplate, StoredEvent, Workspace, WorkspaceGroup } from "../shared/model.ts";
import { DEFAULT_MORNING_MINUTES, type ReminderMode } from "../shared/reminders.ts";
import type { ReminderUndo } from "./reminders.ts";
import type { PushRelaySetting } from "../shared/push.ts";
import type { NewerVersion } from "../shared/newer-version.ts";
import { appKey, type AppDocumentState, type AppliedPluginUpdate, type InstalledApp, type OpenApp, type PluginUpdate, type PluginUpdateMode } from "../shared/apps.ts";
import type { ServerMessage } from "../shared/protocol.ts";
import type { Turn } from "../shared/reverts.ts";
import { CUSTOM_ORDER, type ConversationOrder } from "../shared/conversation-order.ts";
import { turnTimesOf, type HeldTurnTimes } from "./navigation.ts";
import { inSidebarOrder } from "../shared/sidebar-order.ts";
import { withStreamedEvent } from "../shared/timeline.ts";
import { defaultVoiceSettings, type VoiceSettings } from "../shared/voice.ts";
import type { VoiceEngineStatus } from "../shared/voice-engine.ts";
import { lastsUntilOpened } from "../shared/waiting.ts";
import { describedText, hostErrorText } from "./host-error.ts";

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
  | { kind: "profiles" }
  | { kind: "machines" }
  | { kind: "plugins" }
  | { kind: "sessions"; workspaceId: string }
  | { kind: "workspace-color"; workspaceId: string }
  | { kind: "worktrees"; workspaceId: string }
  | { kind: "add-workspace" }
  | { kind: "add-workspace-group" }
  /** `rewind` takes the conversation and the files back; without it only the files are put back. */
  | { kind: "revert"; conversationId: string; turn: Turn; rewind?: boolean }
  | { kind: "settings"; page?: SettingsPage };

/** A part of Settings to open at, rather than at the top. */
export type SettingsPage = "appearance" | "conversations" | "agents" | "voice" | "terminal" | "canvas" | "layout" | "devices" | "notifications" | "about";

export type DevicesListed = Extract<ServerMessage, { type: "devices.listed" }>;

/** A plugin's tab in a workspace, as its host code last said. */
export interface PluginTabState {
  seq: number;
  shown: boolean;
  state: unknown;
  problem: string | null;
}

export interface AppState {
  workspaces: Workspace[];
  workspaceGroups: WorkspaceGroup[];
  conversations: Conversation[];
  profiles: Profile[];
  promptTemplates: PromptTemplate[];
  canvasUse: CanvasUse;
  keepAwake: KeepAwake;
  keepDeletedCanvas: KeepDeletedCanvas;
  /** Minutes after midnight that "morning" means for reminders. */
  reminderMorning: number;
  conversationOrder: ConversationOrder;
  heldTurnTimes: HeldTurnTimes | null;
  /** The reminder this page set last, until its toast goes. */
  reminderUndo: (ReminderUndo & { id: number }) | null;
  claudeProgram: ClaudeProgram;
  /** The program the host opens scripts in, as text; empty for the system's text editor. */
  scriptProgram: string;
  /** The editor the host opens files at a line in, and the ones it finds. */
  editor: EditorState;
  /** The name Settings gave this machine; null while it goes by its computer's name. */
  machineName: string | null;
  computerName: string;
  pushRelay: PushRelaySetting;
  /** The user's profile picture as a small square PNG data URL; null when they set none. */
  avatar: string | null;
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
  /** The host process run this page last heard from; another one means the host restarted, maybe with new code. */
  hostRunId: string | null;
  hostCodeChanged: boolean;
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
  | { type: "awaiting-conversation"; workspaceId: string }
  | { type: "open-overlay"; overlay: Overlay }
  | { type: "close-overlay" }
  | { type: "dismiss-notice"; id: number }
  | { type: "dismiss-file-to-open" }
  | { type: "dismiss-worktree-to-delete" }
  | { type: "dismiss-workspace-to-delete" }
  | { type: "reminder-set"; undo: ReminderUndo }
  | { type: "dismiss-reminder-undo" };

export const initialState: AppState = {
  workspaces: [],
  workspaceGroups: [],
  conversations: [],
  profiles: [],
  promptTemplates: [],
  canvasUse: "often",
  keepAwake: "never",
  keepDeletedCanvas: "30-days",
  reminderMorning: DEFAULT_MORNING_MINUTES,
  conversationOrder: CUSTOM_ORDER,
  heldTurnTimes: null,
  reminderUndo: null,
  claudeProgram: { configured: "", found: null, version: null, installFolders: "", installCommand: "" },
  scriptProgram: "",
  editor: UNKNOWN_EDITOR,
  machineName: null,
  computerName: "",
  pushRelay: { address: null, tokenSet: false },
  avatar: null,
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
  awaitingConversationIn: null,
  overlay: null,
  hostRunId: null,
  hostCodeChanged: false,
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
};

export function initialStateFor(conversationId: string | null): AppState {
  return select(initialState, conversationId);
}

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
  if (conversationId === null) return { ...state, selectedConversationId: null };
  const opened = state.kept.find((open) => open.conversationId === conversationId) ?? { conversationId, loaded: false, events: [], hasEarlier: false, canvas: [] };
  const others = state.kept.filter((open) => open !== opened);
  return { ...state, selectedConversationId: conversationId, kept: [opened, ...others].slice(0, KEPT_CONVERSATIONS) };
}

function withOpen(state: AppState, conversationId: string, change: (open: OpenConversation) => OpenConversation) {
  return state.kept.some((open) => open.conversationId === conversationId)
    ? { ...state, kept: state.kept.map((open) => (open.conversationId === conversationId ? change(open) : open)) }
    : state;
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
        conversations: message.conversations,
        profiles: message.profiles,
        promptTemplates: message.promptTemplates,
        canvasUse: message.canvasUse,
        keepAwake: message.keepAwake ?? "never",
        keepDeletedCanvas: message.keepDeletedCanvas ?? "30-days",
        reminderMorning: message.reminderMorning ?? DEFAULT_MORNING_MINUTES,
        conversationOrder: message.conversationOrder ?? CUSTOM_ORDER,
        claudeProgram: message.claudeProgram,
        scriptProgram: message.scriptProgram,
        editor: message.editor ?? UNKNOWN_EDITOR,
        machineName: message.machineName ?? null,
        computerName: message.computerName ?? "",
        pushRelay: message.pushRelay ?? { address: null, tokenSet: false },
        avatar: message.avatar,
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
      };
      return exists(state.selectedConversationId) ? next : select(next, null);
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
      };
    case "workspace-group.upserted":
      return { ...state, workspaceGroups: upsert(state.workspaceGroups, message.group).sort(inSidebarOrder) };
    case "workspace-group.deleted":
      return { ...state, workspaceGroups: state.workspaceGroups.filter(({ id }) => id !== message.groupId) };
    case "conversation.upserted": {
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
        kept: state.kept.filter(({ conversationId }) => conversationId !== message.conversationId),
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
      return withOpen(state, message.item.conversationId, (open) => ({ ...open, canvas: upsert(open.canvas, withThisPagesAssetsOrigin(state, message.item)) }));
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
    case "settings.reminder-morning":
      return { ...state, reminderMorning: message.minutes };
    case "settings.conversation-order":
      return { ...state, conversationOrder: message.order };
    case "settings.keep-deleted-canvas":
      return { ...state, keepDeletedCanvas: message.keep };
    case "settings.claude-program":
      return { ...state, claudeProgram: message.claudeProgram };
    case "settings.script-program":
      return { ...state, scriptProgram: message.scriptProgram };
    case "settings.editor":
      return { ...state, editor: message.editor };
    case "settings.machine-name":
      return { ...state, machineName: message.machineName };
    case "settings.push-relay":
      return { ...state, pushRelay: message.pushRelay };
    case "settings.avatar":
      return { ...state, avatar: message.image };
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
      return message.problem ? withNotice(state, describedText(message.problem, message.problemAbout)) : state;
    case "join-requests.listed":
      return { ...state, joinRequests: message.joinRequests };
    case "devices.listed":
      return { ...state, devices: message };
    case "machines.changed":
      return { ...state, machines: message.machines };
    case "machines.hidden":
      return { ...state, hiddenMachines: message.machines };
    case "machine.status":
      return { ...state, machineStatuses: [...state.machineStatuses.filter(({ machineId }) => machineId !== message.status.machineId), message.status] };
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
  }
}

export function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "server":
      return applyServerMessage(state, action.message);
    case "hold-turn-times":
      return { ...state, heldTurnTimes: action.held ? turnTimesOf(state.conversations) : null };
    case "select":
      return { ...(action.conversationId === state.selectedConversationId ? state : select(state, action.conversationId)), conversationsPicked: state.conversationsPicked + 1 };
    case "leave-conversation":
      return action.conversationId === state.selectedConversationId ? select(state, conversationToReturnTo(state, action.conversationId)) : state;
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
    case "reminder-set":
      return { ...state, reminderUndo: { ...action.undo, id: (state.reminderUndo?.id ?? 0) + 1 } };
    case "dismiss-reminder-undo":
      return { ...state, reminderUndo: null };
  }
}
