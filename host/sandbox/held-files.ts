import { watch, type FSWatcher } from "node:fs";
import { lstat, readdir, readlink } from "node:fs/promises";
import { join, sep } from "node:path";
import { HELD_CHANGES_MOST, HELD_TEXT_SHOWN, holdsAllInside, isHeldConfigPath, isNeverHeldFolder, type HeldChange, type HeldChangeAnswer, type HeldChangeText, ownerKey, type SandboxOwner } from "../../shared/sandbox.ts";
import { bytesAtMost, putPlacesBack, type FoundEntry, type PlaceEntry, type PlacesPutBack, type PlacesRequest } from "./in-vm/held-places.ts";

const NONE: PlaceEntry = { kind: "none" };

/** The most bytes of one held file kept aside, of all of one put-back, and the most entries one put-back tells of. */
export const HELD_FILE_MOST_BYTES = 1024 * 1024;
const PUT_BACK_MOST_BYTES = 4 * 1024 * 1024;
const PUT_BACK_MOST_FOUND = 200;

export class HeldFilesRefused extends Error {}

/** A change as it is held, for every sandbox that works in the folder. */
type ChangeKept = Omit<HeldChange, "owner" | "folder">;

/**
 * A room or workspace whose sandbox works in the folder: as its workspace, or as one added to it read and write; or one
 * that left it, turned off or moved elsewhere, which still answers the changes it was told of there, and hears of no more.
 */
interface WorksThere {
  owner: SandboxOwner;
  asAddedFolder: boolean;
  left: boolean;
}

/** What the held files of a folder ask of the sandboxes that work in it, all of whose VMs that write there share them. */
export interface HeldSandbox {
  /** The agents at work in their VMs there, by profile id, and their conversations. */
  atWork(): { agents: string[]; conversationIds: string[] };
  /** Whether a brought agent's VM is working in the folder. */
  broughtAtWork(): boolean;
  changed(): void;
  /** Puts places back inside one of the VMs, as its agent user, while one runs; null where none does. */
  inVm(): ((request: PlacesRequest) => Promise<PlacesPutBack>) | null;
  /** Stops the VMs, once their agents held too many changes, or a put-back did not hold. */
  halt(): Promise<void>;
  /** Stops only the brought agents' VMs, once they held too many changes. */
  haltBrought(): Promise<void>;
  /** Once each stop asked for is done: whether none of the VMs runs any longer, so this computer may put places back with none racing it. */
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
  change: ChangeKept;
  before: PlaceEntry;
  proposed: PlaceEntry;
  byBrought: boolean;
  /** Whose sandboxes are told of it, by `ownerKey`: those working there as it came, or that came to work there since. */
  toldTo: Set<string>;
}

/**
 * While a sandbox's VM runs, its agents may write any file of the workspace but the held ones: those agents load their
 * settings, instructions or MCP servers from, and those that run by themselves. The ones there as the VM starts are
 * protected by its guard. Each one written where there was none is put back at once, inside the VM while it runs,
 * and what was written is kept aside for the owner to allow or discard; a folder, link or anything else standing at a
 * held path goes too. This computer checks each put-back itself, and stops the VM when one did not hold. A link is never
 * followed on the way to a held path.
 */
export class HeldFiles {
  private readonly expected = new Map<string, PlaceEntry>();
  private readonly held = new Map<string, Held>();
  private readonly pending = new Set<string>();
  /** What a path the owner just allowed holds until it is written as allowed: there by this computer's doing, not the agents'. */
  private readonly allowedOver = new Map<string, PlaceEntry>();
  private draining?: Promise<void>;
  private watcher?: FSWatcher;
  private protectedByGuard: string[] = [];
  /** Whose sandboxes work there or did while these were held, each told of every change of it, by `ownerKey`. */
  private readonly working = new Map<string, WorksThere>();

  /** `workspace` is the folder whose files it holds: the workspace of each sandbox that works there, or a folder added to one read and write. */
  constructor(
    readonly workspace: string,
    private readonly sandbox: HeldSandbox,
  ) {}

  /** The sandbox works in the folder from now on, and is told of every change waiting there too. */
  worksThere(owner: SandboxOwner, asAddedFolder = false) {
    const key = ownerKey(owner);
    this.working.set(key, { owner, asAddedFolder, left: false });
    this.held.forEach(({ toldTo }) => toldTo.add(key));
  }

  worksThereNoLonger(owner: SandboxOwner) {
    this.working.delete(ownerKey(owner));
  }

  /** The sandbox was turned off, or its room moved to another workspace: it still answers what it was told of here, and is told of nothing new. */
  left(owner: SandboxOwner) {
    const working = this.working.get(ownerKey(owner));
    if (!working) return;
    working.left = true;
    this.forgetLeftWithNothingToAnswer();
  }

  private forgetLeftWithNothingToAnswer() {
    const toAnswer = new Set([...this.held.values()].flatMap(({ toldTo }) => [...toldTo]));
    [...this.working].filter(([key, { left }]) => left && !toAnswer.has(key)).forEach(([key]) => this.working.delete(key));
  }

  private stillThere(): string[] {
    return [...this.working].filter(([, { left }]) => !left).map(([key]) => key);
  }

  owners(): SandboxOwner[] {
    return [...this.working.values()].map(({ owner }) => owner);
  }

  /**
   * Takes in the held paths as they are, and watches from then on: the held files and folders there are, which the VM's
   * guard is to protect, by path from the workspace; a link stays and is watched. Throws HeldFilesRefused for anything else.
   */
  async start(): Promise<string[]> {
    const toProtect: string[] = [];
    for (const path of await this.placesAt("")) {
      const stats = await lstat(join(this.workspace, path));
      if (stats.isSymbolicLink()) this.expected.set(path, { kind: "link", target: await readlink(join(this.workspace, path)) });
      else if (stats.isFile() || stats.isDirectory()) toProtect.push(path);
      else throw new HeldFilesRefused(`${path} is neither a file, a folder nor a link`);
    }
    this.protectedByGuard = toProtect;
    this.watcher = watch(this.workspace, { recursive: true }, (_event, name) => {
      if (name) void this.heard(name.toString().split(sep).join("/"));
    });
    this.watcher.on("error", () => void this.check());
    return toProtect;
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

  /** The changes held there as a VM worked in the folder before, still waiting for those it was told to. */
  takeOver(previous: HeldFiles) {
    previous.held.forEach((kept, path) => this.held.set(path, kept));
    previous.working.forEach((working, key) => this.working.has(key) || this.working.set(key, working));
  }

  /** What it holds, as the room or workspace is told of it; nothing where its sandbox doesn't work there. */
  changesFor(owner: SandboxOwner): HeldChange[] {
    const key = ownerKey(owner);
    const working = this.working.get(key);
    if (!working) return [];
    return [...this.held.values()].filter(({ toldTo }) => toldTo.has(key)).map(({ change }) => ({ ...change, owner: working.owner, folder: working.asAddedFolder ? this.workspace : null }));
  }

  holdsAny() {
    return this.held.size > 0;
  }

  /** Whether the sandbox's own agents hold as many changes as a sandbox may: their VM does not start again until the owner answers some. */
  full() {
    return this.count(false) >= HELD_CHANGES_MOST;
  }

  /** Whether brought agents hold as many changes as they may: their VMs do not start again until the owner answers some. */
  fullForBrought() {
    return this.count(true) >= HELD_CHANGES_MOST;
  }

  private count(byBrought: boolean) {
    let total = 0;
    for (const entry of this.held.values()) if (entry.byBrought === byBrought) total += 1;
    return total;
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
    this.sandbox.changed();
    this.forgetLeftWithNothingToAnswer();
  }

  private async heard(path: string) {
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
        await this.settle(roots).catch((error: unknown) => console.error(`holding agent config files in ${this.workspace}:`, error));
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
    const inVm = this.sandbox.inVm();
    if (inVm) {
      const putBack = await inVm(this.requestFor(differing)).catch(() => null);
      const haltedBrought = putBack ? await this.keepAside(putBack.found.filter(({ path }) => isPathUnderAny(path, differing))) : false;
      let left = await this.differingAmong(differing);
      if (left.length === 0) return;
      const stillInVm = haltedBrought ? this.sandbox.inVm() : null;
      if (stillInVm) {
        const retry = await stillInVm(this.requestFor(left)).catch(() => null);
        if (retry) await this.keepAside(retry.found.filter(({ path }) => isPathUnderAny(path, left)));
        left = await this.differingAmong(left);
        if (left.length === 0) return;
      }
      await this.sandbox.halt();
    }
    if (await this.sandbox.untilStopped()) {
      const result = putPlacesBack(this.requestFor(await this.differingAmong(differing)));
      if (result.failed.length > 0) console.error(`could not put back held files in ${this.workspace}:`, result.failed);
      await this.keepAside(result.found);
    }
  }

  private requestFor(paths: string[]): PlacesRequest {
    const places = paths.map((path) => ({ path, expected: this.expected.get(path) ?? NONE, toldFileByFile: holdsAllInside(path) }));
    return { workspace: this.workspace, places, mostBytesEach: HELD_FILE_MOST_BYTES, mostBytes: PUT_BACK_MOST_BYTES, mostFound: PUT_BACK_MOST_FOUND };
  }

  private async keepAside(found: FoundEntry[]): Promise<boolean> {
    const byBrought = this.sandbox.broughtAtWork();
    const proposals = found.filter(({ path, found }) => !this.isAsLeft(path, found));
    const overflowing = proposals.filter(({ path, found }) => !this.hold(path, found, byBrought));
    if (proposals.length > overflowing.length) this.sandbox.changed();
    if (overflowing.length === 0) return false;
    if (byBrought) {
      await this.sandbox.haltBrought();
      return true;
    }
    await this.sandbox.halt();
    return false;
  }

  private isAsLeft(path: string, found: PlaceEntry) {
    const allowedOver = this.allowedOver.get(path);
    return sameEntry(this.expected.get(path) ?? NONE, found) || (allowedOver !== undefined && sameEntry(allowedOver, found));
  }

  /** Keeps the proposal aside, in place of one for the same path; false where the sandbox holds as many as it may. */
  private hold(path: string, proposed: PlaceEntry, byBrought: boolean) {
    const kept = this.held.get(path);
    if (!kept && (byBrought ? this.fullForBrought() : this.full())) return false;
    const before = this.expected.get(path) ?? NONE;
    const [beforeText, afterText] = [textOf(before), textOf(proposed)];
    const unshown = beforeText === undefined || afterText === undefined;
    const change: ChangeKept = {
      id: kept?.change.id ?? crypto.randomUUID(),
      path,
      ...this.sandbox.atWork(),
      kind: kindOfChange(before, proposed),
      ...(unshown && { unshown: true as const }),
      at: Date.now(),
    };
    this.held.set(path, { change, before, proposed, byBrought: kept?.byBrought ?? byBrought, toldTo: new Set(this.stillThere()) });
    this.forgetLeftWithNothingToAnswer();
    return true;
  }

  /** Paths the agents can't write, or that are never held: what the guard protects, and git's and the packages' folders. */
  private untouched(path: string) {
    return path.split("/").some(isNeverHeldFolder) || this.protectedByGuard.some((folder) => isUnder(path, folder));
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
    return [...new Set([...listed, ...expected])];
  }

  private async differingAmong(paths: string[]) {
    const differing = await Promise.all(paths.map(async (path) => (sameEntry(this.expected.get(path) ?? NONE, await this.entryOnThisComputer(path)) ? [] : [path])));
    return differing.flat();
  }

  /** What stands at a place as this computer sees it through the workspace's own folders: none where a link or file is on the way. */
  private async entryOnThisComputer(path: string): Promise<PlaceEntry> {
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
