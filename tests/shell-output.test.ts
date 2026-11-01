import { describe, expect, test } from "bun:test";
import { commandShownClosed, outputStartsOpen, SHELL_OUTPUT_STYLES, shellOutputStyleLabels } from "../shared/shell-output.ts";

describe("shell output styles", () => {
  test("only Command and output, and a failure under output open when it failed, start with the output showing", () => {
    expect(SHELL_OUTPUT_STYLES.filter((style) => outputStartsOpen(style, false))).toEqual(["open"]);
    expect(SHELL_OUTPUT_STYLES.filter((style) => outputStartsOpen(style, true))).toEqual(["failures-open", "open"]);
  });

  test("a closed command still shows what ran, except as one line", () => {
    expect(SHELL_OUTPUT_STYLES.filter((style) => !commandShownClosed(style))).toEqual(["one-line"]);
  });

  test("every style has its label", () => {
    expect(Object.keys(shellOutputStyleLabels).sort()).toEqual([...SHELL_OUTPUT_STYLES].sort());
  });
});
