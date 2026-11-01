import { describe, expect, test } from "bun:test";
import { hookNoticeIn } from "../shared/hook-message.ts";

describe("hookNoticeIn", () => {
  test("names the hook once and keeps each line without its prefix, empty lines too", () => {
    const title = "SessionStart:compact says: <persisted-output>";
    const description = "SessionStart:compact says: Recent context, needle in it\nSessionStart:compact says: \nSessionStart:compact says: Mode: code";
    expect(hookNoticeIn(title, description)).toEqual({ hook: "SessionStart:compact", lines: ["<persisted-output>", "Recent context, needle in it", "", "Mode: code"] });
  });

  test("takes a description ending in the newline hook output ends in", () => {
    expect(hookNoticeIn("Stop says: one", "Stop says: two\n")).toEqual({ hook: "Stop", lines: ["one", "two"] });
    expect(hookNoticeIn("Stop says: one", "Stop says: two\r\n")).toEqual({ hook: "Stop", lines: ["one", "two"] });
    expect(hookNoticeIn("Stop says: one", "\n")).toEqual({ hook: "Stop", lines: ["one"] });
  });

  test("takes a one-line notice with no description", () => {
    expect(hookNoticeIn("Stop says: all checks passed", null)).toEqual({ hook: "Stop", lines: ["all checks passed"] });
  });

  test("leaves a notice alone unless every line comes from the same hook", () => {
    expect(hookNoticeIn("Claude reported a notice", "SessionStart:compact says: one\nSessionStart:compact says: two")).toBeNull();
    expect(hookNoticeIn("SessionStart:compact says: one", "something else")).toBeNull();
  });
});
