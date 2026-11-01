import { useSyncExternalStore } from "react";
import { TERMINAL_FONT, terminalPresetLabels, terminalPresetTheme, type TerminalPreset } from "./terminal-look.ts";
import { isFontFamily } from "./shell-look.ts";
import { t } from "./i18n/index.ts";

export { type TerminalPreset, terminalPresetLabels, terminalPresetTheme } from "./terminal-look.ts";

export type TerminalCursorStyle = "block" | "underline" | "bar";

export const cursorStyleLabels: Record<TerminalCursorStyle, string> = t.labels.cursorStyle;

export const TERMINAL_PRESETS: readonly TerminalPreset[] = ["default", "dracula", "solarized-dark", "nord", "monokai"];
export const TERMINAL_FONT_SIZES = Array.from({ length: 14 }, (_, index) => 11 + index);
export const TERMINAL_LINE_HEIGHTS = { min: 1, max: 2, step: 0.05 };
export const TERMINAL_LETTER_SPACINGS = { min: 0, max: 5, step: 0.5 };
export const TERMINAL_FONT_WEIGHTS_BOLD = [400, 500, 600, 700, 800, 900];
export const TERMINAL_SCROLLBACKS = [1_000, 5_000, 10_000, 50_000, 100_000];

export interface TerminalSettings {
  preset: TerminalPreset;
  /** A font named by the user, empty for the usual Nerd Font list. */
  fontFamily: string;
  fontSize: number;
  /** A multiple of the font size. */
  lineHeight: number;
  /** Extra space between characters, in px. */
  letterSpacing: number;
  cursorStyle: TerminalCursorStyle;
  cursorBlink: boolean;
  fontWeightBold: number;
  scrollback: number;
  copyOnSelect: boolean;
}

export const DEFAULT_TERMINAL_SETTINGS: TerminalSettings = {
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
};

const STORAGE_KEY = "mirador-terminal-settings";

const numberWithin = (value: unknown, { min, max }: { min: number; max: number }, fallback: number, whole: boolean) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const clamped = Math.min(max, Math.max(min, value));
  return whole ? Math.round(clamped) : clamped;
};

const booleanOf = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);

const oneOf = <T>(allowed: readonly T[], value: unknown, fallback: T) => (allowed.includes(value as T) ? (value as T) : fallback);

const presetOf = (value: unknown): TerminalPreset => (value === "mirador" ? "default" : oneOf(TERMINAL_PRESETS, value, DEFAULT_TERMINAL_SETTINGS.preset));

const fontOf = (value: unknown) => (isFontFamily(value) ? value.trim() : DEFAULT_TERMINAL_SETTINGS.fontFamily);

const normalise = (part: Partial<TerminalSettings>): TerminalSettings => ({
  preset: presetOf(part.preset),
  fontFamily: fontOf(part.fontFamily),
  fontSize: numberWithin(part.fontSize, { min: 11, max: 24 }, DEFAULT_TERMINAL_SETTINGS.fontSize, true),
  lineHeight: numberWithin(part.lineHeight, TERMINAL_LINE_HEIGHTS, DEFAULT_TERMINAL_SETTINGS.lineHeight, false),
  letterSpacing: numberWithin(part.letterSpacing, TERMINAL_LETTER_SPACINGS, DEFAULT_TERMINAL_SETTINGS.letterSpacing, false),
  cursorStyle: oneOf(["block", "underline", "bar"] as const, part.cursorStyle, DEFAULT_TERMINAL_SETTINGS.cursorStyle),
  cursorBlink: booleanOf(part.cursorBlink, DEFAULT_TERMINAL_SETTINGS.cursorBlink),
  fontWeightBold: oneOf(TERMINAL_FONT_WEIGHTS_BOLD, part.fontWeightBold, DEFAULT_TERMINAL_SETTINGS.fontWeightBold),
  scrollback: oneOf(TERMINAL_SCROLLBACKS, part.scrollback, DEFAULT_TERMINAL_SETTINGS.scrollback),
  copyOnSelect: booleanOf(part.copyOnSelect, DEFAULT_TERMINAL_SETTINGS.copyOnSelect),
});

/** What was saved, each part checked on its own, so one bad part falls back alone. */
export function parseTerminalSettings(saved: string | null): TerminalSettings {
  try {
    const parsed: unknown = saved ? JSON.parse(saved) : {};
    if (!parsed || typeof parsed !== "object") return DEFAULT_TERMINAL_SETTINGS;
    return normalise(parsed as Partial<TerminalSettings>);
  } catch {
    return DEFAULT_TERMINAL_SETTINGS;
  }
}

/** 0.5.0 kept these two under keys of their own. */
const FONT_SIZE_KEY_OF_0_5 = "mirador-terminal-font-size";
const COPY_ON_SELECT_KEY_OF_0_5 = "mirador-terminal-copy-on-select";

/** The settings saved in `storage`; until any are, the font size and copy on select 0.5.0 saved, so an upgrade keeps them. */
export function savedTerminalSettings(storage: Pick<Storage, "getItem">): TerminalSettings {
  const saved = storage.getItem(STORAGE_KEY);
  if (saved !== null) return parseTerminalSettings(saved);
  const fontSize = storage.getItem(FONT_SIZE_KEY_OF_0_5);
  const copyOnSelect = storage.getItem(COPY_ON_SELECT_KEY_OF_0_5);
  return normalise({ ...(fontSize !== null && { fontSize: Number(fontSize) }), ...(copyOnSelect !== null && { copyOnSelect: copyOnSelect === "on" }) });
}

function storedTerminalSettings(): TerminalSettings {
  try {
    return savedTerminalSettings(localStorage);
  } catch {
    return DEFAULT_TERMINAL_SETTINGS;
  }
}

let current = storedTerminalSettings();
const listeners = new Set<() => void>();

/** Merges the change into the saved settings; each part is checked, so a bad one falls back alone. */
export function setTerminalSettings(change: Partial<TerminalSettings>) {
  current = normalise({ ...current, ...change });
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {}
  listeners.forEach((listener) => listener());
}

export const resetTerminalSettings = () => setTerminalSettings(DEFAULT_TERMINAL_SETTINGS);

export const terminalSettings = () => current;

/** The font list terminals and the statusline draw with: the chosen font first, the usual list as fallback. */
export const terminalFontList = (family: string) => (family === "" ? TERMINAL_FONT : `${family}, ${TERMINAL_FONT}`);

export const subscribeTerminalSettings = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

export function useTerminalSettings() {
  return useSyncExternalStore(subscribeTerminalSettings, () => current);
}

/** One px up or down, in single-pixel steps; the ends stay put. */
export const stepTerminalFontSize = (direction: 1 | -1) =>
  setTerminalSettings({ fontSize: numberWithin(current.fontSize + direction, { min: 11, max: 24 }, DEFAULT_TERMINAL_SETTINGS.fontSize, true) });

export const resetTerminalFontSize = () => setTerminalSettings({ fontSize: DEFAULT_TERMINAL_SETTINGS.fontSize });

export const useCopyOnSelect = () => useTerminalSettings().copyOnSelect;
export const copiesOnSelect = () => current.copyOnSelect;
export const setCopyOnSelect = (on: boolean) => setTerminalSettings({ copyOnSelect: on });
