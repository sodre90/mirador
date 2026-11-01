import { describe, expect, test } from "bun:test";
import { contrastRatio, readableOn } from "../web/readable-color.ts";
import { drawsShapesOnly } from "../web/terminal-look.ts";

const lightStrip = "#f3f4f6";

describe("readableOn", () => {
  test("darkens a colour made for dark terminals until it reads on a light background, keeping its hue", () => {
    const green = readableOn("#98c379", lightStrip);
    expect(contrastRatio(green, lightStrip)!).toBeGreaterThanOrEqual(4.5);
    const [red, greenChannel, blue] = green.match(/\d+/g)!.map(Number);
    expect(greenChannel!).toBeGreaterThan(red!);
    expect(greenChannel!).toBeGreaterThan(blue!);
  });

  test("leaves a colour that already reads alone, in the form it came", () => {
    expect(readableOn("#1d1f21", lightStrip)).toBe("#1d1f21");
    expect(readableOn("rgb(24, 19, 28)", lightStrip)).toBe("rgb(24, 19, 28)");
  });

  test("lightens on a dark background", () => {
    const grey = readableOn("rgb(80, 80, 80)", "#1b1c22");
    expect(contrastRatio(grey, "#1b1c22")!).toBeGreaterThanOrEqual(4.5);
  });

  test("white text on a light background ends up dark enough to read", () => {
    expect(contrastRatio(readableOn("#ffffff", lightStrip), lightStrip)!).toBeGreaterThanOrEqual(4.5);
  });

  test("a colour it cannot read is passed through", () => {
    expect(readableOn("var(--x)", lightStrip)).toBe("var(--x)");
    expect(contrastRatio("#fff", lightStrip)).toBeNull();
  });
});

test("contrastRatio is WCAG's", () => {
  expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21);
  expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1);
});

describe("drawsShapesOnly", () => {
  test("powerline caps, box drawing and block bars keep the colour of the block they join", () => {
    expect(drawsShapesOnly("")).toBe(true);
    expect(drawsShapesOnly(" │ ")).toBe(true);
    expect(drawsShapesOnly("██░░")).toBe(true);
  });

  test("text, and icons drawn as text, are made readable", () => {
    expect(drawsShapesOnly("Opus")).toBe(false);
    expect(drawsShapesOnly(" main")).toBe(false);
  });
});
