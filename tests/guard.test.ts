import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { behindGuard, guardMounts, guardSource, manifestOf, type GuardedFolder } from "../host/sandbox/guard.ts";
import type { ProtectedParts } from "../host/sandbox/guarded-workspace.ts";
import { buildArguments } from "../host/sandbox/image.ts";
import { RUNS_SANDBOXES } from "./sandbox-computer.ts";

const scratch = mkdtempSync(join(tmpdir(), "guard-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const guarded = (folder: string, parts: Partial<ProtectedParts> = {}): GuardedFolder => ({ folder, parts: { files: [], folders: [], onTheWay: [], gitFolders: [".git"], ...parts } });

test("the guard is told of each folder where it is mounted, where agents see it and what of it is protected, in a folder only the owner reads", async () => {
  const folder = join(scratch, "sandbox/guard/vm-1");
  const folders = [guarded("/home/me/app", { files: ["CLAUDE.md"], folders: [".claude"], onTheWay: ["config"] }), guarded("/home/me/lib", { gitFolders: [".git", ".git/modules/sub"] })];

  const mounts = await guardMounts(folders, folder);

  expect(mounts).toEqual([
    { source: "/home/me/app", target: "/mirador/raw/0", readOnly: false },
    { source: "/home/me/lib", target: "/mirador/raw/1", readOnly: false },
    { source: folder, target: "/mirador/guard", readOnly: true },
  ]);
  const told = readFileSync(join(folder, "folders"), "utf8");
  expect(told).toBe(["R/mirador/raw/0", "T/home/me/app", "FCLAUDE.md", "D.claude", "Wconfig", "G.git", "R/mirador/raw/1", "T/home/me/lib", "G.git", "G.git/modules/sub", ""].join("\0"));
  expect(behindGuard(["sh", "script.sh"])).toEqual(["mirador-guard", "/mirador/guard/folders", "1000:1000", "--", "sh", "script.sh"]);
  if (RUNS_SANDBOXES) expect([statSync(folder).mode & 0o777, statSync(join(folder, "folders")).mode & 0o777]).toEqual([0o700, 0o600]);
});

test("the image is built with the guard's source, which the recipe unpacks file by file", async () => {
  const given = (await buildArguments({ harness: "claude", version: "2.1.330" })).find((argument) => argument.startsWith("GUARD_SOURCE="))!;
  const source = gunzipSync(Buffer.from(given.slice("GUARD_SOURCE=".length), "base64")).toString();
  expect(JSON.parse(source)).toEqual(await guardSource());
  expect(Object.keys(await guardSource())).toEqual(["guard.cpp", "manifest.hpp", "rules.hpp"]);
  expect(given.length).toBeLessThan(100_000);
});

const CXX = process.platform === "win32" ? null : Bun.which("c++");

const DOES_ANYTHING = "change move make-file make-folder make-link";
const NOTHING = "";

describe.skipIf(CXX === null)("what the guard lets agents do, by the rules it is built with", () => {
  const probe = join(scratch, "probe");
  const compiled = CXX === null ? null : Bun.spawnSync([CXX, "-std=c++17", "-Wall", "-Wextra", "-I", join(import.meta.dir, "guard"), join(import.meta.dir, "guard/probe.cpp"), "-o", probe]);

  /** What may be done at each path of the folder of this index, as the guard told of these folders says. */
  async function mayBeDone(folders: GuardedFolder[], paths: string[], root = 0): Promise<Record<string, string>> {
    const manifest = join(scratch, `manifest-${crypto.randomUUID()}`);
    await Bun.write(manifest, manifestOf(folders));
    const ran = Bun.spawnSync([probe, manifest], { stdin: Buffer.from(paths.map((path) => `${root} ${path}\n`).join("")) });
    expect(ran.stderr.toString()).toBe("");
    const lines = ran.stdout.toString().trimEnd().split("\n").slice(folders.length);
    return Object.fromEntries(lines.map((line) => [line.slice(0, line.indexOf(":")), line.slice(line.indexOf(":") + 2)]));
  }

  const all = (paths: string[], answer: string) => Object.fromEntries(paths.map((path) => [path, answer]));

  test("compiles, and reads what it is told", () => {
    expect(compiled!.stderr.toString()).toBe("");
    expect(compiled!.exitCode).toBe(0);
  });

  test("a protected file or folder is neither changed, moved, removed nor made, whatever case it is spelled in, nor is anything in a protected folder", async () => {
    const folders = [guarded("/w", { files: ["CLAUDE.md", "pkg/AGENTS.md"], folders: [".claude", "pkg/app/.husky"] })];
    const kept = ["CLAUDE.md", "claude.MD", "pkg/AGENTS.md", ".claude", ".CLAUDE", ".claude/settings.json", ".claude/a/b", "pkg/app/.husky", "pkg/app/.husky/pre-commit"];
    const free = ["README.md", "pkg/CLAUDE.md", "pkg/app/x", "other/AGENTS.md", "src/.claude"];
    expect(await mayBeDone(folders, kept)).toEqual(all(kept, NOTHING));
    expect(await mayBeDone(folders, free)).toEqual(all(free, DOES_ANYTHING));
  });

  test("a folder on the way to what is protected stays where it is, and is made only as a folder", async () => {
    const folders = [guarded("/w", { files: ["pkg/app/AGENTS.md"], onTheWay: ["config"] })];
    expect(await mayBeDone(folders, ["pkg", "PKG", "pkg/app", "config", "config/team.cfg", "pkg/other"])).toEqual({ ...all(["pkg", "PKG", "pkg/app", "config"], "make-folder"), ...all(["config/team.cfg", "pkg/other"], DOES_ANYTHING) });
    expect(await mayBeDone([guarded("/w", { folders: ["hooks"], onTheWay: ["hooks"] })], ["hooks"])).toEqual({ hooks: NOTHING });
  });

  test("no file is made beside a protected one that is its name with more around it, as an editor makes to put over it", async () => {
    const folders = [guarded("/w", { files: ["CLAUDE.md"], folders: [".husky"] })];
    const asEditors = ["CLAUDE.md.tmp.123", ".CLAUDE.md.swp", "#CLAUDE.md#", "CLAUDE.md~", "claude.md___jb_tmp___"];
    const others = ["NOT-CLAUDE.md", "CLAUDE.mdx", "src/CLAUDE.md.tmp", ".husky.txt"];
    expect(await mayBeDone(folders, asEditors)).toEqual(all(asEditors, NOTHING));
    expect(await mayBeDone(folders, others)).toEqual(all(others, DOES_ANYTHING));
  });

  test("git's folders take what git writes, but not what it runs programs from or is led elsewhere by, objects of other folders, remotes of their own files and grafted parents too, nor a link", async () => {
    const gitWrites = ["index", "index.lock", "HEAD", "HEAD.lock", "refs/heads/main", "logs/HEAD", "objects/ab/cdef", "rebase-merge/done", "COMMIT_EDITMSG", "packed-refs.lock"];
    const kept = ["config", "config.lock", "CONFIG.worktree", "hooks", "hooks/pre-commit", "Hooks", "worktrees", "worktrees/w/gitdir", "commondir", "gitdir"];
    const ledToOtherObjects = ["objects/info/alternates", "objects/info/alternates.lock", "Objects/Info/Alternates", "objects/info/http-alternates", "remotes", "remotes/origin", "branches", "branches/origin", "info/grafts", "Info/Grafts", "info/grafts.tmp"];
    const onTheWayToThose = ["objects", "objects/info", "info"];
    const gitWritesBesideThose = ["objects/info/packs", "objects/info/commit-graph", "objects/pack/pack-1.pack", "objects/incoming-1/ab/cdef", "info/exclude", "info/attributes"];
    for (const gitFolder of [".git", "vendor/lib/.git", "a/b/c/.GIT"]) {
      const inside = (names: string[]) => names.map((name) => `${gitFolder}/${name}`);
      expect(await mayBeDone([guarded("/w")], inside(gitWrites))).toEqual(all(inside(gitWrites), "change move make-file make-folder"));
      expect(await mayBeDone([guarded("/w")], inside(kept))).toEqual(all(inside(kept), NOTHING));
      expect(await mayBeDone([guarded("/w")], inside(ledToOtherObjects))).toEqual(all(inside(ledToOtherObjects), NOTHING));
      expect(await mayBeDone([guarded("/w")], inside(onTheWayToThose))).toEqual(all(inside(onTheWayToThose), "make-folder"));
      expect(await mayBeDone([guarded("/w")], inside(gitWritesBesideThose))).toEqual(all(inside(gitWritesBesideThose), "change move make-file make-folder"));
    }
  });

  test("no git folder is made, moved or removed anywhere, nor a file that names one", async () => {
    const gitFolders = [".git", "src/.git", "src/.GIT", "src/deep/.git", ".git/x/.git", ".git/.git"];
    expect(await mayBeDone([guarded("/w")], gitFolders)).toEqual(all(gitFolders, NOTHING));
    expect(await mayBeDone([guarded("/w")], ["src/.gitignore", ".gitmodules", "src/git"])).toEqual(all(["src/.gitignore", ".gitmodules", "src/git"], DOES_ANYTHING));
  });

  test("no file or link called HEAD, which would make a repository of its folder, is made, put or changed outside git's folders, only removed; a folder is made so", async () => {
    const heads = ["HEAD", "head", "src/HEAD", "src/deep/Head", "node_modules/pkg/HEAD", "HEAD/HEAD"];
    expect(await mayBeDone([guarded("/w")], heads)).toEqual(all(heads, "remove make-folder"));
    const others = ["src/HEAD.md", "src/HEADS", "src/head/a.txt", "src/ORIG_HEAD"];
    expect(await mayBeDone([guarded("/w")], others)).toEqual(all(others, DOES_ANYTHING));
    expect(await mayBeDone([guarded("/w", { onTheWay: ["head"] })], ["head", "head/x"])).toEqual({ head: "make-folder", "head/x": DOES_ANYTHING });
  });

  test("a bare repository is as any git folder, its HEAD for git to change, and stays where it is", async () => {
    const folders = [guarded("/w", { gitFolders: [".git", "fixtures/remote.git"] })];
    const writable = ["HEAD", "HEAD.lock", "refs/heads/main", "objects/ab/cdef"].map((name) => `fixtures/remote.git/${name}`);
    const kept = ["config", "hooks/pre-receive", "worktrees/w", "commondir", ".git", "objects/info/alternates", "remotes/origin"].map((name) => `fixtures/remote.git/${name}`);
    expect(await mayBeDone(folders, writable)).toEqual(all(writable, "change move make-file make-folder"));
    expect(await mayBeDone(folders, kept)).toEqual(all(kept, NOTHING));
    expect(await mayBeDone(folders, ["fixtures/remote.git", "fixtures", "fixtures/HEAD"])).toEqual({ "fixtures/remote.git": NOTHING, fixtures: "make-folder", "fixtures/HEAD": "remove make-folder" });
  });

  test("submodules' git folders are as the repository's own, and nothing else of them is made", async () => {
    const folders = [guarded("/w", { gitFolders: [".git", ".git/modules/lib", ".git/modules/deep/er", ".git/modules/lib/modules/sub"] })];
    const git = (names: string[], modules: string) => names.map((name) => `.git/modules/${modules}/${name}`);
    const writable = [...git(["index", "refs/heads/main"], "lib"), ...git(["HEAD"], "deep/er"), ...git(["index.lock"], "lib/modules/sub")];
    const kept = [...git(["config", "hooks/pre-commit", "objects/info/alternates"], "lib"), ...git(["config", "branches"], "deep/er"), ...git(["hooks", "objects/info/http-alternates"], "lib/modules/sub"), ".git/modules", ".git/modules/lib", ".git/modules/deep", ".git/modules/deep/er", ".git/modules/new", ".git/modules/deep/new", ".git/modules/new/config", ".git/modules/lib/modules/new"];
    expect(await mayBeDone(folders, writable)).toEqual(all(writable, "change move make-file make-folder"));
    expect(await mayBeDone(folders, kept)).toEqual(all(kept, NOTHING));
  });

  test("a file of a git folder that its config includes is protected, and each folder keeps to its own rules", async () => {
    const folders = [guarded("/w", { files: [".git/shared/team.cfg"] }), guarded("/lib", { files: ["only-here.txt"] })];
    expect(await mayBeDone(folders, [".git/shared/team.cfg", ".git/shared", ".git/shared/other", "only-here.txt"])).toEqual({ ".git/shared/team.cfg": NOTHING, ".git/shared": "make-folder", ".git/shared/other": "change move make-file make-folder", "only-here.txt": DOES_ANYTHING });
    expect(await mayBeDone(folders, ["only-here.txt"], 1)).toEqual({ "only-here.txt": NOTHING });
  });

  test("it starts on nothing it can't read whole", async () => {
    for (const told of ["R/mirador/raw/0\0T/w", "T/w\0", "R/raw\0Tw\0", "R/raw\0T/w\0Xwhat\0"]) {
      const manifest = join(scratch, `broken-${crypto.randomUUID()}`);
      await Bun.write(manifest, told);
      expect(Bun.spawnSync([probe, manifest]).exitCode).not.toBe(0);
    }
  });
});
