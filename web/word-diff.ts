import { longestCommonSubsequenceTable } from "./diff.ts";
import { splitRows } from "./edit-approval.ts";

/** A run of a line's characters, from `start` up to `end`. */
export interface TextRange {
  start: number;
  end: number;
}

const MAX_TOKEN_CELLS = 250_000;
/**
 * Below this share of the two lines' word characters kept, the line was rewritten rather than edited, and marking words
 * only adds noise. Punctuation is left out, since lines that keep only their brackets and commas were still rewritten,
 * unless neither line has a word, as in `});` → `}));`.
 */
const MIN_KEPT_SHARE = 0.4;
/** A line kept this nearly whole inside a longer one grew rather than was rewritten, as in `foo()` → `foo(a, b)`. */
const MIN_GROWN_SHARE = 0.9;
/** Shorter lines than this, as `x = 1`, turn up by chance inside an unrelated long line they happen to face. */
const MIN_GROWN_LENGTH = 3;

const tokensOf = (line: string) => line.match(/[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu) ?? [];
const isWord = (token: string) => /^[\p{L}\p{N}_]/u.test(token);
const isVisible = (token: string) => /\S/.test(token);

/** Which tokens of each line are in a longest common subsequence of the two. */
function keptTokens(before: string[], after: string[]) {
  const table = longestCommonSubsequenceTable(before, after);
  const keptBefore = before.map(() => false);
  const keptAfter = after.map(() => false);
  let [i, j] = [0, 0];
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      keptBefore[i++] = true;
      keptAfter[j++] = true;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) i++;
    else j++;
  }
  return { keptBefore, keptAfter };
}

/** The ranges of tokens not kept, with the whitespace between two of them taken in, so a changed phrase reads as one. */
function changedRanges(line: string, tokens: string[], kept: boolean[]): TextRange[] {
  const ranges: TextRange[] = [];
  let offset = 0;
  tokens.forEach((token, index) => {
    const end = offset + token.length;
    if (!kept[index]) {
      const last = ranges.at(-1);
      if (last && /^\s*$/.test(line.slice(last.end, offset))) last.end = end;
      else ranges.push({ start: offset, end });
    }
    offset = end;
  });
  return ranges;
}

const lengthOf = (tokens: string[], counts: (token: string) => boolean, counted: (index: number) => boolean = () => true) =>
  tokens.reduce((sum, token, index) => sum + (counted(index) && counts(token) ? token.length : 0), 0);

function editedRatherThanRewritten(beforeTokens: string[], afterTokens: string[], keptBefore: boolean[]) {
  const counts = [...beforeTokens, ...afterTokens].some(isWord) ? isWord : isVisible;
  const kept = lengthOf(beforeTokens, counts, (index) => keptBefore[index]!);
  const [beforeLength, afterLength] = [lengthOf(beforeTokens, counts), lengthOf(afterTokens, counts)];
  const shorter = Math.min(beforeLength, afterLength);
  const keepsEnoughOfBoth = kept > 0 && 2 * kept >= MIN_KEPT_SHARE * (beforeLength + afterLength);
  const grewFromShorter = shorter >= MIN_GROWN_LENGTH && kept >= MIN_GROWN_SHARE * shorter;
  return keepsEnoughOfBoth || grewFromShorter;
}

/**
 * What changed between a removed line and the added line that replaces it, as ranges of each; null when the two have
 * too little in common for the ranges to help, or are too long to compare.
 */
export function wordChanges(before: string, after: string): { removed: TextRange[]; added: TextRange[] } | null {
  const [beforeTokens, afterTokens] = [tokensOf(before), tokensOf(after)];
  if (beforeTokens.length * afterTokens.length > MAX_TOKEN_CELLS) return null;
  const { keptBefore, keptAfter } = keptTokens(beforeTokens, afterTokens);
  if (!editedRatherThanRewritten(beforeTokens, afterTokens, keptBefore)) return null;
  return { removed: changedRanges(before, beforeTokens, keptBefore), added: changedRanges(after, afterTokens, keptAfter) };
}

/**
 * The changed words of each row of a diff, or null for a row they are not marked on. Each run of removed rows faces
 * the run of added rows right after it, line by line, as a split diff lays them out.
 */
export function rowWordChanges(rows: { kind: string; text: string }[]): (TextRange[] | null)[] {
  const changes: (TextRange[] | null)[] = rows.map(() => null);
  splitRows(rows)
    .flatMap(({ left, right }) => (left !== null && right !== null && left !== right ? [{ left, right }] : []))
    .forEach(({ left, right }) => {
      const ranges = wordChanges(rows[left]!.text, rows[right]!.text);
      if (ranges) [changes[left], changes[right]] = [ranges.removed, ranges.added];
    });
  return changes;
}

/** Cuts a line's pieces where the changed ranges start and end, marking the pieces inside them. */
export function markChanged<Piece extends { text: string }>(pieces: Piece[], ranges: TextRange[]): (Piece & { changed: boolean })[] {
  const marked: (Piece & { changed: boolean })[] = [];
  let offset = 0;
  pieces.forEach((piece) => {
    const [start, end] = [offset, offset + piece.text.length];
    const cuts = [start, ...ranges.flatMap((range) => [range.start, range.end]).filter((at) => at > start && at < end), end];
    cuts.slice(1).forEach((cut, index) => {
      const from = cuts[index]!;
      const changed = ranges.some((range) => range.start <= from && from < range.end);
      marked.push({ ...piece, text: piece.text.slice(from - start, cut - start), changed });
    });
    offset = end;
  });
  return marked;
}
