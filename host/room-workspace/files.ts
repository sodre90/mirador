import { createTwoFilesPatch, FILE_HEADERS_ONLY } from "diff";
import { holdsClaudeSetup } from "../../shared/room-permissions.ts";
import { WORKSPACE_RESULT_MOST_CHARACTERS, type WorkspaceCall, type WorkspaceCallResult } from "../../shared/room-workspace.ts";
import { refused, type FileChange } from "../sandbox/in-vm/workspace-files.ts";
import type { WorkspacePlace } from "./workspace-place.ts";

const MOST_DIFF_CHARACTERS = 120_000;
const DIFF_TIMEOUT_MS = 500;

/** The most lines of a file a change may take out and put in: more would take long to compare, and nobody reads them through. */
const MOST_LINES_CHANGED = 1_200;

/** The lines from `fromLine` on that fit in what the agent is sent, and where they stand in the file. */
function linesFrom(text: string, fromLine: number) {
  const lines = text.split("\n");
  if (fromLine > lines.length) throw refused(`The file has ${lines.length} lines.`);
  const rest = lines.slice(fromLine - 1).join("\n");
  const shown = rest.slice(0, WORKSPACE_RESULT_MOST_CHARACTERS);
  const lastLine = fromLine + shown.split("\n").length - 1;
  const cut = shown.length < rest.length ? ", cut there" : "";
  return `Lines ${fromLine} to ${lastLine} of ${lines.length}${cut}:\n${shown}`;
}

/** A file's text from a line on, or the names in a folder. */
export async function readInWorkspace({ path, fromLine }: Extract<WorkspaceCall, { kind: "read" }>, place: WorkspacePlace, stopped: AbortSignal): Promise<WorkspaceCallResult> {
  const { entry } = await place.entryAt(path, stopped);
  if (entry.kind === "none") throw refused(`There is no ${path}.`);
  return { done: true, text: entry.kind === "folder" ? entry.names.join("\n") || "The folder is empty." : linesFrom(entry.text, fromLine) };
}

function replacedOnce(before: string, old: string, replacement: string, path: string) {
  const times = before.split(old).length - 1;
  if (times !== 1) throw refused(times === 0 ? `The text to replace is not in ${path}.` : `The text to replace is in ${path} ${times} times; name more of it.`);
  return before.replace(old, () => replacement);
}

export async function changeAskedFor(call: Extract<WorkspaceCall, { kind: "edit" | "write" }>, place: WorkspacePlace, stopped: AbortSignal): Promise<FileChange> {
  const { within, entry } = await place.entryAt(call.path, stopped);
  if (holdsClaudeSetup(within) || holdsClaudeSetup(call.path)) throw refused("What Claude Code's own sessions load is changed on the room's machine alone.");
  if (entry.kind === "folder") throw refused(`${call.path} is no regular file.`);
  if (call.kind === "edit" && entry.kind === "none") throw refused(`There is no ${call.path}.`);
  const before = entry.kind === "file" ? entry.text : null;
  const after = call.kind === "write" ? call.content : replacedOnce(before!, call.old, call.new, call.path);
  if (before === after) throw refused(`${call.path} already reads so.`);
  return { path: call.path, within, before, after };
}

/** The change as a diff, with a few lines around each part of it; one too large to be read through by whoever allows it is refused. */
export function diffOf({ within, before, after }: FileChange) {
  const maxEditLength = before === null ? undefined : MOST_LINES_CHANGED;
  const patch = createTwoFilesPatch(before === null ? "/dev/null" : within, within, before ?? "", after, undefined, undefined, { context: 3, timeout: DIFF_TIMEOUT_MS, maxEditLength, headerOptions: FILE_HEADERS_ONLY });
  if (patch === undefined || patch.length > MOST_DIFF_CHARACTERS) throw refused("The change is too large to be read through; make it in parts.");
  return patch.trimEnd();
}

export async function changeMade(change: FileChange, place: WorkspacePlace, stopped: AbortSignal): Promise<WorkspaceCallResult> {
  await place.makeChange(change, stopped);
  return { done: true, text: change.before === null ? `Wrote ${change.path}.` : `Changed ${change.path}.` };
}
