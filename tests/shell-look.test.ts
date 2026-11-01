import { describe, expect, test } from "bun:test";
import { DEFAULT_SHELL_APPEARANCE, isDarkBackground, isFontFamily, parseShellAppearance, type ShellAppearance } from "../web/shell-look.ts";

describe("parseShellAppearance", () => {
  test("follows the theme when nothing was saved, as for everyone updating from a version without the setting", () => {
    expect(parseShellAppearance(null)).toEqual(DEFAULT_SHELL_APPEARANCE);
    expect(DEFAULT_SHELL_APPEARANCE.look).toBe("theme");
  });

  test("keeps what was saved", () => {
    const saved: ShellAppearance = { look: "custom", custom: { background: "#101010", text: "#eeeeee", prompt: "#00ff00" }, font: "JetBrains Mono", size: "120" };
    expect(parseShellAppearance(JSON.stringify(saved))).toEqual(saved);
  });

  test("falls back part by part, so one bad part loses only itself", () => {
    const saved = { look: "neon", custom: { background: "red", text: "#eeeeee" }, font: "x; } body { display: none", size: "500" };
    expect(parseShellAppearance(JSON.stringify(saved))).toEqual({
      look: "theme",
      custom: { ...DEFAULT_SHELL_APPEARANCE.custom, text: "#eeeeee" },
      font: "",
      size: "100",
    });
  });

  test("takes anything that is not a saved object as nothing saved", () => {
    expect(parseShellAppearance("not json")).toEqual(DEFAULT_SHELL_APPEARANCE);
    expect(parseShellAppearance("42")).toEqual(DEFAULT_SHELL_APPEARANCE);
  });
});

describe("isFontFamily", () => {
  test("takes font names, quoted or not, and lists of them", () => {
    expect(isFontFamily("JetBrains Mono")).toBe(true);
    expect(isFontFamily('"Fira Code", Menlo, monospace')).toBe(true);
    expect(isFontFamily("'Source Code Pro'")).toBe(true);
    expect(isFontFamily("ヒラギノ角ゴシック")).toBe(true);
  });

  test("refuses anything that could end the declaration or reach outside it", () => {
    expect(isFontFamily("Menlo; color: red")).toBe(false);
    expect(isFontFamily("Menlo } body {")).toBe(false);
    expect(isFontFamily("url(x)")).toBe(false);
    expect(isFontFamily("x".repeat(201))).toBe(false);
  });
});

describe("isDarkBackground", () => {
  test("tells a dark background from a light one", () => {
    expect(isDarkBackground("#16171c")).toBe(true);
    expect(isDarkBackground("#2a2c33")).toBe(true);
    expect(isDarkBackground("#fbf8f1")).toBe(false);
    expect(isDarkBackground("#ffffff")).toBe(false);
  });
});
