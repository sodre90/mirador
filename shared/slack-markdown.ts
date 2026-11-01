/**
 * Slack's set of markdown, as a message is written: bold, italic, strikethrough, inline code, code blocks, quotes, lists
 * and links. Everything else, such as `# heading`, a table or `<div>`, is text kept as typed.
 *
 * A message is lines. What was typed is kept byte for byte, so the text the agent receives is the text the person wrote;
 * formatting only reads markers already there. `markdownOf(parseMessage(text))` is always `text`: where the blocks
 * read couldn't give the same text back, the message reads as plain lines instead.
 */

export type Mark = "bold" | "italic" | "strike" | "code";

export type Inline = { kind: "text"; text: string; marks: Mark[] } | { kind: "link"; url: string; text: string } | { kind: "break" };

export type Block =
  | { kind: "lines"; inlines: Inline[] }
  | { kind: "code"; language: string; code: string }
  | { kind: "quote"; inlines: Inline[] }
  | { kind: "list"; ordered: boolean; items: Inline[][] };

/** Markers in the order they nest, outermost first, each in the one spelling the message is written in. */
const MARKERS: [Mark, string][] = [
  ["bold", "**"],
  ["italic", "*"],
  ["strike", "~~"],
  ["code", "`"],
];
const markerOf = (mark: Mark) => MARKERS.find(([each]) => each === mark)![1];
const inMarkerOrder = (marks: Mark[]) => MARKERS.map(([mark]) => mark).filter((mark) => marks.includes(mark));

/**
 * A pair formats only where Slack's would: opening at the start, after a space or an opening bracket, and closing before
 * the end, a space or punctuation, with no space just inside either marker. So `2 * 3 * 4`, `src/**\/*.ts` and
 * `some_var_name` stay as typed. A pair may hold others, as `***both***` and `**bold *and italic***` do.
 */
const OPENS = String.raw`(?<=^|[\s(])`;
const CLOSES = String.raw`(?=$|[\s).,:;!?'"])`;
/** How far a pair reaches: a bound, so a line full of openers that never close is read in one pass, not one per opener. */
const LONGEST_PAIR = 500;
const paired = (opening: string, closing: string) => `${OPENS}${opening}(.{1,${LONGEST_PAIR}}?)${closing}${CLOSES}`;
const INLINE = new RegExp(
  [
    "`([^`\\n]+)`",
    String.raw`\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)`,
    paired(String.raw`\*\*(?!\s)`, String.raw`(?<!\s)\*\*`),
    paired(String.raw`~~(?!\s)`, String.raw`(?<!\s)~~`),
    paired(String.raw`\*(?![\s*])`, String.raw`(?<![\s*])\*`),
  ].join("|"),
  "g",
);

/** Whether the text ends with a pair just closed, as `see **this**` does: a code span, a link or a formatted run. */
export const closesPairAt = (text: string) => [...text.matchAll(INLINE)].some((match) => match.index + match[0].length === text.length);

const withMark = (inlines: Inline[], mark: Mark): Inline[] =>
  inlines.map((inline) => (inline.kind === "text" ? { ...inline, marks: inMarkerOrder([...inline.marks, mark]) } : inline));

export function inlinesOfLine(line: string): Inline[] {
  const inlines: Inline[] = [];
  let last = 0;
  const text = (from: number, to: number) => {
    if (to > from) inlines.push({ kind: "text", text: line.slice(from, to), marks: [] });
  };
  for (const match of line.matchAll(INLINE)) {
    const [whole, code, linkText, url, bold, strike, italic] = match;
    text(last, match.index);
    if (code !== undefined) inlines.push({ kind: "text", text: code, marks: ["code"] });
    else if (url !== undefined) inlines.push({ kind: "link", url, text: linkText! });
    else if (bold !== undefined) inlines.push(...withMark(inlinesOfLine(bold), "bold"));
    else if (strike !== undefined) inlines.push(...withMark(inlinesOfLine(strike), "strike"));
    else inlines.push(...withMark(inlinesOfLine(italic!), "italic"));
    last = match.index + whole.length;
  }
  text(last, line.length);
  return inlines;
}

const linesOf = (lines: string[], read: (line: string) => Inline[]): Inline[] =>
  lines.flatMap((line, index) => (index === 0 ? read(line) : [{ kind: "break" } as const, ...read(line)]));

const asTyped = (line: string): Inline[] => (line ? [{ kind: "text", text: line, marks: [] }] : []);

const FENCE_OPENS = /^```([\w+#-]*)$/;
const FENCE_CLOSES = "```";
const QUOTE = /^> /;
const BULLET = /^- (?=\S)/;
const NUMBERED = /^\d+\. (?=\S)/;

type LineKind = "quote" | "bullet" | "numbered";
const PATTERNS: Record<LineKind, RegExp> = { quote: QUOTE, bullet: BULLET, numbered: NUMBERED };
const kindOf = (line: string) => (Object.keys(PATTERNS) as LineKind[]).find((kind) => PATTERNS[kind].test(line));

function blockOfRun(kind: LineKind, run: string[]): Block {
  if (kind === "quote") return { kind: "quote", inlines: linesOf(run.map((line) => line.replace(QUOTE, "")), inlinesOfLine) };
  return { kind: "list", ordered: kind === "numbered", items: run.map((line) => inlinesOfLine(line.replace(PATTERNS[kind], ""))) };
}

/** A block with the lines it was read from. */
interface Read {
  block: Block;
  lines: string[];
}

function blocksOf(text: string): Read[] {
  const lines = text.split("\n");
  const blocks: Read[] = [];
  let prose: string[] = [];
  const endProse = () => {
    if (prose.length) blocks.push({ block: { kind: "lines", inlines: linesOf(prose, inlinesOfLine) }, lines: prose });
    prose = [];
  };
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    const fence = FENCE_OPENS.exec(line);
    const closing = fence ? lines.indexOf(FENCE_CLOSES, index + 1) : -1;
    if (fence && closing > index) {
      endProse();
      blocks.push({ block: { kind: "code", language: fence[1]!, code: lines.slice(index + 1, closing).join("\n") }, lines: lines.slice(index, closing + 1) });
      index = closing + 1;
      continue;
    }
    const kind = kindOf(line);
    if (!kind) {
      prose.push(line);
      index++;
      continue;
    }
    endProse();
    const run: string[] = [];
    while (index < lines.length && PATTERNS[kind].test(lines[index]!)) run.push(lines[index++]!);
    blocks.push({ block: blockOfRun(kind, run), lines: run });
  }
  endProse();
  return blocks;
}

/** The message as plain lines, nothing formatted. */
export const plainMessage = (text: string): Block[] => [{ kind: "lines", inlines: linesOf(text.split("\n"), asTyped) }];

/** Each block as read, or as the plain lines it was read from where it wouldn't give them back the same, as a list from 3 would. */
export function parseMessage(text: string): Block[] {
  const blocks = blocksOf(text).map(({ block, lines }) => {
    const source = lines.join("\n");
    return markdownOfBlock(block) === source ? block : plainMessage(source)[0]!;
  });
  return markdownOf(blocks) === text ? blocks : plainMessage(text);
}

/** A slash command or a shell line is shown as plain lines: it is run as typed, so it must read as typed. */
export const blocksOfMessage = (text: string): Block[] => (/^\s*[/!]/.test(text) ? plainMessage(text) : parseMessage(text));

/** A stretch of one line with one set of marks. A link's text is a run of its own, with its address and no marks. */
export interface Run {
  text: string;
  marks: Mark[];
  url?: string;
}

/** Where a piece of a run went: its text from `from` in the run, `length` long, starts at `at` in the markdown. */
export interface Placed {
  run: number;
  from: number;
  at: number;
  length: number;
}

interface Piece extends Run {
  index: number;
  from: number;
  edge: boolean;
}

const WHITESPACE_AT_EDGES = /^(\s*)(.*?)(\s*)$/s;
const commonPrefix = (...lists: Mark[][]) => lists.reduce((shared, list) => shared.filter((mark, index) => list[index] === mark));

/**
 * Each run split at the whitespace at its edges, which goes outside any marker that opens or closes there: `**foo **`
 * wouldn't read as bold, `**foo** ` does. A code span keeps its spaces, and one holding a backtick can't be written, so
 * it is plain.
 */
function piecesOf(runs: Run[]): Piece[] {
  const pieces = runs.flatMap((run, index): Piece[] => {
    if (run.url !== undefined || run.marks.includes("code")) {
      const marks = run.url === undefined && !run.text.includes("`") ? inMarkerOrder(run.marks) : inMarkerOrder(run.marks.filter((mark) => mark !== "code"));
      return [{ ...run, marks, index, from: 0, edge: false }];
    }
    const [, lead, core, trail] = WHITESPACE_AT_EDGES.exec(run.text)!;
    const marks = inMarkerOrder(run.marks);
    return [
      { text: lead!, marks, index, from: 0, edge: true },
      { text: core!, marks, index, from: lead!.length, edge: false },
      { text: trail!, marks, index, from: lead!.length + core!.length, edge: true },
    ].filter((piece) => piece.text);
  });
  const marksBefore = nearestInnerMarks(pieces);
  const marksAfter = nearestInnerMarks(pieces.toReversed()).toReversed();
  return pieces.map((piece, at) => (piece.edge ? { ...piece, marks: commonPrefix(piece.marks, marksBefore[at]!, marksAfter[at]!) } : piece));
}

/** For each piece, the marks of the nearest piece before it that isn't whitespace at a run's edge. */
function nearestInnerMarks(pieces: Piece[]) {
  let last: Mark[] = [];
  return pieces.map((piece) => {
    const before = last;
    if (!piece.edge) last = piece.marks;
    return before;
  });
}

/** One line's runs as markdown, its markers opened and closed as the marks change, and where each piece of a run went. */
export function markdownOfRuns(runs: Run[]): { markdown: string; placed: Placed[] } {
  let markdown = "";
  const open: Mark[] = [];
  const placed: Placed[] = [];
  const closeTo = (depth: number) => {
    while (open.length > depth) markdown += markerOf(open.pop()!);
  };
  for (const piece of piecesOf(runs)) {
    if (piece.url !== undefined) {
      closeTo(0);
      markdown += "[";
      placed.push({ run: piece.index, from: piece.from, at: markdown.length, length: piece.text.length });
      markdown += `${piece.text}](${piece.url})`;
      continue;
    }
    const shared = commonPrefix(open, piece.marks).length;
    closeTo(shared);
    for (const mark of piece.marks.slice(shared)) {
      markdown += markerOf(mark);
      open.push(mark);
    }
    placed.push({ run: piece.index, from: piece.from, at: markdown.length, length: piece.text.length });
    markdown += piece.text;
  }
  closeTo(0);
  return { markdown, placed };
}

const runOf = (inline: LineInline): Run =>
  inline.kind === "link" ? { text: inline.text, marks: [], url: inline.url } : { text: inline.text, marks: inline.marks };

export type LineInline = Exclude<Inline, { kind: "break" }>;

/** The inlines of each line, split at the breaks. */
export function linesOfInlines(inlines: Inline[]): LineInline[][] {
  const lines: LineInline[][] = [[]];
  for (const inline of inlines) {
    if (inline.kind === "break") lines.push([]);
    else lines.at(-1)!.push(inline);
  }
  return lines;
}

function markdownOfInlines(inlines: Inline[]): string {
  return linesOfInlines(inlines)
    .map((line) => markdownOfRuns(line.map(runOf)).markdown)
    .join("\n");
}

function markdownOfBlock(block: Block): string {
  switch (block.kind) {
    case "lines":
      return markdownOfInlines(block.inlines);
    case "code":
      return `\`\`\`${block.language}\n${block.code}\n\`\`\``;
    case "quote":
      return markdownOfInlines(block.inlines)
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
    case "list":
      return block.items.map((item, index) => `${block.ordered ? `${index + 1}.` : "-"} ${markdownOfInlines(item)}`).join("\n");
  }
}

/** The blocks as the text they were read from, or as the box writes what was formatted in it. */
export function markdownOf(blocks: Block[]): string {
  return blocks.map(markdownOfBlock).join("\n");
}
