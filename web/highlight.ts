import Prism from "prismjs";
import "prismjs/components/prism-java.js";
import "prismjs/components/prism-kotlin.js";
import "prismjs/components/prism-scala.js";
import "prismjs/components/prism-groovy.js";
import "prismjs/components/prism-gradle.js";
import "prismjs/components/prism-python.js";
import "prismjs/components/prism-go.js";
import "prismjs/components/prism-rust.js";
import "prismjs/components/prism-typescript.js";
import "prismjs/components/prism-jsx.js";
import "prismjs/components/prism-tsx.js";
import "prismjs/components/prism-bash.js";
import "prismjs/components/prism-yaml.js";
import "prismjs/components/prism-json.js";
import "prismjs/components/prism-sql.js";
import "prismjs/components/prism-markdown.js";
import "prismjs/components/prism-docker.js";
import "prismjs/components/prism-toml.js";
import "prismjs/components/prism-properties.js";
import "prismjs/components/prism-protobuf.js";
import "prismjs/components/prism-ruby.js";
import "prismjs/components/prism-c.js";
import "prismjs/components/prism-cpp.js";
import "prismjs/components/prism-csharp.js";
import "prismjs/components/prism-swift.js";
import "prismjs/components/prism-hcl.js";
import "prismjs/components/prism-ini.js";
import "prismjs/components/prism-makefile.js";
import type { DiffRow } from "../shared/review.ts";

// Prism checks this when its page load handler runs; left on, it rewrites every `language-*` code block on the page,
// including the ones React renders for markdown.
Prism.manual = true;

/** A run of text on one line, and the token type(s) it is colored as, e.g. "keyword" or "class-name". */
export interface CodeSpan {
  text: string;
  type: string | null;
}

const languageByExtension: Record<string, string> = {
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  scala: "scala",
  groovy: "groovy",
  gradle: "gradle",
  py: "python",
  go: "go",
  rs: "rust",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  yml: "yaml",
  yaml: "yaml",
  json: "json",
  sql: "sql",
  md: "markdown",
  toml: "toml",
  properties: "properties",
  proto: "protobuf",
  rb: "ruby",
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  hpp: "cpp",
  cs: "csharp",
  swift: "swift",
  tf: "hcl",
  hcl: "hcl",
  ini: "ini",
  cfg: "ini",
  css: "css",
  html: "markup",
  xml: "markup",
  svg: "markup",
  mk: "makefile",
};

const languageByFileName: Record<string, string> = { Dockerfile: "docker", Containerfile: "docker", Makefile: "makefile", Jenkinsfile: "groovy" };

function grammarFor(path: string) {
  const fileName = path.split("/").at(-1) ?? path;
  const extension = fileName.includes(".") ? fileName.split(".").at(-1)!.toLowerCase() : "";
  const language = languageByFileName[fileName] ?? languageByExtension[extension];
  return language ? Prism.languages[language] : undefined;
}

const typeOf = (token: Prism.Token) => [token.type, ...[token.alias ?? []].flat()].join(" ");

function flatten(tokens: Prism.TokenStream, type: string | null): CodeSpan[] {
  const stream = Array.isArray(tokens) ? tokens : [tokens];
  return stream.flatMap((token) => (typeof token === "string" ? [{ text: token, type }] : flatten(token.content, typeOf(token))));
}

function splitIntoLines(spans: CodeSpan[]): CodeSpan[][] {
  const lines: CodeSpan[][] = [[]];
  spans.forEach(({ text, type }) =>
    text.split("\n").forEach((piece, index) => {
      if (index > 0) lines.push([]);
      if (piece) lines.at(-1)!.push({ text: piece, type });
    }),
  );
  return lines;
}

/** The rows between gaps, each with its place in `rows`. */
function runsBetweenGaps(rows: DiffRow[]) {
  return rows.reduce<{ row: DiffRow; index: number }[][]>(
    (runs, row, index) => {
      if (row.kind === "elided") runs.push([]);
      else runs.at(-1)!.push({ row, index });
      return runs;
    },
    [[]],
  );
}

/**
 * Colors the rows of a diff for the language of `path`, or returns null when it is not a language this knows. Each
 * side is highlighted as one run of code (the old side's rows with the context, the new side's likewise), so a block
 * comment or string spanning lines is colored as one. A gap of lines not shown ends the run: what opened before it is
 * not known to still be open after it.
 */
export function highlightRows(path: string, rows: DiffRow[]): CodeSpan[][] | null {
  const grammar = grammarFor(path);
  if (!grammar) return null;
  const highlighted: CodeSpan[][] = rows.map((row) => [{ text: row.text, type: null }]);
  const runs = runsBetweenGaps(rows);
  const highlightSide = (onSide: (row: DiffRow) => boolean, colored: (row: DiffRow) => boolean) =>
    runs.forEach((run) => {
      const sideRows = run.filter(({ row }) => onSide(row));
      const lines = splitIntoLines(flatten(Prism.tokenize(sideRows.map(({ row }) => row.text).join("\n"), grammar), null));
      sideRows.forEach(({ row, index }, lineIndex) => {
        if (colored(row)) highlighted[index] = lines[lineIndex] ?? [];
      });
    });
  highlightSide((row) => row.kind === "context" || row.kind === "added", () => true);
  highlightSide((row) => row.kind === "context" || row.kind === "removed", (row) => row.kind === "removed");
  return highlighted;
}
