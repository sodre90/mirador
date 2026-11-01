import { describe, expect, test } from "bun:test";
import { highlightedCompletion } from "../web/path-completion.ts";

const siblings = ["~/prj/mirador-mobile/", "~/prj/mirador/"];

describe("highlightedCompletion", () => {
  test("while a folder name is being typed, Enter takes the first completion", () => {
    expect(highlightedCompletion("~/prj/mira", siblings, null)).toBe(0);
  });

  test("a path that names a folder is added as typed, even when other folders start with it", () => {
    expect(highlightedCompletion("~/prj/mirador", siblings, null)).toBeNull();
    expect(highlightedCompletion("~/prj/mirador/", ["~/prj/mirador/desktop/", "~/prj/mirador/web/"], null)).toBeNull();
  });

  test("a path ending in a backslash, as typed on Windows, names a folder too", () => {
    expect(highlightedCompletion("C:\\Users\\", ["C:\\Users\\me/", "C:\\Users\\Public/"], null)).toBeNull();
  });

  test("a folder picked with the arrow keys is the one Enter takes", () => {
    expect(highlightedCompletion("~/prj/mirador/", ["~/prj/mirador/desktop/", "~/prj/mirador/web/"], 1)).toBe(1);
  });

  test("completions left over from an earlier prefix that do not extend the path are not taken", () => {
    expect(highlightedCompletion("~/work/x", siblings, null)).toBeNull();
    expect(highlightedCompletion("~/prj/mira", [], null)).toBeNull();
  });

  test("a pick past the end of a shorter list falls back to what is typed", () => {
    expect(highlightedCompletion("~/prj/mira", siblings, 5)).toBe(0);
  });
});
