import type { MadeCommit } from "../shared/changes.ts";
import { HostProblemError } from "../shared/host-problems.ts";
import { environmentWithoutPrompts } from "./git-environment.ts";

async function git(directory: string, args: string[], input = "") {
  const child = Bun.spawn(["git", "-C", directory, ...args], {
    env: { ...environmentWithoutPrompts(), GIT_LITERAL_PATHSPECS: "1" },
    stdin: new Blob([input]),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { stdout, output: stderr.trim() || stdout.trim(), exitCode };
}

async function mustGit(directory: string, args: string[], input?: string) {
  const result = await git(directory, args, input);
  if (result.exitCode !== 0) throw new HostProblemError({ code: "git-failed", command: args[0]!, directory, output: result.output });
  return result.stdout;
}

const untrackedAmong = async (directory: string, paths: string[]) =>
  (await mustGit(directory, ["ls-files", "--others", "-z", "--", ...paths])).split("\0").filter(Boolean);

/**
 * Commits these files as they are in the folder, and nothing else: `git commit --only` takes each path's working-tree
 * content and leaves what the user or another conversation staged for other paths as it was. git commits only paths
 * its index knows, so an untracked file is first marked as one to add, a mark taken back if the commit fails. The
 * commit is the user's own: their identity, signing and hooks apply.
 */
export async function commitFiles(directory: string, paths: string[], message: string): Promise<MadeCommit> {
  const untracked = await untrackedAmong(directory, paths);
  if (untracked.length > 0) await mustGit(directory, ["add", "--intent-to-add", "--", ...untracked]);
  const committed = await git(directory, ["commit", "--quiet", "--only", "--file=-", "--", ...paths], message);
  if (committed.exitCode !== 0) {
    if (untracked.length > 0) await git(directory, ["reset", "--quiet", "--", ...untracked]);
    throw new HostProblemError({ code: "git-failed", command: "commit", directory, output: committed.output });
  }
  const [revision = "", subject = ""] = (await mustGit(directory, ["log", "-1", "--format=%h%x00%s"])).trimEnd().split("\0");
  return { revision, subject };
}
