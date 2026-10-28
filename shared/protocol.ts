import type { ToolCallContent } from "@agentclientprotocol/sdk";
import type {
  AdoptMode,
  AskAnswerEntry,
  AskMode,
  CanvasItem,
  CanvasUse,
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
  MachineStatus,
  Launch,
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
} from "./model.ts";
import type { ChangeList, ChangeScope, FileChanges, ProjectFiles } from "./changes.ts";
import type { PageLibraries } from "./canvas-export.ts";
import type { AppDocumentState, AppStorageItems, CatalogPlugin, InstalledApp, OpenApp, PluginCommit, PluginInfo, PluginSettings, PluginUpdate } from "./apps.ts";
import type { LowDataSubscription } from "./low-data.ts";
import type { MentionSuggestion } from "./mentions.ts";
import type { NewerVersion } from "./newer-version.ts";
import type { PromptHistoryEntry } from "./prompt-history.ts";
import type { SlashCommand } from "./slash-commands.ts";
import type { WaitingSummary } from "./waiting.ts";
import type { SplitAxis } from "./terminal-layout.ts";
import type { SystemNotification } from "./system-notifications.ts";
import type { SubagentUsage } from "./subagent-usage.ts";
import type { VoiceSettings } from "./voice.ts";
import type { VoiceEngineStatus } from "./voice-engine.ts";

export interface TerminalSplit {
  terminalId: string;
  axis: SplitAxis;
}

/** The cookie a signed-in page carries; the desktop app sends it too when it listens for system notifications. */
export const TOKEN_COOKIE = "mirador_token";
/**
 * Sent by the relay that shows a machine in the rail: the machine's pages there load canvas libraries from this
 * computer's own copy, as this computer's browser may not trust the machine's certificate.
 */
export const CANVAS_ASSETS_ORIGIN_HEADER = "mirador-canvas-assets-origin";
/**
 * Mirador's own pages edit profiles, so they open /ws with this query parameter to get what each profile launches its
 * agent with: the environment and prelaunch command, which often hold API keys. Other clients, such as the phone app,
 * never show them and never get them.
 */
export const PROFILE_LAUNCH_PARAMETER = "profile-launch";

/** A desktop app built from a checkout opens /notifications with this query parameter naming the code it was built from. */
export const DESKTOP_APP_CODE_PARAMETER = "desktop-app-code";

export type ProfileDraft = Pick<Profile, "name" | "harness" | "environment" | "prelaunch" | "mode" | "effort" | "bypassPermissions" | "askMode" | "color" | "pluginSettings"> & { id?: string };

export type ClientMessage =
  /** Its conversations start on the profile; null only while there is no profile yet. */
  | { type: "workspace.create"; path: string; profileId: string | null }
  | { type: "workspace.delete"; workspaceId: string }
  | { type: "workspace.set-default-launch"; workspaceId: string; launch: Launch }
  /**
   * Puts the workspace just before another of the group in the sidebar, or last in it; with a null group, among the
   * groups and the workspaces in none, where it can land before a group too. Without a group it keeps its own, as the
   * phone app, which shows no groups, moves it.
   */
  | { type: "workspace.move"; workspaceId: string; groupId?: string | null; beforeWorkspaceId: string | null; beforeGroupId?: string | null }
  | { type: "workspace.set-color"; workspaceId: string; color: Pastel | null }
  | { type: "workspace-group.create"; name: string }
  | { type: "workspace-group.rename"; groupId: string; name: string }
  /** Puts the group just before another, or before a workspace in no group, in the sidebar; or last. */
  | { type: "workspace-group.move"; groupId: string; beforeGroupId: string | null; beforeWorkspaceId?: string | null }
  /** Its workspaces stay where it was in the sidebar, in no group. */
  | { type: "workspace-group.delete"; groupId: string }
  | { type: "profile.save"; requestId: string; profile: ProfileDraft }
  | { type: "profile.delete"; profileId: string }
  /** Creates the template, or changes the one with this id. */
  | { type: "prompt-template.save"; template: Pick<PromptTemplate, "id" | "name" | "text"> }
  | { type: "prompt-template.delete"; templateId: string }
  | { type: "settings.set-canvas-use"; canvasUse: CanvasUse }
  | { type: "settings.set-claude-program"; path: string }
  /** Looks for a newer Mirador now; what it finds comes as newer-version.found, before the answer. */
  | { type: "newer-version.check"; requestId: string }
  /** Empty for the system's text editor. */
  | { type: "settings.set-script-program"; program: string }
  /** The user's picture as a small square PNG data URL the page drew; null takes it away, leaving the person icon. */
  | { type: "settings.set-avatar"; image: string | null }
  /** Without a launch, the conversation starts on the workspace's default as the host has it when the message arrives. */
  | { type: "conversation.create"; workspaceId: string; launch?: Launch }
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
      session: Pick<ExternalSession, "sessionId" | "title">;
      mode: AdoptMode;
    }
  | { type: "conversation.delete"; conversationId: string }
  | { type: "conversation.rename"; conversationId: string; title: string }
  | { type: "conversation.set-unread"; conversationId: string; unread: boolean }
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
  | { type: "conversation.queue.edit"; conversationId: string; messageId: string; text: string }
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
  /** The last part of the file a background task writes its output to; null when none is there to read. */
  | { type: "async-task.output.get"; requestId: string; conversationId: string; asyncTaskId: string }
  | { type: "conversation.set-ask-mode"; conversationId: string; askMode: AskMode }
  /** Null follows the profile again. */
  | { type: "conversation.set-plugin-setting"; conversationId: string; plugin: string; setting: string; value: string | null }
  | { type: "conversation.set-bypass-permissions"; conversationId: string; bypassPermissions: boolean }
  | { type: "conversation.set-config"; conversationId: string; configId: string; value: string | boolean }
  | { type: "permission.respond"; conversationId: string; permissionId: string; optionId: string | null }
  | { type: "ask.answer"; itemId: string; label: string; note?: string; answers?: AskAnswerEntry[] }
  | { type: "canvas.report"; itemId: string; errors: string[] }
  /** The page shows this app's document, and gets its state on every change until it unsubscribes. */
  | { type: "app.subscribe"; workspaceId: string; app: string }
  | { type: "app.unsubscribe"; workspaceId: string; app: string }
  /** An operation the user made in the app's view. */
  | { type: "app.apply"; workspaceId: string; app: string; op: unknown }
  /** Shows an app open in the conversation's workspace in its canvas too. */
  | { type: "app.use-in"; workspaceId: string; app: string; conversationId: string }
  /** The app's view set an item of its storage in the workspace; a null value removes it. */
  | { type: "app.storage-set"; workspaceId: string; app: string; key: string; value: string | null }
  /** The user runs one of the app's tasks from its view; its progress and end come in the app's state. */
  | { type: "app.run"; workspaceId: string; app: string; task: string }
  /** The user stops the app's task under way. */
  | { type: "app.stop-task"; workspaceId: string; app: string }
  /** What the user did in a plugin item's view, for the plugin's host code; answered with "canvas.item-acted". */
  | { type: "canvas.item-action"; requestId: string; itemId: string; action: unknown }
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
  | { type: "presence"; conversationId: string | null; attentive: boolean }
  | { type: "host.restart" }
  | { type: "devices.list" }
  | { type: "plugins.list" }
  /** The user's choice for one of a plugin's settings. */
  | { type: "plugins.choose-setting"; plugin: string; setting: string; value: string }
  /** `url` is anything git clones, a local path too; without a branch, the repo's default one. */
  | { type: "plugins.add"; requestId: string; url: string; branch: string | null }
  | { type: "plugins.find-commits"; requestId: string; folder: string }
  | { type: "plugins.update"; requestId: string; folder: string }
  | { type: "plugins.remove"; requestId: string; folder: string }
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
  /** address is what the user typed or pasted: a name on the network, an address, or an invite link. */
  | { type: "machine.add"; name: string; address: string }
  | { type: "machine.remove"; machineId: string }
  | { type: "machine.set-color"; machineId: string; color: Pastel | null }
  | { type: "machine.join"; requestId: string; machineId: string; code: string; authorityFingerprint: string | null }
  | { type: "machine.ask-to-join"; requestId: string; machineId: string }
  | { type: "search"; requestId: string; query: string };

export type ServerMessage =
  | {
      type: "snapshot";
      workspaces: Workspace[];
      workspaceGroups: WorkspaceGroup[];
      conversations: Conversation[];
      profiles: Profile[];
      promptTemplates: PromptTemplate[];
      canvasUse: CanvasUse;
      claudeProgram: ClaudeProgram;
      /** The program the host opens scripts in, as text; empty for the system's text editor. */
      scriptProgram: string;
      /** The user's profile picture as a small square PNG data URL; null when they set none. */
      avatar: string | null;
      /** The agents this machine has a program for, which a new profile can run. */
      installedAgents: HarnessId[];
      /** Where this page loads canvas libraries from: the address it reached the host at may differ from the one agents were given. */
      canvasAssetsOrigin: string;
      agentsCanvasAssetsOrigin: string;
      machines: Machine[];
      machineStatuses: MachineStatus[];
      homeDir: string;
      /** Fresh for each start of the host process. */
      hostRunId: string;
      /** Mirador's own host source was edited since this host started. */
      hostCodeChanged: boolean;
      /** A desktop app listening to this host was built from other code than the host's checkout has now. */
      desktopAppOutdated: boolean;
      /** The version of Mirador this host is. */
      version: string;
      newerVersion: NewerVersion | null;
      /** Plugins from git repos with new commits, as the host found by itself. */
      pluginUpdates?: PluginUpdate[];
      installedApps: InstalledApp[];
      openApps: OpenApp[];
      /** Where the canvas assets serve each plugin's canvas view, by plugin name. */
      canvasViews: Record<string, string>;
      /** Each plugin's tools by their name on the canvas server, with the plugin's title; missing from an older host. */
      pluginToolTitles?: Record<string, string>;
      /** Missing from a host older than plugin settings. */
      pluginSettings?: PluginSettings[];
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
  | { type: "prompt-template.upserted"; template: PromptTemplate }
  | { type: "prompt-template.deleted"; templateId: string }
  | { type: "settings.canvas-use"; canvasUse: CanvasUse }
  | { type: "settings.claude-program"; claudeProgram: ClaudeProgram }
  | { type: "settings.script-program"; scriptProgram: string }
  /** The user's picture next to every page; null when they set none, leaving the person icon. */
  | { type: "settings.avatar"; image: string | null }
  /** Sent after the snapshot and on every change; API keys are empty for clients that don't get profile environments. */
  | { type: "voice.settings"; settings: VoiceSettings }
  /** Sent after the snapshot, on every change and, while setting up, on its progress. */
  | { type: "voice.engine"; engine: VoiceEngineStatus }
  | { type: "workspace.upserted"; workspace: Workspace }
  | { type: "workspace.deleted"; workspaceId: string }
  | { type: "workspace-group.upserted"; group: WorkspaceGroup }
  | { type: "workspace-group.deleted"; groupId: string }
  | { type: "conversation.upserted"; conversation: Conversation }
  | { type: "conversation.deleted"; conversationId: string }
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
  | { type: "conversation.revert-previewed"; requestId: string; plan: RestorePlan | null; files?: RestoreFiles; cannotUndo?: string }
  | { type: "conversation.reverted"; requestId: string; plan: RestorePlan }
  | { type: "conversation.revert-failed"; requestId: string; message: string }
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
      filesNote?: string;
    }
  /** The rewind this page asked for is done: the events from `fromSeq` on are gone. */
  | { type: "conversation.rewind-done"; requestId: string; conversationId: string; fromSeq: number }
  /** The conversation was taken back to before `fromSeq`, which every page showing it drops its events from. */
  | { type: "conversation.rewound"; conversationId: string; fromSeq: number }
  | { type: "conversation.rewind-failed"; requestId: string; message: string }
  | { type: "canvas.upserted"; item: CanvasItem }
  | { type: "canvas.exported"; requestId: string; html: string }
  | { type: "canvas.saved-to-project"; requestId: string; path: string }
  /** `alreadyThere` when the path names a file that is there already, which the user may choose to replace. */
  | { type: "canvas.export-failed"; requestId: string; message: string; alreadyThere: boolean }
  /** `createsDirectory`: nothing is at the typed path yet and its parent is a folder, so adding it makes that folder. */
  | { type: "fs.completions"; requestId: string; directories: string[]; createsDirectory: boolean }
  | { type: "statusline.rendered"; requestId: string; statusline: StatuslineRender }
  | { type: "subagent-usage.got"; requestId: string; usage: Record<string, SubagentUsage> }
  | { type: "sessions.listed"; requestId: string; sessions: ExternalSession[] }
  | { type: "sessions.searched"; requestId: string; sessions: SessionSearchHit[] }
  | { type: "sessions.failed"; requestId: string; message: string }
  | { type: "slash-commands.listed"; requestId: string; commands: SlashCommand[] }
  | { type: "prompt-history.listed"; requestId: string; prompts: string[]; ownEarlier?: PromptHistoryEntry[] }
  | { type: "mentions.suggested"; requestId: string; suggestions: MentionSuggestion[] }
  | { type: "changes.listed"; requestId: string; list: ChangeList }
  | { type: "changes.diffed"; requestId: string; changes: FileChanges }
  | { type: "changes.files-listed"; requestId: string; files: ProjectFiles }
  | { type: "changes.failed"; requestId: string; message: string }
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
  | { type: "newer-version.checked"; requestId: string; failure: string | null }
  /** To pages, whenever what the host found by itself of the plugins' new commits changes. */
  | { type: "plugin-updates.found"; pluginUpdates: PluginUpdate[] }
  /** The host is stopping to start again in place; pages reload once they reconnect. */
  | { type: "host.restarting" }
  | { type: "error"; message: string }
  /** A file link leads to a file outside the workspace that the agent did not change: the page asks before it opens `file`, the real file. */
  | { type: "files.ask-to-open"; conversationId: string; file: string }
  /** thisDeviceId is the device the receiving page signed in as; null when it signed in with the host's own link. */
  | { type: "devices.listed"; devices: ListedDevice[]; thisDeviceId: string | null; reachability: ReachabilitySettings }
  /** `folder` is where plugins are installed; `restartNeeded` once a plugin was added, updated or removed since Mirador started. */
  /** `official` is the catalog of official plugins; missing from a host older than it. */
  | { type: "plugins.listed"; folder: string; plugins: PluginInfo[]; official?: CatalogPlugin[]; restartNeeded: boolean }
  /** Where the views are served now, after an installed plugin's view was built again. */
  | { type: "plugins.views"; installedApps: InstalledApp[]; canvasViews: Record<string, string> }
  /** Every plugin's settings, whenever the user chooses one. */
  | { type: "plugins.settings"; pluginSettings: PluginSettings[] }
  /** The answer to plugins.add, plugins.update and plugins.remove. */
  | { type: "plugins.changed"; requestId: string; problem: string | null }
  /** The plugin's reply to an item's action, or why there is none. */
  | { type: "canvas.item-acted"; requestId: string; reply: unknown; problem: string | null }
  /** What updating the plugin would bring: a newer release and its commits, or the commits on its branch it lacks, newest first. */
  | { type: "plugins.commits-found"; requestId: string; release: string | null; commits: PluginCommit[]; problem: string | null }
  | { type: "devices.invited"; requestId: string; code: string; expiresAt: number }
  /** The addresses that answered as this Mirador, and whether this machine has Tailscale to put its ports on the tailnet. */
  | { type: "address.found"; requestId: string; addresses: FoundAddress[]; tailscale: "absent" | "present"; problem: string | null }
  | { type: "machines.changed"; machines: Machine[] }
  | { type: "machine.status"; status: MachineStatus }
  /** The machine has the request; it waits there until someone types the number this host shows. */
  | { type: "machine.join-asked"; requestId: string; number: string }
  | { type: "machine.join-answered"; requestId: string; problem: string | null }
  | { type: "join-requests.listed"; joinRequests: JoinRequest[] }
  /** problem says why it was not approved, e.g. a wrong number, which denies it. */
  | { type: "join-request.answered"; requestId: string; problem: string | null }
  | { type: "settings.saved"; requestId: string; problem: string | null }
  /** The conversation with the newest hit first. */
  | { type: "search.results"; requestId: string; conversations: ConversationMatches[] };
