import type { PluginInfo } from "../../shared/apps.ts";
import type { FilePlugin, PluginToInstall } from "../../shared/settings-file.ts";
import type { PluginSettingsStore } from "../plugin-settings.ts";
import type { ImportContext, ImportStep } from "./import-step.ts";

export interface PluginWriters {
  settings: PluginSettingsStore;
  /** Says so on every page. */
  settingsChanged(): void;
  updatesByItself(folder: string, updatesByItself: boolean): Promise<void>;
}

const installedAs = (installed: PluginInfo[], name: string) => installed.find((plugin) => plugin.name === name);

/** The plugins of the file that aren't here; the user agrees to each before any of its code is here. */
export function pluginsToInstall(entries: FilePlugin[], installed: PluginInfo[], { problems }: ImportContext): PluginToInstall[] {
  return entries
    .filter(({ name }) => !installedAs(installed, name))
    .flatMap(({ name, repository, branch, release, commit }) => {
      if (repository) return [{ name, repository, branch: branch ?? null, release: release ?? null, commit: commit ?? null }];
      problems.push({ code: "settings-plugin-not-portable", plugin: name });
      return [];
    });
}

/** A plugin not installed yet has its settings from its first start on. */
export function pluginSettingsSteps(entries: FilePlugin[], installed: PluginInfo[], { store }: ImportContext, writers: PluginWriters): ImportStep[] {
  const chosenHere = store.listPluginSettings();
  const updatesHere = store.pluginUpdatesByItself();
  return entries
    .filter(({ settings, updatesByItself }) => updatesByItself !== undefined || Object.keys(settings ?? {}).length > 0)
    .map(({ name, settings = {}, updatesByItself }) => {
      const plugin = installedAs(installed, name);
      const folder = plugin?.folder ?? name;
      const here = chosenHere[name] ?? {};
      const differingUpdates = updatesByItself !== undefined && updatesByItself !== updatesHere[folder];
      const differs = [...Object.keys(settings).filter((id) => settings[id] !== here[id]), ...(differingUpdates ? ["updatesByItself"] : [])];
      const overwrites = differs.some((field) => (field === "updatesByItself" ? updatesHere[folder] !== undefined : here[field] !== undefined));
      return {
        item: { id: `plugin-settings ${name}`, kind: "plugin-settings", name, state: differs.length === 0 ? "same" : overwrites ? "different" : "new", differs, needs: [] },
        bringIn: async () => {
          const isLoaded = writers.settings.all().some((each) => each.plugin === name);
          Object.entries(settings).forEach(([id, value]) => (isLoaded ? writers.settings.choose(name, id, value) : store.savePluginSetting(name, id, value)));
          writers.settingsChanged();
          if (!differingUpdates) return;
          if (plugin) await writers.updatesByItself(folder, updatesByItself);
          else store.setPluginUpdatesByItself(folder, updatesByItself);
        },
      };
    });
}
