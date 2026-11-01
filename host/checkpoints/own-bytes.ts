import { copyFile, lstat, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Workspace } from "../../shared/model.ts";
import { changesIn, EXECUTABLE_MODE, WITHOUT_SAFECRLF, type Change, type CheckpointGit, type Entry, type Location } from "./git.ts";
import { HostProblemError } from "../../shared/host-problems.ts";

const FILE_MODES = new Set(["100644", EXECUTABLE_MODE]);
const CONVERTING_ATTRIBUTES = ["text", "eol", "crlf", "ident", "working-tree-encoding"];
const NOT_SET = new Set(["unspecified", "unset"]);

/** `git ls-files -s -z`: each entry's mode, object and stage, a tab, and its path, which may hold tabs of its own. */
function entriesIn(output: string) {
  return output.split("\0").filter(Boolean).map((line) => {
    const tab = line.indexOf("\t");
    const [mode = "", blob = ""] = line.slice(0, tab).split(" ");
    return { mode, blob, path: line.slice(tab + 1) };
  });
}

/** `git check-attr -z`: a path, an attribute and its value, again and again. */
function attributesIn(output: string) {
  const fields = output.split("\0");
  const attributes = new Map<string, Map<string, string>>();
  Array.from({ length: Math.floor(fields.length / 3) }, (_, index) => fields.slice(index * 3, index * 3 + 3)).forEach(([path = "", attribute = "", value = ""]) => {
    attributes.set(path, (attributes.get(path) ?? new Map()).set(attribute, value));
  });
  return attributes;
}

/** The entries whose own bytes are another blob than the one git stores. */
function differingOf(entries: Entry[], ownBlobs: Map<string, string>) {
  return entries.flatMap((entry) => {
    const blob = ownBlobs.get(entry.path);
    return blob !== undefined && blob !== entry.blob ? [{ ...entry, blob }] : [];
  });
}

/** The tree of our staging index, the tree of the files' own bytes, and the paths a filter cleans. */
export type Staged = { converted: string; ownBytes: string; cleaned: string[] };

/**
 * What a stage left: our staging index's file as git last wrote it, and what it staged. git writes an index through a
 * lock file it renames, so a write by anyone else gives the file another identity.
 */
type OwnBytesState = Staged & { version: typeof OWN_BYTES_STATE_VERSION; staging: FileIdentity | null };
type FileIdentity = { ino: number; size: number; mtimeMs: number };
const OWN_BYTES_STATE_VERSION = 1;

/** A state of another version, or one that cannot be read, is no state: the next stage builds the index again. */
function stateIn(text: string): OwnBytesState | null {
  try {
    const state = JSON.parse(text) as OwnBytesState;
    return state.version === OWN_BYTES_STATE_VERSION ? state : null;
  } catch {
    return null;
  }
}

/**
 * Our staging index, and the files' own bytes beside it.
 *
 * git add stores a file as the repository's attributes ask: line endings converted, filters such as Git LFS run. Our
 * staging index keeps that form, so git can tell from the files' stat data which ones changed; a second index holds
 * each file's own bytes in its place, and a snapshot is that index's tree. A file a filter cleans stays in the filter's
 * form, so a large file LFS keeps elsewhere does not land in the repository, and comes back through the filter.
 */
export class OwnBytesStaging {
  constructor(private readonly git: CheckpointGit) {}

  /**
   * Writes the working tree into our index, which git compares against the files it hashed last time, and brings the
   * files' own bytes up to date with it. A nested git repository with no commit yet makes git refuse the whole add, so
   * those stay out of the snapshot.
   *
   * Only the files the add changed, and those whose stat data says they changed though git stores them as before, as an
   * edit of nothing but line endings does, are hashed again. While no file's own bytes differ from what git stores, the
   * staging index's tree is theirs too, with no second index to keep. The state that says what the last stage left is
   * taken away while a stage runs, so one that fails or never ends leaves the next to work it all out again.
   */
  async stageEverything(workspace: Workspace, location: Location): Promise<Staged> {
    const state = await this.takeOwnBytesState(workspace);
    const upToDate = state !== null && (await this.leftAsItWas(workspace, state));
    const beforeAdd = this.git.fileOf(workspace, ".before-add.index");
    if (upToDate) await copyFile(this.git.fileOf(workspace, ".index"), beforeAdd);
    const [statChanged, added] = await Promise.all([upToDate ? this.statChangedIn(workspace, beforeAdd) : Promise.resolve([]), this.addEverything(workspace)]);
    if (added.exitCode !== 0) {
      if (state) await this.putOwnBytesState(workspace, state);
      throw new HostProblemError({ code: "git-failed", command: "add", directory: workspace.path, output: added.stderr || added.stdout });
    }
    const converted = (await this.git.mustRun(workspace, ["write-tree"])).stdout;
    const staged = upToDate ? await this.followChanges(workspace, location, state, converted, statChanged) : await this.ownBytesFromScratch(workspace, location, converted);
    await this.putOwnBytesState(workspace, { ...staged, version: OWN_BYTES_STATE_VERSION, staging: await this.identityOf(this.git.fileOf(workspace, ".index")) });
    return staged;
  }

  private async addEverything(workspace: Workspace) {
    const withoutCommit = await this.nestedRepositoriesWithNoCommit(workspace);
    const excludes = withoutCommit.map((entry) => `:(exclude,literal)${entry}`);
    return this.git.run(workspace, [...WITHOUT_SAFECRLF, "add", "-A", "--", ".", ...excludes], { pathspecMagic: true });
  }

  /**
   * The nested git repositories with no commit of their own: git lists each untracked repository as one folder entry,
   * and one whose HEAD cannot be read has no commit to record as a gitlink, unlike a committed one.
   */
  private async nestedRepositoriesWithNoCommit(workspace: Workspace) {
    const listed = await this.git.mustRun(workspace, ["ls-files", "-o", "--exclude-standard", "-z"]);
    const repositories = listed.stdout.split("\0").filter((entry) => entry.endsWith("/"));
    const withoutCommit: string[] = [];
    for (const repository of repositories) {
      if ((await this.git.run(workspace, ["-C", repository, "rev-parse", "--verify", "--quiet", "HEAD"])).exitCode !== 0) withoutCommit.push(repository);
    }
    return withoutCommit;
  }

  /** Whether our staging index is the one the last stage left, and the index of own bytes is there if that stage needed one. */
  private async leftAsItWas(workspace: Workspace, state: OwnBytesState) {
    const staging = await this.identityOf(this.git.fileOf(workspace, ".index"));
    if (staging === null || JSON.stringify(staging) !== JSON.stringify(state.staging)) return false;
    return state.ownBytes === state.converted || (await this.identityOf(this.git.fileOf(workspace, ".own-bytes.index"))) !== null;
  }

  private async identityOf(file: string): Promise<FileIdentity | null> {
    const found = await stat(file).catch(() => null);
    return found && { ino: found.ino, size: found.size, mtimeMs: found.mtimeMs };
  }

  /** The files whose stat data differs from the copy of our index taken before the add, which runs meanwhile. */
  private async statChangedIn(workspace: Workspace, beforeAdd: string) {
    try {
      return changesIn((await this.git.mustRun(workspace, ["diff-files", "-z", "--raw"], { ownIndex: beforeAdd })).stdout);
    } finally {
      await rm(beforeAdd, { force: true });
    }
  }

  /** What the add changed, and the bytes of the files whose stat data changed, brought into the files' own bytes. */
  private async followChanges(workspace: Workspace, { atTop }: Location, last: Staged, converted: string, statChanged: Change[]): Promise<Staged> {
    const changed = converted === last.converted ? [] : changesIn((await this.git.mustRun(workspace, ["diff-tree", "-r", "-z", "--raw", "--no-renames", last.converted, converted])).stdout);
    const changedPaths = new Set(changed.map(({ path }) => path));
    const entries = [
      ...changed.map(({ toMode, toBlob, path }) => ({ mode: toMode, blob: toBlob, path })),
      ...statChanged.filter(({ path }) => !changedPaths.has(path)).map(({ fromMode, fromBlob, path }) => ({ mode: fromMode, blob: fromBlob, path })),
    ];
    if (entries.length === 0) return { ...last, converted };
    const { ownBlobs, cleaned } = await this.ownBytesOf(atTop, entries);
    const touched = new Set(entries.map(({ path }) => path));
    const allCleaned = [...last.cleaned.filter((path) => !touched.has(path)), ...cleaned].sort();
    const ownBytes =
      last.ownBytes === last.converted
        ? await this.ownBytesOver(workspace, atTop, converted, differingOf(entries, ownBlobs))
        : await this.updatedOwnBytes(workspace, atTop, entries.map((entry) => ({ ...entry, blob: ownBlobs.get(entry.path) ?? entry.blob })));
    return { converted, ownBytes, cleaned: allCleaned };
  }

  /** The files' own bytes worked out from every file of our staging index, git's conversions looked up for each. */
  private async ownBytesFromScratch(workspace: Workspace, { atTop }: Location, converted: string): Promise<Staged> {
    const entries = entriesIn((await this.git.mustRun(atTop, ["ls-files", "-s", "-z"])).stdout);
    const { ownBlobs, cleaned } = await this.ownBytesOf(atTop, entries);
    return { converted, ownBytes: await this.ownBytesOver(workspace, atTop, converted, differingOf(entries, ownBlobs)), cleaned: cleaned.sort() };
  }

  /** The tree of the staging tree with the files whose own bytes differ in their place, held by an index of its own from now on. */
  private async ownBytesOver(workspace: Workspace, atTop: Workspace, converted: string, differing: Entry[]) {
    if (differing.length === 0) return converted;
    await this.git.mustRun(workspace, ["read-tree", converted], { ownIndex: this.git.fileOf(workspace, ".own-bytes.index") });
    return this.updatedOwnBytes(workspace, atTop, differing);
  }

  /** Entries go into the index of own bytes as given, or out where git's mode for them says there is no file. */
  private async updatedOwnBytes(workspace: Workspace, atTop: Workspace, entries: Entry[]) {
    const ownIndex = this.git.fileOf(workspace, ".own-bytes.index");
    const input = entries.map(({ mode, blob, path }) => `${mode} ${blob}\t${path}\0`).join("");
    await this.git.mustRun(atTop, ["update-index", "-z", "--index-info"], { ownIndex, input });
    return (await this.git.mustRun(workspace, ["write-tree"], { ownIndex })).stdout;
  }

  /**
   * The blob of their own bytes for the files git may have converted, by path, and the paths a filter cleans, which keep
   * git's blob.
   */
  private async ownBytesOf(atTop: Workspace, entries: Entry[]) {
    const { cleaned, converted } = await this.conversionsOf(atTop, entries.filter(({ mode }) => FILE_MODES.has(mode)).map(({ path }) => path));
    const ownBlobs = await this.ownBlobsOf(atTop, [...converted].filter((path) => !cleaned.has(path)));
    return { ownBlobs, cleaned: [...cleaned] };
  }

  /**
   * Which of the files, by their path from the repository's top, a configured filter cleans, and which git's attributes
   * may convert in other ways, as line endings.
   */
  private async conversionsOf(atTop: Workspace, paths: string[]) {
    if (paths.length === 0) return { cleaned: new Set<string>(), converted: new Set<string>() };
    const input = paths.map((path) => `${path}\0`).join("");
    const listed = new TextDecoder().decode((await this.git.mustRunForBytes(atTop, ["check-attr", "-z", "--stdin", "filter", ...CONVERTING_ATTRIBUTES], { input })).stdout);
    const attributes = [...attributesIn(listed)];
    const filtering = attributes.some(([, values]) => !NOT_SET.has(values.get("filter") ?? "unspecified"));
    const drivers = filtering ? await this.cleaningFilters(atTop) : new Set<string>();
    const cleaned = attributes.filter(([, values]) => drivers.has(values.get("filter") ?? "")).map(([path]) => path);
    const converted = attributes.filter(([, values]) => CONVERTING_ATTRIBUTES.some((attribute) => !NOT_SET.has(values.get(attribute) ?? "unspecified"))).map(([path]) => path);
    return { cleaned: new Set(cleaned), converted: new Set(converted) };
  }

  /** The filters git's config gives a command to clean files with; one named in .gitattributes but not configured cleans nothing. */
  private async cleaningFilters(workspace: Workspace) {
    const listed = await this.git.run(workspace, ["config", "-z", "--get-regexp", "^filter\\..*\\.(clean|process)$"]);
    const keys = listed.stdout.split("\0").filter(Boolean).map((entry) => entry.split("\n")[0] ?? "");
    return new Set(keys.map((key) => key.slice("filter.".length, key.lastIndexOf("."))));
  }

  /**
   * The blob of each file's own bytes, written into the repository, by path. git hashes a batch at once, but reads its
   * lines unquoting one that begins with a double quote and dropping a carriage return that ends one, so such names, and
   * names with a newline, go one by one. A file gone since the add keeps the blob the add gave it.
   */
  private async ownBlobsOf(atTop: Workspace, paths: string[]) {
    const hash = ["hash-object", "-w", "--no-filters"];
    const misreadInABatch = (path: string) => /^"|[\n\r]/.test(path);
    const oneByOne = paths.filter(misreadInABatch);
    const batchable = paths.filter((path) => !misreadInABatch(path));
    const blobs = new Map<string, string>();
    const hashBatch = async (batch: string[]) => {
      if (batch.length === 0) return true;
      const hashed = await this.git.run(atTop, [...hash, "--stdin-paths"], { input: `${batch.join("\n")}\n` });
      if (hashed.exitCode !== 0) return false;
      hashed.stdout.split("\n").forEach((blob, index) => blobs.set(batch[index]!, blob));
      return true;
    };
    if (!(await hashBatch(batchable))) await hashBatch(await this.stillFiles(atTop, batchable));
    for (const path of oneByOne) {
      const hashed = await this.git.run(atTop, [...hash, "--", path]);
      if (hashed.exitCode === 0) blobs.set(path, hashed.stdout);
    }
    return blobs;
  }

  private async stillFiles(atTop: Workspace, paths: string[]) {
    const found = await Promise.all(paths.map(async (path) => ((await lstat(join(atTop.path, path)).catch(() => null))?.isFile() ? [path] : [])));
    return found.flat();
  }

  private async takeOwnBytesState(workspace: Workspace) {
    const file = this.git.fileOf(workspace, ".own-bytes.json");
    const text = await readFile(file, "utf8").catch(() => null);
    await rm(file, { force: true });
    return text === null ? null : stateIn(text);
  }

  private async putOwnBytesState(workspace: Workspace, state: OwnBytesState) {
    const file = this.git.fileOf(workspace, ".own-bytes.json");
    await writeFile(`${file}.new`, JSON.stringify(state));
    await rename(`${file}.new`, file);
  }
}
