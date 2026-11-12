import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { landableOnto, landOnto } from "../host/landing.ts";

// Each test runs a few dozen git commands; a loaded machine takes longer than Bun's 5 s default.
setDefaultTimeout(20_000);

const roots: string[] = [];
const keptEnvironment = new Map<string, string | undefined>();

/** The host's git takes the process's environment, where a session's GIT_INDEX_FILE would point it at a real repository. */
function isolateGit() {
  const overrides: Record<string, string | undefined> = { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
  for (const name of Object.keys(process.env).filter((name) => name.startsWith("GIT_"))) overrides[name] ??= undefined;
  for (const [name, value] of Object.entries(overrides)) {
    keptEnvironment.set(name, process.env[name]);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

function restoreEnvironment() {
  for (const [name, value] of keptEnvironment) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

function git(folder: string, ...args: string[]) {
  const result = Bun.spawnSync(["git", "-C", folder, ...args], { env: process.env });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr.toString()}`);
  return result.stdout.toString().trimEnd();
}

const write = (folder: string, path: string, text: string) => writeFileSync(join(folder, path), `${text}\n`);
const read = (folder: string, path: string) => readFileSync(join(folder, path), "utf8").trimEnd();
const commitIn = (folder: string, path: string, text: string, subject: string) => {
  write(folder, path, text);
  git(folder, "add", path);
  git(folder, "commit", "--quiet", "-m", subject);
};
const headOf = (folder: string) => git(folder, "rev-parse", "HEAD");
const statusOf = (folder: string) => git(folder, "status", "--porcelain");

const ANOTHER_SESSIONS_EDITS = " M edited-elsewhere\nM  staged-elsewhere";

/** A project folder on main with someone's uncommitted edits in it, and a conversation's worktree branched off it. */
function projectWithAWorktree() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "mirador-landing-")));
  roots.push(root);
  const project = join(root, "project");
  const worktree = join(root, "worktree");
  git(root, "init", "--quiet", "--initial-branch=main", project);
  git(project, "config", "user.name", "Owner");
  git(project, "config", "user.email", "owner@example.com");
  mkdirSync(join(project, "sub"));
  for (const path of ["mine", "shared", "staged-elsewhere", "edited-elsewhere", "sub/inside"]) write(project, path, `${path} at the start`);
  git(project, "add", ".");
  git(project, "commit", "--quiet", "-m", "Start");
  git(project, "worktree", "add", "--quiet", "-b", "mirador/conversation", worktree, "HEAD");
  write(project, "staged-elsewhere", "staged by someone");
  git(project, "add", "staged-elsewhere");
  write(project, "edited-elsewhere", "edited by someone");
  return { project, worktree, start: headOf(project) };
}

/** Someone lands on main while the conversation works, without touching the uncommitted edits in the project folder. */
function mainMovesOn(project: string, path: string, text: string) {
  const elsewhere = join(project, "..", "elsewhere");
  git(project, "worktree", "add", "--quiet", "--detach", elsewhere, "main");
  commitIn(elsewhere, path, text, `Change ${path} elsewhere`);
  git(project, "merge", "--ff-only", "--quiet", headOf(elsewhere));
  git(project, "worktree", "remove", "--force", elsewhere);
}

beforeAll(isolateGit);
afterAll(() => {
  restoreEnvironment();
  roots.forEach((root) => rmSync(root, { recursive: true, force: true }));
});

describe.skipIf(process.platform === "win32")("landing a worktree's commits", () => {
  test("a fast-forward moves the project folder's branch and files, and leaves the edits already in it", async () => {
    const { project, worktree } = projectWithAWorktree();
    commitIn(worktree, "mine", "mine from the conversation", "Change mine");

    expect(await landableOnto(project, worktree)).toEqual({ branch: "main", ahead: 1, behind: 0 });
    const landed = await landOnto(project, worktree, { mayRebase: false });

    expect(landed).toMatchObject({ branch: "main", subjects: ["Change mine"], rebased: false });
    expect(headOf(project)).toBe(headOf(worktree));
    expect(read(project, "mine")).toBe("mine from the conversation");
    expect(statusOf(project)).toBe(ANOTHER_SESSIONS_EDITS);
    expect(await landableOnto(project, worktree)).toEqual({ branch: "main", ahead: 0, behind: 0 });
  });

  test("when main moved on, the commits are rebased onto it first and the worktree's own edit stays", async () => {
    const { project, worktree } = projectWithAWorktree();
    commitIn(worktree, "mine", "mine from the conversation", "Change mine");
    write(worktree, "shared", "being edited in the worktree");
    mainMovesOn(project, "sub/inside", "changed on main");

    expect(await landableOnto(project, worktree)).toEqual({ branch: "main", ahead: 1, behind: 1 });
    const landed = await landOnto(project, worktree, { mayRebase: true });

    expect(landed).toMatchObject({ subjects: ["Change mine"], rebased: true });
    expect(headOf(project)).toBe(headOf(worktree));
    expect(read(project, "mine")).toBe("mine from the conversation");
    expect(read(project, "sub/inside")).toBe("changed on main");
    expect(read(worktree, "shared")).toBe("being edited in the worktree");
    expect(statusOf(worktree)).toBe(" M shared");
    expect(git(project, "stash", "list")).toBe("");
  });

  test("a landing that needs a rebase waits while the agent works in the worktree", async () => {
    const { project, worktree } = projectWithAWorktree();
    commitIn(worktree, "mine", "mine from the conversation", "Change mine");
    mainMovesOn(project, "sub/inside", "changed on main");
    const before = { project: headOf(project), worktree: headOf(worktree) };

    await expect(landOnto(project, worktree, { mayRebase: false })).rejects.toMatchObject({ problem: { code: "landing-rebase-while-working", branch: "main" } });
    expect({ project: headOf(project), worktree: headOf(worktree) }).toEqual(before);
  });

  test("a rebase that conflicts puts the worktree back as it was and names the files", async () => {
    const { project, worktree } = projectWithAWorktree();
    commitIn(worktree, "shared", "the conversation's take", "Change shared");
    write(worktree, "mine", "being edited in the worktree");
    mainMovesOn(project, "shared", "main's take");
    const before = { project: headOf(project), worktree: headOf(worktree) };

    await expect(landOnto(project, worktree, { mayRebase: true })).rejects.toMatchObject({ problem: { code: "landing-conflicts", paths: ["shared"] } });

    expect({ project: headOf(project), worktree: headOf(worktree) }).toEqual(before);
    expect(statusOf(worktree)).toBe(" M mine");
    expect(read(worktree, "shared")).toBe("the conversation's take");
    expect(git(project, "stash", "list")).toBe("");
  });

  test("uncommitted worktree edits to files main changed are refused before any rebase", async () => {
    const { project, worktree } = projectWithAWorktree();
    commitIn(worktree, "mine", "mine from the conversation", "Change mine");
    write(worktree, "sub/inside", "being edited in the worktree");
    mainMovesOn(project, "sub/inside", "changed on main");
    const before = headOf(worktree);

    await expect(landOnto(project, worktree, { mayRebase: true })).rejects.toMatchObject({ problem: { code: "landing-worktree-edits-clash", paths: ["sub/inside"] } });
    expect(headOf(worktree)).toBe(before);
    expect(read(worktree, "sub/inside")).toBe("being edited in the worktree");
  });

  test("commits that change a file someone is editing in the project folder do not land, and the worktree is not rebased", async () => {
    const { project, worktree } = projectWithAWorktree();
    commitIn(worktree, "edited-elsewhere", "the conversation's take", "Change edited-elsewhere");
    mainMovesOn(project, "sub/inside", "changed on main");
    const before = { project: headOf(project), worktree: headOf(worktree) };

    await expect(landOnto(project, worktree, { mayRebase: true })).rejects.toMatchObject({
      problem: { code: "landing-overlaps-uncommitted", branch: "main", paths: ["edited-elsewhere"] },
    });
    expect({ project: headOf(project), worktree: headOf(worktree) }).toEqual(before);
    expect(read(project, "edited-elsewhere")).toBe("edited by someone");
  });

  test("a project folder with no branch checked out, or a worktree with nothing new, has nothing to land on", async () => {
    const { project, worktree } = projectWithAWorktree();
    await expect(landOnto(project, worktree, { mayRebase: true })).rejects.toMatchObject({ problem: { code: "nothing-to-land", branch: "main" } });

    commitIn(worktree, "mine", "mine from the conversation", "Change mine");
    git(project, "checkout", "--quiet", "--detach");
    expect(await landableOnto(project, worktree)).toEqual({ branch: null, ahead: 0, behind: 0 });
    await expect(landOnto(project, worktree, { mayRebase: true })).rejects.toMatchObject({ problem: { code: "landing-needs-branch", directory: project } });
  });

  test("a rebase the agent left half done is neither landed nor thrown away", async () => {
    const { project, worktree } = projectWithAWorktree();
    commitIn(worktree, "shared", "the conversation's take", "Change shared");
    mainMovesOn(project, "shared", "main's take");
    const agentsRebase = Bun.spawnSync(["git", "-C", worktree, "rebase", "main"], { env: process.env });
    expect(agentsRebase.exitCode).not.toBe(0);
    const projectHead = headOf(project);

    await expect(landOnto(project, worktree, { mayRebase: true })).rejects.toMatchObject({ problem: { code: "landing-mid-operation", directory: worktree } });

    expect(existsSync(git(worktree, "rev-parse", "--path-format=absolute", "--git-path", "rebase-merge"))).toBe(true);
    expect(headOf(project)).toBe(projectHead);
    expect(git(project, "stash", "list")).toBe("");
  });

  test("a merge someone left half done in the project folder refuses the landing before the worktree is rebased", async () => {
    const { project, worktree } = projectWithAWorktree();
    commitIn(worktree, "mine", "mine from the conversation", "Change mine");
    mainMovesOn(project, "sub/inside", "changed on main");
    const side = join(project, "..", "side");
    git(project, "worktree", "add", "--quiet", "-b", "side", side, "main");
    commitIn(side, "from-side", "from the side branch", "Add from-side");
    git(project, "reset", "--quiet", "--", "staged-elsewhere");
    git(project, "merge", "--no-ff", "--no-commit", "--quiet", "side");
    const before = { project: headOf(project), worktree: headOf(worktree) };

    await expect(landOnto(project, worktree, { mayRebase: true })).rejects.toMatchObject({ problem: { code: "landing-mid-operation", directory: project } });

    expect({ project: headOf(project), worktree: headOf(worktree) }).toEqual(before);
    expect(existsSync(git(project, "rev-parse", "--path-format=absolute", "--git-path", "MERGE_HEAD"))).toBe(true);
  });

  test("a workspace that is a folder inside its repository lands the whole commit", async () => {
    const { project, worktree } = projectWithAWorktree();
    commitIn(worktree, "mine", "mine from the conversation", "Change mine");

    await landOnto(join(project, "sub"), worktree, { mayRebase: false });

    expect(read(project, "mine")).toBe("mine from the conversation");
    expect(statusOf(project)).toBe(ANOTHER_SESSIONS_EDITS);
  });
});
