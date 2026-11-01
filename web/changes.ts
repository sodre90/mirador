import type { ChangedFile, ChangeList, FileChanges } from "../shared/changes.ts";
import type { TreeFolder } from "../shared/file-tree.ts";
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

/** With every file shown, only the folders holding a change start open, so the changes show at once in a big project. */
export const startsFolded = (folder: TreeFolder<ListedFile>, everyFile: boolean) => everyFile && !folder.items.some(({ change }) => change);

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
