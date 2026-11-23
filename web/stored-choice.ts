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
  const show = (next: T) => {
    current = next;
    listeners.forEach((listener) => listener());
  };
  const set = (next: T) => {
    try {
      localStorage.setItem(storageKey, next);
    } catch {}
    show(next);
  };
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  };
  return {
    set,
    /** Goes by the value on this page alone, with nothing remembered; anything but one of the values is ignored. */
    showIfOneOfThem: (value: unknown) => {
      const known = values.find((each) => each === value);
      if (known !== undefined) show(known);
    },
    get: () => current,
    use: () => useSyncExternalStore(subscribe, () => current),
  };
}
