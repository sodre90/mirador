import {
  isTextSetting,
  pluginsOffFor,
  profileSettingValue,
  switchOf,
  variableReadBy,
  type ConversationPlugin,
  type PluginChoiceProfileSetting,
  type PluginLook,
  type PluginProfileSetting,
  type PluginSettings,
  type PluginTextProfileSetting,
  type PluginToggleProfileSetting,
} from "../shared/apps.ts";
import type { Profile } from "../shared/model.ts";
import { parseEnvironment } from "../shared/profile-environment.ts";
import { formatList, t } from "./i18n/index.ts";

const words = t.profiles.pluginsTab;

export type ProfilePluginSettings = Record<string, Record<string, string>>;

/** What the Plugins tab edits of a profile. */
export interface ProfilePlugins {
  pluginSettings: ProfilePluginSettings;
  pluginsOff: string[];
}

/** A plugin as the Plugins tab lists it: one a profile can turn off, one with settings of its own for each profile, or both. */
export interface PluginRow {
  plugin: string;
  title: string;
  /** The plugin's icon as an svg document, or null for none. */
  icon: string | null;
  /** What the plugin does, in a line, or null for none. */
  tagline: string | null;
  tools: string[];
  switchable: boolean;
  settings: PluginProfileSetting[];
  /** The toggle the row's switch sets, when the plugin makes one its switch; else the switch turns the plugin off for the profile. */
  pluginSwitch: PluginToggleProfileSetting | null;
  checksProfile: boolean;
}

/** Every plugin a profile can turn off or set something for, by title. */
export function pluginRows(conversationPlugins: ConversationPlugin[], pluginSettings: PluginSettings[], titles: Record<string, string>, looks: Record<string, PluginLook>): PluginRow[] {
  const withProfileSettings = pluginSettings.filter(({ profileSettings = [] }) => profileSettings.length > 0);
  const names = [...new Set([...conversationPlugins.map(({ plugin }) => plugin), ...withProfileSettings.map(({ plugin }) => plugin)])];
  return names
    .map((plugin) => {
      const acting = conversationPlugins.find((each) => each.plugin === plugin);
      const configured = withProfileSettings.find((each) => each.plugin === plugin);
      const pluginSwitch = switchOf(configured?.profileSettings) ?? null;
      return {
        plugin,
        title: acting?.title ?? titles[plugin] ?? plugin,
        icon: looks[plugin]?.icon ?? null,
        tagline: looks[plugin]?.tagline ?? null,
        tools: acting?.tools ?? [],
        switchable: acting !== undefined || pluginSwitch !== null,
        settings: configured?.profileSettings ?? [],
        pluginSwitch,
        checksProfile: configured?.checksProfile === true,
      };
    })
    .sort((one, other) => one.title.localeCompare(other.title));
}

export const isOn = (row: PluginRow, profile: ProfilePlugins) =>
  !row.switchable || !pluginsOffFor(profile, [{ plugin: row.plugin, profileSettings: row.settings }]).includes(row.plugin);

const isSwitch = (setting: PluginProfileSetting) => setting.kind === "toggle" && setting.switchesPlugin === true;

/** Whether the plugin has settings of its own for each profile, besides its switch. */
export const hasOwnSettings = (row: PluginRow) => row.settings.some((setting) => !isSwitch(setting));

/** Whether the row has anything to show when opened: settings of its own, or tools to list. */
export const opens = (row: PluginRow) => hasOwnSettings(row) || row.tools.length > 0;

/** The settings shown under the row: those that hang off no toggle, and those whose toggle is on; never the plugin's switch, which is the row's. */
export const shownSettings = (settings: PluginProfileSetting[], valueOf: (setting: PluginProfileSetting) => string) =>
  settings.filter(({ shownWhen }) => shownWhen === undefined || settings.some((each) => each.id === shownWhen && valueOf(each) === "on")).filter((setting) => !isSwitch(setting));

/** Whether every setting but the plugin's switch is shown, no toggle hiding any. */
export const showsEverySetting = (settings: PluginProfileSetting[], valueOf: (setting: PluginProfileSetting) => string) =>
  shownSettings(settings, valueOf).length === settings.filter((setting) => !isSwitch(setting)).length;

/** The settings in the order shown, toggles next to each other gathered into one group, every other setting a group of its own. */
export const groupedToggles = (settings: PluginProfileSetting[]) =>
  settings.reduce<PluginProfileSetting[][]>((groups, setting) => {
    const last = groups.at(-1);
    return setting.kind === "toggle" && last?.[0]?.kind === "toggle" ? [...groups.slice(0, -1), [...last, setting]] : [...groups, [setting]];
  }, []);

export function matchesSearch(row: PluginRow, query: string) {
  const wanted = query.trim().toLocaleLowerCase();
  return wanted === "" || [row.title, ...row.settings.map(({ label }) => label), ...row.tools].some((text) => text.toLocaleLowerCase().includes(wanted));
}

/** A variable of the profile's environment a typed setting reads, and whether its Launch environment sets it, unsets it, or leaves it to Mirador's own. */
export interface LaunchVariable {
  name: string;
  state: "set" | "unset" | "missing";
  value: string;
}

export function launchVariableOf(setting: PluginTextProfileSetting, value: string, environment: string): LaunchVariable | null {
  const name = variableReadBy(setting, value);
  if (name === undefined) return null;
  const { set, unset } = parseEnvironment(environment);
  if (name in set) return { name, state: "set", value: set[name]! };
  return { name, state: unset.includes(name) ? "unset" : "missing", value: "" };
}

/** The typed settings the plugin needs that an on row shows empty: typed empty, or reading a variable the Launch environment doesn't set. */
export function missingSettings(row: PluginRow, profile: ProfilePlugins & { environment: string }): PluginTextProfileSetting[] {
  if (!isOn(row, profile)) return [];
  const valueOf = (setting: PluginProfileSetting) => profileSettingValue(profile.pluginSettings, row.plugin, setting);
  return shownSettings(row.settings, valueOf)
    .filter(isTextSetting)
    .filter(({ required }) => required === true)
    .filter((setting) => readsEmpty(setting, valueOf(setting), profile.environment));
}

/** Whether a typed setting gives its plugin nothing: its own text empty, or the variable it reads not set by the Launch environment. */
export function readsEmpty(setting: PluginTextProfileSetting, value: string, environment: string) {
  const variable = launchVariableOf(setting, value, environment);
  return (variable ? variable.value : value).trim() === "";
}

export const needsSetup = (row: PluginRow, profile: ProfilePlugins & { environment: string }) => missingSettings(row, profile).length > 0;

/** A choice as its menu names it, without asking an agent for its models: a model the profile chose shows by its id. */
export function choiceLabelOf(setting: PluginChoiceProfileSetting, value: string, profiles: Profile[]) {
  if (setting.choices === "profiles") return profiles.find(({ id }) => id === value)?.name ?? t.plugins.none;
  if (Array.isArray(setting.choices)) return setting.choices.find((choice) => choice.value === value)?.label ?? value;
  return value || t.profiles.agentsDefault;
}

/** A row's one line while closed: off, else what it needs filled in, else what its shown settings hold (a secret never), else what it does or how many tools it gives. */
export function summaryOf(row: PluginRow, profile: ProfilePlugins & { environment: string }, profiles: Profile[]) {
  if (!isOn(row, profile)) return words.off;
  const missing = missingSettings(row, profile);
  if (missing.length > 0) return words.fillIn(formatList(missing.map(({ label }) => label)));
  const valueOf = (setting: PluginProfileSetting) => profileSettingValue(profile.pluginSettings, row.plugin, setting);
  const shown = shownSettings(row.settings, valueOf);
  const valued = shown.flatMap((setting) => {
    if (setting.kind === "toggle" || setting.kind === "secret") return [];
    if (!isTextSetting(setting)) return [words.settingIs(setting.label, choiceLabelOf(setting, valueOf(setting), profiles))];
    const variable = launchVariableOf(setting, valueOf(setting), profile.environment);
    return [words.settingIs(setting.label, (variable ? variable.value : valueOf(setting).trim()) || words.notSet)];
  });
  const toggles = shown.filter(({ kind }) => kind === "toggle");
  const togglesOn = toggles.filter((toggle) => valueOf(toggle) === "on").length;
  const toggled =
    toggles.length === 1 ? [words.settingIs(toggles[0]!.label, togglesOn === 1 ? words.on : words.offValue)] : toggles.length > 1 ? [words.togglesOn(togglesOn, toggles.length)] : [];
  const parts = [...valued, ...toggled];
  if (parts.length > 0) return parts.join(" · ");
  return row.tagline ?? (row.tools.length > 0 ? words.tools(row.tools.length) : words.nothingToSet);
}

/** Whether a plugin's row holds what isn't saved: turned on or off, or a setting that reads otherwise, a default written out reading as the default. */
export const rowDiffers = (row: PluginRow, profile: ProfilePlugins, saved: ProfilePlugins) =>
  isOn(row, profile) !== isOn(row, saved) ||
  row.settings.some((setting) => profileSettingValue(profile.pluginSettings, row.plugin, setting) !== profileSettingValue(saved.pluginSettings, row.plugin, setting));

/** Whether two profiles' plugin settings read otherwise for any plugin; a setting set to its default reads as one not set. */
export const pluginSettingsDiffer = (one: ProfilePluginSettings, other: ProfilePluginSettings, pluginSettings: PluginSettings[]) =>
  pluginSettings.some(({ plugin, profileSettings = [] }) => profileSettings.some((setting) => profileSettingValue(one, plugin, setting) !== profileSettingValue(other, plugin, setting)));
