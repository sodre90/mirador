import { expect, test } from "bun:test";
import { looksLikeFilePath } from "../shared/file-paths.ts";

test("an inline code span is a file path when it names a file with a folder", () => {
  expect(["/Users/me/a/b.ts", "src/app.ts", "docs/notes.md"].every(looksLikeFilePath)).toBe(true);
  expect(["foo()", "https://x.com/a.png", "a/b", "npm run test", "main"].some(looksLikeFilePath)).toBe(false);
});

test("a path written with Windows separators is a file path too, and a folder named on its own is not", () => {
  expect(["C:\\Users\\me\\a\\b.ts", "C:/a/b.ts", "src\\app.ts", "\\\\server\\share\\notes.md"].every(looksLikeFilePath)).toBe(true);
  expect(["C:\\Windows", "C:\\a\\b", "https://x.com\\a.png"].some(looksLikeFilePath)).toBe(false);
});
