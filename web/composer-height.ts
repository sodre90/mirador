import { useSyncExternalStore } from "react";

const STORAGE_KEY = "mirador-composer-height";
const listeners = new Set<() => void>();

function readStoredHeight() {
  try {
    const saved = Number(localStorage.getItem(STORAGE_KEY));
    return saved > 0 ? saved : null;
  } catch {
    return null;
  }
}

let current = readStoredHeight();

/** The height the message box was dragged to, in pixels, for every conversation in this browser; null: it fits the text. */
export function setComposerHeight(height: number | null) {
  current = height === null ? null : Math.round(height);
  try {
    if (current === null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, String(current));
  } catch {}
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

export const useComposerHeight = () => useSyncExternalStore(subscribe, () => current);
