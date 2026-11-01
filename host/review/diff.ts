import type { DiffHunk, ReviewFile } from "../../shared/review.ts";

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

const GENERATED_FILES = [
  /(^|\/)(bun\.lockb?|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|go\.sum|poetry\.lock|uv\.lock|Gemfile\.lock|composer\.lock)$/,
  /\.min\.(js|css)$/,
  /\.map$/,
];
export const MAX_ROWS_PER_FILE = 3_000;
const MAX_ROWS_PER_REVIEW = 40_000;

const C_ESCAPE_BYTES: Record<string, number> = { a: 7, b: 8, f: 12, n: 10, r: 13, t: 9, v: 11 };
const utf8 = new TextEncoder();

/** Git quotes a name with `"`, `\` or a control character, C style: plain characters stay raw UTF-8, escapes are single bytes. */
function unquoted(path: string) {
  if (!path.startsWith('"')) return path;
  const tokens = path.slice(1, -1).matchAll(/\\([0-7]{3}|.)|[^\\]+/gs);
  const bytes = [...tokens].flatMap(([text, escape]) =>
    escape === undefined ? [...utf8.encode(text)] : [escape.length === 3 ? parseInt(escape, 8) : (C_ESCAPE_BYTES[escape] ?? escape.charCodeAt(0))],
  );
  return new TextDecoder().decode(Uint8Array.from(bytes));
}

const withoutPrefix = (path: string) => unquoted(path).replace(/^[ab]\//, "");

/** The new side's `"..."` token. When both sides are C-quoted the separator is `" "` rather than ` b/`, so indexOf cannot find it. */
function secondQuotedToken(sides: string) {
  let i = 1;
  while (i < sides.length) {
    const char = sides[i]!;
    if (char === "\\") i += 2;
    else if (char === '"') return sides.slice(i + 2);
    else i += 1;
  }
  return sides;
}

/** `diff --git a/P b/P`: P itself may contain " b/", so the two halves are matched rather than split. */
function pathFromDiffHeader(line: string) {
  const sides = line.slice("diff --git ".length);
  if (sides.startsWith('"')) return withoutPrefix(secondQuotedToken(sides));
  const length = (sides.length - " b/".length - "a/".length) / 2;
  const path = sides.slice(2, 2 + length);
  if (sides === `a/${path} b/${path}`) return path;
  return withoutPrefix(sides.slice(sides.indexOf(" b/") + 1));
}

const newFile = (path: string): ReviewFile => ({ path, oldPath: null, change: "modified", added: 0, removed: 0, hunks: [], hiddenBecause: null });

/** Reads `git diff` output (unified, with git's extended headers) into files and hunks. */
export function parseGitDiff(text: string): ReviewFile[] {
  const files: ReviewFile[] = [];
  let file: ReviewFile | undefined;
  let hunk: DiffHunk | undefined;
  let oldLine = 0;
  let newLine = 0;
  let oldLeft = 0;
  let newLeft = 0;

  for (const line of text.split("\n")) {
    if (hunk && file && (oldLeft > 0 || newLeft > 0)) {
      const marker = line[0];
      if (marker === "\\") continue;
      const text = line.slice(1);
      if (marker === "+") {
        hunk.rows.push({ kind: "added", oldLine: null, newLine: newLine++, text });
        file.added += 1;
        newLeft -= 1;
      } else if (marker === "-") {
        hunk.rows.push({ kind: "removed", oldLine: oldLine++, newLine: null, text });
        file.removed += 1;
        oldLeft -= 1;
      } else {
        hunk.rows.push({ kind: "context", oldLine: oldLine++, newLine: newLine++, text });
        oldLeft -= 1;
        newLeft -= 1;
      }
      continue;
    }
    hunk = undefined;
    if (line.startsWith("diff --git ")) {
      file = newFile(pathFromDiffHeader(line));
      files.push(file);
      continue;
    }
    if (!file) continue;
    const header = HUNK_HEADER.exec(line);
    if (header) {
      [oldLine, oldLeft, newLine, newLeft] = [Number(header[1]), Number(header[2] ?? 1), Number(header[3]), Number(header[4] ?? 1)];
      hunk = { header: header[5]!.trim(), newStart: newLine, rows: [] };
      file.hunks.push(hunk);
    } else if (line.startsWith("new file mode")) file.change = "added";
    else if (line.startsWith("deleted file mode")) file.change = "deleted";
    else if (line.startsWith("rename from ")) {
      file.oldPath = unquoted(line.slice("rename from ".length));
      file.change = "renamed";
    } else if (line.startsWith("rename to ")) file.path = unquoted(line.slice("rename to ".length));
    else if (line.startsWith("Binary files ")) file.hiddenBecause = "binary file";
    else if (line.startsWith("+++ ") && !line.endsWith("/dev/null")) file.path = withoutPrefix(line.slice(4).replace(/\t$/, ""));
  }
  return files;
}

const rowCount = (file: ReviewFile) => file.hunks.reduce((count, hunk) => count + hunk.rows.length, 0);

/** Leaves out what nobody reads in a review (lock files, minified code) and what is too long to show. */
export function hideUnreadableDiffs(files: ReviewFile[]): ReviewFile[] {
  let rowsShown = 0;
  return files.map((file) => {
    const hiddenBecause =
      file.hiddenBecause ??
      (GENERATED_FILES.some((pattern) => pattern.test(file.path)) ? "generated file" : null) ??
      (rowCount(file) > MAX_ROWS_PER_FILE ? `more than ${MAX_ROWS_PER_FILE.toLocaleString("en")} diff lines` : null) ??
      (rowsShown + rowCount(file) > MAX_ROWS_PER_REVIEW ? "the review's diff is too long to show whole" : null);
    if (hiddenBecause) return { ...file, hunks: [], hiddenBecause };
    rowsShown += rowCount(file);
    return file;
  });
}
