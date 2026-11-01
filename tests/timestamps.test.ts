import { describe, expect, test } from "bun:test";
import { formatDuration } from "../web/timestamps.ts";

describe("formatDuration", () => {
  test("says seconds, then minutes, then hours and minutes", () => {
    expect(formatDuration(40_400)).toBe("40 s");
    expect(formatDuration(4 * 60_000 + 59_000)).toBe("4 min");
    expect(formatDuration(65 * 60_000)).toBe("1 h 5 min");
    expect(formatDuration(-5)).toBe("0 s");
  });
});
