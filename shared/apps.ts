import type { HostProblem } from "./host-problems.ts";
/**
 * The plugin API version this Mirador speaks; a plugin.json names the one it was written for, and Mirador loads every
 * version up to its own. API 2 brought host tasks, streamed files and images in a view's message; API 3 brought canvas
 * tools and items; API 4 tells apply who made the change; API 5 lets a canvas tool message its agent and start a
 * conversation on another profile, and brings profile settings; API 6 brings a canvas plugin's own window, the
 * conversations' activity, canvas tools the user runs from the slash menu, and lets an app's view list the
 * workspace's files, read any of them, and open the app on another one; API 7 brings a canvas plugin's workspace tab,
 * whose view can start a conversation and add to the composer; API 8 lets a plugin title a conversation it starts and
 * choose its model and effort, and tells it what that conversation ran on; API 9 lets a profile setting's choices be
 * the models of the profile another of its settings chose; API 10 lets a canvas plugin stop a conversation its tool
 * started; API 11 brings a canvas plugin's background work, lists the profiles to its workspace tab, and lets a plugin
 * that says so in plugin.json start conversations of its own in a workspace; API 12 lets a canvas plugin's tool start
 * a conversation in a git worktree of its own, and tells a plugin the worktree a conversation it started works in.
 */
export const APP_PLUGIN_API = 12;

/** The first plugin API whose canvas host may work in the background, and whose plugin.json may say it starts conversations. */
export const STARTS_CONVERSATIONS_PLUGIN_API = 11;

/** The first plugin API whose canvas host may have a workspace tab. */
export const WORKSPACE_TAB_API = 7;

/** The first plugin API whose plugin.json may have a canvas part. */
export const CANVAS_PLUGIN_API = 3;

/** The first plugin API whose plugin.json may have profile settings. */
export const PROFILE_SETTINGS_PLUGIN_API = 5;

/** The first plugin API whose canvas host may have a window and hear activity. */
export const PLUGIN_WINDOW_API = 6;

/** The first plugin API whose canvas tools may be slash commands. */
export const PLUGIN_COMMAND_API = 6;

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
  /**
   * The plugin tells the conversation whose tool started a conversation how that conversation's first turn ended, with
   * `replied`'s `prompt`, so Mirador doesn't notify the user of that turn's end. Any api may name it: an older Mirador
   * ignores it and notifies as usual.
   */
  tellsCaller?: boolean;
  /**
   * The plugin starts conversations of its own in a workspace, from its background work or its workspace tab, such as a
   * routine that runs on a schedule; without it, `startConversation` there throws. Plugin API 11 brought it.
   */
  startsConversations?: boolean;
  /** An SVG file, relative to the plugin's folder, that stands for the plugin in Plugins…; a bad one leaves its monogram. */
  icon?: string;
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

/**
 * One conversation's open app, on one document of its workspace: the app's tab shows there and nowhere else. Another
 * conversation of the same workspace may have the same file open, which is the same document, or a file of its own.
 */
export interface OpenApp {
  /** The conversation whose canvas shows this document in the app's tab. */
  conversationId: string;
  /** The open document, which every conversation holding this file shares. */
  documentId: string;
  workspaceId: string;
  app: string;
  title: string;
  file: string;
  /**
   * When this conversation's agent last opened the app with app_open or ran one of its tasks with app_run, whose canvas
   * brings its tab forward, even on the file already open. Missing until it does, and for a document it took up itself.
   */
  shownAt?: number;
  /** This conversation's user picked the file in the app's view, which brings no tab forward anywhere. */
  openedInView?: true;
}

/** What a view shows: sent to the pages that have the document open, on every change. */
export interface AppDocumentState {
  /** The open document's id, which its views name it by. */
  documentId: string;
  workspaceId: string;
  app: string;
  /** The document's file, relative to the workspace. Missing from hosts before plugin API 6. */
  file?: string;
  /**
   * Counts, per workspace, the times its files may have changed: after a task ends, after an agent's turn and after an
   * open. A view's onFiles fires when it moves. Missing from hosts before plugin API 6.
   */
  filesChange?: number;
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
  problemAbout?: HostProblem;
  /** Added or updated since Mirador started, which loads it as it is now only at its next start. */
  waitsForRestart: boolean;
  /** What its plugin.json brings; missing from a host older than it. */
  kinds?: PluginKind[];
  /** The canvas tools it gave the agent when Mirador started; none while it waits for a restart. Missing from a host older than it. */
  tools?: PluginTool[];
  /** The SVG its plugin.json names as its icon, when that is a small SVG file inside its folder. */
  icon?: string | null;
  /** Whether a release the host finds for it may go in without asking, once the plugin update mode isn't "ask". */
  updatesByItself: boolean;
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
  /** The plugin's icon, as SVG text. */
  icon?: string;
  /** A line on what it does, for its tile; the description stands in without one. */
  tagline?: string;
  /** What its plugin.json brings, for the badges of a plugin not installed yet. */
  kinds?: PluginKind[];
  /** Pictures of the plugin at work, shown on its page in Plugins…. */
  screenshots?: PluginScreenshot[];
}

export interface PluginScreenshot {
  /** An https URL, as a raw file of the plugin's repo at a release tag. */
  url: string;
  caption: string;
}

/** The most of an icon's SVG Mirador takes, from a plugin's folder or the catalog. */
export const MAX_PLUGIN_ICON_BYTES = 64 * 1024;

export const isPluginIcon = (svg: unknown): svg is string => typeof svg === "string" && svg.length <= MAX_PLUGIN_ICON_BYTES && /^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/.test(svg);

const isScreenshot = (value: unknown): value is PluginScreenshot => {
  const { url, caption } = (typeof value === "object" && value !== null ? value : {}) as Partial<PluginScreenshot>;
  return typeof url === "string" && url.startsWith("https://") && typeof caption === "string";
};

const MAX_TAGLINE_LENGTH = 120;

const PLUGIN_KINDS: readonly PluginKind[] = ["app", "canvas"];

/** A catalog entry with only the extras this Mirador can show: a bad icon, picture, tagline or kind is left out, not the plugin. */
function withShowableExtras({ icon, screenshots, tagline, kinds, ...plugin }: CatalogPlugin): CatalogPlugin {
  const showable = Array.isArray(screenshots) ? screenshots.filter(isScreenshot) : [];
  const knownKinds = Array.isArray(kinds) ? PLUGIN_KINDS.filter((kind) => kinds.includes(kind)) : [];
  return {
    ...plugin,
    ...(isPluginIcon(icon) ? { icon } : {}),
    ...(showable.length > 0 ? { screenshots: showable } : {}),
    ...(typeof tagline === "string" && tagline.trim() !== "" && tagline.length <= MAX_TAGLINE_LENGTH ? { tagline } : {}),
    ...(knownKinds.length > 0 ? { kinds: knownKinds } : {}),
  };
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
  return Array.isArray(plugins) ? plugins.filter(isCatalogPlugin).map(withShowableExtras) : null;
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
  /** Cloned and built, waiting in the ready folder to go in at a start the plugin update mode says. */
  ready: boolean;
  /** Why it waits for the user instead; null when it is ready, being prepared, or the mode is "ask". */
  heldBack: PluginUpdateHeldBack | null;
}

/** When plugin updates the host found go in without asking. */
export type PluginUpdateMode = "ask" | "with-mirador" | "any-restart";
export const isPluginUpdateMode = (value: unknown): value is PluginUpdateMode => value === "ask" || value === "with-mirador" || value === "any-restart";
/** Why a found update waits for the user instead of going in by itself. */
export type PluginUpdateHeldBack = "not-a-release" | "build-changed" | "host-code-changed" | "remote-changed" | "build-failed" | "undone" | "didnt-load" | "renamed" | "unreadable-manifest";
/** Why an update that went in was taken back out: the user undid it, or it didn't load. */
export type TakenBackBecause = "undone" | "didnt-load";
/** An update the host put in, or took back out, as it started. */
export interface AppliedPluginUpdate {
  folder: string;
  title: string;
  from: string | null;
  to: string;
  restoredBecause: string | null;
  /** The user undid it since: the plugin it replaced is back from the next start. */
  undone?: boolean;
}

/** What an app's view keeps in a workspace, as its localStorage: text by key. */
export type AppStorageItems = Record<string, string>;

/** How much an app's view may keep in a workspace, counted as localStorage counts it: the characters of its keys and values. */
export const APP_STORAGE_CHARACTERS = 1024 * 1024;

export const storageCharacters = (items: AppStorageItems) => Object.entries(items).reduce((sum, [key, value]) => sum + key.length + value.length, 0);

export const appKey = ({ workspaceId, app }: { workspaceId: string; app: string }) => `${workspaceId}/${app}`;

const appPath = ({ workspaceId, app }: { workspaceId: string; app: string }) => `/workspaces/${encodeURIComponent(workspaceId)}/apps/${encodeURIComponent(app)}`;

/**
 * The document an app's view shows, which its page and device ask about. The host gives a document its id when it opens
 * one, so two names of one file, as through a link, are the same document under either.
 */
export interface AppViewTarget {
  workspaceId: string;
  app: string;
  documentId: string;
}

const documentParam = ({ documentId }: { documentId: string }) => `&document=${encodeURIComponent(documentId)}`;

/** Where the host serves a file of the workspace to an app's view in signed-in pages and devices, `path` named from the document's folder. */
export const appFileUrl = (view: AppViewTarget, path: string) => `${appPath(view)}/file?path=${encodeURIComponent(path)}${documentParam(view)}`;

/** Where signed-in pages and devices ask for an address the view can stream a file of the workspace from; POST, answered with an AppMediaGrant. */
export const appMediaGrantUrl = (view: AppViewTarget, path: string) => `${appPath(view)}/media?path=${encodeURIComponent(path)}${documentParam(view)}`;

/** Where an app's view lists the workspace's files; GET, answered with AppWorkspaceFiles. */
export const appFilesUrl = (view: AppViewTarget) => `${appPath(view)}/files?${documentParam(view).slice(1)}`;

/**
 * Where an app's view opens the app on another file of the workspace, as app_open does: the conversation's own document
 * moves, and no other conversation's tab follows it; POST.
 */
export const appOpenUrl = (view: { workspaceId: string; app: string; conversationId: string }, file: string) =>
  `${appPath(view)}/open?file=${encodeURIComponent(file)}&conversation=${encodeURIComponent(view.conversationId)}`;

/**
 * The workspace's files, relative to it with /: in a repository those git tracks and the untracked ones it doesn't
 * ignore, elsewhere every file but the folders tools keep their state in. A long list stops, and says so.
 */
export interface AppWorkspaceFiles {
  files: string[];
  truncated: boolean;
}

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

/** The models the agent of a profile offers: the profile chosen in the plugin's profile setting of this id, whose choices are the profiles. */
export interface ModelsOfProfileSetting {
  modelsOf: string;
}

/**
 * What a profile can set for a plugin: one of its choices; with `choices: "profiles"`, another profile by its id, or
 * none as ""; or, with `choices: { modelsOf }`, a model of the profile another setting chose, by the id its agent gives
 * it, or the agent's own as "". Profiles and models have "" as their default. Plugin API 9 brought the models.
 */
export interface PluginProfileSetting {
  id: string;
  label: string;
  /** A sentence on what it does, its tooltip in the Profiles dialog. */
  hint?: string;
  choices: { value: string; label: string }[] | "profiles" | ModelsOfProfileSetting;
  default: string;
}

/** The id of the setting whose profile's models are this setting's choices; null for a setting with other choices. */
export const profileSettingWhoseModelsItLists = ({ choices }: PluginProfileSetting) => (typeof choices === "object" && !Array.isArray(choices) ? choices.modelsOf : null);

/** The settings whose choices are the models of the profile this setting chose: a choice of theirs holds only for that profile. */
export const modelSettingsOf = (settings: PluginProfileSetting[], profileSettingId: string) =>
  settings.filter((setting) => profileSettingWhoseModelsItLists(setting) === profileSettingId);

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

type WithPluginSettings = { pluginSettings?: Record<string, Record<string, string>> } | undefined;

/**
 * What the setting is for a conversation that didn't choose it itself: what its profile set, else the default. A model
 * the profile set is of the profile it set too, so a conversation that chose another profile has the default.
 */
export function settingValueFollowingProfile(conversation: WithPluginSettings, profile: WithPluginSettings, plugin: string, setting: PluginProfileSetting) {
  const modelsOf = profileSettingWhoseModelsItLists(setting);
  const choseAnotherProfile = modelsOf !== null && conversation?.pluginSettings?.[plugin]?.[modelsOf] !== undefined;
  return choseAnotherProfile ? setting.default : profileSettingValue(profile?.pluginSettings, plugin, setting);
}

/** What the conversation chose for the setting, else what its profile set, else the default. */
export const conversationSettingValue = (conversation: WithPluginSettings, profile: WithPluginSettings, plugin: string, setting: PluginProfileSetting) =>
  conversation?.pluginSettings?.[plugin]?.[setting.id] ?? settingValueFollowingProfile(conversation, profile, plugin, setting);

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

const isModelsOfProfileSetting = (choices: unknown): choices is ModelsOfProfileSetting =>
  typeof choices === "object" && choices !== null && !Array.isArray(choices) && isText((choices as Partial<ModelsOfProfileSetting>).modelsOf);

function isPluginProfileSetting(value: unknown): value is PluginProfileSetting {
  if (typeof value !== "object" || value === null) return false;
  const { choices, default: fallback } = value as Partial<PluginProfileSetting>;
  if (choices === "profiles" || isModelsOfProfileSetting(choices)) {
    return isPluginSetting({ ...value, choices: [{ value: "none", label: "None" }], default: "none" }) && (fallback ?? "") === "";
  }
  return isPluginSetting(value);
}

const modelSettingsNameProfileSettings = (settings: PluginProfileSetting[]) =>
  settings.every((setting) => {
    const modelsOf = profileSettingWhoseModelsItLists(setting);
    return modelsOf === null || settings.some(({ id, choices }) => id === modelsOf && choices === "profiles");
  });

const haveDistinctIds = (settings: { id: string }[]) => new Set(settings.map(({ id }) => id)).size === settings.length;

/** A release number as plugins give it: x.y.z, nothing after. */
export const isPluginVersion = (version: unknown): version is string => typeof version === "string" && /^\d+\.\d+\.\d+$/.test(version);

export function isPluginManifest(value: unknown): value is PluginManifest {
  if (typeof value !== "object" || value === null) return false;
  const { name, title, version, api, app, canvas, build, settings, profileSettings, tellsCaller, startsConversations } = value as Partial<PluginManifest>;
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
    (profileSettings === undefined || (Array.isArray(profileSettings) && profileSettings.every(isPluginProfileSetting) && haveDistinctIds(profileSettings) && modelSettingsNameProfileSettings(profileSettings))) &&
    (tellsCaller === undefined || typeof tellsCaller === "boolean") &&
    (startsConversations === undefined || typeof startsConversations === "boolean")
  );
}
