import { createHash } from "node:crypto";
import { existsSync, readdirSync, watch } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { APP_PLUGIN_API, CANVAS_PLUGIN_API, PLUGIN_WINDOW_API, PROFILE_SETTINGS_PLUGIN_API, isPluginManifest, type AppHost, type AppTask, type InstalledApp, type PluginManifest, type PluginSetting } from "../../shared/apps.ts";
import { itemRooms, pluginItemPlacements, type CanvasHost } from "../../shared/canvas-plugins.ts";
import { BUILT_IN_CANVAS_TOOLS } from "../canvas/tool-names.ts";
import { HostProblemError, type HostProblem } from "../../shared/host-problems.ts";

/** Held in memory, so the code served under a hash is always the code that hash was made from. */
export interface ViewCode {
  code: Uint8Array<ArrayBuffer>;
  hash: string;
}

interface LoadedPlugin {
  manifest: PluginManifest;
  folder: string;
}

/** A plugin's app part. */
export interface AppPlugin extends LoadedPlugin {
  host: AppHost;
  view: ViewCode;
}

/** A plugin's canvas part. */
export interface CanvasPlugin extends LoadedPlugin {
  host: CanvasHost;
  view: ViewCode;
}

export interface PluginLoadProblem {
  folder: string;
  message: string;
  messageAbout?: HostProblem;
}

/** Thrown with a message for whoever asked: the agent as a tool error, or the user. */
export class AppProblem extends Error {}

export const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

const HOST_FUNCTIONS = ["parse", "serialize", "apply", "describe"] as const;

const TOOL_NAME = /^[a-z][a-z0-9_]*$/;

export const appViewPath = (plugin: AppPlugin) => `/apps/${plugin.manifest.name}/${plugin.view.hash}/view.js`;

export const canvasViewPath = (plugin: CanvasPlugin) => `/apps/${plugin.manifest.name}/${plugin.view.hash}/canvas.js`;

export const installedApp = (plugin: AppPlugin): InstalledApp => ({
  name: plugin.manifest.name,
  title: plugin.manifest.title,
  viewPath: appViewPath(plugin),
});

/** The folders, or links to folders, in `pluginsFolder` that hold a plugin.json. */
export function pluginFolders(pluginsFolder: string): string[] {
  if (!existsSync(pluginsFolder)) return [];
  return readdirSync(pluginsFolder, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .map((entry) => join(pluginsFolder, entry.name))
    .filter((folder) => existsSync(join(folder, "plugin.json")))
    .sort();
}

export interface LoadedPlugins {
  apps: AppPlugin[];
  canvases: CanvasPlugin[];
  problems: PluginLoadProblem[];
}

/** Every folder in `pluginsFolder` with a plugin.json; one that fails to load is reported and the rest still load. */
export async function loadPlugins(pluginsFolder: string): Promise<LoadedPlugins> {
  const loaded: LoadedPlugins = { apps: [], canvases: [], problems: [] };
  const names = new Map<string, LoadedPlugin>();
  for (const folder of pluginFolders(pluginsFolder)) {
    try {
      const { app, canvas } = await loadPlugin(folder);
      const { name } = (app ?? canvas)!.manifest;
      if (names.has(name)) throw new HostProblemError({ code: "plugin-name-already-used", name });
      if (canvas) refuseTakenToolNames(canvas, loaded.canvases);
      names.set(name, (app ?? canvas)!);
      if (app) loaded.apps.push(app);
      if (canvas) loaded.canvases.push(canvas);
    } catch (error) {
      loaded.problems.push({ folder, message: messageOf(error), ...(error instanceof HostProblemError && { messageAbout: error.problem }) });
    }
  }
  return loaded;
}

function refuseTakenToolNames(plugin: CanvasPlugin, loadedBefore: CanvasPlugin[]) {
  for (const tool of Object.keys(plugin.host.tools)) {
    if (BUILT_IN_CANVAS_TOOLS.includes(tool)) throw new HostProblemError({ code: "plugin-tool-name-reserved", tool });
    const other = loadedBefore.find(({ host }) => Object.hasOwn(host.tools, tool));
    if (other) throw new HostProblemError({ code: "plugin-tool-name-taken", tool, plugin: other.manifest.name });
  }
}

/** The folder's plugin.json, held to what this Mirador loads; throws what is wrong with it. */
export async function readManifest(folder: string): Promise<PluginManifest> {
  const file = join(folder, "plugin.json");
  if (!existsSync(file)) throw new HostProblemError({ code: "plugin-json-missing" });
  const manifest: unknown = await Bun.file(file).json();
  if (!isPluginManifest(manifest)) {
    throw new HostProblemError({ code: "plugin-json-invalid" });
  }
  if (!Number.isInteger(manifest.api) || manifest.api < 1 || manifest.api > APP_PLUGIN_API) {
    throw new HostProblemError({ code: "plugin-api-too-new", api: manifest.api, newest: APP_PLUGIN_API });
  }
  if (manifest.canvas && manifest.api < CANVAS_PLUGIN_API) throw new HostProblemError({ code: "plugin-canvas-needs-newer-api", brought: CANVAS_PLUGIN_API, named: manifest.api });
  if (manifest.profileSettings && manifest.api < PROFILE_SETTINGS_PLUGIN_API) {
    throw new HostProblemError({ code: "plugin-profile-settings-needs-newer-api", brought: PROFILE_SETTINGS_PLUGIN_API, named: manifest.api });
  }
  return manifest;
}

/** The host and view files plugin.json names, by part; throws when one is missing or outside the folder. */
export function pluginFiles(folder: string, { app, canvas }: PluginManifest) {
  const filesOf = (part: { host: string; view: string }) => ({ hostFile: insideFolder(folder, part.host), viewFile: insideFolder(folder, part.view) });
  return { app: app && filesOf(app), canvas: canvas && filesOf(canvas) };
}

/** Every plugin gives its release. */
export function refuseUnversioned(manifest: PluginManifest) {
  if (manifest.version === undefined) throw new HostProblemError({ code: "plugin-needs-version" });
}

async function loadPlugin(folder: string): Promise<{ app: AppPlugin | null; canvas: CanvasPlugin | null }> {
  const manifest = await readManifest(folder);
  refuseUnversioned(manifest);
  const files = pluginFiles(folder, manifest);
  const loaded = { manifest, folder };
  return {
    app: files.app ? { ...loaded, host: hostFrom(await import(files.app.hostFile)), view: await viewCode(files.app.viewFile) } : null,
    canvas: files.canvas ? { ...loaded, host: canvasHostFrom(await import(files.canvas.hostFile), manifest), view: await viewCode(files.canvas.viewFile) } : null,
  };
}

const VIEW_SETTLES_MS = 100;

/**
 * Follows the plugins' views: a view built again is read again under its new hash, and `onChange` hears of it, for the
 * pages to load it. Each view's folder is watched rather than the file, which a build may replace. Returns the function
 * that stops it.
 */
export function watchViews({ apps, canvases }: Pick<LoadedPlugins, "apps" | "canvases">, onChange: () => void): () => void {
  const views = [
    ...apps.map((plugin) => ({ plugin, viewFile: pluginFiles(plugin.folder, plugin.manifest).app!.viewFile })),
    ...canvases.map((plugin) => ({ plugin, viewFile: pluginFiles(plugin.folder, plugin.manifest).canvas!.viewFile })),
  ];
  const timers = new Set<Timer>();
  const watchers = views.map(({ plugin, viewFile }) => {
    let settling: Timer | undefined;
    const readAgain = async () => {
      timers.delete(settling!);
      const view = await viewCode(viewFile).catch(() => null);
      if (!view || view.hash === plugin.view.hash) return;
      plugin.view = view;
      onChange();
    };
    const settle = (_event: string, file: string | null) => {
      if (file !== basename(viewFile)) return;
      clearTimeout(settling);
      timers.delete(settling!);
      settling = setTimeout(readAgain, VIEW_SETTLES_MS);
      timers.add(settling);
    };
    try {
      return watch(dirname(viewFile), settle);
    } catch (error) {
      console.warn(`A new build of ${viewFile} shows only after a restart: ${messageOf(error)}`);
      return null;
    }
  });
  return () => {
    for (const watcher of watchers) watcher?.close();
    for (const timer of timers) clearTimeout(timer);
  };
}

async function viewCode(viewFile: string): Promise<ViewCode> {
  const code = await Bun.file(viewFile).bytes();
  return { code, hash: createHash("sha256").update(code).digest("hex").slice(0, 16) };
}

function insideFolder(folder: string, relativePath: string) {
  const file = resolve(folder, relativePath);
  if (!file.startsWith(resolve(folder) + sep)) throw new HostProblemError({ code: "plugin-file-outside-folder", path: relativePath });
  if (!existsSync(file)) throw new HostProblemError({ code: "plugin-file-missing", path: relativePath });
  return file;
}

const exportsOf = (module: Record<string, unknown>) => (typeof module.default === "object" && module.default !== null ? module.default : module) as Record<string, unknown>;

function hostFrom(module: Record<string, unknown>): AppHost {
  const host = exportsOf(module);
  const missing = HOST_FUNCTIONS.filter((name) => typeof host[name] !== "function");
  if (missing.length > 0) throw new HostProblemError({ code: "plugin-host-module-missing-exports", names: missing.join(", ") });
  const unusableTasks = Object.entries((host.tasks ?? {}) as Record<string, Partial<AppTask> | null>)
    .filter(([, task]) => typeof task?.title !== "string" || typeof task.run !== "function")
    .map(([name]) => name);
  if (unusableTasks.length > 0) throw new HostProblemError({ code: "plugin-tasks-unusable", tasks: unusableTasks.join(", ") });
  return host as unknown as AppHost;
}

const isFunction = (value: unknown) => typeof value === "function";
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/** One of the plugin's settings whose choices are exactly the rooms an item opens in. */
const isRoomSetting = (settings: PluginSetting[], id: unknown) => {
  const values = settings.find((setting) => setting.id === id)?.choices.map(({ value }) => value);
  return values !== undefined && values.length === itemRooms.length && itemRooms.every((room) => values.includes(room));
};

function canvasHostFrom(module: Record<string, unknown>, { api, settings = [] }: PluginManifest): CanvasHost {
  const host = exportsOf(module);
  const problems: string[] = [];
  if (!isObject(host.items)) problems.push("items, by name");
  if (!isObject(host.tools)) problems.push("tools, by name");
  const items = isObject(host.items) ? host.items : {};
  const tools = isObject(host.tools) ? host.tools : {};
  for (const [name, item] of Object.entries(items)) {
    const { icon, placement, opensWithRoom, ...functions } = (isObject(item) ? item : {}) as Record<string, unknown>;
    const optionalFunctions = (["count", "outcome", "listed"] as const).map((key) => functions[key]);
    if (typeof icon !== "string" || !pluginItemPlacements.includes(placement as never) || optionalFunctions.some((value) => value !== undefined && !isFunction(value))) {
      problems.push(`items.${name} with an icon, a placement of ${pluginItemPlacements.join(" or ")}, and count, outcome and listed only as functions`);
    }
    const namesRoomSetting = isObject(opensWithRoom) && isRoomSetting(settings, opensWithRoom.setting);
    if (opensWithRoom !== undefined && typeof opensWithRoom !== "boolean" && !namesRoomSetting) {
      problems.push(`items.${name} with opensWithRoom only as true or false, or as { setting } naming a setting of plugin.json whose choices are ${itemRooms.join(" and ")}`);
    }
  }
  for (const [name, tool] of Object.entries(tools)) {
    const { description, input, run } = (isObject(tool) ? tool : {}) as Record<string, unknown>;
    if (!TOOL_NAME.test(name)) problems.push(`tools named in lower case, digits and underscores, not ${name}`);
    if (typeof description !== "string" || !isObject(input) || !isFunction(run)) problems.push(`tools.${name} with a description, an input schema and a run function`);
  }
  if (host.action !== undefined && !isFunction(host.action)) problems.push("action only as a function");
  if (host.note !== undefined && !isFunction(host.note)) problems.push("note only as a function");
  if (host.activity !== undefined && !isFunction(host.activity)) problems.push("activity only as a function");
  const window = host.window as Record<string, unknown> | undefined;
  if (window !== undefined && !(isObject(window) && isFunction(window.state) && (window.action === undefined || isFunction(window.action)))) {
    problems.push("window only as { state, action } with state a function and action, if any, one too");
  }
  if ((host.activity !== undefined || window !== undefined) && api < PLUGIN_WINDOW_API) {
    throw new Error(`the canvas host module has a window or hears activity, which plugin API ${PLUGIN_WINDOW_API} brought; plugin.json names API ${api}`);
  }
  if (problems.length > 0) throw new Error(`the canvas host module needs ${problems.join("; ")}`);
  return host as unknown as CanvasHost;
}
