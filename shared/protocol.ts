import type { EditorSetting, EditorState } from "./editors.ts";
import type { Reminder } from "./reminders.ts";
import type { ClaudeSetup } from "./room-agent-setup.ts";
import type { HeldChange, HeldChangeAnswer, HeldChangeText, OwnedSetup, SandboxCheck, SandboxFolderRefusal, SandboxFolders, SandboxNetwork, SandboxOwner, SandboxSetting, SandboxSetup, WorkspaceSandboxCheck } from "./sandbox.ts";
import type { PermissionPreset, RoomApprovalAnswer } from "./room-permissions.ts";
import type { RoomUsage } from "./room-usage.ts";
import type {
  BroughtAnswerEnd,
  Room,
  RoomAgentModel,
  RoomApproval,
  RoomAuthorRole,
  RoomInvite,
  RoomInviteLetsIn,
  RoomInviteLifetime,
  RoomInviteSeats,
  RoomJoiner,
  RoomMessage,
  RoomPresence,
  RoomRole,
  RoomTaskApproval,
  RoomThread,
  RoomTimeline,
} from "./rooms.ts";
import type { BroughtStepKind, RoomBroughtStep, RoomWorkspaceAnswer, RoomWorkspaceApproval, RoomWorkspaceCall, WorkspaceCall, WorkspaceCallResult } from "./room-workspace.ts";
import type { BroughtAgentHere, BroughtTaskWaiting, OthersTasks } from "./brought-agents.ts";
import type { BroughtAskAnswer, BroughtCanvasAskPayload } from "./brought-canvas.ts";
import type { RoomAlert, RoomReading } from "./room-reading.ts";
import type { RoomConfirmedAnswer, RoomQuestionVotes } from "./room-votes.ts";
import type { RoomInviteConnect } from "./machines.ts";
import type { NotificationKind } from "./system-notifications.ts";
import type { SessionConfigOption, ToolCallContent } from "@agentclientprotocol/sdk/unstable";
import type {
  AdoptMode,
  AskAnswerEntry,
  AskMode,
  CanvasItem,
  CanvasUse,
  KeepAwake,
  KeepDeletedCanvas,
  OlderAfter,
  SideChatAccess,
  ConversationsShown,
  ClaudeProgram,
  Conversation,
  ConversationMatches,
  EntryMatchCount,
  ExternalSession,
  HarnessId,
  FoundAddress,
  JoinRequest,
  ListedDevice,
  Machine,
  MachineSeen,
  MachineStatus,
  Launch,
  Person,
  PickedSeveral,
  Profile,
  PromptTemplate,
  PublicAddress,
  ReachabilitySettings,
  RestoreFiles,
  RestorePlan,
  SessionSearchHit,
  StatuslineRender,
  StoredEvent,
  TerminalTab,
  Workspace,
  WorkspaceGroup,
  Pastel,
  ConversationPlace,
} from "./model.ts";
import type { AskPage } from "./ask.ts";
import type { ChangeList, ChangeScope, Committable, FileChanges, Landable, Landed, MadeCommit, ProjectFiles } from "./changes.ts";
import type { ConversationOrder } from "./conversation-order.ts";
import type { ConfigFileStatus, SettingsImportReport, SettingsPlan } from "./settings-file.ts";
import type { HostProblem } from "./host-problems.ts";
import type { PageLibraries } from "./canvas-export.ts";
import type { InviteTunnel } from "./tunnel.ts";
import type { AppDocumentState, AppliedPluginUpdate, AppStorageItems, CatalogPlugin, ConversationPlugin, InstalledApp, OpenApp, PluginCommit, PluginInfo, PluginLook, PluginOffer, PluginSettings, PluginUpdate, PluginUpdateMode, RevokedPlugin } from "./apps.ts";
import type { LowDataSubscription } from "./low-data.ts";
import type { MentionSuggestion } from "./mentions.ts";
import type { NewerVersion } from "./newer-version.ts";
import type { PromptHistoryEntry } from "./prompt-history.ts";
import type { PluginCommand, SlashCommand } from "./slash-commands.ts";
import type { WaitingSummary } from "./waiting.ts";
import type { SplitAxis } from "./terminal-layout.ts";
import type { SystemNotification } from "./system-notifications.ts";
import type { PushRegistration, PushRelayRequest, PushRelaySetting } from "./push.ts";
import type { SubagentUsage } from "./subagent-usage.ts";
import type { VoiceSettings } from "./voice.ts";
import type { VoiceEngineStatus } from "./voice-engine.ts";
import type { WorkspaceIcon } from "./workspace-icon.ts";

export interface TerminalSplit {
  terminalId: string;
  axis: SplitAxis;
}

/** The cookie a signed-in page carries; the desktop app sends it too when it listens for system notifications. */
export const TOKEN_COOKIE = "mirador_token";
/** How the host closes the sockets of a person it took out of the last room they were in, whose devices it revoked with that. */
export const OUT_OF_ROOMS_CLOSE_CODE = 4410;
/**
 * Sent by the relay that shows a machine in the rail: the machine's pages there load canvas libraries, app views and
 * media through a relay on this computer's loopback, as this computer's browser may not trust the machine's certificate.
 */
export const CANVAS_ASSETS_ORIGIN_HEADER = "mirador-canvas-assets-origin";

export function canvasAssetsOriginOnLoopback(headers: Headers) {
  const origin = headers.get(CANVAS_ASSETS_ORIGIN_HEADER);
  return origin && /^http:\/\/127\.0\.0\.1:\d+$/.test(origin) ? origin : null;
}
/**
 * Mirador's own pages edit profiles, so they open /ws with this query parameter to get what each profile launches its
 * agent with: the environment and prelaunch command, which often hold API keys. Other clients, such as the phone app,
 * never show them and never get them.
 */
export const PROFILE_LAUNCH_PARAMETER = "profile-launch";

/** A desktop app built from a checkout opens /notifications with this query parameter naming the code it was built from. */
export const DESKTOP_APP_CODE_PARAMETER = "desktop-app-code";

export type ProfileDraft = Pick<Profile, "name" | "harness" | "environment" | "prelaunch" | "model" | "mode" | "effort" | "bypassPermissions" | "askMode" | "idleCompaction" | "keepCacheWarm" | "color" | "pluginSettings" | "pluginsOff"> & { id?: string };

/** What a profile editor's test found: what the agent offers, or why it could not say. */
export type ProfileTestResult =
  | { ok: true; configOptions: SessionConfigOption[]; tookMs: number }
  | { ok: false; message: string; problem?: HostProblem };

export type ClientMessage =
  /** Its conversations start on the profile; null only while there is no profile yet. */
  | { type: "workspace.create"; path: string; profileId: string | null }
  /** Without `discardsUncommitted`, a workspace whose conversations' worktrees hold uncommitted files stays, and the host answers `workspace.delete-asks`. */
  | { type: "workspace.delete"; workspaceId: string; discardsUncommitted?: boolean }
  | { type: "workspace.set-default-launch"; workspaceId: string; launch: Launch }
  /**
   * Puts the workspace in the group, or in none for null, just before a workspace or group there in the sidebar, or
   * last there. Without a group it keeps its own.
   */
  | { type: "workspace.move"; workspaceId: string; groupId?: string | null; beforeWorkspaceId: string | null; beforeGroupId?: string | null }
  | { type: "workspace.set-color"; workspaceId: string; color: Pastel | null }
  /** Answered with a workspace.icon for each workspace, as its folder is looked through. */
  | { type: "workspaces.find-icons" }
  | { type: "workspace.set-worktree-settings"; workspaceId: string; newConversationsIn: ConversationPlace; worktreeSetup: string }
  /** What the workspace's new side chats may do; null for what Settings say. */
  | { type: "workspace.set-side-chat-access"; workspaceId: string; sideChatAccess: SideChatAccess | null }
  /**
   * Whether the workspace's own conversations run their agents in a sandbox, and work freely there; those already at work
   * start afresh. Turning it on where something stands in its way fails with why.
   */
  | { type: "workspace.set-sandbox"; workspaceId: string; sandbox: SandboxSetting }
  /** Whether this computer and the workspace can have a sandbox; the host answers `workspace.sandbox-checked`. */
  | { type: "workspace.check-sandbox"; requestId: string; workspaceId: string }
  /** Writes an agent config file as a sandboxed agent of a room or workspace proposed it, or drops what it proposed. */
  | { type: "sandbox.answer-held-change"; owner: SandboxOwner; changeId: string; answer: HeldChangeAnswer }
  /** A held change's text before and as proposed; the host answers `sandbox.held-change-text`. */
  | { type: "sandbox.held-change-text"; requestId: string; owner: SandboxOwner; changeId: string }
  /**
   * Gives a room's or workspace's sandbox a folder of this computer at the same path, read-only or read and write; its VM
   * takes it up once no turn runs in it. The host answers `sandbox.folder-added`.
   */
  | { type: "sandbox.add-folder"; requestId: string; owner: SandboxOwner; path: string; writable: boolean }
  /** Makes a folder of the sandbox read-only or read and write, once no turn runs in it. The host answers `sandbox.folder-access-set`. */
  | { type: "sandbox.set-folder-access"; requestId: string; owner: SandboxOwner; path: string; writable: boolean }
  /** Takes a folder out of the sandbox, once no turn runs in it. */
  | { type: "sandbox.remove-folder"; owner: SandboxOwner; path: string }
  /** Stops the turns at work in the sandbox, for its VM to take up its folders now. */
  | { type: "sandbox.apply-folders-now"; owner: SandboxOwner }
  /** What the sandbox reaches besides the model and Mirador, at once: nothing starts afresh, and what it may reach no longer is cut off. */
  | { type: "sandbox.set-network"; owner: SandboxOwner; network: SandboxNetwork }
  /** Adds the group first in the group named, or in none for null. */
  | { type: "workspace-group.create"; name: string; parentId: string | null }
  | { type: "workspace-group.rename"; groupId: string; name: string }
  /** Puts the group in another, or in none for null, just before a group or workspace there in the sidebar, or last there. */
  | { type: "workspace-group.move"; groupId: string; parentId: string | null; beforeGroupId: string | null; beforeWorkspaceId?: string | null }
  /** Its workspaces and groups stay where it was in the sidebar, in the group it was in. */
  | { type: "workspace-group.delete"; groupId: string }
  | { type: "profile.save"; requestId: string; profile: ProfileDraft }
  | { type: "profile.delete"; profileId: string }
  /** Turns one plugin on or off for a profile as stored, as its switch in the Profiles dialog would, without that dialog's unsaved edits. */
  | { type: "profile.turn-plugin"; profileId: string; plugin: string; on: boolean }
  /** Asks what the profile's agent offers now, so a profile editor can list models, modes and efforts without one of its conversations having run. */
  | { type: "profile.choices.get"; requestId: string; profileId: string }
  /** Starts the agent the draft describes, which need not be saved, and asks what it offers. */
  | { type: "profile.test"; requestId: string; profile: ProfileDraft }
  /** A plugin's check of what the Profiles dialog holds for it, saved or not; answered with "plugin.profile-checked". */
  | { type: "plugin.check-profile"; requestId: string; plugin: string; profile: ProfileDraft }
  /** Creates the template, or changes the one with this id. */
  | { type: "prompt-template.save"; template: Pick<PromptTemplate, "id" | "name" | "text"> }
  | { type: "prompt-template.delete"; templateId: string }
  | { type: "settings.set-canvas-use"; canvasUse: CanvasUse }
  | { type: "settings.set-keep-awake"; keepAwake: KeepAwake }
  | { type: "settings.set-reminder-morning"; minutes: number }
  | { type: "settings.set-conversation-order"; order: ConversationOrder }
  | { type: "settings.set-keep-deleted-canvas"; keep: KeepDeletedCanvas }
  /** The way room invites connect unless the owner picks the other as they make one. */
  | { type: "settings.set-room-invites-connect"; connect: RoomInviteConnect }
  | { type: "settings.set-older-after"; olderAfter: OlderAfter }
  | { type: "settings.set-conversations-shown"; shown: ConversationsShown }
  /** What new side chats may do, in every workspace that doesn't say otherwise. */
  | { type: "settings.set-side-chat-access"; sideChatAccess: SideChatAccess }
  /** The settings as a file's text; answered with "settings.exported". */
  | { type: "settings.export"; requestId: string; includeSecrets: boolean }
  /** Writes the exported settings to a file on this computer; answered with "settings.export-saved". */
  | { type: "settings.save-export"; requestId: string; includeSecrets: boolean; path: string; replace: boolean }
  /** What importing a settings file's text would do; answered with "settings.import-planned". */
  | { type: "settings.plan-import"; requestId: string; text: string }
  /** Brings in the plan's chosen items, by id; answered with "settings.imported". */
  | { type: "settings.import"; requestId: string; text: string; items: string[] }
  | { type: "settings.set-claude-program"; path: string }
  /** Looks for a newer Mirador now; what it finds comes as newer-version.found, before the answer. */
  | { type: "newer-version.check"; requestId: string }
  /** Pulls the checkout's upstream into it; the outcome comes as newer-version.pulled. */
  | { type: "newer-version.pull"; requestId: string }
  /** Empty for the system's text editor. */
  | { type: "settings.set-script-program"; program: string }
  | { type: "settings.set-editor"; setting: EditorSetting }
  | { type: "settings.set-machine-name"; machineName: string }
  /** Mirador's relay or none forgets a relay of your own and its token; a null token keeps the one set for the same relay. Answered with settings.saved. */
  | { type: "settings.set-push-relay"; requestId: string; relay: PushRelayRequest }
  /** From a joined phone only. */
  | ({ type: "push.register" } & PushRegistration)
  | { type: "push.unregister" }
  /**
   * A phone that registered for pushes sends this exactly when it showed the system notification with this id, or chose
   * not to; one it doesn't answer within a few seconds is pushed to it, as its connection may be gone without its knowing.
   */
  | { type: "notification.shown"; notificationId: string }
  /** The user's picture as a small square PNG data URL the page drew; null takes it away, leaving the person icon. */
  | { type: "settings.set-avatar"; image: string | null }
  /** The name and colour of the person the socket signed in as, shown with every message they write. Answered with settings.saved. */
  | { type: "person.set-own-profile"; requestId: string; name: string; color: Pastel | null }
  /** Without a launch, the conversation starts on the workspace's default as the host has it when the message arrives. */
  /** With a prompt, the new conversation's agent starts on it at once. */
  /** Without `startsIn`, where the workspace starts its conversations. */
  | { type: "conversation.create"; workspaceId: string; launch?: Launch; prompt?: string; startsIn?: ConversationPlace }
  /** Puts the conversation just before another of its workspace in the sidebar, or last. */
  | { type: "conversation.move"; conversationId: string; beforeConversationId: string | null }
  | { type: "sessions.list"; requestId: string; workspaceId: string; launch: Launch }
  /** Sessions in the workspace whose title or messages contain the query, newest first. */
  | { type: "sessions.search"; requestId: string; workspaceId: string; launch: Launch; query: string }
  /** The slash commands the conversation's agent takes, as it last listed them. */
  | { type: "slash-commands.list"; requestId: string; conversationId: string }
  /**
   * What the user typed in the conversation's workspace's other conversations, newest first, for ↑ in the message box;
   * with `ownBeforeSeq`, also what they typed in this conversation before that event, for a client holding only its latest turns.
   */
  | { type: "prompt-history.list"; requestId: string; conversationId: string; ownBeforeSeq?: number }
  /** Paths for the @mention being written: what follows the @, completed as a path or searched for in the workspace. */
  | { type: "mentions.suggest"; requestId: string; conversationId: string; query: string }
  | {
      type: "conversation.adopt";
      workspaceId: string;
      launch: Launch;
      session: Pick<ExternalSession, "sessionId" | "title" | "inWorktree">;
      mode: AdoptMode;
    }
  /** A new conversation with a copy of this one's agent session, which goes on as it was: whole, or through the turn begun with the message at `throughTurnSeq`. */
  | { type: "conversation.fork"; conversationId: string; throughTurnSeq?: number }
  /** Whether the conversation can be forked yet, for a page that does not hold its history. */
  | { type: "conversation.check-fork"; requestId: string; conversationId: string }
  /** A side chat about the conversation, read-only where its agent allows, asking `text` at once; the host answers `conversation.side-chat.started`. */
  | { type: "conversation.side-chat.start"; requestId: string; conversationId: string; text: string }
  /**
   * What the conversation's next side chats may do, ahead of its workspace and Settings. Named on a side chat, that one
   * follows at once and the conversation it is beside remembers it; its other side chats stay as they are.
   */
  | { type: "conversation.set-side-chat-access"; conversationId: string; sideChatAccess: SideChatAccess }
  /** Makes the side chat a conversation of its own, in the mode of the conversation it was beside, else its profile's. */
  | { type: "conversation.side-chat.promote"; conversationId: string }
  /** Without `discardsUncommitted`, a conversation whose worktree holds uncommitted files stays, and the host answers `conversation.delete-asks`. */
  | { type: "conversation.delete"; conversationId: string; discardsUncommitted?: boolean }
  /**
   * Deletes them together, as a workspace's Older fold does, leaving out any at work or waiting for the user by now. Without
   * `discardsUncommitted`, when their worktrees hold uncommitted files none goes, and the host answers `conversations.delete-asks`.
   */
  | { type: "conversations.delete"; conversationIds: string[]; discardsUncommitted?: boolean }
  | { type: "conversation.rename"; conversationId: string; title: string }
  | { type: "conversation.set-favourite"; conversationId: string; favourite: boolean }
  | { type: "conversation.set-unread"; conversationId: string; unread: boolean }
  /** Null takes the reminder away, or dismisses one whose time came. */
  | { type: "conversation.set-reminder"; conversationId: string; reminder: Reminder | null }
  | { type: "conversation.set-profile"; conversationId: string; profileId: string }
  | { type: "conversation.subscribe"; conversationId: string; lowData?: LowDataSubscription }
  /**
   * The turns before the earliest event the subscriber holds: as many as a low-data subscriber asks for, and for a page
   * as many as the host sends at a time, or more to reach back to the event `reaching`.
   */
  | { type: "conversation.load-earlier"; requestId: string; conversationId: string; beforeSeq: number; turns?: number; reaching?: number }
  /** How often the query occurs in each entry of the conversation that starts before `beforeSeq`, which the page does not hold. */
  | { type: "conversation.find"; requestId: string; conversationId: string; query: string; caseSensitive: boolean; beforeSeq: number }
  /** A tool call's raw output, which a page gets only when it shows it. */
  | { type: "tool-raw-output.get"; requestId: string; conversationId: string; toolCallId: string }
  /** Tool output the low-data form shortened, whole: the content of the stored event its mark names, images still as links. */
  | { type: "tool-output.get"; requestId: string; conversationId: string; seq: number }
  | { type: "conversation.unsubscribe"; conversationId: string }
  | { type: "conversation.prompt"; conversationId: string; text: string; imageIds: string[]; afterTurn?: boolean }
  | { type: "conversation.cancel"; conversationId: string; force?: boolean }
  /** What undoing the turn that began with the message at `seq` would do to the workspace's files. */
  | { type: "conversation.revert-preview"; requestId: string; conversationId: string; seq: number }
  /** Puts the workspace's files back to how they were before the turn that began with the message at `seq`. */
  | { type: "conversation.revert"; requestId: string; conversationId: string; seq: number }
  /** What taking the conversation and the files back to before the turn that began with the message at `seq` would do. */
  | { type: "conversation.rewind-preview"; requestId: string; conversationId: string; seq: number }
  /**
   * Takes the conversation and the workspace's files back to how they were before the turn at `seq`, and the agent with
   * them; with `keepFiles`, the conversation alone, leaving every file as it is now.
   */
  | { type: "conversation.rewind"; requestId: string; conversationId: string; seq: number; keepFiles?: boolean }
  | { type: "conversation.run-command"; conversationId: string; command: string }
  | { type: "conversation.stop-command"; conversationId: string; commandId: string }
  | { type: "conversation.drop-command-outputs"; conversationId: string; commandIds: string[] }
  | { type: "conversation.queue.remove"; conversationId: string; messageId: string }
  | { type: "images.discard"; conversationId: string; imageIds: string[] }
  | { type: "conversation.queue.move"; conversationId: string; messageId: string; beforeMessageId: string | null }
  | { type: "conversation.queue.set-after-turn"; conversationId: string; messageId: string; afterTurn: boolean }
  | { type: "conversation.usage-limit.continue"; conversationId: string }
  | { type: "conversation.try-again"; conversationId: string; errorSeq: number }
  | { type: "conversation.usage-limit.stop-waiting"; conversationId: string }
  | { type: "conversation.job-wait.stop"; conversationId: string; waitId: string }
  /** Stops one of Claude Code's background tasks; the turn it started in keeps running. */
  | { type: "conversation.async-task.stop"; conversationId: string; asyncTaskId: string }
  /** Dismisses one finished background task from above the composer. */
  | { type: "conversation.async-task.dismiss"; conversationId: string; asyncTaskId: string }
  /** Dismisses all finished background tasks from above the composer. */
  | { type: "conversation.async-task.clear-finished"; conversationId: string }
  /** Takes a conversation a plugin's tool started off its caller's list of delegated tasks. */
  | { type: "conversation.delegation.dismiss"; conversationId: string }
  /** Takes finished conversations a plugin's tool started off this caller's list of delegated tasks; with `plugin`, only that plugin's. */
  | { type: "conversation.delegation.clear-finished"; conversationId: string; plugin?: string }
  /** The last part of the file a background task writes its output to; null when none is there to read. */
  | { type: "async-task.output.get"; requestId: string; conversationId: string; asyncTaskId: string }
  | { type: "conversation.set-ask-mode"; conversationId: string; askMode: AskMode }
  /** Null follows the profile again. */
  | { type: "conversation.set-plugin-setting"; conversationId: string; plugin: string; setting: string; value: string | null }
  | { type: "conversation.set-bypass-permissions"; conversationId: string; bypassPermissions: boolean }
  | { type: "conversation.set-config"; conversationId: string; configId: string; value: string | boolean }
  | { type: "permission.respond"; conversationId: string; permissionId: string; optionId: string | null }
  | { type: "ask.answer"; itemId: string; label: string; picked?: PickedSeveral; note?: string; answers?: AskAnswerEntry[] }
  /** How a page rendered: one the agent showed, or a question's `askPage`. */
  | { type: "canvas.report"; itemId: string; errors: string[]; askPage?: AskPage }
  /**
   * The page shows this app's document, and gets its state on every change until it unsubscribes. A phone from before each
   * conversation had a document of its own names no document in this or the view's other messages, and gets the one a
   * conversation of the workspace showed last.
   */
  | { type: "app.subscribe"; workspaceId: string; app: string; documentId?: string }
  | { type: "app.unsubscribe"; workspaceId: string; app: string; documentId?: string }
  /** An operation the user made in an open document's view. */
  | { type: "app.apply"; workspaceId: string; app: string; documentId?: string; op: unknown }
  /** Opens a document another conversation of the workspace has, in this conversation, whose own document of that app goes with it. */
  | { type: "app.use-in"; workspaceId: string; app: string; documentId: string; conversationId: string }
  /** The app's view set an item of its storage in the workspace; a null value removes it. */
  | { type: "app.storage-set"; workspaceId: string; app: string; key: string; value: string | null }
  /** The user runs one of the app's tasks from its view; its progress and end come in the app's state. */
  | { type: "app.run"; workspaceId: string; app: string; documentId?: string; task: string }
  /** The user opens an app on a file of the conversation's workspace, shown in that conversation, with /<app>:open; answered with "app.file-opened". */
  | { type: "app.open-file"; requestId: string; conversationId: string; app: string; file: string }
  /** The user stops the task an open document has under way. */
  | { type: "app.stop-task"; workspaceId: string; app: string; documentId?: string }
  /** What the user did in a plugin item's view, for the plugin's host code; answered with "canvas.item-acted". */
  | { type: "canvas.item-action"; requestId: string; itemId: string; action: unknown }
  /** The user runs a plugin's tool from the slash menu, by its command's name, with what follows the name; answered with "canvas.command-ran". */
  | { type: "canvas.run-command"; requestId: string; conversationId: string; command: string; arguments?: string }
  /** A plugin's own window opened: it gets the window's state now, and again whenever the plugin changes it. */
  | { type: "plugin-window.subscribe"; plugin: string }
  /** What the user did in a plugin's own window, for its host code; answered with "plugin-window.acted". */
  | { type: "plugin-window.action"; requestId: string; plugin: string; action: unknown }
  /** A workspace's tabs of the plugins came into view: each gets its state now, and again whenever its plugin changes it. */
  | { type: "plugin-tab.subscribe"; workspaceId: string }
  /** What the user did in a plugin's workspace tab, for its host code; answered with "plugin-tab.acted". */
  | { type: "plugin-tab.action"; requestId: string; plugin: string; workspaceId: string; action: unknown }
  /** The user takes a plugin's item out of the tab; it stays gone until the plugin publishes a new one. */
  | { type: "canvas.dismiss"; itemId: string }
  /** A page the agent showed, as a file of its own, for the user to copy or download. */
  | { type: "canvas.export"; requestId: string; itemId: string; libraries: PageLibraries }
  | { type: "canvas.save-to-project"; requestId: string; itemId: string; path: string; libraries: PageLibraries; replace: boolean }
  /** The page drawn as a PNG by its own frame, sent as base64 for the host to write into the project. */
  | { type: "canvas.save-image-to-project"; requestId: string; itemId: string; path: string; image: string; replace: boolean }
  | { type: "changes.list"; requestId: string; conversationId: string; scope: ChangeScope }
  | { type: "changes.diff"; requestId: string; conversationId: string; scope: ChangeScope; path: string }
  | { type: "changes.files"; requestId: string; conversationId: string }
  | { type: "changes.committable"; requestId: string; conversationId: string }
  | { type: "changes.commit"; requestId: string; conversationId: string; paths: string[]; message: string }
  | { type: "changes.landable"; requestId: string; conversationId: string }
  | { type: "changes.land"; requestId: string; conversationId: string }
  | { type: "changes.open-in-editor"; conversationId: string; path: string; line: number }
  /**
   * Opens a file in the program the host's system uses for it, when it is in the workspace or the agent changed it, or
   * when the owner agreed to open it although it is neither.
   */
  | { type: "files.open"; conversationId: string; path: string; ownerAgreed?: boolean }
  | { type: "fs.complete"; requestId: string; prefix: string }
  | { type: "statusline.render"; requestId: string; conversationId: string; columns: number; runCommand: boolean }
  | { type: "subagent-usage.get"; requestId: string; conversationId: string; toolCallIds: string[] }
  | { type: "terminals.attach"; conversationId: string | null }
  /** Opens a terminal in a new tab, or beside or below the one `split` names, in its tab. */
  | { type: "terminal.open"; requestId: string; conversationId: string; split: TerminalSplit | null; columns: number; rows: number }
  | { type: "terminal.replay"; terminalId: string }
  /** Signs the conversation's agent in again, in a new tab of its terminals. */
  | { type: "terminal.open-login"; requestId: string; conversationId: string; columns: number; rows: number }
  | { type: "terminal.follow-job"; requestId: string; conversationId: string; waitId: string; columns: number; rows: number }
  /** Runs a command Claude Code opens a panel for only in its own terminal, in a new tab of the conversation's terminals. */
  | { type: "terminal.open-panel-command"; requestId: string; conversationId: string; line: string; columns: number; rows: number }
  | { type: "terminal.input"; terminalId: string; data: string }
  | { type: "terminal.resize"; terminalId: string; columns: number; rows: number }
  /** With `unlessBusy`, a terminal running a command stays open, and the host answers terminal.busy. */
  | { type: "terminal.close"; terminalId: string; unlessBusy?: boolean }
  /** With `unlessBusy`, a tab where a command runs stays open, and the host answers terminal.busy with its `tabId`. */
  | { type: "terminal.close-tab"; tabId: string; unlessBusy?: boolean }
  | { type: "terminal.clear"; terminalId: string }
  /** What this page shows, and whether you are looking at it: the host notifies only about conversations nobody is looking at. */
  | {
      type: "presence";
      conversationId: string | null;
      attentive: boolean;
      /** The side chat the page shows beside the conversation, which you see as much as the conversation itself. */
      sideChatId?: string;
      /** The room the page shows instead of a conversation. */
      roomId?: string;
      /** Whether the page is in sight, though perhaps not in focus: a room it shows has you there while it is. */
      visible: boolean;
    }
  /** Asks the host to answer with pong, so a device can tell a socket that went quiet from one that died on the way. */
  | { type: "ping" }
  /** An error the page threw, so that one which blanks the page leaves its stack in the host log. */
  | { type: "page.error"; message: string; stack: string }
  | { type: "host.restart" }
  | { type: "devices.list" }
  | { type: "plugins.list" }
  /** The user's choice for one of a plugin's settings. */
  | { type: "plugins.choose-setting"; plugin: string; setting: string; value: string }
  /** Clones without building, for the user to agree to; answered with "plugins.offered". `url` is anything git clones, a local path too; without a branch, its newest release or default branch. */
  | { type: "plugins.offer"; requestId: string; url: string; branch: string | null }
  | { type: "plugins.offer-update"; requestId: string; folder: string }
  /** The user agreed to the offer: builds it and installs it, or swaps it in for the plugin it updates. */
  | { type: "plugins.install"; requestId: string; offerId: string }
  | { type: "plugins.discard"; offerId: string }
  | { type: "plugins.find-commits"; requestId: string; folder: string }
  | { type: "plugins.remove"; requestId: string; folder: string }
  /** When the updates the host finds go in without asking; "ask" leaves every one to the user. */
  | { type: "settings.set-plugin-update-mode"; mode: PluginUpdateMode }
  /** Whether the plugin's releases may go in without asking. */
  | { type: "plugins.set-updates-by-itself"; folder: string; updatesByItself: boolean }
  /** Puts back the plugin an update replaced as the host started; answered with "plugins.changed". */
  | { type: "plugins.undo-update"; requestId: string; folder: string }
  | { type: "devices.invite"; requestId: string }
  /** Looks for the addresses other devices reach this host at; address.serve first puts its ports on the tailnet, when Tailscale is installed. */
  | { type: "address.find"; requestId: string }
  | { type: "address.serve"; requestId: string }
  | { type: "device.revoke"; deviceId: string }
  /** number is what the approver typed: the number the device asking shows. */
  | { type: "join-request.approve"; requestId: string; joinRequestId: string; number: string }
  | { type: "join-request.deny"; joinRequestId: string }
  /** Saved to config.json for the host's next start; null takes the address out. */
  | { type: "settings.set-public-address"; requestId: string; address: PublicAddress | null }
  | { type: "settings.set-network"; requestId: string; on: boolean }
  /** Only Mirador's own pages may send it, as only they get the endpoints' API keys to send back. */
  | { type: "voice.set-settings"; requestId: string; settings: VoiceSettings }
  /** Only from Mirador's own pages; setting up again also brings in what a newer Mirador pins, and adds the models, by id, not on this Mac yet. */
  | { type: "voice.engine.set-up"; models: string[] }
  | { type: "voice.engine.cancel" }
  | { type: "voice.engine.remove" }
  /** Refused for a model the voice settings use. */
  | { type: "voice.engine.remove-model"; model: string }
  /** address is what the user typed or pasted: a name on the network, an address, or an invite link; name may be empty. */
  | { type: "machine.add"; requestId: string; name: string; address: string }
  | { type: "machine.rename"; machineId: string; name: string }
  | { type: "machine.remove"; machineId: string }
  | { type: "machine.set-color"; machineId: string; color: Pastel | null }
  /** Keeps a machine one of this computer's machines has joined out of the rail; machine.show-again brings it back. */
  | { type: "machine.hide"; machine: MachineSeen }
  | { type: "machine.show-again"; machine: MachineSeen }
  /** invite is what the user pasted: an invite's code, or its whole link, which a machine reached peer to peer needs. */
  | { type: "machine.join"; requestId: string; machineId: string; invite: string }
  | { type: "machine.ask-to-join"; requestId: string; machineId: string }
  /** A room of a machine joined as a person was opened here, which may call you again from then on. */
  | { type: "machine.room-opened"; machineId: string; roomId: string }
  /** Keeps a room of a machine joined as a person quiet on this computer, whatever that machine does, or lets it call again. */
  | { type: "machine.mute-room"; machineId: string; roomId: string; muted: boolean }
  /** Leaves a room of a machine joined as a person: it goes from here at once, and a machine that isn't answering hears of it once it does. */
  | { type: "machine.leave-room"; machineId: string; roomId: string }
  /** Forgets that the owner of a machine joined as a person turned this computer's owner away from one of its rooms. */
  | { type: "machine.dismiss-knock"; machineId: string; roomId: string }
  /** Brings an agent of one of your profiles into a room of a machine joined as a person, to work in one of your workspaces; the host answers `machine.agent-brought`. */
  | { type: "machine.bring-agent"; requestId: string; machineId: string; roomId: string; profileId: string; workspaceId: string | null; othersTasks: OthersTasks }
  | { type: "machine.take-agent-out"; broughtId: string }
  /** Your OK, or not, for a task someone else gave an agent you brought into a room. */
  | { type: "brought-task.answer"; taskId: string; answer: "allow" | "deny" }
  | { type: "search"; requestId: string; query: string }
  /** `models` holds the model and effort chosen for each agent, by its profile id; an agent not in it takes its profile's. */
  | { type: "room.create"; requestId: string; name: string; workspaceId: string; profileIds: string[]; permissions: PermissionPreset; models: Record<string, RoomAgentModel> }
  | { type: "room.rename"; roomId: string; name: string }
  | { type: "room.set-agents"; roomId: string; profileIds: string[] }
  /** The agent's model and effort in the room, from its next session there on, and in its open one at once. */
  | { type: "room.set-agent-model"; roomId: string; profileId: string; model: string | null; effort: string | null }
  /** Its agents' conversations follow the preset from their next permission request on. */
  | { type: "room.set-permissions"; roomId: string; permissions: PermissionPreset }
  | { type: "room.set-workspace"; roomId: string; workspaceId: string }
  /** Lets a person of this machine into the room with the role, or changes their role there. */
  | { type: "room.set-person-role"; roomId: string; personId: string; role: RoomRole }
  | { type: "room.remove-person"; roomId: string; personId: string }
  /**
   * An invite into the room with the role for as many people as `seats`, which they join this machine with from their
   * own Mirador, the one way `connect` names, coming in at once or waiting for the owner's OK as `letsIn` says, for as
   * long as `lifetime` says; the host answers `room.invited`.
   */
  | { type: "room.invite"; requestId: string; roomId: string; role: RoomRole; connect: RoomInviteConnect; seats: RoomInviteSeats; letsIn: RoomInviteLetsIn; lifetime: RoomInviteLifetime }
  | { type: "room.withdraw-invite"; inviteId: string }
  /** Lets someone who waits to join the room in, with the role their invite gave. */
  | { type: "room.let-in"; roomId: string; personId: string }
  /** Turns someone who waits to join the room away: in no room then, they lose their devices here too. */
  | { type: "room.turn-away"; roomId: string; personId: string }
  | { type: "room.turn-away-all"; roomId: string }
  /** Answers a request a room's own agent, by its profile, waits on; allowing it for the task lets the same again through until the turn ends. */
  | { type: "room.approve"; roomId: string; profileId: string; permissionId: string; answer: RoomApprovalAnswer }
  /** Answers a task of a person other than the owner that waits: allowing sends it to its agents, denying tells the room it was declined. */
  | { type: "room.answer-task"; roomId: string; messageId: string; answer: "allow" | "deny" }
  /** Whether the tasks people other than the owner give the room's agents wait for an approver, from the next one on. */
  | { type: "room.set-peoples-tasks-wait"; roomId: string; wait: boolean }
  /** What the room's Claude Code agents load of your own Claude Code setup; those already there start afresh and read the room again, once. */
  | { type: "room.set-claude-setup"; roomId: string; setup: ClaudeSetup }
  /** Whether the agent gets its profile's value of the variable, by name; already there, it starts afresh and reads the room again, once. */
  | { type: "room.set-agent-variable"; roomId: string; profileId: string; name: string; given: boolean }
  /** Whether the agent gets all of this computer's environment; already there, it starts afresh and reads the room again, once. */
  | { type: "room.set-agent-host-environment"; roomId: string; profileId: string; given: boolean }
  /** Whether the room's agents run in a sandbox, and work freely there; those already there start afresh. Turning it on where something stands in its way fails with why. */
  | { type: "room.set-sandbox"; roomId: string; sandbox: SandboxSetting }
  /** Whether this computer and the room can have a sandbox; the host answers `room.sandbox-checked`. */
  | { type: "room.check-sandbox"; requestId: string; roomId: string }
  /** Whether the room's agents read what guests write there, from their next catch-up on. */
  | { type: "room.set-agents-read-guests"; roomId: string; read: boolean }
  /** Deletes the room with its agents' conversations in it. */
  | { type: "room.delete"; roomId: string }
  /** The host answers `room.timeline`, then sends the room's new messages as `room.message` until `room.unsubscribe`. */
  | { type: "room.subscribe"; roomId: string }
  | { type: "room.unsubscribe"; roomId: string }
  /** `tags` are profile ids of the room's agents; a follow-up in a thread (`threadId`) tags none, as it goes to the thread's agent. */
  | { type: "room.write"; roomId: string; text: string; tags: string[]; threadId: string | null }
  /** You type in the room's message box (`threadId` null) or a thread's, or stopped with it emptied; never what you type. */
  | { type: "room.writing"; roomId: string; threadId: string | null; writing: boolean }
  /** What the room's agents took since then; the host answers `room.usage.got`. */
  | { type: "room.usage.get"; requestId: string; roomId: string; since: number | null }
  /** Your pick for one question an agent of the room asks, by the places of the question and the option; a new pick replaces the last. */
  | { type: "room.vote"; roomId: string; itemId: string; question: number; option: number }
  /** The answer its agent gets, one for each of its questions, from the person whose task it works on or the owner. */
  | { type: "room.confirm"; roomId: string; itemId: string; answers: RoomConfirmedAnswer[] }
  /** Whether the room notifies you; muted, it still counts what you have not read. */
  | { type: "room.mute"; roomId: string; muted: boolean }
  /** From a person other than the machine's owner: they leave the room; out of their last room, they are signed out of the machine. */
  | { type: "room.leave"; roomId: string }
  /** Whether the room's members may bring agents of their own Miradors into it; turned off, those already there go. */
  | { type: "room.set-members-bring-agents"; roomId: string; allowed: boolean }
  /** From a member's own Mirador: an agent of theirs joins the room under this name, of this kind; the host answers `room.agent-brought`. */
  | { type: "room.bring-agent"; requestId: string; roomId: string; name: string; harness: HarnessId; worksInRoom: boolean }
  /** Its bringer, or the room's owner, takes an agent someone brought out of the room. */
  | { type: "room.take-agent-out"; roomId: string; agentId: string }
  /** From a person's own Mirador: it takes the tasks of the agents they brought on this socket, from now on. */
  | { type: "room.brought-agents-here" }
  /** From a person's own Mirador: the agent they brought began a turn on the task. */
  | { type: "room.brought-task-started"; roomId: string; agentId: string; taskId: string }
  /** From a person's own Mirador: the final answer of the agent they brought to the task, or how it ended without one. */
  | { type: "room.brought-task-answered"; roomId: string; agentId: string; taskId: string; text: string; ended: BroughtAnswerEnd | null }
  /** From a person's own Mirador: a streamed thinking or text chunk of an agent working in the room's workspace. */
  | { type: "room.brought-step"; roomId: string; agentId: string; taskId: string; stepId: string; kind: BroughtStepKind; delta: string }
  /** From a person's own Mirador: a canvas page drawn by an agent they brought during a room task. */
  | { type: "room.brought-canvas-show"; roomId: string; agentId: string; taskId: string; itemId: string; title: string; html: string }
  /** From a person's own Mirador: a canvas question asked by an agent they brought during a room task. */
  | { type: "room.brought-canvas-ask"; roomId: string; agentId: string; taskId: string; itemId: string; ask: BroughtCanvasAskPayload }
  /** From a person's own Mirador: withdraws a waiting canvas question of an agent they brought. */
  | { type: "room.brought-canvas-cancel"; roomId: string; agentId: string; itemId: string }
  /** From a person's own Mirador: the agent they brought asks for this to be done in the room's workspace, for the task; the host answers `room.workspace-answered`. */
  | { type: "room.workspace-call"; roomId: string; agentId: string; taskId: string; callId: string; call: WorkspaceCall }
  /** From a person's own Mirador: a call is no longer wanted, as the agent's turn ended or was stopped. */
  | { type: "room.workspace-call-stopped"; roomId: string; agentId: string; callId: string }
  /** The owner or an approver lets an agent someone brought work in the room's workspace, or no longer. */
  | { type: "room.answer-workspace"; roomId: string; agentId: string; answer: RoomWorkspaceAnswer }
  | { type: "room.answer-workspace-call"; roomId: string; callId: string; answer: "allow" | "deny" };

export type ServerMessage =
  | {
      type: "snapshot";
      workspaces: Workspace[];
      workspaceGroups: WorkspaceGroup[];
      /** Agents' conversations in rooms too, which carry their `roomId`. */
      conversations: Conversation[];
      rooms: Room[];
      /** The permission requests the rooms' agents wait on, oldest first. */
      roomApprovals: RoomApproval[];
      /** The tasks of people other than the owner that wait for an approver, oldest first. */
      roomTasksWaiting: RoomTaskApproval[];
      /** What agents people brought wait on for an approver, to work in the rooms' workspaces. */
      roomWorkspaceWaiting: RoomWorkspaceApproval[];
      /** Where setting up each room's and workspace's sandbox stands on this computer, of those set up since the host started. */
      sandboxSetups?: OwnedSetup[];
      /** The agent config files sandboxed agents changed, put back and held for the owner's OK, oldest first. */
      heldChanges: HeldChange[];
      /** The rooms and workspaces whose sandbox stopped as they hold as many changes as one may. */
      sandboxesHoldingTooMany: SandboxOwner[];
      /** The folders of this computer each room or workspace gave its sandbox; the owner's alone, never shown to anyone else. */
      sandboxFolders: SandboxFolders[];
      /** The room invites with seats left, soonest to expire first. */
      roomInvites: RoomInvite[];
      /** Those who wait to join rooms, longest waiting first. */
      roomJoiners: RoomJoiner[];
      /** The agents this computer's owner brought into rooms of other machines, and the tasks others gave them that wait for their OK. */
      broughtAgents: BroughtAgentHere[];
      broughtTasks: BroughtTaskWaiting[];
      profiles: Profile[];
      promptTemplates: PromptTemplate[];
      canvasUse: CanvasUse;
      claudeProgram: ClaudeProgram;
      /** The program the host opens scripts in, as text; empty for the system's text editor. */
      scriptProgram: string;
      editor: EditorState;
      /** The name Settings gave this machine, which devices show for it; null while it goes by its computer's name. Absent from hosts before names. */
      machineName?: string | null;
      /** The computer's own name, which the machine goes by while Settings give it none. */
      computerName?: string;
      pushRelay: PushRelaySetting;
      /** The user's profile picture as a small square PNG data URL; null when they set none. */
      avatar: string | null;
      /** Everyone who writes in this machine's conversations, the owner first. */
      people: Person[];
      /** Whose picture `avatar` is. */
      ownerId: string;
      /** The person this page signed in as. */
      you: string;
      /** The agents this machine has a program for, which a new profile can run. */
      installedAgents: HarnessId[];
      /** Where this page loads canvas libraries from: the address it reached the host at may differ from the one agents were given. */
      canvasAssetsOrigin: string;
      agentsCanvasAssetsOrigin: string;
      machines: Machine[];
      machineStatuses: MachineStatus[];
      hiddenMachines: MachineSeen[];
      /** The id this Mirador goes by on the machines that join it. */
      hostId: string;
      homeDir: string;
      /** Fresh for each start of the host process. */
      hostRunId: string;
      /** Mirador's own host source was edited since this host started. */
      hostCodeChanged: boolean;
      /** A desktop app listening to this host was built from other code than the host's checkout has now. */
      desktopAppOutdated: boolean;
      /** The version of Mirador this host is. */
      version: string;
      /** The host answers ping; absent from hosts before pings, which answer it with an error. */
      answersPings?: true;
      newerVersion: NewerVersion | null;
      /** Plugins from git repos with new commits, as the host found by itself. */
      pluginUpdates?: PluginUpdate[];
      installedApps: InstalledApp[];
      openApps: OpenApp[];
      /** Where the canvas assets serve each plugin's canvas view, by plugin name. */
      canvasViews: Record<string, string>;
      /** Each plugin's tools by their name on the canvas server, with the plugin's title; missing from an older host. */
      pluginToolTitles?: Record<string, string>;
      /** Each installed plugin's title by its name in plugin.json; missing from an older host. */
      pluginTitles?: Record<string, string>;
      /** The plugins' tools the user runs from the slash menu, by their command's name; missing from an older host. */
      pluginCommands?: PluginCommand[];
      /** The plugins a profile can turn off for its conversations. */
      conversationPlugins: ConversationPlugin[];
      /** Each loaded plugin's icon and tagline by its name. */
      pluginLooks: Record<string, PluginLook>;
      /** The plugins that have a window of their own: their titles by name. Missing from a host older than plugin windows. */
      pluginWindows?: Record<string, string>;
      /** The plugins that have a workspace tab: their titles by name. Missing from a host older than plugin API 7. */
      workspaceTabs?: Record<string, string>;
      /** Missing from a host older than plugin settings. */
      pluginSettings?: PluginSettings[];
      /** Missing from a host older than the keep awake setting. */
      keepAwake?: KeepAwake;
      /** Missing from a host older than plugins that update by themselves. */
      pluginUpdateMode?: PluginUpdateMode;
      /** The updates the host put in as it started, and those it took back out; the same for each page until the next start. */
      pluginsUpdatedAtStart?: AppliedPluginUpdate[];
      /** The plugins running since the host started at a release the catalog revoked since, until a restart stops them. Missing from a host older than revocations. */
      revokedPlugins?: RevokedPlugin[];
      /** Missing from a host older than keeping deleted canvases. */
      keepDeletedCanvas?: KeepDeletedCanvas;
      /** Missing from a host older than reminders. */
      reminderMorning?: number;
      /** Missing from a host older than ordering conversations. */
      conversationOrder?: ConversationOrder;
      /** Only for Mirador's own pages; null when there is to be none. Missing from a host older than exporting and importing settings. */
      configFile?: ConfigFileStatus | null;
      olderAfter: OlderAfter;
      conversationsShown: ConversationsShown;
      sideChatAccess: SideChatAccess;
      /** The kinds of notification a phone may register for pushes of. Missing from a host older than reminders, which refuses a registration with a kind it doesn't know. */
      pushKinds?: NotificationKind[];
    }
  /** Every app open in every workspace, whenever one opens or closes, and when an agent opens one again. */
  | { type: "apps.open"; openApps: OpenApp[] }
  /** Only to the pages subscribed to the app: a whole document, on every change. */
  | { type: "app.state"; state: AppDocumentState }
  /** What the app's view keeps in the workspace: to a page when it subscribes, and to the subscribed pages after each change. */
  | { type: "app.storage"; workspaceId: string; app: string; items: AppStorageItems }
  | { type: "profile.upserted"; profile: Profile }
  | { type: "profile.deleted"; profileId: string }
  | { type: "profile.saved"; requestId: string; profileId: string }
  /** What the profile's agent said it offers; null when it was not there to answer. */
  | { type: "profile.choices.got"; requestId: string; profileId: string; configOptions: SessionConfigOption[] | null }
  | { type: "profile.tested"; requestId: string; result: ProfileTestResult }
  /** The plugin's answer, or the problem it found. */
  | { type: "plugin.profile-checked"; requestId: string; answer: string | null; problem: string | null }
  | { type: "prompt-template.upserted"; template: PromptTemplate }
  | { type: "prompt-template.deleted"; templateId: string }
  | { type: "settings.canvas-use"; canvasUse: CanvasUse }
  | { type: "settings.keep-awake"; keepAwake: KeepAwake }
  | { type: "settings.plugin-update-mode"; mode: PluginUpdateMode }
  /** What the host put in as it started, again after one of them was undone. */
  | { type: "plugins.updated-at-start"; updates: AppliedPluginUpdate[] }
  | { type: "plugins.revoked-running"; plugins: RevokedPlugin[] }
  | { type: "settings.reminder-morning"; minutes: number }
  | { type: "settings.conversation-order"; order: ConversationOrder }
  | { type: "settings.keep-deleted-canvas"; keep: KeepDeletedCanvas }
  | { type: "settings.older-after"; olderAfter: OlderAfter }
  | { type: "settings.conversations-shown"; shown: ConversationsShown }
  | { type: "settings.side-chat-access"; sideChatAccess: SideChatAccess }
  | { type: "settings.claude-program"; claudeProgram: ClaudeProgram }
  | { type: "settings.script-program"; scriptProgram: string }
  | { type: "settings.editor"; editor: EditorState }
  | { type: "settings.machine-name"; machineName: string | null }
  | { type: "settings.push-relay"; pushRelay: PushRelaySetting }
  /** The user's picture next to every page; null when they set none, leaving the person icon. */
  | { type: "settings.avatar"; image: string | null }
  /** Everyone again, the owner first, whenever someone's name or colour changes. */
  | { type: "people.listed"; people: Person[] }
  /** Sent after the snapshot and on every change; API keys are empty for clients that don't get profile environments. */
  | { type: "voice.settings"; settings: VoiceSettings }
  /** Sent after the snapshot, on every change and, while setting up, on its progress. */
  | { type: "voice.engine"; engine: VoiceEngineStatus }
  | { type: "workspace.upserted"; workspace: Workspace }
  | { type: "workspace.deleted"; workspaceId: string }
  | { type: "workspace.icon"; workspaceId: string; icon: WorkspaceIcon | null }
  | { type: "workspace-group.upserted"; group: WorkspaceGroup }
  | { type: "workspace-group.deleted"; groupId: string }
  | { type: "conversation.upserted"; conversation: Conversation }
  | { type: "conversation.deleted"; conversationId: string }
  | { type: "room.created"; requestId: string; roomId: string }
  | { type: "room.upserted"; room: Room }
  | { type: "room.deleted"; roomId: string }
  /** `code` is shown once, here: the host keeps only its hash. */
  /** To the owner's page that asked alone: its code, and the tunnel's one-time key with it, let whoever holds them in. */
  /** The invite's one text, a bearer secret until it is used, for the owner's page that asked alone; or why none could be made that way. */
  | { type: "room.invited"; requestId: string; invite: RoomInvite | null; text: string | null; problem: string | null; problemAbout?: HostProblem }
  /** The rooms someone other than the owner is in now, each time that changes. */
  | { type: "rooms.people-here"; roomIds: string[] }
  /** The room invites with seats left, each time one is made, used or withdrawn; those of a deleted room go with it. */
  | { type: "room-invites.listed"; invites: RoomInvite[] }
  /** Those who wait to join rooms, each time someone knocks, is let in or turned away; those of a deleted room go with it. */
  | { type: "room-joiners.listed"; joiners: RoomJoiner[] }
  /** To a person other than the owner alone: the rooms they wait to be let into, by id alone, each time that changes. */
  | { type: "rooms.waiting-to-join"; personId: string; roomIds: string[] }
  /** With the pages and questions of the room's canvas, which come as `canvas.upserted` from then on, and the votes on its questions, which come as `room.votes`. */
  | ({ type: "room.timeline"; roomId: string; canvas: CanvasItem[]; votes: RoomQuestionVotes[]; workspaceCalls: RoomWorkspaceCall[]; broughtSteps: RoomBroughtStep[] } & RoomTimeline)
  /** A call of an agent someone brought, in the room's workspace, as it begins and each time it changes. */
  | { type: "room.workspace-call-shown"; call: RoomWorkspaceCall }
  /** A streamed thinking or text step of an agent someone brought to work in the room's workspace, as it starts and grows. */
  | { type: "room.brought-step-shown"; step: RoomBroughtStep }
  /** To the person's own Mirador alone: what came of a call of the agent they brought. */
  | { type: "room.workspace-answered"; personId: string; roomId: string; agentId: string; callId: string; result: WorkspaceCallResult }
  /** The picks on a question of a subscribed room's agent, and who may confirm its answer, each time either changes. */
  | { type: "room.votes"; roomId: string; votes: RoomQuestionVotes }
  /** To the person alone: how far they have read each of their rooms and what waits for them there, each time it changes. */
  | { type: "rooms.reading"; personId: string; readings: RoomReading[] }
  /** To a person other than the owner alone, while they look elsewhere: their own Mirador tells them of it. */
  | { type: "room.alert"; roomId: string; personId: string; alert: RoomAlert }
  /** A new message of a subscribed room, with the threads it starts, one for each agent it tags; one the room holds already is written anew, in its place by its seq. */
  | { type: "room.message"; message: RoomMessage; threads: RoomThread[] }
  /** All the room's agents wait on, and the people's tasks that wait for an approver, oldest first, each time one starts or stops waiting. */
  | { type: "room.approvals"; roomId: string; approvals: RoomApproval[]; tasks: RoomTaskApproval[]; workspace: RoomWorkspaceApproval[] }
  /** What stands in the way of the room's sandbox, if anything, to the page that asked. */
  | ({ type: "room.sandbox-checked"; requestId: string; roomId: string } & SandboxCheck)
  /** What stands in the way of the workspace's sandbox, if anything, to the page that asked. */
  | ({ type: "workspace.sandbox-checked"; requestId: string; workspaceId: string } & WorkspaceSandboxCheck)
  /** Where setting up a room's or workspace's sandbox stands, each time it moves on. */
  | { type: "sandbox.setup"; owner: SandboxOwner; setup: SandboxSetup }
  /** The held agent config files of a room's or workspace's sandbox, each time one comes or is answered. */
  | { type: "sandbox.held-changes"; owner: SandboxOwner; changes: HeldChange[]; full: boolean }
  /** A held change's text, to the page that asked; null once it is no longer held. */
  | { type: "sandbox.held-change-text"; requestId: string; text: HeldChangeText | null }
  /** To the page that asked, the folder added, or why it can't be. */
  | { type: "sandbox.folder-added"; requestId: string; refused: SandboxFolderRefusal | null }
  /** To the page that asked, the folder's access changed, or why it can't be. */
  | { type: "sandbox.folder-access-set"; requestId: string; refused: SandboxFolderRefusal | null }
  /** The folders of this computer a sandbox has, each time one is added, changed, taken out or taken up by its VM. */
  | { type: "sandbox.folders"; folders: SandboxFolders }
  /** Who is in a subscribed room now and who of them writes there, after `room.timeline` and each time it changes. */
  | ({ type: "room.presence"; roomId: string } & RoomPresence)
  | { type: "room.usage.got"; requestId: string; usage: RoomUsage }
  /** To the person's own Mirador: whether the room let the agent in, and under which id. */
  | { type: "room.agent-brought"; requestId: string; personId: string; roomId: string; agentId: string | null; problem: HostProblem | null }
  /** To the person's own Mirador alone: a task for the agent they brought, as one of the room's own agents would be sent it, and who wrote it in what role. */
  | { type: "room.brought-task"; personId: string; roomId: string; agentId: string; taskId: string; text: string; byName: string; byRole: RoomAuthorRole; fromYou: boolean }
  /** To the person's own Mirador alone: the confirmed answer to a question an agent they brought asked on the room's canvas. */
  | { type: "room.brought-ask-answered"; personId: string; roomId: string; agentId: string; itemId: string; answer: BroughtAskAnswer }
  /** The agents this computer's owner brought into rooms of other machines, and the tasks of others that wait for their OK, each time either changes. */
  | { type: "brought-agents.listed"; agents: BroughtAgentHere[]; tasks: BroughtTaskWaiting[] }
  | { type: "machine.agent-brought"; requestId: string; problem: string | null; problemAbout?: HostProblem }
  | {
      type: "conversation.history";
      conversationId: string;
      events: StoredEvent[];
      canvas: CanvasItem[];
      /**
       * For a low-data subscriber that held events up to this one: these continue them rather than replace them, and the
       * canvas items, only those changed since the newest change it held, update its own.
       */
      continuesAfter?: number;
      /** The conversation has turns before these events. */
      hasEarlier?: boolean;
    }
  /** The events right before `beforeSeq`. */
  | { type: "conversation.earlier"; requestId: string; conversationId: string; beforeSeq: number; events: StoredEvent[]; hasEarlier: boolean }
  | { type: "tool-output.got"; requestId: string; content: ToolCallContent[] }
  | { type: "conversation.found"; requestId: string; conversationId: string; entries: EntryMatchCount[] }
  | { type: "tool-raw-output.got"; requestId: string; rawOutput: unknown }
  | { type: "async-task.output.got"; requestId: string; text: string | null }
  | { type: "conversation.event"; conversationId: string; event: StoredEvent }
  /** `cannotUndo` says why a turn cannot be undone, when it cannot; `plan` is absent then too. */
  | { type: "conversation.revert-previewed"; requestId: string; plan: RestorePlan | null; files?: RestoreFiles; cannotUndo?: string; cannotUndoAbout?: HostProblem }
  | { type: "conversation.reverted"; requestId: string; plan: RestorePlan }
  | { type: "conversation.revert-failed"; requestId: string; message: string; problem?: HostProblem }
  /**
   * `turnsLeaving` and `keptFrom` say what the conversation loses: how many turns, and the turn it goes back to (null
   * keptFrom: all of them). `cannotRewind` says why it cannot go back at all, `filesNote` why the files stay as they are.
   */
  | {
      type: "conversation.rewind-previewed";
      requestId: string;
      turnsLeaving: number;
      keptFrom: string | null;
      plan: RestorePlan | null;
      files?: RestoreFiles;
      cannotRewind?: string;
      cannotRewindAbout?: HostProblem;
      filesNote?: string;
      filesNoteAbout?: HostProblem;
    }
  /** The rewind this page asked for is done: the events from `fromSeq` on are gone. */
  | { type: "conversation.rewind-done"; requestId: string; conversationId: string; fromSeq: number }
  /** The conversation was taken back to before `fromSeq`, which every page showing it drops its events from. */
  | { type: "conversation.rewound"; conversationId: string; fromSeq: number }
  | { type: "conversation.rewind-failed"; requestId: string; message: string; problem?: HostProblem }
  | { type: "canvas.upserted"; item: CanvasItem }
  | { type: "canvas.exported"; requestId: string; html: string }
  | { type: "canvas.saved-to-project"; requestId: string; path: string }
  /** `alreadyThere` when the path names a file that is there already, which the user may choose to replace. */
  | { type: "canvas.export-failed"; requestId: string; message: string; problem?: HostProblem; alreadyThere: boolean }
  /** `createsDirectory`: nothing is at the typed path yet and its parent is a folder, so adding it makes that folder. */
  | { type: "fs.completions"; requestId: string; directories: string[]; createsDirectory: boolean }
  | { type: "statusline.rendered"; requestId: string; statusline: StatuslineRender }
  | { type: "subagent-usage.got"; requestId: string; usage: Record<string, SubagentUsage> }
  | { type: "sessions.listed"; requestId: string; sessions: ExternalSession[] }
  | { type: "sessions.searched"; requestId: string; sessions: SessionSearchHit[] }
  | { type: "sessions.failed"; requestId: string; message: string; problem?: HostProblem }
  | { type: "slash-commands.listed"; requestId: string; commands: SlashCommand[] }
  | { type: "conversation.fork-checked"; requestId: string; forkable: boolean }
  | { type: "conversation.side-chat.started"; requestId: string; sideChatId: string }
  | { type: "prompt-history.listed"; requestId: string; prompts: string[]; ownEarlier?: PromptHistoryEntry[] }
  | { type: "mentions.suggested"; requestId: string; suggestions: MentionSuggestion[] }
  | { type: "changes.listed"; requestId: string; list: ChangeList }
  | { type: "changes.diffed"; requestId: string; changes: FileChanges }
  | { type: "changes.files-listed"; requestId: string; files: ProjectFiles }
  | { type: "changes.committable-listed"; requestId: string; committable: Committable }
  | { type: "changes.committed"; requestId: string; commit: MadeCommit }
  | { type: "changes.landable-listed"; requestId: string; landable: Landable | null }
  | { type: "changes.landed"; requestId: string; landed: Landed }
  | { type: "changes.failed"; requestId: string; message: string; problem?: HostProblem }
  | { type: "terminals.listed"; conversationId: string; tabs: TerminalTab[] }
  | { type: "terminal.opened"; requestId: string; tabId: string; terminalId: string }
  | { type: "terminal.replayed"; terminalId: string; data: string }
  | { type: "terminal.output"; terminalId: string; data: string }
  | { type: "terminal.exited"; terminalId: string; exitCode: number }
  /** The terminal was left open: `command` runs in it. With `tabId`, closing that whole tab was asked. */
  | { type: "terminal.busy"; terminalId: string; command: string; tabId?: string }
  | { type: "terminal.cleared"; terminalId: string }
  | { type: "system-notification"; notification: SystemNotification }
  /** Sent to the desktop app's notification socket, on connecting and whenever the conversations waiting for you may have changed. */
  | ({ type: "waiting.counted" } & WaitingSummary)
  /** Sent to the desktop app's notification socket, on connecting and whenever the number of running turns changes. */
  | { type: "running-turns.counted"; count: number }
  | { type: "host.code-changed" }
  | { type: "desktop-app.outdated"; outdated: boolean }
  /** To pages, and to this machine's desktop app: also on connecting, while there is a newer version. */
  | { type: "newer-version.found"; newerVersion: NewerVersion | null }
  /** Why the check asked for failed, or null when it didn't. */
  | { type: "newer-version.checked"; requestId: string; failure: string | null; failureAbout?: HostProblem }
  /** Why the pull asked for failed, or null when it didn't. */
  | { type: "newer-version.pulled"; requestId: string; failure: string | null }
  /** To pages, whenever what the host found by itself of the plugins' new commits changes. */
  | { type: "plugin-updates.found"; pluginUpdates: PluginUpdate[] }
  /** The host is stopping to start again in place; pages reload once they reconnect. */
  | { type: "host.restarting" }
  | { type: "error"; message: string; problem?: HostProblem }
  | { type: "pong" }
  /** A file link leads to a file outside the workspace that the agent did not change: the page asks before it opens `file`, the real file. */
  | { type: "files.ask-to-open"; conversationId: string; file: string }
  | { type: "conversation.delete-asks"; conversationId: string; uncommittedFiles: number; branches: string[] }
  /** Deleting the conversations together would delete the uncommitted files of their worktrees, each counted once, so they stay until the page sends `discardsUncommitted`. */
  | { type: "conversations.delete-asks"; conversationIds: string[]; uncommittedFiles: number; branches: string[] }
  /** Removing the workspace would delete the uncommitted files of its conversations' worktrees, so it stays until the page sends `discardsUncommitted`. */
  | { type: "workspace.delete-asks"; workspaceId: string; uncommittedFiles: number }
  /** thisDeviceId is the device the receiving page signed in as; null when it signed in with the host's own link. */
  /** peerToPeer is null when this host doesn't connect peer to peer. */
  | { type: "devices.listed"; devices: ListedDevice[]; thisDeviceId: string | null; reachability: ReachabilitySettings; peerToPeer: PeerToPeerStatus | null; roomInvitesConnect: RoomInviteConnect }
  /** `folder` is where plugins are installed; `restartNeeded` once a plugin was added, updated or removed since Mirador started. */
  /** `official` is the catalog of official plugins; missing from a host older than it. */
  | { type: "plugins.listed"; folder: string; plugins: PluginInfo[]; official?: CatalogPlugin[]; restartNeeded: boolean }
  /** Where the views are served now, after an installed plugin's view was built again. */
  | { type: "plugins.views"; installedApps: InstalledApp[]; canvasViews: Record<string, string> }
  /** Every plugin's settings, whenever the user chooses one. */
  | { type: "plugins.settings"; pluginSettings: PluginSettings[] }
  /** The answer to plugins.install, plugins.remove and plugins.undo-update. */
  | { type: "plugins.changed"; requestId: string; problem: string | null; problemAbout?: HostProblem }
  | { type: "plugins.offered"; requestId: string; offer: PluginOffer | null; problem: string | null; problemAbout?: HostProblem }
  /** The plugin's reply to an item's action, or why there is none. */
  | { type: "canvas.item-acted"; requestId: string; reply: unknown; problem: string | null; problemAbout?: HostProblem }
  | { type: "app.file-opened"; requestId: string; problem: string | null; problemAbout?: HostProblem }
  /** What the command's tool said, or why it failed. */
  | { type: "canvas.command-ran"; requestId: string; reply: string | null; problem: string | null; problemAbout?: HostProblem }
  /** A plugin window's state, or why there is none, such as a plugin with no window. */
  | { type: "plugin-window.state"; plugin: string; state: unknown; problem: string | null }
  | { type: "plugin-window.acted"; requestId: string; reply: unknown; problem: string | null }
  /**
   * A plugin's tab in a workspace: whether the workspace gets it, and its state, or why there is none. `seq` grows with
   * each time the host asks for a state, across restarts too, so a page keeps the newest asked for, whichever answers last.
   */
  | { type: "plugin-tab.state"; plugin: string; workspaceId: string; seq: number; shown: boolean; state: unknown; problem: string | null }
  | { type: "plugin-tab.acted"; requestId: string; reply: unknown; problem: string | null }
  /** What updating the plugin would bring: a newer release and its commits, or the commits on its branch it lacks, newest first. */
  | { type: "plugins.commits-found"; requestId: string; release: string | null; commits: PluginCommit[]; problem: string | null; problemAbout?: HostProblem }
  | { type: "devices.invited"; requestId: string; code: string; expiresAt: number; tunnel: InviteTunnel | null }
  /** The addresses that answered as this Mirador, and whether this machine has Tailscale to put its ports on the tailnet. */
  | { type: "address.found"; requestId: string; addresses: FoundAddress[]; tailscale: "absent" | "present"; problem: string | null; problemAbout?: HostProblem }
  | { type: "machines.changed"; machines: Machine[] }
  | { type: "machines.hidden"; machines: MachineSeen[] }
  | { type: "machine.status"; status: MachineStatus }
  /** The machine has the request; it waits there until someone types the number this host shows. */
  | { type: "machine.join-asked"; requestId: string; number: string }
  /** roomId: the room a room invite let this computer's owner into, or, `waiting`, where they wait for its owner to let them in. */
  | { type: "machine.join-answered"; requestId: string; roomId: string | null; waiting: boolean; problem: string | null; problemAbout?: HostProblem }
  /**
   * machineId is null when nothing was added; roomId, the room a room invite's link let this computer's owner into, or,
   * `waiting`, where they wait for its owner to let them in. A problem joining leaves the machine added, unless the link
   * carried the machine's tunnel: then nothing stays added.
   */
  | { type: "machine.added"; requestId: string; machineId: string | null; roomId: string | null; waiting: boolean; problem: string | null; problemAbout?: HostProblem }
  | { type: "join-requests.listed"; joinRequests: JoinRequest[] }
  /** problem says why it was not approved, e.g. a wrong number, which denies it. */
  | { type: "join-request.answered"; requestId: string; problem: string | null; problemAbout?: HostProblem }
  | { type: "settings.saved"; requestId: string; problem: string | null; problemAbout?: HostProblem }
  | { type: "settings.exported"; requestId: string; text: string | null; problem: string | null; problemAbout?: HostProblem }
  | { type: "settings.export-saved"; requestId: string; path: string | null; problem: string | null; problemAbout?: HostProblem; alreadyThere?: boolean }
  | { type: "settings.import-planned"; requestId: string; plan: SettingsPlan | null; problem: string | null; problemAbout?: HostProblem }
  | { type: "settings.imported"; requestId: string; report: SettingsImportReport | null; problem: string | null; problemAbout?: HostProblem }
  /** The conversation with the newest hit first. */
  | { type: "search.results"; requestId: string; conversations: ConversationMatches[] };

/**
 * Where peer to peer stands: not needed yet, starting, found through the broker, or unable to be, because the broker
 * doesn't answer (a firewall, or no network) or the sidecar couldn't be downloaded.
 */
export type PeerToPeerStatus = "waiting" | "connecting" | "ready" | "broker-unreachable" | "sidecar-unavailable";
