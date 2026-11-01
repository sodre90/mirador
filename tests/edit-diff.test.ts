import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "bun:test";
import type { ToolCallUpdate } from "@agentclientprotocol/sdk";
import { editDiff, editDiffsOf, fileChangeDiff, shownPath, snippetDiff, type FileBefore } from "../host/edit-diff.ts";
import type { DiffRow, EditDiff } from "../shared/review.ts";

const numbered = (count: number) => Array.from({ length: count }, (_, index) => `line ${index + 1}`).join("\n") + "\n";
const text = (fileText: string): FileBefore => ({ kind: "text", text: fileText });
const change = (oldText: string | null, newText: string) => ({ type: "diff" as const, path: "/work/a.ts", oldText, newText });
const rowsOf = (diff: EditDiff) => diff.hunks.flatMap((hunk) => hunk.rows);
const row = (kind: DiffRow["kind"], oldLine: number | null, newLine: number | null, text: string): DiffRow => ({ kind, oldLine, newLine, text });

describe("an edit the agent asks permission for", () => {
  test("found once in the file shows with the file's line numbers and three lines around it", () => {
    const diff = editDiff(change("line 10\n", "line ten\nline ten and a half\n"), text(numbered(20)), false, "a.ts");
    expect(diff).toMatchObject({ path: "a.ts", change: "modified", added: 2, removed: 1, located: true, lineCount: 21, hiddenBecause: null });
    expect(rowsOf(diff)).toEqual([
      row("context", 7, 7, "line 7"),
      row("context", 8, 8, "line 8"),
      row("context", 9, 9, "line 9"),
      row("removed", 10, null, "line 10"),
      row("added", null, 10, "line ten"),
      row("added", null, 11, "line ten and a half"),
      row("context", 11, 12, "line 11"),
      row("context", 12, 13, "line 12"),
      row("context", 13, 14, "line 13"),
    ]);
  });

  test("not found in the file shows the agent's snippet alone, without line numbers", () => {
    const diff = editDiff(change("not in the file", "something else"), text(numbered(5)), false, "a.ts");
    expect(diff.located).toBe(false);
    expect(diff.lineCount).toBeNull();
    expect(rowsOf(diff)).toEqual([row("removed", null, null, "not in the file"), row("added", null, null, "something else")]);
  });

  test("found more than once is placed only when the agent replaces every one", () => {
    const fileText = "keep\nold\nkeep\nkeep\nkeep\nkeep\nkeep\nkeep\nkeep\nold\nkeep\n";
    expect(editDiff(change("old", "new"), text(fileText), false, "a.ts").located).toBe(false);
    const everyOne = editDiff(change("old", "new"), text(fileText), true, "a.ts");
    expect(everyOne).toMatchObject({ located: true, added: 2, removed: 2 });
    expect(everyOne.hunks.map((hunk) => hunk.rows.filter((row) => row.kind === "added").map((row) => row.newLine))).toEqual([[2], [10]]);
  });

  test("creating a file shows every line added from the first", () => {
    const diff = editDiff(change(null, "one\ntwo\n"), { kind: "missing" }, false, "new.ts");
    expect(diff).toMatchObject({ change: "added", added: 2, removed: 0, located: true, lineCount: 2 });
    expect(rowsOf(diff)).toEqual([row("added", null, 1, "one"), row("added", null, 2, "two")]);
  });

  test("a Write over a file that exists, sent without the old text, shows what changes in the file", () => {
    const diff = editDiff(change(null, numbered(20).replace("line 15\n", "line fifteen\n")), text(numbered(20)), false, "a.ts");
    expect(diff).toMatchObject({ change: "modified", added: 1, removed: 1, located: true });
    expect(rowsOf(diff).filter((row) => row.kind !== "context")).toEqual([row("removed", 15, null, "line 15"), row("added", null, 15, "line fifteen")]);
  });

  test("the whole file sent as the old text, as opencode does, shows what changes in it", () => {
    const diff = editDiff(change(numbered(20), numbered(20).replace("line 3\n", "")), text(numbered(20)), false, "a.ts");
    expect(diff).toMatchObject({ added: 0, removed: 1, located: true, lineCount: 19 });
    expect(rowsOf(diff)[0]).toEqual(row("context", 1, 1, "line 1"));
  });

  test("deleting a snippet takes the line break after it too, as Claude Code does", () => {
    const diff = editDiff(change("line 2", ""), text(numbered(3)), false, "a.ts");
    expect(rowsOf(diff)).toEqual([row("context", 1, 1, "line 1"), row("removed", 2, null, "line 2"), row("context", 3, 2, "line 3")]);
  });

  test("a file that can't be read shows the snippet", () => {
    expect(editDiff(change("a", "b"), { kind: "unreadable" }, false, "a.ts")).toMatchObject({ located: false, change: "modified", added: 1, removed: 1 });
  });

  test("a change too long to show keeps its counts only", () => {
    const diff = editDiff(change(null, numbered(4000)), { kind: "missing" }, false, "big.txt");
    expect(diff).toMatchObject({ added: 4000, hunks: [], hiddenBecause: "more than 3,000 diff lines" });
  });
});

describe("the files a permission request would change", () => {
  const workspace = mkdtempSync(join(tmpdir(), "edit-diff-"));
  afterAll(() => rmSync(workspace, { recursive: true, force: true }));
  const toolCall = (content: ToolCallUpdate["content"]): ToolCallUpdate => ({ toolCallId: "call", kind: "edit", content });

  test("are read from disk, named as the workspace names them", async () => {
    writeFileSync(join(workspace, "a.ts"), numbered(5));
    const diffs = await editDiffsOf(toolCall([{ type: "diff", path: join(workspace, "a.ts"), oldText: "line 2", newText: "line two" }]), [workspace]);
    expect(diffs).toMatchObject([{ path: "a.ts", located: true, added: 1, removed: 1 }]);
    const relative = await editDiffsOf(toolCall([{ type: "diff", path: "a.ts", oldText: "line 2", newText: "line two" }]), [workspace]);
    expect(relative).toMatchObject([{ path: "a.ts", located: true }]);
  });

  test("keep their full path outside the workspace", async () => {
    const outside = mkdtempSync(join(tmpdir(), "edit-diff-outside-"));
    const diffs = await editDiffsOf(toolCall([{ type: "diff", path: join(outside, "b.ts"), oldText: null, newText: "b\n" }]), [workspace]);
    expect(diffs).toMatchObject([{ path: join(outside, "b.ts"), change: "added" }]);
    rmSync(outside, { recursive: true, force: true });
  });

  test("are none for a request that changes no file", async () => {
    expect(await editDiffsOf(toolCall([{ type: "content", content: { type: "text", text: "hi" } }]), [workspace])).toBeUndefined();
    expect(await editDiffsOf(toolCall(undefined), [workspace])).toBeUndefined();
  });
});

describe("a file's line changes, asked for again after every tool call", () => {
  const withLine = (line: number, replacement: string) => numbered(30).replace(`line ${line}\n`, `${replacement}\n`);

  test("the same versions of a file give back the diff worked out before, without diffing again", () => {
    const first = fileChangeDiff("a.ts", text(numbered(30)), text(withLine(15, "line fifteen")));
    expect(fileChangeDiff("a.ts", text(numbered(30)), text(withLine(15, "line fifteen")))).toBe(first);
    expect(rowsOf(first).filter(({ kind }) => kind !== "context")).toEqual([row("removed", 15, null, "line 15"), row("added", null, 15, "line fifteen")]);
  });

  test("a file git checked out with Windows line endings shows only the lines that changed, as git counts them", () => {
    const withWindowsLineEndings = withLine(15, "line fifteen").replaceAll("\n", "\r\n");
    const diff = fileChangeDiff("a.ts", text(numbered(30)), text(withWindowsLineEndings));
    expect(rowsOf(diff).filter(({ kind }) => kind !== "context")).toEqual([row("removed", 15, null, "line 15"), row("added", null, 15, "line fifteen")]);
  });

  test("another version or another path is diffed anew", () => {
    const first = fileChangeDiff("a.ts", text(numbered(30)), text(withLine(15, "line fifteen")));
    const changedAgain = fileChangeDiff("a.ts", text(numbered(30)), text(withLine(16, "line sixteen")));
    expect(changedAgain).not.toBe(first);
    expect(rowsOf(changedAgain).filter(({ kind }) => kind === "added")).toEqual([row("added", null, 16, "line sixteen")]);
    expect(fileChangeDiff("b.ts", text(numbered(30)), text(withLine(15, "line fifteen")))).toMatchObject({ path: "b.ts" });
  });

  test("the agent's same snippet gives back the diff worked out before", () => {
    const first = snippetDiff("/work/a.ts", "old line", "new line");
    expect(snippetDiff("/work/a.ts", "old line", "new line")).toBe(first);
    expect(snippetDiff("/work/a.ts", "old line", "newer line")).not.toBe(first);
  });
});

describe("a path shown to the user", () => {
  test("is relative to its workspace, even when the file's name starts with two dots", () => {
    expect(shownPath("/ws/..hidden/x.ts", ["/ws"])).toBe(join("..hidden", "x.ts"));
    expect(shownPath("/ws/src/a.ts", ["/ws"])).toBe(join("src", "a.ts"));
    expect(shownPath("/other/x.ts", ["/ws"])).toBe("/other/x.ts");
  });
});
