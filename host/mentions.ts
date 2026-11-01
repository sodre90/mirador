import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { isAbsolute, join, posix, resolve } from "node:path";
import { isPathQuery, type MentionSuggestion } from "../shared/mentions.ts";
import { expandHome, parentOf } from "./paths.ts";

const MAX_SUGGESTIONS = 30;
const FILE_LIST_TTL_MS = 15_000;
const MAX_WALKED_FILES = 20_000;
const MAX_WALK_DEPTH = 8;
const SKIPPED_WHILE_WALKING = new Set(["node_modules", "build", "dist", "target"]);

/**
 * What to suggest after @: a path's entries for a path (/…, ~/…, ./…, ../…), the workspace's top level for a bare @,
 * otherwise the workspace's files and directories that match, as Claude Code's @ does.
 */
export async function mentionSuggestions(workspaceDirectory: string, query: string): Promise<MentionSuggestion[]> {
  if (query === "" || isPathQuery(query)) return completePath(workspaceDirectory, query);
  return searchWorkspace(workspaceDirectory, query);
}

const isDirectoryEntry = async (directory: string, entry: Dirent) =>
  entry.isDirectory() || (entry.isSymbolicLink() && Boolean((await stat(join(directory, entry.name)).catch(() => null))?.isDirectory()));

async function completePath(workspaceDirectory: string, typed: string): Promise<MentionSuggestion[]> {
  const path = typed === "~" ? "~/" : typed;
  const typedParent = parentOf(path);
  const partialName = path.slice(typedParent.length).toLowerCase();
  const directory = isAbsolute(typedParent) || typedParent.startsWith("~") ? expandHome(typedParent) : resolve(workspaceDirectory, typedParent);
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const matching = entries
    .filter(({ name }) => name.toLowerCase().startsWith(partialName) && (partialName.startsWith(".") || !name.startsWith(".")))
    .toSorted((one, other) => one.name.localeCompare(other.name))
    .slice(0, MAX_SUGGESTIONS);
  return Promise.all(
    matching.map(async (entry) => {
      const isDirectory = await isDirectoryEntry(directory, entry);
      return { path: `${typedParent}${entry.name}${isDirectory ? "/" : ""}`, directory: isDirectory };
    }),
  );
}

const fileLists = new Map<string, { listedAt: number; files: Promise<string[]> }>();

/** The workspace's files relative to it: git's (tracked, and untracked but not ignored), or a bounded walk outside git. */
function workspaceFiles(workspaceDirectory: string) {
  const cached = fileLists.get(workspaceDirectory);
  if (cached && Date.now() - cached.listedAt < FILE_LIST_TTL_MS) return cached.files;
  const files = gitFiles(workspaceDirectory).then((listed) => listed ?? walkFiles(workspaceDirectory));
  fileLists.set(workspaceDirectory, { listedAt: Date.now(), files });
  return files;
}

async function gitFiles(directory: string) {
  const git = Bun.spawn(["git", "-C", directory, "ls-files", "--cached", "--others", "--exclude-standard", "-z"], { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
  const [output, exitCode] = await Promise.all([new Response(git.stdout).text(), git.exited]);
  return exitCode === 0 ? output.split("\0").filter(Boolean) : null;
}

async function walkFiles(root: string) {
  const files: string[] = [];
  let level = [""];
  for (let depth = 0; depth < MAX_WALK_DEPTH && level.length > 0 && files.length < MAX_WALKED_FILES; depth++) {
    const listed = await Promise.all(level.map(async (relative) => ({ relative, entries: await readdir(join(root, relative), { withFileTypes: true }).catch(() => []) })));
    const visible = listed.flatMap(({ relative, entries }) => entries.filter(({ name }) => !name.startsWith(".")).map((entry) => ({ entry, path: posix.join(relative, entry.name) })));
    files.push(...visible.filter(({ entry }) => entry.isFile()).map(({ path }) => path));
    level = visible.filter(({ entry }) => entry.isDirectory() && !SKIPPED_WHILE_WALKING.has(entry.name)).map(({ path }) => path);
  }
  return files.slice(0, MAX_WALKED_FILES);
}

const directoriesOf = (files: string[]) =>
  [...new Set(files.flatMap((file) => file.split("/").slice(0, -1).map((_, index, parts) => parts.slice(0, index + 1).join("/"))))];

/** How well a path matches: its name exactly, its name's start, its name, the path, or the query's letters in order. */
export function matchScore(path: string, query: string): number | null {
  const candidate = path.toLowerCase().replace(/\/$/, "");
  const wanted = query.toLowerCase();
  const name = candidate.slice(candidate.lastIndexOf("/") + 1);
  if (name === wanted) return 5;
  if (name.startsWith(wanted)) return 4;
  if (name.includes(wanted)) return 3;
  if (candidate.includes(wanted)) return 2;
  let from = 0;
  for (const letter of wanted) {
    from = candidate.indexOf(letter, from) + 1;
    if (from === 0) return null;
  }
  return 1;
}

async function searchWorkspace(workspaceDirectory: string, query: string): Promise<MentionSuggestion[]> {
  const files = await workspaceFiles(workspaceDirectory);
  const candidates = [
    ...directoriesOf(files).map((directory) => ({ path: `${directory}/`, directory: true })),
    ...files.map((file) => ({ path: file, directory: false })),
  ];
  return candidates
    .flatMap((candidate) => {
      const score = matchScore(candidate.path, query);
      return score === null ? [] : [{ candidate, score }];
    })
    .toSorted((one, other) => other.score - one.score || one.candidate.path.length - other.candidate.path.length)
    .slice(0, MAX_SUGGESTIONS)
    .map(({ candidate }) => candidate);
}
