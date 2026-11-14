import { existsSync, watch, type FSWatcher } from "node:fs";
import { posix, resolve } from "node:path";
import type { AppGitRefs } from "../../shared/apps.ts";
import { environmentWithoutPrompts } from "../git-environment.ts";
import { toPosix } from "../paths.ts";
import { AppProblem } from "./plugins.ts";

/**
 * A git ref a view may name: a branch, a tag (v1.0.0+build.5 too), a SHA, or forms like HEAD~1 and v1^{commit}; never a
 * path (":"), a space or a control character, which would end the line git reads it from. A leading "-" is refused
 * where it is checked, and git is told where its options end.
 */
const VIEWABLE_REF = /^[^\s:\\\x00-\x1f\x7f]+$/;

/** The files at the top of a git folder that move when HEAD or a packed branch or tag does; refs/heads, refs/tags and a reftable are watched on their own. */
const isRefFile = (name: string) => name === "HEAD" || name === "packed-refs";

/** How long a git folder has to stay still after HEAD or a ref moved before the views hear of it: a commit writes several files. */
const GIT_SETTLE_MS = 300;

/** Why a view's request about git can't be answered: a bad ref or path is the view's mistake, as a status says. */
export class WorkspaceGitRefused extends AppProblem {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Read-only git in the workspace: no optional locks, so it never rewrites the user's index, and no prompt nobody would answer. */
const spawnGit = (directory: string, args: string[], input = "") =>
  Bun.spawn(["git", "--no-optional-locks", "-C", directory, ...args], { env: environmentWithoutPrompts(), stdin: new Blob([input]), stdout: "pipe", stderr: "pipe" });

async function git(directory: string, args: string[], input = "") {
  const child = spawnGit(directory, args, input);
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).arrayBuffer(), new Response(child.stderr).text(), child.exited]);
  return { bytes: stdout, stdout: new TextDecoder().decode(stdout), stderr: stderr.trim(), exitCode };
}

/** git's output, or null once it grows past `maxBytes`, when git is stopped: a filter, as LFS's, can give far more than git stores. */
async function gitUpTo(directory: string, args: string[], maxBytes: number) {
  const child = spawnGit(directory, args);
  const stderr = new Response(child.stderr).text();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of child.stdout) {
    size += chunk.byteLength;
    if (size > maxBytes) {
      child.kill();
      return null;
    }
    chunks.push(chunk);
  }
  return { bytes: Bun.concatArrayBuffers(chunks), stderr: (await stderr).trim(), exitCode: await child.exited };
}

function refuseUnviewableRef(ref: unknown): asserts ref is string {
  if (typeof ref !== "string" || ref === "" || ref.startsWith("-") || !VIEWABLE_REF.test(ref)) throw new WorkspaceGitRefused(400, `${String(ref)} isn't a git ref a view may name.`);
}

/** A path of the workspace, named from it with /, that stays inside it and out of its .git folder. */
function workspacePathOf(path: unknown): string {
  if (typeof path !== "string" || path === "" || /[\0\n]/.test(path)) throw new WorkspaceGitRefused(400, "Give the file's path relative to the workspace.");
  const normal = posix.normalize(toPosix(path));
  if (posix.isAbsolute(normal) || /^[A-Za-z]:/.test(normal) || normal === ".." || normal.startsWith("../")) throw new WorkspaceGitRefused(403, `${path} is outside the workspace.`);
  if (normal.split("/").includes(".git")) throw new WorkspaceGitRefused(403, `${path} is in the repository's .git folder.`);
  return normal;
}

/** The commit a ref names in the workspace's repository, or why there is none. */
async function commitOf(workspacePath: string, ref: string): Promise<string> {
  const resolved = await git(workspacePath, ["rev-parse", "--verify", "--quiet", "--end-of-options", `${ref}^{commit}`]);
  if (resolved.exitCode !== 0) throw new WorkspaceGitRefused(404, `${ref} isn't a commit of the workspace's repository.`);
  return resolved.stdout.trim();
}

/** HEAD's commit and the tags, newest first; null when the workspace isn't in a git repository. */
export async function workspaceGitRefs(workspacePath: string): Promise<AppGitRefs | null> {
  const inside = await git(workspacePath, ["rev-parse", "--is-inside-work-tree"]);
  if (inside.exitCode !== 0 || inside.stdout.trim() !== "true") return null;
  const head = await git(workspacePath, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]);
  const format = "%(refname:short)%09%(*objectname)%09%(*objecttype)%09%(objectname)%09%(objecttype)%09%(creatordate:iso-strict)";
  const listed = await git(workspacePath, ["for-each-ref", "--sort=-creatordate", `--format=${format}`, "refs/tags"]);
  if (listed.exitCode !== 0) throw new AppProblem(listed.stderr || "git couldn't list the tags.");
  // A tag of a tree names no commit to compare with, so it is left out.
  const tags = listed.stdout
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      const [name = "", peeled = "", peeledType = "", object = "", objectType = "", date = ""] = line.split("\t");
      return (peeled ? peeledType : objectType) === "commit" ? [{ name, commit: peeled || object, date }] : [];
    });
  return { head: head.exitCode === 0 ? head.stdout.trim() || null : null, tags };
}

/**
 * A file of the workspace, named from it, as it is at a ref: its bytes, or null when the file isn't there at that ref.
 * A workspace in a subfolder of its repository names its files from that subfolder, as git does from there.
 */
export async function workspaceFileAt(workspacePath: string, ref: unknown, path: unknown, maxBytes: number): Promise<ArrayBuffer | null> {
  refuseUnviewableRef(ref);
  const file = workspacePathOf(path);
  // One git asks after the commit and the file both: "<sha> <type> <size>", or "<name> missing".
  const checked = await git(workspacePath, ["cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)"], `${ref}^{commit}\n${ref}^{commit}:./${file}\n`);
  if (checked.exitCode !== 0) throw new AppProblem(checked.stderr || `git couldn't read ${file} at ${ref}.`);
  const [commit = "", object = ""] = checked.stdout.split("\n");
  if (!/ commit \d+$/.test(commit)) throw new WorkspaceGitRefused(404, `${ref} isn't a commit of the workspace's repository.`);
  if (/ missing$/.test(object)) return null;
  const [, kind = "", size = ""] = object.split(" ");
  if (kind !== "blob") throw new WorkspaceGitRefused(400, `${file} isn't a file at ${ref}.`);
  const tooLarge = () => new WorkspaceGitRefused(413, `${file} is larger than ${maxBytes / 1024 / 1024} MB at ${ref}.`);
  if (Number(size) > maxBytes) throw tooLarge();
  // As checked out: with the line ends, smudge filters and LFS files the working tree has, which `git diff` compares too.
  const content = await gitUpTo(workspacePath, ["cat-file", "--filters", `${commit.split(" ")[0]}:./${file}`], maxBytes);
  if (content === null) throw tooLarge();
  if (content.exitCode !== 0) throw new AppProblem(content.stderr || `git couldn't read ${file} at ${ref}.`);
  return content.bytes;
}

/** The workspace's files, named from it, that differ from a ref on disk: changed, added, and untracked but not ignored. Files deleted since aren't listed. */
export async function workspaceChangedSince(workspacePath: string, ref: unknown): Promise<string[]> {
  refuseUnviewableRef(ref);
  const commit = await commitOf(workspacePath, ref);
  const diff = await git(workspacePath, ["diff", "--name-only", "-z", "--relative", "--no-ext-diff", "--no-textconv", "--diff-filter=d", "--end-of-options", commit, "--"]);
  if (diff.exitCode !== 0) throw new AppProblem(diff.stderr || `git couldn't compare the workspace with ${ref}.`);
  const others = await git(workspacePath, ["ls-files", "--others", "--exclude-standard", "-z"]);
  if (others.exitCode !== 0) throw new AppProblem(others.stderr || "git couldn't list the untracked files.");
  // An untracked repository inside the workspace is listed as its folder, which is no file.
  return [...new Set([...diff.stdout.split("\0"), ...others.stdout.split("\0")])].filter((name) => name !== "" && !name.endsWith("/"));
}

/**
 * Watches the git folders a workspace's HEAD and tags live in, its own and, in a linked worktree, the common one, and
 * calls `changed` once they settle after a move. `ready` resolves once the watch is armed: true, or false outside a
 * repository, where it watches nothing. Stops when `stop` is called.
 */
export function watchWorkspaceGit(workspacePath: string, changed: () => void): { ready: Promise<boolean>; stop(): void } {
  const watchers: FSWatcher[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const settle = () => {
    clearTimeout(timer);
    timer = setTimeout(changed, GIT_SETTLE_MS);
  };
  const watchIfThere = (folder: string, recursive: boolean, counts: (name: string) => boolean) => {
    if (!existsSync(folder)) return;
    try {
      watchers.push(
        watch(folder, { recursive }, (_event, name) => {
          if (name === null || counts(toPosix(name.toString()))) settle();
        }),
      );
    } catch (error) {
      console.warn(`Couldn't watch ${folder} for moves of HEAD and the tags: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const ready = (async () => {
    // git that can't start, as when it is missing, counts as no repository, to be tried again at the next ask.
    const found = await git(workspacePath, ["rev-parse", "--absolute-git-dir", "--git-common-dir"]).catch(() => null);
    if (stopped || found === null || found.exitCode !== 0) return false;
    const [own = "", common = ""] = found.stdout.split("\n").map((line) => line.trim());
    for (const folder of new Set([own, resolve(workspacePath, common)].filter(Boolean))) {
      watchIfThere(folder, false, isRefFile);
      // Branches and tags; not remotes, which a fetch moves, nor other refs tools keep. A reftable holds them all in
      // one, so there a fetch counts too.
      watchIfThere(`${folder}/refs/heads`, true, () => true);
      watchIfThere(`${folder}/refs/tags`, true, () => true);
      watchIfThere(`${folder}/reftable`, false, () => true);
    }
    return true;
  })();
  return {
    ready,
    stop() {
      stopped = true;
      clearTimeout(timer);
      for (const watcher of watchers) watcher.close();
    },
  };
}
