import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Workspace } from "../shared/model.ts";
import { Worktrees, workingCopyOf } from "../host/worktrees.ts";

let dataDir: string;
let projectDir: string;
let worktrees: Worktrees;

async function git(directory: string, args: string[]) {
  const child = Bun.spawn(["git", "-C", directory, "-c", "user.name=t", "-c", "user.email=t@t", ...args], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [stdout, , exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { stdout: stdout.trim(), exitCode };
}

const workspaceAt = (path: string): Workspace => ({
  id: "0a1b2c3d-ws",
  name: "my project",
  path,
  defaultLaunch: { harness: "claude", profileId: null },
  color: null,
  position: 0,
  groupId: null,
  newConversationsIn: "worktree",
  worktreeSetup: "",
  createdAt: 0,
});

const branches = async () => (await git(projectDir, ["branch", "--format=%(refname:short)"])).stdout.split("\n");

beforeEach(async () => {
  dataDir = await realpath(await mkdtemp(join(tmpdir(), "mirador-worktrees-")));
  projectDir = join(dataDir, "project");
  await mkdir(join(projectDir, "packages", "app"), { recursive: true });
  await git(projectDir, ["-c", "init.defaultBranch=main", "init", "-q"]);
  // Git for Windows defaults to converting LF to CRLF on checkout, which the worktree's files are read against.
  await git(projectDir, ["config", "core.autocrlf", "false"]);
  await writeFile(join(projectDir, ".gitignore"), "node_modules\n");
  await writeFile(join(projectDir, "kept.txt"), "one\n");
  await writeFile(join(projectDir, "packages", "app", "index.ts"), "export {};\n");
  await git(projectDir, ["add", "-A"]);
  await git(projectDir, ["commit", "-qm", "base"]);
  worktrees = new Worktrees(dataDir);
});

afterEach(() => rm(dataDir, { recursive: true, force: true }));

test("a worktree is planned in Mirador's data folder, under the workspace's name, on a branch of its own", async () => {
  const worktree = await worktrees.plan(workspaceAt(projectDir));

  const shortId = worktree.id.slice(0, 8);
  expect(worktree.root).toBe(join(dataDir, "worktrees", "my-project-0a1b2c3d", shortId));
  expect(worktree.folder).toBe(worktree.root);
  expect(worktree.branch).toBe(`mirador/${shortId}`);
  expect(await worktrees.isMade(worktree)).toBe(false);
});

test("a workspace that is a folder inside its repository works in that folder of the worktree", async () => {
  const workspace = workspaceAt(join(projectDir, "packages", "app"));
  const worktree = await worktrees.plan(workspace);
  await worktrees.make(workspace, worktree);

  expect(worktree.folder).toBe(join(worktree.root, "packages", "app"));
  expect(await readFile(join(worktree.folder, "index.ts"), "utf8")).toBe("export {};\n");
  expect(workingCopyOf(workspace, { worktree })).toMatchObject({ id: worktree.id, path: worktree.folder, name: "my project" });
  expect(workingCopyOf(workspace, {})).toBe(workspace);
});

test("a workspace folder inside a repository with no tracked files is created and recognized as made", async () => {
  const emptySubdir = join(projectDir, "empty-subdir");
  await mkdir(emptySubdir);
  const workspace = workspaceAt(emptySubdir);
  const worktree = await worktrees.plan(workspace);
  expect(await worktrees.isMade(worktree)).toBe(false);
  await worktrees.make(workspace, worktree);
  expect(await worktrees.isMade(worktree)).toBe(true);
  expect(existsSync(worktree.folder)).toBe(true);
});

test("a folder that is no git repository, or one without a commit, gets no worktree", async () => {
  const plainDir = join(dataDir, "plain");
  const emptyRepository = join(dataDir, "empty");
  await mkdir(plainDir);
  await mkdir(emptyRepository);
  await git(emptyRepository, ["init", "-q"]);

  await expect(worktrees.plan(workspaceAt(plainDir))).rejects.toMatchObject({ problem: { code: "worktree-needs-repository", directory: plainDir } });
  await expect(worktrees.plan(workspaceAt(emptyRepository))).rejects.toMatchObject({ problem: { code: "worktree-needs-repository", directory: emptyRepository } });
});

test("a made worktree holds what is committed, on its new branch, and leaves the project folder on its own", async () => {
  await writeFile(join(projectDir, "kept.txt"), "edited, not committed\n");
  const workspace = workspaceAt(projectDir);
  const worktree = await worktrees.plan(workspace);

  await worktrees.make(workspace, worktree);

  expect(await worktrees.isMade(worktree)).toBe(true);
  expect(await readFile(join(worktree.folder, "kept.txt"), "utf8")).toBe("one\n");
  expect((await git(worktree.root, ["symbolic-ref", "--short", "HEAD"])).stdout).toBe(worktree.branch);
  expect((await git(projectDir, ["symbolic-ref", "--short", "HEAD"])).stdout).toBe("main");
  expect(await readFile(join(projectDir, "kept.txt"), "utf8")).toBe("edited, not committed\n");
});

test("uncommitted files are counted: changed and new ones, not ignored ones", async () => {
  const workspace = workspaceAt(projectDir);
  const worktree = await worktrees.plan(workspace);
  expect(await worktrees.uncommittedFiles(worktree)).toBe(0);
  await worktrees.make(workspace, worktree);
  expect(await worktrees.uncommittedFiles(worktree)).toBe(0);

  await writeFile(join(worktree.root, "kept.txt"), "changed\n");
  await mkdir(join(worktree.root, "notes"));
  await writeFile(join(worktree.root, "notes", "a.md"), "a\n");
  await writeFile(join(worktree.root, "notes", "b.md"), "b\n");
  await mkdir(join(worktree.root, "node_modules"));
  await writeFile(join(worktree.root, "node_modules", "ignored.js"), "\n");

  expect(await worktrees.uncommittedFiles(worktree)).toBe(3);
});

test("removing a worktree deletes its folder with uncommitted files, and its branch when that holds no commits of its own", async () => {
  const workspace = workspaceAt(projectDir);
  const worktree = await worktrees.plan(workspace);
  await worktrees.make(workspace, worktree);
  await writeFile(join(worktree.root, "scratch.txt"), "never committed\n");

  await worktrees.remove(workspace, worktree);

  expect(existsSync(worktree.root)).toBe(false);
  expect(await branches()).toEqual(["main"]);
  expect((await git(projectDir, ["worktree", "list", "--porcelain"])).stdout).not.toContain(worktree.root);
});

test("a removed worktree's branch stays when it holds commits the workspace's branch lacks", async () => {
  const workspace = workspaceAt(projectDir);
  const worktree = await worktrees.plan(workspace);
  await worktrees.make(workspace, worktree);
  await writeFile(join(worktree.root, "feature.txt"), "work\n");
  await git(worktree.root, ["add", "-A"]);
  await git(worktree.root, ["commit", "-qm", "feature"]);

  await worktrees.remove(workspace, worktree);

  expect(existsSync(worktree.root)).toBe(false);
  expect(await branches()).toEqual(["main", worktree.branch]);
  expect((await git(projectDir, ["log", "-1", "--format=%s", worktree.branch])).stdout).toBe("feature");
});

test("a worktree a kill left half-made is not made until it is made again from scratch", async () => {
  const workspace = workspaceAt(projectDir);
  const worktree = await worktrees.plan(workspace);
  await mkdir(worktree.root, { recursive: true });
  expect(await worktrees.isMade(worktree)).toBe(false);

  await worktrees.make(workspace, worktree);

  expect(await worktrees.isMade(worktree)).toBe(true);
  expect(await readFile(join(worktree.folder, "kept.txt"), "utf8")).toBe("one\n");
});

test("a worktree whose folder was deleted by hand is made again on the branch it had, with its commits", async () => {
  const workspace = workspaceAt(projectDir);
  const worktree = await worktrees.plan(workspace);
  await worktrees.make(workspace, worktree);
  await writeFile(join(worktree.root, "feature.txt"), "work\n");
  await git(worktree.root, ["add", "-A"]);
  await git(worktree.root, ["commit", "-qm", "feature"]);
  await rm(worktree.root, { recursive: true, force: true });
  expect(await worktrees.isMade(worktree)).toBe(false);

  await worktrees.make(workspace, worktree);

  expect(await readFile(join(worktree.root, "feature.txt"), "utf8")).toBe("work\n");
  expect((await git(worktree.root, ["symbolic-ref", "--short", "HEAD"])).stdout).toBe(worktree.branch);
});
