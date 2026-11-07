import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { AppliedPluginUpdate, PluginInfo, PluginManifest, PluginUpdate, PluginUpdateHeldBack, PluginUpdateMode } from "../../shared/apps.ts";
import { HostProblemError } from "../../shared/host-problems.ts";
import { isNewerVersion } from "../../shared/newer-version.ts";
import { MIRADOR_VERSION } from "../../shared/version.ts";
import { renameWhenFree } from "../rename-when-free.ts";
import type { Store } from "../store.ts";
import { gitOutput, withoutCredentials, type InstalledPlugins, type UpdatesByItself } from "./installed-plugins.ts";
import { isPlainFolderName, parkedFolderOf, refuseUnlessPlainFolderName, removeOrLog, settleCutShortSwaps, swapPlugin } from "./plugin-swaps.ts";
import { messageOf, readManifest, type PluginLoadProblem } from "./plugins.ts";

/** An official plugin, by the name its plugin.json gives and the repo Mirador installs it from. */
export interface OfficialPlugin {
  name: string;
  repo: string;
}

/** What waits in the ready folder for one plugin: a built release, or why the release found waits for the user. */
export interface ReadyNote {
  folder: string;
  title: string;
  /** The plugin's commit when the update was prepared: once it is at another, the update no longer fits it. */
  fromCommit: string | null;
  from: string | null;
  to: string;
  commit: string | null;
  heldBack: PluginUpdateHeldBack | null;
}

const NOTE_FILE = "update.json";
const CLONE_FOLDER = "plugin";

export const readyFolderOf = (pluginsFolder: string) => `${pluginsFolder}-ready`;
export const previousFolderOf = (pluginsFolder: string) => `${pluginsFolder}-previous`;

const comparableRemote = (remote: string) => withoutCredentials(remote.trim()).replace(/\/+$/, "").replace(/\.git$/, "");

/** Official takes the name and the repo both; a plugin that only shares an official one's name is not. */
export function officialness(plugin: { name: string | null; remote: string | null }, official: OfficialPlugin[]): "official" | "name-only" | "none" {
  const named = official.filter(({ name }) => name === plugin.name);
  if (named.length === 0) return "none";
  const { remote } = plugin;
  return remote !== null && named.some(({ repo }) => comparableRemote(repo) === comparableRemote(remote)) ? "official" : "name-only";
}

/** What the user chose for the plugin's folder, else whether it is an official plugin. */
export const mayUpdateByItself = (plugin: { folder: string; name: string | null; remote: string | null }, chosen: Record<string, boolean>, official: OfficialPlugin[]) =>
  chosen[plugin.folder] ?? officialness(plugin, official) === "official";

const hostModulesOf = (manifest: PluginManifest) => JSON.stringify([manifest.app?.host ?? null, manifest.canvas?.host ?? null]);

/**
 * Why a found update waits for the user rather than going in by itself, or null when nothing holds it back. Without the
 * update's plugin.json, before it is cloned, it decides what it can from the release, the name and the remote alone.
 * A build command or host modules count as changed when plugin.json names others; what the files hold isn't compared.
 */
export function heldBackBecause({
  release,
  undone,
  didntLoad,
  name,
  remote,
  official,
  installed,
  update,
}: {
  release: string | null;
  /** The release of the plugin the user undid, or that didn't load. */
  undone: string | undefined;
  /** The release of the plugin that didn't load, when that is why it was taken back. */
  didntLoad?: string;
  /** The installed plugin's name, null when its plugin.json can't be read. */
  name: string | null;
  remote: string | null;
  official: OfficialPlugin[];
  installed?: PluginManifest | null;
  update?: PluginManifest;
}): PluginUpdateHeldBack | null {
  if (release === null) return "not-a-release";
  if (name === null) return "unreadable-manifest";
  if (undone === release) return didntLoad === release ? "didnt-load" : "undone";
  if (officialness({ name, remote }, official) === "name-only") return "remote-changed";
  if (!update) return null;
  if (!installed) return "unreadable-manifest";
  if (update.name !== installed.name) return "renamed";
  if ((installed.build ?? null) !== (update.build ?? null)) return "build-changed";
  if (hostModulesOf(installed) !== hostModulesOf(update)) return "host-code-changed";
  return null;
}

/** A different Mirador than at the last start; the first start that records one counts as none. */
export const miradorUpdated = (before: string | null, now: string) => before !== null && before !== now;

export const appliesAtThisStart = (mode: PluginUpdateMode, before: string | null, now: string) =>
  mode === "any-restart" || (mode === "with-mirador" && miradorUpdated(before, now));

/** A host with `.git` in its source directory runs from a checkout, which a new commit updates; a release, its version. */
export async function miradorIdentity(sourceDir: string): Promise<string> {
  const commit = existsSync(join(sourceDir, ".git")) ? await gitOutput(sourceDir, ["rev-parse", "HEAD"]) : null;
  return commit ? `commit ${commit}` : `version ${MIRADOR_VERSION}`;
}

const isReadyNote = (value: unknown): value is ReadyNote => {
  const { folder, title, to } = (value ?? {}) as Partial<ReadyNote>;
  return isPlainFolderName(folder) && [title, to].every((text) => typeof text === "string" && text !== "");
};

function readNote(readyFolder: string, folder: string): ReadyNote | null {
  try {
    const note: unknown = JSON.parse(readFileSync(join(readyFolder, folder, NOTE_FILE), "utf8"));
    return isReadyNote(note) && note.folder === folder ? note : null;
  } catch {
    return null;
  }
}

function entriesOf(folder: string): string[] {
  try {
    return existsSync(folder) ? readdirSync(folder) : [];
  } catch (error) {
    console.warn(`${folder} couldn't be listed: ${messageOf(error)}`);
    return [];
  }
}

/** Every note in the ready folder; a folder without one, as a preparation cut short or a corrupt note leaves, goes. */
function readNotes(readyFolder: string): ReadyNote[] {
  return entriesOf(readyFolder).flatMap((folder) => {
    const note = readNote(readyFolder, folder);
    if (!note) removeOrLog(join(readyFolder, folder));
    return note ? [note] : [];
  });
}

async function stillAt(plugin: string, commit: string | null) {
  try {
    return existsSync(plugin) && !lstatSync(plugin).isSymbolicLink() && commit !== null && (await gitOutput(plugin, ["rev-parse", "HEAD"])) === commit;
  } catch {
    return false;
  }
}

/**
 * Swaps each ready update in for its plugin, keeping the plugin it replaces in the previous folder, the latest one only.
 * An update that no longer fits its plugin, or that fails to swap in, goes, and leaves the plugin as it was; one that
 * fails never stops the others.
 */
export async function applyReadyUpdates(pluginsFolder: string, rename = renameWhenFree): Promise<AppliedPluginUpdate[]> {
  const [readyFolder, previousFolder] = [readyFolderOf(pluginsFolder), previousFolderOf(pluginsFolder)];
  const applied: AppliedPluginUpdate[] = [];
  for (const note of readNotes(readyFolder).filter(({ heldBack }) => heldBack === null)) {
    try {
      const clone = join(readyFolder, note.folder, CLONE_FOLDER);
      if (!existsSync(clone) || !(await stillAt(join(pluginsFolder, note.folder), note.fromCommit))) continue;
      const previous = join(previousFolder, note.folder);
      removeOrLog(previous);
      if (existsSync(previous)) continue;
      await swapPlugin(pluginsFolder, { folder: note.folder, movedOutTo: previous, movingIn: clone, whenCutShort: "roll-back" }, rename);
      applied.push({ folder: note.folder, title: note.title, from: note.from, to: note.to, restoredBecause: null });
    } catch (error) {
      console.warn(`the ready update of the ${note.folder} plugin to ${note.to} didn't go in: ${messageOf(error)}`);
    } finally {
      removeOrLog(join(readyFolder, note.folder));
    }
  }
  return applied;
}

/**
 * At the host's start, before the plugins load: settles plugin swaps an earlier start cut short, puts the ready updates
 * in when the mode says this start is one for them, then records which Mirador this is. Nothing here stops the host
 * from starting; a failure leaves the plugins as they were.
 */
export async function applyReadyUpdatesAtStart(pluginsFolder: string, store: Store, sourceDir: string, rename = renameWhenFree): Promise<AppliedPluginUpdate[]> {
  let applied: AppliedPluginUpdate[] = [];
  try {
    await settleCutShortSwaps(pluginsFolder, (folder, release, because) => store.rememberPluginUpdateUndone(folder, release, because));
    removeOrLog(parkedFolderOf(pluginsFolder));
    const now = await miradorIdentity(sourceDir);
    const mode = store.pluginUpdateMode();
    if (mode === "ask") removeOrLog(readyFolderOf(pluginsFolder));
    if (appliesAtThisStart(mode, store.miradorStartedAs(), now)) applied = await applyReadyUpdates(pluginsFolder, rename);
    store.rememberMiradorStartedAs(now);
  } catch (error) {
    console.warn(`putting the ready plugin updates in failed, so the plugins not updated yet stay as they were: ${messageOf(error)}`);
  }
  return applied;
}

interface Status {
  release: string | null;
  heldBack: PluginUpdateHeldBack | null;
}

const remoteOf = ({ source }: Pick<PluginInfo, "source">) => (source.kind === "git" ? source.remote : null);

/**
 * Prepares the releases the host finds for the plugins that may update by themselves: clones and builds each in the
 * ready folder, where it waits for a start the mode says, or notes why it waits for the user instead. Also what this
 * start put in, for the user to undo.
 */
export class ReadyPluginUpdates {
  private readonly readyFolder: string;
  private readonly previousFolder: string;
  private readonly statuses = new Map<string, Status>();
  /** Counts the times each plugin's ready update was discarded, so a preparation under way meanwhile drops what it made. */
  private readonly discarded = new Map<string, number>();
  private preparing: Promise<void> = Promise.resolve();
  private applied: AppliedPluginUpdate[] = [];

  constructor(
    private readonly pluginsFolder: string,
    private readonly plugins: InstalledPlugins,
    private readonly store: Store,
    private readonly official: () => OfficialPlugin[],
    private readonly changed: () => void = () => {},
  ) {
    this.readyFolder = readyFolderOf(pluginsFolder);
    this.previousFolder = previousFolderOf(pluginsFolder);
    for (const note of readNotes(this.readyFolder)) this.statuses.set(note.folder, { release: note.to, heldBack: note.heldBack });
  }

  readonly updatesByItself: UpdatesByItself = (plugin) =>
    mayUpdateByItself({ folder: plugin.folder, name: plugin.name, remote: remoteOf(plugin) }, this.store.pluginUpdatesByItself(), this.official());

  get appliedAtStart(): AppliedPluginUpdate[] {
    return this.applied;
  }

  /**
   * Takes what this start put in; one that didn't load goes back to the plugin it replaced, from the next start, and its
   * release is remembered so it doesn't go in by itself again.
   */
  async started(applied: AppliedPluginUpdate[], problems: PluginLoadProblem[]) {
    this.applied = await Promise.all(
      applied.map(async (update) => {
        const problem = problems.find(({ folder }) => basename(folder) === update.folder);
        if (!problem) return update;
        try {
          await this.plugins.putBack(update.folder, join(this.previousFolder, update.folder), update.to, "didnt-load");
          this.store.rememberPluginUpdateUndone(update.folder, update.to, "didnt-load");
          console.warn(`the ${update.folder} plugin at ${update.to} didn't load, so the one it replaced is back from the next start: ${problem.message}`);
          return { ...update, restoredBecause: problem.message };
        } catch (error) {
          console.warn(`the ${update.folder} plugin at ${update.to} didn't load, and putting back the one it replaced failed: ${messageOf(error)}`);
          return update;
        }
      }),
    );
  }

  /** The found updates with what is known of each: ready, or held back and why. */
  marked(found: PluginUpdate[]): PluginUpdate[] {
    const asking = this.store.pluginUpdateMode() === "ask";
    return found.map((update) => {
      const status = asking ? undefined : this.statuses.get(update.folder);
      const known = status && status.release === update.release ? status : null;
      return { ...update, ready: known !== null && known.heldBack === null, heldBack: known?.heldBack ?? null };
    });
  }

  /** Prepares the updates found, one plugin at a time, in the background; a newer release replaces an older ready one. */
  prepare(found: PluginUpdate[]): Promise<void> {
    const done = this.preparing.then(() => this.prepareEach(found));
    this.preparing = done.catch((error) => console.warn(`preparing the plugin updates failed: ${messageOf(error)}`));
    return this.preparing;
  }

  private async prepareEach(found: PluginUpdate[]) {
    if (this.store.pluginUpdateMode() === "ask") return;
    const installed = await this.plugins.list();
    for (const folder of [...this.statuses.keys()].filter((folder) => !found.some((update) => update.folder === folder))) await this.discardWhenStale(folder);
    for (const update of found) {
      const plugin = installed.find(({ folder }) => folder === update.folder);
      if (!plugin?.updatesByItself || plugin.source.kind !== "git") {
        this.discard(update.folder);
        continue;
      }
      if (plugin.source.commit !== update.from) continue;
      const known = this.statuses.get(update.folder);
      if (known && known.release === update.release && known.heldBack !== "build-failed") continue;
      const decided = { release: update.release, undone: this.store.pluginUpdatesUndone()[update.folder], didntLoad: this.store.pluginUpdatesThatDidntLoad()[update.folder], name: plugin.name, remote: remoteOf(plugin), official: this.official() };
      const heldBack = heldBackBecause(decided);
      if (heldBack || decided.release === null) {
        this.setStatus(update.folder, { release: update.release, heldBack });
        continue;
      }
      if (!isNewerVersion(decided.release, plugin.version ?? "")) continue;
      await this.prepareRelease(update, decided.release, decided);
    }
  }

  /** Clones the release, and builds it only when nothing holds it back, as a changed build command would run code the user hasn't agreed to. */
  private async prepareRelease(update: PluginUpdate, release: string, decided: Parameters<typeof heldBackBecause>[0]) {
    const discardsBefore = this.discarded.get(update.folder) ?? 0;
    const cloned = await this.plugins.cloneRelease(update.folder, release).catch((error) => {
      console.warn(`cloning ${release} of the ${update.folder} plugin to update it by itself failed; it is tried again at the next look: ${messageOf(error)}`);
      return null;
    });
    if (!cloned) return;
    try {
      const fitsThePlugin = cloned.installedCommit?.startsWith(update.from) && isNewerVersion(release, cloned.installed?.version ?? "");
      if (!fitsThePlugin) return;
      let heldBack = heldBackBecause({ ...decided, installed: cloned.installed, update: cloned.manifest });
      if (!heldBack) {
        await this.plugins.buildClone(cloned.staged, cloned.manifest).catch((error) => {
          console.warn(`building ${release} of the ${update.folder} plugin failed, so it waits for you: ${messageOf(error)}`);
          heldBack = "build-failed";
        });
      }
      if ((this.discarded.get(update.folder) ?? 0) !== discardsBefore || this.store.pluginUpdateMode() === "ask") return;
      const note: ReadyNote = { folder: update.folder, title: update.title, fromCommit: cloned.installedCommit, from: cloned.installed?.version ?? null, to: release, commit: cloned.commit, heldBack };
      await this.keep(note, heldBack ? null : cloned.staged);
    } finally {
      removeOrLog(cloned.staged);
    }
  }

  private async keep(note: ReadyNote, clone: string | null) {
    refuseUnlessPlainFolderName(note.folder);
    const folder = join(this.readyFolder, note.folder);
    removeOrLog(folder);
    mkdirSync(folder, { recursive: true });
    if (clone) await renameWhenFree(clone, join(folder, CLONE_FOLDER));
    writeFileSync(join(folder, NOTE_FILE), JSON.stringify(note));
    this.setStatus(note.folder, { release: note.to, heldBack: note.heldBack });
  }

  private async discardWhenStale(folder: string) {
    const note = readNote(this.readyFolder, folder);
    if (note && (await stillAt(join(this.pluginsFolder, folder), note.fromCommit))) return;
    if (note || !existsSync(join(this.pluginsFolder, folder))) this.discard(folder);
  }

  private setStatus(folder: string, status: Status) {
    const known = this.statuses.get(folder);
    this.statuses.set(folder, status);
    if (known?.release !== status.release || known?.heldBack !== status.heldBack) this.changed();
  }

  /** Only for a plugin in the plugins folder: a name from the page could lead anywhere. */
  private async refuseUnlessInstalled(folder: string) {
    refuseUnlessPlainFolderName(folder);
    if (!(await this.plugins.list()).some((plugin) => plugin.folder === folder)) throw new HostProblemError({ code: "plugin-not-installed", folder });
  }

  /** The user's choice for the plugin; turning it off discards its ready update. */
  async setUpdatesByItself(folder: string, updatesByItself: boolean) {
    await this.refuseUnlessInstalled(folder);
    this.store.setPluginUpdatesByItself(folder, updatesByItself);
    if (!updatesByItself) this.discard(folder);
  }

  /** A removed plugin's ready update and choices go with it. */
  forget(folder: string) {
    this.store.forgetPluginUpdateChoices(folder);
    this.discard(folder);
  }

  /** The plugin's ready update goes, as when the user turns updating by itself off for it, or removes the plugin. */
  discard(folder: string) {
    refuseUnlessPlainFolderName(folder);
    this.discarded.set(folder, (this.discarded.get(folder) ?? 0) + 1);
    removeOrLog(join(this.readyFolder, folder));
    if (this.statuses.delete(folder)) this.changed();
  }

  /** Every ready update goes, as when the user switches back to asking. */
  discardAll() {
    for (const folder of new Set([...this.statuses.keys(), ...entriesOf(this.readyFolder)])) if (isPlainFolderName(folder)) this.discard(folder);
  }

  /**
   * Puts back the plugin an update replaced at this start, from the next start, and remembers the release so it doesn't
   * go in by itself again; the user can still update to it by hand.
   */
  async undo(folder: string) {
    await this.refuseUnlessInstalled(folder);
    const update = this.applied.find((applied) => applied.folder === folder && applied.restoredBecause === null && !applied.undone);
    const previous = join(this.previousFolder, folder);
    const version = update && (await readManifest(join(this.pluginsFolder, folder)).catch(() => null))?.version;
    if (!update || version !== update.to || !existsSync(previous)) throw new HostProblemError({ code: "plugin-update-not-undoable" });
    await this.plugins.putBack(folder, previous, update.to);
    this.store.rememberPluginUpdateUndone(folder, update.to);
    this.applied = this.applied.map((applied) => (applied === update ? { ...applied, undone: true } : applied));
  }
}
