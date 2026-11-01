/**
 * The plugin API version this Mirador speaks; a plugin.json names the one it was written for, and Mirador loads every
 * version up to its own. API 2 brought host tasks, streamed files and images in a view's message; API 3 brought canvas
 * tools and items; API 4 tells apply who made the change; API 5 lets a canvas tool message its agent and start a
 * conversation on another profile, and brings profile settings; API 6 brings a canvas plugin's own window and the
 * conversations' activity.
 */
export const APP_PLUGIN_API = 6;

/** The first plugin API whose plugin.json may have a canvas part. */
export const CANVAS_PLUGIN_API = 3;

/** The first plugin API whose plugin.json may have profile settings. */
export const PROFILE_SETTINGS_PLUGIN_API = 5;

/** The first plugin API whose canvas host may have a window and hear activity. */
export const PLUGIN_WINDOW_API = 6;

/**
 * A plugin's plugin.json. A plugin brings an app, a document that the agent and the user change together; canvas tools
 * and the items they show; or both.
 */
export interface PluginManifest {
  name: string;
  title: string;
  /**
   * The plugin's release as x.y.z, which its repo tags v<version>; required of every plugin but those that come with
   * Mirador, which carry Mirador's version.
   */
  version?: string;
  api: number;
  app?: {
    /** The module, relative to the plugin's folder, whose exports are the plugin's AppHost. */
    host: string;
    /** One ES module, relative to the plugin's folder, that draws the app in a canvas frame with `window.mirador`. */
    view: string;
  };
  canvas?: {
    /** The module, relative to the plugin's folder, whose exports are the plugin's CanvasHost; it may be the app's host module too. */
    host: string;
    /** One ES module, relative to the plugin's folder, that draws the plugin's canvas items in a canvas frame with `window.mirador`. */
    view: string;
  };
  /**
   * A shell command that builds the plugin in its folder, e.g. "bun install && bun run build". Mirador runs it after
   * cloning the plugin's repo and after each update, with the Bun it runs on first on the PATH.
   */
  build?: string;
  /** What the user can set for the plugin, listed under it in Settings. */
  settings?: PluginSetting[];
  /** What the user can set for the plugin per profile, in the Profiles dialog; plugin API 5 brought them. */
  profileSettings?: PluginProfileSetting[];
}

/**
 * What a plugin's host code exports. Mirador calls it in its own process: every call is guarded, and an error a call
 * throws is shown to whoever made the change, so its message should say what is wrong and what would work.
 */
export interface AppHost<Document = unknown> {
  /** Reads the document's file, bringing an older format up to date. */
  parse(text: string): Document;
  serialize(document: Document): string;
  /**
   * Applies one operation, made by the author, so a plugin can keep an operation for the user alone. The inverse is the
   * operation that undoes it; touched names what it changed, for the view to show.
   */
  apply(document: Document, operation: unknown, author: AppAuthor): { document: Document; inverse: unknown; summary: string; touched?: string[] };
  /** The document in words, for the agent. */
  describe(document: Document): string;
  /**
   * The document for a file the app edits rather than one of its own, both relative to the workspace, as a video editor keeps
   * clip.media.json for clip.mp4; null for the app's own document. With it, app_open takes the edited file itself.
   */
  documentFor?(file: string): string | null;
  /** A new document, for opening the app on a file that doesn't exist yet; `openedFile`, relative to the document's folder, is the file app_open was given for it through documentFor. */
  create?(openedFile?: string): Document;
  /** Longer work than an operation, such as rendering a video, by name: the agent runs one with app_run, the view with `mirador.run`. */
  tasks?: Record<string, AppTask<Document>>;
}

/** Runs outside the queue of operations, one task at a time for each document; whatever it throws is its problem, shown to whoever ran it. */
export interface AppTask<Document = unknown> {
  /** What it does, in a few words, for the agent and the view. */
  title: string;
  /** Resolves to a summary of what it did, for whoever ran it. */
  run(context: AppTaskContext<Document>): Promise<string>;
}

export interface AppTaskContext<Document = unknown> {
  /** The document as it was when the task started. */
  document: Document;
  /** The absolute path of a file in the folder of the document, or below it, which may not exist yet; a path that leads out of the folder throws. */
  file(path: string): string;
  documentFolder: string;
  workspaceFolder: string;
  pluginFolder: string;
  /** Who ran the task, for the operations it applies. */
  author: AppAuthor;
  /** Applies an operation as `apply` does, in turn with the others, as made by whoever ran the task. */
  apply(operation: unknown): Promise<AppChange>;
  /** How far along it is, from 0 to 1, or null when it can't tell; the views show it. */
  progress(done: number | null, text?: string): void;
  /** Aborted when the user stops the task, the app closes or Mirador stops. */
  signal: AbortSignal;
}

/** The latest task run on a document, as its views show it. */
export interface AppTaskState {
  name: string;
  title: string;
  runId: number;
  state: "running" | "done" | "failed" | "stopped";
  author: AppAuthor;
  done: number | null;
  text: string | null;
  /** What the task said it did, once done. */
  summary: string | null;
  problem: string | null;
  startedAt: number;
  endedAt: number | null;
}

export type AppAuthor =
  | { kind: "agent"; conversationId: string; turnSeq: number | null }
  | { kind: "you" }
  | { kind: "outside" };

export interface AppChange {
  seq: number;
  author: AppAuthor;
  summary: string;
  touched: string[];
  at: number;
}

/** An app the owner installed, and where its view's code is served on the canvas assets origin. */
export interface InstalledApp {
  name: string;
  title: string;
  viewPath: string;
}

/** An app open in a workspace, on one file of it. */
export interface OpenApp {
  workspaceId: string;
  app: string;
  title: string;
  file: string;
  /** The conversations whose agent used the app, or whose user added it; its tab shows only in those. */
  conversationIds: string[];
  /** The agent that last opened the app with app_open or ran one of its tasks with app_run, whose canvas brings its tab forward, even on the file already open. Missing from older hosts, and until an agent does either in this run of the host. */
  shownBy?: AppShownBy;
}

export interface AppShownBy {
  conversationId: string;
  at: number;
}

/** What a view shows: sent to the pages that have the app open, on every change. */
export interface AppDocumentState {
  workspaceId: string;
  app: string;
  document: unknown;
  lastChange: AppChange | null;
  /** Why the file's content isn't shown: it stopped parsing after an edit made outside Mirador. */
  problem: string | null;
  task: AppTaskState | null;
}

/**
 * Where a plugin's folder came from: a git clone (its remote shown without credentials), a
 * link to a folder elsewhere, or a plain folder. A clone follows its branch, or, when it was cloned at a release's tag,
 * the releases.
 */
export type PluginSource =
  | { kind: "git"; remote: string | null; branch: string | null; release: string | null; commit: string; subject: string }
  | { kind: "linked"; target: string }
  | { kind: "folder" };

/** A folder in the plugins folder that holds a plugin.json, as the Plugins settings list it. */
export interface PluginInfo {
  folder: string;
  /** From its plugin.json, while that can be read. */
  name: string | null;
  title: string | null;
  version: string | null;
  source: PluginSource;
  /** Why it didn't load when Mirador started; null when it did. */
  problem: string | null;
  /** Added or updated since Mirador started, which loads it as it is now only at its next start. */
  waitsForRestart: boolean;
  /** What its plugin.json brings; missing from a host older than it. */
  kinds?: PluginKind[];
  /** The canvas tools it gave the agent when Mirador started; none while it waits for a restart. Missing from a host older than it. */
  tools?: PluginTool[];
}

export type PluginKind = "app" | "canvas";

export interface PluginTool {
  name: string;
  description: string;
}

/** An official plugin, as the catalog of Mirador's plugins lists it. */
export interface CatalogPlugin {
  name: string;
  title: string;
  description: string;
  /** When an agent should offer it, completing "Recommend it when …". */
  recommendWhen: string;
  /** What git clones, which the catalog's README asks to be an https URL anyone can clone. */
  repo: string;
  branch?: string;
}

function isCatalogPlugin(value: unknown): value is CatalogPlugin {
  if (typeof value !== "object" || value === null) return false;
  const { name, title, description, recommendWhen, repo, branch } = value as Partial<CatalogPlugin>;
  return (
    typeof name === "string" &&
    /^[a-z0-9][a-z0-9-]*$/.test(name) &&
    [title, description, recommendWhen].every((text) => typeof text === "string" && text !== "") &&
    typeof repo === "string" &&
    repo !== "" &&
    (branch === undefined || typeof branch === "string")
  );
}

/** The catalog's plugins, leaving out entries this Mirador can't read, as a newer catalog may have. */
export function catalogPluginsOf(catalog: unknown): CatalogPlugin[] | null {
  const plugins = (catalog as { plugins?: unknown } | null)?.plugins;
  return Array.isArray(plugins) ? plugins.filter(isCatalogPlugin) : null;
}

/** A commit an update would bring. */
export interface PluginCommit {
  commit: string;
  subject: string;
}

/** What updating a plugin would bring: a newer release, for a plugin that follows releases, and its commits, newest first. */
export interface PluginNews {
  release: string | null;
  commits: PluginCommit[];
}

/**
 * A plugin's repo, cloned but not built, for the user to agree to before any of its code runs: what installing it, or
 * updating to it, brings. Only the user's consent builds and installs it, by its id.
 */
export interface PluginOffer {
  id: string;
  name: string;
  title: string;
  version: string;
  /** Shown without credentials. */
  remote: string;
  branch: string | null;
  release: string | null;
  commit: string;
  subject: string;
  /** Runs as soon as the user agrees, with their permissions. */
  build: string | null;
  /** The modules that run inside Mirador with the user's permissions, by the part they serve. */
  hostCode: { part: "app" | "canvas"; file: string }[];
  /** For an update: the plugin's folder, and the commits it doesn't have yet, newest first. */
  replaces: { folder: string; commits: PluginCommit[] } | null;
}

/** Where the offer's code comes from: its repo, release or branch, and commit. */
export const offerSource = ({ remote, release, branch, commit, subject }: PluginOffer) =>
  [remote, release ? `release ${release}` : (branch ?? "default branch"), `${commit.slice(0, 12)} ${subject}`].join(" · ");

/** What of the offer's code runs, and when, a sentence each. */
export const offerRuns = ({ build, hostCode }: PluginOffer) => [
  build ? `Its build command, ${build}, runs as soon as you agree, with your permissions.` : "It has no build command.",
  ...hostCode.map(({ part, file }) => `${file}, the host code of its ${part === "app" ? "app" : "canvas tools"}, runs inside Mirador with your permissions from its next start.`),
];

/** A plugin from a git repo with news, as Mirador found by itself. */
export interface PluginUpdate extends PluginNews {
  folder: string;
  title: string;
  /** The plugin's commit when it was found: once it is updated past it, this is no longer news. */
  from: string;
}

/** What an app's view keeps in a workspace, as its localStorage: text by key. */
export type AppStorageItems = Record<string, string>;

/** How much an app's view may keep in a workspace, counted as localStorage counts it: the characters of its keys and values. */
export const APP_STORAGE_CHARACTERS = 1024 * 1024;

export const storageCharacters = (items: AppStorageItems) => Object.entries(items).reduce((sum, [key, value]) => sum + key.length + value.length, 0);

export const appKey = ({ workspaceId, app }: { workspaceId: string; app: string }) => `${workspaceId}/${app}`;

/** Where the host serves a file next to the app's document to signed-in pages and devices, `path` named from the document's folder. */
export const appFileUrl = ({ workspaceId, app }: { workspaceId: string; app: string }, path: string) =>
  `/workspaces/${encodeURIComponent(workspaceId)}/apps/${encodeURIComponent(app)}/file?path=${encodeURIComponent(path)}`;

/** Where signed-in pages and devices ask for an address the view can stream a file next to the app's document from; POST, answered with an AppMediaGrant. */
export const appMediaGrantUrl = ({ workspaceId, app }: { workspaceId: string; app: string }, path: string) =>
  `/workspaces/${encodeURIComponent(workspaceId)}/apps/${encodeURIComponent(app)}/media?path=${encodeURIComponent(path)}`;

/** Where the canvas assets serve streamed files, so the canvas pages' policy lets media and images load from there. */
export const APP_MEDIA_PATH = "/media/";

/** The path on the canvas assets an app's view streams one file from, in ranges, for as long as the app stays open. */
export interface AppMediaGrant {
  path: string;
}

/** How many images one message from an app's view may carry. */
export const MAX_APP_PROMPT_IMAGES = 4;

/** The user's message from an app's view: it names the app and its file, so the agent knows what it is about. */
export function appPromptText({ title, file }: OpenApp, text: string) {
  return `About ${file}, open in ${title} (app_state reads it, apply changes it):\n\n${text.trim()}`;
}

const isHostAndView = (part: unknown) =>
  typeof part === "object" && part !== null && typeof (part as { host?: unknown }).host === "string" && typeof (part as { view?: unknown }).view === "string";

/** A setting a plugin declares in its plugin.json: one of a few choices, stored by Mirador and the same in every browser. */
export interface PluginSetting {
  id: string;
  label: string;
  /** A sentence on what it does, its tooltip in Settings. */
  hint?: string;
  choices: { value: string; label: string }[];
  default: string;
}

/**
 * What a profile can set for a plugin: one of its choices, or, with `choices: "profiles"`, another profile by its id, or
 * none as "", which is then the default.
 */
export interface PluginProfileSetting {
  id: string;
  label: string;
  /** A sentence on what it does, its tooltip in the Profiles dialog. */
  hint?: string;
  choices: { value: string; label: string }[] | "profiles";
  default: string;
}

/** A loaded plugin's settings, with the values the user chose; a setting not chosen yet has its default. */
export interface PluginSettings {
  plugin: string;
  settings: PluginSetting[];
  chosen: Record<string, string>;
  /** Kept with each profile, as its `pluginSettings`. */
  profileSettings?: PluginProfileSetting[];
}

/** What a profile set for a plugin's profile setting, else the setting's default. */
export const profileSettingValue = (profilePluginSettings: Record<string, Record<string, string>> | undefined, plugin: string, setting: PluginProfileSetting) =>
  profilePluginSettings?.[plugin]?.[setting.id] ?? setting.default;

/** What the conversation chose for the setting, else what its profile set, else the default. */
export const conversationSettingValue = (
  conversation: { pluginSettings?: Record<string, Record<string, string>> } | undefined,
  profile: { pluginSettings?: Record<string, Record<string, string>> } | undefined,
  plugin: string,
  setting: PluginProfileSetting,
) => conversation?.pluginSettings?.[plugin]?.[setting.id] ?? profileSettingValue(profile?.pluginSettings, plugin, setting);

export const settingValue = (settings: PluginSettings | undefined, id: string): string | undefined =>
  settings?.chosen[id] ?? settings?.settings.find((setting) => setting.id === id)?.default;

const isText = (value: unknown): value is string => typeof value === "string" && value !== "";

function isPluginSetting(value: unknown): value is PluginSetting {
  if (typeof value !== "object" || value === null) return false;
  const { id, label, hint, choices, default: fallback } = value as Partial<PluginSetting>;
  const isChoice = (choice: unknown) => typeof choice === "object" && choice !== null && isText((choice as { value?: unknown }).value) && isText((choice as { label?: unknown }).label);
  return (
    isText(id) &&
    /^[a-z0-9][a-z0-9-]*$/.test(id) &&
    isText(label) &&
    (hint === undefined || typeof hint === "string") &&
    Array.isArray(choices) &&
    choices.length > 0 &&
    choices.every(isChoice) &&
    choices.some((choice) => choice.value === fallback)
  );
}

function isPluginProfileSetting(value: unknown): value is PluginProfileSetting {
  if (typeof value !== "object" || value === null) return false;
  const { choices, default: fallback } = value as Partial<PluginProfileSetting>;
  if (choices === "profiles") return isPluginSetting({ ...value, choices: [{ value: "none", label: "None" }], default: "none" }) && (fallback ?? "") === "";
  return isPluginSetting(value);
}

const haveDistinctIds = (settings: { id: string }[]) => new Set(settings.map(({ id }) => id)).size === settings.length;

/** A release number as plugins give it: x.y.z, nothing after. */
export const isPluginVersion = (version: unknown): version is string => typeof version === "string" && /^\d+\.\d+\.\d+$/.test(version);

export function isPluginManifest(value: unknown): value is PluginManifest {
  if (typeof value !== "object" || value === null) return false;
  const { name, title, version, api, app, canvas, build, settings, profileSettings } = value as Partial<PluginManifest>;
  return (
    typeof name === "string" &&
    /^[a-z0-9][a-z0-9-]*$/.test(name) &&
    typeof title === "string" &&
    (version === undefined || isPluginVersion(version)) &&
    typeof api === "number" &&
    (app !== undefined || canvas !== undefined) &&
    (app === undefined || isHostAndView(app)) &&
    (canvas === undefined || isHostAndView(canvas)) &&
    (build === undefined || typeof build === "string") &&
    (settings === undefined || (Array.isArray(settings) && settings.every(isPluginSetting) && haveDistinctIds(settings))) &&
    (profileSettings === undefined || (Array.isArray(profileSettings) && profileSettings.every(isPluginProfileSetting) && haveDistinctIds(profileSettings)))
  );
}
