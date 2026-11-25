import type { Dirent } from "node:fs";
import { readdir, readFile, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { asDisksCompare } from "../../shared/disk-names.ts";
import { isHeldConfigPath, isNeverHeldFolder } from "../../shared/sandbox.ts";
import type { LookedAt } from "./looked-at.ts";
import { isRegularFile, kindOf, realOrAsIs } from "./paths-on-disk.ts";

/** A repository git works with. */
export interface Repository {
  /** The folder git takes a relative hooks folder from: its working tree, or a bare one itself. */
  top: string;
  gitFolder: string;
}

/** Whether the guard keeps its config and hooks as they are by their names: it lies in its working tree as `.git`, or is bare. */
export const isGuardedInPlace = ({ top, gitFolder }: Repository) => gitFolder === top || gitFolder === join(top, ".git");

export const isBare = ({ top, gitFolder }: Repository) => gitFolder === top;

/** The names that tell git a folder is a repository: in one with no `.git`, a file `HEAD` may make it a bare one, as git takes it for, with more beside it. */
const NAMES_OF_A_REPOSITORY = [".git", "head"];

/** Not looked into: git's own folders and installed packages', as for held files, and the held folders, which are protected whole. */
const isLookedInto = (path: string) => !path.split("/").some(isNeverHeldFolder) && !isHeldConfigPath(path);

async function foldersNamedLikeRepositories(workspace: string, path: string): Promise<string[]> {
  const folder = join(workspace, path);
  const entries = await readdir(folder, { withFileTypes: true }).catch((): Dirent[] => []);
  const isOne = path !== "" && entries.some(({ name }) => NAMES_OF_A_REPOSITORY.includes(asDisksCompare(name)));
  const folders = entries.filter((entry) => entry.isDirectory()).map(({ name }) => (path === "" ? name : `${path}/${name}`));
  const below = await Promise.all(folders.filter(isLookedInto).map((each) => foldersNamedLikeRepositories(workspace, each)));
  return [...(isOne ? [folder] : []), ...below.flat()];
}

/** Where a `.git` that is a file or a link leads, without links; null where it leads to no folder. */
async function gitFolderLedTo(dotGit: string): Promise<string | null> {
  const real = await realpath(dotGit).catch(() => null);
  if (real === null || (await kindOf(real)) === "folder") return real;
  if (!(await isRegularFile(real))) return null;
  const named = /^gitdir: (.+)$/m.exec(await readFile(real, "utf8"))?.[1];
  return named === undefined ? null : realpath(resolve(dirname(dotGit), named.trim())).catch(() => null);
}

async function repositoryAt(top: string, lookedAt: LookedAt): Promise<Repository | null> {
  const dotGit = join(top, ".git");
  await lookedAt.entry(dotGit);
  const kind = await kindOf(dotGit);
  if (kind === "folder") return { top, gitFolder: dotGit };
  if (kind !== "missing") {
    const gitFolder = await gitFolderLedTo(dotGit);
    return gitFolder === null ? null : { top, gitFolder };
  }
  const head = await kindOf(join(top, "HEAD"));
  return head === "missing" || head === "folder" ? null : { top, gitFolder: top };
}

/** The workspace's own repository, whose git folder is in it, and then those in the folders of its tree. */
export async function repositoriesIn(workspace: string, lookedAt: LookedAt): Promise<[Repository, ...Repository[]]> {
  const tops = await foldersNamedLikeRepositories(workspace, "");
  const nested = await Promise.all(tops.toSorted().map((top) => repositoryAt(top, lookedAt)));
  return [{ top: workspace, gitFolder: join(workspace, ".git") }, ...nested.filter((repository) => repository !== null)];
}

/** The git folders of the repository's submodules, at any depth, as its git folder's `modules` keeps them. */
export async function submoduleGitFolders(modules: string, lookedAt: LookedAt): Promise<string[]> {
  await lookedAt.names(modules);
  if ((await kindOf(modules)) !== "folder") return [];
  const entries = await readdir(modules, { withFileTypes: true });
  const nested = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async ({ name }) => {
        const folder = join(modules, name);
        const isGitFolder = (await kindOf(join(folder, "HEAD"))) === "file";
        return [...(isGitFolder ? [folder] : []), ...(await submoduleGitFolders(isGitFolder ? join(folder, "modules") : folder, lookedAt))];
      }),
  );
  return nested.flat().toSorted();
}

/** The folders of the repository's git worktrees, which their worktrees' `.git` files name. */
export async function worktreeFolders(gitFolder: string, lookedAt: LookedAt): Promise<string[]> {
  const worktrees = join(gitFolder, "worktrees");
  await lookedAt.names(worktrees);
  if ((await kindOf(worktrees)) !== "folder") return [];
  return (await readdir(worktrees, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map(({ name }) => join(worktrees, name));
}

/** The folder a git folder takes its config and hooks from: its own, or where `commondir` leads, as a worktree's does. */
async function commonFolderOf(gitFolder: string, lookedAt: LookedAt): Promise<string> {
  const commondir = join(gitFolder, "commondir");
  await lookedAt.entry(commondir);
  return (await isRegularFile(commondir)) ? realOrAsIs(resolve(gitFolder, (await readFile(commondir, "utf8")).trim())) : gitFolder;
}

export const configFilesIn = (gitFolder: string) => [join(gitFolder, "config"), join(gitFolder, "config.worktree")];

/** The config files that are there of the repository whose git folder it is. */
export async function configFilesOf(gitFolder: string, lookedAt: LookedAt): Promise<string[]> {
  const files = [...new Set([await commonFolderOf(gitFolder, lookedAt), gitFolder].flatMap(configFilesIn))];
  await Promise.all(files.map((file) => lookedAt.entry(file)));
  const kinds = await Promise.all(files.map(kindOf));
  return files.filter((_, index) => kinds[index] !== "missing");
}
