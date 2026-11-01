import { describe, expect, test } from "bun:test";
import type { DiffRow, ReviewFile } from "../shared/review.ts";
import { gapsOf, hiddenCount, hunkRowsShown, nothingRevealed, revealAll, revealedRows, type GapPlace, type Revealed } from "../web/review-context.ts";

const context = (newLine: number): DiffRow => ({ kind: "context", oldLine: newLine, newLine, text: `line ${newLine}` });
const file = (change: ReviewFile["change"], hunks: { newStart: number; newLines: number[] }[]): ReviewFile => ({
  path: "a.ts",
  oldPath: null,
  change,
  added: 0,
  removed: 0,
  hunks: hunks.map(({ newStart, newLines }) => ({ header: "", newStart, rows: newLines.map(context) })),
  hiddenBecause: null,
});
const fileLines = Array.from({ length: 100 }, (_, index) => `line ${index + 1}`);

describe("the lines around a diff's hunks", () => {
  test("are the gaps before each hunk and after the last, whose end is known once the file is read", () => {
    const gaps = gapsOf(file("modified", [{ newStart: 10, newLines: [10, 11, 12] }, { newStart: 40, newLines: [40, 41] }]));
    expect(gaps).toEqual([
      { start: 1, end: 9 },
      { start: 13, end: 39 },
      { start: 42, end: null },
    ]);
    expect(hiddenCount(gaps[2]!, nothingRevealed, null)).toBeNull();
    expect(hiddenCount(gaps[2]!, nothingRevealed, 100)).toBe(59);
  });

  test("an added file is all in its hunk, and a deleted one has no reviewed version", () => {
    expect(gapsOf(file("added", [{ newStart: 1, newLines: [1, 2, 3] }])).every((gap) => hiddenCount(gap, nothingRevealed, 3) === 0)).toBe(true);
    expect(gapsOf(file("deleted", [{ newStart: 0, newLines: [] }]))).toEqual([]);
  });

  test("are shown from the hunk before downwards and from the hunk after upwards, never twice", () => {
    const gap = { start: 13, end: 39 };
    const { underPrevious, overNext } = revealedRows(gap, { top: 3, bottom: 2 }, fileLines);
    expect(underPrevious.map((row) => row.newLine)).toEqual([13, 14, 15]);
    expect(overNext.map((row) => [row.newLine, row.text])).toEqual([
      [38, "line 38"],
      [39, "line 39"],
    ]);
    expect(hiddenCount(gap, { top: 3, bottom: 2 }, 100)).toBe(22);

    const overlapping = revealedRows(gap, { top: 20, bottom: 20 }, fileLines);
    expect([...overlapping.underPrevious, ...overlapping.overNext].map((row) => row.newLine)).toEqual(Array.from({ length: 27 }, (_, index) => 13 + index));
    expect(hiddenCount(gap, { top: 20, bottom: 20 }, 100)).toBe(0);
  });
});

describe("the rows a diff shows", () => {
  test("are each hunk's own until lines are revealed, then those revealed over and under it too", () => {
    const changed = file("modified", [{ newStart: 10, newLines: [10, 11] }]);
    expect(hunkRowsShown(changed, null)).toEqual([changed.hunks[0]!.rows]);
    const shown = hunkRowsShown(changed, { fileLines, revealed: [{ top: 0, bottom: 2 }, { top: 1, bottom: 0 }] });
    expect(shown[0]!.map(({ newLine }) => newLine)).toEqual([8, 9, 10, 11, 12]);
    expect(shown[0]![0]!.text).toBe("line 8");
  });
});

describe("revealing all of a gap's hidden lines", () => {
  const changed = file("modified", [{ newStart: 27, newLines: [27, 28, 29] }, { newStart: 60, newLines: [60] }]);
  const gaps = gapsOf(changed);
  const linesFrom = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, offset) => from + offset);
  const allOf = (gapIndex: number, place: GapPlace) => revealAll(place)(nothingRevealed, hiddenCount(gaps[gapIndex]!, nothingRevealed, fileLines.length)!);
  const firstHunkShows = (revealed: Revealed[]) => hunkRowsShown(changed, { fileLines, revealed })[0]!.map(({ newLine }) => newLine);

  test("above the first hunk shows them over it, as there is no hunk above to show them under", () => {
    const top = allOf(0, "top");
    expect(hiddenCount(gaps[0]!, top, fileLines.length)).toBe(0);
    expect(firstHunkShows([top, nothingRevealed, nothingRevealed])).toEqual(linesFrom(1, 29));
  });

  test("between two hunks shows them under the one above", () => {
    expect(firstHunkShows([nothingRevealed, allOf(1, "between"), nothingRevealed])).toEqual(linesFrom(27, 59));
  });
});
