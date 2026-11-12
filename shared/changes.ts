import type { EditDiff } from "./review.ts";

/** This turn: since the files as they were when the turn began. Uncommitted: since the repository's HEAD. Session: the agent's edits since the conversation began, and the files written while its commands ran since its first message, its commits' included. */
export const changeScopes = ["turn", "session", "uncommitted"] as const;
export type ChangeScope = (typeof changeScopes)[number];

export type ChangeStatus = "added" | "modified" | "deleted";

/** A file that differs from what its scope compares it with. */
export interface ChangedFile {
  /** Relative to the workspace for a file of the project, absolute for any other. */
  path: string;
  status: ChangeStatus;
  /** Null for a binary file, and for a file that only the agent's own snippets describe. */
  added: number | null;
  removed: number | null;
  /** Whether this conversation's agent changed it with its edit tools, within the scope. */
  byAgent: boolean;
  /** Whether git ignores it: the session scope lists these only where the agent's commands wrote them, so a view can leave them out. */
  ignored?: boolean;
  /** In a session, whether another conversation in the workspace was running a command or edit then, so it may have written it instead. */
  othersMayHaveWritten?: boolean;
}

/**
 * What the project's files were compared with. Without the files of the turn's start or a repository to compare
 * with, the project's list is the agent's own edits; in a folder that is no repository, a turn's list is also the files
 * written since the turn began.
 */
export type ChangesBase = "head" | "turn-start" | "turn-file-times" | "no-turn" | "turn-not-kept" | "not-a-repository" | "session";

export interface ChangeList {
  scope: ChangeScope;
  base: ChangesBase;
  /** Whether the folder is in a git repository, so its changes can be committed. */
  inRepository: boolean;
  project: ChangedFile[];
  /** In a turn, the project's files that commits since the turn began changed, such as a pull's or the agent's own, apart from the rest. */
  committed: ChangedFile[];
  outside: ChangedFile[];
  /** Set when the folder held more files than were checked, to how many were: the list may lack some. */
  filesCheckedAtMost?: number;
}

/** Every file of the project, changed or not, relative to the workspace with / between folders. */
export interface ProjectFiles {
  paths: string[];
  /** Set when the project held more files than were listed, to how many were. */
  filesListedAtMost?: number;
}

/** A file's line changes: the file compared with the scope's base, or else the agent's edits to it, one by one. */
export interface FileChanges {
  path: string;
  source: "files" | "agent";
  diffs: EditDiff[];
}

/**
 * What a commit from a conversation can take: the files of its session that differ from HEAD, apart from the folder's
 * other uncommitted changes, such as a file one of its commands deleted, which nothing ties to it, or the user's own
 * work. The branch is the one the commit would go on, null on a detached HEAD.
 */
export interface Committable {
  ofConversation: ChangedFile[];
  others: ChangedFile[];
  branch: string | null;
}

/**
 * How a worktree conversation's commits stand against the branch its project folder has checked out: how many that branch
 * lacks, and how many it gained since the worktree left it. The branch is null on a detached HEAD.
 */
export interface Landable {
  branch: string | null;
  ahead: number;
  behind: number;
}

/** Commits a worktree conversation brought onto its project folder's branch, rebased first when that branch had moved on. */
export interface Landed {
  branch: string;
  /** The branch's new tip, abbreviated. */
  revision: string;
  subjects: string[];
  rebased: boolean;
}

export interface MadeCommit {
  /** The commit's abbreviated hash. */
  revision: string;
  subject: string;
}
