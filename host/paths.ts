import { mkdir, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { HostProblemError } from "../shared/host-problems.ts";

const MAX_COMPLETIONS = 30;

/** A path relative to a workspace as Mirador names it everywhere, with / between its names on Windows too. */
export const toPosix = (path: string) => path.split(sep).join("/");

/** Windows takes either slash between a path's names; elsewhere a backslash is part of a name. */
const pathSeparators = (platform: NodeJS.Platform) => (platform === "win32" ? ["/", "\\"] : ["/"]);

/** The path up to its last separator, with it: the directory of the name being typed. */
export const parentOf = (path: string, platform = process.platform) =>
  path.slice(0, Math.max(...pathSeparators(platform).map((separator) => path.lastIndexOf(separator))) + 1);

export function expandHome(path: string, platform = process.platform) {
  if (path === "~") return homedir();
  return pathSeparators(platform).some((separator) => path.startsWith(`~${separator}`)) ? join(homedir(), path.slice(2)) : path;
}

const absolutePath = (path: string) => resolve(expandHome(path.trim()));

const statOrNull = (path: string) => stat(path).catch(() => null);

/** Whether adding the typed path makes a new folder: nothing is there yet and its parent is a folder. */
export async function createsDirectory(path: string): Promise<boolean> {
  const absolute = absolutePath(path);
  if (await statOrNull(absolute)) return false;
  return Boolean((await statOrNull(dirname(absolute)))?.isDirectory());
}

/** The typed folder, made first when `createsDirectory` says so. */
export async function directoryToAdd(path: string): Promise<string> {
  if (await createsDirectory(path)) await mkdir(absolutePath(path), { recursive: true });
  return existingDirectory(path);
}

export async function existingDirectory(path: string): Promise<string> {
  const absolute = absolutePath(path);
  const info = await statOrNull(absolute);
  if (!info?.isDirectory()) throw new HostProblemError({ code: "not-a-directory", path: absolute });
  return absolute.replace(/\/+$/, "") || "/";
}

/** Directories whose path starts with `prefix`, keeping the user's `~` spelling. */
export async function completeDirectories(typed: string): Promise<string[]> {
  const prefix = typed === "~" ? "~/" : typed || "/";
  const partialName = prefix.slice(parentOf(prefix).length);
  const typedParent = parentOf(prefix) || "./";
  const entries = await readdir(expandHome(typedParent), { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .filter((entry) => entry.name.startsWith(partialName) && (partialName.startsWith(".") || !entry.name.startsWith(".")))
    .map((entry) => `${typedParent}${entry.name}/`)
    .sort()
    .slice(0, MAX_COMPLETIONS);
}
