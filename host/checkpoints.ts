import { copyFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import type { CommittedFiles, ListedPaths, RestoreFiles, RestorePlan, Workspace } from "../shared/model.ts";
import { CheckpointGit, changesIn, NO_FILE_MODE, type Location } from "./checkpoints/git.ts";
import { OwnBytesStaging, type Staged } from "./checkpoints/own-bytes.ts";
import { PutBack, type PutBackPlan } from "./checkpoints/put-back.ts";
import { treeChangesIn, type TreeChange } from "./working-tree.ts";
import { HostProblemError } from "../shared/host-problems.ts";

/** Where snapshots hung, one after another, before each got a ref of its own. */
const chainRefOf = (workspaceId: string) => `refs/mirador/${workspaceId}`;
const snapshotRefsOf = (workspaceId: string) => `refs/mirador/turns/${workspaceId}/`;
/** Named by when it was taken, so the names sort oldest first; the chain from before sorts ahead of every snapshot. */
const snapshotRefOf = (workspaceId: string, commit: string, takenAt: number) => `${snapshotRefsOf(workspaceId)}${String(takenAt).padStart(16, "0")}-${commit}`;

export const SNAPSHOTS_KEPT = 100;
/** How many paths of each kind a preview names: one pull can change thousands. */
export const PATHS_LISTED = 200;
/** How many commit messages stay remembered; one forgotten is read from git again. */
const MESSAGES_REMEMBERED = 1000;
/** rev-parse's exit code when it found the repository but `--verify --quiet HEAD` found no commit, as before the first. */
const NO_COMMIT_YET = 1;

const SNAPSHOT_MESSAGE = "mirador: the files at the start of a turn";
/** Marks a snapshot that holds each file's own bytes: one without it holds them as git's attributes converted them. */
const OWN_BYTES_NOTE = "Each file is kept as its own bytes, but those a filter cleans, which are kept as git stores them.";
const CLEANED_PREFIX = "Cleaned by a filter: ";
const HEAD_PREFIX = "HEAD ";
const UNBORN = "unborn";
const headLineOf = (head: string) => `${HEAD_PREFIX}${head || UNBORN}`;
/** Names the HEAD the snapshot was taken on, so a restore can leave alone what commits changed since. */
const snapshotMessageOf = (cleaned: string[], head: string) =>
  [SNAPSHOT_MESSAGE, "", OWN_BYTES_NOTE, ...(cleaned.length > 0 ? [`${CLEANED_PREFIX}${JSON.stringify(cleaned)}`] : []), headLineOf(head)].join("\n");
const STAGING_MESSAGE = "mirador: the staged files at the start of a turn";
/** Names the HEAD the staging was taken on: staging put back onto another HEAD would stage a revert of what was committed since. */
const stagingMessageOn = (head: string) => `${STAGING_MESSAGE}\n\n${headLineOf(head)}`;
/** The HEAD a message names, "" for none yet, or null when it names none. */
function headNamedIn(message: string | null) {
  const line = message?.split("\n").find((each) => each.startsWith(HEAD_PREFIX));
  if (line === undefined) return null;
  const head = line.slice(HEAD_PREFIX.length);
  return head === UNBORN ? "" : head;
}

/** What commits changed since a snapshot: the paths, and how many commits, unless HEAD went somewhere not ahead of where it was. */
type CommittedSince = { paths: Set<string>; commits: number | null };
type RestoreDiff = PutBackPlan & { restored: number; removed: number; written: string[]; putBack: string[]; committedPaths: string[]; submodulesLeft: number; committed?: CommittedFiles };

const planOf = ({ restored, removed, submodulesLeft, committed }: RestoreDiff): RestorePlan => ({ restored, removed, ...(submodulesLeft > 0 && { submodulesLeft }), ...(committed && { committed }) });
const listed = (paths: string[]): ListedPaths => ({ paths: paths.slice(0, PATHS_LISTED), more: Math.max(0, paths.length - PATHS_LISTED) });
const filesOf = ({ added, putBack, committedPaths }: RestoreDiff): RestoreFiles => ({ deleted: listed(added), putBack: listed(putBack), committed: listed(committedPaths) });

/**
 * The files of a workspace, kept per turn so a turn can be undone.
 *
 * The workspace's own repository does the storing, through indexes of our own (`GIT_INDEX_FILE`), so nothing of the
 * user's branch, HEAD or reflog is touched: a snapshot writes the file contents it does not already have as objects,
 * plus one commit with a ref of its own under `refs/mirador/turns/<workspace>/`, whose parent holds what the user had
 * staged. Only the newest `keep` refs stay; git's own gc drops what the others alone held. Restoring writes the working
 * tree and puts back the staging of the files it writes, so a file the agent staged is not left queued for the user's
 * next commit. A submodule's own files are its repository's, so a restore leaves a submodule as it is and says so.
 *
 * A snapshot holds each file's own bytes, which OwnBytesStaging keeps beside our staging index, and a file a filter
 * cleans in the filter's form. Snapshots taken before hold the files as git's attributes converted them, and a restore
 * of one writes the files it puts back the way git checks them out.
 *
 * A workspace that is not a git repository has no snapshots, and so no undo.
 */
export class Checkpoints {
  private readonly queues = new Map<string, Promise<unknown>>();
  /** By revision, a snapshot's commit or `<commit>^` for its parent: a commit never changes. */
  private readonly messages = new Map<string, string>();
  /** The chain refs looked for, by repository: only a Mirador from before snapshots had refs of their own made one. */
  private readonly chainsLookedFor = new Set<string>();
  private readonly git: CheckpointGit;
  private readonly ownBytesStaging: OwnBytesStaging;
  private readonly putBack: PutBack;

  constructor(
    dataDir: string,
    private readonly keep = SNAPSHOTS_KEPT,
  ) {
    this.git = new CheckpointGit(dataDir);
    this.ownBytesStaging = new OwnBytesStaging(this.git);
    this.putBack = new PutBack(this.git);
  }

  /** The workspace's files as they are now, or null when it is not a git repository. */
  snapshot(workspace: Workspace): Promise<string | null> {
    return this.inOrder(workspace.id, async () => {
      const location = await this.locate(workspace);
      if (!location) return null;
      const { ownBytes, cleaned } = await this.ownBytesStaging.stageEverything(workspace, location);
      const staging = await this.commitOfStaging(workspace, location);
      const message = snapshotMessageOf(cleaned, location.head);
      const commit = (await this.git.mustRun(workspace, ["commit-tree", ownBytes, ...(staging ? ["-p", staging] : []), "-F", "-"], { input: message })).stdout;
      this.remember(commit, message);
      if (staging) this.remember(`${commit}^`, stagingMessageOn(location.head));
      await this.git.mustRun(workspace, ["update-ref", snapshotRefOf(workspace.id, commit, Date.now()), commit]);
      await this.moveChainToItsOwnRef(workspace, location);
      await this.dropAllButNewest(workspace);
      return commit;
    });
  }

  /** Whether the snapshot's files are still in the repository: once its ref is dropped, git's gc may take them. */
  keeps(workspace: Workspace, commit: string): Promise<boolean> {
    return this.inOrder(workspace.id, async () => (await this.git.run(workspace, ["cat-file", "-e", `${commit}^{tree}`])).exitCode === 0);
  }

  /**
   * The workspace's files that differ from the snapshot `commit`, staged into our index as the snapshot was, so a file
   * .gitignore hides counts on neither side, and the paths commits since the snapshot changed; null when the workspace
   * is not a git repository.
   */
  changesSince(workspace: Workspace, commit: string): Promise<{ changes: TreeChange[]; committedPaths: Set<string> } | null> {
    return this.inOrder(workspace.id, async () => {
      const location = await this.locate(workspace);
      if (!location) return null;
      const keptAs = await this.keptAs(workspace, commit);
      const now = this.treeLike(keptAs, await this.ownBytesStaging.stageEverything(workspace, location));
      const diff = async (format: string) => (await this.git.mustRun(workspace, ["diff-tree", "-r", "-z", "--relative", "--no-renames", format, commit, now])).stdout;
      const changes = treeChangesIn(await diff("--raw"), await diff("--numstat"));
      return { changes, committedPaths: (await this.committedSince(workspace, location, commit))?.paths ?? new Set<string>() };
    });
  }

  /**
   * What restoring `commit` would do, and to which files, without touching one; null when the workspace is not a git
   * repository.
   */
  preview(workspace: Workspace, commit: string): Promise<{ plan: RestorePlan; files: RestoreFiles } | null> {
    return this.inOrder(workspace.id, async () => {
      const location = await this.locate(workspace);
      if (!location) return null;
      const diff = await this.diffToNow(workspace, location, commit, await this.keptAs(workspace, commit));
      return { plan: planOf(diff), files: filesOf(diff) };
    });
  }

  /** Puts the workspace's files back as they were when `commit` was taken, deleting what came after it. */
  restore(workspace: Workspace, commit: string): Promise<RestorePlan> {
    return this.inOrder(workspace.id, async () => {
      const location = await this.locate(workspace);
      if (!location) throw new HostProblemError({ code: "not-in-git-repository", directory: workspace.path });
      const keptAs = await this.keptAs(workspace, commit);
      const plan = await this.diffToNow(workspace, location, commit, keptAs);
      if (keptAs.ownBytes) await this.putBack.ownBytes(workspace, location, plan, keptAs.cleaned);
      else await this.putBack.asGitChecksOut(workspace, commit, plan);
      await this.restoreStaging(workspace, location, commit, plan.written);
      return planOf(plan);
    });
  }

  /** Whether the snapshot holds the files' own bytes, and which of them, by their path from the repository's top, a filter cleaned. */
  private async keptAs(workspace: Workspace, commit: string) {
    const lines = ((await this.messageOf(workspace, commit)) ?? "").split("\n");
    const cleanedLine = lines.find((line) => line.startsWith(CLEANED_PREFIX));
    return { ownBytes: lines.includes(OWN_BYTES_NOTE), cleaned: new Set<string>(cleanedLine ? JSON.parse(cleanedLine.slice(CLEANED_PREFIX.length)) : []) };
  }

  /** The commit's message, or null when there is no such commit. */
  private async messageOf(workspace: Workspace, revision: string) {
    const remembered = this.messages.get(revision);
    if (remembered !== undefined) return remembered;
    const shown = await this.git.run(workspace, ["show", "-s", "--format=%B", revision]);
    if (shown.exitCode !== 0) return null;
    this.remember(revision, shown.stdout);
    return shown.stdout;
  }

  private remember(revision: string, message: string) {
    this.messages.set(revision, message);
    if (this.messages.size <= MESSAGES_REMEMBERED) return;
    const oldest = this.messages.keys().next().value;
    if (oldest !== undefined) this.messages.delete(oldest);
  }

  private treeLike(keptAs: { ownBytes: boolean }, staged: Staged) {
    return keptAs.ownBytes ? staged.ownBytes : staged.converted;
  }

  /** The chain the snapshots made before each got a ref: its newest snapshot holds the rest, and ages out like any. */
  private async moveChainToItsOwnRef(workspace: Workspace, { atTop }: Location) {
    const lookedFor = `${atTop.path}\0${chainRefOf(workspace.id)}`;
    if (this.chainsLookedFor.has(lookedFor)) return;
    const chain = await this.git.run(workspace, ["rev-parse", "--verify", "--quiet", chainRefOf(workspace.id)]);
    if (chain.exitCode === 0) {
      await this.git.mustRun(workspace, ["update-ref", snapshotRefOf(workspace.id, chain.stdout, 0), chain.stdout]);
      await this.git.mustRun(workspace, ["update-ref", "-d", chainRefOf(workspace.id)]);
    }
    this.chainsLookedFor.add(lookedFor);
  }

  /**
   * Drops what was kept for a folder that is gone, such as a conversation's worktree: its snapshots, which `repository`
   * still holds, and our index files for it.
   */
  forget(gone: Workspace, repository: Workspace) {
    return this.inOrder(gone.id, async () => {
      const refs = await this.git.run(repository, ["for-each-ref", "--format=%(refname)", snapshotRefsOf(gone.id)]);
      const kept = refs.stdout.split("\n").filter(Boolean);
      if (kept.length > 0) await this.git.run(repository, ["update-ref", "--stdin"], { input: kept.map((ref) => `delete ${ref}\n`).join("") });
      await this.git.deleteFilesOf(gone);
    });
  }

  private async dropAllButNewest(workspace: Workspace) {
    const refs = await this.git.mustRun(workspace, ["for-each-ref", "--sort=-refname", "--format=%(refname)", snapshotRefsOf(workspace.id)]);
    const dropped = refs.stdout.split("\n").filter(Boolean).slice(this.keep);
    if (dropped.length > 0) await this.git.mustRun(workspace, ["update-ref", "--stdin"], { input: dropped.map((ref) => `delete ${ref}\n`).join("") });
  }

  /** A snapshot of one workspace at a time: git's own index lock is per file, and the file is ours. */
  private inOrder<T>(workspaceId: string, work: () => Promise<T>): Promise<T> {
    const next = (this.queues.get(workspaceId) ?? Promise.resolve()).then(work, work);
    this.queues.set(
      workspaceId,
      next.catch(() => {}),
    );
    return next;
  }

  /**
   * What a restore would change: what to put back or rewrite, what to delete, the paths to delete, every path it writes or
   * deletes, the snapshot's entries for the paths it writes, the submodules it leaves, and the files it leaves because
   * commits since changed them.
   */
  private async diffToNow(workspace: Workspace, location: Location, commit: string, keptAs: { ownBytes: boolean }): Promise<RestoreDiff> {
    const staged = await this.ownBytesStaging.stageEverything(workspace, location);
    const diff = await this.git.run(workspace, ["diff-tree", "-r", "-z", "--raw", "--relative", "--no-renames", commit, this.treeLike(keptAs, staged)]);
    const changes = changesIn(diff.stdout);
    const differing = changes.filter(({ submodule }) => !submodule);
    const committedSince = await this.committedSince(workspace, location, commit);
    const committedPaths = differing.filter(({ path }) => committedSince?.paths.has(path)).map(({ path }) => path);
    const files = differing.filter(({ path }) => !committedSince?.paths.has(path));
    const added = files.filter(({ status }) => status === "A").map(({ path }) => path);
    const written = files.map(({ path }) => path);
    const putBack = files.filter(({ status }) => status !== "A").map(({ path }) => path);
    const kept = files.filter(({ fromMode }) => fromMode !== NO_FILE_MODE).map(({ fromMode, fromBlob, path }) => ({ mode: fromMode, blob: fromBlob, path }));
    const committed =
      committedSince && committedPaths.length > 0
        ? { files: committedPaths.length, editedSince: await this.editedSinceHead(workspace, location, staged.converted, committedPaths), commits: committedSince.commits }
        : undefined;
    return { restored: putBack.length, removed: added.length, added, written, putBack, committedPaths, kept, submodulesLeft: changes.length - differing.length, ...(committed && { committed }) };
  }

  /**
   * What commits changed since the snapshot was taken; null when HEAD is where it was, or when the snapshot does not
   * name its HEAD or that commit is gone, which leaves a restore putting every file back.
   */
  private async committedSince(workspace: Workspace, { head }: Location, commit: string): Promise<CommittedSince | null> {
    const then = await this.headAt(workspace, commit);
    if (then === null || then === head) return null;
    if (then && (await this.git.run(workspace, ["cat-file", "-e", `${then}^{commit}`])).exitCode !== 0) return null;
    const changed = await this.git.mustRun(workspace, ["diff-tree", "-r", "-z", "--name-only", "--relative", "--no-renames", await this.treeOf(workspace, then), await this.treeOf(workspace, head)]);
    return { paths: new Set(changed.stdout.split("\0").filter(Boolean)), commits: await this.commitsFrom(workspace, then, head) };
  }

  /**
   * The HEAD the snapshot was taken on, "" before the first commit. A snapshot names it; one from before that, through
   * its staging; null for one older still.
   */
  private async headAt(workspace: Workspace, commit: string) {
    const named = headNamedIn(await this.messageOf(workspace, commit));
    if (named !== null) return named;
    const staging = await this.messageOf(workspace, `${commit}^`);
    return staging?.startsWith(STAGING_MESSAGE) ? headNamedIn(staging) : null;
  }

  /** How many commits HEAD moved ahead by, from `then` to `now`; null when `now` is not ahead of `then`. */
  private async commitsFrom(workspace: Workspace, then: string, now: string) {
    if (!now) return null;
    if (then && (await this.git.run(workspace, ["merge-base", "--is-ancestor", then, now])).exitCode !== 0) return null;
    return Number((await this.git.mustRun(workspace, ["rev-list", "--count", then ? `${then}..${now}` : now])).stdout);
  }

  /**
   * How many of `paths` the files now hold otherwise than HEAD does. The user's git compares them, with the line endings
   * their core.autocrlf converts, which our staging keeps as they are; a file HEAD doesn't have is told by our staging,
   * which holds untracked files too.
   */
  private async editedSinceHead(workspace: Workspace, { head, usersIndex }: Location, converted: string, paths: string[]) {
    const headTree = await this.treeOf(workspace, head);
    const [changed, added] = await Promise.all([
      this.git.mustRun(workspace, ["diff", "--name-only", "-z", "--relative", "--no-renames", headTree], { index: usersIndex }),
      this.git.mustRun(workspace, ["diff-tree", "-r", "-z", "--name-only", "--relative", "--no-renames", "--diff-filter=A", headTree, converted]),
    ]);
    const edited = new Set([...changed.stdout.split("\0"), ...added.stdout.split("\0")]);
    return paths.filter((path) => edited.has(path)).length;
  }

  /** The commit itself, or the empty tree for none yet. */
  private async treeOf(workspace: Workspace, commit: string) {
    return commit || (await this.git.mustRun(workspace, ["hash-object", "-t", "tree", "--stdin"], { input: "" })).stdout;
  }

  /**
   * What the user has staged, as a commit of its own, written from a copy of their index so theirs is never locked; null
   * when git cannot write it, as during a merge conflict.
   */
  private async commitOfStaging(workspace: Workspace, { usersIndex, head }: Location) {
    const copy = this.git.fileOf(workspace, ".staging.index");
    try {
      if (!(await copyFile(usersIndex, copy).then(() => true, () => false))) return null;
      const tree = await this.git.run(workspace, ["write-tree"], { index: copy });
      if (tree.exitCode !== 0) return null;
      return (await this.git.mustRun(workspace, ["commit-tree", tree.stdout, "-m", stagingMessageOn(head)])).stdout;
    } finally {
      await rm(copy, { force: true });
    }
  }

  /**
   * Puts the user's staging of the files a restore wrote back as the snapshot kept it. A snapshot that kept none, being
   * older or taken during a merge conflict, or one taken on a HEAD that has since moved, unstages those whose staged
   * version is not the restored file instead.
   */
  private async restoreStaging(workspace: Workspace, location: Location, commit: string, written: string[]) {
    const { usersIndex } = location;
    const keptStaging = await this.keepsStagingOnHead(workspace, location, commit);
    const unstaged = keptStaging ? written : await this.stagedOtherwise(workspace, usersIndex, written);
    if (unstaged.length === 0) return;
    const resetTo = keptStaging ? [`${commit}^`] : [];
    await this.git.mustRun(workspace, ["reset", "-q", "--pathspec-from-file=-", "--pathspec-file-nul", ...resetTo], { input: unstaged.map((path) => `${path}\0`).join(""), index: usersIndex });
  }

  /** An older snapshot's parent, if it has one, is the snapshot before it rather than any staging. */
  private async keepsStagingOnHead(workspace: Workspace, { head }: Location, commit: string) {
    return (await this.messageOf(workspace, `${commit}^`)) === stagingMessageOn(head);
  }

  private async stagedOtherwise(workspace: Workspace, index: string, paths: string[]) {
    const differing = new Set((await this.git.mustRun(workspace, ["diff", "--name-only", "-z", "--relative"], { index })).stdout.split("\0"));
    return paths.filter((path) => differing.has(path));
  }

  /**
   * Where the workspace's repository has its top, its user's index and its HEAD, or null when the workspace is not in a
   * git repository's working tree. Before the first commit, rev-parse still prints the rest.
   */
  private async locate(workspace: Workspace): Promise<Location | null> {
    const located = await this.git.run(workspace, ["rev-parse", "--show-toplevel", "--show-prefix", "--git-dir", "--verify", "--quiet", "HEAD"]);
    if (located.exitCode !== 0 && located.exitCode !== NO_COMMIT_YET) return null;
    const [top = "", prefix = "", gitDir = "", head = ""] = located.stdout.split("\n");
    return { atTop: { ...workspace, path: top }, prefix, usersIndex: resolve(workspace.path, gitDir, "index"), head };
  }
}
