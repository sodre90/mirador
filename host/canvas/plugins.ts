import { fromJsonSchema, type McpServer, type ServerContext } from "@modelcontextprotocol/server";
import {
  pluginItemOf,
  type CanvasActionContext,
  type CanvasPluginContext,
  type CanvasPluginStorage,
  type CanvasToolContext,
  type ConversationReply,
  type PluginItemType,
  type StartedConversation,
} from "../../shared/canvas-plugins.ts";
import type { PluginCanvasItem, StartedBy } from "../../shared/model.ts";
import { conversationSettingValue } from "../../shared/apps.ts";
import { canvasViewPath, messageOf, type CanvasPlugin } from "../apps/plugins.ts";
import type { Hub } from "../hub.ts";
import type { Store } from "../store.ts";
import type { PluginCatalog } from "../plugin-catalog.ts";
import { offeredPluginsGuidance, PLUGIN_INSTALL_TOOL, type CanvasPluginGuidance } from "./guidance.ts";
import type { CanvasNote } from "./notes.ts";

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

/** `fromPlugin`: the title of the plugin that sends it on its own, rather than for the user from its view. */
export type SendPrompt = (conversationId: string, text: string, options: { afterTurn: boolean; fromPlugin?: string }) => Promise<void>;

export type StartBeside = (callerId: string, plugin: string, profileName: string, prompt: string) => StartedConversation;

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

  private catalog: PluginCatalog | null = null;

  /** Official plugins not installed yet join the guidance, for the agent to recommend. */
  offersFrom(catalog: PluginCatalog) {
    this.catalog = catalog;
  }

  /** As it is when asked: a conversation started after the catalog came, or after an install, hears of it so. */
  get guidance(): CanvasPluginGuidance {
    const offered = this.catalog?.notInstalled() ?? [];
    return {
      toolNames: [...this.plugins.flatMap(({ host }) => Object.keys(host.tools)), ...(offered.length > 0 ? [PLUGIN_INSTALL_TOOL] : [])],
      instructions: [...this.plugins.flatMap(({ host }) => host.guidance?.instructions ?? []), ...offeredPluginsGuidance(offered)],
      often: this.plugins.flatMap(({ host }) => host.guidance?.often ?? []),
    };
  }

  /** The guidance, with what each plugin adds for the conversation's profile, which a conversation a plugin's tool started doesn't get. */
  guidanceFor(conversationId: string): CanvasPluginGuidance {
    const { guidance } = this;
    if (this.store.findConversation(conversationId)?.startedBy) return guidance;
    const added = this.plugins.flatMap((plugin) => {
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

  /** What the conversation chose in its top bar, else what its profile set, else the default; a profile by its name as it is now. */
  private settingFor(plugin: CanvasPlugin, conversationId: string, id: string): string | null {
    const setting = this.profileSettingNamed(plugin, id);
    const conversation = this.store.findConversation(conversationId);
    const profile = conversation?.profileId ? this.store.findProfile(conversation.profileId) : undefined;
    const value = conversationSettingValue(conversation, profile, plugin.manifest.name, setting);
    if (setting.choices !== "profiles") return value || null;
    return (value && this.store.findProfile(value)?.name) || null;
  }

  /** By conversation, the plugins' settings the user changed in its top bar since the agent last heard, worded when it hears. */
  private readonly changedSettings = new Map<string, Map<string, { plugin: CanvasPlugin; id: string }>>();

  /**
   * The user changed one of a plugin's profile settings in a conversation's top bar. Its session read its guidance when it
   * began, so the agent hears of the change with the next message; a conversation without a session yet will read it then.
   */
  settingChanged(conversationId: string, pluginName: string, id: string) {
    const plugin = this.plugins.find(({ manifest }) => manifest.name === pluginName);
    if (!this.store.findConversation(conversationId)?.acpSessionId || !plugin) return;
    this.profileSettingNamed(plugin, id);
    const changed = this.changedSettings.get(conversationId) ?? new Map<string, { plugin: CanvasPlugin; id: string }>();
    this.changedSettings.set(conversationId, changed.set(`${pluginName}/${id}`, { plugin, id }));
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

  /** Each plugin's tools, by name, with the plugin's title, for the timeline to name the plugin a tool call is from. */
  toolTitles(): Record<string, string> {
    return Object.fromEntries(this.plugins.flatMap(({ manifest, host }) => Object.keys(host.tools).map((tool) => [tool, manifest.title])));
  }

  /** Where the canvas assets serve each plugin's canvas view, by plugin name. */
  viewPaths(): Record<string, string> {
    return Object.fromEntries(this.plugins.map((plugin) => [plugin.manifest.name, canvasViewPath(plugin)]));
  }

  viewCode(pathname: string): Uint8Array<ArrayBuffer> | null {
    return this.plugins.find((plugin) => canvasViewPath(plugin) === pathname)?.view.code ?? null;
  }

  /** Puts every plugin's tools on a conversation's canvas server; what a tool throws reaches the agent as a tool error. */
  registerTools(server: McpServer, callingConversation: (ctx: ServerContext) => Promise<string>) {
    for (const plugin of this.plugins) {
      for (const [name, tool] of Object.entries(plugin.host.tools)) {
        const loading = tool.onDemand ? {} : { _meta: loadedUpFront };
        server.registerTool(name, { description: tool.description, inputSchema: fromJsonSchema(tool.input), ...loading }, async (input, ctx) => {
          try {
            const text = await tool.run(input, this.toolContext(plugin, await callingConversation(ctx)));
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
    if (!plugin) throw new Error(`The plugin that drew this item, ${item.plugin}, isn't installed.`);
    if (!plugin.host.action) throw new Error(`${plugin.manifest.title} takes no actions from its items.`);
    return (await plugin.host.action(pluginItemOf(item), action, this.actionContext(plugin, item.conversationId))) ?? null;
  }

  /** The user takes an item out of the tab; only a new item brings one back. */
  dismiss(itemId: string) {
    const item = this.pluginItem(itemId);
    if (item.placement !== "tab") throw new Error("Only an item in the tab can be dismissed.");
    this.save({ ...item, dismissed: true });
  }

  /** The plugin whose tool started a conversation hears how its work ended; one no longer installed hears nothing. */
  async replied(started: StartedConversation, { conversationId, plugin: name }: StartedBy, reply: ConversationReply) {
    const plugin = this.plugins.find(({ manifest }) => manifest.name === name);
    if (!plugin) return;
    await plugin.host.replied?.(started, reply, { ...this.actionContext(plugin, conversationId), prompt: this.promptOfItsOwn(plugin, conversationId) });
  }

  /** What the plugins, and the user's changes to their settings, have for the agent to hear of with the next message; a plugin whose note fails is left out. */
  notesForAgent(conversationId: string): CanvasNote[] {
    const fromPlugins = this.plugins.flatMap((plugin) => {
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

  private toolContext(plugin: CanvasPlugin, conversationId: string): CanvasToolContext {
    return {
      ...this.context(plugin, conversationId, { byAgent: true }),
      publish: ({ type, title, data }) => pluginItemOf(this.publish(plugin, conversationId, type, title, data)),
      prompt: this.promptOfItsOwn(plugin, conversationId),
      startConversation: async ({ profile, prompt }) => this.startBeside(conversationId, plugin.manifest.name, profile, prompt),
    };
  }

  /** A message the plugin sends on its own, which the conversation shows as the plugin's; one from its view, for the user, stays the user's. */
  private promptOfItsOwn(plugin: CanvasPlugin, conversationId: string) {
    return (text: string, { afterTurn = false } = {}) => this.sendPrompt(conversationId, text, { afterTurn, fromPlugin: plugin.manifest.title });
  }

  private actionContext(plugin: CanvasPlugin, conversationId: string): CanvasActionContext {
    return {
      ...this.context(plugin, conversationId, { byAgent: false }),
      prompt: (text, { afterTurn = false } = {}) => this.sendPrompt(conversationId, text, { afterTurn }),
    };
  }

  private context(plugin: CanvasPlugin, conversationId: string, { byAgent }: { byAgent: boolean }): CanvasPluginContext {
    return {
      conversationId,
      items: () => this.itemsOf(plugin, conversationId).map(pluginItemOf),
      change: (itemId, change) => pluginItemOf(this.change(plugin, conversationId, itemId, change, byAgent)),
      storage: this.storageOf(plugin),
      profileSetting: (id) => this.settingFor(plugin, conversationId, id),
    };
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
    if (item?.kind !== "plugin") throw new Error("Unknown item.");
    return item;
  }

  private save(change: PluginCanvasItem) {
    const item = { ...change, updatedAt: Date.now() };
    this.store.saveCanvasItem(item);
    this.hub.publishToConversation(item.conversationId, { type: "canvas.upserted", item });
    return item;
  }
}
