import { describe, expect, test } from "bun:test";
import type { DiffRow } from "../shared/review.ts";
import { highlightCode, highlightRows, type CodeSpan } from "../web/highlight.ts";

const row = (kind: DiffRow["kind"], text: string): DiffRow => ({ kind, oldLine: null, newLine: null, text });
const typesOf = (spans: CodeSpan[]) => spans.filter(({ text }) => text.trim()).map(({ text, type }) => `${text.trim()}:${type}`);

describe("highlightRows", () => {
  test("a comment spanning lines is colored as a comment on each line, and each row keeps its text", () => {
    const rows = [row("context", "/**"), row("context", " * Loads the user."), row("context", " */"), row("added", "public User load() {")];
    const highlighted = highlightRows("src/Service.java", rows)!;
    expect(highlighted.map((spans) => spans.map(({ text }) => text).join(""))).toEqual(rows.map(({ text }) => text));
    expect(highlighted.slice(0, 3).map(typesOf)).toEqual([["/**:comment"], ["* Loads the user.:comment"], ["*/:comment"]]);
    expect(typesOf(highlighted[3]!)).toContain("public:keyword");
  });

  test("removed lines are colored as the old side's code", () => {
    const rows = [row("context", "def serve():"), row("removed", '    return "old"'), row("added", "    return 42")];
    const highlighted = highlightRows("app/serve.py", rows)!;
    expect(typesOf(highlighted[0]!)).toContain("serve:function");
    expect(typesOf(highlighted[1]!)).toEqual(["return:keyword", '"old":string']);
    expect(typesOf(highlighted[2]!)).toEqual(["return:keyword", "42:number"]);
  });

  test("a comment opened before a gap does not color the lines after it", () => {
    const rows = [row("context", "/**"), row("context", " * Loads the user."), row("elided", "… 40 lines not shown …"), row("context", "const user = 1;"), row("context", "/* closed */")];
    const highlighted = highlightRows("src/service.ts", rows)!;
    expect(typesOf(highlighted[1]!)).toEqual(["* Loads the user.:comment"]);
    expect(typesOf(highlighted[3]!)).toContain("const:keyword");
    expect(typesOf(highlighted[4]!)).toEqual(["/* closed */:comment"]);
  });

  test("files of a language it does not know are left plain", () => {
    expect(highlightRows("notes.unknown", [row("context", "anything")])).toBeNull();
    expect(highlightRows("Dockerfile", [row("added", "FROM fedora:42")])).not.toBeNull();
  });
});

describe("highlightCode", () => {
  test("a code block is colored for the language its fence names, by name or by file extension, and keeps its text", () => {
    const code = 'const greeting = "hi";\n// done\n';
    for (const fenceName of ["ts", "typescript", "TS"]) {
      const spans = highlightCode(code, fenceName)!;
      expect(spans.map(({ text }) => text).join("")).toBe(code);
      expect(typesOf(spans)).toEqual(expect.arrayContaining(["const:keyword", '"hi":string', "// done:comment"]));
    }
    expect(typesOf(highlightCode("echo $HOME", "shell")!)).toContain("echo:builtin class-name");
    expect(typesOf(highlightCode("def serve(): pass", "py")!)).toContain("def:keyword");
  });

  test("a diff's added and removed lines are told apart", () => {
    expect(typesOf(highlightCode(" kept\n-old line\n+new line\n", "diff")!)).toEqual(["kept:line", "-:prefix deleted", "old line:line deleted", "+:prefix inserted", "new line:line inserted"]);
  });

  test("a language it does not know is left plain, as are the names of Prism's own helpers", () => {
    expect(highlightCode("anything", "klingon")).toBeNull();
    expect(highlightCode("anything", "extend")).toBeNull();
  });

  test("a console session is left plain, as its output is not code", () => {
    expect(highlightCode("$ ls\nREADME.md", "console")).toBeNull();
  });
});
