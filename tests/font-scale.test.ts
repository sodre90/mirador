import { describe, expect, test } from "bun:test";
import { fontScales, FONT_SCALES, steppedFontScale, type FontScale } from "../web/font-scale.ts";

describe("steppedFontScale", () => {
  test("steps up the 50% to 200% ladder", () => {
    expect(steppedFontScale("50", 1)).toBe("70");
    expect(steppedFontScale("70", 1)).toBe("100");
    expect(steppedFontScale("100", 1)).toBe("140");
    expect(steppedFontScale("140", 1)).toBe("200");
  });

  test("steps down the ladder", () => {
    expect(steppedFontScale("200", -1)).toBe("140");
    expect(steppedFontScale("140", -1)).toBe("100");
    expect(steppedFontScale("100", -1)).toBe("70");
    expect(steppedFontScale("70", -1)).toBe("50");
  });

  test("clamps at the ends so it cannot step beyond 50% or 200%", () => {
    expect(steppedFontScale("50", -1)).toBe("50");
    expect(steppedFontScale("200", 1)).toBe("200");
  });

  test("falls back to 100% when given an unknown scale", () => {
    expect(steppedFontScale("unknown" as FontScale, 1)).toBe("100");
  });

  test("defines five ladder steps with their scale factors", () => {
    expect(fontScales).toEqual(["50", "70", "100", "140", "200"]);
    expect(FONT_SCALES).toEqual({ "50": 0.5, "70": 0.7, "100": 1, "140": 1.4, "200": 2 });
  });
});
