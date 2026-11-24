import { NO_SANDBOX } from "../shared/sandbox.ts";
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { workspaceChangedSince } from "../host/apps/workspace-git.ts";
import { Checkpoints } from "../host/checkpoints.ts";
import { commitFiles } from "../host/commit-files.ts";
import { git } from "../host/git-command.ts";
import { isRepository, uncommittedChanges } from "../host/working-tree.ts";
import type { Workspace } from "../shared/model.ts";

setDefaultTimeout(20_000);

const hostFolder = join(import.meta.dir, "..", "host");

const inHostFolder = (path: string) => relative(hostFolder, path).split(sep).join("/");

const sourcesUnder = (folder: string): string[] =>
  readdirSync(folder).flatMap((name) => {
    const path = join(folder, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : sourcesUnder(path);
    return name.endsWith(".ts") ? [path] : [];
  });

/** Each place the host starts git: an array that begins with "git". */
const gitStartsIn = (source: string) => [...source.matchAll(/\[\s*"git"\s*,([^\]]*)/g)].map((match) => match[1]!.trim());

/** Each git status or diff the host runs, as the array of its arguments, in a source that runs git. */
const comparisonsIn = (source: string) =>
  /git-command|git-environment|this\.git\.(run|mustRun)/.test(source) ? [...source.matchAll(/\[\s*"(status|diff|diff-files|diff-index)"\s*,[^\]]*\]/g)].map((match) => match[0]) : [];

/** Runs the tests of a describe on git config of their own: none of this computer's, nor an index a caller exported. */
function withOnlyRepositoryConfig() {
  const kept = { GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM, GIT_INDEX_FILE: process.env.GIT_INDEX_FILE };
  beforeAll(() => {
    process.env.GIT_CONFIG_GLOBAL = "/dev/null";
    process.env.GIT_CONFIG_NOSYSTEM = "1";
    delete process.env.GIT_INDEX_FILE;
  });
  afterAll(() => {
    for (const [name, value] of Object.entries(kept)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
}

const markerProgramIn = (folder: string, marker: string) => {
  const program = join(folder, `${marker}.sh`);
  writeFileSync(program, `#!/bin/sh\ntouch '${join(folder, marker)}'\ncat\n`);
  chmodSync(program, 0o755);
  return program;
};

describe("Mirador's own git", () => {
  test("every git the host starts runs without the repository's fsmonitor, and without its hooks unless the owner asked", () => {
    const starts = sourcesUnder(hostFolder).flatMap((path) => gitStartsIn(readFileSync(path, "utf8")).map((rest) => ({ file: inHostFolder(path), rest })));
    expect(starts.length).toBeGreaterThan(8);
    const unguarded = starts.filter(({ rest }) => !/^\.\.\.(GIT_WITHOUT_REPOSITORY_PROGRAMS|GIT_WITH_OWNERS_HOOKS|\(ownersHooks \? GIT_WITH_OWNERS_HOOKS : GIT_WITHOUT_REPOSITORY_PROGRAMS\))/.test(rest));
    expect(unguarded).toEqual([]);
  });

  test("every git the host starts in a workspace takes the repository's own common folder, never one its .git/commondir names", () => {
    const outsideWorkspaces = new Set(["newer-version.ts", "apps/installed-plugins.ts"]);
    const startingGit = sourcesUnder(hostFolder).filter((path) => gitStartsIn(readFileSync(path, "utf8")).length > 0);
    const unpinned = startingGit.map(inHostFolder).filter((file) => !outsideWorkspaces.has(file) && !/gitEnvironmentFor\(|ownCommonFolderOf\(/.test(readFileSync(join(hostFolder, file), "utf8")));
    expect(startingGit.length).toBeGreaterThan(5);
    expect(unpinned).toEqual([]);
  });

  test("every git status or diff the host runs leaves the contents of submodules and nested repositories unlooked at", () => {
    const comparisons = sourcesUnder(hostFolder).flatMap((path) => comparisonsIn(readFileSync(path, "utf8")).map((call) => ({ file: inHostFolder(path), call })));
    expect(comparisons.length).toBeGreaterThan(8);
    expect(comparisons.filter(({ call }) => !call.includes('"--ignore-submodules=dirty"'))).toEqual([]);
  });

  describe("in a repository whose own files name programs", () => {
    let root = "";
    let repository = "";
    const ran = (marker: string) => existsSync(join(root, marker));
    const markerProgram = (marker: string) => markerProgramIn(root, marker);
    withOnlyRepositoryConfig();

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "git-programs-"));
      repository = join(root, "repository");
      mkdirSync(repository);
      const setUp = (...args: string[]) => Bun.spawnSync(["git", "-C", repository, ...args]);
      setUp("init", "-q");
      setUp("config", "user.email", "owner@example.com");
      setUp("config", "user.name", "Owner");
      writeFileSync(join(repository, "notes.txt"), "first\n");
      setUp("add", "notes.txt");
      setUp("commit", "-q", "-m", "first");
      setUp("config", "core.fsmonitor", markerProgram("fsmonitor-ran"));
      writeFileSync(join(repository, ".git", "hooks", "pre-commit"), `#!/bin/sh\ntouch '${join(root, "hook-ran")}'\n`);
      chmodSync(join(repository, ".git", "hooks", "pre-commit"), 0o755);
      writeFileSync(join(repository, "notes.txt"), "second\n");
    });

    afterAll(() => rmSync(root, { recursive: true, force: true }));

    test("looking at it runs neither its fsmonitor nor a hook", async () => {
      expect(await isRepository(repository)).toBe(true);
      expect((await uncommittedChanges(repository))?.map(({ path }) => path)).toEqual(["notes.txt"]);
      expect((await git(repository, ["status", "--porcelain"])).stdout).toContain("notes.txt");
      expect(ran("fsmonitor-ran")).toBe(false);
      expect(ran("hook-ran")).toBe(false);
    });

    test("a commit the owner asked for runs their hooks, still without the fsmonitor", async () => {
      await commitFiles(repository, ["notes.txt"], "second", { ownersHooks: true });
      expect(ran("hook-ran")).toBe(true);
      expect(ran("fsmonitor-ran")).toBe(false);
    });

    test("a commit the owner asked for where a sandboxed room works runs no hook of the repository", async () => {
      rmSync(join(root, "hook-ran"));
      writeFileSync(join(repository, "notes.txt"), "third\n");
      await commitFiles(repository, ["notes.txt"], "third", { ownersHooks: false });
      expect((await git(repository, ["log", "-1", "--format=%s"])).stdout.trim()).toBe("third");
      expect(ran("hook-ran")).toBe(false);
    });
  });

  describe("in a repository whose .git/commondir names a folder with a config of its own", () => {
    let root = "";
    let repository = "";
    withOnlyRepositoryConfig();

    /** As a sandboxed agent could leave it: `.git/commondir` naming a copy of the git folder whose config sets a filter on every file, and a file git has to hash again. */
    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "git-commondir-"));
      repository = join(root, "repository");
      mkdirSync(join(repository, "sub"), { recursive: true });
      const setUp = (...args: string[]) => Bun.spawnSync(["git", "-C", repository, ...args]);
      setUp("init", "-q");
      setUp("config", "user.email", "owner@example.com");
      setUp("config", "user.name", "Owner");
      writeFileSync(join(repository, "notes.txt"), "first\n");
      writeFileSync(join(repository, ".gitattributes"), "* filter=planted\n");
      setUp("add", "-A");
      setUp("commit", "-q", "-m", "first");
      const planted = join(root, "planted");
      cpSync(join(repository, ".git"), planted, { recursive: true });
      Bun.spawnSync(["git", "config", "--file", join(planted, "config"), "filter.planted.clean", markerProgramIn(root, "filter-ran")]);
      writeFileSync(join(repository, ".git", "commondir"), `${planted}\n`);
      writeFileSync(join(repository, "notes.txt"), "secon\n");
      const later = new Date(Date.now() + 60_000);
      utimesSync(join(repository, "notes.txt"), later, later);
    });

    afterAll(() => rmSync(root, { recursive: true, force: true }));

    test("Mirador's git takes the repository's own config, from the workspace and from a folder within it, and never runs that filter", async () => {
      const workspace: Workspace = { id: `ws-${crypto.randomUUID()}`, name: "commondir", path: repository, defaultLaunch: { harness: "claude", profileId: null }, color: null, position: 0, groupId: null, newConversationsIn: "folder", worktreeSetup: "", sandbox: NO_SANDBOX, sideChatAccess: null, createdAt: 0 };

      expect((await uncommittedChanges(repository))?.map(({ path }) => path)).toEqual(["notes.txt"]);
      expect((await git(join(repository, "sub"), ["status", "--porcelain"])).stdout).toContain("notes.txt");
      expect(await workspaceChangedSince(repository, "HEAD")).toContain("notes.txt");
      expect(await new Checkpoints(join(root, "data")).snapshot(workspace)).toMatch(/^[0-9a-f]{40}$/);
      await commitFiles(repository, ["notes.txt"], "second", { ownersHooks: true });

      expect((await git(repository, ["log", "-1", "--format=%s"])).stdout.trim()).toBe("second");
      expect(existsSync(join(root, "filter-ran"))).toBe(false);
    });
  });

  describe("in a repository holding another, whose own config names a filter", () => {
    let root = "";
    withOnlyRepositoryConfig();
    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "git-nested-programs-"));
    });
    afterAll(() => rmSync(root, { recursive: true, force: true }));

    const setUp = (directory: string, ...args: string[]) => Bun.spawnSync(["git", "-C", directory, "-c", "user.email=owner@example.com", "-c", "user.name=Owner", ...args]);

    /** A repository with a nested one, as a sandboxed agent could leave it: its filter set to run on any file it hashes, and a file it has to hash again. */
    function repositoryHoldingAnother(how: "untracked" | "submodule" | "submodule its .gitmodules never ignores") {
      const repository = join(root, crypto.randomUUID());
      const nested = join(repository, "lib");
      mkdirSync(nested, { recursive: true });
      setUp(repository, "init", "-q");
      writeFileSync(join(repository, "notes.txt"), "first\n");
      setUp(repository, "add", "notes.txt");
      setUp(repository, "commit", "-q", "-m", "first");
      setUp(nested, "init", "-q");
      writeFileSync(join(nested, "a.txt"), "hello\n");
      setUp(nested, "add", "a.txt");
      setUp(nested, "commit", "-q", "-m", "nested");
      if (how !== "untracked") {
        setUp(repository, "add", "lib");
        setUp(repository, "commit", "-q", "-m", "with lib");
      }
      if (how === "submodule its .gitmodules never ignores") writeFileSync(join(repository, ".gitmodules"), '[submodule "lib"]\n\tpath = lib\n\turl = ./lib\n\tignore = none\n');
      setUp(nested, "config", "filter.planted.clean", markerProgramIn(repository, "filter-ran"));
      writeFileSync(join(nested, ".gitattributes"), "* filter=planted\n");
      writeFileSync(join(nested, "a.txt"), "hellp\n");
      const later = new Date(Date.now() + 60_000);
      utimesSync(join(nested, "a.txt"), later, later);
      return repository;
    }

    test.each(["untracked", "submodule", "submodule its .gitmodules never ignores"] as const)("Mirador's git never runs the nested repository's filter: %s", async (how) => {
      const repository = repositoryHoldingAnother(how);
      const workspace: Workspace = { id: `ws-${crypto.randomUUID()}`, name: "nested", path: repository, defaultLaunch: { harness: "claude", profileId: null }, color: null, position: 0, groupId: null, newConversationsIn: "folder", worktreeSetup: "", sandbox: NO_SANDBOX, sideChatAccess: null, createdAt: 0 };
      const checkpoints = new Checkpoints(join(root, `data-${crypto.randomUUID()}`));

      expect(await checkpoints.snapshot(workspace)).toMatch(/^[0-9a-f]{40}$/);
      writeFileSync(join(repository, "notes.txt"), "second\n");
      expect(await checkpoints.snapshot(workspace)).toMatch(/^[0-9a-f]{40}$/);
      expect((await uncommittedChanges(repository))?.map(({ path }) => path)).toContain("notes.txt");
      expect(await workspaceChangedSince(repository, "HEAD")).toContain("notes.txt");

      expect(existsSync(join(repository, "filter-ran"))).toBe(false);
    });
  });
});
