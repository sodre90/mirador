import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { SandboxBlocker } from "../../shared/sandbox.ts";
import { git } from "../git-command.ts";

/** A folder or file of this Mac shown in the VM at `target`, read-only or not. */
export interface Mount {
  source: string;
  target: string;
  readOnly: boolean;
}

export type WorkspaceMounts = { mounts: Mount[] } | { refused: SandboxBlocker };

/** Where Mirador itself lives on this computer, which no sandbox may see: the owner's home, its data, its own checkout. */
export interface MiradorPlaces {
  home: string;
  dataDir: string;
  checkout: string;
}

const atItsOwnPath = (path: string, readOnly: boolean): Mount => ({ source: path, target: path, readOnly });

const kindOf = async (path: string) => {
  const stats = await lstat(path).catch(() => null);
  if (!stats) return "missing";
  if (stats.isSymbolicLink()) return "link";
  return stats.isDirectory() ? "folder" : "file";
};

const isInside = (path: string, folder: string) => {
  const inside = relative(folder, path);
  return inside === "" || (!inside.startsWith("..") && !isAbsolute(inside));
};

const realOrAsIs = async (path: string) => (await realpath(path).catch(() => null)) ?? resolve(path);

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
  return nested.flat();
}

/** The repository's git folders, its own and its submodules', from the workspace with /: those whose files would point git elsewhere. */
export async function gitFoldersOf(workspace: string): Promise<string[]> {
  const gitFolder = join(workspace, ".git");
  return [gitFolder, ...(await submoduleGitFolders(join(gitFolder, "modules")))].map((folder) => relative(workspace, folder).split(sep).join("/"));
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

/** The files a config file includes, by any condition, as git would find them. */
async function includedBy(file: string): Promise<string[]> {
  const { stdout } = await git(dirname(file), ["config", "--file", file, "--null", "--get-regexp", "^include(if\\..+)?\\.path$"]);
  return stdout
    .split("\0")
    .filter(Boolean)
    .map((entry) => resolve(dirname(file), expandedHome(entry.slice(entry.indexOf("\n") + 1))));
}

/** The config files git reads in the workspace now, from the origins it tells of them, this Mac's own included. */
async function configFilesRead(workspace: string): Promise<string[]> {
  const { stdout } = await git(workspace, ["config", "--list", "--show-origin", "--null"]);
  const origins = stdout.split("\0").filter((field) => field.startsWith("file:"));
  return [...new Set(origins.map((origin) => resolve(workspace, origin.slice("file:".length))))];
}

/**
 * A file of the workspace that a config file git reads includes, at any depth and by any condition: one the VM could
 * write, and so make config of its own. Null where there is none.
 */
async function includedWorkspaceFile(workspace: string, configFiles: string[]): Promise<string | null> {
  const seen = new Set<string>();
  let reading = configFiles;
  for (let depth = 0; depth <= 10 && reading.length > 0; depth++) {
    const included = (await Promise.all(reading.filter((file) => !seen.has(file)).map(includedBy))).flat();
    reading.forEach((file) => seen.add(file));
    for (const file of included) if (isInside(file, workspace) || isInside(await realOrAsIs(file), workspace)) return relative(workspace, file).split(sep).join("/");
    reading = included;
  }
  return null;
}

/** Why Mirador's own places keep the workspace from a sandbox: the home folder, or a folder holding or within Mirador's data or checkout. */
async function miradorsOwn(workspace: string, places: MiradorPlaces): Promise<SandboxBlocker | null> {
  const [home, dataDir, checkout] = await Promise.all([places.home, places.dataDir, places.checkout].map(realOrAsIs));
  if (workspace === home) return { kind: "workspace-is-home" };
  if (isInside(dataDir!, workspace) || isInside(workspace, dataDir!)) return { kind: "workspace-holds-mirador-data" };
  if (isInside(checkout!, workspace) || isInside(workspace, checkout!)) return { kind: "workspace-is-mirador" };
  return null;
}

/** The first of the git folders' parts Mirador copies or mounts that is a link, from the workspace; null where none is. */
async function linkedGitPart(workspace: string, gitFolders: string[]): Promise<string | null> {
  const parts = gitFolders.flatMap((folder, index) => [...(index === 0 ? ["worktrees", "modules"] : []), "hooks", "config", "config.worktree", "commondir"].map((name) => join(folder, name)));
  const kinds = await Promise.all(parts.map(kindOf));
  const linked = parts.find((_, index) => kinds[index] === "link");
  return linked ? relative(workspace, linked).split(sep).join("/") : null;
}

async function gitConfigRefusal(workspace: string, gitFolder: string): Promise<SandboxBlocker | null> {
  const gitFolders = [gitFolder, ...(await submoduleGitFolders(join(gitFolder, "modules")))];
  const linked = await linkedGitPart(workspace, gitFolders);
  if (linked) return { kind: "part-is-link", part: linked };
  const pointsElsewhere = await Promise.all(gitFolders.map(async (folder) => (await kindOf(join(folder, "commondir"))) !== "missing"));
  if (pointsElsewhere.some(Boolean)) return { kind: "workspace-has-commondir" };
  const worktrees = await worktreeFolders(gitFolder);
  for (const folder of worktrees) if (await worktreePointsElsewhere(folder, gitFolder)) return { kind: "worktree-points-elsewhere", worktree: relative(gitFolder, folder).split(sep).join("/") };
  const ownConfigs = [...gitFolders.flatMap((folder) => [join(folder, "config"), join(folder, "config.worktree")]), ...worktrees.map((folder) => join(folder, "config.worktree"))];
  const present = (await Promise.all(ownConfigs.map(async (file) => ((await kindOf(file)) === "file" ? [file] : [])))).flat();
  const included = await includedWorkspaceFile(workspace, [...new Set([...present, ...(await configFilesRead(workspace))])]);
  return included ? { kind: "config-includes-workspace-file", file: included } : null;
}

/** Why the workspace can't be shown to a sandbox, looked at without changing anything; null where it can. */
export async function sandboxRefusalOf(givenWorkspace: string, places: MiradorPlaces): Promise<SandboxBlocker | null> {
  const workspace = await realOrAsIs(givenWorkspace);
  const own = await miradorsOwn(workspace, places);
  if (own) return own;
  const gitFolder = join(workspace, ".git");
  const gitKind = await kindOf(gitFolder);
  if (gitKind === "file" || gitKind === "link") return { kind: "workspace-is-worktree" };
  if (gitKind === "missing") return { kind: "workspace-not-a-repository" };
  return gitConfigRefusal(workspace, gitFolder);
}

/** The file's bytes into `copy`, never through a link, and only from a regular file: no link swapped in meanwhile, nor a pipe that would never end. */
async function copyRegularFile(original: string, copy: string) {
  const handle = await open(original, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) throw new Error(`${original} is not a regular file.`);
    await writeFile(copy, await handle.readFile(), { mode: stats.mode & 0o777 });
  } finally {
    await handle.close();
  }
}

/** Whether git reads the git folder's `config.worktree` too, which the VM could make where there is none yet. */
async function readsWorktreeConfig(gitFolder: string) {
  const { stdout } = await git(gitFolder, ["config", "--file", join(gitFolder, "config"), "--bool", "--get", "extensions.worktreeConfig"]);
  return stdout.trim() === "true";
}

/**
 * What of a git folder the VM may only read: its hooks and its worktrees' folders, made here when it has none, and its
 * config and per-worktree config, as copies taken now, an empty per-worktree config made first where git would read one. A file mounted from its own folder would take the place of that
 * folder's mount, which keeps the folder from being moved aside and made anew, writable.
 */
async function readOnlyPartsOf(gitFolder: string, copies: string, isTopRepository: boolean): Promise<Mount[]> {
  const folders = isTopRepository ? ["hooks", "worktrees"] : ["hooks"];
  await Promise.all(folders.map((name) => mkdir(join(gitFolder, name), { recursive: true })));
  if ((await readsWorktreeConfig(gitFolder)) && (await kindOf(join(gitFolder, "config.worktree"))) === "missing") await writeFile(join(gitFolder, "config.worktree"), "");
  const configs = await Promise.all(
    ["config", "config.worktree"].map(async (name) => {
      const original = join(gitFolder, name);
      if ((await kindOf(original)) !== "file") return [];
      const copy = join(copies, crypto.randomUUID(), name);
      await mkdir(dirname(copy), { recursive: true, mode: 0o700 });
      await copyRegularFile(original, copy);
      return [{ source: copy, target: original, readOnly: true }];
    }),
  );
  return [...folders.map((name) => atItsOwnPath(join(gitFolder, name), true)), ...configs.flat()];
}

/** The outermost of the read-only mounts, each once: one inside another is read-only already. */
function outermostOf(mounts: Mount[]) {
  const byTarget = [...new Map(mounts.map((mount) => [mount.target, mount])).values()];
  return byTarget.filter(({ target }) => !byTarget.some((other) => other.target !== target && isInside(target, other.target)));
}

/**
 * Each folder between the workspace and a read-only mount, mounted at its own path too: a mount can't be moved, so no
 * folder holding a read-only part can be moved aside, with that part, and made anew without it.
 */
function foldersHolding(workspace: string, readOnly: Mount[]): Mount[] {
  const folders = readOnly.flatMap(({ target }) => {
    const holding: string[] = [];
    for (let folder = dirname(target); folder !== workspace && folder.startsWith(`${workspace}${sep}`); folder = dirname(folder)) holding.push(folder);
    return holding;
  });
  return [...new Set(folders)].map((folder) => atItsOwnPath(folder, false));
}

/** The hooks folder git takes from this Mac's config or the repository's, a relative one taken from the workspace, as `-c` names none. */
async function configuredHooksFolder(workspace: string): Promise<string | null> {
  const { stdout, exitCode } = await git(workspace, ["config", "--includes", "--show-scope", "--null", "--get-all", "core.hooksPath"]);
  if (exitCode !== 0) return null;
  const fields = stdout.split("\0");
  const named = fields.flatMap((scope, index) => (index % 2 === 0 && scope !== "command" && fields[index + 1] ? [fields[index + 1]!] : [])).at(-1);
  return named ? resolve(workspace, expandedHome(named)) : null;
}

/**
 * A hooks folder the config names inside the workspace, as husky's, which the VM could otherwise write: made where it is
 * not there yet, and mounted where it truly is, never through a link.
 */
async function configuredHooksInside(workspace: string): Promise<Mount[]> {
  const named = await configuredHooksFolder(workspace);
  if (!named || !isInside(named, workspace) || named === workspace) return [];
  await mkdir(named, { recursive: true }).catch(() => {});
  const real = await realpath(named).catch(() => null);
  return real && real !== workspace && isInside(real, workspace) && (await kindOf(real)) === "folder" ? [atItsOwnPath(real, true)] : [];
}

/**
 * The workspace at its own path, with what of it would run on this Mac read-only: the config, hooks and worktrees'
 * folders of the repository, its submodules' config and hooks, the config as copies kept in `copies`, the held files
 * and folders there are, and every folder holding them mounted too, so that none can be moved aside. A workspace with
 * no repository of its own is not shown to a sandbox: the agents could make one there, with a config of their own that
 * Mirador's git would read. Nor is a git worktree, whose repository lies elsewhere, nor a git folder that takes
 * another's config with `commondir` or includes a file of the workspace.
 */
export async function workspaceMounts(givenWorkspace: string, copies: string, places: MiradorPlaces, heldReadOnly: string[] = []): Promise<WorkspaceMounts> {
  const refused = await sandboxRefusalOf(givenWorkspace, places);
  if (refused) return { refused };
  const workspace = await realOrAsIs(givenWorkspace);
  const gitFolder = join(workspace, ".git");
  const gitFolders = [gitFolder, ...(await submoduleGitFolders(join(gitFolder, "modules")))];
  await rm(copies, { recursive: true, force: true });
  const gitParts = (await Promise.all(gitFolders.map((folder) => readOnlyPartsOf(folder, copies, folder === gitFolder)))).flat();
  const held = heldReadOnly.map((path) => atItsOwnPath(join(workspace, path), true));
  const readOnly = outermostOf([...gitParts, ...(await configuredHooksInside(workspace)), ...held]);
  const parentsFirst = [atItsOwnPath(workspace, false), ...foldersHolding(workspace, readOnly), ...readOnly].toSorted((a, b) => (a.target < b.target ? -1 : a.target > b.target ? 1 : 0));
  const reachingOut = await mountReachingOut(workspace, copies, parentsFirst);
  return reachingOut ? { refused: { kind: "part-is-link", part: reachingOut } } : { mounts: parentsFirst };
}

/**
 * A mount whose source, other than a copy Mirador took, is or passes through a link, or lies outside the workspace: a
 * mount follows a link, so an agent that made one could have a folder or file of this computer shown to the VM. Null
 * where every mount is the workspace's own; one not there mounts nothing.
 */
async function mountReachingOut(workspace: string, copies: string, mounts: Mount[]): Promise<string | null> {
  const ownSources = mounts.filter(({ source }) => !isInside(source, copies));
  const reachesOut = await Promise.all(
    ownSources.map(async ({ source }) => {
      const real = await realpath(source).catch(() => null);
      return real === null ? (await kindOf(source)) === "link" : real !== source || !isInside(source, workspace);
    }),
  );
  const reaching = ownSources.find((_, index) => reachesOut[index]);
  return reaching ? relative(workspace, reaching.source).split(sep).join("/") : null;
}
