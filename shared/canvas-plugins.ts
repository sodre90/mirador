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
  startConversation(start: {
    profile: string;
    prompt: string;
    /**
     * The conversation's title, its first line cut to 60 characters, kept as one the user typed is: neither the first
     * message nor the agent renames it, while the user still can. Without one, or with a blank one, the first line of
     * `prompt` titles it, and the agent may rename it later. Plugin API 8 brought it.
     */
    title?: string;
  } & ConversationChoices): Promise<StartedConversation>;
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

export type PluginActivityEvent = PluginActivity & { conversationId: string; conversationTitle: string; at: number };

/** What a plugin's own window and its activity hook reach: its storage, and its window's state. */
export interface PluginWindowContext {
  /** What the plugin keeps across conversations and restarts; values are JSON. */
  storage: CanvasPluginStorage;
  /** Mirador asks `window.state` again soon after, and hands what it returns to the plugin's open windows. */
  windowChanged(): void;
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

/** What a plugin's workspace tab reaches: its workspace, what it keeps for that workspace, and a way to say its state changed. */
export interface WorkspaceTabContext {
  workspace: PluginWorkspace;
  /** What the plugin keeps for this workspace alone, across restarts; values are JSON. */
  storage: CanvasPluginStorage;
  /** What the plugin keeps across workspaces, as a window's storage. */
  sharedStorage: CanvasPluginStorage;
  /** Mirador asks `state` again soon after, and hands it to the tab wherever the workspace is open. */
  changed(): void;
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
   * Once, when a conversation one of the plugin's tools started ends the turn its first message began, or the turn a
   * restart of Mirador resumed it in; the context is the conversation that started it. A turn cut short by a crash
   * reports as failed at the next start.
   */
  replied?(started: StartedConversation, reply: ConversationReply, context: CanvasActionContext<Data>): void | Promise<void>;
  /**
   * More lines of guidance for one conversation, from what its profile set, as `profileSetting` reads it; a conversation
   * a plugin's tool started gets none.
   */
  guidanceFor?(profileSetting: (id: string) => string | null): { instructions?: string; often?: string } | null;
  /** Every conversation's activity, as it happens. It runs after the event, never holding up the agent. */
  activity?(event: PluginActivityEvent, context: PluginActivityContext): void | Promise<void>;
  /** A window of the plugin's own, which the user opens from the palette. */
  window?: PluginWindow;
  workspaceTab?: WorkspaceTab;
}
