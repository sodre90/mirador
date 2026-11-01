import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import {
  copiesOnSelect,
  DEFAULT_TERMINAL_SETTINGS,
  parseTerminalSettings,
  resetTerminalFontSize,
  resetTerminalSettings,
  savedTerminalSettings,
  setCopyOnSelect,
  setTerminalSettings,
  stepTerminalFontSize,
  subscribeTerminalSettings,
  TERMINAL_FONT_SIZES,
  TERMINAL_PRESETS,
  terminalFontList,
  terminalPresetLabels,
  terminalPresetTheme,
  terminalSettings,
  type TerminalCursorStyle,
  type TerminalPreset,
} from "../web/terminal-settings.ts";
import { TERMINAL_FONT } from "../web/terminal-look.ts";

const STORAGE_KEY = "mirador-terminal-settings";

describe("terminal-settings", () => {
  const originalLocalStorage = globalThis.localStorage;
  const storage = new Map<string, string>();

  beforeEach(() => {
    storage.clear();
    globalThis.localStorage = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
      length: 0,
      key: () => null,
    } as unknown as Storage;
    resetTerminalSettings();
  });

  afterAll(() => {
    globalThis.localStorage = originalLocalStorage;
  });

  test("valid font sizes run from 11 to 24 px", () => {
    expect(TERMINAL_FONT_SIZES).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]);
  });

  test("defaults to the usual font at 12 px with the stock xterm look and mirador preset", () => {
    expect(terminalSettings()).toEqual(DEFAULT_TERMINAL_SETTINGS);
    expect(DEFAULT_TERMINAL_SETTINGS).toEqual({
      preset: "default",
      fontFamily: "",
      fontSize: 12,
      lineHeight: 1,
      letterSpacing: 0,
      cursorStyle: "block",
      cursorBlink: true,
      fontWeightBold: 700,
      scrollback: 5_000,
      copyOnSelect: false,
    });
    expect(JSON.parse(storage.get(STORAGE_KEY)!)).toEqual(DEFAULT_TERMINAL_SETTINGS);
  });

  test("built-in presets list well-known color themes with labels and full themes", () => {
    expect(TERMINAL_PRESETS).toEqual(["default", "dracula", "solarized-dark", "nord", "monokai"]);
    expect(terminalPresetLabels).toEqual({
      default: "Mirador",
      dracula: "Dracula",
      "solarized-dark": "Solarized Dark",
      nord: "Nord",
      monokai: "Monokai",
    });

    for (const preset of TERMINAL_PRESETS) {
      const theme = terminalPresetTheme(preset);
      expect(theme.background).toBeTruthy();
      expect(theme.foreground).toBeTruthy();
      expect(theme.cursor).toBeTruthy();
      expect(theme.black).toBeTruthy();
      expect(theme.red).toBeTruthy();
      expect(theme.green).toBeTruthy();
      expect(theme.yellow).toBeTruthy();
      expect(theme.blue).toBeTruthy();
      expect(theme.magenta).toBeTruthy();
      expect(theme.cyan).toBeTruthy();
      expect(theme.white).toBeTruthy();
      expect(theme.brightBlack).toBeTruthy();
      expect(theme.brightRed).toBeTruthy();
      expect(theme.brightGreen).toBeTruthy();
      expect(theme.brightYellow).toBeTruthy();
      expect(theme.brightBlue).toBeTruthy();
      expect(theme.brightMagenta).toBeTruthy();
      expect(theme.brightCyan).toBeTruthy();
      expect(theme.brightWhite).toBeTruthy();
    }
    expect(terminalPresetTheme("unknown" as TerminalPreset)).toBe(terminalPresetTheme("default"));
  });

  test("until settings are saved, the font size and copy on select 0.5.0 saved under keys of their own carry over", () => {
    const saved = (entries: Record<string, string>) => savedTerminalSettings({ getItem: (key) => entries[key] ?? null });
    expect(saved({ "mirador-terminal-font-size": "16", "mirador-terminal-copy-on-select": "on" })).toEqual({ ...DEFAULT_TERMINAL_SETTINGS, fontSize: 16, copyOnSelect: true });
    expect(saved({ "mirador-terminal-font-size": "junk", "mirador-terminal-copy-on-select": "off" })).toEqual(DEFAULT_TERMINAL_SETTINGS);
    expect(saved({})).toEqual(DEFAULT_TERMINAL_SETTINGS);
    expect(saved({ [STORAGE_KEY]: JSON.stringify({ fontSize: 14 }), "mirador-terminal-font-size": "20", "mirador-terminal-copy-on-select": "on" })).toEqual({
      ...DEFAULT_TERMINAL_SETTINGS,
      fontSize: 14,
    });
  });

  test("parseTerminalSettings falls back to the defaults for nothing saved, junk and partial objects", () => {
    expect(parseTerminalSettings(null)).toEqual(DEFAULT_TERMINAL_SETTINGS);
    expect(parseTerminalSettings("not json")).toEqual(DEFAULT_TERMINAL_SETTINGS);
    expect(parseTerminalSettings("[1,2]")).toEqual(DEFAULT_TERMINAL_SETTINGS);
    expect(parseTerminalSettings(JSON.stringify({ fontSize: 16 }))).toEqual({ ...DEFAULT_TERMINAL_SETTINGS, fontSize: 16 });
  });

  test("each saved part is checked on its own, so one bad part falls back alone", () => {
    const parsed = parseTerminalSettings(
      JSON.stringify({
        fontFamily: "Fira Code",
        fontSize: 99,
        lineHeight: "tall",
        letterSpacing: 1.5,
        cursorStyle: "bar",
        cursorBlink: false,
        fontWeightBold: 450,
        scrollback: 7_000,
        copyOnSelect: true,
      })
    );
    expect(parsed).toEqual({ ...DEFAULT_TERMINAL_SETTINGS, fontFamily: "Fira Code", fontSize: 24, letterSpacing: 1.5, cursorStyle: "bar", cursorBlink: false, copyOnSelect: true });
  });

  test("parseTerminalSettings refuses font names that could end a CSS declaration", () => {
    expect(parseTerminalSettings(JSON.stringify({ fontFamily: "Menlo; color: red" })).fontFamily).toBe("");
    expect(parseTerminalSettings(JSON.stringify({ fontFamily: "  JetBrains Mono  " })).fontFamily).toBe("JetBrains Mono");
  });

  test("setTerminalSettings merges the change, clamps numbers and saves the whole object", () => {
    setTerminalSettings({ fontFamily: "Fira Code" });
    setTerminalSettings({ fontSize: 30 });
    expect(terminalSettings()).toEqual({ ...DEFAULT_TERMINAL_SETTINGS, fontFamily: "Fira Code", fontSize: 24 });
    expect(JSON.parse(storage.get(STORAGE_KEY)!)).toEqual(terminalSettings());

    setTerminalSettings({ fontSize: 8 });
    expect(terminalSettings().fontSize).toBe(11);

    setTerminalSettings({ fontSize: Number.NaN });
    expect(terminalSettings().fontSize).toBe(12);
  });

  test("line height and letter spacing keep their fractions within the offered ranges", () => {
    setTerminalSettings({ lineHeight: 1.15, letterSpacing: 2.5 });
    expect(terminalSettings().lineHeight).toBe(1.15);
    expect(terminalSettings().letterSpacing).toBe(2.5);

    setTerminalSettings({ lineHeight: 9, letterSpacing: -3 });
    expect(terminalSettings().lineHeight).toBe(2);
    expect(terminalSettings().letterSpacing).toBe(0);
  });

  test("cursor style, bold weight and scrollback only take the offered values", () => {
    setTerminalSettings({ cursorStyle: "underline", fontWeightBold: 900, scrollback: 100_000 });
    expect(terminalSettings()).toMatchObject({ cursorStyle: "underline", fontWeightBold: 900, scrollback: 100_000 });

    setTerminalSettings({ cursorStyle: "triangle" as TerminalCursorStyle, fontWeightBold: 450, scrollback: 7_000 });
    expect(terminalSettings()).toMatchObject({ cursorStyle: "block", fontWeightBold: 700, scrollback: 5_000 });
  });

  test("preset only takes the offered values and normalises mirador to default", () => {
    setTerminalSettings({ preset: "dracula" });
    expect(terminalSettings().preset).toBe("dracula");

    setTerminalSettings({ preset: "mirador" as TerminalPreset });
    expect(terminalSettings().preset).toBe("default");

    setTerminalSettings({ preset: "nord" });
    expect(terminalSettings().preset).toBe("nord");

    setTerminalSettings({ preset: "solarized-dark" });
    expect(terminalSettings().preset).toBe("solarized-dark");

    setTerminalSettings({ preset: "monokai" });
    expect(terminalSettings().preset).toBe("monokai");

    setTerminalSettings({ preset: "rainbow" as TerminalPreset });
    expect(terminalSettings().preset).toBe("default");
  });

  test("stepTerminalFontSize steps single pixels and stays clamped", () => {
    setTerminalSettings({ fontSize: 12 });
    stepTerminalFontSize(1);
    expect(terminalSettings().fontSize).toBe(13);
    stepTerminalFontSize(-1);
    expect(terminalSettings().fontSize).toBe(12);

    setTerminalSettings({ fontSize: 24 });
    stepTerminalFontSize(1);
    expect(terminalSettings().fontSize).toBe(24);

    setTerminalSettings({ fontSize: 11 });
    stepTerminalFontSize(-1);
    expect(terminalSettings().fontSize).toBe(11);
  });

  test("resetTerminalFontSize restores the font size alone", () => {
    setTerminalSettings({ fontSize: 18, lineHeight: 1.5 });
    resetTerminalFontSize();
    expect(terminalSettings().fontSize).toBe(12);
    expect(terminalSettings().lineHeight).toBe(1.5);
  });

  test("resetTerminalSettings restores every option", () => {
    setTerminalSettings({ preset: "dracula", fontFamily: "Fira Code", cursorBlink: false, scrollback: 100_000, copyOnSelect: true });
    resetTerminalSettings();
    expect(terminalSettings()).toEqual(DEFAULT_TERMINAL_SETTINGS);
  });

  test("copy-on-select helpers drive the one saved object", () => {
    setCopyOnSelect(true);
    expect(copiesOnSelect()).toBe(true);
    expect(JSON.parse(storage.get(STORAGE_KEY)!).copyOnSelect).toBe(true);
  });

  test("subscribeTerminalSettings notifies of any change until unsubscribed", () => {
    let notified = 0;
    const unsubscribe = subscribeTerminalSettings(() => {
      notified++;
    });

    setTerminalSettings({ fontSize: 15 });
    expect(notified).toBe(1);

    setCopyOnSelect(true);
    expect(notified).toBe(2);

    unsubscribe();
    setCopyOnSelect(false);
    expect(notified).toBe(2);
  });

  test("terminalFontList puts the chosen font first with the usual list as fallback", () => {
    expect(terminalFontList("")).toBe(TERMINAL_FONT);
    expect(terminalFontList("Fira Code")).toBe(`Fira Code, ${TERMINAL_FONT}`);
  });
});
