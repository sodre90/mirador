import { useSyncExternalStore } from "react";

/** One of a few values, remembered in this browser; every component using it follows a change at once. */
export function storedChoice<T extends string>(storageKey: string, values: readonly T[], fallback: T) {
  const listeners = new Set<() => void>();
  const read = (): T => {
    try {
      const saved = localStorage.getItem(storageKey);
      return values.find((value) => value === saved) ?? fallback;
    } catch {
      return fallback;
    }
  };
  let current = read();
  const set = (next: T) => {
    current = next;
    try {
      localStorage.setItem(storageKey, next);
    } catch {}
    listeners.forEach((listener) => listener());
  };
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  };
  return { set, get: () => current, use: () => useSyncExternalStore(subscribe, () => current) };
}
