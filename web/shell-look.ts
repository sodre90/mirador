import { useSyncExternalStore } from "react";
import { contrastRatio } from "./readable-color.ts";
import { t } from "./i18n/index.ts";

/** How shell blocks in a conversation look: the agent's shell commands, the user's own, and commands awaiting approval. */
export type ShellLook = "theme" | "terminal-dark" | "soft-dark" | "paper" | "custom";

export const shellLookLabels: Record<ShellLook, string> = t.labels.shellLook;

export type ShellFontSize = "90" | "100" | "110" | "120" | "130";

export const shellFontSizeLabels: Record<ShellFontSize, string> = { "90": "90%", "100": "100%", "110": "110%", "120": "120%", "130": "130%" };

export interface ShellColours {
  background: string;
  text: string;
  prompt: string;
}

export const shellColourLabels: Record<keyof ShellColours, string> = t.labels.shellColour;

export interface ShellAppearance {
  look: ShellLook;
  custom: ShellColours;
  /** A font family the user named; empty for the app's monospace fonts. */
  font: string;
  size: ShellFontSize;
}

export const DEFAULT_CUSTOM_SHELL_COLOURS: ShellColours = { background: "#2a2c33", text: "#c3c6cd", prompt: "#8fcf98" };

export const DEFAULT_SHELL_APPEARANCE: ShellAppearance = { look: "theme", custom: DEFAULT_CUSTOM_SHELL_COLOURS, font: "", size: "100" };

const STORAGE_KEY = "mirador-shell-appearance";

const isHexColour = (value: unknown): value is string => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);

/** Font names and generic families, comma separated and optionally quoted; nothing that could end the declaration. */
export const isFontFamily = (value: unknown): value is string => typeof value === "string" && value.length <= 200 && /^[\p{L}\p{N}\s"',._-]+$/u.test(value);

const oneOf = <T extends string>(labels: Record<T, string>, value: unknown, fallback: T): T => (typeof value === "string" && value in labels ? (value as T) : fallback);

/** What was saved, each part checked on its own, so one bad part falls back alone. */
export function parseShellAppearance(saved: string | null): ShellAppearance {
  let stored: Partial<Record<keyof ShellAppearance, unknown>> = {};
  try {
    const parsed: unknown = saved ? JSON.parse(saved) : {};
    if (parsed && typeof parsed === "object") stored = parsed;
  } catch {}
  const custom: Partial<Record<keyof ShellColours, unknown>> = stored.custom && typeof stored.custom === "object" ? stored.custom : {};
  const colour = (part: keyof ShellColours) => (isHexColour(custom[part]) ? custom[part] : DEFAULT_CUSTOM_SHELL_COLOURS[part]);
  return {
    look: oneOf(shellLookLabels, stored.look, DEFAULT_SHELL_APPEARANCE.look),
    custom: { background: colour("background"), text: colour("text"), prompt: colour("prompt") },
    font: isFontFamily(stored.font) ? stored.font.trim() : "",
    size: oneOf(shellFontSizeLabels, stored.size, DEFAULT_SHELL_APPEARANCE.size),
  };
}

export const isDarkBackground = (background: string) => (contrastRatio("#ffffff", background) ?? 0) > (contrastRatio("#000000", background) ?? 0);

/** The stylesheet reads the look from the root element, and Custom's colours, the font and its size from variables there. */
export function applyShellAppearance({ look, custom, font, size }: ShellAppearance) {
  const root = document.documentElement;
  root.dataset.shellLook = look;
  root.style.setProperty("--shell-custom-background", custom.background);
  root.style.setProperty("--shell-custom-text", custom.text);
  root.style.setProperty("--shell-custom-prompt", custom.prompt);
  root.style.setProperty("--shell-custom-scheme", isDarkBackground(custom.background) ? "dark" : "light");
  root.style.setProperty("--shell-size", String(Number(size) / 100));
  if (font) root.style.setProperty("--shell-font", `${font}, var(--mono)`);
  else root.style.removeProperty("--shell-font");
}

const listeners = new Set<() => void>();

const read = () => {
  try {
    return parseShellAppearance(localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_SHELL_APPEARANCE;
  }
};

let current = read();

export const storedShellAppearance = () => current;

/** Changes the parts given; a font that is not a font family is left as it was. */
export function changeShellAppearance(change: Partial<ShellAppearance>) {
  const font = change.font === undefined || (change.font.trim() !== "" && !isFontFamily(change.font)) ? current.font : change.font.trim();
  current = { ...current, ...change, font };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {}
  applyShellAppearance(current);
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

export const useShellAppearance = () => useSyncExternalStore(subscribe, () => current);
