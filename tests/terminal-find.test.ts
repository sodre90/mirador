import { describe, expect, test } from "bun:test";
import { findTally, HIGHLIGHT_LIMIT, isSearchable, noToggles } from "../web/terminal-find.ts";

const regex = { ...noToggles, regex: true };

describe("finding in a terminal", () => {
  test("searches for any text, and for a regular expression only once it compiles, since the search addon throws on one that does not", () => {
    expect(isSearchable("", noToggles)).toBe(false);
    expect(isSearchable("e(", noToggles)).toBe(true);
    expect(isSearchable("e(", regex)).toBe(false);
    expect(isSearchable("error (one|two)", regex)).toBe(true);
  });

  test("tells where the current match is among them all, counted from the top, or why there is none", () => {
    expect(findTally("", noToggles, null)).toBe("");
    expect(findTally("e(", regex, null)).toBe("Invalid pattern");
    expect(findTally("error", noToggles, null)).toBe("No matches");
    expect(findTally("error", noToggles, { resultIndex: -1, resultCount: 0 })).toBe("No matches");
    expect(findTally("error", noToggles, { resultIndex: 2, resultCount: 4 })).toBe("3 of 4");
  });

  test("counts no further than the matches the addon highlights", () => {
    expect(findTally("e", noToggles, { resultIndex: 9, resultCount: HIGHLIGHT_LIMIT })).toBe(`10 of ${HIGHLIGHT_LIMIT}+`);
    expect(findTally("e", noToggles, { resultIndex: -1, resultCount: HIGHLIGHT_LIMIT })).toBe(`${HIGHLIGHT_LIMIT}+ matches`);
  });
});
