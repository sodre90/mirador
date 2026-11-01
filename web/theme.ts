import { useState, useSyncExternalStore } from "react";
import { DESKTOP_NONCE_EVENT, isDesktopAppearance } from "../shared/desktop-menu.ts";
import { desktopNonce, inDesktopApp, sendToDesktopApp } from "./desktop-bridge.ts";
import { t } from "./i18n/index.ts";

export type Theme = "light" | "dark" | "system";

export const themeLabels: Record<Theme, string> = t.labels.theme;

const STORAGE_KEY = "mirador-theme";

export function storedTheme(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === "dark" || saved === "system" ? saved : "light";
  } catch {
    return "light";
  }
}

/** The stylesheet reads the theme from the root element. */
export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}

/** The macOS app gives its window the chosen theme, once it has handed this page its nonce and on every choice after. */
export function giveThemeToDesktopApp() {
  if (!inDesktopApp() || window.parent !== window) return;
  const give = (nonce: string | null) => {
    const appearance = document.documentElement.dataset.theme;
    if (nonce && isDesktopAppearance(appearance)) sendToDesktopApp({ type: "desktop-appearance", nonce, appearance });
  };
  window.addEventListener(DESKTOP_NONCE_EVENT, (event) => give((event as CustomEvent<string>).detail));
  new MutationObserver(() => give(desktopNonce())).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
}

const systemPrefersDark = () => matchMedia("(prefers-color-scheme: dark)");

/** Light or dark, as the panel shows now: Match system takes the system's. */
export function shownTheme(): "light" | "dark" {
  const theme = document.documentElement.dataset.theme;
  if (theme === "system") return systemPrefersDark().matches ? "dark" : "light";
  return theme === "dark" ? "dark" : "light";
}

/** Calls back when the shown theme may have changed: another theme chosen, or the system's switched under Match system. */
export function onShownThemeChange(listener: () => void) {
  const chosen = new MutationObserver(listener);
  chosen.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  const system = systemPrefersDark();
  system.addEventListener("change", listener);
  return () => {
    chosen.disconnect();
    system.removeEventListener("change", listener);
  };
}

export const useShownTheme = () => useSyncExternalStore(onShownThemeChange, shownTheme);

export function useTheme() {
  const [theme, setTheme] = useState(storedTheme);
  const choose = (next: Theme) => {
    applyTheme(next);
    setTheme(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {}
  };
  return [theme, choose] as const;
}
