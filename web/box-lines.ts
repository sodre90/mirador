/**
 * The block buttons of the formatted box work on its markdown, as typing does: the lines the selection covers become a
 * quote, a list or a code block, or stop being one, and the box reads the result back.
 */

export type LineBlock = "quote" | "bullet" | "numbered" | "code";

export interface Rewritten {
  markdown: string;
  start: number;
  end: number;
}

const FENCE = /^```/;
const PREFIX: Record<Exclude<LineBlock, "code">, RegExp> = { quote: /^> /, bullet: /^- /, numbered: /^\d+\. / };
const ANY_PREFIX = /^(> |- |\d+\. )/;

/** The fence lines around the offset when it is inside a code block: the index of the opening and closing fence lines. */
function fencesAround(lines: string[], line: number) {
  let open: number | null = null;
  for (const [index, text] of lines.entries()) {
    if (!FENCE.test(text)) continue;
    if (open === null) open = index;
    else {
      if (line > open && line < index) return { open, close: index };
      open = null;
    }
  }
  return null;
}

const lineAt = (markdown: string, offset: number) => markdown.slice(0, offset).split("\n").length - 1;

/** A change at `at` in the old text: `removed` characters replaced by `added`, with a caret at `at` moved past them when it `pushes`. */
interface Edit {
  at: number;
  removed: number;
  added: number;
  pushes: boolean;
}

/** Where an offset into the old text lands in the new one. */
const shifted = (offset: number, edits: Edit[]) =>
  edits.reduce((moved, { at, removed, added, pushes }) => {
    if (offset < at || (offset === at && !pushes)) return moved;
    if (offset <= at + removed) return moved + at - offset + added;
    return moved + added - removed;
  }, offset);

/** Numbers from 1 each run of numbered lines that holds or borders the lines from `first` to `last`, so it reads as one list. */
function renumberListsTouching(lines: string[], first: number, last: number) {
  const numbered = (index: number) => PREFIX.numbered.test(lines[index] ?? "");
  for (let index = Math.max(first - 1, 0); index <= Math.min(last + 1, lines.length - 1); index++) {
    if (!numbered(index)) continue;
    let runStart = index;
    while (runStart > 0 && numbered(runStart - 1)) runStart--;
    let number = 1;
    for (let line = runStart; numbered(line); line++, number++) lines[line] = lines[line]!.replace(PREFIX.numbered, `${number}. `);
    while (numbered(index + 1)) index++;
  }
}

/** The block that holds the line with the offset: what its button shows as pressed. */
export function blockAt(markdown: string, offset: number): LineBlock | null {
  const lines = markdown.split("\n");
  const line = lineAt(markdown, offset);
  if (fencesAround(lines, line)) return "code";
  const text = lines[line] ?? "";
  return (Object.keys(PREFIX) as (keyof typeof PREFIX)[]).find((block) => PREFIX[block].test(text)) ?? null;
}

/** The markdown with the lines from `start` to `end` turned into the block, or out of it when they all are one already. */
export function toggleBlock(markdown: string, start: number, end: number, block: LineBlock): Rewritten {
  const lines = markdown.split("\n");
  const [first, last] = [lineAt(markdown, start), lineAt(markdown, end)];
  const starts: number[] = [];
  lines.reduce((at, text) => (starts.push(at), at + text.length + 1), 0);
  const lineStart = (index: number) => starts[index]!;
  const edits: Edit[] = [];

  const fences = fencesAround(lines, first);
  const coveredByCode = (index: number) => FENCE.test(lines[index]!) || fencesAround(lines, index) !== null;
  const covered = lines.slice(first, last + 1);
  const withinOneCodeBlock = fences !== null && last < fences.close;
  if (!withinOneCodeBlock && covered.some((_, index) => coveredByCode(first + index))) return { markdown, start, end };

  if (block === "code" && fences) {
    edits.push({ at: lineStart(fences.open), removed: lines[fences.open]!.length + 1, added: 0, pushes: false });
    edits.push({ at: lineStart(fences.close) - 1, removed: lines[fences.close]!.length + 1, added: 0, pushes: false });
    lines.splice(fences.close, 1);
    lines.splice(fences.open, 1);
  } else if (block === "code") {
    edits.push({ at: lineStart(first), removed: 0, added: 4, pushes: true });
    edits.push({ at: lineStart(last) + lines[last]!.length, removed: 0, added: 4, pushes: false });
    lines.splice(last + 1, 0, "```");
    lines.splice(first, 0, "```");
  } else {
    if (fences) return { markdown, start, end };
    const removing = covered.every((text) => PREFIX[block].test(text));
    const rewritten = [...lines];
    covered.forEach((text, index) => {
      const prefix = removing ? "" : block === "quote" ? "> " : block === "bullet" ? "- " : "1. ";
      rewritten[first + index] = prefix + text.slice(text.match(ANY_PREFIX)?.[0].length ?? 0);
    });
    renumberListsTouching(rewritten, first, last);
    rewritten.forEach((text, index) => {
      if (text === lines[index]) return;
      const [oldPrefix, newPrefix] = [lines[index]!.match(ANY_PREFIX)?.[0] ?? "", text.match(ANY_PREFIX)?.[0] ?? ""];
      edits.push({ at: lineStart(index), removed: oldPrefix.length, added: newPrefix.length, pushes: true });
      lines[index] = text;
    });
  }
  return { markdown: lines.join("\n"), start: shifted(start, edits), end: shifted(end, edits) };
}
