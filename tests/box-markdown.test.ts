import { describe, expect, test } from "bun:test";
import { createHeadlessEditor } from "@lexical/headless";
import { $createParagraphNode, $createTextNode, $getRoot, $getSelection, $isRangeSelection, type TextFormatType } from "lexical";
import { QuoteNode } from "@lexical/rich-text";
import { ListItemNode, ListNode } from "@lexical/list";
import { CodeNode } from "@lexical/code";
import { LinkNode } from "@lexical/link";
import { $readBox, $selectOffsets, $writeBox, offsetOf } from "../web/box-markdown.ts";
import { inlinesOfLine, type Inline } from "../shared/slack-markdown.ts";

const editor = createHeadlessEditor({ nodes: [QuoteNode, ListNode, ListItemNode, CodeNode, LinkNode], onError: (error) => { throw error; } });
const update = (change: () => void) => editor.update(change, { discrete: true });
const written = () => editor.read($writeBox);

const MESSAGES = [
  "",
  "plain",
  "one\n\ntwo\n\n\n",
  "**bold** and *italic* and `code` and ~~strike~~ and [docs](https://x.dev)",
  "***both*** and **a *b* c**",
  "Look:\n```ts\nconst a = 1;\n\nb();\n```\n> said\n> two\n- a\n- **b**\n1. one\n2. two\nend",
  "```\n```",
  "> ",
  "- item\n\n- other",
  "3. odd\n4. list\n**fine**",
  "src/**/*.ts and 2 * 3 * 4 and some_var",
  "[Image #1] {{file}} @web/Chat.tsx",
];

describe("markdown put in the box is written back the same", () => {
  test.each(MESSAGES)("%j", (markdown) => {
    update(() => $readBox(markdown));
    expect(written().markdown).toBe(markdown);
  });
});

describe("an offset in the text, or on an empty line, maps to a point in the box and back", () => {
  test.each(MESSAGES)("%j", (markdown) => {
    update(() => $readBox(markdown));
    const box = written();
    const inText = (offset: number) => box.texts.some(({ at, length }) => offset >= at && offset <= at + length);
    const emptyLine = (offset: number) => box.lines.some(({ at }) => at === offset) && (offset === markdown.length || markdown[offset] === "\n");
    for (let offset = 0; offset <= markdown.length; offset++) {
      if (!inText(offset) && !emptyLine(offset)) continue;
      update(() => $selectOffsets(box, offset, offset));
      const back = editor.read(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) throw new Error("no range selection");
        return offsetOf(box, selection.anchor);
      });
      expect([offset, back]).toEqual([offset, offset]);
    }
  });
});

const marked = (inlines: Inline[]) => inlines.flatMap((inline) => (inline.kind === "text" && inline.marks.length ? [[inline.text, ...inline.marks]] : []));

/** What a person can do with the shortcuts: runs of text, each with its own formats, on one line. */
function boxWithRuns(runs: [string, TextFormatType[]][]) {
  update(() => {
    const paragraph = $createParagraphNode();
    for (const [text, formats] of runs) {
      const node = $createTextNode(text);
      formats.forEach((format) => node.toggleFormat(format));
      paragraph.append(node);
    }
    $getRoot().clear().append(paragraph);
  });
  return written().markdown;
}

describe("formatting applied in the box shows the same in the sent message", () => {
  test.each<[string, [string, TextFormatType[]][], string[][]]>([
    ["bold with a space selected after it", [["foo ", ["bold"]], ["bar", []]], [["foo", "bold"]]],
    ["italic inside bold", [["a ", ["bold"]], ["b", ["bold", "italic"]], [" c", ["bold"]]], [["a ", "bold"], ["b", "bold", "italic"], [" c", "bold"]]],
    ["bold and italic together", [["both", ["bold", "italic"]]], [["both", "bold", "italic"]]],
    ["code in bold", [["x", ["bold", "code"]]], [["x", "bold", "code"]]],
    ["struck words", [["old", ["strikethrough"]], [" new", []]], [["old", "strike"]]],
  ])("%s", (_, runs, expected) => {
    expect(marked(inlinesOfLine(boxWithRuns(runs)))).toEqual(expected);
  });

  test("code holding a backtick goes out as plain text, with no stray markers", () => {
    expect(boxWithRuns([["a`b", ["code"]]])).toBe("a`b");
  });

  test("formatting inside a word can't be written in markdown, and its markers go out as typed", () => {
    expect(boxWithRuns([["un", []], ["do", ["bold"]], ["ne", []]])).toBe("un**do**ne");
    expect(marked(inlinesOfLine("un**do**ne"))).toEqual([]);
  });
});
