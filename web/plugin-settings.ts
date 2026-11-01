import { useSyncExternalStore } from "react";
import { settingValue, type PluginProfileSetting, type PluginSettings } from "../shared/apps.ts";
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

/** Each plugin's tools with the plugin's title, as the host last said; plugins change only with a restart, which sends a new snapshot. */
export const toolTitlesOfPlugins = () => pluginToolTitles;

connection.onMessage((message) => {
  if (message.type === "snapshot") pluginToolTitles = message.pluginToolTitles ?? {};
  if (message.type === "snapshot") receive(message.pluginSettings ?? []);
  if (message.type === "plugins.settings") receive(message.pluginSettings);
});

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

export const usePluginSettings = () => useSyncExternalStore(subscribe, () => current);

/** A setting whose choices are the profiles offers the others, never the profile itself, and none. */
export const choicesOf = (setting: PluginProfileSetting, profiles: Profile[], ownId: string | null | undefined) =>
  setting.choices === "profiles"
    ? [{ value: "", label: t.plugins.none }, ...profiles.filter(({ id }) => id !== ownId).map(({ id, name }) => ({ value: id, label: name }))]
    : setting.choices;

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
