import type { PluginCanvasItem } from "./model.ts";

/**
 * Where a plugin's item shows: among the canvas's pages, or in the tab beside the canvas that holds the agent's plan,
 * above the plan, where the newest one the user hasn't dismissed is the one shown.
 */
export type PluginItemPlacement = "page" | "tab";

export const pluginItemPlacements: PluginItemPlacement[] = ["page", "tab"];

/** Where an item that opens with room goes: the canvas pane full screen, over the chat, or beside it. */
export type ItemRoom = "fullscreen" | "beside";

export const itemRooms: ItemRoom[] = ["fullscreen", "beside"];

/** A kind of item a plugin's canvas view draws. */
export interface PluginItemType<Data = unknown> {
  /** A character or two, for the canvas's list of pages and its header. */
  icon: string;
  placement: PluginItemPlacement;
  /** An item in the tab: how far along it is in a few characters, e.g. "3/5", for the tab's toggle. */
  count?(data: Data): string;
  /** What came of the item in a few words, such as a review's verdict, shown beside its title in the canvas's bar and list. */
  outcome?(data: Data): string | undefined;
  /**
   * A new item takes room and shows the canvas if it was hidden: full screen, or with `setting`, where that setting of
   * the plugin's says, whose choices are the rooms, "fullscreen" and "beside" the chat.
   */
  opensWithRoom?: boolean | { setting: string };
  /**
   * The item's data as the canvas lists it, e.g. without a run of the plugin's that Mirador's restart cut short, which
   * the plugin's host code would otherwise still show as running.
   */
  listed?(item: PluginItem<Data>): Data;
}

/** An item a plugin published in a conversation's canvas, as its host code sees it. */
export interface PluginItem<Data = unknown> {
  id: string;
  type: string;
  title: string;
  data: Data;
  createdAt: number;
  /** The user took it out of the tab. */
  dismissed: boolean;
  /** When the agent last changed it in place, from a tool; null until it does. */
  agentEditedAt: number | null;
}

/** A plugin's item as its host code and its view see it, without what only Mirador keeps. */
export const pluginItemOf = (item: PluginCanvasItem): PluginItem => ({
  id: item.id,
  type: item.type,
  title: item.title,
  data: item.data,
  createdAt: item.createdAt,
  dismissed: item.dismissed ?? false,
  agentEditedAt: item.agentEditedAt ?? null,
});

/** The conversation a plugin's code runs for, and its items in the canvas there. */
export interface CanvasPluginContext<Data = unknown> {
  conversationId: string;
  /** The workspace the conversation works in: its id, name and project folder (not a worktree's). Plugin API 14 brought it. */
  workspace: PluginWorkspace;
  /** The plugin's items in the conversation, oldest first. */
  items(): PluginItem<Data>[];
  /** Changes one of them in place. Made while a tool runs for the agent, it is the agent's change, and the tab's toggle flashes for it. */
  change(itemId: string, change: { title?: string; data?: Data }): PluginItem<Data>;
  /** What the plugin keeps across conversations and restarts, such as how its views were laid out; values are JSON. */
  storage: CanvasPluginStorage;
  /**
   * What the conversation chose for one of the plugin's profile settings in its header, else what its profile set, else
   * the default; for a setting whose choices are the profiles, that profile's name. Null for none, or for a profile since deleted.
   */
  profileSetting(id: string): string | null;
  /** Mirador's profiles, for the plugin to offer a choice of them, as a form it shows might. Plugin API 13 brought it. */
  profiles(): PluginProfile[];
  /**
   * The tokens and cost of a conversation this plugin's tool or action started from this conversation, so far. Throws
   * for a conversation this plugin didn't start from this one. Plugin API 14 brought it.
   */
  usageOf(conversationId: string): ConversationUsage;
}

export interface CanvasPluginStorage {
  get(key: string): unknown;
  /** Undefined takes the key out. */
  set(key: string, value: unknown): void;
}

export interface CanvasActionContext<Data = unknown> extends CanvasPluginContext<Data> {
  /** Sends the agent a message, as if the user wrote it; `afterTurn` keeps it queued until the agent's turn ends. */
  prompt(text: string, options?: { afterTurn?: boolean }): Promise<void>;
  /**
   * Opens a file, by its absolute path, at a line in the editor Settings name, on the host's computer. The plugin decides
   * which files its view may open. Throws, saying what would work, when the editor is not found.
   */
  openInEditor(file: string, line: number): void;
  /**
   * Stops the turn of a conversation this plugin's tool or action started from this conversation, as the user's Stop
   * would; its `replied` then hears it end as "stopped", and no job it left running wakes it any more. Resolves doing
   * nothing for one whose work already ended or that no longer exists. Throws for a conversation this plugin didn't start
   * from this one. Plugin API 10 brought it.
   */
  stopConversation(conversationId: string): Promise<void>;
  /**
   * Deletes a conversation this plugin's tool or action started from this conversation, as the user's delete does:
   * its turn stops, and its worktree goes once no other conversation works there, uncommitted work and all, with its
   * branch even when that holds commits the workspace's branch lacks; keep what you need of the work first. Resolves
   * doing nothing for one already gone. Throws for a conversation this plugin didn't start from this one. Plugin API 16
   * brought it.
   */
  deleteStarted(conversationId: string): Promise<void>;
  /**
   * As a tool's `startConversation`, for what the user does in the item's view, such as a form that starts the work. The
   * plugin's `replied` hears when that conversation ends its work. Plugin API 13 brought it.
   */
  startConversation(start: ConversationStart): Promise<StartedConversation>;
  /**
   * Sends a conversation this plugin's tool or action started from this conversation a message, shown as the plugin's:
   * it starts that conversation's next turn, or waits for the turn it is in to end. `replied` heard its work end
   * already, so the plugin hears this turn end through `activity`, as "turn-ended". Throws for a conversation this
   * plugin didn't start from this one. Plugin API 14 brought it.
   */
  promptStarted(conversationId: string, text: string): Promise<void>;
}

export interface CanvasToolContext<Data = unknown> extends CanvasPluginContext<Data> {
  /** Who called the tool: the agent, or the user from the slash menu, for a tool with a `command`. */
  caller: ToolCaller;
  /** Shows a new item, of one of the plugin's types, in the canvas. */
  publish(item: { type: string; title: string; data: Data }): PluginItem<Data>;
  /** Sends the agent a message, as if the user wrote it; `afterTurn` keeps it queued until the agent's turn ends. */
  prompt(text: string, options?: { afterTurn?: boolean }): Promise<void>;
  /**
   * Starts a conversation in this one's workspace on the profile of that name, with `prompt` as its first message, and
   * bypassing permissions if this one does; it shows above this one's composer and under it in the sidebar, and the
   * plugin's `replied` hears when it ends its work. Throws, naming the profiles there are, when none has that name, and
   * when a plugin's tool started this conversation, which keeps to one level of them.
   */
  startConversation(start: ConversationStart): Promise<StartedConversation>;
  /**
   * Stops the turn of a conversation this plugin's tool or action started from this conversation, as the user's Stop
   * would; its `replied` then hears it end as "stopped", and no job it left running wakes it any more. Resolves doing
   * nothing for one whose work already ended or that no longer exists. Throws for a conversation this plugin didn't start
   * from this one. Plugin API 10 brought it.
   */
  stopConversation(conversationId: string): Promise<void>;
  /**
   * Deletes a conversation this plugin's tool or action started from this conversation, as the user's delete does:
   * its turn stops, and its worktree goes once no other conversation works there, uncommitted work and all, with its
   * branch even when that holds commits the workspace's branch lacks; keep what you need of the work first. Resolves
   * doing nothing for one already gone. Throws for a conversation this plugin didn't start from this one. Plugin API 16
   * brought it.
   */
  deleteStarted(conversationId: string): Promise<void>;
}

/** A conversation a plugin's tool or action starts from the conversation it runs for. */
export interface ConversationStart extends ConversationChoices {
  profile: string;
  prompt: string;
  /**
   * The conversation's title, its first line cut to 60 characters, kept as one the user typed is: neither the first
   * message nor the agent renames it, while the user still can. Without one, or with a blank one, the first line of
   * `prompt` titles it, and the agent may rename it later. Plugin API 8 brought it.
   */
  title?: string;
  /**
   * "own": it works in a new git worktree of its own, on a new branch from what the workspace has checked out, rather
   * than where this conversation works; its first message waits until the worktree is made, one that can't be made
   * ends its work as failed, and one stopped meanwhile ends as stopped without starting. Throws when the workspace's
   * folder isn't in a git repository with a commit. Plugin API 12 brought it. `{ from }` works as "own", but the new
   * branch starts at that commit of the workspace's repository (a commit hash, branch or tag) rather than at what the
   * workspace has checked out. It throws, naming the commit, when the repository has no such commit. Plugin API 14
   * brought it.
   */
  worktree?: "own" | { from: string };
}

/**
 * What a plugin chooses for a conversation it starts, over its profile's choices. The model goes first, so the profile's
 * effort, and then `effort`, apply to the model chosen. Its first message waits until the agent has taken them, for up
 * to two minutes; an agent that hasn't answered by then shows the user so in that conversation. One the agent doesn't
 * offer leaves the agent's own and shows the user why there too, rather than throw: what an agent offers is known only
 * once its session has started. Plugin API 8 brought them.
 */
export interface ConversationChoices {
  /** A model, by id or name, matched to the agent's models as Mirador matches them, e.g. "opus"; skipped on an agent that offers none. */
  model?: string;
  /** An effort the conversation's model offers, e.g. "high"; skipped on a model that has no effort, such as Claude's Haiku. */
  effort?: string;
}

export interface StartedConversation {
  id: string;
  /** The profile's name as Mirador has it. */
  profile: string;
  /** The git worktree it works in, when it works in one: its folder, absolute, and its branch. Plugin API 12 brought it. */
  worktree?: { folder: string; branch: string };
}

/**
 * The model a conversation ran on, by its id and the name Mirador shows for it, and its effort as the agent has it,
 * null when the model has none.
 */
export interface RanOn {
  model: { id: string; name: string };
  effort: string | null;
}

/**
 * The agent's last message in the turn, null when it said nothing in words; `ended` says how the turn ended. `ranOn`,
 * which plugin API 8 brought, is what the conversation ran on: the model that answered last, where the agent says so, as
 * Claude Code does; otherwise the one chosen in the conversation, or the model Claude Code's default stands for. It is
 * absent when the agent named no model, and when the turn stopped or failed before the agent answered anything.
 */
export interface ConversationReply {
  text: string | null;
  ended: "finished" | "stopped" | "failed";
  ranOn?: RanOn;
}

/** The tokens a conversation's turns took, summed, and its cost where its agent reports one. */
export interface ConversationUsage {
  inputTokens: number;
  outputTokens: number;
  cachedReadTokens: number;
  cachedWriteTokens: number;
  /** What the agent last reported the whole conversation cost, such as Claude Code does; null when it reports none. */
  cost: { amount: number; currency: string } | null;
  /** The turns that reported tokens. */
  turns: number;
}

/**
 * Something that happened in a conversation, for a plugin's `activity`: the user sent a message, the agent's turn began
 * or ended, or one of its tool calls began or ended. It carries no message text and no tool arguments.
 */
export type PluginActivity =
  | { kind: "user-message" }
  | { kind: "turn-started" }
  | { kind: "turn-ended"; ended: ConversationReply["ended"] }
  | { kind: "tool-started"; toolCallId: string; toolKind: string | null }
  | { kind: "tool-ended"; toolCallId: string; failed: boolean };

export type PluginActivityKind = PluginActivity["kind"];

export type PluginActivityEvent = PluginActivity & {
  conversationId: string;
  conversationTitle: string;
  /**
   * The agent's id of the conversation's session as the event happened, as `StatuslineContext.sessionId` has it, so a
   * plugin can keep each session a conversation had; null before its first session started. Plugin API 14 brought it.
   */
  sessionId: string | null;
  at: number;
};

/** What a plugin's own window and its activity hook reach: its storage, its window's state, and the profiles' settings. */
export interface PluginWindowContext extends ProfilesSettings {
  /** What the plugin keeps across conversations and restarts; values are JSON. */
  storage: CanvasPluginStorage;
  /** Mirador asks `window.state` again soon after, and hands what it returns to the plugin's open windows. */
  windowChanged(): void;
}

/** The profiles, and what each set for the plugin, for work that belongs to no conversation. Plugin API 14 brought them. */
export interface ProfilesSettings {
  /** Mirador's profiles, by name. */
  profiles(): PluginProfile[];
  /** One of the plugin's profile settings as the profile of that name has it, read as `profileSetting` reads it; throws for a profile that isn't there. */
  settingOfProfile(profile: string, id: string): string | null;
}

export interface PluginActivityContext extends PluginWindowContext {
  /** One of the plugin's profile settings as the event's conversation has it, as `profileSetting` reads it in a tool. */
  profileSetting(id: string): string | null;
}

/**
 * A window of the plugin's own, belonging to no conversation, which its canvas view draws with `mirador.place` set to
 * "window": the view gets `state` through `mirador.onState`, and `mirador.send` reaches `action`.
 */
export interface PluginWindow<State = unknown> {
  state(context: PluginWindowContext): State;
  action?(action: unknown, context: PluginWindowContext): unknown;
}

/** The workspace a plugin's workspace tab is open in. */
export interface PluginWorkspace {
  id: string;
  name: string;
  /** The workspace's folder, absolute, on the computer Mirador runs on. */
  folder: string;
}

/** One of Mirador's profiles, for a plugin to offer the user a choice of them. Plugin API 11 brought it. */
export interface PluginProfile {
  name: string;
  /** The agent it runs, as Mirador names it, e.g. "claude" or "codex". */
  agent: string;
  /**
   * The model its conversations start on, as the profile sets it: the id Mirador passes to its agent, e.g. "opus", and
   * the name the agent gave it in the profile's latest conversation, e.g. "Opus 5.5", else the id. Null when the profile
   * leaves the model to its agent. Plugin API 15 brought it.
   */
  model: { id: string; name: string } | null;
  /** The effort its conversations start on, as the profile sets it, e.g. "high"; null when it leaves it to its agent. Plugin API 15 brought it. */
  effort: string | null;
}

/** A conversation a plugin starts of its own in a workspace: on the profile of that name, working on `prompt` at once. */
export interface WorkspaceConversationStart extends ConversationChoices {
  profile: string;
  prompt: string;
  /** Its title, kept as one the user typed is, as `title` is for a conversation a tool starts. */
  title?: string;
}

/** What a plugin's workspace tab reaches: its workspace, what it keeps for that workspace, and a way to say its state changed. */
export interface WorkspaceTabContext {
  workspace: PluginWorkspace;
  /** What the plugin keeps for this workspace alone, across restarts; values are JSON. */
  storage: CanvasPluginStorage;
  /** What the plugin keeps across workspaces, as a window's storage. */
  sharedStorage: CanvasPluginStorage;
  /** Mirador asks `state` again soon after, and hands it to the tab wherever the workspace is open. */
  changed(): void;
  /** Mirador's profiles, by name. Plugin API 11 brought it. */
  profiles(): PluginProfile[];
  /**
   * Starts a conversation of the plugin's own in the workspace, where the workspace starts its conversations, its first
   * message shown as the plugin's. Unlike one a tool starts, it works for nobody: it stands in the sidebar as any other,
   * takes its profile's defaults, YOLO included, and tells the user when its turns end; the plugin hears of them through
   * `activity`. Throws unless the plugin's plugin.json sets `startsConversations`, and, naming the profiles there are,
   * when none has that name. Plugin API 11 brought it.
   */
  startConversation(start: WorkspaceConversationStart): Promise<StartedConversation>;
  /**
   * What a conversation that starts on the profile of that name can choose, as its agent says, for `startConversation`'s
   * `model` and `effort`. Mirador asks the agent as the Profiles dialog does, starting it for a few seconds unless it
   * answered in the last 15 minutes. Resolves to null when the agent couldn't start, didn't answer within 30 seconds, or
   * answered without listing any choices, and rejects, naming the profiles there are, when none has that name. Plugin
   * API 18 brought it.
   */
  profileChoices(profileName: string): Promise<ProfileChoices | null>;
}

/** What a profile's agent offers a conversation, each by the id `startConversation` takes and the name the agent gives it. */
export interface ProfileChoices {
  /** None from an agent that offers no choice of model. */
  models: { id: string; name: string }[];
  /** The efforts of the model the agent starts on, which isn't always the profile's; none for a model that has no effort. */
  efforts: { id: string; name: string }[];
}

/** What a plugin's background work reaches: the workspaces, each as its tab would. Plugin API 11 brought it. */
export interface PluginBackgroundContext extends ProfilesSettings {
  /** The workspaces open in Mirador now. */
  workspaces(): PluginWorkspace[];
  /** A workspace's context, as its tab gets it; throws for one that isn't open. */
  inWorkspace(workspaceId: string): WorkspaceTabContext;
  /** What the plugin keeps across workspaces, as a window's storage. */
  storage: CanvasPluginStorage;
}

/**
 * A tab of the plugin's in the canvas pane of each workspace it shows in, next to the apps, which its canvas view draws
 * with `mirador.place` set to "tab": the view gets `state` through `mirador.onState`, and `mirador.send` reaches `action`.
 * Plugin API 7 brought it.
 */
export interface WorkspaceTab<State = unknown> {
  /** Whether the workspace gets the tab, e.g. only one with a git repo; every workspace does without it. */
  shows?(context: WorkspaceTabContext): boolean | Promise<boolean>;
  state(context: WorkspaceTabContext): State | Promise<State>;
  action?(action: unknown, context: WorkspaceTabContext): unknown;
}

/** The conversation whose statusline a plugin's chips are for. Plugin API 14 brought it. */
export interface StatuslineContext {
  conversationId: string;
  conversationTitle: string;
  /**
   * The agent's own id of the conversation's session, such as Claude Code's session_id, which it also sends its model
   * provider; null until a session started. Going back to an earlier message, clearing the context or moving to another
   * profile gives the conversation a new one.
   */
  sessionId: string | null;
  /** The agent it runs, as Mirador names it, e.g. "claude" or "pi". */
  agent: string;
  /** Its profile's name; null for none. */
  profile: string | null;
  /** When the conversation began, in epoch milliseconds. */
  createdAt: number;
  /** What the conversation has for one of the plugin's profile settings, as a tool's `profileSetting` reads it. */
  profileSetting(id: string): string | null;
  storage: CanvasPluginStorage;
}

/** One figure a plugin shows in a conversation's statusline. Plugin API 14 brought it. */
export interface StatuslineChip {
  text: string;
  /** Its tooltip: what it counts, and as of when. */
  hint?: string;
  /** Close to a limit: drawn in the statusline's colour for a warning, or for danger. */
  level?: StatuslineChipLevel;
  /** An old figure, e.g. while its source can't be reached: drawn faded. */
  stale?: boolean;
  /**
   * The conversation's cost, which this chip shows: the statusline then leaves out the cost the agent reported, and the
   * user's statusline command gets this one, in US dollars, as `cost.total_cost_usd`.
   */
  cost?: { amount: number; currency: string };
  /** A click opens the plugin's window, first handing its window's `action` the `action` given, e.g. to show what the chip counts. */
  opensWindow?: true | { action: unknown };
}

export type StatuslineChipLevel = "warn" | "danger";

export const statuslineChipLevels: StatuslineChipLevel[] = ["warn", "danger"];

/** A tool the agent calls on the canvas server, next to show, ask and the rest, or the user runs from the slash menu. */
export interface CanvasTool<Data = unknown> {
  description: string;
  /** JSON Schema of an object: the tool's arguments, which Mirador checks before calling run. */
  input: Record<string, unknown>;
  /** Resolves to the text its caller gets. What it throws reaches the caller as an error, so its message should say what would work. */
  run(input: unknown, context: CanvasToolContext<Data>): string | Promise<string>;
  /** Left out of every request until the agent searches for it, for a tool rarely called: Claude Code with tool search on. */
  onDemand?: boolean;
  /**
   * Lists the tool in the slash menu as /<plugin>:<tool>, with this description, for the user to run without the agent,
   * its arguments written as key=value after the name. What run resolves to shows above the composer, and the agent hears nothing of it.
   */
  command?: { description: string };
  /**
   * Run again with the same input, it makes the same items: it reads nothing that changes, such as files, and its
   * prompts and conversations aren't needed. Mirador then runs a continued session's calls of it again, so their items
   * come back; with prompt doing nothing and startConversation throwing.
   */
  rebuiltFromInput?: boolean;
}

export type ToolCaller = "agent" | "user";

/** What the agent hears with the user's next message; heard() runs once that message went. */
export interface CanvasPluginNote {
  text: string;
  heard(): void;
}

/**
 * What a plugin's canvas host module exports. Mirador calls it in its own process; every call is guarded, and what a
 * call throws goes to whoever caused it, the agent or the view, as its message.
 */
export interface CanvasHost<Data = unknown> {
  /** The kinds of item the plugin's tools publish, by name. */
  items: Record<string, PluginItemType<Data>>;
  /** By name, which is the tool's name on the canvas server: lower case, digits and underscores. */
  tools: Record<string, CanvasTool<Data>>;
  /**
   * A line each, e.g. "- checklist: …", for the canvas server's instructions and for what Claude Code and pi are told
   * when Settings ask for the canvas often.
   */
  guidance?: { instructions?: string; often?: string };
  /** The user's action in an item's view, sent with `mirador.send`; resolves to what send resolves to in the view. */
  action?(item: PluginItem<Data>, action: unknown, context: CanvasActionContext<Data>): unknown;
  /** What the agent should hear of with the user's next message, such as what the user did in an item. */
  note?(context: CanvasPluginContext<Data>): CanvasPluginNote | null;
  /**
   * Once, when a conversation the plugin's tool or action started ends its work: the turn its first message began ends,
   * or, when that turn left a job running that will wake its agent, the turn the wake-up began; or the turn a restart of
   * Mirador resumed it in. The context is the conversation that started it. A turn cut short by a crash reports as failed
   * at the next start, and one stopped while it waits for its job as stopped. With this hook and `tellsCaller` in plugin.json, Mirador doesn't notify the user
   * that turn ended: the plugin tells the conversation that started it (with `prompt`), whose own turn end does. Later
   * turns notify as usual.
   */
  replied?(started: StartedConversation, reply: ConversationReply, context: CanvasActionContext<Data>): void | Promise<void>;
  /**
   * More lines of guidance for one conversation, from what its profile set, as `profileSetting` reads it; a conversation
   * a plugin's tool started gets none.
   */
  guidanceFor?(profileSetting: (id: string) => string | null): { instructions?: string; often?: string } | null;
  /**
   * The plugin's figures for a conversation's statusline, drawn together in the order given; none for an empty list.
   * Mirador asks whenever a page shows the statusline: on every change to the conversation, and every 30 seconds. So it
   * answers at once from what the plugin already knows, and fetches on timers of its own. Plugin API 14 brought it.
   */
  statusline?(context: StatuslineContext): StatuslineChip[];
  /**
   * Checks what a profile set for the plugin, e.g. that a server answers at the URL and with the key given: the Profiles
   * dialog's Test connection button, before the profile is saved. `setting` reads the settings as `profileSetting` does.
   * Resolves to a line on what it found; what it throws shows as the problem. Plugin API 14 brought it.
   */
  checkProfile?(setting: (id: string) => string | null): string | Promise<string>;
  /** Every conversation's activity, as it happens. It runs after the event, never holding up the agent. */
  activity?(event: PluginActivityEvent, context: PluginActivityContext): void | Promise<void>;
  /** A window of the plugin's own, which the user opens from the palette. */
  window?: PluginWindow;
  workspaceTab?: WorkspaceTab;
  /**
   * Once, as Mirador starts, after it has picked up the conversations it was running: work the plugin does on its own,
   * such as starting a routine's conversation when it is due, with timers of its own. What it throws is logged. Plugin API
   * 11 brought it.
   */
  background?(context: PluginBackgroundContext): void | Promise<void>;
}
