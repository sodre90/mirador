import type { HostProblem } from "./host-problems.ts";
export type FindingSeverity = "blocker" | "issue" | "question" | "nit";
export type FindingCheck = "confirmed" | "plausible";
export type FindingDecision = "keep" | "drop";

export const findingSeverities: FindingSeverity[] = ["blocker", "issue", "question", "nit"];

export const severityLabels: Record<FindingSeverity, string> = { blocker: "Blocker", issue: "Issue", question: "Question", nit: "Nit" };

/** Lines of the reviewed (new) version of a file, counted from 1; a single line has endLine === line. */
export interface CodeAnchor {
  path: string;
  line: number;
  endLine: number;
}

/** Lines of the reviewed version around an anchor, so code outside the diff can be shown too. */
export interface CodeExcerpt {
  startLine: number;
  lines: string[];
  /** A gap inside the excerpt, shown instead of lines too long to include: `after` is the index in `lines` of the last line before it. */
  elision?: { after: number; lineCount: number };
}

export interface ReviewFlowStep {
  title: string;
  at: CodeAnchor;
  say: string;
  excerpt: CodeExcerpt;
}

export interface ReviewFinding {
  id: string;
  severity: FindingSeverity;
  checked: FindingCheck;
  at: CodeAnchor;
  title: string;
  /** Written as a comment to the change's author; this is what gets posted. */
  body: string;
  /** What the agent wrote, once the user reworded the body. */
  agentBody?: string;
  /** How the agent checked it, for the user only. */
  evidence?: string;
  excerpt: CodeExcerpt;
  decision: FindingDecision;
  /** Set once the finding is a comment on the pull request's pending review. */
  postedAs?: { threadId: string };
  postError?: string;
}

export interface ConversationComment {
  author: string;
  body: string;
  url: string;
  createdAt: string;
}

/** The agent's answer to a conversation (review thread) already on the pull request, shown with the conversation as GitHub had it. */
export interface ReviewAnswer {
  id: string;
  threadId: string;
  path: string;
  line: number | null;
  /** The lines it was about changed since. */
  outdated: boolean;
  resolved: boolean;
  /** Whether GitHub lets the user resolve it. */
  canResolve: boolean;
  comments: ConversationComment[];
  /** The reply as it gets posted in the conversation. */
  body: string;
  /** What the agent wrote, once the user reworded the body. */
  agentBody?: string;
  suggestsResolving: boolean;
  /** The user's go-ahead to resolve the conversation when the answer is posted. */
  resolve: boolean;
  decision: FindingDecision;
  /** Set once the answer is a reply on the pull request's pending review. */
  postedAs?: { url: string };
  postError?: string;
}

export type DiffRowKind = "context" | "added" | "removed" | "elided";

export interface DiffRow {
  kind: DiffRowKind;
  oldLine: number | null;
  newLine: number | null;
  text: string;
}

export interface DiffHunk {
  header: string;
  newStart: number;
  rows: DiffRow[];
}

export type FileChange = "added" | "modified" | "deleted" | "renamed";

export interface ReviewFile {
  path: string;
  oldPath: string | null;
  change: FileChange;
  added: number;
  removed: number;
  hunks: DiffHunk[];
  /** Why the file's diff is left out, e.g. a lock file; its counts still show. */
  hiddenBecause: string | null;
}

/** A file the agent asks to edit or write, as the edit would change it; or a file of the changes list, as it changed. */
export interface EditDiff {
  /** As the workspace names it, when the file is inside the workspace. */
  path: string;
  change: "added" | "modified" | "deleted";
  added: number;
  removed: number;
  hunks: DiffHunk[];
  /** Why the diff is left out; its counts still show. */
  hiddenBecause: string | null;
  hiddenBecauseAbout?: HostProblem;
  /** Whether the edit was found in the file; when it was not, the rows are the agent's snippet, without line numbers. */
  located: boolean;
  /** How many lines the file has after the edit, when it was found. */
  lineCount: number | null;
}

/** What keeps gh from posting to a pull request's host: it is not installed, or has no account it can use there. */
export type GitHubCliProblem = "missing" | "logged-out";

export interface PullRequestRef {
  url: string;
  host: string;
  owner: string;
  repo: string;
  number: number;
}

export interface PullRequestMovedOn {
  headCommit: string;
  askedToReviewAgain: boolean;
}

/** The user's pending review on the pull request, started on another commit than the one reviewed. */
export interface PendingReviewOfOtherCommit {
  url: string;
  commit: string;
}

/** What a review and a tour both show: the agent's summary, its tour of the code flow, and the files that changed. */
export interface Walkthrough {
  summary: string;
  flow: ReviewFlowStep[];
  files: ReviewFile[];
}

export interface Review extends Walkthrough {
  /** The root of the checkout the change was reviewed in. */
  repository: string;
  base: string;
  baseCommit: string;
  headCommit: string;
  pullRequest: PullRequestRef | null;
  verdict: string;
  findings: ReviewFinding[];
  /** Missing on reviews published before answers existed; read it with answersOf. */
  answers?: ReviewAnswer[];
  posting: boolean;
  pendingReviewUrl: string | null;
  /** Set once posting found the pull request's head moved on from the commit reviewed, until a post goes through. */
  pullRequestMovedOn?: PullRequestMovedOn;
  /** Set once posting found the user's pending review on the pull request started on another commit, until a post goes through. */
  pendingReviewOfOtherCommit?: PendingReviewOfOtherCommit;
  /** Why the last post failed as a whole, e.g. gh couldn't reach GitHub, until the user posts again. */
  postFailure?: string;
  /** The agent's latest change to parts of the review in place: finding and answer ids, "summary", "verdict" or "flow". */
  agentEdit?: { at: number; parts: string[] };
  /** The highest finding number handed out so far, so a removed finding's id never names another one; missing until the agent changes the review. */
  lastFindingNumber?: number;
}

/** A tour of the code flow outside a review: how some code works, or what a task changed. */
export interface Tour extends Walkthrough {
  /** The folder its paths are relative to. */
  folder: string;
  /** What changed since a git ref, when the tour shows that; its `files` are then those changes. */
  changes: TourChanges | null;
}

export interface TourChanges {
  since: string;
  sinceCommit: string;
  /** The git tree of the folder as it was published, so a changed file can be shown beyond its diff. */
  snapshot: string;
}

export const answersOf = (review: Review) => review.answers ?? [];

/** The verdict's first words, before its reason: "Request changes" of "Request changes: the fallback skips auth.". */
export const verdictInBrief = (verdict: string) => verdict.split(/:|\s[—–]\s/)[0]!.trim() || verdict;

const shortCommit = (commit: string) => commit.slice(0, 10);

/** Why the review cannot be posted once its pull request moved on to another head. */
export const pullRequestMovedOnNote = ({ headCommit }: Pick<Review, "headCommit">, newHead: string) =>
  `The pull request has changed since the review: its head is ${shortCommit(newHead)}, the review is of ${shortCommit(headCommit)}.`;

export const ASKED_TO_REVIEW_AGAIN = "The agent is asked to review it again.";

/** Why the review is not added to a pending review started on another commit: its comments would land on that commit's lines. */
export const pendingReviewOfOtherCommitNote = ({ headCommit }: Pick<Review, "headCommit">, { commit }: Pick<PendingReviewOfOtherCommit, "commit">) =>
  `Your pending review on the pull request was started on ${shortCommit(commit)}, not on ${shortCommit(headCommit)}, the commit this review is of. Submit or discard it on GitHub, then post again.`;

/** GitHub's page of what changed between two commits of the pull request's repository. */
export const compareUrl = ({ host, owner, repo }: PullRequestRef, from: string, to: string) => `https://${host}/${owner}/${repo}/compare/${from}...${to}`;

/** The N of a finding's id, finding-N, by which the agent names it; 0 for an id of another shape. */
export const findingNumber = (findingId: string) => Number(/^finding-(\d+)$/.exec(findingId)?.[1] ?? 0);

const ANCHOR = /^(.+):(\d+)(?:-(\d+))?$/;

export function parseAnchor(text: string): CodeAnchor | null {
  const match = ANCHOR.exec(text.trim());
  if (!match) return null;
  const line = Number(match[2]);
  const endLine = match[3] ? Number(match[3]) : line;
  return { path: match[1]!, line, endLine };
}

export const anchorLabel = ({ path, line, endLine }: CodeAnchor) => (endLine > line ? `${path}:${line}-${endLine}` : `${path}:${line}`);

const sideRows = (hunk: DiffHunk) => hunk.rows.filter((row) => row.newLine !== null);

/** GitHub takes comments only on lines of its diff's hunks, and a range only within one hunk. */
export function isCommentable(file: ReviewFile | undefined, { line, endLine }: CodeAnchor) {
  return (file?.hunks ?? []).some((hunk) => {
    const lines = sideRows(hunk).map((row) => row.newLine!);
    return lines.includes(line) && lines.includes(endLine);
  });
}

/** For each line of the new version, the removed lines that sat right before it. */
function removedBeforeLine(file: ReviewFile) {
  const removedBefore = new Map<number, DiffRow[]>();
  file.hunks.forEach((hunk) => {
    let removed: DiffRow[] = [];
    /** With no new-side rows, git's newStart is the line the deletion sits after, not the one before it. */
    const hasNewSide = hunk.rows.some((row) => row.newLine !== null);
    let lastNewLine = hasNewSide ? hunk.newStart - 1 : hunk.newStart;
    hunk.rows.forEach((row) => {
      if (row.kind === "removed") return removed.push(row);
      lastNewLine = row.newLine!;
      if (removed.length > 0) removedBefore.set(row.newLine!, removed);
      removed = [];
    });
    if (removed.length > 0) removedBefore.set(Math.max(1, lastNewLine + 1), removed);
  });
  return removedBefore;
}

/** An excerpt of the new version with the change marked: added lines, and the removed lines where they were. */
export function excerptRows(file: ReviewFile | undefined, excerpt: CodeExcerpt): DiffRow[] {
  const added = new Set((file?.hunks ?? []).flatMap((hunk) => hunk.rows.filter((row) => row.kind === "added").map((row) => row.newLine!)));
  const removedBefore = file ? removedBeforeLine(file) : new Map<number, DiffRow[]>();
  const lineAt = (index: number) => excerpt.startLine + index + (excerpt.elision && index > excerpt.elision.after ? excerpt.elision.lineCount : 0);
  return excerpt.lines.flatMap((text, index): DiffRow[] => {
    const newLine = lineAt(index);
    return [
      ...(removedBefore.get(newLine) ?? []),
      { kind: added.has(newLine) ? "added" : "context", oldLine: null, newLine, text },
      ...(excerpt.elision?.after === index ? [elisionRow(excerpt.elision.lineCount)] : []),
    ];
  });
}

const elisionRow = (lineCount: number): DiffRow => ({
  kind: "elided",
  oldLine: null,
  newLine: null,
  text: `… ${lineCount} ${lineCount === 1 ? "line" : "lines"} not shown …`,
});
