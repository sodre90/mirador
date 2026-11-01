import { afterEach, beforeEach, expect, test } from "bun:test";
import { appendFile, chmod, lstat, mkdir, mkdtemp, readdir, readFile, readlink, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Workspace } from "../shared/model.ts";
import { Checkpoints, PATHS_LISTED } from "../host/checkpoints.ts";

let dataDir: string;
let projectDir: string;
let checkpoints: Checkpoints;
let workspace: Workspace;

async function git(directory: string, args: string[]) {
  const child = Bun.spawn(["git", "-C", directory, "-c", "user.name=t", "-c", "user.email=t@t", ...args], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [stdout, , exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { stdout: stdout.trim(), exitCode };
}

const write = (relative: string, content: string) => writeFile(join(projectDir, relative), content);
const read = (relative: string) => readFile(join(projectDir, relative), "utf8");

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "mirador-checkpoints-"));
  projectDir = join(dataDir, "project");
  await mkdir(projectDir);
  await git(projectDir, ["-c", "init.defaultBranch=main", "init", "-q"]);
  await write(".gitignore", "build\n");
  await write("kept.txt", "one\n");
  await write("doomed.txt", "doomed\n");
  await git(projectDir, ["add", "-A"]);
  await git(projectDir, ["commit", "-qm", "base"]);
  checkpoints = new Checkpoints(dataDir);
  workspace = { id: "ws-1", name: "project", path: projectDir, defaultLaunch: { harness: "claude", profileId: null }, color: null, position: 0, groupId: null, createdAt: 0 };
});

afterEach(() => rm(dataDir, { recursive: true, force: true }));

test("a restore puts back what a turn changed, deletes what it created, and says how many of each", async () => {
  const snapshot = await checkpoints.snapshot(workspace);
  expect(snapshot).toMatch(/^[0-9a-f]{40}$/);

  await write("kept.txt", "changed by the agent\n");
  await write("added.txt", "new\n");
  await rm(join(projectDir, "doomed.txt"));

  expect((await checkpoints.preview(workspace, snapshot!))?.plan).toEqual({ restored: 2, removed: 1 });
  expect(await checkpoints.restore(workspace, snapshot!)).toEqual({ restored: 2, removed: 1 });
  expect(await read("kept.txt")).toBe("one\n");
  expect(await read("doomed.txt")).toBe("doomed\n");
  await expect(read("added.txt")).rejects.toThrow();
});

test("a restore puts files back with the line endings they had, even where core.autocrlf would convert them", async () => {
  await git(projectDir, ["config", "core.autocrlf", "true"]);
  await write("unix.txt", "lf\n");
  await write("windows.txt", "crlf\r\n");
  await write("mixed.txt", "lf\ncrlf\r\n");
  const before = await git(projectDir, ["status", "--porcelain"]);
  const snapshot = (await checkpoints.snapshot(workspace))!;

  await Promise.all(["kept.txt", "unix.txt", "windows.txt", "mixed.txt"].map((file) => write(file, "changed by the agent\n")));
  await checkpoints.restore(workspace, snapshot);

  expect(await read("kept.txt")).toBe("one\n");
  expect(await read("unix.txt")).toBe("lf\n");
  expect(await read("windows.txt")).toBe("crlf\r\n");
  expect(await read("mixed.txt")).toBe("lf\ncrlf\r\n");
  expect((await git(projectDir, ["status", "--porcelain"])).stdout).toBe(before.stdout);
});

test("a restored folder holds only what the snapshot had, and the folder a deleted file made is gone with it", async () => {
  await mkdir(join(projectDir, "src"));
  await write("src/deep.txt", "deep\n");
  const snapshot = (await checkpoints.snapshot(workspace))!;
  await git(projectDir, ["add", "-A"]);

  await rm(join(projectDir, "src"), { recursive: true });
  await checkpoints.restore(workspace, snapshot);
  expect(await read("src/deep.txt")).toBe("deep\n");

  await rm(join(projectDir, "src", "deep.txt"));
  await checkpoints.restore(workspace, snapshot);
  expect(await read("src/deep.txt")).toBe("deep\n");
});

test("what the user's repository shows is untouched: same branch, same log, same staged changes", async () => {
  await write("staged.txt", "staged\n");
  await git(projectDir, ["add", "staged.txt"]);
  const before = await git(projectDir, ["status", "--porcelain"]);
  const head = (await git(projectDir, ["rev-parse", "HEAD"])).stdout;

  const snapshot = (await checkpoints.snapshot(workspace))!;
  await write("kept.txt", "agent\n");
  await checkpoints.restore(workspace, snapshot);

  expect((await git(projectDir, ["rev-parse", "HEAD"])).stdout).toBe(head);
  expect((await git(projectDir, ["log", "--oneline"])).stdout.split("\n")).toHaveLength(1);
  expect((await git(projectDir, ["branch", "--show-current"])).stdout).toBe("main");
  expect((await git(projectDir, ["status", "--porcelain"])).stdout).toBe(before.stdout);
});

const status = async () => (await git(projectDir, ["status", "--porcelain"])).stdout;
const stagedPaths = async () => (await git(projectDir, ["diff", "--cached", "--name-only"])).stdout.split("\n").filter(Boolean);
const stagedVersionOf = async (relative: string) => (await git(projectDir, ["show", `:${relative}`])).stdout;

test("what the agent staged during the turn is unstaged by a restore, and what the user staged before it is staged again", async () => {
  await write("kept.txt", "staged by the user\n");
  await git(projectDir, ["add", "kept.txt"]);
  const snapshot = (await checkpoints.snapshot(workspace))!;

  await write("kept.txt", "staged by the agent\n");
  await write("doomed.txt", "staged by the agent too\n");
  await write("added.txt", "new, staged by the agent\n");
  await git(projectDir, ["add", "-A"]);
  await checkpoints.restore(workspace, snapshot);

  expect(await read("kept.txt")).toBe("staged by the user\n");
  expect(await stagedPaths()).toEqual(["kept.txt"]);
  expect(await stagedVersionOf("kept.txt")).toBe("staged by the user");
});

test("after a commit since the snapshot, its files stay as committed, and a restore unstages what it puts back rather than stage a revert of the commit", async () => {
  const snapshot = (await checkpoints.snapshot(workspace))!;
  await write("kept.txt", "committed by the agent\n");
  await git(projectDir, ["commit", "-qam", "the agent's commit"]);
  await write("doomed.txt", "staged by the agent\n");
  await git(projectDir, ["add", "doomed.txt"]);

  expect(await checkpoints.restore(workspace, snapshot)).toEqual({ restored: 1, removed: 0, committed: { files: 1, editedSince: 0, commits: 1 } });

  expect(await read("kept.txt")).toBe("committed by the agent\n");
  expect(await read("doomed.txt")).toBe("doomed\n");
  expect(await status()).toBe("");
});

test("a restore leaves the files that commits since the snapshot changed as committed, and puts back the rest", async () => {
  const snapshot = (await checkpoints.snapshot(workspace))!;
  await write("kept.txt", "changed by the agent\n");
  await write("pulled.txt", "pulled\n");
  await write("doomed.txt", "changed by a pull\n");
  await git(projectDir, ["add", "pulled.txt", "doomed.txt"]);
  await git(projectDir, ["commit", "-qm", "a pull"]);
  const plan = { restored: 1, removed: 0, committed: { files: 2, editedSince: 0, commits: 1 } };

  expect((await checkpoints.preview(workspace, snapshot))?.plan).toEqual(plan);
  expect(await checkpoints.restore(workspace, snapshot)).toEqual(plan);

  expect(await read("kept.txt")).toBe("one\n");
  expect(await read("pulled.txt")).toBe("pulled\n");
  expect(await read("doomed.txt")).toBe("changed by a pull\n");
  expect(await status()).toBe("");
});

test("a preview names the files a restore would delete, put back and leave as committed", async () => {
  const snapshot = (await checkpoints.snapshot(workspace))!;
  await write("kept.txt", "changed by the agent\n");
  await rm(join(projectDir, "doomed.txt"));
  await write("added.txt", "new\n");
  await write("pulled.txt", "pulled\n");
  await git(projectDir, ["add", "pulled.txt"]);
  await git(projectDir, ["commit", "-qm", "a pull"]);

  expect((await checkpoints.preview(workspace, snapshot))?.files).toEqual({
    deleted: { paths: ["added.txt"], more: 0 },
    putBack: { paths: ["doomed.txt", "kept.txt"], more: 0 },
    committed: { paths: ["pulled.txt"], more: 0 },
  });
});

test("a preview names at most the first files of each kind, and counts the rest", async () => {
  const snapshot = (await checkpoints.snapshot(workspace))!;
  const names = Array.from({ length: PATHS_LISTED + 3 }, (_, index) => `added-${String(index).padStart(4, "0")}.txt`);
  await Promise.all(names.map((name) => write(name, "new\n")));

  const { deleted } = (await checkpoints.preview(workspace, snapshot))!.files;
  expect(deleted.paths).toEqual(names.slice(0, PATHS_LISTED));
  expect(deleted.more).toBe(3);
});

test("a file a commit since the snapshot changed and that was edited after it stays as it is, and is counted apart", async () => {
  const snapshot = (await checkpoints.snapshot(workspace))!;
  await write("kept.txt", "pulled\n");
  await git(projectDir, ["commit", "-qam", "a pull"]);
  await write("kept.txt", "pulled, then edited by the agent\n");

  expect(await checkpoints.restore(workspace, snapshot)).toEqual({ restored: 0, removed: 0, committed: { files: 1, editedSince: 1, commits: 1 } });

  expect(await read("kept.txt")).toBe("pulled, then edited by the agent\n");
});

test("a file a switch of branch checks out with core.autocrlf's line endings is not counted as edited since, and one the agent edited after is", async () => {
  await git(projectDir, ["config", "core.autocrlf", "true"]);
  await git(projectDir, ["checkout", "-qb", "other"]);
  await write("kept.txt", "on the other branch\n");
  await write("doomed.txt", "the other branch's own\n");
  await git(projectDir, ["commit", "-qam", "other"]);
  await git(projectDir, ["checkout", "-q", "main"]);
  const snapshot = (await checkpoints.snapshot(workspace))!;
  await git(projectDir, ["checkout", "-q", "other"]);
  await write("doomed.txt", "the other branch's own, then edited by the agent\n");

  expect(await read("kept.txt")).toBe("on the other branch\r\n");
  expect(await checkpoints.restore(workspace, snapshot)).toEqual({ restored: 0, removed: 0, committed: { files: 2, editedSince: 1, commits: 1 } });
});

test("a file a commit since the snapshot deleted and the agent made again is counted as edited since", async () => {
  const snapshot = (await checkpoints.snapshot(workspace))!;
  await git(projectDir, ["rm", "-q", "kept.txt"]);
  await git(projectDir, ["commit", "-qm", "a pull"]);
  await write("kept.txt", "made again by the agent\n");

  expect(await checkpoints.restore(workspace, snapshot)).toEqual({ restored: 0, removed: 0, committed: { files: 1, editedSince: 1, commits: 1 } });
  expect(await read("kept.txt")).toBe("made again by the agent\n");
});

test("after a switch to a branch that is not ahead of the snapshot's, the files that differ there stay as they are, with no count of commits", async () => {
  await checkOutTextWithLF();
  await git(projectDir, ["checkout", "-qb", "other"]);
  await write("kept.txt", "on the other branch\n");
  await git(projectDir, ["commit", "-qam", "other"]);
  await git(projectDir, ["checkout", "-q", "main"]);
  await write("doomed.txt", "main's own\n");
  await git(projectDir, ["commit", "-qam", "main"]);
  const snapshot = (await checkpoints.snapshot(workspace))!;
  await write("added.txt", "new, by the agent\n");
  await git(projectDir, ["checkout", "-q", "other"]);

  expect(await checkpoints.restore(workspace, snapshot)).toEqual({ restored: 0, removed: 1, committed: { files: 2, editedSince: 0, commits: null } });

  expect(await read("kept.txt")).toBe("on the other branch\n");
  expect(await read("doomed.txt")).toBe("doomed\n");
  await expect(read("added.txt")).rejects.toThrow();
});

test("a snapshot taken during a merge conflict knows its HEAD, so the merge committed since stays", async () => {
  await git(projectDir, ["checkout", "-qb", "theirs"]);
  await write("doomed.txt", "theirs\n");
  await git(projectDir, ["commit", "-qam", "theirs"]);
  await git(projectDir, ["checkout", "-q", "main"]);
  await write("doomed.txt", "ours\n");
  await git(projectDir, ["commit", "-qam", "ours"]);
  await git(projectDir, ["merge", "-q", "theirs"]);
  const snapshot = (await checkpoints.snapshot(workspace))!;
  await write("doomed.txt", "resolved\n");
  await git(projectDir, ["commit", "-qam", "the merge"]);

  expect(await checkpoints.restore(workspace, snapshot)).toEqual({ restored: 0, removed: 0, committed: { files: 1, editedSince: 0, commits: 2 } });

  expect(await read("doomed.txt")).toBe("resolved\n");
  expect(await status()).toBe("");
});

test("a snapshot from before it noted its HEAD puts back every file, commits since or not, as it did then", async () => {
  await git(projectDir, ["add", "-A"]);
  const tree = (await git(projectDir, ["write-tree"])).stdout;
  const snapshot = (await git(projectDir, ["commit-tree", tree, "-m", "mirador: the files at the start of a turn"])).stdout;
  await write("kept.txt", "pulled\n");
  await git(projectDir, ["commit", "-qam", "a pull"]);

  expect(await checkpoints.restore(workspace, snapshot)).toEqual({ restored: 1, removed: 0 });

  expect(await read("kept.txt")).toBe("one\n");
});

test("a restore that writes no file leaves the staging as it is", async () => {
  await write("kept.txt", "the user's change\n");
  const snapshot = (await checkpoints.snapshot(workspace))!;
  await git(projectDir, ["add", "kept.txt"]);

  expect(await checkpoints.restore(workspace, snapshot)).toEqual({ restored: 0, removed: 0 });
  expect(await stagedPaths()).toEqual(["kept.txt"]);
});

test("a snapshot taken during a merge conflict still works, and its restore unstages what the agent staged", async () => {
  await git(projectDir, ["checkout", "-qb", "theirs"]);
  await write("doomed.txt", "theirs\n");
  await git(projectDir, ["commit", "-qam", "theirs"]);
  await git(projectDir, ["checkout", "-q", "main"]);
  await write("doomed.txt", "ours\n");
  await git(projectDir, ["commit", "-qam", "ours"]);
  await git(projectDir, ["merge", "-q", "theirs"]);
  const conflictStatus = await status();
  const snapshot = await checkpoints.snapshot(workspace);
  expect(snapshot).toMatch(/^[0-9a-f]{40}$/);

  await write("kept.txt", "staged by the agent\n");
  await git(projectDir, ["add", "kept.txt"]);
  await checkpoints.restore(workspace, snapshot!);

  expect(await status()).toBe(conflictStatus);
});

test("a snapshot from before staging was kept, even one chained to an older one, unstages the files a restore puts back whose staged version differs", async () => {
  const snapshotOfTheFiles = async (parents: string[] = []) => {
    await git(projectDir, ["add", "-A"]);
    const tree = (await git(projectDir, ["write-tree"])).stdout;
    return (await git(projectDir, ["commit-tree", tree, ...parents.flatMap((parent) => ["-p", parent]), "-m", "mirador: the files at the start of a turn"])).stdout;
  };
  await write("kept.txt", "an older turn\n");
  const older = await snapshotOfTheFiles();
  await write("kept.txt", "staged by the user\n");
  const snapshot = await snapshotOfTheFiles([older]);

  await write("kept.txt", "staged by the agent\n");
  await git(projectDir, ["add", "kept.txt"]);
  await write("doomed.txt", "changed by the agent, not staged\n");
  await checkpoints.restore(workspace, snapshot);

  expect(await read("kept.txt")).toBe("staged by the user\n");
  expect(await stagedPaths()).toEqual([]);
});

test("in a folder below the repository's top, a restore puts back and deletes the folder's own files and leaves the rest of the repository as it is", async () => {
  await mkdir(join(projectDir, "sub"));
  await write("sub/inner.txt", "inner\n");
  await write("sub/notes.md", "the folder's notes\n");
  await git(projectDir, ["add", "-A"]);
  await git(projectDir, ["commit", "-qm", "sub"]);
  const folder = { ...workspace, path: join(projectDir, "sub") };
  const snapshot = (await checkpoints.snapshot(folder))!;

  await write("sub/inner.txt", "changed by the agent\n");
  await write("sub/added.txt", "new\n");
  await write("notes.md", "notes at the top\n");
  await write("kept.txt", "the user's own change\n");
  await git(projectDir, ["add", "-A"]);

  expect((await checkpoints.preview(folder, snapshot))?.plan).toEqual({ restored: 1, removed: 1 });
  expect(await checkpoints.restore(folder, snapshot)).toEqual({ restored: 1, removed: 1 });
  expect(await read("sub/inner.txt")).toBe("inner\n");
  await expect(read("sub/added.txt")).rejects.toThrow();
  expect(await read("sub/notes.md")).toBe("the folder's notes\n");
  expect(await read("notes.md")).toBe("notes at the top\n");
  expect(await read("kept.txt")).toBe("the user's own change\n");
  expect(await stagedPaths()).toEqual(["kept.txt", "notes.md"]);
});

test("ignored files are neither stored nor deleted by a restore", async () => {
  const snapshot = (await checkpoints.snapshot(workspace))!;
  await mkdir(join(projectDir, "build"));
  await write("build/output.txt", "output\n");

  expect(await checkpoints.restore(workspace, snapshot)).toEqual({ restored: 0, removed: 0 });
  expect(await read("build/output.txt")).toBe("output\n");
});

const snapshotRefs = async () => (await git(projectDir, ["for-each-ref", "--format=%(objectname)", "refs/mirador/"])).stdout.split("\n").filter(Boolean);

test("each snapshot stands on its own, and only the newest are kept", async () => {
  const keepingTwo = new Checkpoints(dataDir, 2);
  const first = (await keepingTwo.snapshot(workspace))!;
  await write("kept.txt", "second\n");
  const second = (await keepingTwo.snapshot(workspace))!;
  await write("kept.txt", "third\n");
  const third = (await keepingTwo.snapshot(workspace))!;

  expect((await git(projectDir, ["rev-list", second])).stdout).not.toContain(first);
  expect((await snapshotRefs()).sort()).toEqual([second, third].sort());
  await git(projectDir, ["gc", "--quiet", "--prune=now"]);
  expect(await keepingTwo.keeps(workspace, first)).toBe(false);
  expect(await keepingTwo.keeps(workspace, second)).toBe(true);
});

test("the chain snapshots made before each had a ref is kept as one, and goes when it is the oldest", async () => {
  const tree = (await git(projectDir, ["write-tree"])).stdout;
  const older = (await git(projectDir, ["commit-tree", tree, "-m", "older"])).stdout;
  const chained = (await git(projectDir, ["commit-tree", tree, "-p", older, "-m", "newer"])).stdout;
  await git(projectDir, ["update-ref", "refs/mirador/ws-1", chained]);
  const keepingTwo = new Checkpoints(dataDir, 2);

  const first = (await keepingTwo.snapshot(workspace))!;
  expect((await snapshotRefs()).sort()).toEqual([chained, first].sort());
  expect(await keepingTwo.keeps(workspace, older)).toBe(true);

  await write("kept.txt", "second\n");
  const second = (await keepingTwo.snapshot(workspace))!;
  expect((await snapshotRefs()).sort()).toEqual([first, second].sort());
});

test("a submodule that moved is left as it is, and counted apart from the files", async () => {
  const library = join(dataDir, "library");
  await mkdir(library);
  await git(library, ["init", "-q"]);
  await writeFile(join(library, "lib.txt"), "v1\n");
  await git(library, ["add", "-A"]);
  await git(library, ["commit", "-qm", "v1"]);
  await git(projectDir, ["-c", "protocol.file.allow=always", "submodule", "add", "-q", library, "library"]);
  await git(projectDir, ["commit", "-qam", "with the library"]);
  const snapshot = (await checkpoints.snapshot(workspace))!;

  await writeFile(join(projectDir, "library", "lib.txt"), "v2\n");
  await git(join(projectDir, "library"), ["commit", "-qam", "v2"]);
  await write("kept.txt", "changed\n");

  expect((await checkpoints.preview(workspace, snapshot))?.plan).toEqual({ restored: 1, removed: 0, submodulesLeft: 1 });
  expect(await checkpoints.restore(workspace, snapshot)).toEqual({ restored: 1, removed: 0, submodulesLeft: 1 });
  expect(await read("kept.txt")).toBe("one\n");
  expect(await readFile(join(projectDir, "library", "lib.txt"), "utf8")).toBe("v2\n");
});

test("a nested git repository with no commit yet is left out of the snapshot, and the rest is kept", async () => {
  const nested = join(projectDir, "nested");
  await mkdir(nested);
  await git(nested, ["init", "-q"]);
  await write(join("nested", "x.txt"), "nested\n");
  const snapshot = (await checkpoints.snapshot(workspace))!;

  await write("kept.txt", "changed\n");
  expect(await checkpoints.restore(workspace, snapshot)).toEqual({ restored: 1, removed: 0 });
  expect(await read("kept.txt")).toBe("one\n");
  expect(await read(join("nested", "x.txt"))).toBe("nested\n");
});

test("a nested git repository the agent commits into after the snapshot is left as it is", async () => {
  const nested = join(projectDir, "nested");
  await mkdir(nested);
  await git(nested, ["init", "-q"]);
  await write(join("nested", "x.txt"), "nested\n");
  const snapshot = (await checkpoints.snapshot(workspace))!;

  await git(nested, ["add", "-A"]);
  await git(nested, ["commit", "-qm", "the agent's first commit"]);
  await write("kept.txt", "changed\n");

  expect((await checkpoints.preview(workspace, snapshot))?.plan).toEqual({ restored: 1, removed: 0, submodulesLeft: 1 });
  expect(await checkpoints.restore(workspace, snapshot)).toEqual({ restored: 1, removed: 0, submodulesLeft: 1 });
  expect(await read("kept.txt")).toBe("one\n");
  expect(await read(join("nested", "x.txt"))).toBe("nested\n");
  expect((await git(nested, ["log", "--format=%s"])).stdout).toBe("the agent's first commit");
});

test("a workspace that is not a git repository has no snapshots to restore", async () => {
  const plain = join(dataDir, "plain");
  await mkdir(plain);
  const elsewhere = { ...workspace, id: "ws-2", path: plain };

  expect(await checkpoints.snapshot(elsewhere)).toBeNull();
  expect(await checkpoints.preview(elsewhere, "0".repeat(40))).toBeNull();
});

test("in a repository with no commit yet, a restore puts back the files and what the user had staged", async () => {
  const fresh = join(dataDir, "fresh");
  await mkdir(fresh);
  await git(fresh, ["init", "-q"]);
  await writeFile(join(fresh, "staged.txt"), "staged by the user\n");
  await git(fresh, ["add", "staged.txt"]);
  const unborn = { ...workspace, id: "ws-3", path: fresh };
  const snapshot = (await checkpoints.snapshot(unborn))!;

  await writeFile(join(fresh, "staged.txt"), "staged by the agent\n");
  await writeFile(join(fresh, "added.txt"), "new, staged by the agent\n");
  await git(fresh, ["add", "-A"]);
  expect(await checkpoints.restore(unborn, snapshot)).toEqual({ restored: 1, removed: 1 });

  expect(await readFile(join(fresh, "staged.txt"), "utf8")).toBe("staged by the user\n");
  expect((await git(fresh, ["diff", "--cached", "--name-only"])).stdout).toBe("staged.txt");
  expect((await git(fresh, ["show", ":staged.txt"])).stdout).toBe("staged by the user");
});

test("in a repository with no commit yet at the snapshot, the files its first commit holds stay as committed", async () => {
  const fresh = join(dataDir, "fresh");
  await mkdir(fresh);
  await git(fresh, ["init", "-q"]);
  await writeFile(join(fresh, "first.txt"), "before the first commit\n");
  const unborn = { ...workspace, id: "ws-3", path: fresh };
  const snapshot = (await checkpoints.snapshot(unborn))!;
  await writeFile(join(fresh, "first.txt"), "the first commit\n");
  await git(fresh, ["add", "first.txt"]);
  await git(fresh, ["commit", "-qm", "first"]);
  await writeFile(join(fresh, "added.txt"), "new, by the agent\n");

  expect(await checkpoints.restore(unborn, snapshot)).toEqual({ restored: 0, removed: 1, committed: { files: 1, editedSince: 0, commits: 1 } });

  expect(await readFile(join(fresh, "first.txt"), "utf8")).toBe("the first commit\n");
  expect((await git(fresh, ["status", "--porcelain"])).stdout).toBe("");
});

const onWindows = process.platform === "win32";
const ourIndex = () => join(dataDir, "checkpoints", "ws-1.index");

async function inOurIndex(args: string[]) {
  const child = Bun.spawn(["git", "-C", projectDir, "-c", "core.autocrlf=false", ...args], { env: { ...process.env, GIT_INDEX_FILE: ourIndex() }, stdout: "pipe", stderr: "ignore" });
  const [stdout, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  expect(exitCode).toBe(0);
  return stdout;
}
const outOfDateInOurIndex = async () => (await inOurIndex(["diff-files", "--name-only"])).split("\n").filter(Boolean);
const stageAsTheEarlierCodeDid = async () => {
  await mkdir(join(dataDir, "checkpoints"), { recursive: true });
  await inOurIndex(["add", "-A"]);
};
const lineEndingConversions = [
  { name: "* text=auto stores CRLF as LF", attributes: "* text=auto\n", content: "crlf\r\nline\r\n" },
  { name: "* text eol=crlf writes LF as CRLF", attributes: "* text eol=crlf\n", content: "lf\nline\n" },
  { name: "core.eol=crlf with * text=auto writes LF as CRLF", attributes: "* text=auto\n", eol: "crlf", content: "lf\n" },
  { name: "* ident collapses $Id$", attributes: "* ident\n", content: "$Id: kept as it was $\n" },
];

for (const { name, attributes, eol, content } of lineEndingConversions) {
  test(`a restore gives a file back byte for byte where ${name}`, async () => {
    if (eol) await git(projectDir, ["config", "core.eol", eol]);
    await write(".gitattributes", attributes);
    await write("converted.txt", content);
    const snapshot = (await checkpoints.snapshot(workspace))!;

    await write("converted.txt", "changed by the agent\n");
    await checkpoints.restore(workspace, snapshot);

    expect(await read("converted.txt")).toBe(content);
  });
}

async function shoutingFilter() {
  await git(projectDir, ["config", "filter.shout.clean", "tr a-z A-Z"]);
  await git(projectDir, ["config", "filter.shout.smudge", "tr A-Z a-z"]);
}

/** For files that come back as git checks them out, whose line endings would otherwise follow this machine's defaults. */
async function checkOutTextWithLF() {
  await git(projectDir, ["config", "core.autocrlf", "false"]);
  await git(projectDir, ["config", "core.eol", "lf"]);
}
const storedInRepository = async (blob: string) => (await git(projectDir, ["cat-file", "-e", blob])).exitCode === 0;

test("a file a filter cleans is kept as the filter cleans it, never as its own bytes, and comes back through the filter", async () => {
  await shoutingFilter();
  await write(".gitattributes", "*.big filter=shout\n");
  await write("asset.big", "whisper\n");
  const ownBytes = (await git(projectDir, ["hash-object", "--no-filters", "asset.big"])).stdout;
  const snapshot = (await checkpoints.snapshot(workspace))!;

  await write("asset.big", "changed by the agent\n");
  await checkpoints.restore(workspace, snapshot);

  expect(await read("asset.big")).toBe("whisper\n");
  expect((await git(projectDir, ["cat-file", "blob", `${snapshot}:asset.big`])).stdout).toBe("WHISPER");
  expect(await storedInRepository(ownBytes)).toBe(false);
});

test("a file kept as its own bytes comes back as them even when the turn puts a filter on it", async () => {
  await shoutingFilter();
  await write("asset.big", "Whisper\n");
  const snapshot = (await checkpoints.snapshot(workspace))!;

  await write(".gitattributes", "*.big filter=shout\n");
  await write("asset.big", "changed by the agent\n");
  await checkpoints.restore(workspace, snapshot);

  expect(await read("asset.big")).toBe("Whisper\n");
});

async function makeOld(relative: string) {
  const longAgo = new Date("2020-01-01T00:00:00Z");
  await utimes(join(projectDir, relative), longAgo, longAgo);
  const { ino, mtimeMs } = await stat(join(projectDir, relative));
  return { ino, mtimeMs };
}
const inodeAndTime = async (relative: string) => {
  const { ino, mtimeMs } = await stat(join(projectDir, relative));
  return { ino, mtimeMs };
};

test("a restore leaves the files the turn did not change as they are, even ones git would convert", async () => {
  await write(".gitattributes", "* text=auto\n");
  await write("untouched.txt", "crlf\r\n");
  const untouched = await makeOld("untouched.txt");
  const snapshot = (await checkpoints.snapshot(workspace))!;

  await write("kept.txt", "changed by the agent\n");
  await checkpoints.restore(workspace, snapshot);

  expect(await read("kept.txt")).toBe("one\n");
  expect(await inodeAndTime("untouched.txt")).toEqual(untouched);
});

test("where core.safecrlf=true refuses to store a file with other line endings, a turn still gets its undo, and the file comes back as it was", async () => {
  await git(projectDir, ["config", "core.safecrlf", "true"]);
  await write(".gitattributes", "* text=auto\n");
  await write("windows.txt", "crlf\r\n");
  const snapshot = (await checkpoints.snapshot(workspace))!;

  await write("windows.txt", "changed by the agent\n");
  expect(await checkpoints.restore(workspace, snapshot)).toEqual({ restored: 1, removed: 0 });

  expect(await read("windows.txt")).toBe("crlf\r\n");
});

/** A snapshot as Mirador took them before it kept files as their own bytes: git add's tree, conversions applied. */
async function snapshotFromBeforeOwnBytes() {
  await git(projectDir, ["add", "-A"]);
  const tree = (await git(projectDir, ["write-tree"])).stdout;
  const snapshot = (await git(projectDir, ["commit-tree", tree, "-m", "mirador: the files at the start of a turn"])).stdout;
  await git(projectDir, ["reset", "-q"]);
  return snapshot;
}

test("a snapshot from before files were kept as their own bytes puts back only the files the turn changed", async () => {
  await checkOutTextWithLF();
  await write(".gitattributes", "* text=auto\n");
  await write("untouched.txt", "crlf\r\n");
  const snapshot = await snapshotFromBeforeOwnBytes();
  const untouched = await makeOld("untouched.txt");

  await write("kept.txt", "changed by the agent\n");
  await write("added.txt", "new\n");
  expect(await checkpoints.restore(workspace, snapshot)).toEqual({ restored: 1, removed: 1 });

  expect(await read("kept.txt")).toBe("one\n");
  await expect(read("added.txt")).rejects.toThrow();
  expect(await inodeAndTime("untouched.txt")).toEqual(untouched);
});

test("in a folder below the repository's top, a snapshot from before files were kept as their own bytes puts back only the folder's changed files", async () => {
  await checkOutTextWithLF();
  await write(".gitattributes", "* text=auto\n");
  await mkdir(join(projectDir, "sub"));
  await write("sub/inner.txt", "inner\n");
  await write("sub/untouched.txt", "crlf\r\n");
  const snapshot = await snapshotFromBeforeOwnBytes();
  const untouched = await makeOld("sub/untouched.txt");
  const folder = { ...workspace, path: join(projectDir, "sub") };

  await write("sub/inner.txt", "changed by the agent\n");
  await write("sub/added.txt", "new\n");
  expect(await checkpoints.restore(folder, snapshot)).toEqual({ restored: 1, removed: 1 });

  expect(await read("sub/inner.txt")).toBe("inner\n");
  await expect(read("sub/added.txt")).rejects.toThrow();
  expect(await inodeAndTime("sub/untouched.txt")).toEqual(untouched);
});

test("files the earlier code staged into our index with git's conversion still come back as their own bytes", async () => {
  await write(".gitattributes", "* text=auto\n");
  await write("windows.txt", "crlf\r\n");
  await stageAsTheEarlierCodeDid();
  const snapshot = (await checkpoints.snapshot(workspace))!;

  await write("windows.txt", "changed by the agent\n");
  await checkpoints.restore(workspace, snapshot);

  expect(await read("windows.txt")).toBe("crlf\r\n");
});

test("files the earlier code staged into our index after a snapshot of ours still come back as their own bytes", async () => {
  await write(".gitattributes", "* text=auto\n");
  await write("windows.txt", "crlf\r\n");
  await checkpoints.snapshot(workspace);
  await write("windows.txt", "crlf\n");
  await stageAsTheEarlierCodeDid();
  const snapshot = (await checkpoints.snapshot(workspace))!;

  await write("windows.txt", "changed by the agent\n");
  await checkpoints.restore(workspace, snapshot);

  expect(await read("windows.txt")).toBe("crlf\n");
});

test("a file created after a snapshot is kept as its own bytes by the next one", async () => {
  await write(".gitattributes", "* text=auto\n");
  await write("windows.txt", "crlf\r\n");
  await checkpoints.snapshot(workspace);
  await write("created.txt", "created\r\n");
  const snapshot = (await checkpoints.snapshot(workspace))!;

  await write("created.txt", "changed by the agent\n");
  await checkpoints.restore(workspace, snapshot);

  expect(await read("created.txt")).toBe("created\r\n");
});

test("a file's own bytes stay in the snapshots taken after one that found them, while other files change", async () => {
  await write(".gitattributes", "* text=auto\n");
  await write("windows.txt", "crlf\r\n");
  await write("other.txt", "other\r\n");
  await checkpoints.snapshot(workspace);
  await write("other.txt", "other, edited\r\n");
  await checkpoints.snapshot(workspace);
  await write("kept.txt", "edited too\n");
  const snapshot = (await checkpoints.snapshot(workspace))!;

  await write("windows.txt", "changed by the agent\n");
  await checkpoints.restore(workspace, snapshot);

  expect(await read("windows.txt")).toBe("crlf\r\n");
});

test("an edit that changes only a file's line endings is kept by the next snapshot", async () => {
  await write(".gitattributes", "* text=auto\n");
  await write("notes.txt", "lf\n");
  await checkpoints.snapshot(workspace);
  await write("notes.txt", "lf\r\n");
  const snapshot = (await checkpoints.snapshot(workspace))!;

  await write("notes.txt", "changed by the agent\n");
  await checkpoints.restore(workspace, snapshot);

  expect(await read("notes.txt")).toBe("lf\r\n");
});

test.skipIf(onWindows)("a snapshot of files nothing changed since the last one runs no filter again, and leaves our index up to date", async () => {
  await git(projectDir, ["config", "filter.count.clean", "echo run >> ../clean-runs; cat"]);
  await write(".gitattributes", "* text=auto\n*.counted filter=count\n");
  await write("a.counted", "counted\r\n");
  await write("windows.txt", "crlf\r\n");
  await Promise.all([".gitattributes", "a.counted", "windows.txt"].map(makeOld));
  const runs = async () => (await readFile(join(dataDir, "clean-runs"), "utf8")).split("\n").filter(Boolean).length;
  await checkpoints.snapshot(workspace);
  const runsOfTheFirst = await runs();
  expect(await outOfDateInOurIndex()).toEqual([]);

  await checkpoints.snapshot(workspace);
  await checkpoints.changesSince(workspace, (await checkpoints.snapshot(workspace))!);

  expect(await runs()).toBe(runsOfTheFirst);
  expect(await outOfDateInOurIndex()).toEqual([]);
});

test.skipIf(onWindows)("files named with a tab, a newline, a carriage return or a leading double quote each get their own bytes back", async () => {
  await write(".gitattributes", "* text=auto\n");
  const names = ["tab\there.txt", "new\nline.txt", "carriage\r", "carriage\r.txt", '"a"', "a"];
  await Promise.all(names.map((name) => write(name, `${JSON.stringify(name)}\r\n`)));
  const snapshot = (await checkpoints.snapshot(workspace))!;

  await Promise.all(names.map((name) => write(name, "changed by the agent\n")));
  expect(await checkpoints.restore(workspace, snapshot)).toEqual({ restored: names.length, removed: 0 });

  expect(await Promise.all(names.map(read))).toEqual(names.map((name) => `${JSON.stringify(name)}\r\n`));
});

test("a file the turn turned into a folder holding an ignored file is a file again", async () => {
  await write("out", "a file\n");
  const snapshot = (await checkpoints.snapshot(workspace))!;

  await rm(join(projectDir, "out"));
  await mkdir(join(projectDir, "out"));
  await write("out/build", "ignored\n");
  await checkpoints.restore(workspace, snapshot);

  expect(await read("out")).toBe("a file\n");
});

test("a restore that cannot read a file of the snapshot fails before it deletes or writes any file", async () => {
  await write("fresh.txt", "fresh\n");
  const snapshot = (await checkpoints.snapshot(workspace))!;
  const blob = (await git(projectDir, ["rev-parse", `${snapshot}:fresh.txt`])).stdout;
  await rm(join(projectDir, ".git", "objects", blob.slice(0, 2), blob.slice(2)));

  await write("fresh.txt", "changed by the agent\n");
  await write("kept.txt", "changed by the agent\n");
  await write("added.txt", "new\n");
  await expect(checkpoints.restore(workspace, snapshot)).rejects.toThrow();

  expect(await read("added.txt")).toBe("new\n");
  expect(await read("kept.txt")).toBe("changed by the agent\n");
});

test.skipIf(onWindows)("files come back with the permissions git gives a file it writes, under the user's umask", async () => {
  const previous = process.umask(0o077);
  try {
    await write("secret.env", "KEY=1\n");
    await write("run.sh", "#!/bin/sh\n");
    await chmod(join(projectDir, "run.sh"), 0o755);
    const snapshot = (await checkpoints.snapshot(workspace))!;

    await rm(join(projectDir, "secret.env"));
    await rm(join(projectDir, "run.sh"));
    await checkpoints.restore(workspace, snapshot);

    expect((await stat(join(projectDir, "secret.env"))).mode & 0o777).toBe(0o600);
    expect((await stat(join(projectDir, "run.sh"))).mode & 0o777).toBe(0o700);
  } finally {
    process.umask(previous);
  }
});

test.skipIf(onWindows)("a link the turn replaced comes back as the link it was", async () => {
  await symlink("kept.txt", join(projectDir, "link"));
  const snapshot = (await checkpoints.snapshot(workspace))!;

  await rm(join(projectDir, "link"));
  await write("link", "a file now\n");
  await checkpoints.restore(workspace, snapshot);

  expect(await readlink(join(projectDir, "link"))).toBe("kept.txt");
});

test.skipIf(onWindows)("a folder the turn replaced with an ignored link to elsewhere is a folder again, and elsewhere is left as it was", async () => {
  const elsewhere = join(dataDir, "elsewhere");
  await mkdir(elsewhere);
  await mkdir(join(projectDir, "linked"));
  await write("linked/file.txt", "inside\n");
  const snapshot = (await checkpoints.snapshot(workspace))!;

  await rm(join(projectDir, "linked"), { recursive: true });
  await symlink(elsewhere, join(projectDir, "linked"));
  await appendFile(join(projectDir, ".git", "info", "exclude"), "linked\n");
  await checkpoints.restore(workspace, snapshot);

  expect((await lstat(join(projectDir, "linked"))).isDirectory()).toBe(true);
  expect(await read("linked/file.txt")).toBe("inside\n");
  expect(await readdir(elsewhere)).toEqual([]);
});

test.skipIf(onWindows)("a file the turn replaced with a link to a folder elsewhere is a file again, and the folder keeps its files", async () => {
  const elsewhere = join(dataDir, "elsewhere");
  await mkdir(elsewhere);
  await writeFile(join(elsewhere, "theirs.txt"), "theirs\n");
  await write("out", "a file\n");
  const snapshot = (await checkpoints.snapshot(workspace))!;

  await rm(join(projectDir, "out"));
  await symlink(elsewhere, join(projectDir, "out"));
  await checkpoints.restore(workspace, snapshot);

  expect(await read("out")).toBe("a file\n");
  expect(await readdir(elsewhere)).toEqual(["theirs.txt"]);
});

test("a state of the files' own bytes that cannot be read is built again from the files", async () => {
  await write(".gitattributes", "* text=auto\n");
  await write("windows.txt", "crlf\r\n");
  await checkpoints.snapshot(workspace);
  await writeFile(join(dataDir, "checkpoints", "ws-1.own-bytes.json"), "{ not json");
  const snapshot = (await checkpoints.snapshot(workspace))!;

  await write("windows.txt", "changed by the agent\n");
  await checkpoints.restore(workspace, snapshot);

  expect(await read("windows.txt")).toBe("crlf\r\n");
});

test("in a folder below the repository's top, files come back byte for byte, and through their filter where one cleans them", async () => {
  await shoutingFilter();
  await checkOutTextWithLF();
  await write(".gitattributes", "* text=auto\n*.big filter=shout\n");
  await mkdir(join(projectDir, "sub"));
  await write("sub/windows.txt", "crlf\r\n");
  await write("sub/asset.big", "whisper\r\n");
  const folder = { ...workspace, path: join(projectDir, "sub") };
  const snapshot = (await checkpoints.snapshot(folder))!;

  await write("sub/windows.txt", "changed by the agent\n");
  await write("sub/asset.big", "changed by the agent\n");
  expect(await checkpoints.restore(folder, snapshot)).toEqual({ restored: 2, removed: 0 });

  expect(await read("sub/windows.txt")).toBe("crlf\r\n");
  expect(await read("sub/asset.big")).toBe("whisper\n");
});

test("after a restart, a restore still gives files back as their own bytes and puts back what the user had staged", async () => {
  await checkOutTextWithLF();
  await write(".gitattributes", "* text=auto\n");
  await write("windows.txt", "crlf\r\n");
  await write("kept.txt", "staged by the user\n");
  await git(projectDir, ["add", "kept.txt"]);
  const snapshot = (await checkpoints.snapshot(workspace))!;

  await write("windows.txt", "changed by the agent\n");
  await write("kept.txt", "staged by the agent\n");
  await git(projectDir, ["add", "kept.txt"]);
  await new Checkpoints(dataDir).restore(workspace, snapshot);

  expect(await read("windows.txt")).toBe("crlf\r\n");
  expect(await stagedPaths()).toEqual(["kept.txt"]);
  expect(await stagedVersionOf("kept.txt")).toBe("staged by the user");
});

async function gitProcessesStartedBy(work: () => Promise<unknown>) {
  const spawn = Bun.spawn;
  let started = 0;
  (Bun as unknown as { spawn: unknown }).spawn = (command: string[], options: unknown) => {
    if (command[0] === "git") started++;
    return spawn(command as never, options as never);
  };
  try {
    await work();
  } finally {
    (Bun as unknown as { spawn: unknown }).spawn = spawn;
  }
  return started;
}

test("a turn's snapshots, list of changes, preview and restore start no more git processes than they need, at about 30 ms each on Windows", async () => {
  const started: Record<string, number> = {};
  const count = async (step: string, work: () => Promise<unknown>) => (started[step] = await gitProcessesStartedBy(work));
  let first = "";
  let second = "";
  await count("first snapshot", async () => (first = (await checkpoints.snapshot(workspace))!));
  await write("kept.txt", "changed\n");
  await count("snapshot after an edit", async () => (second = (await checkpoints.snapshot(workspace))!));
  await count("changes since it", () => checkpoints.changesSince(workspace, second));
  await write("kept.txt", "changed again\n");
  await count("preview", () => checkpoints.preview(workspace, first));
  await count("restore", () => checkpoints.restore(workspace, first));
  await count("snapshot after the restore", () => checkpoints.snapshot(workspace));
  await count("snapshot of no change", () => checkpoints.snapshot(workspace));

  expect(started).toEqual({
    "first snapshot": 12,
    "snapshot after an edit": 12,
    "changes since it": 7,
    preview: 8,
    restore: 8,
    "snapshot after the restore": 12,
    "snapshot of no change": 10,
  });
}, 15_000);
