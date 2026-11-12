import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

// Each test runs a dozen git commands; a loaded machine takes longer than Bun's 5 s default.
setDefaultTimeout(15_000);

const LAND_SCRIPT = join(import.meta.dir, "..", "scripts", "land.sh");
const roots: string[] = [];

/** Git variables from the session running the tests, such as GIT_INDEX_FILE, would point the fixture's git at the real repository. */
function isolatedEnvironment(extra: Record<string, string>) {
  const ownVariables = Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_"));
  return { ...Object.fromEntries(ownVariables), GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", ...extra };
}

function run(folder: string, command: string[], extra: Record<string, string> = {}) {
  const result = Bun.spawnSync(command, { cwd: folder, env: isolatedEnvironment(extra) });
  return { exitCode: result.exitCode, output: result.stdout.toString() + result.stderr.toString() };
}

function git(folder: string, ...args: string[]) {
  const { exitCode, output } = run(folder, ["git", ...args]);
  if (exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${output}`);
  return output.trimEnd();
}

const land = (folder: string, ...args: string[]) => run(folder, [LAND_SCRIPT, ...args]);
const statusOf = (checkout: string) => git(checkout, "status", "--porcelain");
const fileOnMain = (checkout: string, path: string) => git(checkout, "show", `main:${path}`);
const write = (folder: string, path: string, text: string) => writeFileSync(join(folder, path), `${text}\n`);

const ANOTHER_SESSIONS_EDITS = "M  theirs-staged\n M theirs-unstaged";

/** A main checkout two sessions share: the other one has a staged and an unstaged edit in it. */
function sharedCheckout() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "mirador-land-")));
  roots.push(root);
  const checkout = join(root, "checkout");
  git(root, "init", "--quiet", "--initial-branch=main", checkout);
  git(checkout, "config", "user.name", "Owner");
  git(checkout, "config", "user.email", "owner@example.com");
  for (const path of ["mine", "theirs-staged", "theirs-unstaged"]) write(checkout, path, `${path} before`);
  git(checkout, "add", ".");
  git(checkout, "commit", "--quiet", "-m", "Start");
  write(checkout, "theirs-staged", "theirs-staged edited");
  git(checkout, "add", "theirs-staged");
  write(checkout, "theirs-unstaged", "theirs-unstaged edited");
  const start = git(checkout, "rev-parse", "main");
  return { root, checkout, start };
}

function withAWorktree() {
  const shared = sharedCheckout();
  const worktree = join(shared.root, "worktree");
  git(shared.checkout, "worktree", "add", "--quiet", "-b", "conversation", worktree);
  return { ...shared, worktree };
}

afterAll(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })));

describe.skipIf(process.platform === "win32")("scripts/land.sh", () => {
  test("from the shared main checkout it lands only the named paths and leaves the other session's edits as they were", () => {
    const { checkout } = sharedCheckout();
    write(checkout, "mine", "mine after");

    const landing = land(checkout, "-m", "Mine changes", "--", "mine");

    expect(landing.exitCode).toBe(0);
    expect(git(checkout, "log", "-1", "--format=%s", "main")).toBe("Mine changes");
    expect(fileOnMain(checkout, "mine")).toBe("mine after");
    expect(fileOnMain(checkout, "theirs-staged")).toBe("theirs-staged before");
    expect(git(checkout, "reflog", "-1", "--format=%gs", "main")).toBe("land: Mine changes");
    expect(statusOf(checkout)).toBe(ANOTHER_SESSIONS_EDITS);
  });

  test("a new file and a removed one land from the main checkout too", () => {
    const { checkout } = sharedCheckout();
    write(checkout, "added", "new");
    unlinkSync(join(checkout, "mine"));

    expect(land(checkout, "-m", "Add one, remove one", "--", "added", "mine").exitCode).toBe(0);

    expect(git(checkout, "ls-tree", "--name-only", "main")).toBe("added\ntheirs-staged\ntheirs-unstaged");
    expect(statusOf(checkout)).toBe(ANOTHER_SESSIONS_EDITS);
  });

  test("from a worktree it moves the main checkout's files along with main", () => {
    const { checkout, worktree } = withAWorktree();
    write(worktree, "mine", "mine from the worktree");

    const landing = land(worktree, "-m", "Mine changes in a worktree", "--", "mine");

    expect(landing.exitCode).toBe(0);
    expect(git(checkout, "rev-parse", "main")).toBe(git(worktree, "rev-parse", "HEAD"));
    expect(readFileSync(join(checkout, "mine"), "utf8")).toBe("mine from the worktree\n");
    expect(statusOf(checkout)).toBe(ANOTHER_SESSIONS_EDITS);
  });

  test("runs no commit hooks, from a worktree as from the main checkout", () => {
    const { root, checkout, worktree } = withAWorktree();
    const hooks = join(root, "hooks");
    mkdirSync(hooks);
    writeFileSync(join(hooks, "prepare-commit-msg"), '#!/bin/sh\necho "Added by a hook" >> "$1"\n');
    chmodSync(join(hooks, "prepare-commit-msg"), 0o755);
    git(checkout, "config", "core.hooksPath", hooks);
    const lastMessageOnMain = () => git(checkout, "log", "-1", "--format=%B", "main");

    write(worktree, "mine", "mine from the worktree");
    expect(land(worktree, "-m", "Mine changes in a worktree", "--", "mine").exitCode).toBe(0);
    expect(lastMessageOnMain()).toBe("Mine changes in a worktree");

    write(checkout, "mine", "mine from the main checkout");
    expect(land(checkout, "-m", "Mine changes in the main checkout", "--", "mine").exitCode).toBe(0);
    expect(lastMessageOnMain()).toBe("Mine changes in the main checkout");
  });

  test("a commit that changes a file the other session is editing in the main checkout does not land", () => {
    const { checkout, worktree, start } = withAWorktree();
    write(worktree, "theirs-unstaged", "the worktree's take");
    git(worktree, "commit", "--quiet", "-am", "Overlap");

    const landing = land(worktree);

    expect(landing.exitCode).not.toBe(0);
    expect(landing.output).toContain("nothing landed");
    expect(git(checkout, "rev-parse", "main")).toBe(start);
    expect(statusOf(checkout)).toBe(ANOTHER_SESSIONS_EDITS);
  });

  test("a worktree that main moved on from is told to rebase first", () => {
    const { checkout, worktree } = withAWorktree();
    write(checkout, "mine", "mine after");
    expect(land(checkout, "-m", "Mine changes", "--", "mine").exitCode).toBe(0);
    const landedFirst = git(checkout, "rev-parse", "main");
    write(worktree, "extra", "extra");
    git(worktree, "add", "extra");
    git(worktree, "commit", "--quiet", "-m", "Extra");

    const landing = land(worktree);

    expect(landing.exitCode).not.toBe(0);
    expect(landing.output).toContain("git rebase main");
    expect(git(checkout, "rev-parse", "main")).toBe(landedFirst);
  });

  test("a commit another session lands while this one is being made is kept, and this one does not land", () => {
    const { root, checkout } = sharedCheckout();
    write(checkout, "mine", "mine after");
    const gitThatLetsAnotherSessionLandFirst = join(root, "bin", "git");
    mkdirSync(dirname(gitThatLetsAnotherSessionLandFirst));
    writeFileSync(
      gitThatLetsAnotherSessionLandFirst,
      `#!/bin/sh
if [ "$1" = "commit-tree" ]; then
  made=$("$REAL_GIT" "$@") || exit 1
  theirs=$("$REAL_GIT" commit-tree "$("$REAL_GIT" rev-parse "main^{tree}")" -p main -m "Another session's commit")
  "$REAL_GIT" update-ref refs/heads/main "$theirs"
  echo "$made"
  exit 0
fi
exec "$REAL_GIT" "$@"
`,
    );
    chmodSync(gitThatLetsAnotherSessionLandFirst, 0o755);

    const landing = run(checkout, [LAND_SCRIPT, "-m", "Mine changes", "--", "mine"], {
      PATH: `${dirname(gitThatLetsAnotherSessionLandFirst)}:${process.env.PATH}`,
      REAL_GIT: Bun.which("git")!,
    });

    expect(landing.exitCode).not.toBe(0);
    expect(landing.output).toContain("main moved");
    expect(git(checkout, "log", "-1", "--format=%s", "main")).toBe("Another session's commit");
    expect(statusOf(checkout)).toBe(` M mine\n${ANOTHER_SESSIONS_EDITS}`);
  });

  test("a GIT_INDEX_FILE left set is refused before anything happens", () => {
    const { root, checkout, start } = sharedCheckout();
    write(checkout, "mine", "mine after");
    const strayIndex = join(root, "stray-index");

    const landing = run(checkout, [LAND_SCRIPT, "-m", "Mine changes", "--", "mine"], { GIT_INDEX_FILE: strayIndex });

    expect(landing.exitCode).not.toBe(0);
    expect(landing.output).toContain("GIT_INDEX_FILE is set");
    expect(git(checkout, "rev-parse", "main")).toBe(start);
    expect(existsSync(strayIndex)).toBe(false);
  });
});
