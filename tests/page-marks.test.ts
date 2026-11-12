import { describe, expect, test } from "bun:test";
import {
  MAX_MARKED_HTML,
  MAX_MARKED_PATH,
  MAX_MARKED_TEXT,
  batchedMarkPrompt,
  pageMarkFrom,
  pageMarkLabel,
  pageMarkPrompt,
  type MarkComment,
  type PageMark,
} from "../shared/page-marks.ts";

const comment = (mark: PageMark, words: string): MarkComment => ({ id: words, mark, words });

const png = "data:image/png;base64,iVBORw0KGgo=";
const cell = { path: "main > table > tr:nth-of-type(2) > td.pro", html: '<td class="pro">Split conversation panes</td>' };

describe("pageMarkPrompt", () => {
  test("for selected text, names the page, quotes the text and shows the element it is in, then the user's words", () => {
    const mark: PageMark = { kind: "text", text: "Split conversation\npanes", element: cell };
    expect(pageMarkPrompt("Workspace layout options", mark, "  Why is this better than tabs?\n", "ask")).toBe(
      [
        'About this text on the canvas page "Workspace layout options":',
        "",
        "> Split conversation",
        "> panes",
        "",
        "It is in `main > table > tr:nth-of-type(2) > td.pro`:",
        "",
        "```html",
        '<td class="pro">Split conversation panes</td>',
        "```",
        "",
        "Why is this better than tabs?",
      ].join("\n"),
    );
  });

  test("for an element, names the page and where the element sits, and shows its HTML", () => {
    const mark: PageMark = { kind: "element", element: { path: "section#totals > button.primary", html: "<button class=\"primary\">Save</button>" } };
    expect(pageMarkPrompt("Settings mockup", mark, "Make it green", "ask")).toBe(
      [
        'About this element on the canvas page "Settings mockup", at `section#totals > button.primary`:',
        "",
        "```html",
        '<button class="primary">Save</button>',
        "```",
        "",
        "Make it green",
      ].join("\n"),
    );
  });

  test("for an area, names the page and the element that holds the box, and says the picture shows it", () => {
    const mark: PageMark = { kind: "area", element: { path: "div#chart > svg", html: '<svg width="300">…</svg>' }, image: png };
    expect(pageMarkPrompt("Sales", mark, "Why does it dip here?", "ask")).toBe(
      [
        'About the area of the canvas page "Sales" in the attached picture. It is in `div#chart > svg`:',
        "",
        "```html",
        '<svg width="300">…</svg>',
        "```",
        "",
        "Why does it dip here?",
      ].join("\n"),
    );
  });

  test("Change asks the agent to show the page again under the same title", () => {
    const mark: PageMark = { kind: "element", element: cell };
    expect(pageMarkPrompt("Plan", mark, "Bold this", "change")).toEndWith(
      "Bold this\n\nShow the page again with this changed, under the same title, and leave the rest of it as it is.",
    );
  });

  test("HTML with backticks in it cannot close its fence", () => {
    const mark: PageMark = { kind: "element", element: { path: "pre", html: "<pre>```js\nx\n```</pre>" } };
    expect(pageMarkPrompt("Code", mark, "?", "ask")).toContain("````html\n<pre>```js\nx\n```</pre>\n````");
  });
});

describe("batchedMarkPrompt", () => {
  const text: PageMark = { kind: "text", text: "Split conversation\npanes", element: cell };
  const element: PageMark = { kind: "element", element: { path: "button#save", html: '<button id="save">Save</button>' } };

  test("names the page once, numbers each comment with its own anchor, and puts the comment after it", () => {
    expect(batchedMarkPrompt("Workspace layout options", [comment(text, "  Why is this better than tabs?\n"), comment(element, "Make it green")], "", "ask").text).toBe(
      [
        'Comments on the canvas page "Workspace layout options":',
        "",
        "1. About this text:",
        "",
        "> Split conversation",
        "> panes",
        "",
        "It is in `main > table > tr:nth-of-type(2) > td.pro`:",
        "",
        "```html",
        '<td class="pro">Split conversation panes</td>',
        "```",
        "",
        "The user's comment: Why is this better than tabs?",
        "",
        "2. About this element, at `button#save`:",
        "",
        "```html",
        '<button id="save">Save</button>',
        "```",
        "",
        "The user's comment: Make it green",
      ].join("\n"),
    );
  });

  test("numbers the marked areas so each comment knows which picture is its own, and returns them in that order", () => {
    const first: PageMark = { kind: "area", element: { path: "canvas#scene", html: "<canvas></canvas>" }, image: png };
    const second: PageMark = { kind: "area", element: { path: "div#chart", html: "<div></div>" }, image: `${png}AA` };
    const batched = batchedMarkPrompt("Sales", [comment(first, "Why does it dip here?"), comment(text, "And this row?"), comment(second, "And this bar?")], "", "ask");
    expect(batched.text).toContain("1. About the area in picture 1, in `canvas#scene`:");
    expect(batched.text).toContain("3. About the area in picture 2, in `div#chart`:");
    expect(batched.imageMarks).toEqual([first, second]);
  });

  test("the note meant for all the comments comes last, and not at all when there is none", () => {
    expect(batchedMarkPrompt("Plan", [comment(element, "Bold this")], "  Keep the colours as they are.  ", "ask").text).toEndWith(
      "The user's comment: Bold this\n\nTheir note on all the comments: Keep the colours as they are.",
    );
    expect(batchedMarkPrompt("Plan", [comment(element, "Bold this")], "   ", "ask").text).toEndWith("The user's comment: Bold this");
  });

  test("Change asks for the page again once for the whole batch, not once per comment", () => {
    const changed = batchedMarkPrompt("Plan", [comment(element, "Bold this"), comment(text, "And centre that")], "", "change").text;
    expect(changed.match(/Show the page again/g)).toHaveLength(1);
    expect(changed).toEndWith("Show the page again with all of this changed, under the same title, and leave the rest of it as it is.");
  });
});

describe("pageMarkFrom", () => {
  test("takes a text mark or an element mark as the page posted it", () => {
    expect(pageMarkFrom({ kind: "text", text: "  panes ", element: cell })).toEqual({ kind: "text", text: "panes", element: cell });
    expect(pageMarkFrom({ kind: "element", element: cell, extra: 1 })).toEqual({ kind: "element", element: cell });
    expect(pageMarkFrom({ kind: "area", element: cell, image: png })).toEqual({ kind: "area", element: cell, image: png });
  });

  test("refuses what is not a mark", () => {
    expect(pageMarkFrom(null)).toBeNull();
    expect(pageMarkFrom({ kind: "text", text: "   ", element: cell })).toBeNull();
    expect(pageMarkFrom({ kind: "text", text: "x" })).toBeNull();
    expect(pageMarkFrom({ kind: "element", element: { path: "", html: "<b>" } })).toBeNull();
    expect(pageMarkFrom({ kind: "area", element: cell })).toBeNull();
    expect(pageMarkFrom({ kind: "area", element: cell, image: "data:image/svg+xml;base64,PHN2Zz4=" })).toBeNull();
    expect(pageMarkFrom({ kind: "area", element: cell, image: "javascript:alert(1)" })).toBeNull();
  });

  test("cuts text, HTML and the element's path longer than a message should carry", () => {
    const mark = pageMarkFrom({ kind: "text", text: "a".repeat(MAX_MARKED_TEXT + 50), element: { path: "p > ".repeat(100), html: "b".repeat(MAX_MARKED_HTML + 50) } });
    expect(mark?.kind === "text" && mark.text.length).toBe(MAX_MARKED_TEXT);
    expect(mark?.element.html.length).toBe(MAX_MARKED_HTML);
    expect(mark?.element.path.length).toBe(MAX_MARKED_PATH);
  });
});

describe("pageMarkLabel", () => {
  test("quotes the start of the text on one line, names the element by its last step, or says an area was marked", () => {
    expect(pageMarkLabel({ kind: "text", text: "Split\nconversation panes", element: cell })).toBe("“Split conversation panes”");
    expect(pageMarkLabel({ kind: "text", text: "x".repeat(80), element: cell })).toBe(`“${"x".repeat(59)}…”`);
    expect(pageMarkLabel({ kind: "element", element: cell })).toBe("the element td.pro");
    expect(pageMarkLabel({ kind: "area", element: cell, image: png })).toBe("the marked area");
  });
});
