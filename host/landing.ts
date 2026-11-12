import { existsSync } from "node:fs";
import type { Landable, Landed } from "../shared/changes.ts";
import { HostProblemError } from "../shared/host-problems.ts";
import { git, mustGit } from "./git-command.ts";

const pathsIn = (nulSeparated: string) => nulSeparated.split("\0").filter(Boolean);

const topLevelOf = async (folder: string) => (await mustGit(folder, ["rev-parse", "--show-toplevel"])).trim();

async function checkedOutBranch(checkout: string) {
  const branch = await git(checkout, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  return branch.exitCode === 0 ? branch.stdout.trim() : null;
}

const commitOf = async (folder: string, revision: string) => (await mustGit(folder, ["rev-parse", "--verify", "--quiet", `${revision}^{commit}`])).trim();

const changedBetween = async (folder: string, from: string, to: string) => pathsIn(await mustGit(folder, ["diff", "--name-only", "--no-renames", "-z", from, to]));

/** Changed, staged or new files, as git status names them: two status letters and a space before each path. */
async function uncommittedPaths(folder: string) {
  const status = await mustGit(folder, ["status", "--porcelain", "-z", "--no-renames", "--untracked-files=all"]);
  return pathsIn(status).map((entry) => entry.slice(3));
}

const sharedPaths = (some: string[], others: string[]) => {
  const otherSet = new Set(others);
  return some.filter((path) => otherSet.has(path));
};

/** A rebase, merge or cherry-pick the agent left half done: its HEAD is no finished work to land, and our rebase's abort would throw it away. */
async function isMidOperation(worktree: string) {
  const markers = await Promise.all(["rebase-merge", "rebase-apply", "MERGE_HEAD", "CHERRY_PICK_HEAD"].map((name) => mustGit(worktree, ["rev-parse", "--path-format=absolute", "--git-path", name])));
  return markers.some((marker) => existsSync(marker.trim()));
}

/** How the worktree's commits stand against the branch the project folder has checked out. */
export async function landableOnto(projectFolder: string, worktree: string): Promise<Landable> {
  const branch = await checkedOutBranch(await topLevelOf(projectFolder));
  if (branch === null) return { branch, ahead: 0, behind: 0 };
  const [behind, ahead] = (await mustGit(worktree, ["rev-list", "--left-right", "--count", `refs/heads/${branch}...HEAD`])).trim().split(/\s+/).map(Number);
  return { branch, ahead: ahead ?? 0, behind: behind ?? 0 };
}

async function rebaseOnto(worktree: string, target: string, branch: string) {
  const rebased = await git(worktree, ["rebase", "--autostash", "--quiet", target]);
  if (rebased.exitCode === 0) return;
  const conflicted = pathsIn((await git(worktree, ["diff", "--name-only", "--diff-filter=U", "-z"])).stdout);
  await git(worktree, ["rebase", "--abort"]);
  throw new HostProblemError({ code: "landing-conflicts", branch, paths: conflicted });
}

/**
 * Brings the worktree's commits onto the branch the project folder has checked out, by a fast-forward of that folder, so
 * its branch, index and files move together. When the branch moved on meanwhile, the commits are rebased onto it first,
 * the worktree's uncommitted edits set aside and put back. Every refusal comes before anything changes.
 */
export async function landOnto(projectFolder: string, worktree: string, { mayRebase }: { mayRebase: boolean }): Promise<Landed> {
  const checkout = await topLevelOf(projectFolder);
  const branch = await checkedOutBranch(checkout);
  if (branch === null) throw new HostProblemError({ code: "landing-needs-branch", directory: checkout });
  if (await isMidOperation(worktree)) throw new HostProblemError({ code: "landing-worktree-mid-operation", directory: worktree });
  const [target, head] = await Promise.all([commitOf(checkout, `refs/heads/${branch}`), commitOf(worktree, "HEAD")]);
  const base = (await mustGit(worktree, ["merge-base", target, head])).trim();
  if (base === head) throw new HostProblemError({ code: "nothing-to-land", branch });
  const overlapping = sharedPaths(await changedBetween(worktree, base, head), await uncommittedPaths(checkout));
  if (overlapping.length > 0) throw new HostProblemError({ code: "landing-overlaps-uncommitted", branch, paths: overlapping });
  const rebased = base !== target;
  if (rebased) {
    if (!mayRebase) throw new HostProblemError({ code: "landing-rebase-while-working", branch });
    const clashing = sharedPaths(await changedBetween(worktree, base, target), await uncommittedPaths(worktree));
    if (clashing.length > 0) throw new HostProblemError({ code: "landing-worktree-edits-clash", branch, paths: clashing });
    await rebaseOnto(worktree, target, branch);
  }
  const landing = await commitOf(worktree, "HEAD");
  await mustGit(checkout, ["merge", "--ff-only", "--quiet", landing]);
  const subjects = (await mustGit(checkout, ["log", "--format=%s", "--reverse", `${target}..${landing}`])).split("\n").filter(Boolean);
  const revision = (await mustGit(checkout, ["rev-parse", "--short", landing])).trim();
  return { branch, revision, subjects, rebased };
}
