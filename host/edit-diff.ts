import { open } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { ToolCallContent, ToolCallUpdate } from "@agentclientprotocol/sdk/unstable";
import { structuredPatch } from "diff";
import type { DiffHunk, DiffRow, EditDiff } from "../shared/review.ts";
import { MAX_ROWS_PER_FILE } from "./review/diff.ts";
import { hiddenBecause } from "../shared/host-problems.ts";

const MAX_FILE_BYTES = 1024 * 1024;
const CONTEXT_LINES = 3;
/** The diff runs while the agent waits for the answer, and blocks every conversation on the host as long as it runs. */
const DIFF_TIMEOUT_MS = 100;
/** A whole changed file takes longer, and the user asked for it. */
const FILE_DIFF_TIMEOUT_MS = 500;

/** As many as the web keeps loads of: fewer would drop an outside file's snippets before a refresh asks for them again. */
const DIFFS_KEPT = 100;

type ProposedChange = Extract<ToolCallContent, { type: "diff" }>;

/** The file as it is before the edit: its text, or that there is no such file, or that it can't be read as text. */
export type FileBefore = { kind: "text"; text: string } | { kind: "missing" } | { kind: "unreadable" };

/**
 * Claude Code removes the line break after a snippet it deletes, when the snippet does not end with one, and with
 * replace_all it then replaces only the occurrences a line break follows.
 */
function replaced(text: string, oldText: string, newText: string, replaceAll: boolean) {
  const target = newText === "" && !oldText.endsWith("\n") && text.includes(`${oldText}\n`) ? `${oldText}\n` : oldText;
  return replaceAll ? text.split(target).join(newText) : text.replace(target, () => newText);
}

/**
 * The whole file before and after, when the change can be placed in it. Claude Code sends an Edit as the snippet it
 * replaces, and a Write without the old text even over a file that exists; opencode sends the whole file.
 */
function wholeFile(change: ProposedChange, file: FileBefore, replaceAll: boolean) {
  const oldText = change.oldText ?? "";
  if (file.kind === "unreadable") return null;
  if (file.kind === "missing") return oldText === "" ? { before: "", after: change.newText } : null;
  if (oldText === "" || oldText === file.text) return { before: file.text, after: change.newText };
  const occurrences = file.text.split(oldText).length - 1;
  if (occurrences === 0 || (occurrences > 1 && !replaceAll)) return null;
  return { before: file.text, after: replaced(file.text, oldText, change.newText, replaceAll) };
}

function hunksBetween(before: string, after: string, context: number, timeout = DIFF_TIMEOUT_MS): DiffHunk[] | null {
  const patch = structuredPatch("", "", before, after, undefined, undefined, { context, timeout, stripTrailingCr: true });
  if (!patch) return null;
  return patch.hunks.map(({ oldStart, newStart, lines }) => {
    let [oldLine, newLine] = [oldStart, newStart];
    const rows = lines.flatMap((line): DiffRow[] => {
      const text = line.slice(1);
      if (line.startsWith("+")) return [{ kind: "added", oldLine: null, newLine: newLine++, text }];
      if (line.startsWith("-")) return [{ kind: "removed", oldLine: oldLine++, newLine: null, text }];
      if (line.startsWith(" ")) return [{ kind: "context", oldLine: oldLine++, newLine: newLine++, text }];
      return [];
    });
    return { header: "", newStart, rows };
  });
}

const withoutLineNumbers = (hunks: DiffHunk[]) => hunks.map((hunk) => ({ ...hunk, rows: hunk.rows.map((row) => ({ ...row, oldLine: null, newLine: null })) }));

const linesOf = (text: string) => (text === "" ? [] : text.replace(/\n$/, "").split("\n"));

/** The snippet as the agent sent it, every line of it shown, when the diff takes too long: all of it removed, then added. */
function snippetHunks(oldText: string, newText: string): DiffHunk[] {
  const hunks = hunksBetween(oldText, newText, Number.MAX_SAFE_INTEGER) ?? [
    {
      header: "",
      newStart: 1,
      rows: [
        ...linesOf(oldText).map((text): DiffRow => ({ kind: "removed", oldLine: null, newLine: null, text })),
        ...linesOf(newText).map((text): DiffRow => ({ kind: "added", oldLine: null, newLine: null, text })),
      ],
    },
  ];
  return withoutLineNumbers(hunks);
}

/** The change as it would land in the file, with the file's line numbers and a few lines around it where it can be found. */
export function editDiff(change: ProposedChange, file: FileBefore, replaceAll: boolean, path: string): EditDiff {
  const whole = wholeFile(change, file, replaceAll);
  const located = whole && hunksBetween(whole.before, whole.after, CONTEXT_LINES);
  const hunks = located ?? snippetHunks(change.oldText ?? "", change.newText);
  const rows = hunks.flatMap((hunk) => hunk.rows);
  const tooLong = rows.length > MAX_ROWS_PER_FILE;
  return {
    path,
    change: file.kind === "missing" && located ? "added" : "modified",
    added: rows.filter((row) => row.kind === "added").length,
    removed: rows.filter((row) => row.kind === "removed").length,
    hunks: tooLong ? [] : hunks,
    ...(tooLong ? hiddenBecause({ code: "diff-too-many-lines", lines: MAX_ROWS_PER_FILE }) : { hiddenBecause: null }),
    located: located !== null,
    lineCount: located ? linesOf(whole.after).length : null,
  };
}

const keptDiffs = new Map<string, EditDiff>();

const textKey = (text: string) => `${text.length}:${Bun.hash(text)}`;
const versionKey = (file: FileBefore) => (file.kind === "text" ? textKey(file.text) : file.kind);

/**
 * The diff worked out before for the same key, else `diffOf`'s: a diff blocks every conversation on the host while it
 * runs, and the Changes view asks again after every finished tool call, mostly for files that did not change.
 */
function keptDiff(key: string, diffOf: () => EditDiff): EditDiff {
  const diff = keptDiffs.get(key) ?? diffOf();
  keptDiffs.delete(key);
  keptDiffs.set(key, diff);
  if (keptDiffs.size > DIFFS_KEPT) keptDiffs.delete(keptDiffs.keys().next().value!);
  return diff;
}

/** A file's line changes from one version to another, with the file's line numbers and a few lines around each change. */
export function fileChangeDiff(path: string, before: FileBefore, after: FileBefore): EditDiff {
  return keptDiff(["file", path, versionKey(before), versionKey(after)].join("\0"), () => diffBetweenVersions(path, before, after));
}

function diffBetweenVersions(path: string, before: FileBefore, after: FileBefore): EditDiff {
  const change = before.kind === "missing" ? "added" : after.kind === "missing" ? "deleted" : "modified";
  const unchanged: Omit<EditDiff, "hiddenBecause"> = { path, change, added: 0, removed: 0, hunks: [], located: true, lineCount: null };
  if (before.kind === "unreadable" || after.kind === "unreadable") return { ...unchanged, ...hiddenBecause({ code: "diff-binary-or-large" }) };
  const [beforeText, afterText] = [before, after].map((file) => (file.kind === "text" ? file.text : ""));
  const hunks = hunksBetween(beforeText!, afterText!, CONTEXT_LINES, FILE_DIFF_TIMEOUT_MS);
  if (!hunks) return { ...unchanged, ...hiddenBecause({ code: "diff-timed-out" }) };
  const rows = hunks.flatMap((hunk) => hunk.rows);
  const tooLong = rows.length > MAX_ROWS_PER_FILE;
  return {
    ...unchanged,
    added: rows.filter((row) => row.kind === "added").length,
    removed: rows.filter((row) => row.kind === "removed").length,
    hunks: tooLong ? [] : hunks,
    ...(tooLong ? hiddenBecause({ code: "diff-too-many-lines", lines: MAX_ROWS_PER_FILE }) : { hiddenBecause: null }),
    lineCount: linesOf(afterText!).length,
  };
}

/** One edit as the agent sent it, without the file's line numbers. */
export function snippetDiff(path: string, oldText: string | null, newText: string): EditDiff {
  return keptDiff(["snippet", path, textKey(oldText ?? ""), textKey(newText)].join("\0"), () => diffOfSnippet(path, oldText, newText));
}

function diffOfSnippet(path: string, oldText: string | null, newText: string): EditDiff {
  const hunks = snippetHunks(oldText ?? "", newText);
  const rows = hunks.flatMap((hunk) => hunk.rows);
  return {
    path,
    change: "modified",
    added: rows.filter((row) => row.kind === "added").length,
    removed: rows.filter((row) => row.kind === "removed").length,
    hunks,
    hiddenBecause: null,
    located: false,
    lineCount: null,
  };
}

/** The file as it is on disk: its text, or that there is no such file, or that it can't be read as text. */
export async function textFileAt(path: string): Promise<FileBefore> {
  let handle;
  try {
    handle = await open(path, "r");
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? { kind: "missing" } : { kind: "unreadable" };
  }
  try {
    const stats = await handle.stat();
    if (!stats.isFile() || stats.size > MAX_FILE_BYTES) return { kind: "unreadable" };
    const text = await handle.readFile("utf8");
    return text.includes("\0") ? { kind: "unreadable" } : { kind: "text", text };
  } catch {
    return { kind: "unreadable" };
  } finally {
    await handle.close();
  }
}

export function shownPath(path: string, workspaceDirectories: string[]) {
  const isOutside = (within: string) => within === ".." || within.startsWith(`..${sep}`) || isAbsolute(within);
  const inside = workspaceDirectories.map((directory) => relative(directory, path)).find((within) => within !== "" && !isOutside(within));
  return inside ?? path;
}

/**
 * The files an edit the agent asks permission for would change, each read from disk to place the change in it;
 * undefined when the request changes no file. Only the files the request names are read.
 */
export async function editDiffsOf(toolCall: ToolCallUpdate, workspaceDirectories: string[]): Promise<EditDiff[] | undefined> {
  const changes = (toolCall.content ?? []).filter((content): content is ProposedChange => content.type === "diff");
  if (changes.length === 0) return undefined;
  const replaceAll = (toolCall.rawInput as { replace_all?: unknown } | null | undefined)?.replace_all === true;
  return Promise.all(
    changes.map(async (change) => {
      const path = resolve(workspaceDirectories[0]!, change.path);
      return editDiff(change, await textFileAt(path), replaceAll, shownPath(path, workspaceDirectories));
    }),
  );
}
