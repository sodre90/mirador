import { describe, expect, test } from "bun:test";
import { markdownPagePath, markdownRequest } from "../shared/canvas-export.ts";

const page = { title: "Release plan: Q3", html: "<h1>Release plan</h1><table><tr><td>May</td></tr></table>" };

describe("asking the agent for a page as Markdown", () => {
  test("saves it beside where Save to project offers the HTML", () => {
    expect(markdownPagePath("Release plan: Q3 / 2026")).toBe("docs/release-plan-q3-2026.md");
    expect(markdownPagePath("✓ → ✗")).toBe("docs/canvas-page.md");
  });

  test("names the page and carries its HTML, so the agent needs no memory of it", () => {
    const request = markdownRequest(page, "reply");
    expect(request).toStartWith('Write the canvas page "Release plan: Q3" as Markdown');
    expect(request).toEndWith(`\`\`\`html\n${page.html}\n\`\`\``);
  });

  test("for the chat asks for a code block and no file", () => {
    const request = markdownRequest(page, "reply");
    expect(request).toContain("Reply with the Markdown in one code block, fenced with more backticks than any fence inside it, so it can be copied, and write no file.");
    expect(request).not.toContain("docs/");
  });

  test("for a file names the path, asks before replacing a file already there, and still asks for the code block", () => {
    const request = markdownRequest(page, "file");
    expect(request).toContain("Save it as docs/release-plan-q3.md in the project, but if a file is there already, ask me before replacing it.");
    expect(request).toContain("Reply with the same Markdown in one code block, fenced with more backticks than any fence inside it");
    expect(request).not.toContain("write no file");
  });

  test("fences HTML that holds a code fence of its own with a longer one", () => {
    const request = markdownRequest({ title: "Notes", html: "<pre>```js\nrun()\n```</pre>" }, "reply");
    expect(request).toEndWith("````html\n<pre>```js\nrun()\n```</pre>\n````");
  });
});
