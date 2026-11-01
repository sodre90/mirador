export type DiffLine = { kind: "same" | "added" | "removed"; text: string };

const MAX_LCS_CELLS = 400_000;

export function longestCommonSubsequenceTable(before: string[], after: string[]) {
  const table = Array.from({ length: before.length + 1 }, () => new Uint32Array(after.length + 1));
  for (let i = before.length - 1; i >= 0; i--) {
    for (let j = after.length - 1; j >= 0; j--) {
      table[i]![j] = before[i] === after[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  return table;
}

export function lineDiff(oldText: string | null | undefined, newText: string): DiffLine[] {
  const before = oldText ? oldText.split("\n") : [];
  const after = newText.split("\n");
  if (before.length * after.length > MAX_LCS_CELLS) {
    return [
      ...before.map((text): DiffLine => ({ kind: "removed", text })),
      ...after.map((text): DiffLine => ({ kind: "added", text })),
    ];
  }
  const table = longestCommonSubsequenceTable(before, after);
  const lines: DiffLine[] = [];
  let [i, j] = [0, 0];
  while (i < before.length || j < after.length) {
    if (i < before.length && j < after.length && before[i] === after[j]) {
      lines.push({ kind: "same", text: before[i++]! });
      j++;
    } else if (i < before.length && (j === after.length || table[i + 1]![j]! >= table[i]![j + 1]!)) {
      lines.push({ kind: "removed", text: before[i++]! });
    } else {
      lines.push({ kind: "added", text: after[j++]! });
    }
  }
  return lines;
}
