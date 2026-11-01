import {
  $createLineBreakNode,
  $createParagraphNode,
  $createPoint,
  $createRangeSelection,
  $createTextNode,
  $getNodeByKey,
  $getRoot,
  $isElementNode,
  $isLineBreakNode,
  $isParagraphNode,
  $isTextNode,
  $setSelection,
  type ElementNode,
  type LexicalNode,
  type NodeKey,
  type PointType,
  type TextFormatType,
  type TextNode,
} from "lexical";
import { $createQuoteNode, $isQuoteNode } from "@lexical/rich-text";
import { $createListItemNode, $createListNode, $isListItemNode, $isListNode } from "@lexical/list";
import { $createCodeNode, $isCodeNode } from "@lexical/code";
import { $createLinkNode, $isLinkNode } from "@lexical/link";
import { linesOfInlines, markdownOfRuns, parseMessage, type Block, type Inline, type Mark, type Run } from "../shared/slack-markdown.ts";

/**
 * The formatted message box and the markdown it stands for. The box is written out as the text the agent gets, and every
 * piece of composer code (mentions, templates, dictation, pasted images, history) keeps working on that text and on
 * caret offsets into it: the places recorded while writing turn an offset into a point in the box and back.
 */

const FORMATS: [Mark, TextFormatType][] = [
  ["bold", "bold"],
  ["italic", "italic"],
  ["strike", "strikethrough"],
  ["code", "code"],
];

/** Where a text node's text went: from `from` in the node, `length` long, at `at` in the markdown. */
interface TextPlace {
  key: NodeKey;
  from: number;
  at: number;
  length: number;
}

/** Where a line starts: before child `child` of the element, at `at` in the markdown. */
interface LineStart {
  key: NodeKey;
  child: number;
  at: number;
}

export interface WrittenBox {
  markdown: string;
  texts: TextPlace[];
  lines: LineStart[];
}

const marksOf = (node: TextNode) => FORMATS.filter(([, format]) => node.hasFormat(format)).map(([mark]) => mark);

type LinePart = { run: Run; texts: TextNode[] };

function partOf(node: LexicalNode): LinePart {
  if ($isLinkNode(node)) return { run: { text: node.getTextContent(), marks: [], url: node.getURL() }, texts: node.getChildren().filter($isTextNode) };
  if ($isTextNode(node)) return { run: { text: node.getTextContent(), marks: marksOf(node) }, texts: [node] };
  return { run: { text: node.getTextContent(), marks: [] }, texts: [] };
}

/** The children of an element as lines, split at its line breaks, each with the index of the child it starts at. */
function linesIn(element: ElementNode) {
  const lines: { child: number; nodes: LexicalNode[] }[] = [{ child: 0, nodes: [] }];
  element.getChildren().forEach((node, index) => {
    if ($isLineBreakNode(node)) lines.push({ child: index + 1, nodes: [] });
    else lines.at(-1)!.nodes.push(node);
  });
  return lines;
}

class Writer {
  markdown = "";
  texts: TextPlace[] = [];
  lines: LineStart[] = [];

  line(element: ElementNode, child: number, nodes: LexicalNode[], prefix = "") {
    this.markdown += prefix;
    this.lines.push({ key: element.getKey(), child, at: this.markdown.length });
    const parts = nodes.map(partOf);
    const { markdown, placed } = markdownOfRuns(parts.map(({ run }) => run));
    const start = this.markdown.length;
    for (const { run, from, at, length } of placed) this.placeTexts(parts[run]!.texts, from, start + at, length);
    this.markdown += markdown;
  }

  /** A piece of a run, spread over the text nodes it came from: a link's text can be several. */
  placeTexts(texts: TextNode[], from: number, at: number, length: number) {
    let nodeStart = 0;
    for (const text of texts) {
      const size = text.getTextContentSize();
      const overlapFrom = Math.max(from, nodeStart);
      const overlapTo = Math.min(from + length, nodeStart + size);
      if (overlapTo > overlapFrom || (size === 0 && from === nodeStart))
        this.texts.push({ key: text.getKey(), from: overlapFrom - nodeStart, at: at + overlapFrom - from, length: overlapTo - overlapFrom });
      nodeStart += size;
    }
  }

  linesOf(element: ElementNode, prefix = "") {
    linesIn(element).forEach(({ child, nodes }, index) => {
      if (index > 0) this.markdown += "\n";
      this.line(element, child, nodes, prefix);
    });
  }

  code(block: ElementNode & { getLanguage(): string | null | undefined }) {
    this.markdown += `\`\`\`${block.getLanguage() ?? ""}\n`;
    linesIn(block).forEach(({ child, nodes }, index) => {
      if (index > 0) this.markdown += "\n";
      this.lines.push({ key: block.getKey(), child, at: this.markdown.length });
      for (const node of nodes) {
        const text = node.getTextContent();
        if ($isTextNode(node)) this.texts.push({ key: node.getKey(), from: 0, at: this.markdown.length, length: text.length });
        this.markdown += text;
      }
    });
    this.markdown += "\n```";
  }

  block(block: LexicalNode) {
    if ($isCodeNode(block)) this.code(block);
    else if ($isQuoteNode(block)) this.linesOf(block, "> ");
    else if ($isListNode(block)) {
      const numbered = block.getListType() === "number";
      block
        .getChildren()
        .filter($isListItemNode)
        .forEach((item, index) => {
          if (index > 0) this.markdown += "\n";
          this.line(item, 0, item.getChildren().filter((node) => !$isLineBreakNode(node)), numbered ? `${index + 1}. ` : "- ");
        });
    } else if ($isElementNode(block)) this.linesOf(block);
    else this.markdown += block.getTextContent();
  }
}

/** The box as the markdown the agent gets, with where each piece of it went. */
export function $writeBox(): WrittenBox {
  const writer = new Writer();
  $getRoot()
    .getChildren()
    .forEach((block, index) => {
      if (index > 0) writer.markdown += "\n";
      writer.block(block);
    });
  return { markdown: writer.markdown, texts: writer.texts, lines: writer.lines };
}

function textNodeOf(text: string, marks: Mark[]) {
  const node = $createTextNode(text);
  FORMATS.filter(([mark]) => marks.includes(mark)).forEach(([, format]) => node.toggleFormat(format));
  return node;
}

function appendInlines(parent: ElementNode, inlines: Inline[]) {
  for (const inline of inlines) {
    if (inline.kind === "break") parent.append($createLineBreakNode());
    else if (inline.kind === "link") parent.append($createLinkNode(inline.url).append($createTextNode(inline.text)));
    else parent.append(textNodeOf(inline.text, inline.marks));
  }
}

function nodesOf(block: Block): ElementNode[] {
  switch (block.kind) {
    case "lines":
      return linesOfInlines(block.inlines).map((line) => {
        const paragraph = $createParagraphNode();
        appendInlines(paragraph, line);
        return paragraph;
      });
    case "quote": {
      const quote = $createQuoteNode();
      appendInlines(quote, block.inlines);
      return [quote];
    }
    case "list": {
      const list = $createListNode(block.ordered ? "number" : "bullet");
      for (const item of block.items) {
        const node = $createListItemNode();
        appendInlines(node, item);
        list.append(node);
      }
      return [list];
    }
    case "code": {
      const code = $createCodeNode(block.language || undefined);
      block.code.split("\n").forEach((line, index) => {
        if (index > 0) code.append($createLineBreakNode());
        if (line) code.append($createTextNode(line));
      });
      return [code];
    }
  }
}

/** Puts the markdown in the box, formatted as a sent message shows it: each line of text a paragraph of its own. */
export function $readBox(markdown: string) {
  const root = $getRoot();
  root.clear();
  root.append(...parseMessage(markdown).flatMap(nodesOf));
}

const distance = (offset: number, from: number, to: number) => (offset < from ? from - offset : offset > to ? offset - to : 0);

/** The point in the box nearest the markdown offset: inside the text there, or at the edge of the nearest text on its line. */
function pointAt(written: WrittenBox, offset: number): { key: NodeKey; offset: number; type: "text" | "element" } {
  const nearestText = written.texts.reduce<TextPlace | null>(
    (best, place) => (!best || distance(offset, place.at, place.at + place.length) < distance(offset, best.at, best.at + best.length) ? place : best),
    null,
  );
  const nearestLine = written.lines.reduce<LineStart | null>((best, line) => (!best || Math.abs(offset - line.at) < Math.abs(offset - best.at) ? line : best), null);
  const textDistance = nearestText ? distance(offset, nearestText.at, nearestText.at + nearestText.length) : Infinity;
  if (nearestText && (!nearestLine || textDistance <= Math.abs(offset - nearestLine.at))) {
    const within = Math.min(Math.max(offset - nearestText.at, 0), nearestText.length);
    return { key: nearestText.key, offset: nearestText.from + within, type: "text" };
  }
  return nearestLine ? { key: nearestLine.key, offset: nearestLine.child, type: "element" } : { key: $getRoot().getKey(), offset: 0, type: "element" };
}

/** The markdown offset of a point in the box. */
export function offsetOf(written: WrittenBox, point: { key: NodeKey; offset: number; type: "text" | "element" }): number {
  if (point.type === "text") {
    const place = written.texts.find(({ key, from, length }) => key === point.key && point.offset >= from && point.offset <= from + length);
    if (place) return place.at + point.offset - place.from;
  }
  const node = $getNodeByKey(point.key);
  if (point.type === "element" && $isElementNode(node)) {
    const before = node.getChildAtIndex(point.offset - 1);
    if ($isTextNode(before)) return offsetOf(written, { key: before.getKey(), offset: before.getTextContentSize(), type: "text" });
    const after = node.getChildAtIndex(point.offset);
    if ($isTextNode(after)) return offsetOf(written, { key: after.getKey(), offset: 0, type: "text" });
    const line = written.lines.filter(({ key, child }) => key === point.key && child <= point.offset).at(-1);
    if (line) return line.at;
  }
  const parent = node?.getParent();
  const lineOfParent = parent && written.lines.find(({ key }) => key === parent.getKey());
  return lineOfParent ? lineOfParent.at : written.markdown.length;
}

/** Selects the range between two markdown offsets in the box. */
export function $selectOffsets(written: WrittenBox, start: number, end: number) {
  const selection = $createRangeSelection();
  const toPoint = ({ key, offset, type }: ReturnType<typeof pointAt>): PointType => $createPoint(key, offset, type);
  selection.anchor = toPoint(pointAt(written, start));
  selection.focus = toPoint(pointAt(written, end));
  $setSelection(selection);
}

