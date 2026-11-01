import { existsSync } from "node:fs";
import { basename } from "node:path";
import type { Store } from "../store.ts";
import type { InstalledPlugins } from "./installed-plugins.ts";
import { messageOf } from "./plugins.ts";

/** A plugin Mirador installs by itself, at the release Mirador names. */
export interface DefaultPlugin {
  name: string;
  repo: string;
  tag: string;
}

function isDefaultPlugin(value: unknown): value is DefaultPlugin {
  const { name, repo, tag } = (value ?? {}) as Partial<DefaultPlugin>;
  return [name, repo, tag].every((text) => typeof text === "string" && text !== "");
}

export async function defaultPluginsIn(file: string): Promise<DefaultPlugin[]> {
  if (!existsSync(file)) return [];
  const { plugins } = (await Bun.file(file).json()) as { plugins?: unknown };
  return Array.isArray(plugins) ? plugins.filter(isDefaultPlugin) : [];
}

/**
 * Installs each default plugin Mirador hasn't installed before, so one the user removed stays removed. One that fails,
 * offline say, is tried again at the next start; one already in the plugins folder counts as installed.
 */
export async function installDefaultPlugins(defaults: DefaultPlugin[], plugins: InstalledPlugins, store: Store) {
  const installedBefore = new Set(store.defaultPluginsInstalled());
  const installedFolders = new Set((await plugins.list()).flatMap(({ folder, name }) => [folder, name ?? folder]));
  for (const plugin of defaults.filter(({ name }) => !installedBefore.has(name))) {
    try {
      if (!installedFolders.has(plugin.name)) await plugins.add(plugin.repo, plugin.tag);
      store.rememberDefaultPluginInstalled(plugin.name);
    } catch (error) {
      console.warn(`the ${plugin.name} plugin, which Mirador installs by itself, didn't install from ${basename(plugin.repo)}: ${messageOf(error)}`);
    }
  }
}
