import { existsSync } from "node:fs";
import { join } from "node:path";
import { isNewerVersion, releasePage, type NewerVersion } from "../shared/newer-version.ts";
import { MIRADOR_VERSION } from "../shared/version.ts";
import { environmentWithoutPrompts } from "./git-environment.ts";
import { Lookout } from "./lookout.ts";
import { HostProblemError } from "../shared/host-problems.ts";

const GIVE_UP_AFTER_MILLISECONDS = 60_000;

async function git(directory: string, args: string[]) {
  const child = Bun.spawn(["git", "-C", directory, ...args], {
    env: environmentWithoutPrompts(),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
    timeout: GIVE_UP_AFTER_MILLISECONDS,
  });
  const [output, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  if (exitCode !== 0) throw new HostProblemError({ code: "newer-version-git-failed", command: args[0]!, exitCode });
  return output.trim();
}

/** Fetches only the branch the checkout follows, so refs that other tools keep on the same remote stay as they are. */
export async function newerCommits(checkout: string, fetching: boolean): Promise<NewerVersion | null> {
  const branch = await git(checkout, ["symbolic-ref", "--quiet", "HEAD"]);
  const [remote, remoteBranch, upstream] = (await git(checkout, ["for-each-ref", "--format=%(upstream:remotename)%09%(upstream:remoteref)%09%(upstream:short)", branch])).split("\t");
  if (!remote || !remoteBranch || !upstream) return null;
  if (fetching)
    await git(checkout, ["fetch", "--quiet", "--no-tags", remote, remoteBranch]).catch(() => {
      throw new HostProblemError({ code: "newer-version-fetch-failed", upstream });
    });
  const commits = Number(await git(checkout, ["rev-list", "--count", "HEAD..@{upstream}"]));
  if (commits === 0) return null;
  return { kind: "checkout", commits, upstream, upstreamCommit: await git(checkout, ["rev-parse", "@{upstream}"]) };
}

/** Pulls the checkout's upstream into it, fast-forward only, so its own commits and uncommitted work are never rewritten; git's own error shows when it can't. */
export async function pullCheckout(checkout: string): Promise<string | null> {
  const child = Bun.spawn(["git", "-C", checkout, "pull", "--ff-only", "--quiet"], {
    env: environmentWithoutPrompts(),
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe",
    timeout: GIVE_UP_AFTER_MILLISECONDS,
  });
  const [stderr, exitCode] = await Promise.all([new Response(child.stderr).text(), child.exited]);
  return exitCode === 0 ? null : stderr.trim() || "git pull failed";
}

/** GitHub answers 404 while the repository is private or nothing is published yet, which leaves nothing to show. */
export async function newerRelease(latestReleaseUrl: string, current = MIRADOR_VERSION): Promise<NewerVersion | null> {
  const response = await fetch(latestReleaseUrl, { headers: { Accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(GIVE_UP_AFTER_MILLISECONDS) }).catch(() => {
    throw new HostProblemError({ code: "newer-version-github-unreachable" });
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new HostProblemError({ code: "newer-version-github-answered", status: response.status });
  const { tag_name: tag } = (await response.json()) as { tag_name?: unknown };
  if (typeof tag !== "string") return null;
  const version = tag.replace(/^v/, "");
  return isNewerVersion(version, current) ? { kind: "release", version, url: releasePage(tag) } : null;
}

/** A host with `.git` in its own source directory runs from a checkout; a release's copy of the source has none. */
export const newerVersionLookup = (sourceDir: string, latestReleaseUrl: string) =>
  existsSync(join(sourceDir, ".git")) ? (fetching: boolean) => newerCommits(sourceDir, fetching) : () => newerRelease(latestReleaseUrl);

export class NewerVersionWatcher extends Lookout<NewerVersion> {}
