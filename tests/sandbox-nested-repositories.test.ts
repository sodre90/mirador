import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { guardPlanOf, sandboxRefusalOf, type MiradorPlaces, type ProtectedParts } from "../host/sandbox/guarded-workspace.ts";
import { RUNS_SANDBOXES } from "./sandbox-computer.ts";

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "sandbox-nested-")));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const ELSEWHERE: MiradorPlaces = { home: "/nonexistent-home", dataDir: "/nonexistent-data", checkout: "/nonexistent-checkout", computersOwn: [] };

const AS_SOMEONE = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };

function git(folder: string, ...args: string[]) {
  const ran = Bun.spawnSync(["git", "-c", "protocol.file.allow=always", "-C", folder, ...args], { env: { ...process.env, ...AS_SOMEONE } });
  if (ran.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${ran.stderr}`);
}

function made(folder: string, ...init: string[]) {
  mkdirSync(folder, { recursive: true });
  git(folder, "init", "-q", ...init);
  return folder;
}

const workspaceNamed = (name: string) => made(join(scratch, `${name}-${crypto.randomUUID()}`));

function written(path: string, text = "") {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  return path;
}

async function partsOf(workspace: string): Promise<ProtectedParts> {
  const plan = await guardPlanOf(workspace, ELSEWHERE);
  if ("refused" in plan) throw new Error(`refused: ${JSON.stringify(plan.refused)}`);
  return plan.parts;
}

async function underOwnersConfig<T>(config: string, act: () => Promise<T>): Promise<T> {
  const before = process.env.GIT_CONFIG_GLOBAL;
  process.env.GIT_CONFIG_GLOBAL = written(join(scratch, `owners-${crypto.randomUUID()}`), config);
  try {
    return await act();
  } finally {
    if (before === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = before;
  }
}

describe.skipIf(!RUNS_SANDBOXES)("of the repositories nested in a workspace, the guard protects", () => {
  test("the files one's config includes and the hooks folder it names, taken from its own top, and lets agents work in its submodules", async () => {
    const workspace = workspaceNamed("nested");
    const lib = made(join(workspace, "vendor/lib"));
    written(join(lib, "team.cfg"), "[include]\n\tpath = more/deep.cfg\n");
    written(join(lib, "more/deep.cfg"));
    git(lib, "config", "include.path", "../team.cfg");
    git(lib, "config", "core.hooksPath", "tools/hooks");
    made(join(lib, ".git/modules/inner"), "--bare");

    expect(await partsOf(workspace)).toEqual({
      files: ["vendor/lib/team.cfg", "vendor/lib/more/deep.cfg"],
      folders: ["vendor/lib/tools/hooks"],
      onTheWay: ["vendor", "vendor/lib", "vendor/lib/.git", "vendor/lib/more"],
      gitFolders: [".git", "vendor/lib/.git/modules/inner"],
    });
  });

  test("nothing more of one whose config leads nowhere in the workspace, as its own config and hooks are protected by their names", async () => {
    const workspace = workspaceNamed("plain-nested");
    made(join(workspace, "vendor/lib"));
    expect(await partsOf(workspace)).toEqual({ files: [], folders: [], onTheWay: [], gitFolders: [".git"] });
  });

  test("a bare one as a git folder, and any folder a file HEAD makes look like one, whatever it holds, while a folder called HEAD makes none", async () => {
    const workspace = workspaceNamed("bare");
    const remote = made(join(workspace, "fixtures/remote.git"), "--bare");
    git(remote, "config", "include.path", "shared.cfg");
    written(join(remote, "shared.cfg"));
    git(remote, "config", "core.hooksPath", "own-hooks");
    written(join(workspace, "notes/HEAD"), "Read this first.\n");
    mkdirSync(join(workspace, "parts/HEAD"), { recursive: true });
    const both = made(join(workspace, "both"));
    written(join(both, "HEAD"));
    written(join(workspace, "HEAD"));

    expect(await partsOf(workspace)).toEqual({
      files: ["fixtures/remote.git/shared.cfg"],
      folders: ["fixtures/remote.git/own-hooks"],
      onTheWay: ["fixtures", "fixtures/remote.git"],
      gitFolders: [".git", "fixtures/remote.git", "notes"],
    });
  });

  test("the hooks folder in the worktrees and submodules checked out in it, which git takes from each one's own top", async () => {
    const workspace = workspaceNamed("checked-out");
    git(workspace, "commit", "-q", "--allow-empty", "-m", "first");
    git(workspace, "config", "core.hooksPath", ".husky/_");
    git(workspace, "worktree", "add", "-q", join(workspace, "trees/w"));
    git(workspace, "worktree", "add", "-q", join(scratch, `outside-${crypto.randomUUID()}`));
    const source = workspaceNamed("source");
    git(source, "commit", "-q", "--allow-empty", "-m", "first");
    git(workspace, "submodule", "add", "-q", source, "lib");
    git(join(workspace, "lib"), "config", "core.hooksPath", "hooks-of-lib");

    const parts = await partsOf(workspace);
    expect(parts.folders).toEqual([".husky/_", "lib/hooks-of-lib", "trees/w/.husky/_"]);
    expect(parts.gitFolders).toEqual([".git", ".git/modules/lib"]);
  });

  test("the hooks folder of a worktree in it whose repository is elsewhere, and of one whose git folder a link or a file leads to", async () => {
    const workspace = workspaceNamed("led");
    const elsewhere = workspaceNamed("elsewhere");
    git(elsewhere, "commit", "-q", "--allow-empty", "-m", "first");
    git(elsewhere, "config", "core.hooksPath", "hooks-of-worktree");
    git(elsewhere, "worktree", "add", "-q", join(workspace, "worktree"));
    const separate = join(scratch, `separate-${crypto.randomUUID()}`);
    made(join(workspace, "separate"), "--separate-git-dir", separate);
    git(join(workspace, "separate"), "config", "core.hooksPath", "hooks-of-separate");
    const linkedTo = made(join(scratch, `linked-to-${crypto.randomUUID()}`));
    git(linkedTo, "config", "core.hooksPath", "hooks-of-linked");
    mkdirSync(join(workspace, "linked"));
    symlinkSync(join(linkedTo, ".git"), join(workspace, "linked/.git"));
    written(join(workspace, "stale/.git"), "gitdir: /nonexistent/.git/worktrees/stale\n");

    const parts = await partsOf(workspace);
    expect(parts.folders).toEqual(["linked/hooks-of-linked", "separate/hooks-of-separate", "worktree/hooks-of-worktree"]);
    expect(parts.gitFolders).toEqual([".git"]);
  });

  test("the hooks folder the owner's own config names, in each of them, and one named on a condition, or as optional", async () => {
    const workspace = workspaceNamed("owners-hooks");
    made(join(workspace, "lib"));
    const onBranch = written(join(scratch, `on-branch-${crypto.randomUUID()}`), "[core]\n\thooksPath = :(optional)hooks-on-branch\n");
    git(join(workspace, "lib"), "config", "includeIf.onbranch:never.path", onBranch);

    expect((await underOwnersConfig("[core]\n\thooksPath = .githooks\n", () => partsOf(workspace))).folders).toEqual([".githooks", "lib/.githooks", "lib/hooks-on-branch"]);
  });

  test("nothing in the folders held whole, or in git's and the packages' own, which aren't looked into", async () => {
    const workspace = workspaceNamed("not-looked-into");
    for (const path of [".claude/worktrees/w", "node_modules/pkg"]) git(made(join(workspace, path)), "config", "core.hooksPath", "hooks");
    written(join(workspace, ".git/refs/remotes/origin/HEAD"), "ref: refs/remotes/origin/main\n");
    expect(await partsOf(workspace)).toEqual({ files: [], folders: [], onTheWay: [], gitFolders: [".git"] });
  });
});

describe.skipIf(!RUNS_SANDBOXES)("a workspace is refused", () => {
  test("where the hooks folder is the workspace or its git folder, as neither can be kept as it is", async () => {
    for (const [name, folder] of [
      [".", "."],
      ["./", "."],
      ["sub/..", "."],
      [".git", ".git"],
      [":(optional).", "."],
    ] as const) {
      const workspace = workspaceNamed("hooks-hold");
      mkdirSync(join(workspace, "sub"));
      git(workspace, "config", "core.hooksPath", name);
      expect([name, await sandboxRefusalOf(workspace, ELSEWHERE)]).toEqual([name, { kind: "hooks-folder-holds-repository", folder }]);
    }
    const byWholePath = workspaceNamed("hooks-hold");
    git(byWholePath, "config", "core.hooksPath", byWholePath);
    expect(await sandboxRefusalOf(byWholePath, ELSEWHERE)).toEqual({ kind: "hooks-folder-holds-repository", folder: "." });
    const throughLink = workspaceNamed("hooks-hold");
    const link = join(scratch, `link-${crypto.randomUUID()}`);
    symlinkSync(throughLink, link);
    git(throughLink, "config", "core.hooksPath", link);
    expect(await sandboxRefusalOf(throughLink, ELSEWHERE)).toEqual({ kind: "hooks-folder-holds-repository", folder: "." });
  });

  test("where a hooks folder holds a repository nested in it, or is one, and not where it is git's own", async () => {
    const holding = workspaceNamed("hooks-hold-nested");
    made(join(holding, "tools/lib"));
    git(holding, "config", "core.hooksPath", "tools");
    expect(await sandboxRefusalOf(holding, ELSEWHERE)).toEqual({ kind: "hooks-folder-holds-repository", folder: "tools" });

    const own = workspaceNamed("hooks-are-nested");
    git(made(join(own, "lib")), "config", "core.hooksPath", ".");
    expect(await sandboxRefusalOf(own, ELSEWHERE)).toEqual({ kind: "hooks-folder-holds-repository", folder: "lib" });

    const bare = workspaceNamed("hooks-are-bare");
    git(made(join(bare, "remote.git"), "--bare"), "config", "core.hooksPath", ".");
    expect(await sandboxRefusalOf(bare, ELSEWHERE)).toEqual({ kind: "hooks-folder-holds-repository", folder: "remote.git" });

    const gitsOwn = workspaceNamed("hooks-are-gits");
    git(gitsOwn, "config", "core.hooksPath", ".git/hooks");
    expect((await partsOf(gitsOwn)).folders).toEqual([".git/hooks"]);
  });

  test("where a nested repository's config or hooks is a link, or its config includes a file of the workspace that isn't there", async () => {
    const linkedHooks = workspaceNamed("nested-linked");
    const lib = made(join(linkedHooks, "lib"));
    rmSync(join(lib, ".git/hooks"), { recursive: true, force: true });
    symlinkSync("../hooks-of-lib", join(lib, ".git/hooks"));
    expect(await sandboxRefusalOf(linkedHooks, ELSEWHERE)).toEqual({ kind: "part-is-link", part: "lib/.git/hooks" });

    const missing = workspaceNamed("nested-missing");
    git(made(join(missing, "lib")), "config", "include.path", "../local.cfg");
    expect(await sandboxRefusalOf(missing, ELSEWHERE)).toEqual({ kind: "config-includes-missing-file", file: "lib/local.cfg" });
  });

  test("where the owner's own config, there or not, is read through the workspace", async () => {
    const workspace = workspaceNamed("owners-config");
    const config = join(scratch, `owners-link-${crypto.randomUUID()}`);
    symlinkSync(join(workspace, "gitconfig"), config);
    const before = process.env.GIT_CONFIG_GLOBAL;
    process.env.GIT_CONFIG_GLOBAL = config;
    try {
      expect(await sandboxRefusalOf(workspace, ELSEWHERE)).toEqual({ kind: "config-read-through-link", file: config, link: config });
    } finally {
      if (before === undefined) delete process.env.GIT_CONFIG_GLOBAL;
      else process.env.GIT_CONFIG_GLOBAL = before;
    }
  });
});
