// Puts places of the workspace back as Mirador expects them, telling what stood there instead. Run inside a room's VM
// as the agent user, a link it meets leads only to what the VM sees; run on this computer, the VM is stopped. Either
// way it never acts through a link on the way to a place. usage: bun held-places.ts < request.json > found.json
import { chmodSync, closeSync, constants, lstatSync, mkdirSync, openSync, readdirSync, readlinkSync, readSync, rmSync, symlinkSync, writeSync, type Stats } from "node:fs";
import { dirname, join } from "node:path";

export type PlaceEntry = { kind: "none" } | { kind: "file"; base64: string } | { kind: "link"; target: string } | { kind: "unkept" };

export interface Place {
  path: string;
  expected: PlaceEntry;
  /** Whether what a folder there holds is told file by file, as in a held folder, rather than as one entry. */
  toldFileByFile: boolean;
}

export interface PlacesRequest {
  workspace: string;
  places: Place[];
  mostBytesEach: number;
  mostBytes: number;
  mostFound: number;
}

export interface FoundEntry {
  path: string;
  found: PlaceEntry;
}

export interface PlacesPutBack {
  found: FoundEntry[];
  failed: { path: string; error: string }[];
}

const statOf = (path: string): Stats | null => {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
};

export function bytesAtMost(path: string, most: number): Buffer | null {
  const file = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const buffer = Buffer.alloc(most + 1);
    let size = 0;
    for (let read = -1; read !== 0 && size <= most; size += read) read = readSync(file, buffer, size, buffer.length - size, null);
    return size > most ? null : buffer.subarray(0, size);
  } finally {
    closeSync(file);
  }
}

function makeFoldersOnTheWay(workspace: string, path: string) {
  let at = workspace;
  for (const part of path.split("/").slice(0, -1)) {
    at = join(at, part);
    if (!statOf(at)) mkdirSync(at);
  }
}

class Finding {
  readonly found: FoundEntry[] = [];
  private bytes = 0;

  constructor(private readonly request: PlacesRequest) {}

  full() {
    return this.found.length >= this.request.mostFound;
  }

  /** What stands at the place: a file, a link, anything else as unkept; a held folder's entries each, as far as there is room. */
  tell(path: string, toldFileByFile: boolean) {
    if (this.full()) return;
    const full = join(this.request.workspace, path);
    const stats = statOf(full);
    if (stats?.isDirectory() && toldFileByFile) return readdirSync(full).toSorted().forEach((name) => this.tell(`${path}/${name}`, true));
    this.found.push({ path, found: this.entryOf(full, stats) });
  }

  private entryOf(full: string, stats: Stats | null): PlaceEntry {
    if (!stats) return { kind: "none" };
    if (stats.isSymbolicLink()) return { kind: "link", target: readlinkSync(full) };
    if (!stats.isFile() || stats.size > this.request.mostBytesEach || this.bytes + stats.size > this.request.mostBytes) return { kind: "unkept" };
    const bytes = bytesAtMost(full, this.request.mostBytesEach);
    if (!bytes) return { kind: "unkept" };
    this.bytes += bytes.length;
    return { kind: "file", base64: bytes.toString("base64") };
  }
}

/** The owner's write and search permission back on a folder the agents took it from; a link is left as it is. */
function writableAgain(folder: string) {
  const stats = statOf(folder);
  if (stats?.isDirectory()) chmodSync(folder, (stats.mode & 0o777) | 0o700);
}

function foldersWithin(full: string): string[] {
  if (!statOf(full)?.isDirectory()) return [];
  return [full, ...readdirSync(full).flatMap((name) => foldersWithin(join(full, name)))];
}

/** What stands at the place taken away, folder and all, even where the agents took away the permission to. */
function takenAway(full: string) {
  try {
    rmSync(full, { recursive: true, force: true });
  } catch {
    [dirname(full), ...foldersWithin(full)].forEach(writableAgain);
    rmSync(full, { recursive: true, force: true });
  }
}

/** A link or file standing where a folder on the way to the place should be taken away, so none is ever followed. */
function clearTheWay(workspace: string, path: string) {
  let at = workspace;
  for (const part of path.split("/").slice(0, -1)) {
    at = join(at, part);
    const stats = statOf(at);
    if (!stats) return;
    if (!stats.isDirectory()) return takenAway(at);
  }
}

function putInPlace(workspace: string, { path, expected }: Place) {
  const full = join(workspace, path);
  takenAway(full);
  if (expected.kind === "none" || expected.kind === "unkept") return;
  makeFoldersOnTheWay(workspace, path);
  if (expected.kind === "link") return symlinkSync(expected.target, full);
  const file = openSync(full, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o644);
  try {
    writeSync(file, Buffer.from(expected.base64, "base64"));
  } finally {
    closeSync(file);
  }
}

/**
 * Each place as expected: a link or file on the way to it taken away first, then what stood there told, taken away,
 * folder and all, and the expected entry put there.
 */
export function putPlacesBack(request: PlacesRequest): PlacesPutBack {
  const finding = new Finding(request);
  const failed: PlacesPutBack["failed"] = [];
  for (const place of request.places) {
    try {
      clearTheWay(request.workspace, place.path);
      finding.tell(place.path, place.toldFileByFile);
      putInPlace(request.workspace, place);
    } catch (error) {
      failed.push({ path: place.path, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { found: finding.found, failed };
}

if (import.meta.main) {
  const request = JSON.parse(await Bun.stdin.text()) as PlacesRequest;
  process.stdout.write(JSON.stringify(putPlacesBack(request)));
}
