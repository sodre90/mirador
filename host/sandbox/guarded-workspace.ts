import { lstat, readdir, readFile, readlink, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { SandboxBlocker } from "../../shared/sandbox.ts";
import { git } from "../git-command.ts";

/**
 * What of a folder its agents work in the guard keeps as it is, by path from the folder with /, whether it is there or
 * not, besides what it keeps of any git folder by itself.
 */
export interface ProtectedParts {
  files: string[];
  folders: string[];
  /** Folders that stay where they are, as git's way to a file passes them. */
  onTheWay: string[];
  /** The repository's git folders, its own and its submodules'. */
  gitFolders: string[];
}

/**
 * Where Mirador itself lives on this computer, which no sandbox may see: the owner's home, its data, its own checkout;
 * and the folders this computer runs programs from by itself, which no sandbox may hold.
 */
export interface MiradorPlaces {
  home: string;
  dataDir: string;
  checkout: string;
  computersOwn: string[];
}

const kindOf = async (path: string) => {
  const stats = await lstat(path).catch(() => null);
  if (!stats) return "missing";
  if (stats.isSymbolicLink()) return "link";
  return stats.isDirectory() ? "folder" : "file";
};

export const isInside = (path: string, folder: string) => {
  const inside = relative(folder, path);
  return inside === "" || (!inside.startsWith("..") && !isAbsolute(inside));
};

export const realOrAsIs = async (path: string) => (await realpath(path).catch(() => null)) ?? resolve(path);

/** The git folders of the repository's submodules, at any depth, as `.git/modules` keeps them. */
async function submoduleGitFolders(modules: string): Promise<string[]> {
  if ((await kindOf(modules)) !== "folder") return [];
  const entries = await readdir(modules, { withFileTypes: true });
  const nested = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async ({ name }) => {
        const folder = join(modules, name);
        const isGitFolder = (await kindOf(join(folder, "HEAD"))) === "file";
        return [...(isGitFolder ? [folder] : []), ...(await submoduleGitFolders(isGitFolder ? join(folder, "modules") : folder))];
      }),
  );
  return nested.flat().toSorted();
}

/** The repository's git folders, its own and its submodules'. */
async function gitFoldersOf(workspace: string): Promise<string[]> {
  const gitFolder = join(workspace, ".git");
  return [gitFolder, ...(await submoduleGitFolders(join(gitFolder, "modules")))];
}

/** The folders of the repository's git worktrees, which their worktrees' `.git` files name. */
async function worktreeFolders(gitFolder: string): Promise<string[]> {
  const worktrees = join(gitFolder, "worktrees");
  if ((await kindOf(worktrees)) !== "folder") return [];
  return (await readdir(worktrees, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map(({ name }) => join(worktrees, name));
}

/** A worktree's folder must take its config from the repository's own: its commondir a file leading back to it, its config.worktree a file. */
async function worktreePointsElsewhere(folder: string, gitFolder: string) {
  if ((await kindOf(join(folder, "commondir"))) !== "file") return true;
  const named = (await readFile(join(folder, "commondir"), "utf8")).trim();
  const common = await realOrAsIs(resolve(folder, named));
  const configKind = await kindOf(join(folder, "config.worktree"));
  return common !== (await realOrAsIs(gitFolder)) || (configKind !== "missing" && configKind !== "file");
}

const expandedHome = (path: string) => (path === "~" || path.startsWith("~/") ? join(homedir(), path.slice(1)) : path);

/** A path as git names a file, its relative part kept as written: git hands it to the kernel as it is, `..` taken after any link. */
const namedFrom = (folder: string, path: string) => (isAbsolute(path) ? path : `${folder}/${path}`);

/** The files a config file includes, by any condition, as git names them; read from no repository, whose config, broken by a file it includes, would stop git before it reads this one. */
async function includedBy(file: string): Promise<string[]> {
  const { stdout } = await git("/", ["config", "--file", file, "--null", "--get-regexp", "^include(if\\..+)?\\.path$"]);
  return stdout
    .split("\0")
    .filter(Boolean)
    .map((entry) => namedFrom(dirname(file), expandedHome(entry.slice(entry.indexOf("\n") + 1))));
}

/** The config files git reads in the workspace now, as it names them in the origins it tells of, this computer's own included. */
async function configFilesRead(workspace: string): Promise<string[]> {
  const { stdout } = await git(workspace, ["config", "--list", "--show-origin", "--null"]);
  const origins = stdout.split("\0").filter((field) => field.startsWith("file:"));
  return [...new Set(origins.map((origin) => namedFrom(workspace, origin.slice("file:".length))))];
}

/** As many links as Linux follows on one path before it gives up; macOS follows fewer. */
const MOST_LINKS_ON_A_PATH = 40;

/** How deep git follows includes before it gives up. */
const MOST_INCLUDE_DEPTH = 10;

/**
 * The kernel's walk to a path, entry by entry, each link followed from its own folder: the entries it passes, without
 * links and as the disk spells them, the links on the way, and where it ends, the first entry that isn't there if one
 * isn't, or a file that has more of the path after it.
 */
interface Walk {
  passed: string[];
  links: string[];
  ends: string;
  missing: boolean;
}

async function walkTo(path: string): Promise<Walk> {
  const passed: string[] = [];
  const links: string[] = [];
  let at = "/";
  let ahead = path.split("/");
  while (ahead.length > 0) {
    const [step, ...rest] = ahead as [string, ...string[]];
    ahead = rest;
    if (step === "" || step === ".") continue;
    if (step === "..") {
      at = dirname(at);
      continue;
    }
    const next = join(at, step);
    const kind = await kindOf(next);
    if (kind === "missing" || (kind === "link" && links.length === MOST_LINKS_ON_A_PATH)) return { passed, links, ends: next, missing: true };
    if (kind === "link") {
      links.push(next);
      const target = await readlink(next);
      if (isAbsolute(target)) at = "/";
      ahead = [...target.split("/"), ...ahead];
      continue;
    }
    const real = await realpath(next).catch(() => null);
    const pathGoesOn = ahead.some((later) => later !== "");
    if (!real || (kind === "file" && pathGoesOn)) return { passed, links, ends: next, missing: true };
    passed.push(real);
    at = real;
  }
  return { passed, links, ends: at, missing: false };
}

/** What the kernel takes on its way to a path, as far as it gets: the folders and links there, the last of them where it ends; and which of them are links. */
export interface WayTo {
  places: string[];
  links: string[];
}

export async function wayTo(path: string): Promise<WayTo> {
  const { passed, links, ends } = await walkTo(path);
  return { places: [...passed, ...links, ends], links };
}

/** What of the workspace git's walks to the config files it reads take: the files there, to be protected, and the folders on the way, so none can be moved aside. */
interface IncludedParts {
  files: string[];
  folders: string[];
}

type Included = IncludedParts | { refused: SandboxBlocker };

const NOTHING_INCLUDED: IncludedParts = { files: [], folders: [] };

function together(each: Included[]): Included {
  const refused = each.find((included) => "refused" in included);
  if (refused) return refused;
  const parts = each as IncludedParts[];
  return { files: [...new Set(parts.flatMap(({ files }) => files))], folders: [...new Set(parts.flatMap(({ folders }) => folders))] };
}

const shownFrom = (workspace: string, path: string) => (isInside(path, workspace) ? relative(workspace, path).split(sep).join("/") : path);

const isRegularFile = async (path: string) => (await lstat(path).catch(() => null))?.isFile() === true;

/**
 * What git's walk to a config file, as git names it, takes of the workspace; or why the VM could make that file or
 * change it, as it could where a link is on a way that passes the workspace, a file of it isn't there, or isn't a
 * regular file. Nothing where the walk keeps out of the workspace.
 */
async function partsOnTheWayTo(workspace: string, named: string): Promise<Included> {
  const walk = await walkTo(named);
  const ofWorkspace = (path: string) => path !== workspace && isInside(path, workspace);
  if (![...walk.passed, ...walk.links, walk.ends].some(ofWorkspace)) return NOTHING_INCLUDED;
  const file = shownFrom(workspace, resolve(named));
  if (walk.links[0]) return { refused: { kind: "config-read-through-link", file, link: shownFrom(workspace, walk.links[0]) } };
  const folders = walk.passed.filter((path) => path !== walk.ends && ofWorkspace(path));
  if (walk.missing) return ofWorkspace(walk.ends) ? { refused: { kind: "config-includes-missing-file", file } } : { files: [], folders };
  if (!ofWorkspace(walk.ends)) return { files: [], folders };
  return (await isRegularFile(walk.ends)) ? { files: [walk.ends], folders } : { refused: { kind: "config-includes-not-a-file", file } };
}

/** What of the workspace the walks to the files these config files include take, at any depth and by any condition. */
async function partsIncludedBy(workspace: string, configFiles: string[], seen: Set<string>, depth = 0): Promise<Included> {
  const unread = configFiles.filter((file) => !seen.has(file));
  if (unread.length === 0 || depth > MOST_INCLUDE_DEPTH) return NOTHING_INCLUDED;
  unread.forEach((file) => seen.add(file));
  const included = [...new Set((await Promise.all(unread.map(includedBy))).flat())];
  const walked = await Promise.all(included.map((named) => partsOnTheWayTo(workspace, named)));
  return together([...walked, await partsIncludedBy(workspace, included, seen, depth + 1)]);
}

/** The repository's own config files, which the guard protects by itself: its git folders' and its worktrees' per-worktree config. */
async function ownConfigFiles(workspace: string): Promise<string[]> {
  const [gitFolders, worktrees] = await Promise.all([gitFoldersOf(workspace), worktreeFolders(join(workspace, ".git"))]);
  return [...gitFolders.flatMap((folder) => [join(folder, "config"), join(folder, "config.worktree")]), ...worktrees.map((folder) => join(folder, "config.worktree"))];
}

/**
 * What of the workspace the config files git reads there take, the repository's own aside: the files of it that they
 * are, or that they include at any depth and by any condition, which the VM could otherwise write and so make config
 * of its own, and the folders git's walk to each passes.
 */
async function includedWorkspaceParts(workspace: string): Promise<Included> {
  const own = await ownConfigFiles(workspace);
  const present = (await Promise.all(own.map(async (file) => ((await kindOf(file)) === "file" ? [file] : [])))).flat();
  const read = await configFilesRead(workspace);
  const readElsewhere = await Promise.all(read.filter((file) => !own.includes(file)).map((file) => partsOnTheWayTo(workspace, file)));
  return together([...readElsewhere, await partsIncludedBy(workspace, [...new Set([...present, ...read])], new Set())]);
}

/**
 * Why Mirador's own places keep the workspace from a sandbox: the home folder, a folder holding or within Mirador's
 * data or checkout, or one that is or holds a folder this computer runs programs from by itself.
 */
export async function miradorsOwn(workspace: string, places: MiradorPlaces): Promise<SandboxBlocker | null> {
  const [home, dataDir, checkout] = await Promise.all([places.home, places.dataDir, places.checkout].map(realOrAsIs));
  if (workspace === home) return { kind: "workspace-is-home" };
  if (isInside(dataDir!, workspace) || isInside(workspace, dataDir!)) return { kind: "workspace-holds-mirador-data" };
  if (isInside(checkout!, workspace) || isInside(workspace, checkout!)) return { kind: "workspace-is-mirador" };
  const computersOwn = await Promise.all(places.computersOwn.map(realOrAsIs));
  const held = computersOwn.find((folder) => isInside(folder, workspace));
  return held ? { kind: "workspace-holds-computers-own", folder: held } : null;
}

/** The first of the git folders' parts the guard protects that is a link, from the workspace; null where none is. */
async function linkedGitPart(workspace: string, gitFolders: string[]): Promise<string | null> {
  const parts = gitFolders.flatMap((folder, index) => [...(index === 0 ? ["worktrees", "modules"] : []), "hooks", "config", "config.worktree", "commondir"].map((name) => join(folder, name)));
  const kinds = await Promise.all(parts.map(kindOf));
  const linked = parts.find((_, index) => kinds[index] === "link");
  return linked ? relative(workspace, linked).split(sep).join("/") : null;
}

async function gitFolderRefusal(workspace: string, gitFolder: string): Promise<SandboxBlocker | null> {
  const gitFolders = await gitFoldersOf(workspace);
  const linked = await linkedGitPart(workspace, gitFolders);
  if (linked) return { kind: "part-is-link", part: linked };
  const pointsElsewhere = await Promise.all(gitFolders.map(async (folder) => (await kindOf(join(folder, "commondir"))) !== "missing"));
  if (pointsElsewhere.some(Boolean)) return { kind: "workspace-has-commondir" };
  const worktrees = await worktreeFolders(gitFolder);
  for (const folder of worktrees) if (await worktreePointsElsewhere(folder, gitFolder)) return { kind: "worktree-points-elsewhere", worktree: relative(gitFolder, folder).split(sep).join("/") };
  return null;
}

async function workspaceRefusal(workspace: string, places: MiradorPlaces): Promise<SandboxBlocker | null> {
  const own = await miradorsOwn(workspace, places);
  if (own) return own;
  const gitFolder = join(workspace, ".git");
  const gitKind = await kindOf(gitFolder);
  if (gitKind === "file" || gitKind === "link") return { kind: "workspace-is-worktree" };
  if (gitKind === "missing") return { kind: "workspace-not-a-repository" };
  return gitFolderRefusal(workspace, gitFolder);
}

/** The workspace, without links, with what of it git's config takes; or why it can't be shown to a sandbox. Looked at without changing anything. */
async function inspected(givenWorkspace: string, places: MiradorPlaces): Promise<{ workspace: string; included: IncludedParts } | { refused: SandboxBlocker }> {
  const workspace = await realOrAsIs(givenWorkspace);
  const refused = await workspaceRefusal(workspace, places);
  if (refused) return { refused };
  const included = await includedWorkspaceParts(workspace);
  return "refused" in included ? included : { workspace, included };
}

/** Why the workspace can't be shown to a sandbox, looked at without changing anything; null where it can. */
export async function sandboxRefusalOf(givenWorkspace: string, places: MiradorPlaces): Promise<SandboxBlocker | null> {
  const found = await inspected(givenWorkspace, places);
  return "refused" in found ? found.refused : null;
}

/** The hooks folder git takes from this computer's config or the repository's, a relative one taken from the workspace, as `-c` names none. */
async function configuredHooksFolder(workspace: string): Promise<string | null> {
  const { stdout, exitCode } = await git(workspace, ["config", "--includes", "--show-scope", "--null", "--get-all", "core.hooksPath"]);
  if (exitCode !== 0) return null;
  const fields = stdout.split("\0");
  const named = fields.flatMap((scope, index) => (index % 2 === 0 && scope !== "command" && fields[index + 1] ? [fields[index + 1]!] : [])).at(-1);
  return named ? resolve(workspace, expandedHome(named)) : null;
}

/**
 * The hooks folder the config names inside the workspace, as husky's, there or not, which the VM could otherwise write;
 * null where it names none there. A link on the way there would lead git past what the guard protects, as a file would
 * that stands where a folder should be.
 */
async function configuredHooksInside(workspace: string): Promise<string | null | { refused: SandboxBlocker }> {
  const named = await configuredHooksFolder(workspace);
  if (!named) return null;
  const walk = await walkTo(named);
  const ofWorkspace = (path: string) => path !== workspace && isInside(path, workspace);
  if (![...walk.passed, ...walk.links, walk.ends].some(ofWorkspace)) return null;
  if (walk.links[0]) return { refused: { kind: "part-is-link", part: shownFrom(workspace, walk.links[0]) } };
  if (!ofWorkspace(named)) return null;
  const endsAsIs = await kindOf(walk.ends);
  const isOrCanBeFolder = endsAsIs === "folder" || (walk.missing && endsAsIs === "missing");
  return isOrCanBeFolder ? (walk.missing ? named : walk.ends) : { refused: { kind: "part-is-link", part: shownFrom(workspace, walk.ends) } };
}

/**
 * What of the workspace the guard protects, as it would run on this computer or is the owner's: the files of the
 * workspace git's config includes, the hooks folder it names there, and the held files and folders; with the folders
 * git's way to them passes, and the repository's git folders, of which the guard protects what git runs programs from.
 * A workspace with no repository of its own is not shown to a sandbox, so that the owner sees and undoes what its agents
 * change; nor is a git worktree, whose repository lies elsewhere, nor a git folder that takes another's config with
 * `commondir`, nor a config that includes a file of the workspace that isn't there, or reaches one through a link.
 */
export async function protectedPartsOf(givenWorkspace: string, places: MiradorPlaces, held: string[] = []): Promise<{ parts: ProtectedParts } | { refused: SandboxBlocker }> {
  const found = await inspected(givenWorkspace, places);
  if ("refused" in found) return found;
  const { workspace, included } = found;
  const hooks = await configuredHooksInside(workspace);
  if (hooks !== null && typeof hooks !== "string") return hooks;
  const heldKinds = await Promise.all(held.map(async (path) => ({ path, kind: await kindOf(join(workspace, path)) })));
  const heldOf = (folders: boolean) => heldKinds.filter(({ kind }) => (kind === "folder") === folders).map(({ path }) => path);
  const fromWorkspace = (paths: string[]) => paths.map((path) => shownFrom(workspace, path));
  return {
    parts: {
      files: [...fromWorkspace(included.files), ...heldOf(false)],
      folders: [...fromWorkspace(hooks === null ? [] : [hooks]), ...heldOf(true)],
      onTheWay: fromWorkspace(included.folders),
      gitFolders: fromWorkspace(await gitFoldersOf(workspace)),
    },
  };
}

/** The entry of the disk at the path, where no link leads to it; null otherwise. */
export async function entryOf(path: string): Promise<string | null> {
  const real = await realpath(path).catch(() => null);
  const stats = await lstat(path, { bigint: true }).catch(() => null);
  return stats && real === path ? `${stats.dev}:${stats.ino}` : null;
}
