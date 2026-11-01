import { describe, expect, test } from "bun:test";
import { markChanged, rowWordChanges, wordChanges, type TextRange } from "../web/word-diff.ts";

const changedText = (line: string, ranges: TextRange[] | null | undefined) => ranges?.map(({ start, end }) => line.slice(start, end));

describe("the words that changed between a removed line and the line replacing it", () => {
  test("are the tokens each side does not share", () => {
    const [before, after] = ["const total = price * count;", "const total = price * quantity + tax;"];
    const changes = wordChanges(before, after);
    expect(changedText(before, changes?.removed)).toEqual(["count"]);
    expect(changedText(after, changes?.added)).toEqual(["quantity + tax"]);
  });

  test("take in the whitespace between two changed words, so a changed phrase is one mark", () => {
    const [before, after] = ["return a big value", "return the small value"];
    expect(changedText(after, wordChanges(before, after)?.added)).toEqual(["the small"]);
  });

  test("mark a change of indentation", () => {
    const changes = wordChanges("foo();", "  foo();");
    expect(changes).toEqual({ removed: [], added: [{ start: 0, end: 2 }] });
  });

  test("are marked on a short line that keeps a word of its own", () => {
    expect(changedText("line fifteen", wordChanges("line 15", "line fifteen")?.added)).toEqual(["fifteen"]);
  });

  test("are not marked on a line rewritten from scratch", () => {
    expect(wordChanges("import { a } from 'x';", "export default function main() {}")).toBeNull();
  });

  test("are marked when a short line grows, keeping all of itself", () => {
    const [before, after] = ["// TODO", "// TODO: fix this later please"];
    expect(changedText(after, wordChanges(before, after)?.added)).toEqual([": fix this later please"]);
  });

  test("are not marked on a long line a short unrelated one happens to face", () => {
    expect(wordChanges("x = 1", "const total = items.reduce((sum, x) => sum + x.price, 1);")).toBeNull();
    expect(wordChanges("i++;", "for (let i = 0; i < n; i++) {")).toBeNull();
  });

  test("are not marked on a line that keeps only its punctuation", () => {
    expect(wordChanges("foo(a, b, c);", "bar(x, y, z);")).toBeNull();
  });

  test("are marked on a line of only punctuation", () => {
    expect(wordChanges("});", "}));")).toEqual({ removed: [], added: [{ start: 2, end: 3 }] });
  });

  test("are not marked on a blank line replaced with code", () => {
    expect(wordChanges("", "foo();")).toBeNull();
  });
});

describe("the changed words of a diff's rows", () => {
  const row = (kind: string, text: string) => ({ kind, text });

  test("pair each removed line with the added line facing it, and leave unpaired and context rows unmarked", () => {
    const rows = [
      row("context", "a"),
      row("removed", "let x = 1;"),
      row("removed", "let y = 2;"),
      row("added", "let x = 10;"),
      row("added", "let y = 20;"),
      row("added", "let z = 3;"),
      row("context", "b"),
    ];
    const changes = rowWordChanges(rows);
    expect(changes.map((ranges, index) => changedText(rows[index]!.text, ranges) ?? null)).toEqual([null, ["1"], ["2"], ["10"], ["20"], null, null]);
  });

  test("do not pair an added run with a removed run after it", () => {
    const changes = rowWordChanges([row("added", "let x = 10;"), row("context", "b"), row("removed", "let x = 1;")]);
    expect(changes).toEqual([null, null, null]);
  });
});

describe("marking changed words on a highlighted line", () => {
  test("cuts its spans where a change starts and ends, keeping each span's token type", () => {
    const spans = [
      { text: "let", type: "keyword" },
      { text: " total = ", type: null },
      { text: "42", type: "number" },
    ];
    expect(markChanged(spans, [{ start: 4, end: 9 }, { start: 12, end: 14 }])).toEqual([
      { text: "let", type: "keyword", changed: false },
      { text: " ", type: null, changed: false },
      { text: "total", type: null, changed: true },
      { text: " = ", type: null, changed: false },
      { text: "42", type: "number", changed: true },
    ]);
  });
});
