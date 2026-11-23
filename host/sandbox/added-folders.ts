import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";
import type { SandboxBlocker, SandboxFolder, SandboxFolderRefusal, SandboxFolderState } from "../../shared/sandbox.ts";
import { expandHome } from "../paths.ts";
import { SOCKETS_FOLDER_PREFIX } from "./socket-folders.ts";
import { isInside, miradorsOwn, realOrAsIs, type MiradorPlaces } from "./workspace-mounts.ts";

/** What a folder added to one sandbox must keep clear of. */
export interface FolderSurroundings {
  places: MiradorPlaces;
  /** The sandbox's workspace, without links; null where it has none now. */
  workspace: string | null;
  /** The folders every VM is given of Mirador's own, on this computer or in the VM: none may hold one, nor lie inside one. */
  sandboxOwn: string[];
  /** Where each VM's sockets get a folder of their own. */
  socketsParent: string;
}

/** Each of the sandbox's added folders its VM starts with: those it mounts, and why each other one is left out. */
export interface FoldersMounted {
  mounted: string[];
  leftOut: Map<string, Exclude<SandboxFolderState, { kind: "in-sandbox" | "waiting" }>>;
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

/**
 * Why the folder, given without links, can't go into the sandbox beside `others`, its other added folders; null where
 * it can. Only a folder inside the owner's home goes in, never home itself, a hidden folder right under it or a Mac's
 * Library, nor any of Mirador's own places or the sandbox's, its workspace, or another added folder or one inside it.
 */
export async function addedFolderRefusal(folder: string, surroundings: FolderSurroundings, others: string[]): Promise<SandboxFolderRefusal | null> {
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
  return overlapping ? { kind: "overlaps-folder", folder: overlapping } : null;
}

const isFolder = async (path: string) => (await stat(path).catch(() => null))?.isDirectory() === true;

/** The folder the owner typed, `~` standing for their home, without links; or why there is none to add. */
export async function folderToAdd(typed: string): Promise<{ folder: string } | { refused: SandboxFolderRefusal }> {
  const path = expandHome(typed.trim());
  if (!isAbsolute(path) || !(await isFolder(path))) return { refused: { kind: "not-a-folder" } };
  return { folder: await realpath(path) };
}

/** Why an added folder is left out as its VM starts: gone, a link now, or refused as it would be added now. */
async function leftOutAtStart(folder: string, surroundings: FolderSurroundings, mounted: string[]) {
  if (!(await isFolder(folder))) return { kind: "missing" } as const;
  if ((await realpath(folder)) !== folder) return { kind: "refused", refusal: { kind: "now-a-link" } } as const;
  const refusal = await addedFolderRefusal(folder, surroundings, mounted);
  return refusal && ({ kind: "refused", refusal } as const);
}

/** The added folders a VM mounts as it starts, each looked at again, oldest first; the others left out with why. */
export async function foldersMounted(folders: SandboxFolder[], surroundings: FolderSurroundings): Promise<FoldersMounted> {
  const mounted: string[] = [];
  const leftOut: FoldersMounted["leftOut"] = new Map();
  for (const { path } of folders) {
    const why = await leftOutAtStart(path, surroundings, mounted);
    if (why) leftOut.set(path, why);
    else mounted.push(path);
  }
  return { mounted, leftOut };
}
