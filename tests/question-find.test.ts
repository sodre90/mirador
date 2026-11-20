import { describe, expect, test } from "bun:test";
import { placeIn } from "../web/question-find.ts";

describe("placeIn", () => {
  test("finds the part that holds the match and which of its own matches it is", () => {
    expect(placeIn([1, 1, 2, 1], 0)).toEqual({ part: 0, occurrence: 0 });
    expect(placeIn([1, 1, 2, 1], 1)).toEqual({ part: 1, occurrence: 0 });
    expect(placeIn([1, 1, 2, 1], 3)).toEqual({ part: 2, occurrence: 1 });
    expect(placeIn([1, 1, 2, 1], 4)).toEqual({ part: 3, occurrence: 0 });
  });

  test("passes over parts without matches, as a page that has not counted yet", () => {
    expect(placeIn([0, 2, 0, 1], 0)).toEqual({ part: 1, occurrence: 0 });
    expect(placeIn([0, 2, 0, 1], 2)).toEqual({ part: 3, occurrence: 0 });
  });

  test("has no place past the last match, or without any", () => {
    expect(placeIn([1, 2], 3)).toBeNull();
    expect(placeIn([0, 0], 0)).toBeNull();
    expect(placeIn([], 0)).toBeNull();
  });
});
