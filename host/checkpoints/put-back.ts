import { lstat, mkdir, readdir, rm, rmdir, symlink, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { Workspace } from "../../shared/model.ts";
import { EXECUTABLE_MODE, SYMLINK_MODE, type CheckpointGit, type Entry, type Location } from "./git.ts";
import { HostProblemError } from "../../shared/host-problems.ts";

/** The files a restore deletes, by their paths, and the snapshot's entries for those it writes back. */
export type PutBackPlan = { added: string[]; kept: Entry[] };

/** A path git reported names a file of this workspace; any other path is not ours to delete. */
function withinWorkspace(workspace: Workspace, path: string) {
  const root = resolve(workspace.path);
  return resolve(root, path).startsWith(root + sep);
}

/** Writes a snapshot's files back into the workspace, and deletes those the turn created. */
export class PutBack {
  constructor(private readonly git: CheckpointGit) {}

  /**
   * Writes back the files the snapshot holds as their own bytes, and through their filter those it holds cleaned. Every
   * file is read before any is touched, so a snapshot git can no longer read fails with the workspace as it was.
   */
  async ownBytes(workspace: Workspace, location: Location, plan: PutBackPlan, cleaned: Set<string>) {
    const entries = plan.kept.filter(({ path }) => withinWorkspace(workspace, path));
    const contents = await this.contentsOf(workspace, location, entries, (path) => cleaned.has(location.prefix + path));
    await this.deleteFiles(workspace, plan.added);
    const linksAsLinks = entries.some(({ mode }) => mode === SYMLINK_MODE) && (await this.writesLinks(workspace));
    for (const entry of entries) await this.putBackFile(workspace, entry, contents.get(entry.path)!, linksAsLinks);
  }

  /**
   * A snapshot from before files were kept as their own bytes holds them converted, so the files it puts back are checked
   * out as git does, from an index of their own: ours keeps the stat data that saves hashing every file again.
   */
  async asGitChecksOut(workspace: Workspace, commit: string, plan: PutBackPlan) {
    await this.deleteFiles(workspace, plan.added);
    if (plan.kept.length === 0) return;
    const checkout = this.git.fileOf(workspace, ".restore.index");
    try {
      await rm(checkout, { force: true });
      await this.git.mustRun(workspace, ["read-tree", commit], { ownIndex: checkout });
      await this.git.mustRun(workspace, ["checkout-index", "-f", "-z", "--stdin"], { ownIndex: checkout, input: plan.kept.map(({ path }) => `${path}\0`).join("") });
    } finally {
      await rm(checkout, { force: true });
    }
  }

  /**
   * Like git's own checkout of a file: a file or link where a folder of its path should be makes way for the folder, and
   * whatever stands at the path itself, a folder and what git ignores in it included, makes way for the file.
   */
  private async putBackFile(workspace: Workspace, { mode, path }: Entry, bytes: Uint8Array, linksAsLinks: boolean) {
    const full = join(workspace.path, path);
    await this.makeFoldersUpTo(workspace.path, dirname(full));
    await rm(full, { recursive: true, force: true });
    if (mode === SYMLINK_MODE && linksAsLinks) await symlink(new TextDecoder().decode(bytes), full);
    else await writeFile(full, bytes, { mode: mode === EXECUTABLE_MODE ? 0o777 : 0o666 });
  }

  private async makeFoldersUpTo(root: string, folder: string) {
    let at = root;
    for (const name of relative(root, folder).split(sep).filter(Boolean)) {
      at = join(at, name);
      const found = await lstat(at).catch(() => null);
      if (found?.isDirectory()) continue;
      if (found) await rm(at, { force: true });
      await mkdir(at);
    }
  }

  private async writesLinks(workspace: Workspace) {
    return (await this.git.run(workspace, ["config", "--type=bool", "core.symlinks"])).stdout !== "false";
  }

  /** Each entry's bytes by its path: the blobs held as they are in one `git cat-file` call, the cleaned ones through their filter. */
  private async contentsOf(workspace: Workspace, { atTop, prefix }: Location, entries: Entry[], isCleaned: (path: string) => boolean) {
    const throughFilter = ({ mode, path }: Entry) => mode !== SYMLINK_MODE && isCleaned(path);
    const asTheyAre = entries.filter((entry) => !throughFilter(entry));
    const blobs = await this.blobsOf(workspace, [...new Set(asTheyAre.map(({ blob }) => blob))]);
    const contents = new Map(asTheyAre.map(({ blob, path }) => [path, blobs.get(blob)!]));
    for (const { blob, path } of entries.filter(throughFilter)) {
      contents.set(path, (await this.git.mustRunForBytes(atTop, ["cat-file", "--filters", `--path=${prefix}${path}`, blob])).stdout);
    }
    return contents;
  }

  /**
   * The blobs' bytes from one `git cat-file --batch` call, keyed by blob; each answer is a header line naming the blob's
   * size, the bytes themselves, and a newline.
   */
  private async blobsOf(workspace: Workspace, blobs: string[]) {
    const contents = new Map<string, Uint8Array>();
    if (blobs.length === 0) return contents;
    const { stdout } = await this.git.mustRunForBytes(workspace, ["cat-file", "--batch"], { input: `${blobs.join("\n")}\n` });
    const decoder = new TextDecoder();
    let at = 0;
    for (const blob of blobs) {
      const headerEnd = stdout.indexOf(0x0a, at);
      const [, type = "", size = ""] = decoder.decode(stdout.subarray(at, headerEnd === -1 ? stdout.byteLength : headerEnd)).split(" ");
      if (headerEnd === -1 || type !== "blob") throw new HostProblemError({ code: "snapshot-blob-unreadable", blob, directory: workspace.path });
      contents.set(blob, stdout.subarray(headerEnd + 1, headerEnd + 1 + Number(size)));
      at = headerEnd + 1 + Number(size) + 1;
    }
    return contents;
  }

  private async deleteFiles(workspace: Workspace, paths: string[]) {
    await Promise.all(
      paths.filter((path) => withinWorkspace(workspace, path)).map(async (path) => {
        const full = join(workspace.path, path);
        await rm(full, { force: true });
        await this.pruneEmptyDirectories(workspace.path, dirname(full));
      }),
    );
  }

  /** A folder that held only deleted files would otherwise be left behind, empty. */
  private async pruneEmptyDirectories(root: string, from: string) {
    for (let directory = from; directory !== root && directory.startsWith(root); directory = dirname(directory)) {
      if ((await readdir(directory).catch(() => [""])).length > 0) return;
      await rmdir(directory).catch(() => {});
    }
  }
}
