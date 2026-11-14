import { existsSync, lstatSync, mkdirSync, readlinkSync, realpathSync, rmSync, statSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, dirname, join, resolve, sep } from "node:path";
import { MAX_PLUGIN_ICON_BYTES, isPluginIcon, isPluginVersion, isTagline, type PluginKind, type PluginLook, type PluginManifest, type PluginManifestPicture, type PluginNews, type PluginInfo, type PluginOffer, type PluginSource, type PluginTool, type PluginUpdate, type TakenBackBecause } from "../../shared/apps.ts";
import { isNewerVersion } from "../../shared/newer-version.ts";
import { environmentWithoutPrompts } from "../git-environment.ts";
import { localImage } from "../local-images.ts";
import { renameWhenFree } from "../rename-when-free.ts";
import { parkedFolderOf, swapPlugin } from "./plugin-swaps.ts";
import { AppProblem, messageOf, newerApiOf, pluginFiles, pluginFolders, readManifest, refuseUnversioned, type CanvasPlugin, type PluginLoadProblem } from "./plugins.ts";
import { causeOf, HostProblemError, problemFieldsOf, type HostProblem } from "../../shared/host-problems.ts";

const GIT_GIVES_UP_AFTER_MS = 5 * 60_000;
const BUILD_GIVES_UP_AFTER_MS = 10 * 60_000;
/** The end of a failed build's output is where its error is. */
const OUTPUT_SHOWN_CHARACTERS = 4000;
/** A plugin's files install as committed, on every OS: Git for Windows checks text out with CRLF by default. */
const WITH_FILES_AS_COMMITTED = "--config=core.autocrlf=false";

/** Text that may hold a remote, as it may be shown: `https://user:token@host/…` loses its user and token. */
export const withoutCredentials = (text: string) => text.replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, "$1");

const lastPart = (output: string) => (output.length > OUTPUT_SHOWN_CHARACTERS ? `…${output.slice(-OUTPUT_SHOWN_CHARACTERS)}` : output);

/** Its output, or null when git fails or isn't installed. */
export async function gitOutput(folder: string, args: string[]): Promise<string | null> {
  try {
    const child = Bun.spawn(["git", "-C", folder, ...args], { env: environmentWithoutPrompts(), stdin: "ignore", stdout: "pipe", stderr: "ignore" });
    const [output, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited]);
    return exitCode === 0 ? output.trim() : null;
  } catch {
    return null;
  }
}

/** JSON that may be missing or broken, as git shows a file of a commit; null for either. */
function parsedOrNull(json: string | null): unknown {
  try {
    return JSON.parse(json ?? "");
  } catch {
    return null;
  }
}

/** Runs a command to its end; its output, stdout and stderr together, never shows credentials. */
async function run(command: string[], cwd: string, env: Record<string, string | undefined>, givesUpAfterMs: number): Promise<{ ok: boolean; output: string }> {
  try {
    const child = Bun.spawn(command, { cwd, env, stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: givesUpAfterMs });
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    const output = withoutCredentials(`${stdout}${stderr}`.trim());
    const stopped = child.signalCode ? `\n(stopped after ${givesUpAfterMs / 60_000} minutes)` : "";
    return { ok: exitCode === 0, output: output + stopped };
  } catch (error) {
    return { ok: false, output: withoutCredentials(messageOf(error)) };
  }
}

/** git leaves `~` to the shell, and a path typed into Settings has none. */
const expandedHome = (url: string) => (url === "~" || url.startsWith("~/") ? join(homedir(), url.slice(1)) : url);

const shellCommand = (command: string) => (process.platform === "win32" ? ["cmd", "/d", "/s", "/c", command] : ["sh", "-c", command]);

/** A build finds `bun` even where Mirador was started without it on the PATH, as the desktop app is. */
function buildEnvironment() {
  const environment: Record<string, string | undefined> = environmentWithoutPrompts();
  const pathKey = Object.keys(environment).find((key) => key.toUpperCase() === "PATH") ?? "PATH";
  return { ...environment, [pathKey]: [dirname(process.execPath), environment[pathKey]].filter(Boolean).join(delimiter) };
}

const RELEASE_TAG_PREFIX = "v";
const releaseTag = (version: string) => `${RELEASE_TAG_PREFIX}${version}`;
const releaseOfTag = (tag: string | null) => {
  const version = tag?.startsWith(RELEASE_TAG_PREFIX) ? tag.slice(RELEASE_TAG_PREFIX.length) : null;
  return isPluginVersion(version) ? version : null;
};

const newestOf = (tags: string[]) =>
  tags.flatMap((tag) => releaseOfTag(tag) ?? []).reduce<string | null>((newest, release) => (newest === null || isNewerVersion(release, newest) ? release : newest), null);

/** The newest release whose tag a detached checkout sits at; a checkout of a branch follows the branch. */
async function releaseCheckedOut(folder: string) {
  return newestOf(((await gitOutput(folder, ["tag", "--points-at", "HEAD", "--list", `${RELEASE_TAG_PREFIX}[0-9]*`])) ?? "").split("\n"));
}

const newestFirst = (one: string, other: string) => (isNewerVersion(one, other) ? -1 : isNewerVersion(other, one) ? 1 : 0);

/** Every release the repo has tagged, newest first. */
async function releasesOf(url: string): Promise<string[]> {
  const listed = await run(["git", "ls-remote", "--tags", "--refs", "--", url, `${RELEASE_TAG_PREFIX}*`], process.cwd(), environmentWithoutPrompts(), GIT_GIVES_UP_AFTER_MS);
  if (!listed.ok) throw new HostProblemError({ code: "git-ls-remote-failed", output: listed.output });
  return listed.output
    .split("\n")
    .flatMap((line) => releaseOfTag(line.split("refs/tags/")[1] ?? "") ?? [])
    .sort(newestFirst);
}

/** The newest release the repo has tagged; null when it tags none. */
const newestRelease = async (url: string) => (await releasesOf(url))[0] ?? null;

const NO_NEWS: PluginNews = { release: null, commits: [], needsApi: null };

async function sourceOf(folder: string): Promise<PluginSource> {
  if (lstatSync(folder).isSymbolicLink()) return { kind: "linked", target: resolve(dirname(folder), readlinkSync(folder)) };
  if (!existsSync(join(folder, ".git"))) return { kind: "folder" };
  const [remote, branch, commit, subject] = await Promise.all([
    gitOutput(folder, ["remote", "get-url", "origin"]),
    gitOutput(folder, ["symbolic-ref", "--quiet", "--short", "HEAD"]),
    gitOutput(folder, ["rev-parse", "--short", "HEAD"]),
    gitOutput(folder, ["log", "-1", "--format=%s"]),
  ]);
  if (!commit) return { kind: "folder" };
  const release = branch ? null : await releaseCheckedOut(folder);
  return { kind: "git", remote: remote && withoutCredentials(remote), branch, release, commit, subject: subject ?? "" };
}

/** What plugin.json says, as far as it can be read, for a plugin that may not load. */
interface ManifestFields {
  name: string | null;
  title: string | null;
  version: string | null;
  kinds: PluginKind[];
  icon: string | null;
  description: string | null;
  tagline: string | null;
  pictures: PluginManifestPicture[];
}

async function manifestFields(folder: string): Promise<ManifestFields> {
  const textOrNull = (value: unknown) => (typeof value === "string" ? value : null);
  try {
    const { name, title, version, app, canvas, icon, description, tagline, screenshots } = await Bun.file(join(folder, "plugin.json")).json();
    const kinds = (["app", "canvas"] as const).filter((kind) => ({ app, canvas })[kind] !== undefined);
    return {
      name: textOrNull(name),
      title: textOrNull(title),
      version: textOrNull(version),
      kinds,
      icon: await iconIn(folder, icon),
      description: typeof description === "string" && description.trim() !== "" ? description : null,
      tagline: isTagline(tagline) ? tagline : null,
      pictures: await picturesIn(folder, screenshots),
    };
  } catch {
    return { name: null, title: null, version: null, kinds: [], icon: null, description: null, tagline: null, pictures: [] };
  }
}

/** The pictures plugin.json lists that have a caption and are image files inside the plugin's folder. */
async function picturesIn(folder: string, listed: unknown): Promise<PluginManifestPicture[]> {
  if (!Array.isArray(listed)) return [];
  const pictures = await Promise.all(
    listed.map(async (entry: unknown) => {
      const { path, caption } = (typeof entry === "object" && entry !== null ? entry : {}) as Partial<PluginManifestPicture>;
      if (typeof path !== "string" || typeof caption !== "string" || caption.trim() === "") return null;
      return (await pictureFileIn(folder, path)) ? { path, caption } : null;
    }),
  );
  return pictures.filter((picture) => picture !== null);
}

/** The image file at `path` in the plugin's folder; null for anything else, such as a path that leads out of the folder or a file whose bytes aren't an image. */
async function pictureFileIn(folder: string, path: string) {
  try {
    const [inside, file] = [realpathSync(folder), realpathSync(resolve(folder, path))];
    return file.startsWith(inside + sep) ? await localImage(file) : null;
  } catch {
    return null;
  }
}

const pictureUrl = (folder: string, path: string) => `/plugin-picture?folder=${encodeURIComponent(basename(folder))}&path=${encodeURIComponent(path)}`;

/** Each loaded plugin's icon and tagline by its name, for the pages that show plugins outside Plugins…. */
export async function pluginLooksOf(plugins: { manifest: PluginManifest; folder: string }[]): Promise<Record<string, PluginLook>> {
  const looks = await Promise.all(plugins.map(async ({ manifest, folder }) => [manifest.name, { icon: await iconIn(folder, manifest.icon), tagline: isTagline(manifest.tagline) ? manifest.tagline : null }] as const));
  return Object.fromEntries(looks);
}

/** The SVG at `path` in the plugin's folder; null for anything else, such as a path that leads out of the folder. */
async function iconIn(folder: string, path: unknown): Promise<string | null> {
  if (typeof path !== "string" || !path.endsWith(".svg")) return null;
  try {
    const [inside, file] = [realpathSync(folder), realpathSync(resolve(folder, path))];
    if (!file.startsWith(inside + sep) || statSync(file).size > MAX_PLUGIN_ICON_BYTES) return null;
    const svg = await Bun.file(file).text();
    return isPluginIcon(svg) ? svg : null;
  } catch {
    return null;
  }
}

const toolsOf = ({ host }: CanvasPlugin): PluginTool[] => Object.entries(host.tools).map(([name, { description }]) => ({ name, description }));

/** `git log --format=%h%x09%s` as commits. */
const commitsOfLog = (log: string) =>
  log
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [commit = "", ...subject] = line.split("\t");
      return { commit, subject: subject.join("\t") };
    });

/** Every text in a problem, without credentials, as the page may show any of them. */
const problemWithoutCredentials = (problem: HostProblem): HostProblem =>
  Object.fromEntries(
    Object.entries(problem).map(([key, value]) => [key, typeof value === "string" ? withoutCredentials(value) : key === "causeProblem" ? problemWithoutCredentials(value as HostProblem) : value]),
  ) as HostProblem;

const shownWithoutCredentials = (error: unknown) =>
  error instanceof HostProblemError ? new HostProblemError(problemWithoutCredentials(error.problem)) : new AppProblem(withoutCredentials(messageOf(error)));

/** What a failed change to the plugins says, without credentials, for the page to show. */
export const shownProblemOf = (error: unknown) => {
  const shown = shownWithoutCredentials(error);
  return problemFieldsOf(shown, shown.message);
};

const isLink = (folder: string) => lstatSync(folder).isSymbolicLink();

const byTitle = ({ title, folder }: PluginInfo) => title ?? folder;

/** What decides whether a plugin's releases may go in without asking. */
export type UpdatesByItself = (plugin: Pick<PluginInfo, "folder" | "name" | "source">) => boolean;

/** A release cloned for an update that may go in without asking, next to the plugin it would replace. */
export interface ClonedRelease {
  staged: string;
  manifest: PluginManifest;
  installed: PluginManifest | null;
  installedCommit: string | null;
  commit: string | null;
}

/**
 * The plugins folder: what the Plugins settings list, and the plugins they add from a git repo, update and remove. A change takes effect at Mirador's next start, which is when plugins load.
 */
export class InstalledPlugins {
  /**
   * Where a repo is cloned and built before it moves into the plugins folder, and where a replaced or removed plugin
   * waits, since the running host still holds its code; the next start empties it.
   */
  private readonly staging: string;
  private readonly changed = new Set<string>();
  /** The clones offered to the user, by offer id, until they agree or decline; the next start empties the staging folder of them. */
  private readonly offers = new Map<string, { staged: string; manifest: PluginManifest; offer: PluginOffer }>();
  private lastChange: Promise<unknown> = Promise.resolve();
  private changesStarted = 0;
  private changesEnded = 0;
  private updatesByItself: UpdatesByItself = () => false;

  constructor(
    readonly folder: string,
    private readonly loadProblems: PluginLoadProblem[],
    private readonly loadedCanvases: CanvasPlugin[] = [],
  ) {
    this.staging = `${folder}-staging`;
    rmSync(this.staging, { recursive: true, force: true });
  }

  get restartNeeded() {
    return this.changed.size > 0;
  }

  decidesUpdatesByItselfWith(updatesByItself: UpdatesByItself) {
    this.updatesByItself = updatesByItself;
  }

  /** Lists again once the changes are done when one was under way while it listed, so that it never shows a plugin half gone. */
  async list(): Promise<PluginInfo[]> {
    const [startedBefore, endedBefore] = [this.changesStarted, this.changesEnded];
    const plugins = await Promise.all(pluginFolders(this.folder).map(async (folder) => this.info(folder, await sourceOf(folder).catch((): PluginSource => ({ kind: "folder" })))));
    const changedMeanwhile = this.changesStarted !== startedBefore || this.changesEnded !== endedBefore || this.changesEnded !== this.changesStarted;
    if (changedMeanwhile) {
      await this.lastChange;
      return this.list();
    }
    return plugins.sort((one, other) => byTitle(one).localeCompare(byTitle(other)));
  }

  private async info(folder: string, source: PluginSource): Promise<PluginInfo> {
    const waitsForRestart = this.changed.has(basename(folder));
    const loadedCanvas = this.loadedCanvases.find((canvas) => canvas.folder === folder);
    const { pictures, ...fields } = await manifestFields(folder);
    return {
      folder: basename(folder),
      ...fields,
      screenshots: pictures.map(({ path, caption }) => ({ url: pictureUrl(folder, path), caption })),
      source,
      ...this.loadProblemOf(folder),
      waitsForRestart,
      tools: loadedCanvas && !waitsForRestart ? toolsOf(loadedCanvas) : [],
      updatesByItself: source.kind === "git" && this.updatesByItself({ folder: basename(folder), name: fields.name, source }),
    };
  }

  /** A picture an installed plugin's plugin.json lists, from its folder; null for any other file. */
  async picture(folderName: string, path: string) {
    const folder = pluginFolders(this.folder).find((each) => basename(each) === folderName);
    if (!folder) return null;
    const { pictures } = await manifestFields(folder);
    return pictures.some((picture) => picture.path === path) ? pictureFileIn(folder, path) : null;
  }

  private loadProblemOf(folder: string): Pick<PluginInfo, "problem" | "problemAbout"> {
    const loadProblem = this.loadProblems.find((problem) => problem.folder === folder);
    return { problem: loadProblem?.message ?? null, ...(loadProblem?.messageAbout && { problemAbout: loadProblem.messageAbout }) };
  }

  /**
   * Clones the repo at the branch or tag given, or else at its newest release, or its default branch when it tags no
   * release, without building it: what it brings, for the user to agree to before any of its code runs.
   */
  offer(url: string, branch: string | null): Promise<PluginOffer> {
    return this.oneAtATime(async () => {
      const repo = expandedHome(url.trim());
      const given = branch?.trim() || null;
      const release = given || !repo ? null : await newestRelease(repo);
      const { staged, manifest } = await this.cloned(repo, given ?? (release && releaseTag(release)));
      try {
        await this.refuseTakenName(manifest.name);
      } catch (error) {
        rmSync(staged, { recursive: true, force: true });
        throw error;
      }
      return this.offered(staged, manifest, { remote: repo, branch: given && !releaseOfTag(given) ? given : null, release: release ?? releaseOfTag(given) }, null);
    });
  }

  /** Clones what updating the plugin brings, the newest release or the branch as it is now, without building it, for the user to agree to. */
  offerUpdate(folderName: string): Promise<PluginOffer> {
    return this.oneAtATime(async () => {
      const folder = this.clonedPlugin(folderName);
      const followed = await this.followed(folder);
      const newest = followed.release && ((await this.releaseNews(folder, followed.remote, followed.release)).release ?? followed.release);
      const installed = await readManifest(folder).catch(() => null);
      const { staged, manifest } = await this.cloned(followed.remote, newest ? releaseTag(newest) : followed.branch);
      try {
        if (installed && manifest.name !== installed.name) {
          throw new HostProblemError({ code: "plugin-renamed", name: manifest.name, installedName: installed.name, folder: folderName });
        }
        const commits = await this.commitsSince(staged, (await gitOutput(folder, ["rev-parse", "HEAD"])) ?? "HEAD");
        return this.offered(staged, manifest, { remote: followed.remote, branch: followed.branch, release: newest }, { folder: folderName, commits });
      } catch (error) {
        rmSync(staged, { recursive: true, force: true });
        throw error;
      }
    });
  }

  /**
   * Builds the offer the user agreed to, the very commit they saw, and only then puts it in the plugins folder, in a
   * folder named as the plugin, or swaps it in for the plugin it updates, so a failed update leaves the plugin as it was.
   */
  install(offerId: string): Promise<PluginOffer> {
    return this.oneAtATime(async () => {
      const staging = this.offers.get(offerId);
      if (!staging) throw new HostProblemError({ code: "plugin-clone-gone" });
      this.offers.delete(offerId);
      const { staged, manifest, offer } = staging;
      try {
        await this.built(staged, manifest);
        if (offer.replaces) {
          const folder = this.clonedPlugin(offer.replaces.folder);
          const replaced = join(this.staging, `${offer.replaces.folder}-replaced-${crypto.randomUUID()}`);
          await renameWhenFree(folder, replaced);
          try {
            await renameWhenFree(staged, folder);
          } catch (error) {
            await renameWhenFree(replaced, folder);
            throw error;
          }
          this.changed.add(offer.replaces.folder);
        } else {
          await this.refuseTakenName(manifest.name);
          mkdirSync(this.folder, { recursive: true });
          await renameWhenFree(staged, join(this.folder, manifest.name));
          this.changed.add(manifest.name);
        }
        return offer;
      } finally {
        rmSync(staged, { recursive: true, force: true });
      }
    });
  }

  /** The user didn't agree: the clone goes, and nothing of it ran. */
  discard(offerId: string) {
    const staging = this.offers.get(offerId);
    this.offers.delete(offerId);
    if (staging) rmSync(staging.staged, { recursive: true, force: true });
  }

  /** Installs without asking, for the plugins Mirador installs by itself. */
  async add(url: string, branch: string | null): Promise<void> {
    await this.install((await this.offer(url, branch)).id);
  }

  /** Updates without asking. */
  async update(folderName: string): Promise<void> {
    await this.install((await this.offerUpdate(folderName)).id);
  }

  private async offered(
    staged: string,
    manifest: PluginManifest,
    source: Pick<PluginOffer, "remote" | "branch" | "release">,
    replaces: PluginOffer["replaces"],
  ): Promise<PluginOffer> {
    const [commit, subject] = await Promise.all([gitOutput(staged, ["rev-parse", "HEAD"]), gitOutput(staged, ["log", "-1", "--format=%s"])]);
    const hostCode = (["app", "canvas"] as const).flatMap((part) => (manifest[part] ? [{ part, file: manifest[part].host }] : []));
    const offer: PluginOffer = {
      id: crypto.randomUUID(),
      name: manifest.name,
      title: manifest.title,
      version: manifest.version ?? "",
      ...source,
      remote: withoutCredentials(source.remote),
      commit: commit ?? "",
      subject: subject ?? "",
      build: manifest.build ?? null,
      hostCode,
      replaces,
    };
    this.offers.set(offer.id, { staged, manifest, offer });
    return offer;
  }

  /** The commits of the clone since the commit the plugin is at, newest first; none when the clone doesn't have it. */
  private async commitsSince(staged: string, installedCommit: string) {
    const log = (await gitOutput(staged, ["log", "--format=%h%x09%s", `${installedCommit}..HEAD`])) ?? "";
    return commitsOfLog(log);
  }

  /** What updating would bring: the newer release, or the commits on the plugin's branch it doesn't have yet. */
  news(folderName: string): Promise<PluginNews> {
    return this.oneAtATime(async () => {
      const folder = this.clonedPlugin(folderName);
      const followed = await this.followed(folder);
      if (followed.branch === null) return this.releaseNews(folder, followed.remote, followed.release);
      return { release: null, ...(await this.fetchedNews(folder, followed.branch)) };
    });
  }

  /**
   * The newest release past the installed one whose plugin API this Mirador speaks, with what it brings; when every
   * newer release needs a newer Mirador, the newest of them, saying which plugin API it needs.
   */
  private async releaseNews(folder: string, remote: string, installed: string): Promise<PluginNews> {
    let newestForNewerApi: PluginNews | null = null;
    for (const release of (await releasesOf(remote)).filter((release) => isNewerVersion(release, installed))) {
      const news = { release, ...(await this.fetchedNews(folder, `refs/tags/${releaseTag(release)}`)) };
      if (news.needsApi === null) return news;
      newestForNewerApi ??= news;
    }
    return newestForNewerApi ?? NO_NEWS;
  }

  /** What the ref brings that the checkout doesn't have: its commits, newest first, and the plugin API its plugin.json names when this Mirador's is older. */
  private async fetchedNews(folder: string, ref: string) {
    const fetched = await run(["git", "fetch", "--quiet", "--no-tags", "origin", ref], folder, environmentWithoutPrompts(), GIT_GIVES_UP_AFTER_MS);
    if (!fetched.ok) throw new HostProblemError({ code: "git-fetch-failed", output: fetched.output });
    const [log, manifest] = await Promise.all([gitOutput(folder, ["log", "--format=%h%x09%s", "HEAD..FETCH_HEAD"]), gitOutput(folder, ["show", "FETCH_HEAD:plugin.json"])]);
    return { commits: commitsOfLog(log ?? ""), needsApi: newerApiOf(parsedOrNull(manifest)) };
  }

  /** The plugins from git repos with news; one whose fetch fails, offline for one, keeps what was last found for it. */
  async updatesFound(last: PluginUpdate[] | null): Promise<PluginUpdate[]> {
    const fromGit = (await this.list()).flatMap(({ folder, title, source }) => (source.kind === "git" ? [{ folder, title, from: source.commit }] : []));
    const found = await Promise.all(
      fromGit.map(async ({ folder, title, from }) => {
        try {
          return { folder, title: title ?? folder, from, ...(await this.news(folder)), ready: false, heldBack: null };
        } catch {
          return last?.find((update) => update.folder === folder) ?? null;
        }
      }),
    );
    return found.filter((update): update is PluginUpdate => update !== null && update.needsApi === null && (update.release !== null || update.commits.length > 0));
  }

  /**
   * Clones the plugin's release into the staging folder, without building it, for an update that may go in without
   * asking; the caller builds it or removes it.
   */
  async cloneRelease(folderName: string, release: string): Promise<ClonedRelease> {
    const folder = this.clonedPlugin(folderName);
    const followed = await this.followed(folder);
    if (followed.branch !== null) throw new HostProblemError({ code: "plugin-has-nothing-to-update-from", folder: folderName });
    const [installed, installedCommit] = await Promise.all([readManifest(folder).catch(() => null), gitOutput(folder, ["rev-parse", "HEAD"])]);
    const { staged, manifest } = await this.cloned(followed.remote, releaseTag(release));
    return { staged, manifest, installed, installedCommit, commit: await gitOutput(staged, ["rev-parse", "HEAD"]) };
  }

  /** Builds a clone from cloneRelease where it is. */
  buildClone(staged: string, manifest: PluginManifest): Promise<void> {
    return this.built(staged, manifest);
  }

  /**
   * Puts `replacement` in the plugin's place for the next start, remembering `undoneRelease` should the swap be cut
   * short; the plugin as it is now waits in the parked folder, since the running host may hold its code.
   */
  putBack(folderName: string, replacement: string, undoneRelease: string, undoneBecause: TakenBackBecause = "undone"): Promise<void> {
    return this.oneAtATime(async () => {
      this.installedFolder(folderName);
      const movedOutTo = join(parkedFolderOf(this.folder), `${folderName}-${crypto.randomUUID()}`);
      await swapPlugin(this.folder, { folder: folderName, movedOutTo, movingIn: replacement, whenCutShort: "finish", undoneRelease, undoneBecause });
      this.changed.add(folderName);
    });
  }

  /** Takes the plugin out of the plugins folder; a link goes, the folder it points to stays. The plugin's name, for forgetting where its app was open. */
  remove(folderName: string): Promise<string | null> {
    return this.oneAtATime(async () => {
      const folder = this.installedFolder(folderName);
      const { name } = await manifestFields(folder);
      if (isLink(folder)) {
        unlinkSync(folder);
      } else {
        mkdirSync(this.staging, { recursive: true });
        await renameWhenFree(folder, join(this.staging, `${folderName}-removed-${crypto.randomUUID()}`));
      }
      this.changed.add(folderName);
      return name;
    });
  }

  private oneAtATime<T>(change: () => Promise<T>): Promise<T> {
    const done = this.lastChange
      .then(() => {
        this.changesStarted++;
        return change();
      })
      .finally(() => this.changesEnded++);
    this.lastChange = done.catch(() => {});
    return done;
  }

  /** Clones the repo at the branch or tag, or its default branch, into the staging folder, and reads its plugin.json; runs none of its code. */
  private async cloned(url: string, branchOrTag: string | null): Promise<{ staged: string; manifest: PluginManifest }> {
    if (!url) throw new HostProblemError({ code: "plugin-needs-repo-address" });
    mkdirSync(this.staging, { recursive: true });
    const staged = join(this.staging, crypto.randomUUID());
    try {
      const cloned = await run(
        ["git", "clone", "--quiet", WITH_FILES_AS_COMMITTED, ...(branchOrTag ? [`--branch=${branchOrTag}`] : []), "--", url, staged],
        this.staging,
        environmentWithoutPrompts(),
        GIT_GIVES_UP_AFTER_MS,
      );
      if (!cloned.ok) throw new HostProblemError({ code: "git-clone-failed", output: cloned.output });
      const manifest = await readManifest(staged)
        .then((read) => (refuseUnversioned(read), read))
        .catch((error) => {
          throw new HostProblemError({ code: "repo-is-not-a-plugin", ...causeOf(error, messageOf(error)) });
        });
      const tagged = releaseOfTag(branchOrTag);
      if (tagged && manifest.version !== tagged) throw new HostProblemError({ code: "plugin-tag-version-mismatch", tag: String(branchOrTag), release: tagged, version: String(manifest.version) });
      return { staged, manifest };
    } catch (error) {
      rmSync(staged, { recursive: true, force: true });
      throw shownWithoutCredentials(error);
    }
  }

  /** Runs the plugin's build command in its clone, and checks the files plugin.json names are there then. */
  private async built(staged: string, manifest: PluginManifest) {
    try {
      if (manifest.build) {
        const built = await run(shellCommand(manifest.build), staged, buildEnvironment(), BUILD_GIVES_UP_AFTER_MS);
        if (!built.ok) throw new HostProblemError({ code: "plugin-build-failed", command: manifest.build, output: lastPart(built.output) });
      }
      try {
        pluginFiles(staged, manifest);
      } catch (error) {
        throw new HostProblemError({ code: manifest.build ? "plugin-invalid-after-build" : "plugin-invalid-after-cloning", ...causeOf(error, messageOf(error)) });
      }
    } catch (error) {
      throw shownWithoutCredentials(error);
    }
  }

  private async refuseTakenName(name: string) {
    if (existsSync(join(this.folder, name))) throw new HostProblemError({ code: "plugin-folder-taken", name });
    for (const folder of pluginFolders(this.folder)) {
      if ((await manifestFields(folder)).name === name) throw new HostProblemError({ code: "plugin-name-taken", folder: basename(folder), name });
    }
  }

  private installedFolder(folderName: string) {
    const folder = pluginFolders(this.folder).find((each) => basename(each) === folderName);
    if (!folder) throw new HostProblemError({ code: "plugin-not-installed", folder: folderName });
    return folder;
  }

  private clonedPlugin(folderName: string) {
    const folder = this.installedFolder(folderName);
    if (isLink(folder) || !existsSync(join(folder, ".git"))) throw new HostProblemError({ code: "plugin-not-from-git", folder: folderName });
    return folder;
  }

  /** Where updates come from: the remote's releases, for a clone at a release's tag, or else its branch. */
  private async followed(folder: string): Promise<{ remote: string; branch: string; release: null } | { remote: string; branch: null; release: string }> {
    const [remote, branch] = await Promise.all([gitOutput(folder, ["remote", "get-url", "origin"]), gitOutput(folder, ["symbolic-ref", "--quiet", "--short", "HEAD"])]);
    if (remote && branch) return { remote, branch, release: null };
    const release = remote && (await releaseCheckedOut(folder));
    if (!remote || !release) throw new HostProblemError({ code: "plugin-has-nothing-to-update-from", folder: basename(folder) });
    return { remote, branch: null, release };
  }
}
