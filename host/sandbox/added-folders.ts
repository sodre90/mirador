import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";
import type { SandboxBlocker, SandboxFolder, SandboxFolderRefusal, SandboxFolderState } from "../../shared/sandbox.ts";
import { expandHome } from "../paths.ts";
import { SOCKETS_FOLDER_PREFIX } from "./socket-folders.ts";
import { miradorsOwn, sandboxRefusalOf, type MiradorPlaces } from "./guarded-workspace.ts";
import { isInside, realOrAsIs } from "./paths-on-disk.ts";

/** What the other rooms' and workspaces' sandboxes work in, without links, which a folder read and write keeps clear of. */
export interface OtherSandboxes {
  /** The workspaces of those whose sandbox is on. */
  workspaces: string[];
  /** The folders added to any of them read and write, its sandbox on or not. */
  writableFolders: string[];
  /** The folders added read and write to those whose sandbox is on. */
  writableFoldersOn: string[];
  /** The folders any sandbox worked in and left, this one's too, whose agents could have left links there. */
  foldersLeft: string[];
}

/** What a folder added to one sandbox must keep clear of. */
export interface FolderSurroundings {
  places: MiradorPlaces;
  /** The sandbox's workspace, without links; null where it has none now. */
  workspace: string | null;
  /** The folders every VM is given of Mirador's own, on this computer or in the VM: none may hold one, nor lie inside one. */
  sandboxOwn: string[];
  /** Where each VM's sockets get a folder of their own. */
  socketsParent: string;
  otherSandboxes: OtherSandboxes;
}

/** An added folder as a VM mounts it: at its own path, read-only or read and write. */
export type MountedFolder = Pick<SandboxFolder, "path" | "writable">;

export type LeftOutFolder = Exclude<SandboxFolderState, { kind: "in-sandbox" | "waiting" }>;

/** Each of the sandbox's added folders its VM starts with: those it mounts, and why each other one is left out. */
export interface FoldersMounted {
  mounted: MountedFolder[];
  leftOut: Map<string, LeftOutFolder>;
}

const overlap = (a: string, b: string) => isInside(a, b) || isInside(b, a);

const fromMiradorsOwn: Record<Extract<SandboxBlocker["kind"], "workspace-is-home" | "workspace-holds-mirador-data" | "workspace-is-mirador">, SandboxFolderRefusal> = {
  "workspace-is-home": { kind: "is-home" },
  "workspace-holds-mirador-data": { kind: "holds-mirador-data" },
  "workspace-is-mirador": { kind: "is-mirador" },
};

async function miradorsOwnRefusal(folder: string, places: MiradorPlaces): Promise<SandboxFolderRefusal | null> {
  const own = await miradorsOwn(folder, places);
  if (!own) return null;
  return own.kind === "workspace-holds-computers-own" ? { kind: "holds-computers-own", folder: own.folder } : fromMiradorsOwn[own.kind as keyof typeof fromMiradorsOwn];
}

/** A folder of the VMs' own sockets, by its name right under where they are made. */
const inSocketsFolder = (folder: string, socketsParent: string) => isInside(folder, socketsParent) && relative(socketsParent, folder).split(sep)[0]!.startsWith(SOCKETS_FOLDER_PREFIX);

async function holdsSandboxFiles(folder: string, { sandboxOwn, socketsParent }: FolderSurroundings) {
  const [parent, ...own] = await Promise.all([socketsParent, ...sandboxOwn].map(realOrAsIs));
  return own.some((place) => overlap(folder, place)) || isInside(parent!, folder) || inSocketsFolder(folder, parent!);
}

/** A folder right under home that holds the owner's settings and keys: a hidden one, or a Mac's Library. */
function homesPrivateEntry(folder: string, home: string): SandboxFolderRefusal | null {
  const [entry] = relative(home, folder).split(sep);
  if (entry!.startsWith(".")) return { kind: "hidden-in-home", entry: entry! };
  return entry === "Library" ? { kind: "in-library" } : null;
}

/** A repository a workspace's sandbox would refuse, as a folder read and write is: one with no `.git` folder of its own, or whose git parts can't be kept read-only. */
export const repositoryRefusal = (blocker: SandboxBlocker): SandboxFolderRefusal =>
  blocker.kind === "workspace-not-a-repository" || blocker.kind === "workspace-is-worktree" ? { kind: "needs-repository" } : { kind: "repository-refused", blocker };

/**
 * Why the folder can't go in read and write, past what keeps any added folder out. Its agents could write anything in
 * it, so it must lie in no folder this computer runs programs from, and no other sandbox may work in it, nor in a
 * folder in or around it. And it must be a git repository's own top folder, its config as safe as a workspace's must
 * be, so the owner sees and undoes what the agents change.
 */
async function writableFolderRefusal(folder: string, { places, otherSandboxes }: FolderSurroundings): Promise<SandboxFolderRefusal | null> {
  const computersOwn = await Promise.all(places.computersOwn.map(realOrAsIs));
  const runsProgramsFrom = computersOwn.find((own) => isInside(folder, own));
  if (runsProgramsFrom) return { kind: "inside-computers-own", folder: runsProgramsFrom };
  const workspace = otherSandboxes.workspaces.find((other) => overlap(folder, other));
  if (workspace) return { kind: "overlaps-sandbox-workspace", folder: workspace };
  const writable = otherSandboxes.writableFolders.find((other) => overlap(folder, other));
  if (writable) return { kind: "overlaps-sandbox-folder", folder: writable };
  const refused = await sandboxRefusalOf(folder, places);
  return refused && repositoryRefusal(refused);
}

/**
 * Why the folder, given without links, can't go into the sandbox beside `others`, its other added folders, with the
 * access asked for; null where it can. Only a folder inside the owner's home goes in, never home itself, a hidden folder
 * right under it or a Mac's Library, nor any of Mirador's own places or the sandbox's, its workspace, or another added
 * folder or one inside it.
 */
export async function addedFolderRefusal({ path: folder, writable }: MountedFolder, surroundings: FolderSurroundings, others: string[]): Promise<SandboxFolderRefusal | null> {
  if (folder.includes(":")) return { kind: "path-has-colon" };
  const home = await realOrAsIs(surroundings.places.home);
  if (folder === home) return { kind: "is-home" };
  if (!isInside(folder, home)) return { kind: "outside-home" };
  const privateEntry = homesPrivateEntry(folder, home);
  if (privateEntry) return privateEntry;
  const own = await miradorsOwnRefusal(folder, surroundings.places);
  if (own) return own;
  if (await holdsSandboxFiles(folder, surroundings)) return { kind: "holds-sandbox-files" };
  if (surroundings.workspace && overlap(folder, surroundings.workspace)) return { kind: "overlaps-workspace" };
  if (others.includes(folder)) return { kind: "already-added" };
  const overlapping = others.find((other) => overlap(folder, other));
  if (overlapping) return { kind: "overlaps-folder", folder: overlapping };
  return writable ? writableFolderRefusal(folder, surroundings) : readOnlyFolderRefusal(folder, surroundings.otherSandboxes);
}

/**
 * A folder read-only may not lie inside one another sandbox's agents write in, its workspace or a folder read and write:
 * they could swap it for a link to anywhere of this computer's just as its VM mounts it. Holding one is safe, as its VM
 * follows the links in it inside itself.
 */
function readOnlyFolderRefusal(folder: string, { workspaces, writableFoldersOn }: OtherSandboxes): SandboxFolderRefusal | null {
  const written = [...workspaces, ...writableFoldersOn].find((root) => folder !== root && isInside(folder, root));
  return written ? { kind: "inside-where-a-sandbox-writes", folder: written } : null;
}

const isFolder = async (path: string) => (await stat(path).catch(() => null))?.isDirectory() === true;

/** The folder the owner typed, `~` standing for their home, without links; or why there is none to add. */
export async function folderToAdd(typed: string): Promise<{ folder: string } | { refused: SandboxFolderRefusal }> {
  const path = expandHome(typed.trim());
  if (!isAbsolute(path) || !(await isFolder(path))) return { refused: { kind: "not-a-folder" } };
  return { folder: await realpath(path) };
}

/** Why an added folder is left out as its VM starts: gone, a link now, or refused as it would be added now. */
async function leftOutAtStart(folder: MountedFolder, surroundings: FolderSurroundings, mounted: string[]): Promise<LeftOutFolder | null> {
  if (!(await isFolder(folder.path))) return { kind: "missing" };
  if ((await realpath(folder.path)) !== folder.path) return { kind: "refused", refusal: { kind: "now-a-link" } };
  const refusal = await addedFolderRefusal(folder, surroundings, mounted);
  return refusal && { kind: "refused", refusal };
}

/** The added folders a VM mounts as it starts, each looked at again, oldest first; the others left out with why. */
export async function foldersMounted(folders: SandboxFolder[], surroundings: FolderSurroundings): Promise<FoldersMounted> {
  const mounted: MountedFolder[] = [];
  const leftOut: FoldersMounted["leftOut"] = new Map();
  for (const { path, writable } of folders) {
    const why = await leftOutAtStart({ path, writable }, surroundings, mounted.map((folder) => folder.path));
    if (why) leftOut.set(path, why);
    else mounted.push({ path, writable });
  }
  return { mounted, leftOut };
}
