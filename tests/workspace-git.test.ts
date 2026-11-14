import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { watchWorkspaceGit, workspaceChangedSince, workspaceFileAt, workspaceGitRefs, WorkspaceGitRefused } from "../host/apps/workspace-git.ts";

const folders: string[] = [];
afterAll(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

const newFolder = (prefix = "workspace-git-") => {
  const folder = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  folders.push(folder);
  return folder;
};

let clock = 1_700_000_000;

/** Runs git in a folder as a fixed author, signing nothing, one second after the last call, so tags sort by when they were made. */
function git(folder: string, ...args: string[]) {
  clock += 1000;
  const date = new Date(clock * 1000).toISOString();
  const run = Bun.spawnSync(["git", "-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false", "-C", folder, ...args], {
    env: { ...process.env, GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
  });
  if (run.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${run.stderr.toString()}`);
  return run.stdout.toString().trim();
}

/** Its files check out with the line ends they were written with: the host's git reads the Windows runner's system config, which sets core.autocrlf. */
function repository() {
  const folder = newFolder();
  git(folder, "init", "-q", "-b", "main");
  git(folder, "config", "core.autocrlf", "false");
  return folder;
}

function write(folder: string, path: string, content: string) {
  mkdirSync(join(folder, path, ".."), { recursive: true });
  writeFileSync(join(folder, path), content);
}

function commit(folder: string, files: Record<string, string>, message = "commit") {
  for (const [path, content] of Object.entries(files)) write(folder, path, content);
  git(folder, "add", "-A");
  git(folder, "commit", "-q", "-m", message);
  return git(folder, "rev-parse", "HEAD");
}

const text = (bytes: ArrayBuffer | null) => (bytes === null ? null : new TextDecoder().decode(bytes));

async function refusalOf(attempt: Promise<unknown>) {
  try {
    await attempt;
  } catch (error) {
    expect(error).toBeInstanceOf(WorkspaceGitRefused);
    return (error as WorkspaceGitRefused).status;
  }
  throw new Error("Wasn't refused.");
}

describe("workspaceGitRefs", () => {
  test("is null outside a git repository", async () => {
    expect(await workspaceGitRefs(newFolder())).toBeNull();
  });

  test("has no head and no tags in a repository with no commits", async () => {
    expect(await workspaceGitRefs(repository())).toEqual({ head: null, tags: [] });
  });

  test("names HEAD's commit and the tags newest first, peeling an annotated tag to its commit", async () => {
    const folder = repository();
    const first = commit(folder, { "a.txt": "1" });
    git(folder, "tag", "v1");
    const second = commit(folder, { "a.txt": "2" });
    git(folder, "tag", "-a", "v2", "-m", "second");
    const third = commit(folder, { "a.txt": "3" });
    git(folder, "tag", "v3");
    const refs = await workspaceGitRefs(folder);
    expect(refs?.head).toBe(third);
    expect(refs?.tags.map(({ name, commit }) => [name, commit])).toEqual([
      ["v3", third],
      ["v2", second],
      ["v1", first],
    ]);
    expect(refs?.tags[0]!.date).toMatch(/^\d{4}-\d\d-\d\dT/);
  });

  test("leaves out a tag of a tree, which names no commit", async () => {
    const folder = repository();
    const head = commit(folder, { "a.txt": "1" });
    git(folder, "tag", "of-tree", "HEAD^{tree}");
    git(folder, "tag", "-a", "of-tree-annotated", "-m", "tree", "HEAD^{tree}");
    git(folder, "tag", "plain");
    expect((await workspaceGitRefs(folder))!.tags).toEqual([{ name: "plain", commit: head, date: expect.any(String) }]);
  });

  test("answers from a subfolder of the repository", async () => {
    const folder = repository();
    const head = commit(folder, { "sub/a.txt": "1" });
    expect((await workspaceGitRefs(join(folder, "sub")))?.head).toBe(head);
  });
});

describe("workspaceFileAt", () => {
  test("reads a file as it is at HEAD and at a tag", async () => {
    const folder = repository();
    commit(folder, { "a.txt": "old" });
    git(folder, "tag", "v1");
    commit(folder, { "a.txt": "new" });
    expect(text(await workspaceFileAt(folder, "HEAD", "a.txt", 1000))).toBe("new");
    expect(text(await workspaceFileAt(folder, "v1", "a.txt", 1000))).toBe("old");
  });

  test("reads the bytes of a binary file as they are", async () => {
    const folder = repository();
    const bytes = new Uint8Array([0, 255, 1, 254]);
    writeFileSync(join(folder, "b.bin"), bytes);
    commit(folder, {});
    expect(new Uint8Array((await workspaceFileAt(folder, "HEAD", "b.bin", 1000))!)).toEqual(bytes);
  });

  test("is null for a file that isn't there at that ref", async () => {
    const folder = repository();
    commit(folder, { "a.txt": "1" });
    git(folder, "tag", "v1");
    commit(folder, { "b.txt": "2" });
    expect(await workspaceFileAt(folder, "v1", "b.txt", 1000)).toBeNull();
    expect(await workspaceFileAt(folder, "HEAD", "nothing.txt", 1000)).toBeNull();
  });

  test("names files from a workspace that is a subfolder of the repository", async () => {
    const folder = repository();
    commit(folder, { "sub/a.txt": "inside", "top.txt": "outside" });
    const workspace = join(folder, "sub");
    expect(text(await workspaceFileAt(workspace, "HEAD", "a.txt", 1000))).toBe("inside");
    expect(await workspaceFileAt(workspace, "HEAD", "top.txt", 1000)).toBeNull();
  });

  test("refuses a ref that is an option, has a space or a colon, or isn't a string", async () => {
    const folder = repository();
    commit(folder, { "a.txt": "1" });
    for (const ref of ["-p", "--output=x", "HEAD a", "HEAD:a.txt", "HEAD\nHEAD", "", 5, null, undefined]) expect(await refusalOf(workspaceFileAt(folder, ref, "a.txt", 1000))).toBe(400);
  });

  test("reads a file at a tag whose name has characters beyond letters and digits", async () => {
    const folder = repository();
    commit(folder, { "a.txt": "1" });
    git(folder, "tag", "v1.0.0+build.5");
    expect(text(await workspaceFileAt(folder, "v1.0.0+build.5", "a.txt", 1000))).toBe("1");
    expect(await workspaceChangedSince(folder, "v1.0.0+build.5")).toEqual([]);
  });

  test("reads a file as it is checked out, with the line ends the attributes give it", async () => {
    const folder = repository();
    commit(folder, { "a.txt": "x\ny\n", ".gitattributes": "a.txt text eol=crlf\n" });
    expect(text(await workspaceFileAt(folder, "HEAD", "a.txt", 1000))).toBe("x\r\ny\r\n");
  });

  test("refuses a path that leaves the workspace or is in .git", async () => {
    const folder = repository();
    commit(folder, { "a.txt": "1" });
    for (const path of ["../a.txt", "x/../../a.txt", "/etc/passwd", ".git/config", "sub/.git/HEAD"]) expect(await refusalOf(workspaceFileAt(folder, "HEAD", path, 1000))).toBe(403);
    for (const path of ["", 5, null]) expect(await refusalOf(workspaceFileAt(folder, "HEAD", path, 1000))).toBe(400);
  });

  test("answers 404 for a ref that isn't a commit", async () => {
    const folder = repository();
    commit(folder, { "a.txt": "1" });
    expect(await refusalOf(workspaceFileAt(folder, "no-such-tag", "a.txt", 1000))).toBe(404);
  });

  test("answers 413 for a file larger than the most asked", async () => {
    const folder = repository();
    commit(folder, { "big.txt": "x".repeat(100) });
    expect(await refusalOf(workspaceFileAt(folder, "HEAD", "big.txt", 99))).toBe(413);
    expect((await workspaceFileAt(folder, "HEAD", "big.txt", 100))?.byteLength).toBe(100);
  });

  test("answers 413 for a file its filter makes larger than the most asked, as LFS makes its small pointers", async () => {
    const folder = repository();
    commit(folder, { "a.bin": "small\n", ".gitattributes": "a.bin filter=grow\n" });
    git(folder, "config", "filter.grow.smudge", "cat; echo grown");
    expect(await refusalOf(workspaceFileAt(folder, "HEAD", "a.bin", 11))).toBe(413);
    expect(text(await workspaceFileAt(folder, "HEAD", "a.bin", 12))).toBe("small\ngrown\n");
  });
});

describe("workspaceChangedSince", () => {
  test("lists modified, added, committed-since and untracked files, and leaves out ignored and deleted ones", async () => {
    const folder = repository();
    commit(folder, { ".gitignore": "ignored.txt\n", "kept.txt": "1", "modified.txt": "1", "deleted.txt": "1" });
    git(folder, "tag", "base");
    commit(folder, { "committed.txt": "1" });
    write(folder, "modified.txt", "2");
    write(folder, "untracked.txt", "1");
    write(folder, "ignored.txt", "1");
    rmSync(join(folder, "deleted.txt"));
    expect((await workspaceChangedSince(folder, "base")).sort()).toEqual(["committed.txt", "modified.txt", "untracked.txt"]);
  });

  test("leaves out an untracked repository inside the workspace, which git lists as a folder", async () => {
    const folder = repository();
    commit(folder, { "a.txt": "1" });
    const nested = join(folder, "nested");
    mkdirSync(nested);
    git(nested, "init", "-q");
    write(folder, "nested/b.txt", "b");
    write(folder, "c.txt", "c");
    expect(await workspaceChangedSince(folder, "HEAD")).toEqual(["c.txt"]);
  });

  test("lists nothing when nothing differs", async () => {
    const folder = repository();
    commit(folder, { "a.txt": "1" });
    expect(await workspaceChangedSince(folder, "HEAD")).toEqual([]);
  });

  test("names files from a workspace that is a subfolder of the repository, leaving out the rest", async () => {
    const folder = repository();
    commit(folder, { "sub/a.txt": "1", "top.txt": "1" });
    write(folder, "sub/a.txt", "2");
    write(folder, "sub/deeper/new.txt", "1");
    write(folder, "top.txt", "2");
    expect((await workspaceChangedSince(join(folder, "sub"), "HEAD")).sort()).toEqual(["a.txt", "deeper/new.txt"]);
  });

  test("refuses a bad ref, and answers 404 for one that isn't a commit", async () => {
    const folder = repository();
    commit(folder, { "a.txt": "1" });
    expect(await refusalOf(workspaceChangedSince(folder, "--stat"))).toBe(400);
    expect(await refusalOf(workspaceChangedSince(folder, "nope"))).toBe(404);
  });
});

describe("watchWorkspaceGit", () => {
  /** Watches a workspace, counting the calls. */
  function listening(workspace: string) {
    let calls = 0;
    const watch = watchWorkspaceGit(workspace, () => calls++);
    return { watch, calls: () => calls };
  }

  const settled = () => Bun.sleep(700);

  async function eventuallyCalled(calls: () => number, atLeast = 1) {
    const deadline = Date.now() + 5000;
    while (calls() < atLeast && Date.now() < deadline) await Bun.sleep(25);
    expect(calls()).toBeGreaterThanOrEqual(atLeast);
  }

  test("calls back after a commit, once for its several writes", async () => {
    const folder = repository();
    commit(folder, { "a.txt": "1" });
    const { watch, calls } = listening(folder);
    await Bun.sleep(300);
    commit(folder, { "a.txt": "2" });
    await eventuallyCalled(calls);
    await settled();
    expect(calls()).toBe(1);
    watch.stop();
  });

  test("calls back after a new tag", async () => {
    const folder = repository();
    commit(folder, { "a.txt": "1" });
    const { watch, calls } = listening(folder);
    await Bun.sleep(300);
    git(folder, "tag", "v1");
    await eventuallyCalled(calls);
    watch.stop();
  });

  test("calls back after a commit or a tag made in a linked worktree, as the common folder holds the tags", async () => {
    const folder = repository();
    commit(folder, { "a.txt": "1" });
    const linked = join(newFolder(), "linked");
    git(folder, "worktree", "add", "-q", "-b", "other", linked);
    const { watch, calls } = listening(linked);
    await Bun.sleep(300);
    commit(linked, { "b.txt": "1" });
    await eventuallyCalled(calls);
    await settled();
    const before = calls();
    git(folder, "tag", "from-main");
    await eventuallyCalled(calls, before + 1);
    watch.stop();
  });

  test("is ready once armed, and says whether the workspace is a repository", async () => {
    const folder = repository();
    commit(folder, { "a.txt": "1" });
    const inRepository = listening(folder);
    expect(await inRepository.watch.ready).toBe(true);
    commit(folder, { "a.txt": "2" });
    await eventuallyCalled(inRepository.calls);
    inRepository.watch.stop();
    const outside = listening(newFolder());
    expect(await outside.watch.ready).toBe(false);
    outside.watch.stop();
  });

  test("doesn't call back when a ref other than a branch or tag moves, as a fetch moves the remotes", async () => {
    const folder = repository();
    const head = commit(folder, { "a.txt": "1" });
    const { watch, calls } = listening(folder);
    await watch.ready;
    git(folder, "update-ref", "refs/remotes/origin/main", head);
    await settled();
    expect(calls()).toBe(0);
    watch.stop();
  });

  test("is ready as no repository when git can't start, so the next ask tries again", async () => {
    const folder = repository();
    const path = process.env.PATH;
    process.env.PATH = "/nonexistent";
    try {
      const { watch } = listening(folder);
      expect(await watch.ready).toBe(false);
      watch.stop();
    } finally {
      process.env.PATH = path;
    }
  });

  test("doesn't call back after stop, nor when the workspace isn't a repository", async () => {
    const folder = repository();
    commit(folder, { "a.txt": "1" });
    const { watch, calls } = listening(folder);
    await Bun.sleep(300);
    watch.stop();
    git(folder, "tag", "v1");
    commit(folder, { "a.txt": "2" });
    await settled();
    expect(calls()).toBe(0);
    const outside = listening(newFolder());
    await Bun.sleep(300);
    outside.watch.stop();
    expect(outside.calls()).toBe(0);
  });
});
