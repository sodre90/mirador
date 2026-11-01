import { describe, expect, test } from "bun:test";
import { blockAt, toggleBlock, type LineBlock } from "../web/box-lines.ts";
import { blocksOfMessage } from "../shared/slack-markdown.ts";

/** The markdown with `[` and `]` marking the selection, as the box would hold it. */
function marked(text: string) {
  const start = text.indexOf("[");
  const end = text.indexOf("]") - 1;
  return { markdown: text.replace("[", "").replace("]", ""), start, end };
}

const toggled = (text: string, block: LineBlock) => {
  const { markdown, start, end } = marked(text);
  const result = toggleBlock(markdown, start, end, block);
  return `${result.markdown.slice(0, result.start)}[${result.markdown.slice(result.start, result.end)}]${result.markdown.slice(result.end)}`;
};

describe("the lines the selection covers become the block", () => {
  test.each<[string, LineBlock, string]>([
    ["say [hi]", "quote", "> say [hi]"],
    ["[a\nb]\nc", "bullet", "- [a\n- b]\nc"],
    ["intro\n[a\nb]", "numbered", "intro\n1. [a\n2. b]"],
    ["[]", "bullet", "- []"],
    ["x\n[npm test]\ny", "code", "x\n```\n[npm test]\n```\ny"],
    ["[]", "code", "```\n[]\n```"],
    ["- [a\n- b]", "numbered", "1. [a\n2. b]"],
  ])("%j as %s", (text, block, expected) => {
    expect(toggled(text, block)).toBe(expected);
  });
});

describe("pressed again, they stop being it", () => {
  test.each<[string, LineBlock, string]>([
    ["> say [hi]", "quote", "say [hi]"],
    ["- [a\n- b]\nc", "bullet", "[a\nb]\nc"],
    ["x\n```\nnpm [test]\n```\ny", "code", "x\nnpm [test]\ny"],
  ])("%j as %s", (text, block, expected) => {
    expect(toggled(text, block)).toBe(expected);
  });
});

test("a quote or list button does nothing inside a code block", () => {
  expect(toggled("```\n[a]\n```", "quote")).toBe("```\n[a]\n```");
});

test("what a button makes is read back as that block", () => {
  for (const [text, block, kind] of [
    ["[a\nb]", "quote", "quote"],
    ["[a\nb]", "bullet", "list"],
    ["[a\nb]", "numbered", "list"],
    ["[a\nb]", "code", "code"],
  ] as const) {
    const { markdown, start, end } = marked(text);
    expect(blocksOfMessage(toggleBlock(markdown, start, end, block).markdown).map((one) => one.kind)).toEqual([kind]);
  }
});

test.each<[string, LineBlock | null]>([
  ["> [q]", "quote"],
  ["- [b]", "bullet"],
  ["3. [n]", "numbered"],
  ["```\n[c]\n```", "code"],
  ["[plain]", null],
])("the block at %j is %s", (text, block) => {
  const { markdown, start } = marked(text);
  expect(blockAt(markdown, start)).toBe(block);
});

describe("a numbered list next to the lines stays one list", () => {
  test.each<[string, string]>([
    ["1. a\n2. b\n[c]", "1. a\n2. b\n3. [c]"],
    ["1. a\n2. [b]\n3. c", "1. a\n[b]\n1. c"],
  ])("%j", (text, expected) => {
    expect(toggled(text, "numbered")).toBe(expected);
    const { markdown } = marked(expected);
    expect(blocksOfMessage(markdown).some((block) => block.kind === "list")).toBe(true);
  });
});

test.each<LineBlock>(["bullet", "quote", "code"])("a selection crossing a code block's fences is left as it is by %s", (block) => {
  expect(toggled("[intro\n```\nls\n```]", block)).toBe("[intro\n```\nls\n```]");
});
