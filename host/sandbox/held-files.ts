import { watch, type FSWatcher } from "node:fs";
import { lstat, readdir, readlink } from "node:fs/promises";
import { join, sep } from "node:path";
import { GIT_CONFIG_REDIRECTS, HELD_CHANGES_MOST, HELD_TEXT_SHOWN, holdsAllInside, isHeldConfigPath, isNeverHeldFolder, type HeldChange, type HeldChangeAnswer, type HeldChangeText } from "../../shared/sandbox.ts";
import { bytesAtMost, putPlacesBack, type FoundEntry, type PlaceEntry, type PlacesPutBack, type PlacesRequest } from "./in-vm/held-places.ts";

const NONE: PlaceEntry = { kind: "none" };

/** The most bytes of one held file kept aside, of all of one put-back, and the most entries one put-back tells of. */
export const HELD_FILE_MOST_BYTES = 1024 * 1024;
const PUT_BACK_MOST_BYTES = 4 * 1024 * 1024;
const PUT_BACK_MOST_FOUND = 200;

/** The most held files and folders of a workspace mounted read-only into its VM. */
export const HELD_MOUNTS_MOST = 100;

export class HeldFilesRefused extends Error {}

/** What the held files of a room ask of its sandbox. */
export interface HeldRoom {
  agentsAtWork(): string[];
  changed(): void;
  /** Puts places back inside the room's VM, as its agent user, while it runs; null once it doesn't. */
  inVm(): ((request: PlacesRequest) => Promise<PlacesPutBack>) | null;
  /** Stops the room's VM, once its agents held too many changes, or its put-back did not hold. */
  halt(): Promise<void>;
  /** Once a stop asked for is done: whether no VM of the room runs, so this Mac may put places back with none racing it. */
  untilStopped(): Promise<boolean>;
}

const sameEntry = (a: PlaceEntry, b: PlaceEntry) =>
  a.kind === b.kind && a.kind !== "unkept" && (a.kind !== "file" || a.base64 === (b as typeof a).base64) && (a.kind !== "link" || a.target === (b as typeof a).target);

const ancestorsOf = (path: string) =>
  path
    .split("/")
    .slice(0, -1)
    .map((_, index, parts) => parts.slice(0, index + 1).join("/"));

const isUnder = (path: string, folder: string) => folder === "" || path === folder || path.startsWith(`${folder}/`);

/** A path the VM told of, as one of the places asked about or within one, with no step out of them. */
const isPathUnderAny = (path: string, places: string[]) => !path.split("/").some((part) => part === "" || part === "." || part === "..") && places.some((place) => isUnder(path, place));

/** The roots no other of them holds. */
const outermost = (roots: string[]) => roots.filter((root, index) => !roots.some((other, otherIndex) => otherIndex !== index && isUnder(root, other) && (other !== root || otherIndex < index)));

const textOf = (entry: PlaceEntry): string | null | undefined => {
  if (entry.kind === "none") return null;
  if (entry.kind === "unkept") return undefined;
  if (entry.kind === "link") return `→ ${entry.target}`;
  const bytes = Buffer.from(entry.base64, "base64");
  if (bytes.length > HELD_TEXT_SHOWN) return undefined;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
};

const kindOfChange = (before: PlaceEntry, after: PlaceEntry): HeldChange["kind"] => (before.kind === "none" ? "add" : after.kind === "none" ? "delete" : "change");

interface Held {
  change: HeldChange;
  before: PlaceEntry;
  proposed: PlaceEntry;
}

/**
 * While a room's VM runs, its agents may write any file of the workspace but the held ones: those agents load their
 * settings, instructions or MCP servers from, and those that run by themselves. The ones there as the VM starts are
 * mounted read-only into it. Each one written where there was none is put back at once, inside the VM while it runs,
 * and what was written is kept aside for the owner to allow or discard; a folder, link or anything else standing at a
 * held path goes too. Files git would read config from elsewhere never stay. This Mac checks each put-back itself, and
 * stops the VM when one did not hold. A link is never followed on the way to a held path.
 */
export class HeldFiles {
  private readonly expected = new Map<string, PlaceEntry>();
  private readonly held = new Map<string, Held>();
  private readonly pending = new Set<string>();
  /** What a path the owner just allowed holds until it is written as allowed: there by this Mac's doing, not the agents'. */
  private readonly allowedOver = new Map<string, PlaceEntry>();
  private draining?: Promise<void>;
  private watcher?: FSWatcher;
  private readOnly: string[] = [];
  private gitRedirects: string[] = [];

  constructor(
    readonly workspace: string,
    private readonly roomId: string,
    private readonly gitFolders: string[],
    private readonly room: HeldRoom,
  ) {}

  /**
   * Takes in the held paths as they are, and watches from then on: the held files and folders there are, which the VM is
   * to see read-only, by path from the workspace; a link stays and is watched. Throws HeldFilesRefused for anything else.
   */
  async start(): Promise<string[]> {
    const readOnly: string[] = [];
    for (const path of await this.placesAt("")) {
      const stats = await lstat(join(this.workspace, path));
      if (stats.isSymbolicLink()) this.expected.set(path, { kind: "link", target: await readlink(join(this.workspace, path)) });
      else if (stats.isFile() || stats.isDirectory()) readOnly.push(path);
      else throw new HeldFilesRefused(`${path} is neither a file, a folder nor a link`);
    }
    if (readOnly.length > HELD_MOUNTS_MOST) throw new HeldFilesRefused(`more than ${HELD_MOUNTS_MOST} agent config files and folders`);
    this.readOnly = readOnly;
    const redirects = this.gitFolders.flatMap((folder) => GIT_CONFIG_REDIRECTS.map((name) => `${folder}/${name}`));
    this.gitRedirects = (await Promise.all(redirects.map(async (path) => ((await lstat(join(this.workspace, path)).catch(() => null)) ? [] : [path])))).flat();
    this.watcher = watch(this.workspace, { recursive: true }, (_event, name) => {
      if (name) void this.heard(name.toString().split(sep).join("/"));
    });
    this.watcher.on("error", () => void this.check());
    return readOnly;
  }

  /** Looks at every held path again, in case a watch event was missed; whether nothing stands at one after but what is expected. */
  async check(): Promise<boolean> {
    await this.queue("");
    const differing = await this.differingAmong(await this.candidatesFor([""]));
    return (await Promise.all(differing.map((path) => this.nothingStandsAt(path)))).every(Boolean);
  }

  /** Whether nothing stands at the place, nor a link or file where a folder on the way to it should be. */
  private async nothingStandsAt(path: string) {
    for (const step of [...ancestorsOf(path), path]) {
      const stats = await lstat(join(this.workspace, step)).catch(() => null);
      if (!stats) return true;
      if (step === path || !stats.isDirectory()) return false;
    }
    return true;
  }

  async stop() {
    this.watcher?.close();
    this.watcher = undefined;
    await this.check();
  }

  /** The changes a previous run of the room's VM held, still waiting for the owner. */
  takeOver(previous: HeldFiles) {
    previous.held.forEach((kept, path) => this.held.set(path, kept));
  }

  changes(): HeldChange[] {
    return [...this.held.values()].map(({ change }) => change);
  }

  /** Whether it holds as many changes as a room may: its VM does not start again until the owner answers some. */
  full() {
    return this.held.size >= HELD_CHANGES_MOST;
  }

  textOf(changeId: string): HeldChangeText | null {
    const found = [...this.held.values()].find(({ change }) => change.id === changeId);
    if (!found) return null;
    const [before, after] = [textOf(found.before), textOf(found.proposed)];
    return before === undefined || after === undefined ? { unshown: true } : { before, after };
  }

  /** Allowing puts the file as proposed, where the agents can't race it, and takes it as it now is; discarding drops the proposal. */
  async answer(changeId: string, answer: HeldChangeAnswer) {
    const found = [...this.held.entries()].find(([, { change }]) => change.id === changeId);
    if (!found) return;
    const [path, { proposed }] = found;
    this.held.delete(path);
    if (answer === "allow" && proposed.kind !== "unkept") {
      this.allowedOver.set(path, this.expected.get(path) ?? NONE);
      if (proposed.kind === "none") this.expected.delete(path);
      else this.expected.set(path, proposed);
      await this.queue(path);
    }
    this.room.changed();
  }

  private async heard(path: string) {
    if (this.gitRedirects.includes(path)) return this.queue(path);
    if (this.untouched(path)) return;
    if (isHeldConfigPath(path) || (await lstat(join(this.workspace, path)).catch(() => null))?.isDirectory()) await this.queue(path);
  }

  /** Paths heard of close together are looked at together, one look at a time. */
  private queue(root: string) {
    this.pending.add(root);
    this.draining ??= this.drain();
    return this.draining;
  }

  private async drain() {
    try {
      while (this.pending.size > 0) {
        const roots = outermost([...this.pending]);
        this.pending.clear();
        await this.settle(roots).catch((error: unknown) => console.error(`holding agent config files of room ${this.roomId}:`, error));
      }
    } finally {
      this.draining = undefined;
    }
  }

  private async settle(roots: string[]) {
    const differing = await this.differingAmong(await this.candidatesFor(roots));
    if (differing.length === 0) return;
    await this.putBack(differing);
    differing.forEach((path) => this.allowedOver.delete(path));
  }

  private async putBack(differing: string[]) {
    const inVm = this.room.inVm();
    if (inVm) {
      const putBack = await inVm(this.requestFor(differing)).catch(() => null);
      if (putBack) await this.keepAside(putBack.found.filter(({ path }) => isPathUnderAny(path, differing)));
      const left = await this.differingAmong(differing);
      if (left.length === 0) return;
      await this.room.halt();
    }
    if (await this.room.untilStopped()) await this.keepAside(putPlacesBack(this.requestFor(await this.differingAmong(differing))).found);
  }

  private requestFor(paths: string[]): PlacesRequest {
    const places = paths.map((path) => ({ path, expected: this.expected.get(path) ?? NONE, toldFileByFile: holdsAllInside(path) }));
    return { workspace: this.workspace, places, mostBytesEach: HELD_FILE_MOST_BYTES, mostBytes: PUT_BACK_MOST_BYTES, mostFound: PUT_BACK_MOST_FOUND };
  }

  private async keepAside(found: FoundEntry[]) {
    const proposals = found.filter(({ path, found }) => !this.gitRedirects.includes(path) && !this.isAsLeft(path, found));
    const overflowing = proposals.filter(({ path, found }) => !this.hold(path, found));
    if (proposals.length > overflowing.length) this.room.changed();
    if (overflowing.length > 0) await this.room.halt();
  }

  private isAsLeft(path: string, found: PlaceEntry) {
    const allowedOver = this.allowedOver.get(path);
    return sameEntry(this.expected.get(path) ?? NONE, found) || (allowedOver !== undefined && sameEntry(allowedOver, found));
  }

  /** Keeps the proposal aside, in place of one for the same path; false where the room holds as many as it may. */
  private hold(path: string, proposed: PlaceEntry) {
    const kept = this.held.get(path);
    if (!kept && this.full()) return false;
    const before = this.expected.get(path) ?? NONE;
    const [beforeText, afterText] = [textOf(before), textOf(proposed)];
    const unshown = beforeText === undefined || afterText === undefined;
    const change: HeldChange = { id: kept?.change.id ?? crypto.randomUUID(), roomId: this.roomId, path, agents: this.room.agentsAtWork(), kind: kindOfChange(before, proposed), ...(unshown && { unshown: true as const }), at: Date.now() };
    this.held.set(path, { change, before, proposed });
    return true;
  }

  /** Paths the agents can't write, or that are never held: what is read-only in the VM, and git's and the packages' folders. */
  private untouched(path: string) {
    return path.split("/").some(isNeverHeldFolder) || this.readOnly.some((folder) => isUnder(path, folder));
  }

  /** The folders that hold a file or link the owner allowed: looked into, rather than held as a whole. */
  private expectedFolders() {
    return new Set([...this.expected.keys()].flatMap(ancestorsOf));
  }

  /** The outermost held path at or above this one that is held as a whole, else the path itself. */
  private heldRootOf(path: string) {
    const folders = this.expectedFolders();
    return [...ancestorsOf(path), path].find((each) => isHeldConfigPath(each) && !folders.has(each)) ?? path;
  }

  /** The outermost held places at or under a path, whatever stands there, reached through the workspace's own folders only. */
  private async placesAt(path: string, folders = this.expectedFolders()): Promise<string[]> {
    if (path !== "" && this.untouched(path)) return [];
    if (path !== "" && isHeldConfigPath(path) && !folders.has(path)) return [path];
    const full = path === "" ? this.workspace : join(this.workspace, path);
    if (!(await lstat(full).catch(() => null))?.isDirectory()) return [];
    const names = await readdir(full).catch((): string[] => []);
    return (await Promise.all(names.map((name) => this.placesAt(path === "" ? name : `${path}/${name}`, folders)))).flat();
  }

  private async candidatesFor(roots: string[]) {
    const heldRoots = roots.map((root) => this.heldRootOf(root));
    const listed = (await Promise.all(heldRoots.map((root) => this.placesAt(root)))).flat();
    const expected = [...this.expected.keys()].filter((path) => heldRoots.some((root) => isUnder(path, root)));
    const redirects = this.gitRedirects.filter((path) => roots.some((root) => isUnder(path, root)));
    return [...new Set([...listed, ...expected, ...redirects])];
  }

  private async differingAmong(paths: string[]) {
    const differing = await Promise.all(paths.map(async (path) => (sameEntry(this.expected.get(path) ?? NONE, await this.entryOnThisMac(path)) ? [] : [path])));
    return differing.flat();
  }

  /** What stands at a place as this Mac sees it through the workspace's own folders: none where a link or file is on the way. */
  private async entryOnThisMac(path: string): Promise<PlaceEntry> {
    for (const folder of ancestorsOf(path)) if (!(await lstat(join(this.workspace, folder)).catch(() => null))?.isDirectory()) return NONE;
    const full = join(this.workspace, path);
    const stats = await lstat(full).catch(() => null);
    if (!stats) return NONE;
    if (stats.isSymbolicLink()) return { kind: "link", target: await readlink(full).catch(() => "") };
    const expected = this.expected.get(path);
    if (!stats.isFile() || expected?.kind !== "file" || stats.size > HELD_FILE_MOST_BYTES) return { kind: "unkept" };
    try {
      const bytes = bytesAtMost(full, HELD_FILE_MOST_BYTES);
      return bytes ? { kind: "file", base64: bytes.toString("base64") } : { kind: "unkept" };
    } catch {
      return { kind: "unkept" };
    }
  }
}
