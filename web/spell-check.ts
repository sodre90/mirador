import { useSyncExternalStore } from "react";
import { DESKTOP_NONCE_EVENT, DESKTOP_SPELL_CHECK_LANGUAGES_EVENT, type DesktopSpellCheck } from "../shared/desktop-menu.ts";
import { desktopNonce, inDesktopApp, sendToDesktopApp } from "./desktop-bridge.ts";

const STORAGE_KEY = "mirador-spell-check";
const DEFAULT_SPELL_CHECK: DesktopSpellCheck = { enabled: true, languages: [] };
const listeners = new Set<() => void>();

function storedSpellCheck(): DesktopSpellCheck {
  try {
    const saved: Partial<Record<keyof DesktopSpellCheck, unknown>> = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return {
      enabled: typeof saved.enabled === "boolean" ? saved.enabled : DEFAULT_SPELL_CHECK.enabled,
      languages: Array.isArray(saved.languages) ? saved.languages.filter((tag): tag is string => typeof tag === "string") : [],
    };
  } catch {
    return { ...DEFAULT_SPELL_CHECK, languages: [] };
  }
}

let spellCheck = storedSpellCheck();
let desktopLanguages: string[] = [];

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

const tellDesktopApp = (nonce: string | null) => {
  if (nonce) sendToDesktopApp({ type: "desktop-spell-check", nonce, ...spellCheck });
};

export function setSpellCheck(next: DesktopSpellCheck) {
  spellCheck = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {}
  listeners.forEach((listener) => listener());
  if (inDesktopApp() && window.parent === window) tellDesktopApp(desktopNonce());
}

export const useSpellCheck = () => useSyncExternalStore(subscribe, () => spellCheck);

/** The dictionaries the Linux desktop app has; empty in a browser, in the macOS app, and until the app has said. */
export const useDesktopSpellCheckLanguages = () => useSyncExternalStore(subscribe, () => desktopLanguages);

/** The desktop app applies the setting to its web view: it hears it with its nonce, and says which languages it can check. */
export function giveSpellCheckToDesktopApp() {
  if (!inDesktopApp() || window.parent !== window) return;
  window.addEventListener(DESKTOP_SPELL_CHECK_LANGUAGES_EVENT, (event) => {
    const detail = (event as CustomEvent<unknown>).detail;
    if (!Array.isArray(detail) || !detail.every((tag) => typeof tag === "string")) return;
    desktopLanguages = detail;
    listeners.forEach((listener) => listener());
  });
  window.addEventListener(DESKTOP_NONCE_EVENT, (event) => tellDesktopApp((event as CustomEvent<string>).detail));
  tellDesktopApp(desktopNonce());
}
