import { describe, expect, test } from "bun:test";
import { blocksOfMessage, inlinesOfLine, markdownOf, markdownOfRuns, parseMessage, type Block, type Inline } from "../shared/slack-markdown.ts";

/** Text a person might send, much of it code-like, which must come back exactly as typed. */
const AS_TYPED = [
  "rename some_var_name to other_var",
  "2 * 3 * 4 = 24",
  "check src/**/*.ts and web/*.tsx",
  "git diff HEAD~1 and ~/prj",
  "C:\\Users\\perdos\\prj\\file.ts",
  "look at [Image #1] and [Image #2]",
  "Review {{file}} for {{concern}}",
  "see @web/Chat.tsx and @shared/model.ts",
  "/compact keep the plan",
  "!git log -- 'src/**/*.ts' | head",
  '<div class="x">\nline\n</div>',
  "before\n\n    indented code\n    more\n\nafter",
  "line with trailing spaces   \nnext\tline\twith\ttabs",
  "one\n\n\n\nfour blank lines above",
  "an array a[0] and [link text] and <T>",
  "# not a heading\n#123 issue",
  "1) first\n2) second",
  "escape \\n and \\* stays",
  "https://example.com/a_b_c?x=1&y=*2*",
  "x < y > z && a | b",
  "- item\n- item two\n\n---\n\n* star item",
  "**bold** and *italic* and `code` and ~~strike~~",
  "```ts\nconst a = 1;\n```",
  "> quoted\n> two",
  "[text](https://example.com)",
  "Look:\n```\ncode\n```\n> said\n- a\n- b\n1. one\n2. two\nend",
  "**bold *and italic* inside**",
  "3. starts at three\n4. four",
  "",
  "\n\n",
  "text\n",
  "```\nnever closed",
  "```\n```",
  "naïve 日本語 🎉 **ünï**",
  "| a | b |\n|---|---|\n| 1 | 2 |",
  "***both*** and **bold *and italic*** and **a *b* c**",
  "**`code` in bold** and *~~struck~~*",
  "**fine**\n3. odd list\n4. two\n- **ok** list",
];

const marked = (inlines: Inline[]) => inlines.flatMap((inline) => (inline.kind === "text" && inline.marks.length ? [[inline.text, ...inline.marks]] : []));
const kinds = (blocks: Block[]) => blocks.map((block) => block.kind);

describe("a message reads back exactly as it was typed", () => {
  test.each(AS_TYPED)("%j", (text) => {
    expect(markdownOf(parseMessage(text))).toBe(text);
  });
});

describe("Slack's set", () => {
  test("bold, italic, strikethrough and inline code", () => {
    expect(marked(inlinesOfLine("**bold** and *italic* and ~~strike~~ and `code`"))).toEqual([
      ["bold", "bold"],
      ["italic", "italic"],
      ["strike", "strike"],
      ["code", "code"],
    ]);
  });

  test("a link with its text", () => {
    expect(inlinesOfLine("see [the docs](https://example.com/a) now")).toEqual([
      { kind: "text", text: "see ", marks: [] },
      { kind: "link", url: "https://example.com/a", text: "the docs" },
      { kind: "text", text: " now", marks: [] },
    ]);
  });

  test("a code block, a quote, and both kinds of list, between lines of text", () => {
    const blocks = parseMessage("Look:\n```ts\nconst a = 1;\n```\n> said\n- a\n- b\n1. one\n2. two\nend");
    expect(kinds(blocks)).toEqual(["lines", "code", "quote", "list", "list", "lines"]);
    expect(blocks[1]).toEqual({ kind: "code", language: "ts", code: "const a = 1;" });
    expect(blocks[3]).toMatchObject({ ordered: false, items: [[{ text: "a" }], [{ text: "b" }]] });
    expect(blocks[4]).toMatchObject({ ordered: true });
  });

  test("each line break is kept, blank lines included", () => {
    expect(parseMessage("one\n\ntwo")).toEqual([
      {
        kind: "lines",
        inlines: [{ kind: "text", text: "one", marks: [] }, { kind: "break" }, { kind: "break" }, { kind: "text", text: "two", marks: [] }],
      },
    ]);
  });
});

describe("pairs inside pairs", () => {
  test.each([
    ["***both***", [["both", "bold", "italic"]]],
    ["**bold *and italic***", [["bold ", "bold"], ["and italic", "bold", "italic"]]],
    ["**a *b* c**", [["a ", "bold"], ["b", "bold", "italic"], [" c", "bold"]]],
    ["**`x`**", [["x", "bold", "code"]]],
  ])("%s", (line, expected) => {
    expect(marked(inlinesOfLine(line))).toEqual(expected);
  });
});

test("one block that can't be written back the same reads as typed, and the others are still formatted", () => {
  const blocks = parseMessage("**fine**\n3. odd list\n4. two\n- **ok** list");
  expect(kinds(blocks)).toEqual(["lines", "lines", "list"]);
  expect(marked((blocks[0] as { inlines: Inline[] }).inlines)).toEqual([["fine", "bold"]]);
  expect(marked((blocks[1] as { inlines: Inline[] }).inlines)).toEqual([]);
});

describe("what stays as typed", () => {
  test.each([
    ["arithmetic", "2 * 3 * 4 = 24"],
    ["a glob", "check src/**/*.ts and web/*.tsx"],
    ["a snake_case name", "rename some_var_name"],
    ["a marker with a space inside it", "**bold ** stays"],
    ["a marker in the middle of a word", "the a*b*c case"],
    ["a URL with stars", "https://example.com/?y=*2*"],
  ])("%s", (_, text) => {
    expect(marked(inlinesOfLine(text))).toEqual([]);
  });

  test("headings, tables, rules and HTML are text", () => {
    expect(kinds(parseMessage("# title\n| a | b |\n---\n<div>x</div>"))).toEqual(["lines"]);
  });

  test("an unclosed fence is text, not the start of a block", () => {
    expect(kinds(parseMessage("```\nnever closed"))).toEqual(["lines"]);
  });

  test("a list it couldn't write back the same, numbered from 3, reads as plain lines rather than renumbered", () => {
    const blocks = parseMessage("3. starts at three\n4. four");
    expect(kinds(blocks)).toEqual(["lines"]);
    expect(marked((blocks[0] as { inlines: Inline[] }).inlines)).toEqual([]);
  });
});

test.each(["/compact keep **this**", "!echo *x*", "  /review `web`"])("a command, %j, reads as typed", (text) => {
  expect(blocksOfMessage(text)).toEqual([{ kind: "lines", inlines: [{ kind: "text", text, marks: [] }] }]);
});

test("any other message is formatted", () => {
  expect(kinds(blocksOfMessage("run:\n```\nls\n```"))).toEqual(["lines", "code"]);
});

describe("what the box writes", () => {
  test("formatting applied in the box gets its markers, nested in one order", () => {
    expect(markdownOf([{ kind: "lines", inlines: [{ kind: "text", text: "both", marks: ["italic", "bold"] }] }])).toBe("***both***");
    expect(markdownOf([{ kind: "lines", inlines: [{ kind: "text", text: "x", marks: ["code", "bold"] }] }])).toBe("**`x`**");
  });

  test("spaces at the edge of a formatted run go outside its markers, so it still reads as formatted", () => {
    expect(markdownOfRuns([{ text: "foo ", marks: ["bold"] }, { text: "bar", marks: [] }]).markdown).toBe("**foo** bar");
    expect(markdownOfRuns([{ text: " a ", marks: ["italic"] }]).markdown).toBe(" *a* ");
  });

  test("runs that share a mark share its markers", () => {
    expect(markdownOfRuns([{ text: "a ", marks: ["bold"] }, { text: "b", marks: ["bold", "italic"] }, { text: " c", marks: ["bold"] }]).markdown).toBe("**a *b* c**");
  });

  test("a code run holding a backtick is written plain, as markdown can't hold it", () => {
    expect(markdownOfRuns([{ text: "a`b", marks: ["code"] }]).markdown).toBe("a`b");
  });

  test("each piece of a run is placed where its text went", () => {
    const { markdown, placed } = markdownOfRuns([{ text: "go ", marks: [] }, { text: "bold ", marks: ["bold"] }, { text: "docs", marks: [], url: "https://x.dev" }]);
    expect(markdown).toBe("go **bold** [docs](https://x.dev)");
    expect(placed.map(({ run, from, at, length }) => [run, from, markdown.slice(at, at + length)])).toEqual([
      [0, 0, "go"],
      [0, 2, " "],
      [1, 0, "bold"],
      [1, 4, " "],
      [2, 0, "docs"],
    ]);
  });

  test("blocks go on lines of their own", () => {
    expect(
      markdownOf([
        { kind: "lines", inlines: [{ kind: "text", text: "Run:", marks: [] }] },
        { kind: "code", language: "", code: "npm test" },
        { kind: "list", ordered: true, items: [[{ kind: "text", text: "a", marks: [] }], [{ kind: "text", text: "b", marks: [] }]] },
      ]),
    ).toBe("Run:\n```\nnpm test\n```\n1. a\n2. b");
  });
});

test("a long line of openers that never close, or of ordinary formatting, is read in one pass", () => {
  for (const line of ["x *a ".repeat(20_000), " **a".repeat(20_000), "some **bold** and *it* text ".repeat(3_000)]) {
    const start = performance.now();
    expect(markdownOf(parseMessage(line))).toBe(line);
    expect(performance.now() - start).toBeLessThan(300);
  }
});
