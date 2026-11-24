// Reads and changes files of a room's workspace for the agents people brought, on this computer or inside a room's VM,
// which sees this folder alone: only node's own modules here.
import { constants, lstatSync, realpathSync } from "node:fs";
import { lstat, mkdir, open, readdir, type FileHandle } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const MOST_ENTRIES_LISTED = 500;

/** Why a call can't be done, in words for the agent that made it. */
export class WorkspaceCallRefused extends Error {}

/** A folder a room's agents work in, and Mirador's own data, which no call reaches wherever it lies; null in a VM, which sees none of it. */
export interface WorkspaceFolders {
  workspace: string;
  miradorsData: string | null;
  fileMostBytes: number;
}

/** What stands at a path, and the path from the workspace it leads to, with slashes on every system. */
export interface EntryFound {
  within: string;
  entry: { kind: "none" } | { kind: "folder"; names: string[] } | { kind: "file"; text: string };
}

/** A change of a file as it would be made: the place it is made at, the file's text before, null where there is none yet, and after. */
export interface FileChange {
  path: string;
  within: string;
  before: string | null;
  after: string;
}

export const refused = (why: string) => new WorkspaceCallRefused(why);

const isMissing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";

function realPathOrNull(path: string) {
  try {
    return realpathSync.native(path);
  } catch {
    return null;
  }
}

const isWithin = (folder: string, place: string) => {
  const way = relative(folder, place);
  return way !== ".." && !way.startsWith(`..${sep}`) && !isAbsolute(way);
};

/** As a case-insensitive disk takes them: two spellings of one path count as one. */
const isWithinInAnyCase = (folder: string, place: string) => isWithin(folder.toLowerCase(), place.toLowerCase());

/** A line break in a name could pass for lines of the change its approver reads. */
const holdsControlCharacters = (path: string) => /\p{Cc}/u.test(path);

/** On Windows, a colon in a file or folder name names an NTFS alternate data stream, bypassing checks on the name before it. */
const holdsColon = (path: string) => path.replace(/^[A-Za-z]:(?=[\\/])/, "").includes(":");

/** An HFS+ disk takes a name for the same without the characters that show nothing. */
const asDisksCompare = (name: string) => name.replace(/\p{Default_Ignorable_Code_Point}/gu, "").toLowerCase();

const namesGitsOwn = (within: string) => within.split(/[\\/]/).some((part) => asDisksCompare(part) === ".git");

const leadsNowhere = () => refused("The path leads nowhere that can be reached.");

function standingAt(path: string) {
  try {
    return lstatSync(path, { throwIfNoEntry: false });
  } catch {
    throw leadsNowhere();
  }
}

/**
 * Where the path leads once the links on its way are followed: an entry that is there, or the folders still to be made
 * below the nearest one that is. A file is at the name it is called by there, as macOS takes any of a hard-linked file's
 * names for its real one.
 */
function realPlace(path: string): string {
  const there = standingAt(path);
  const folder = dirname(path);
  const isFile = there !== undefined && !there.isDirectory() && !there.isSymbolicLink();
  try {
    if (!isFile) return realpathSync.native(path);
  } catch (error) {
    if (!isMissing(error) || there !== undefined || folder === path) throw leadsNowhere();
  }
  return join(realPlace(folder), basename(path));
}

/** The place in the workspace the path names, by its real path; refused where it leads out of it, or to what no call reaches. */
export function placeInWorkspace(path: string, { workspace, miradorsData }: WorkspaceFolders, onWindows = process.platform === "win32"): { place: string; within: string } {
  if (holdsControlCharacters(path)) throw refused("A path holds no control characters.");
  if (onWindows && holdsColon(path)) throw refused("A path on Windows holds no colons.");
  const root = realPathOrNull(workspace);
  if (root === null) throw refused("The room's workspace is not there.");
  const place = realPlace(resolve(root, path));
  if (!isWithin(root, place)) throw refused(`${path} is outside the room's workspace.`);
  if (miradorsData !== null && isWithinInAnyCase(realPlace(resolve(miradorsData)), place)) throw refused(`${path} is Mirador's own data.`);
  const within = relative(root, place).replaceAll(sep, "/");
  if (holdsControlCharacters(within)) throw refused(`${path} leads to a name with control characters.`);
  if (onWindows && within.includes(":")) throw refused(`${path} leads to a name with a colon.`);
  if (namesGitsOwn(within)) throw refused("What git keeps in .git is reached by git's own commands alone.");
  return { place, within: within || "." };
}

/** The entry as it was opened is still the one the path leads to, and no link. */
async function assertStillThere(file: FileHandle, path: string, place: string, folders: WorkspaceFolders) {
  const [opened, there] = await Promise.all([file.stat(), lstat(place)]);
  const moved = placeInWorkspace(path, folders).place !== place || opened.ino !== there.ino || opened.dev !== there.dev;
  if (moved) throw refused(`${path} changed while it was opened.`);
}

async function textOf(file: FileHandle, path: string, { fileMostBytes }: WorkspaceFolders) {
  const stats = await file.stat();
  if (!stats.isFile()) throw refused(`${path} is no regular file.`);
  if (stats.size > fileMostBytes) throw refused(`${path} is larger than ${fileMostBytes} bytes.`);
  const buffer = Buffer.alloc(stats.size);
  const { bytesRead } = await file.read(buffer, 0, stats.size, 0);
  const bytes = buffer.subarray(0, bytesRead);
  const text = bytes.toString("utf8");
  if (text.includes("\0") || !Buffer.from(text, "utf8").equals(bytes)) throw refused(`${path} is no text file.`);
  return text;
}

async function openedIn(path: string, place: string, flags: number, folders: WorkspaceFolders) {
  const file = await open(place, flags | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch((error: unknown) => {
    throw refused(isMissing(error) ? `There is no ${path}.` : `${path} can't be opened.`);
  });
  try {
    await assertStillThere(file, path, place, folders);
    return file;
  } catch (error) {
    await file.close();
    throw error;
  }
}

async function withFile<T>(path: string, place: string, flags: number, folders: WorkspaceFolders, work: (file: FileHandle) => Promise<T>) {
  const file = await openedIn(path, place, flags, folders);
  try {
    return await work(file);
  } finally {
    await file.close();
  }
}

async function namesIn(place: string) {
  const entries = await readdir(place, { withFileTypes: true });
  const names = entries.map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name)).toSorted();
  const more = names.length - MOST_ENTRIES_LISTED;
  return [...names.slice(0, MOST_ENTRIES_LISTED), ...(more > 0 ? [`… and ${more} more`] : [])];
}

/** What stands at the path: a file's text, or the names in a folder. */
export async function entryAt(path: string, folders: WorkspaceFolders): Promise<EntryFound> {
  const { place, within } = placeInWorkspace(path, folders);
  const there = await lstat(place).catch(() => null);
  if (!there) return { within, entry: { kind: "none" } };
  if (there.isDirectory()) return { within, entry: { kind: "folder", names: await namesIn(place) } };
  return { within, entry: { kind: "file", text: await withFile(path, place, constants.O_RDONLY, folders, (file) => textOf(file, path, folders)) } };
}

async function makeNew(path: string, place: string, text: string, folders: WorkspaceFolders) {
  await mkdir(dirname(place), { recursive: true });
  if (placeInWorkspace(path, folders).place !== place) throw refused(`${path} changed while it was opened.`);
  const file = await open(place, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o644).catch(() => {
    throw refused(`${path} came to be meanwhile, so it was left as it is.`);
  });
  try {
    await assertStillThere(file, path, place, folders);
    await file.writeFile(text, "utf8");
  } finally {
    await file.close();
  }
}

/** Makes the change, only to a file that still is as it was when the change was asked for. */
export async function makeChange({ path, within, before, after }: FileChange, folders: WorkspaceFolders) {
  const found = placeInWorkspace(path, folders);
  if (found.within !== within) throw refused(`${path} leads elsewhere than it did, so nothing was changed.`);
  if (before === null) return makeNew(path, found.place, after, folders);
  await withFile(path, found.place, constants.O_RDWR, folders, async (file) => {
    if ((await textOf(file, path, folders)) !== before) throw refused(`${path} was changed meanwhile, so it was left as it is. Read it again.`);
    await file.truncate(0);
    await file.write(after, 0, "utf8");
  });
}
