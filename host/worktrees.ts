import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { HostProblemError } from "../shared/host-problems.ts";
import type { Conversation, ConversationWorktree, Workspace } from "../shared/model.ts";
import { git, mustGit } from "./git-command.ts";

const SHORT_ID_LENGTH = 8;

const folderNameOf = ({ name, id }: Workspace) => `${name.replace(/[^\p{L}\p{N}._-]+/gu, "-")}-${id.slice(0, SHORT_ID_LENGTH)}`;

/**
 * Where the conversation works, as a workspace: its worktree, under the worktree's own id, so what Mirador keeps per
 * folder, such as the files of each turn, stays apart from the project folder's; else the workspace itself.
 */
export const workingCopyOf = (workspace: Workspace, { worktree }: Pick<Conversation, "worktree">): Workspace =>
  worktree ? { ...workspace, id: worktree.id, path: worktree.folder } : workspace;

/** The git worktrees conversations work in, kept in Mirador's data folder: `worktrees/<workspace>/<worktree>`. */
export class Worktrees {
  constructor(private readonly dataDir: string) {}

  /** A worktree for a conversation of the workspace, not made yet: making it takes a while, and the conversation shows meanwhile. */
  async plan(workspace: Workspace): Promise<ConversationWorktree> {
    const placeInRepository = await this.mustHold(workspace);
    const id = crypto.randomUUID();
    const shortId = id.slice(0, SHORT_ID_LENGTH);
    const root = join(this.dataDir, "worktrees", folderNameOf(workspace), shortId);
    return { id, root, folder: resolve(root, placeInRepository), branch: `mirador/${shortId}` };
  }

  /** git makes a worktree only of a repository with a commit to check out. Answers where the workspace's folder is inside its repository. */
  async mustHold(workspace: Workspace) {
    const [placeInRepository, head] = await Promise.all([
      git(workspace.path, ["rev-parse", "--show-prefix"]),
      git(workspace.path, ["rev-parse", "--verify", "--quiet", "HEAD"]),
    ]);
    if (placeInRepository.exitCode !== 0 || head.exitCode !== 0) throw new HostProblemError({ code: "worktree-needs-repository", directory: workspace.path });
    return placeInRepository.stdout.trim();
  }

  isMade(worktree: ConversationWorktree) {
    return existsSync(worktree.folder);
  }

  /** On a new branch from what the workspace has checked out; a worktree whose folder was deleted comes back on the branch it had. */
  async make(workspace: Workspace, worktree: ConversationWorktree) {
    await git(workspace.path, ["worktree", "prune"]);
    const hasBranch = (await git(workspace.path, ["rev-parse", "--verify", "--quiet", `refs/heads/${worktree.branch}`])).exitCode === 0;
    await mustGit(workspace.path, ["worktree", "add", "--quiet", ...(hasBranch ? [worktree.root, worktree.branch] : ["-b", worktree.branch, worktree.root, "HEAD"])]);
  }

  /** The files that deleting the worktree would lose: changed or new, and not committed. */
  async uncommittedFiles(worktree: ConversationWorktree) {
    if (!existsSync(worktree.root)) return 0;
    const status = await git(worktree.root, ["status", "--porcelain", "-z", "--no-renames", "--untracked-files=all"]);
    return status.exitCode === 0 ? status.stdout.split("\0").filter(Boolean).length : 0;
  }

  /** With its uncommitted files. Its branch goes too unless it has commits the workspace's branch lacks, which git keeps. */
  async remove(workspace: Workspace, worktree: ConversationWorktree) {
    const removed = await git(workspace.path, ["worktree", "remove", "--force", worktree.root]);
    if (removed.exitCode !== 0) {
      await rm(worktree.root, { recursive: true, force: true });
      await git(workspace.path, ["worktree", "prune"]);
    }
    await git(workspace.path, ["branch", "--delete", worktree.branch]);
  }
}
