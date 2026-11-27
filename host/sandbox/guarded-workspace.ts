import { lstat, readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { SandboxBlocker } from "../../shared/sandbox.ts";
import { configFilesRead, GitConfigFiles, hooksFolderNamed, ownersConfigFiles } from "./git-config-files.ts";
import { LookedAt } from "./looked-at.ts";
import { isInside, isRegularFile, kindOf, realOrAsIs, walkTo } from "./paths-on-disk.ts";
import { configFilesIn, configFilesOf, isBare, isGuardedInPlace, repositoriesIn, submoduleGitFolders, worktreeFolders } from "./repositories-in.ts";

/**
 * What of a folder its agents work in the guard keeps as it is, by path from the folder with /, whether it is there or
 * not, besides what it keeps of any git folder by itself.
 */
export interface ProtectedParts {
  files: string[];
  folders: string[];
  /** Folders that stay where they are, as git's way to a file passes them. */
  onTheWay: string[];
  /** The git folders that git works in: the repository's own, those of bare repositories in it, and all their submodules'. */
  gitFolders: string[];
}

/** What git working in a folder reads or runs by whole path, wherever it is: the config files it reads, and the hooks folders its config names. */
export interface NamedByGit {
  configFiles: string[];
  hooksFolders: string[];
}

/** A plan of what the guard protects, what git there names by whole path, and what it was made from. */
export interface GuardPlan {
  parts: ProtectedParts;
  named: NamedByGit;
  lookedAt: LookedAt;
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

/** A worktree's folder must take its config from the repository's own: its commondir a file leading back to it, its config.worktree a file. */
async function worktreePointsElsewhere(folder: string, gitFolder: string) {
  if ((await kindOf(join(folder, "commondir"))) !== "file") return true;
  const named = (await readFile(join(folder, "commondir"), "utf8")).trim();
  const common = await realOrAsIs(resolve(folder, named));
  const configKind = await kindOf(join(folder, "config.worktree"));
  return common !== (await realOrAsIs(gitFolder)) || (configKind !== "missing" && configKind !== "file");
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
  const parts = gitFolders.flatMap((folder) => ["worktrees", "modules", "hooks", "config", "config.worktree", "commondir"].map((name) => join(folder, name)));
  const kinds = await Promise.all(parts.map(kindOf));
  const linked = parts.find((_, index) => kinds[index] === "link");
  return linked ? shownFrom(workspace, linked) : null;
}

/** Why the workspace's own repository takes its config from where the guard doesn't keep it as it is; null where it doesn't. */
async function ownRepositoryRefusal(gitFolder: string, submodules: string[], worktrees: string[]): Promise<SandboxBlocker | null> {
  const pointsElsewhere = await Promise.all([gitFolder, ...submodules].map(async (folder) => (await kindOf(join(folder, "commondir"))) !== "missing"));
  if (pointsElsewhere.some(Boolean)) return { kind: "workspace-has-commondir" };
  for (const folder of worktrees) if (await worktreePointsElsewhere(folder, gitFolder)) return { kind: "worktree-points-elsewhere", worktree: relative(gitFolder, folder).split(sep).join("/") };
  return null;
}

async function workspaceRefusal(workspace: string, places: MiradorPlaces): Promise<SandboxBlocker | null> {
  const own = await miradorsOwn(workspace, places);
  if (own) return own;
  const gitKind = await kindOf(join(workspace, ".git"));
  if (gitKind === "file" || gitKind === "link") return { kind: "workspace-is-worktree" };
  return gitKind === "missing" ? { kind: "workspace-not-a-repository" } : null;
}

/**
 * The folder of the workspace a repository's config names its hooks folder, as husky's, there or not, which the VM could
 * otherwise write; null where it names none there. A link on the way there would lead git past what the guard protects,
 * as a file would that stands where a folder should be; and kept as it is, one that holds a repository, its working tree
 * or git folder, would keep agents from working there.
 */
async function hooksFolderInside(workspace: string, named: string, repositories: string[]): Promise<string | null | { refused: SandboxBlocker }> {
  const walk = await walkTo(named);
  const folder = walk.missing ? resolve(named) : walk.ends;
  if (folder === workspace) return { refused: { kind: "hooks-folder-holds-repository", folder: "." } };
  const ofWorkspace = (path: string) => path !== workspace && isInside(path, workspace);
  if (![...walk.passed, ...walk.links, walk.ends].some(ofWorkspace)) return null;
  if (walk.links[0]) return { refused: { kind: "part-is-link", part: shownFrom(workspace, walk.links[0]) } };
  if (!ofWorkspace(folder)) return null;
  const endsAsIs = await kindOf(walk.ends);
  const isOrCanBeFolder = endsAsIs === "folder" || (walk.missing && endsAsIs === "missing");
  if (!isOrCanBeFolder) return { refused: { kind: "part-is-link", part: shownFrom(workspace, walk.ends) } };
  const holdsRepository = repositories.some((repository) => isInside(repository, folder));
  return holdsRepository ? { refused: { kind: "hooks-folder-holds-repository", folder: shownFrom(workspace, folder) } } : folder;
}

/** What of the workspace git reads or runs, by whole path: the files its config includes, the hooks folders it names, the folders on the way, and the git folders git works in; and all git names, there or not. */
interface GitsParts extends IncludedParts {
  hooks: string[];
  gitFolders: string[];
  named: NamedByGit;
}

/** All config files git may read in a repository, its own, this computer's, and those they include at any depth and by any condition; and the top of its working tree, null where that isn't in the workspace. */
interface Configured {
  top: string | null;
  configFiles: string[];
}

async function hooksFoldersInside(workspace: string, named: string[], repositories: string[], lookedAt: LookedAt): Promise<string[] | { refused: SandboxBlocker }> {
  await Promise.all(named.map((folder) => lookedAt.entry(folder)));
  const found = await Promise.all([...new Set(named)].map((folder) => hooksFolderInside(workspace, folder, repositories)));
  const refused = found.find((each) => each !== null && typeof each !== "string");
  return refused ?? [...new Set(found.filter((each) => typeof each === "string"))].toSorted();
}

/**
 * What of the workspace git reads or runs, in the workspace's own repository, in those nested in it, and in their
 * submodules and worktrees; or why a VM could change some of it.
 */
async function gitsPartsOf(workspace: string, lookedAt: LookedAt): Promise<GitsParts | { refused: SandboxBlocker }> {
  const [own, ...nested] = await repositoriesIn(workspace, lookedAt);
  const guarded = [own, ...nested.filter(isGuardedInPlace)].map(({ gitFolder }) => gitFolder);
  const [ownSubmodules, ...nestedSubmodules] = await Promise.all(guarded.map((folder) => submoduleGitFolders(join(folder, "modules"), lookedAt)));
  const submodules = [ownSubmodules!, ...nestedSubmodules].flat();
  const gitFolders = [...guarded, ...submodules];
  const worktrees = await Promise.all(guarded.map((folder) => worktreeFolders(folder, lookedAt)));

  const linked = await linkedGitPart(workspace, gitFolders);
  if (linked) return { refused: { kind: "part-is-link", part: linked } };
  const refused = await ownRepositoryRefusal(own.gitFolder, ownSubmodules!, worktrees[0]!);
  if (refused) return { refused };

  const read = await configFilesRead(workspace);
  const computers = [...read.filter(({ ofThisComputer }) => ofThisComputer).map(({ file }) => file), ...ownersConfigFiles()];
  const config = new GitConfigFiles(lookedAt);
  const configured = async (top: string | null, gitFolder: string): Promise<Configured> => {
    const files = [...(await configFilesOf(gitFolder, lookedAt)), ...computers, ...(top === workspace ? read.map(({ file }) => file) : [])];
    return { top, configFiles: await config.withIncluded([...new Set(files)]) };
  };
  const all = await Promise.all([
    ...[own, ...nested].map(({ top, gitFolder }) => configured(top, gitFolder)),
    ...[...submodules, ...worktrees.flat()].map((folder) => configured(null, folder)),
  ]);

  const guardedByName = new Set([...gitFolders, ...worktrees.flat()].flatMap(configFilesIn));
  const readElsewhere = new Set(all.flatMap(({ configFiles }) => configFiles).filter((file) => !guardedByName.has(file)));
  const included = together(await Promise.all([...readElsewhere].map((file) => partsOnTheWayTo(workspace, file))));
  if ("refused" in included) return included;

  const hooksNamedBy = async ({ top, configFiles }: Configured) => (await config.hooksFoldersNamedIn(configFiles)).flatMap((value) => hooksFolderNamed(top, value) ?? []);
  const hooksNamed = (await Promise.all(all.map(hooksNamedBy))).flat();
  const hooks = await hooksFoldersInside(workspace, hooksNamed, [...gitFolders, ...nested.map(({ top }) => top)], lookedAt);
  if (!Array.isArray(hooks)) return hooks;
  const named = { configFiles: [...readElsewhere].toSorted(), hooksFolders: [...new Set(hooksNamed)].toSorted() };
  return { ...included, hooks, gitFolders: [own.gitFolder, ...nested.filter(isBare).map(({ gitFolder }) => gitFolder), ...submodules], named };
}

/** The workspace, without links, with what of it git reads or runs; or why it can't be shown to a sandbox. Looked at without changing anything. */
async function inspected(givenWorkspace: string, places: MiradorPlaces, lookedAt: LookedAt): Promise<{ workspace: string; gits: GitsParts } | { refused: SandboxBlocker }> {
  const workspace = await realOrAsIs(givenWorkspace);
  const refused = await workspaceRefusal(workspace, places);
  if (refused) return { refused };
  const gits = await gitsPartsOf(workspace, lookedAt);
  return "refused" in gits ? gits : { workspace, gits };
}

/** Why the workspace can't be shown to a sandbox, looked at without changing anything; null where it can. */
export async function sandboxRefusalOf(givenWorkspace: string, places: MiradorPlaces): Promise<SandboxBlocker | null> {
  const found = await inspected(givenWorkspace, places, new LookedAt());
  return "refused" in found ? found.refused : null;
}

/**
 * What of the workspace the guard protects, as it would run on this computer or is the owner's: the files of the
 * workspace git's config includes, the hooks folders it names there, and the held files and folders; with the folders
 * git's way to them passes, and the git folders git works in, of which the guard protects what git runs programs from.
 * A workspace with no repository of its own is not shown to a sandbox, so that the owner sees and undoes what its agents
 * change; nor is a git worktree, whose repository lies elsewhere, nor a git folder that takes another's config with
 * `commondir`, nor a config that includes a file of the workspace that isn't there, or reaches one through a link, or
 * that names a hooks folder that holds a repository.
 */
export async function guardPlanOf(givenWorkspace: string, places: MiradorPlaces, held: string[] = []): Promise<GuardPlan | { refused: SandboxBlocker }> {
  const lookedAt = new LookedAt();
  const found = await inspected(givenWorkspace, places, lookedAt);
  if ("refused" in found) return found;
  const { workspace, gits } = found;
  const heldKinds = await Promise.all(held.map(async (path) => ({ path, kind: await kindOf(join(workspace, path)) })));
  const heldOf = (folders: boolean) => heldKinds.filter(({ kind }) => (kind === "folder") === folders).map(({ path }) => path);
  const fromWorkspace = (paths: string[]) => paths.map((path) => shownFrom(workspace, path));
  return {
    parts: {
      files: [...fromWorkspace(gits.files), ...heldOf(false)],
      folders: [...fromWorkspace(gits.hooks), ...heldOf(true)],
      onTheWay: fromWorkspace(gits.folders),
      gitFolders: fromWorkspace(gits.gitFolders),
    },
    named: gits.named,
    lookedAt,
  };
}

/**
 * What of `folder` the git of a sandbox's other folders read and write reads or runs, as their config names it by whole
 * path, for the guard of `folder` to keep as it is too; or why the VM could change it, as it could a file that isn't
 * there or that a link leads to. `gitFolders` are the folder's own, by path from it, which no hooks folder may hold.
 */
export async function partsNamedFrom(folder: string, others: NamedByGit[], gitFolders: string[]): Promise<ProtectedParts | { refused: SandboxBlocker }> {
  const configFiles = [...new Set(others.flatMap(({ configFiles }) => configFiles))];
  const included = together(await Promise.all(configFiles.map((file) => partsOnTheWayTo(folder, file))));
  if ("refused" in included) return { refused: withWholePaths(included.refused, folder) };
  const hooksFolders = [...new Set(others.flatMap(({ hooksFolders }) => hooksFolders))];
  const hooks = await hooksFoldersInside(folder, hooksFolders, gitFolders.map((path) => join(folder, path)), new LookedAt());
  if (!Array.isArray(hooks)) return { refused: withWholePaths(hooks.refused, folder) };
  const fromFolder = (paths: string[]) => paths.map((path) => shownFrom(folder, path));
  return { files: fromFolder(included.files), folders: fromFolder(hooks), onTheWay: fromFolder(included.folders), gitFolders: [] };
}

const wholeFrom = (folder: string, path: string) => (isAbsolute(path) ? path : path === "." ? folder : join(folder, path));

/** The blocker with the paths it names from the folder named by whole path, as another folder's config is what names them. */
function withWholePaths(blocker: SandboxBlocker, folder: string): SandboxBlocker {
  switch (blocker.kind) {
    case "config-read-through-link":
      return { ...blocker, file: wholeFrom(folder, blocker.file), link: wholeFrom(folder, blocker.link) };
    case "config-includes-missing-file":
    case "config-includes-not-a-file":
      return { ...blocker, file: wholeFrom(folder, blocker.file) };
    case "hooks-folder-holds-repository":
      return { ...blocker, folder: wholeFrom(folder, blocker.folder) };
    case "part-is-link":
      return { ...blocker, part: wholeFrom(folder, blocker.part) };
    default:
      return blocker;
  }
}

/** What a guard keeps as it is that keeps both `parts` and `more`. */
export const withMoreParts = (parts: ProtectedParts, more: ProtectedParts): ProtectedParts => ({
  files: [...new Set([...parts.files, ...more.files])],
  folders: [...new Set([...parts.folders, ...more.folders])],
  onTheWay: [...new Set([...parts.onTheWay, ...more.onTheWay])],
  gitFolders: [...new Set([...parts.gitFolders, ...more.gitFolders])],
});

const isUnder = (path: string, folder: string) => path === folder || path.startsWith(`${folder}/`);

/** Whether a guard that protects `parts` protects all of `others` too. */
export function protects(parts: ProtectedParts, others: ProtectedParts): boolean {
  const named = [...parts.files, ...parts.folders, ...parts.onTheWay, ...parts.gitFolders];
  const isProtected = (path: string) => parts.files.includes(path) || parts.folders.some((folder) => isUnder(path, folder));
  const staysInPlace = (path: string) => isProtected(path) || named.some((each) => isUnder(each, path));
  const isGitFolder = (path: string) => isProtected(path) || parts.gitFolders.includes(path);
  return [...others.files, ...others.folders].every(isProtected) && others.onTheWay.every(staysInPlace) && others.gitFolders.every(isGitFolder);
}
