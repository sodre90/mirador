import { lstat, readdir, stat } from "node:fs/promises";
import { join, posix } from "node:path";
import type { ChangeStatus } from "../shared/changes.ts";
import type { FileBefore } from "./edit-diff.ts";
import { LineCountCache } from "./line-count-cache.ts";

/** A file that differs between two of git's trees, or between a tree and the working tree. */
export interface TreeChange {
  path: string;
  status: ChangeStatus;
  /** Null for a binary file. */
  added: number | null;
  removed: number | null;
  /** Whether git ignores the file, which only the list of ignored files' writes has. */
  ignored?: boolean;
  /** When the file was last written (epoch ms), or committed, for a change its time picked. */
  writtenAtMs?: number;
  /** Whether another conversation in the workspace may have written it instead, which only a session's list tells. */
  othersMayHaveWritten?: boolean;
}

const SUBMODULE_MODE = "160000";
const MAX_FILE_BYTES = 1024 * 1024;
const LINE_COUNTS_KEPT = 20_000;
const FILES_HANDLED_AT_ONCE = 32;
const untrackedLineCounts = new LineCountCache(LINE_COUNTS_KEPT);

const statusOf = (letter: string): ChangeStatus => (letter === "A" ? "added" : letter === "D" ? "deleted" : "modified");
const countOf = (field: string | undefined) => (field === undefined || field === "-" ? null : Number(field));

/**
 * The files of git's `-z --raw --no-renames` output (":100644 100644 <old> <new> M", then the path, each ended by NUL)
 * with their line counts from `-z --numstat` ("<added>\t<removed>\t<path>", NUL-ended; "-" for a binary file). A
 * submodule's own files are its repository's, so a submodule is left out.
 */
export function treeChangesIn(raw: string, numstat: string): TreeChange[] {
  const counts = new Map(
    numstat
      .split("\0")
      .filter(Boolean)
      .map((entry) => {
        const [added, removed, ...path] = entry.split("\t");
        return [path.join("\t"), { added: countOf(added), removed: countOf(removed) }] as const;
      }),
  );
  const fields = raw.split("\0").filter(Boolean);
  return fields.flatMap((field, index) => {
    if (index % 2 === 1) return [];
    const [fromMode, toMode, , , letter = ""] = field.slice(1).split(" ");
    const path = fields[index + 1] ?? "";
    if (fromMode === SUBMODULE_MODE || toMode === SUBMODULE_MODE) return [];
    return [{ path, status: statusOf(letter), ...(counts.get(path) ?? { added: null, removed: null }) }];
  });
}

const lineCount = (text: string) => (text === "" ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0));

/** Read-only git: no optional locks, so it never rewrites the user's index while they or the agent use the repository. */
async function git(directory: string, args: string[], input = "") {
  const child = Bun.spawn(["git", "--no-optional-locks", "-C", directory, ...args], { stdin: new Blob([input]), stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { stdout, stderr: stderr.trim(), exitCode };
}

async function mustGit(directory: string, args: string[], input?: string) {
  const result = await git(directory, args, input);
  if (result.exitCode !== 0) throw new Error(`git ${args[0]} failed in ${directory}: ${result.stderr}`);
  return result.stdout;
}

export const isRepository = async (directory: string) => (await git(directory, ["rev-parse", "--git-dir"])).exitCode === 0;

/** HEAD, or the empty tree in a repository with no commit yet, so its first files show as added. */
export async function headOrEmptyTree(directory: string) {
  const head = await git(directory, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]);
  return head.exitCode === 0 ? head.stdout.trim() : emptyTree(directory);
}

/**
 * What `git status` would list against HEAD, with line counts: the tracked files that differ from HEAD (staged or
 * not), and the untracked files .gitignore does not hide. Null when the directory is not in a git repository.
 */
export async function uncommittedChanges(directory: string): Promise<TreeChange[] | null> {
  if (!(await isRepository(directory))) return null;
  const head = await headOrEmptyTree(directory);
  const diff = (format: string) => mustGit(directory, ["diff", "--relative", "--no-renames", "--no-ext-diff", "--no-textconv", "-z", format, head]);
  const [raw, numstat, untracked] = await Promise.all([diff("--raw"), diff("--numstat"), mustGit(directory, ["ls-files", "--others", "--exclude-standard", "-z"])]);
  const added = await inLimitedParallel(untracked.split("\0").filter(Boolean), (path) => untrackedChange(directory, path));
  return [...treeChangesIn(raw, numstat), ...added];
}

async function untrackedChange(directory: string, path: string): Promise<TreeChange> {
  const fullPath = join(directory, path);
  const stats = await lstat(fullPath).catch(() => null);
  const added = stats?.isFile() ? await untrackedLineCounts.countOf(fullPath, stats, () => addedLinesOf(fullPath, stats.size)) : null;
  return { path, status: "added", added, removed: added === null ? null : 0 };
}

async function addedLinesOf(fullPath: string, size: number) {
  if (size > MAX_FILE_BYTES) return null;
  const text = await Bun.file(fullPath).text().catch(() => null);
  return text === null || text.includes("\0") ? null : lineCount(text);
}

/** Like `Promise.all(items.map(work))`, with at most FILES_HANDLED_AT_ONCE under way, so thousands of files are not opened at once. The results keep the items' order. */
async function inLimitedParallel<T, R>(items: T[], work: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  const waiting = items.entries();
  const workers = Array.from({ length: Math.min(FILES_HANDLED_AT_ONCE, items.length) }, async () => {
    for (const [index, item] of waiting) results[index] = await work(item);
  });
  await Promise.all(workers);
  return results;
}

const TOOL_STATE_FOLDERS = [".beads", ".dolt", ".idea"];
const SCAN_SKIPS = new Set([".git", "node_modules", ".DS_Store", ...TOOL_STATE_FOLDERS]);
const isOfficeLockFile = (name: string) => name.startsWith("~$");
const isScannedName = (name: string) => !SCAN_SKIPS.has(name) && !isOfficeLockFile(name);
const isScannedPath = (path: string) => path.split("/").every(isScannedName);
export const MAX_SCANNED_FILES = 50_000;

/**
 * The files under the `folders` of `directory` (all of it by default), relative to `directory` with / as git writes
 * them, skipping the folders nothing of the user's lives in, and with `skipOtherRepositories` the folders with a .git
 * of their own; it stops after `limit` of them, and says so.
 */
async function scannedFiles(directory: string, limit: number, { folders = [""], skipOtherRepositories = false } = {}) {
  const files: string[] = [];
  const pending = [...folders];
  for (let folder = pending.pop(); folder !== undefined && files.length <= limit; folder = pending.pop()) {
    const entries = await readdir(join(directory, folder), { withFileTypes: true }).catch(() => []);
    const holdsAnotherRepository = folder !== "" && entries.some(({ name }) => name === ".git");
    if (skipOtherRepositories && holdsAnotherRepository) continue;
    entries
      .filter(({ name }) => isScannedName(name))
      .forEach((entry) => (entry.isDirectory() ? pending.push(posix.join(folder, entry.name)) : entry.isFile() && files.push(posix.join(folder, entry.name))));
  }
  return { files: files.slice(0, limit), truncated: files.length > limit };
}

/**
 * Every file of the project, relative to `directory` with / as git writes them: in a repository the files git tracks
 * and the untracked ones it does not ignore, in any other folder every file, leaving out the folders tools keep their
 * own state in. It stops after `limit` of them, and says so.
 */
export async function projectFiles(directory: string, limit = MAX_SCANNED_FILES): Promise<{ files: string[]; truncated: boolean }> {
  const listed = await git(directory, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"]);
  if (listed.exitCode !== 0) return scannedFiles(directory, limit);
  const files = [...new Set(listed.stdout.split("\0"))].filter((path) => path !== "" && isScannedPath(path));
  return { files: files.slice(0, limit), truncated: files.length > limit };
}

/** Not the change time: opening a file in Finder moves that, and a file made with an old modified time still has its birth. */
const writtenAt = (stats: { mtimeMs: number; birthtimeMs: number }) => Math.max(stats.mtimeMs, stats.birthtimeMs);

/** Linux and Windows round a file's times down to their clock's tick, up to ~16 ms, so a write landing in the tick of the turn's start reads as older than it. */
const FILE_TIME_TICK_MS = 16;

/** Whether a file written at that time (epoch ms) counts. */
export type CountsWrite = (writtenAtMs: number) => boolean;

export const writtenSince =
  (since: number): CountsWrite =>
  (writtenAtMs) =>
    writtenAtMs >= since - FILE_TIME_TICK_MS;

/** A stretch of time, epoch ms. */
export interface TimeWindow {
  from: number;
  to: number;
}

export const writtenDuring = ({ from, to }: TimeWindow, writtenAtMs: number) => writtenAtMs >= from - FILE_TIME_TICK_MS && writtenAtMs <= to;

export const writtenWithin =
  (windows: TimeWindow[]): CountsWrite =>
  (writtenAtMs) =>
    windows.some((window) => writtenDuring(window, writtenAtMs));

/** The times of a file decide which of the two it is: made when a write counts, or made before and rewritten then. */
async function writtenChangesOf(directory: string, paths: string[], counts: CountsWrite): Promise<TreeChange[]> {
  const written = await inLimitedParallel(paths, async (path) => {
    const stats = await lstat(join(directory, path)).catch(() => null);
    return stats?.isFile() && counts(writtenAt(stats)) ? [{ path, createdSince: counts(stats.birthtimeMs), writtenAtMs: writtenAt(stats) }] : [];
  });
  return inLimitedParallel(written.flat(), async ({ path, createdSince, writtenAtMs }) => ({
    ...(createdSince ? await untrackedChange(directory, path) : { path, status: "modified" as const, added: null, removed: null }),
    writtenAtMs,
  }));
}

/**
 * The files of a folder that is not a git repository which were written at or after `since` (epoch ms), by their times
 * alone: a file made since then is added with its line counts, any other is modified. Nothing says what a file held
 * before, and a deleted file leaves nothing to find. A subfolder with a .git of its own is another project, whose files
 * other sessions and tools write, so it is left out. A folder of more than `limit` files is checked only in part, which
 * `truncated` says.
 */
export const filesWrittenSince = (directory: string, since: number, limit = MAX_SCANNED_FILES) => filesWritten(directory, writtenSince(since), limit);

/** Like filesWrittenSince, for the files whose write `counts`. */
export async function filesWritten(directory: string, counts: CountsWrite, limit = MAX_SCANNED_FILES): Promise<{ changes: TreeChange[]; truncated: boolean }> {
  const { files, truncated } = await scannedFiles(directory, limit, { skipOtherRepositories: true });
  return { changes: await writtenChangesOf(directory, files, counts), truncated };
}

/**
 * The files a git repository hides behind its excludes whose write `counts`, which git
 * lists by name so a walk never opens the tracked files. Their times tell them apart as in filesWrittenSince. Git names
 * a hidden folder in whole instead of listing what is in it, and only those folders are walked, leaving out
 * node_modules and the folders tools keep their own state in, and any folder holding a git of its own, which is that
 * repository's. Git also names the hidden files of an untracked folder one by one, so a file can come twice. A
 * repository hiding more files than `limit` is checked only in part, which `truncated` says.
 */
export async function ignoredFilesWritten(
  directory: string,
  counts: CountsWrite,
  limit = MAX_SCANNED_FILES,
): Promise<{ changes: TreeChange[]; truncated: boolean }> {
  const listed = (await mustGit(directory, ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"])).split("\0").filter(Boolean);
  const hiddenFiles = listed.filter((path) => !path.endsWith("/") && isScannedPath(path));
  const hiddenFolders = listed.filter((path) => path.endsWith("/")).map((folder) => folder.slice(0, -1)).filter(isScannedPath);
  const walked = await scannedFiles(directory, limit, { folders: hiddenFolders, skipOtherRepositories: true });
  const hidden = [...new Set([...hiddenFiles, ...walked.files])];
  const written = await writtenChangesOf(directory, hidden.slice(0, limit), counts);
  return { changes: written.map((change) => ({ ...change, ignored: true })), truncated: walked.truncated || hidden.length > limit };
}

/**
 * The changes whose file is still there and was written when a write `counts`; a deleted file has no time to tell. Git
 * names an untracked folder holding a repository of its own as the folder, which is that repository's, so it is left out.
 */
export async function changesWritten(directory: string, changes: TreeChange[], counts: CountsWrite): Promise<TreeChange[]> {
  const kept = await inLimitedParallel(changes, async (change) => {
    const stats = await lstat(join(directory, change.path)).catch(() => null);
    return stats && !stats.isDirectory() && counts(writtenAt(stats)) ? [{ ...change, writtenAtMs: writtenAt(stats) }] : [];
  });
  return kept.flat();
}

export const isIgnored = async (directory: string, path: string) => (await git(directory, ["check-ignore", "-q", "--", path])).exitCode === 0;

/** A commit as `git log --format="%H %ct %P"` lists it. */
export interface LoggedCommit {
  commit: string;
  committedAtMs: number;
  parents: string[];
}

/** The commits of `git log --format="%H %ct %P"`, newest first as git lists them. */
export const loggedCommitsIn = (log: string): LoggedCommit[] =>
  log
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [commit = "", committedAt = "0", ...parents] = line.split(" ");
      return { commit, committedAtMs: Number(committedAt) * 1000, parents: parents.filter(Boolean) };
    });

/** Git keeps a commit's time in whole seconds, so a commit made in a window can read as up to a second before it. */
const COMMIT_TIME_TICK_MS = 1000;
const madeWithin = (committedAtMs: number, { from, to }: TimeWindow) => committedAtMs + COMMIT_TIME_TICK_MS > from && committedAtMs <= to;

/**
 * The files the commits made within `windows` changed, each against what it was before the earliest of them, as the
 * working tree has it now. A merge brings in others' work, so it is left out, and so are commits that only arrived, as
 * a pull keeps their own times.
 */
export async function changesSinceCommitsWithin(directory: string, since: number, windows: TimeWindow[]): Promise<{ changes: TreeChange[]; baseOf: Map<string, string> }> {
  const log = await mustGit(directory, ["log", `--since=@${Math.floor(since / 1000) - 1}`, "--format=%H %ct %P"]);
  const made = loggedCommitsIn(log)
    .filter(({ parents }) => parents.length <= 1)
    .filter(({ committedAtMs }) => windows.some((window) => madeWithin(committedAtMs, window)));
  const baseOf = new Map<string, string>();
  const lastCommittedAt = new Map<string, number>();
  for (const { commit, parents, committedAtMs } of made) {
    const base = parents[0] ?? (await emptyTree(directory));
    const paths = (await mustGit(directory, ["diff-tree", "-r", "-z", "--name-only", "--no-renames", "--relative", base, commit])).split("\0").filter(Boolean);
    paths.forEach((path) => {
      baseOf.set(path, base);
      if (!lastCommittedAt.has(path)) lastCommittedAt.set(path, committedAtMs);
    });
  }
  const byBase = Map.groupBy(baseOf, ([, base]) => base);
  const changes = await Promise.all([...byBase].map(async ([base, entries]) => changesAgainst(directory, base, entries.map(([path]) => path))));
  return { changes: changes.flat().map((change) => ({ ...change, writtenAtMs: lastCommittedAt.get(change.path) })), baseOf };
}

const emptyTree = async (directory: string) => (await mustGit(directory, ["hash-object", "-t", "tree", "--stdin"])).trim();

/** How `paths` differ in the working tree from `revision`, with line counts. */
async function changesAgainst(directory: string, revision: string, paths: string[]): Promise<TreeChange[]> {
  const diff = (format: string) => mustGit(directory, ["diff", "--relative", "--no-renames", "--no-ext-diff", "--no-textconv", "-z", format, revision, "--", ...paths.map((path) => `:(literal)${path}`)]);
  const [raw, numstat] = await Promise.all([diff("--raw"), diff("--numstat")]);
  return treeChangesIn(raw, numstat);
}

/** Whether the file was made at or after `since`, which the file's time of birth says where the system keeps one. */
export async function createdSince(directory: string, path: string, since: number) {
  const earliestWrite = since - FILE_TIME_TICK_MS;
  return ((await stat(join(directory, path)).catch(() => null))?.birthtimeMs ?? 0) >= earliestWrite;
}

/** A file as `revision` holds it: its text, or that it has no such file, or that it is binary or too large to show. */
export async function fileAtRevision(directory: string, revision: string, path: string): Promise<FileBefore> {
  const size = await git(directory, ["cat-file", "-s", `${revision}:./${path}`]);
  if (size.exitCode !== 0) return { kind: "missing" };
  if (Number(size.stdout) > MAX_FILE_BYTES) return { kind: "unreadable" };
  const text = await mustGit(directory, ["cat-file", "blob", `${revision}:./${path}`]);
  return text.includes("\0") ? { kind: "unreadable" } : { kind: "text", text };
}

