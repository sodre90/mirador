import type { ChangedFile, ChangeList, FileChanges } from "../shared/changes.ts";
import type { TreeFolder, TreeNode } from "../shared/file-tree.ts";
import type { StoredEvent } from "../shared/model.ts";

/** A row of the Changes view: a file, with what changed in it, if anything did. */
export interface ListedFile {
  path: string;
  change: ChangedFile | null;
  /** Changed by commits since the turn began, which the changed-only views list in a section of their own. */
  fromCommit: boolean;
}

export const changedFiles = (files: ChangedFile[], fromCommit = false): ListedFile[] => files.map((change) => ({ path: change.path, change, fromCommit }));

/** Every file of the project once: the changed ones with their changes, commits' included, then the rest; a deleted file is only in the change list. */
export function projectFilesWithChanges(list: ChangeList, projectPaths: readonly string[]): ListedFile[] {
  const changed = [...changedFiles(list.project), ...changedFiles(list.committed, true)];
  const changedPaths = new Set(changed.map(({ path }) => path));
  return [...changed, ...projectPaths.filter((path) => !changedPaths.has(path)).map((path) => ({ path, change: null, fromCommit: false }))];
}

/** A folder holding more changed files than this, such as a package install's, starts folded, and so does every folder in it. */
export const BIG_FOLDER_CHANGES = 100;

/** A list, or a folder's own rows, draws this many rows at first, and as many more each time Show more is pressed. */
export const ROWS_AT_ONCE = 200;

const changedCount = (folder: TreeFolder<ListedFile>) => folder.items.reduce((count, { change }) => (change ? count + 1 : count), 0);

export const isBigFolder = (folder: TreeFolder<ListedFile>) => changedCount(folder) > BIG_FOLDER_CHANGES;

/**
 * Which folders start open: with every file shown, only those holding a change, so the changes show at once in a big
 * project; and never a big folder or one inside it, so thousands of changed files are not all drawn at once.
 */
export const startsFolded = (folder: TreeFolder<ListedFile>, everyFile: boolean, insideBigFolder = false) =>
  insideBigFolder || isBigFolder(folder) || (everyFile && changedCount(folder) === 0);

const holdsChange = (node: TreeNode<ListedFile>) => (node.kind === "file" ? node.item.change !== null : node.items.some(({ change }) => change));

/** The selected file's own row, or a folder holding it. */
export const holdsSelection = (node: TreeNode<ListedFile>, selectedPath: string | null) =>
  selectedPath !== null && (node.kind === "file" ? node.item.path === selectedPath : node.items.some((item) => item.path === selectedPath));

/**
 * The rows of a folder drawn even past its first ones: the selected file's, which a view opened again would otherwise
 * hide, and with every file shown those holding a change, unless they are too many to draw at once.
 */
export function drawnPastFirstRows(nodes: readonly TreeNode<ListedFile>[], selectedPath: string | null, everyFile: boolean): (node: TreeNode<ListedFile>) => boolean {
  const drawsChanges = everyFile && nodes.filter(holdsChange).length <= ROWS_AT_ONCE;
  return (node) => holdsSelection(node, selectedPath) || (drawsChanges && holdsChange(node));
}

/**
 * The newest event after which the files may differ: a finished tool call, the user's own command ending, a turn
 * starting or ending, or an undo. The Changes view loads again whenever it moves.
 */
export function changesRefreshPoint(events: StoredEvent[]): number {
  return events.findLast(({ event }) => {
    if (event.type === "acp") return event.update.sessionUpdate === "tool_call_update" && (event.update.status === "completed" || event.update.status === "failed");
    return event.type === "user-message" || event.type === "turn-end" || event.type === "user-command-ended" || event.type === "revert";
  })?.seq ?? 0;
}

/** Where IDEA should open the file: its first changed line, or the line a removal left off at; the top for the agent's own snippets. */
export function firstChangedLine(changes: FileChanges): number {
  const rows = changes.source === "files" ? (changes.diffs[0]?.hunks[0]?.rows ?? []) : [];
  const firstChange = rows.findIndex(({ kind }) => kind !== "context");
  if (firstChange === -1) return 1;
  return rows.slice(firstChange).find(({ newLine }) => newLine !== null)?.newLine ?? (rows[firstChange - 1]?.newLine ?? 0) + 1;
}
