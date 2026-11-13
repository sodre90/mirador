import { useEffect, useState, useSyncExternalStore } from "react";
import { profileSettingWhoseModelsItLists, settingValue, type ConversationPlugin, type PluginChoiceProfileSetting, type PluginProfileSetting, type PluginSettings } from "../shared/apps.ts";
import { categoryChoices, nameWithMultiplier } from "../shared/config-options.ts";
import type { CanvasItem, Profile } from "../shared/model.ts";
import { itemRooms, type ItemRoom } from "../shared/canvas-plugins.ts";
import { connection } from "./connection.ts";
import { t } from "./i18n/index.ts";

let current: PluginSettings[] = [];
const listeners = new Set<() => void>();

function receive(pluginSettings: PluginSettings[]) {
  current = pluginSettings;
  listeners.forEach((listener) => listener());
  moveReviewPlacementFromThisBrowser();
}

let pluginToolTitles: Record<string, string> = {};
let pluginTitles: Record<string, string> = {};
let pluginsOfConversations: ConversationPlugin[] = [];

/** Each plugin's tools with the plugin's title, as the host last said; plugins change only with a restart, which sends a new snapshot. */
export const toolTitlesOfPlugins = () => pluginToolTitles;

/** Each loaded plugin's title, by name, as the host last said. */
export const titlesOfPlugins = () => pluginTitles;

/** The plugins a profile can turn off for its conversations, as the host last said; plugins change only with a restart. */
export const conversationPlugins = () => pluginsOfConversations;

const NONE_OFF: string[] = [];

/** What the profile turned off; a conversation without one gets every plugin. */
export const pluginsOffFor = (profiles: Profile[], profileId: string | null) => profiles.find(({ id }) => id === profileId)?.pluginsOff ?? NONE_OFF;

connection.onMessage((message) => {
  if (message.type === "snapshot") {
    pluginToolTitles = message.pluginToolTitles ?? {};
    pluginTitles = message.pluginTitles ?? {};
    pluginsOfConversations = message.conversationPlugins;
    receive(message.pluginSettings ?? []);
  }
  if (message.type === "plugins.settings") receive(message.pluginSettings);
});

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

export const usePluginSettings = () => useSyncExternalStore(subscribe, () => current);

/** The plugins' settings as the host last said, outside a component. */
export const pluginSettingsNow = () => current;

interface SettingChoice {
  value: string;
  label: string;
}

/** What the profile's agent says its models are, asked each time another profile is named; none while it answers, when it did not, and without a profile. */
function useModelsOfProfile(profileId: string | null): SettingChoice[] {
  const [models, setModels] = useState<SettingChoice[]>([]);
  useEffect(() => {
    setModels([]);
    if (!profileId) return;
    const requestId = crypto.randomUUID();
    const stopListening = connection.onMessage((message) => {
      if (message.type !== "profile.choices.got" || message.requestId !== requestId) return;
      setModels(categoryChoices(message.configOptions ?? [], "model").map((choice) => ({ value: choice.value, label: nameWithMultiplier(choice) })));
    });
    connection.send({ type: "profile.choices.get", requestId, profileId });
    return stopListening;
  }, [profileId]);
  return models;
}

/**
 * What a profile setting offers. One whose choices are the profiles offers the others, never the profile itself, and
 * none. One whose choices are a profile's models offers the agent's own and those of the profile `valueOf` its other
 * setting, and `chosen` even while that profile's agent hasn't listed it.
 */
export function useChoicesOf(
  setting: PluginChoiceProfileSetting,
  settingsOfPlugin: PluginProfileSetting[],
  profiles: Profile[],
  ownId: string | null | undefined,
  valueOf: (setting: PluginProfileSetting) => string,
  chosen: string,
): SettingChoice[] {
  const profileSetting = settingsOfPlugin.find(({ id }) => id === profileSettingWhoseModelsItLists(setting));
  const models = useModelsOfProfile(profileSetting ? valueOf(profileSetting) || null : null);
  if (setting.choices === "profiles") return [{ value: "", label: t.plugins.none }, ...profiles.filter(({ id }) => id !== ownId).map(({ id, name }) => ({ value: id, label: name }))];
  if (Array.isArray(setting.choices)) return setting.choices;
  const chosenButUnlisted = chosen !== "" && !models.some(({ value }) => value === chosen) ? [{ value: chosen, label: chosen }] : [];
  return [{ value: "", label: t.profiles.agentsDefault }, ...models, ...chosenButUnlisted];
}

export const choosePluginSetting = (plugin: string, setting: string, value: string) => connection.send({ type: "plugins.choose-setting", plugin, setting, value });

/** Before plugins had settings, this browser remembered where reviews open. */
const LEGACY_REVIEW_PLACEMENT_KEY = "mirador-review-placement";

function moveReviewPlacementFromThisBrowser() {
  try {
    const remembered = localStorage.getItem(LEGACY_REVIEW_PLACEMENT_KEY);
    if (remembered === null) return;
    const review = current.find(({ plugin }) => plugin === "review");
    if (!review?.settings.some(({ id }) => id === "open-reviews")) return;
    if (review.chosen["open-reviews"] === undefined && itemRooms.some((room) => room === remembered)) choosePluginSetting("review", "open-reviews", remembered);
    localStorage.removeItem(LEGACY_REVIEW_PLACEMENT_KEY);
  } catch {}
}

/** The room a plugin's item takes when it opens: what its plugin's setting says, else full screen. */
export function roomOf(item: CanvasItem): ItemRoom {
  if (item.kind !== "plugin" || !item.roomSetting) return "fullscreen";
  const chosen = settingValue(
    current.find(({ plugin }) => plugin === item.plugin),
    item.roomSetting,
  );
  return itemRooms.find((room) => room === chosen) ?? "fullscreen";
}
