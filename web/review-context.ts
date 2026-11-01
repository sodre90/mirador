import type { DiffHunk, DiffRow, ReviewFile } from "../shared/review.ts";

export const CONTEXT_STEP = 20;

/**
 * Lines of the reviewed version a diff leaves out: one before each hunk, and one after the last hunk whose end is
 * unknown (null) until the file is read. Lines are counted from 1; a gap with end < start is empty.
 */
export interface Gap {
  start: number;
  end: number | null;
}

/** How much of a gap is shown: lines from its top (under the hunk before it) and from its bottom (over the hunk after it). */
export interface Revealed {
  top: number;
  bottom: number;
}

export const nothingRevealed: Revealed = { top: 0, bottom: 0 };

/** Where a gap is: above the first hunk, between two, or under the last. */
export type GapPlace = "top" | "between" | "end";

/** A gap's top lines show under the hunk before it, and its bottom lines over the hunk after it. */
export type RevealChange = (current: Revealed, hidden: number) => Revealed;

export const revealUnderPrevious: RevealChange = ({ top, bottom }, hidden) => ({ top: top + Math.min(CONTEXT_STEP, hidden), bottom });
export const revealOverNext: RevealChange = ({ top, bottom }, hidden) => ({ top, bottom: bottom + Math.min(CONTEXT_STEP, hidden) });

/** Every line still hidden, shown under the hunk before the gap; above the first hunk there is none, so over it. */
export const revealAll =
  (place: GapPlace): RevealChange =>
  ({ top, bottom }, hidden) =>
    place === "top" ? { top, bottom: bottom + hidden } : { top: top + hidden, bottom };

const newLinesOf = (hunk: DiffHunk) => hunk.rows.flatMap((row) => (row.newLine === null ? [] : [row.newLine]));
const firstNewLine = (hunk: DiffHunk) => newLinesOf(hunk)[0] ?? hunk.newStart + 1;
const lastNewLine = (hunk: DiffHunk) => newLinesOf(hunk).at(-1) ?? hunk.newStart;

export function gapsOf(file: Pick<ReviewFile, "hunks" | "change">): Gap[] {
  const { hunks } = file;
  if (hunks.length === 0 || file.change === "deleted") return [];
  const beforeEachHunk = hunks.map((hunk, index) => ({ start: index === 0 ? 1 : lastNewLine(hunks[index - 1]!) + 1, end: firstNewLine(hunk) - 1 }));
  const afterLastHunk = lastNewLine(hunks.at(-1)!) + 1;
  return [...beforeEachHunk, { start: afterLastHunk, end: file.change === "added" ? afterLastHunk - 1 : null }];
}

/** Lines of the gap still hidden, or null while its end is unknown. */
export function hiddenCount(gap: Gap, { top, bottom }: Revealed, lineCount: number | null) {
  const end = gap.end ?? lineCount;
  return end === null ? null : Math.max(0, end - gap.start + 1 - top - bottom);
}

const contextRows = (from: number, to: number, lines: string[]): DiffRow[] =>
  Array.from({ length: Math.max(0, to - from + 1) }, (_, offset) => ({ kind: "context", oldLine: null, newLine: from + offset, text: lines[from + offset - 1] ?? "" }));

/** The shown lines of a gap, as rows for under the hunk before it and over the hunk after it. */
export function revealedRows(gap: Gap, { top, bottom }: Revealed, lines: string[]) {
  const end = gap.end ?? lines.length;
  const topEnd = Math.min(end, gap.start + top - 1);
  const bottomStart = Math.max(topEnd + 1, end - bottom + 1);
  return { underPrevious: contextRows(gap.start, topEnd, lines), overNext: contextRows(bottomStart, end, lines) };
}

/** What a file's diff shows around its hunks: the reviewed version's lines, read once something was revealed, and how much of each gap. */
export interface ShownContext {
  fileLines: string[];
  revealed: Revealed[];
}

/** Each hunk's rows as the diff shows them: with the lines revealed over and under it. */
export function hunkRowsShown(file: Pick<ReviewFile, "hunks" | "change">, shown: ShownContext | null): DiffRow[][] {
  if (!shown) return file.hunks.map((hunk) => hunk.rows);
  const gaps = gapsOf(file);
  return file.hunks.map((hunk, index) => {
    const over = revealedRows(gaps[index]!, shown.revealed[index]!, shown.fileLines).overNext;
    const under = revealedRows(gaps[index + 1]!, shown.revealed[index + 1]!, shown.fileLines).underPrevious;
    return over.length + under.length === 0 ? hunk.rows : [...over, ...hunk.rows, ...under];
  });
}
