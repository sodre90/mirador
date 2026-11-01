import { describe, expect, test } from "bun:test";
import { pageFileName, suggestedImagePagePath, suggestedPagePath } from "../shared/canvas-export.ts";

describe("a page's file name and the path Save to project offers", () => {
  test("follow the title in lowercase, with dashes for anything but letters and digits", () => {
    expect(pageFileName("Release plan: Q3 / 2026")).toBe("release-plan-q3-2026.html");
    expect(suggestedPagePath("Release plan: Q3 / 2026")).toBe("docs/release-plan-q3-2026.html");
  });

  test("Save image to project offers the same name as a PNG", () => {
    expect(suggestedImagePagePath("Release plan: Q3 / 2026")).toBe("docs/release-plan-q3-2026.png");
  });

  test("keep the letters of accented words without their accents", () => {
    expect(pageFileName("Sales by région, Ångström")).toBe("sales-by-region-angstrom.html");
  });

  test("cut a long title short, with no dash left at the end", () => {
    const name = pageFileName(`${"a".repeat(59)} tail`);
    expect(name).toBe(`${"a".repeat(59)}.html`);
  });

  test("fall back to a name of their own for a title with nothing to keep", () => {
    expect(pageFileName("✓ → ✗")).toBe("canvas-page.html");
  });
});
