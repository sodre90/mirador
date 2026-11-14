import { isAbsolute } from "node:path";
import { launchEditor } from "../editor.ts";
import { fromJsonSchema, type McpServer, type ServerContext, type ToolAnnotations } from "@modelcontextprotocol/server";
import {
  pluginItemOf,
  type CanvasActionContext,
  type CanvasPluginContext,
  type CanvasPluginStorage,
  type CanvasToolContext,
  type PluginActivity,
  type PluginActivityEvent,
  type PluginBackgroundContext,
  type PluginProfile,
  type PluginWindowContext,
  type ProfileChoices,
  type ProfilesSettings,
  type StatuslineChip,
  type StatuslineContext,
  type ConversationChoices,
  type ConversationStart,
  type ConversationUsage,
  type WorkspaceTabContext,
  type ConversationReply,
  type PluginItemType,
  type StartedConversation,
  type ToolCaller,
  type WorkspaceConversationStart,
} from "../../shared/canvas-plugins.ts";
import type { PluginCommand } from "../../shared/slash-commands.ts";
import { argumentsHint, commandInput } from "../../shared/command-arguments.ts";
import type { Conversation, PluginCanvasItem, PluginContextHint, PluginStatuslineChips, Profile, StartedBy } from "../../shared/model.ts";
import type { ProfileDraft, ServerMessage } from "../../shared/protocol.ts";
import { conversationSettingValue, type ConversationPlugin, isChoiceSetting, pluginsOffFor, isTextSetting, modelSettingsOf, profileSettingValue, readTextSetting, type PluginProfileSetting } from "../../shared/apps.ts";
import { profileEnvironment } from "../acp/harnesses.ts";
import { validContextHint, validStatuslineChips } from "./statusline-chips.ts";
import { usageHistoryOf } from "../turn-samples.ts";
import { categoryChoices } from "../../shared/config-options.ts";
import { canvasViewPath, messageOf, type CanvasPlugin } from "../apps/plugins.ts";
import type { Hub } from "../hub.ts";
import type { Store } from "../store.ts";
import type { PluginCatalog } from "../plugin-catalog.ts";
import { offeredPluginsGuidance, PLUGIN_INSTALL_TOOL, type CanvasPluginGuidance } from "./guidance.ts";
import type { CanvasNote } from "./notes.ts";
import { HostProblemError } from "../../shared/host-problems.ts";

const commandName = (plugin: CanvasPlugin, tool: string) => `${plugin.manifest.name}:${tool}`;

const actsOnConversations = ({ tools, guidance, guidanceFor, note, statusline, contextHint, activity }: CanvasPlugin["host"]) =>
  Object.keys(tools).length > 0 || [guidance, guidanceFor, note, statusline, contextHint, activity].some((part) => part !== undefined);

/** With tool search on, Claude Code hides MCP tools until the agent searches for them; a plugin's tools are offered as the canvas's own are. */
const loadedUpFront = { "anthropic/alwaysLoad": true };

const countOf = (type: PluginItemType | undefined, data: unknown) => (type?.count ? { count: type.count(data) } : {});

const outcomeOf = (type: PluginItemType | undefined, data: unknown) => {
  const outcome = type?.outcome?.(data);
  return outcome ? { outcome } : {};
};

const roomOf = (type: PluginItemType | undefined) => {
  if (!type?.opensWithRoom) return {};
  return typeof type.opensWithRoom === "object" ? { opensWithRoom: true, roomSetting: type.opensWithRoom.setting } : { opensWithRoom: true };
};

/** What the type says of the item, kept with it for the page and the phone, which have no host code. */
const shownOf = (type: PluginItemType | undefined, data: unknown) => ({ ...countOf(type, data), ...outcomeOf(type, data), ...roomOf(type) });

/** A plugin may change its window's state on every tool call; its windows get the state as it settles. */
const WINDOW_STATE_SETTLES_MS = 100;

/** `fromPlugin`: the title of the plugin that sends it on its own, rather than for the user from its view. */
export type SendPrompt = (conversationId: string, text: string, options: { afterTurn: boolean; fromPlugin?: string }) => Promise<void>;

/** `worktree`: "own" starts it in a git worktree of its own, rather than where the caller works; `{ from }` starts its branch at the commit it names. */
export type StartBeside = (callerId: string, plugin: string, profileName: string, prompt: string, title?: string, choices?: ConversationChoices, worktree?: ConversationStart["worktree"]) => StartedConversation | Promise<StartedConversation>;

export type StopStarted = (callerId: string, plugin: string, conversationId: string) => Promise<void>;

export type DeleteStarted = (callerId: string, plugin: string, conversationId: string) => Promise<void>;

/** `pluginTitle` names whose the message shows as. */
export type PromptStarted = (callerId: string, plugin: string, pluginTitle: string, conversationId: string, text: string) => Promise<void>;

export type ReadUsage = (callerId: string, plugin: string, conversationId: string) => ConversationUsage;

/** `pluginTitle` names whose its first message shows as. */
export type StartInWorkspace = (workspaceId: string, pluginTitle: string, start: WorkspaceConversationStart) => Promise<StartedConversation>;

/** What the agent of the profile of that name offers, null when it didn't answer; rejects when no profile has the name. */
export type AskProfileChoices = (profileName: string) => Promise<Conversation["configOptions"] | null>;

const namedChoices = (options: Conversation["configOptions"], category: "model" | "thought_level") =>
  categoryChoices(options, category).map(({ value, name }) => ({ id: value, name }));

const offeredChoices = (options: Conversation["configOptions"]): ProfileChoices => ({ models: namedChoices(options, "model"), efforts: namedChoices(options, "thought_level") });

/**
 * The canvas plugins Mirador loaded when it started: their tools on every conversation's canvas server, the items those
 * tools publish, the user's actions in the items' views, and what the agent hears of with the user's next message.
 */
export class CanvasPlugins {
  private sendPrompt: SendPrompt = async () => {
    throw new Error("Mirador can't send messages yet.");
  };

  private startBeside: StartBeside = () => {
    throw new Error("Mirador can't start conversations yet.");
  };

  private stopStarted: StopStarted = async () => {
    throw new Error("Mirador can't stop conversations yet.");
  };

  private deleteStarted: DeleteStarted = async () => {
    throw new Error("Mirador can't delete conversations yet.");
  };

  private promptStarted: PromptStarted = async () => {
    throw new Error("Mirador can't send messages yet.");
  };

  private readUsage: ReadUsage = () => {
    throw new Error("Mirador can't read usage yet.");
  };

  private startInWorkspace: StartInWorkspace = async () => {
    throw new Error("Mirador can't start conversations yet.");
  };

  private askProfileChoices: AskProfileChoices = async () => {
    throw new Error("Mirador can't ask agents what they offer yet.");
  };

  constructor(
    private readonly store: Store,
    private readonly hub: Hub,
    private readonly plugins: CanvasPlugin[],
  ) {}

  /** Conversations come after the plugins, whose guidance they take. */
  sendsPromptsWith(send: SendPrompt) {
    this.sendPrompt = send;
  }

  startsConversationsWith(start: StartBeside) {
    this.startBeside = start;
  }

  stopsConversationsWith(stop: StopStarted) {
    this.stopStarted = stop;
  }

  deletesConversationsWith(deleteStarted: DeleteStarted) {
    this.deleteStarted = deleteStarted;
  }

  promptsStartedWith(prompt: PromptStarted) {
    this.promptStarted = prompt;
  }

  readsUsageWith(read: ReadUsage) {
    this.readUsage = read;
  }

  startsWorkspaceConversationsWith(start: StartInWorkspace) {
    this.startInWorkspace = start;
  }

  asksProfileChoicesWith(ask: AskProfileChoices) {
    this.askProfileChoices = ask;
  }

  /** Once, as Mirador starts: each plugin's background work, whose failure is the plugin's alone. */
  startBackgroundWork() {
    for (const plugin of this.plugins.filter(({ host }) => host.background)) {
      const failed = (error: unknown) => console.error(`the background work of the ${plugin.manifest.name} plugin failed:`, error);
      try {
        Promise.resolve(plugin.host.background!(this.backgroundContext(plugin))).catch(failed);
      } catch (error) {
        failed(error);
      }
    }
  }

  private backgroundContext(plugin: CanvasPlugin): PluginBackgroundContext {
    return {
      workspaces: () => this.store.listWorkspaces().map(({ id, name, path }) => ({ id, name, folder: path })),
      inWorkspace: (workspaceId) => this.workspaceTabContext(plugin, workspaceId),
      storage: this.storageOf(plugin),
      ...this.profilesSettings(plugin),
    };
  }

  private catalog: PluginCatalog | null = null;

  /** Official plugins not installed yet join the guidance, for the agent to recommend. */
  offersFrom(catalog: PluginCatalog) {
    this.catalog = catalog;
  }

  /** As it is when asked: a conversation started after the catalog came, or after an install, hears of it so. */
  get guidance(): CanvasPluginGuidance {
    return this.guidanceOf(this.plugins);
  }

  private guidanceOf(plugins: CanvasPlugin[]): CanvasPluginGuidance {
    const offered = this.catalog?.notInstalled() ?? [];
    return {
      toolNames: [...plugins.flatMap(({ host }) => Object.keys(host.tools)), ...(offered.length > 0 ? [PLUGIN_INSTALL_TOOL] : [])],
      instructions: [...plugins.flatMap(({ host }) => host.guidance?.instructions ?? []), ...offeredPluginsGuidance(offered)],
      often: plugins.flatMap(({ host }) => host.guidance?.often ?? []),
    };
  }

  /** The plugins the profile's conversations go without: those it turned off, and those whose switch reads off for it. */
  pluginsOffFor(profile: Profile | undefined): string[] {
    return pluginsOffFor(
      profile,
      this.plugins.map(({ manifest }) => ({ plugin: manifest.name, profileSettings: manifest.profileSettings })),
    );
  }

  /** The plugins a conversation gets: all but those its profile goes without. */
  private pluginsOf(conversationId: string): CanvasPlugin[] {
    const conversation = this.store.findConversation(conversationId);
    const turnedOff = this.pluginsOffFor(conversation?.profileId ? this.store.findProfile(conversation.profileId) : undefined);
    return this.plugins.filter(({ manifest }) => !turnedOff.includes(manifest.name));
  }

  /** The plugins that give a conversation something of their own, by name, with their titles and tools; a profile can turn each off. */
  conversationPlugins(): ConversationPlugin[] {
    return this.plugins
      .filter(({ host }) => actsOnConversations(host))
      .map(({ manifest, host }) => ({ plugin: manifest.name, title: manifest.title, tools: Object.keys(host.tools) }));
  }

  /** The guidance of the plugins the conversation's profile has on, with what each adds for that profile, which a conversation a plugin's tool started doesn't get. */
  guidanceFor(conversationId: string): CanvasPluginGuidance {
    const plugins = this.pluginsOf(conversationId);
    const guidance = this.guidanceOf(plugins);
    if (this.store.findConversation(conversationId)?.startedBy) return guidance;
    const added = plugins.flatMap((plugin) => {
      try {
        return plugin.host.guidanceFor?.((id) => this.settingFor(plugin, conversationId, id)) ?? [];
      } catch (error) {
        console.error(`the ${plugin.manifest.name} plugin failed to give guidance for conversation ${conversationId}:`, error);
        return [];
      }
    });
    return {
      ...guidance,
      instructions: [...guidance.instructions, ...added.flatMap(({ instructions }) => instructions ?? [])],
      often: [...guidance.often, ...added.flatMap(({ often }) => often ?? [])],
    };
  }

  private profileSettingNamed(plugin: CanvasPlugin, id: string) {
    const setting = plugin.manifest.profileSettings?.find((each) => each.id === id);
    if (!setting) throw new Error(`${plugin.manifest.name} has no profile setting ${id}; its plugin.json names ${plugin.manifest.profileSettings?.map((each) => each.id).join(", ") || "none"}.`);
    return setting;
  }

  /** What the conversation chose in its top bar, else what its profile set, else the default, as the plugin reads it. */
  private settingFor(plugin: CanvasPlugin, conversationId: string, id: string): string | null {
    const setting = this.profileSettingNamed(plugin, id);
    const conversation = this.store.findConversation(conversationId);
    const profile = conversation?.profileId ? this.store.findProfile(conversation.profileId) : undefined;
    return this.readSetting(setting, conversationSettingValue(conversation, profile, plugin.manifest.name, setting), profile ?? null);
  }

  /** A profile by its name as it is now, and typed text with the variables of the profile's environment it names read. */
  private readSetting(setting: PluginProfileSetting, value: string, profile: Profile | null): string | null {
    if (isTextSetting(setting)) return readTextSetting(setting, value, environmentOf(profile)) || null;
    if (isChoiceSetting(setting) && setting.choices === "profiles") return (value && this.store.findProfile(value)?.name) || null;
    return value || null;
  }

  private profilesSettings(plugin: CanvasPlugin): ProfilesSettings {
    return {
      profiles: () => this.pluginProfiles(),
      settingOfProfile: (profileName, id) => {
        const setting = this.profileSettingNamed(plugin, id);
        const profile = this.store.listProfiles().find(({ name }) => name === profileName);
        if (!profile) throw new Error(`No profile is named ${profileName}; there are ${this.pluginProfiles().map(({ name }) => name).join(", ")}.`);
        return this.readSetting(setting, profileSettingValue(profile.pluginSettings, plugin.manifest.name, setting), profile);
      },
    };
  }

  /** The plugin's check of what the Profiles dialog holds for it, saved or not; resolves to its answer, and throws its problem. */
  async checkProfile(name: string, draft: ProfileDraft): Promise<string> {
    const plugin = this.plugins.find(({ manifest }) => manifest.name === name);
    if (!plugin?.host.checkProfile) throw new Error(plugin ? `${plugin.manifest.title} checks no profile settings.` : `No plugin named ${name} is installed.`);
    const profile: Profile = { ...draft, id: draft.id ?? "", createdAt: 0 };
    const setting = (id: string) => {
      const declared = this.profileSettingNamed(plugin, id);
      return this.readSetting(declared, profileSettingValue(draft.pluginSettings, name, declared), profile);
    };
    return String(await plugin.host.checkProfile(setting));
  }

  /** The plugins that check a profile's settings, by name. */
  checkingProfiles(): Set<string> {
    return new Set(this.plugins.filter(({ host }) => host.checkProfile).map(({ manifest }) => manifest.name));
  }

  /** What each plugin shows in the conversation's statusline; a plugin whose hook fails or shows nothing is left out. */
  statuslineChips(conversationId: string): PluginStatuslineChips[] {
    const conversation = this.store.findConversation(conversationId);
    if (!conversation) return [];
    return this.pluginsOf(conversationId).flatMap((plugin) => {
      if (!plugin.host.statusline) return [];
      try {
        const chips: StatuslineChip[] = validStatuslineChips(plugin.host.statusline(this.statuslineContext(plugin, conversation)));
        return chips.length > 0 ? [{ plugin: plugin.manifest.name, title: plugin.manifest.title, chips, hasWindow: plugin.host.window !== undefined }] : [];
      } catch (error) {
        console.error(`the statusline of the ${plugin.manifest.name} plugin failed for conversation ${conversationId}:`, error);
        return [];
      }
    });
  }

  /** Each plugin's advice on the conversation's context, as it gave it; a plugin whose hook fails or gives none is left out. */
  contextHints(conversationId: string): PluginContextHint[] {
    const conversation = this.store.findConversation(conversationId);
    if (!conversation) return [];
    return this.pluginsOf(conversationId).flatMap((plugin) => {
      if (!plugin.host.contextHint) return [];
      try {
        const hint = validContextHint(plugin.host.contextHint(this.statuslineContext(plugin, conversation)));
        return hint ? [{ plugin: plugin.manifest.name, title: plugin.manifest.title, ...hint }] : [];
      } catch (error) {
        console.error(`the context hint of the ${plugin.manifest.name} plugin failed for conversation ${conversation.id}:`, error);
        return [];
      }
    });
  }

  private statuslineContext(plugin: CanvasPlugin, conversation: Conversation): StatuslineContext {
    const profile = conversation.profileId ? (this.store.findProfile(conversation.profileId) ?? null) : null;
    return {
      conversationId: conversation.id,
      conversationTitle: conversation.title,
      sessionId: conversation.acpSessionId,
      agent: conversation.harness,
      profile: profile?.name ?? null,
      createdAt: conversation.createdAt,
      profileSetting: (id) => this.settingFor(plugin, conversation.id, id),
      storage: this.storageOf(plugin),
      usageHistory: usageHistoryOf(this.store, conversation.id),
    };
  }

  /** By conversation, the plugins' settings the user changed in its top bar since the agent last heard, worded when it hears. */
  private readonly changedSettings = new Map<string, Map<string, { plugin: CanvasPlugin; id: string }>>();

  /**
   * The user changed one of a plugin's profile settings in a conversation's top bar. Its session read its guidance when it
   * began, so the agent hears of the change with the next message; a conversation without a session yet will read it then.
   */
  settingChanged(conversationId: string, pluginName: string, id: string) {
    const plugin = this.pluginsOf(conversationId).find(({ manifest }) => manifest.name === pluginName);
    if (!this.store.findConversation(conversationId)?.acpSessionId || !plugin) return;
    this.profileSettingNamed(plugin, id);
    const changed = this.changedSettings.get(conversationId) ?? new Map<string, { plugin: CanvasPlugin; id: string }>();
    this.changedSettings.set(conversationId, changed.set(`${pluginName}/${id}`, { plugin, id }));
  }

  /** The plugin's settings whose choice of a model no longer holds once the conversation chooses another profile in this one. */
  modelSettingsOf(pluginName: string, profileSettingId: string): string[] {
    const settings = this.plugins.find(({ manifest }) => manifest.name === pluginName)?.manifest.profileSettings ?? [];
    return modelSettingsOf(settings, profileSettingId).map(({ id }) => id);
  }

  /** As the setting is now, so a profile switch since the change, which clears the conversation's choice, is told right. */
  private settingNoteText(plugin: CanvasPlugin, conversationId: string, id: string) {
    const { label } = this.profileSettingNamed(plugin, id);
    const value = this.settingFor(plugin, conversationId, id) ?? "none";
    const chosen = this.store.findConversation(conversationId)?.pluginSettings?.[plugin.manifest.name]?.[id] !== undefined;
    return chosen
      ? `${label} for this conversation is now ${value}: the user chose it, in place of what your instructions say of it.`
      : `${label} for this conversation is back to its profile's: ${value}.`;
  }

  private settingNotesFor(conversationId: string): CanvasNote[] {
    const changed = this.changedSettings.get(conversationId);
    return [...(changed ?? [])].map(([key, { plugin, id }]) => {
      const text = this.settingNoteText(plugin, conversationId, id);
      return { text, heard: () => void (this.settingNoteText(plugin, conversationId, id) === text && changed?.delete(key)) };
    });
  }

  /** Hands every plugin that hears activity what happened in a conversation, once the event is done with, so no plugin holds up the agent. */
  activity(conversationId: string, activity: PluginActivity) {
    const listening = this.pluginsOf(conversationId).filter(({ host }) => host.activity);
    const conversation = listening.length > 0 ? this.store.findConversation(conversationId) : undefined;
    if (!conversation) return;
    const event: PluginActivityEvent = { ...activity, conversationId, conversationTitle: conversation.title, sessionId: conversation.acpSessionId, at: Date.now() };
    queueMicrotask(() => listening.forEach((plugin) => this.tellActivity(plugin, event)));
  }

  private tellActivity(plugin: CanvasPlugin, event: PluginActivityEvent) {
    const failed = (error: unknown) => console.error(`the activity hook of the ${plugin.manifest.name} plugin failed:`, error);
    try {
      const context = { ...this.windowContext(plugin), profileSetting: (id: string) => this.settingFor(plugin, event.conversationId, id) };
      Promise.resolve(plugin.host.activity?.(event, context)).catch(failed);
    } catch (error) {
      failed(error);
    }
  }

  /** The plugins that have a window of their own, their titles by name. */
  windowTitles(): Record<string, string> {
    return Object.fromEntries(this.plugins.filter(({ host }) => host.window).map(({ manifest }) => [manifest.name, manifest.title]));
  }

  windowStateMessage(name: string): ServerMessage {
    try {
      const plugin = this.withWindow(name);
      return { type: "plugin-window.state", plugin: name, state: plugin.host.window!.state(this.windowContext(plugin)) ?? null, problem: null };
    } catch (error) {
      return { type: "plugin-window.state", plugin: name, state: null, problem: messageOf(error) };
    }
  }

  /** The user's action in a plugin's own window, for its host code; resolves to its reply. */
  async actInWindow(name: string, action: unknown): Promise<unknown> {
    const plugin = this.withWindow(name);
    if (!plugin.host.window!.action) throw new Error(`${plugin.manifest.title} takes no actions from its window.`);
    return (await plugin.host.window!.action(action, this.windowContext(plugin))) ?? null;
  }

  private withWindow(name: string) {
    const plugin = this.plugins.find(({ manifest }) => manifest.name === name);
    if (!plugin?.host.window) throw new Error(plugin ? `${plugin.manifest.title} has no window of its own.` : `No plugin named ${name} is installed.`);
    return plugin;
  }

  private readonly windowsSettling = new Set<string>();

  private windowContext(plugin: CanvasPlugin): PluginWindowContext {
    return { storage: this.storageOf(plugin), windowChanged: () => this.windowChanged(plugin.manifest.name), ...this.profilesSettings(plugin) };
  }

  private windowChanged(name: string) {
    if (this.windowsSettling.has(name)) return;
    this.windowsSettling.add(name);
    setTimeout(() => {
      this.windowsSettling.delete(name);
      this.hub.publishToPluginWindows(name, this.windowStateMessage(name));
    }, WINDOW_STATE_SETTLES_MS);
  }

  /** The plugins that have a workspace tab, their titles by name. */
  workspaceTabTitles(): Record<string, string> {
    return Object.fromEntries(this.plugins.filter(({ host }) => host.workspaceTab).map(({ manifest }) => [manifest.name, manifest.title]));
  }

  /** Every workspace tab's state in the workspace, one message each, as each settles. */
  workspaceTabStateMessages(workspaceId: string): Promise<ServerMessage>[] {
    return this.plugins.filter(({ host }) => host.workspaceTab).map((plugin) => this.workspaceTabStateMessage(plugin, workspaceId));
  }

  /** Starts at the clock, so states asked for after a restart still come after those asked for before it. */
  private tabStatesAsked = Date.now();

  private async workspaceTabStateMessage(plugin: CanvasPlugin, workspaceId: string): Promise<ServerMessage> {
    const about = { type: "plugin-tab.state" as const, plugin: plugin.manifest.name, workspaceId, seq: ++this.tabStatesAsked };
    try {
      const tab = plugin.host.workspaceTab!;
      const context = this.workspaceTabContext(plugin, workspaceId);
      const shown = tab.shows ? await tab.shows(context) : true;
      return { ...about, shown, state: shown ? ((await tab.state(context)) ?? null) : null, problem: null };
    } catch (error) {
      return { ...about, shown: true, state: null, problem: messageOf(error) };
    }
  }

  /** The user's action in a plugin's workspace tab, for its host code; resolves to its reply. */
  async actInWorkspaceTab(name: string, workspaceId: string, action: unknown): Promise<unknown> {
    const plugin = this.plugins.find(({ manifest }) => manifest.name === name);
    const tab = plugin?.host.workspaceTab;
    if (!plugin || !tab) throw new Error(plugin ? `${plugin.manifest.title} has no workspace tab.` : `No plugin named ${name} is installed.`);
    if (!tab.action) throw new Error(`${plugin.manifest.title} takes no actions from its tab.`);
    return (await tab.action(action, this.workspaceTabContext(plugin, workspaceId))) ?? null;
  }

  private workspaceTabContext(plugin: CanvasPlugin, workspaceId: string): WorkspaceTabContext {
    const workspace = this.store.findWorkspace(workspaceId);
    if (!workspace) throw new Error(`No workspace ${workspaceId} is open in Mirador.`);
    const shared = this.storageOf(plugin);
    const keyed = (key: string) => `workspace:${workspaceId}:${key}`;
    return {
      workspace: { id: workspace.id, name: workspace.name, folder: workspace.path },
      storage: { get: (key) => shared.get(keyed(key)), set: (key, value) => shared.set(keyed(key), value) },
      sharedStorage: shared,
      changed: () => this.workspaceTabChanged(plugin, workspaceId),
      profiles: () => {
        if (plugin.host.workspaceTab) this.tabsListingProfiles.add(plugin);
        return this.pluginProfiles();
      },
      startConversation: async (start) => {
        if (plugin.manifest.startsConversations !== true) {
          throw new Error(`${plugin.manifest.title} can't start conversations of its own: its plugin.json doesn't set startsConversations.`);
        }
        return this.startInWorkspace(workspaceId, plugin.manifest.title, start);
      },
      profileChoices: async (profileName) => {
        const options = await this.askProfileChoices(profileName);
        return options && offeredChoices(options);
      },
    };
  }

  private readonly tabsSettling = new Set<string>();

  /** The plugins with a workspace tab that read the profiles, whose tabs' state may list them. */
  private readonly tabsListingProfiles = new Set<CanvasPlugin>();

  /** A profile was saved or deleted: the tabs that read the profiles are asked for their state again, in every workspace. */
  profilesChanged() {
    for (const plugin of this.tabsListingProfiles) this.store.listWorkspaces().forEach(({ id }) => this.workspaceTabChanged(plugin, id));
  }

  private workspaceTabChanged(plugin: CanvasPlugin, workspaceId: string) {
    const key = `${plugin.manifest.name}\n${workspaceId}`;
    if (this.tabsSettling.has(key)) return;
    this.tabsSettling.add(key);
    setTimeout(() => {
      this.tabsSettling.delete(key);
      void this.workspaceTabStateMessage(plugin, workspaceId).then((message) => this.hub.publishToPluginTabs(workspaceId, message));
    }, WINDOW_STATE_SETTLES_MS);
  }

  /** Each plugin's tools, by name, with the plugin's title, for the timeline to name the plugin a tool call is from. */
  toolTitles(): Record<string, string> {
    return Object.fromEntries(this.plugins.flatMap(({ manifest, host }) => Object.keys(host.tools).map((tool) => [tool, manifest.title])));
  }

  /** Each loaded plugin's title by its name in plugin.json. */
  pluginTitles(): Record<string, string> {
    return Object.fromEntries(this.plugins.map(({ manifest }) => [manifest.name, manifest.title]));
  }

  /** The tools the user may run from the slash menu, as /<plugin>:<tool>. */
  commands(): PluginCommand[] {
    return this.plugins.flatMap((plugin) =>
      Object.entries(plugin.host.tools).flatMap(([tool, { command, input }]) =>
        command ? [{ name: commandName(plugin, tool), description: command.description, hint: argumentsHint(input), plugin: plugin.manifest.name }] : [],
      ),
    );
  }

  /**
   * Runs a command's tool for the user in the conversation, with the `key=value` arguments written after its name, checked
   * as an agent's call is; resolves to what the tool says, and throws what went wrong.
   */
  async runCommand(conversationId: string, name: string, writtenArguments = ""): Promise<string> {
    const conversation = this.store.findConversation(conversationId);
    if (!conversation) throw new HostProblemError({ code: "no-such-conversation", id: conversationId });
    const { plugin, tool } = this.commandTool(name);
    if (!this.pluginsOf(conversationId).includes(plugin)) {
      const profile = conversation.profileId ? this.store.findProfile(conversation.profileId) : undefined;
      throw new HostProblemError({ code: "plugin-off-for-profile", plugin: plugin.manifest.title, profile: profile?.name ?? "" });
    }
    const parsed = await fromJsonSchema(tool.input)["~standard"].validate(commandInput(writtenArguments, tool.input));
    if (parsed.issues) throw new Error(parsed.issues.map(({ message }) => message).join("; "));
    return String(await tool.run(parsed.value, this.toolContext(plugin, conversationId, "user")));
  }

  private commandTool(name: string) {
    for (const plugin of this.plugins) {
      const tool = Object.entries(plugin.host.tools).find(([toolName, { command }]) => command && commandName(plugin, toolName) === name)?.[1];
      if (tool) return { plugin, tool };
    }
    throw new HostProblemError({ code: "plugin-command-unknown", command: name });
  }

  /** Where the canvas assets serve each plugin's canvas view, by plugin name. */
  viewPaths(): Record<string, string> {
    return Object.fromEntries(this.plugins.map((plugin) => [plugin.manifest.name, canvasViewPath(plugin)]));
  }

  viewCode(pathname: string): Uint8Array<ArrayBuffer> | null {
    return this.plugins.find((plugin) => canvasViewPath(plugin) === pathname)?.view.code ?? null;
  }

  /** Runs a plugin tool call from the history of a session Mirador continues again, if its tool is rebuilt from its input, so its items come back. */
  async replay(conversationId: string, toolName: string, input: Record<string, unknown>) {
    const plugin = this.plugins.find(({ host }) => host.tools[toolName]?.rebuiltFromInput);
    if (!plugin) return;
    const context: CanvasToolContext = {
      ...this.toolContext(plugin, conversationId, "agent"),
      prompt: async () => {},
      startConversation: async () => {
        throw new Error("Mirador doesn't start conversations while it rebuilds a canvas.");
      },
      stopConversation: async () => {
        throw new Error("Mirador doesn't stop conversations while it rebuilds a canvas.");
      },
      deleteStarted: async () => {
        throw new Error("Mirador doesn't delete conversations while it rebuilds a canvas.");
      },
    };
    const tool = plugin.host.tools[toolName]!;
    try {
      const parsed = await fromJsonSchema(tool.input)["~standard"].validate(input);
      if (parsed.issues) throw new Error(parsed.issues.map(({ message }) => message).join("; "));
      await tool.run(parsed.value, context);
    } catch (error) {
      console.error(`the ${plugin.manifest.name} plugin failed to rebuild its ${toolName} call in conversation ${conversationId}:`, error);
    }
  }

  /** Puts every plugin's tools on a conversation's canvas server; what a tool throws reaches the agent as a tool error. */
  /** The tools of the plugins the conversation's profile has on; the conversations on one opencode process share its profile, so the calling one's are the same. */
  registerTools(server: McpServer, conversationId: string, callingConversation: (ctx: ServerContext) => Promise<string>, reviewFree: { annotations?: ToolAnnotations } = {}) {
    for (const plugin of this.pluginsOf(conversationId)) {
      for (const [name, tool] of Object.entries(plugin.host.tools)) {
        const loading = tool.onDemand ? {} : { _meta: loadedUpFront };
        server.registerTool(name, { description: tool.description, inputSchema: fromJsonSchema(tool.input), ...loading, ...reviewFree }, async (input, ctx) => {
          try {
            const text = await tool.run(input, this.toolContext(plugin, await callingConversation(ctx), "agent"));
            return { content: [{ type: "text" as const, text: String(text) }] };
          } catch (error) {
            return { isError: true, content: [{ type: "text" as const, text: messageOf(error) }] };
          }
        });
      }
    }
  }

  /** The user's action in an item's view, for the item's plugin to handle; resolves to the plugin's reply. */
  async act(itemId: string, action: unknown): Promise<unknown> {
    const item = this.pluginItem(itemId);
    const plugin = this.plugins.find(({ manifest }) => manifest.name === item.plugin);
    if (!plugin) throw new HostProblemError({ code: "item-plugin-not-installed", plugin: item.plugin });
    if (!plugin.host.action) throw new HostProblemError({ code: "plugin-takes-no-actions", plugin: plugin.manifest.title });
    return (await plugin.host.action(pluginItemOf(item), action, this.actionContext(plugin, item.conversationId))) ?? null;
  }

  /** The user takes an item out of the tab; only a new item brings one back. */
  dismiss(itemId: string) {
    const item = this.pluginItem(itemId);
    if (item.placement !== "tab") throw new HostProblemError({ code: "only-tab-items-dismissed" });
    this.save({ ...item, dismissed: true });
  }

  /**
   * Whether a plugin tells the caller how the conversations its tools started ended: it is installed, with a `replied`
   * of its own and `tellsCaller` in its plugin.json.
   */
  tellsItsCaller(name: string) {
    return this.plugins.some(({ manifest, host }) => manifest.name === name && manifest.tellsCaller === true && host.replied !== undefined);
  }

  /** The plugin whose tool started a conversation hears how its work ended; one no longer installed hears nothing. */
  async replied(started: StartedConversation, { conversationId, plugin: name }: StartedBy, reply: ConversationReply) {
    const plugin = this.plugins.find(({ manifest }) => manifest.name === name);
    if (!plugin) return;
    await plugin.host.replied?.(started, reply, { ...this.actionContext(plugin, conversationId), prompt: this.promptOfItsOwn(plugin, conversationId) });
  }

  /** What the plugins, and the user's changes to their settings, have for the agent to hear of with the next message; a plugin whose note fails is left out. */
  notesForAgent(conversationId: string): CanvasNote[] {
    const fromPlugins = this.pluginsOf(conversationId).flatMap((plugin) => {
      try {
        const note = plugin.host.note?.(this.context(plugin, conversationId, { byAgent: false }));
        return note ? [note] : [];
      } catch (error) {
        console.error(`the note of the ${plugin.manifest.name} plugin failed:`, error);
        return [];
      }
    });
    return [...this.settingNotesFor(conversationId), ...fromPlugins];
  }

  private toolContext(plugin: CanvasPlugin, conversationId: string, caller: ToolCaller): CanvasToolContext {
    return {
      ...this.context(plugin, conversationId, { byAgent: caller === "agent" }),
      caller,
      publish: ({ type, title, data }) => pluginItemOf(this.publish(plugin, conversationId, type, title, data)),
      prompt: this.promptOfItsOwn(plugin, conversationId),
      startConversation: this.startsConversationsFrom(plugin, conversationId),
      stopConversation: (startedConversationId) => this.stopStarted(conversationId, plugin.manifest.name, startedConversationId),
      deleteStarted: (startedConversationId) => this.deleteStarted(conversationId, plugin.manifest.name, startedConversationId),
    };
  }

  private startsConversationsFrom(plugin: CanvasPlugin, conversationId: string): CanvasActionContext["startConversation"] {
    return async ({ profile, prompt, title, model, effort, worktree }) => this.startBeside(conversationId, plugin.manifest.name, profile, prompt, title, { model, effort }, worktree);
  }

  /** A message the plugin sends on its own, which the conversation shows as the plugin's; one from its view, for the user, stays the user's. */
  private promptOfItsOwn(plugin: CanvasPlugin, conversationId: string) {
    return (text: string, { afterTurn = false } = {}) => this.sendPrompt(conversationId, text, { afterTurn, fromPlugin: plugin.manifest.title });
  }

  private actionContext(plugin: CanvasPlugin, conversationId: string): CanvasActionContext {
    return {
      ...this.context(plugin, conversationId, { byAgent: false }),
      prompt: (text, { afterTurn = false } = {}) => this.sendPrompt(conversationId, text, { afterTurn }),
      openInEditor: (file, line) => {
        if (!isAbsolute(file) || !Number.isInteger(line) || line < 1) throw new Error(`${file}:${line} is not an absolute path and a line in it.`);
        launchEditor(this.store.editorSetting(), file, line);
      },
      stopConversation: (startedConversationId) => this.stopStarted(conversationId, plugin.manifest.name, startedConversationId),
      deleteStarted: (startedConversationId) => this.deleteStarted(conversationId, plugin.manifest.name, startedConversationId),
      startConversation: this.startsConversationsFrom(plugin, conversationId),
      promptStarted: (startedId, text) => this.promptStarted(conversationId, plugin.manifest.name, plugin.manifest.title, startedId, text),
    };
  }

  private context(plugin: CanvasPlugin, conversationId: string, { byAgent }: { byAgent: boolean }): CanvasPluginContext {
    const workspaceOf = () => {
      const conversation = this.store.findConversation(conversationId);
      const workspace = conversation ? this.store.findWorkspace(conversation.workspaceId) : undefined;
      if (!workspace) throw new Error(`Conversation ${conversationId} has no workspace any more.`);
      return { id: workspace.id, name: workspace.name, folder: workspace.path };
    };
    return {
      conversationId,
      get workspace() {
        return workspaceOf();
      },
      items: () => this.itemsOf(plugin, conversationId).map(pluginItemOf),
      change: (itemId, change) => pluginItemOf(this.change(plugin, conversationId, itemId, change, byAgent)),
      storage: this.storageOf(plugin),
      profileSetting: (id) => this.settingFor(plugin, conversationId, id),
      profiles: () => this.pluginProfiles(),
      usageOf: (startedId) => this.readUsage(conversationId, plugin.manifest.name, startedId),
      usageHistory: usageHistoryOf(this.store, conversationId),
    };
  }

  private pluginProfiles(): PluginProfile[] {
    return this.store.listProfiles().map(({ id, name, harness, model, effort }) => ({ name, agent: harness, model: model ? this.namedModel(id, model) : null, effort }));
  }

  private namedModel(profileId: string, model: string): { id: string; name: string } {
    const offered = categoryChoices(this.store.latestConfigOptionsOf(profileId), "model").find(({ value }) => value === model);
    return { id: model, name: offered?.name ?? model };
  }

  private storageOf(plugin: CanvasPlugin): CanvasPluginStorage {
    const name = plugin.manifest.name;
    return {
      get: (key) => this.store.canvasPluginStorageItem(name, key),
      set: (key, value) => this.store.saveCanvasPluginStorageItem(name, key, value),
    };
  }

  /** An item as the canvas lists it: what its plugin makes of it, e.g. without a run Mirador's restart cut short. */
  listed(item: PluginCanvasItem): PluginCanvasItem {
    const type = this.plugins.find(({ manifest }) => manifest.name === item.plugin)?.host.items[item.type];
    if (!type) return item;
    try {
      const data = type.listed ? type.listed(pluginItemOf(item)) : item.data;
      const { outcome: _, ...withoutOutcome } = item;
      const shown = { ...withoutOutcome, data, ...shownOf(type, data) };
      if (data !== item.data) return { ...shown, updatedAt: Date.now() };
      return shown.outcome === item.outcome && shown.count === item.count && shown.roomSetting === item.roomSetting ? item : shown;
    } catch (error) {
      console.error(`the ${item.plugin} plugin failed to list ${item.id}:`, error);
      return item;
    }
  }

  private publish(plugin: CanvasPlugin, conversationId: string, type: string, title: string, data: unknown) {
    const itemType = plugin.host.items[type];
    if (!itemType) throw new Error(`${plugin.manifest.name} has no kind of item named ${type}; it has ${Object.keys(plugin.host.items).join(", ")}.`);
    if (typeof title !== "string" || !title.trim()) throw new Error("An item needs a title.");
    return this.save({
      id: crypto.randomUUID(),
      conversationId,
      kind: "plugin",
      plugin: plugin.manifest.name,
      type,
      icon: itemType.icon,
      placement: itemType.placement,
      title,
      data,
      ...shownOf(itemType, data),
      status: "shown",
      createdAt: Date.now(),
    });
  }

  private change(plugin: CanvasPlugin, conversationId: string, itemId: string, { title, data }: { title?: string; data?: unknown }, byAgent: boolean) {
    const item = this.itemsOf(plugin, conversationId).find(({ id }) => id === itemId);
    if (!item) throw new Error(`${itemId} is not an item of ${plugin.manifest.name} in this conversation.`);
    const changedData = data === undefined ? item.data : data;
    const { outcome: _, ...withoutOutcome } = item;
    return this.save({
      ...withoutOutcome,
      ...(title !== undefined && { title }),
      data: changedData,
      ...shownOf(plugin.host.items[item.type], changedData),
      ...(byAgent && { agentEditedAt: Date.now() }),
    });
  }

  private itemsOf(plugin: CanvasPlugin, conversationId: string) {
    return this.store.listCanvasItems(conversationId).filter((item): item is PluginCanvasItem => item.kind === "plugin" && item.plugin === plugin.manifest.name);
  }

  private pluginItem(itemId: string) {
    const item = this.store.findCanvasItem(itemId);
    if (item?.kind !== "plugin") throw new HostProblemError({ code: "unknown-item" });
    return item;
  }

  private save(change: PluginCanvasItem) {
    const item = { ...change, updatedAt: Date.now() };
    this.store.saveCanvasItem(item);
    this.hub.publishToConversation(item.conversationId, { type: "canvas.upserted", item });
    return item;
  }
}

/** A profile whose environment does not parse reads no variables; its conversations say why elsewhere. */
function environmentOf(profile: Profile | null): Record<string, string> {
  try {
    return profileEnvironment(profile);
  } catch {
    return {};
  }
}
