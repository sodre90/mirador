import { useSyncExternalStore } from "react";

declare module "react" {
  interface HTMLAttributes<T> {
    writingsuggestions?: "true" | "false";
  }
}

/** What macOS may do to the words typed in the desktop app: fix them on Space, and offer the rest of a word inline. */
export interface TypingAids {
  autocorrect: boolean;
  predictions: boolean;
}

const STORAGE_KEY = "mirador-typing-aids";
const listeners = new Set<() => void>();

function storedTypingAids(): TypingAids {
  try {
    const saved: Partial<TypingAids> = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return { autocorrect: saved.autocorrect === true, predictions: saved.predictions === true };
  } catch {
    return { autocorrect: false, predictions: false };
  }
}

let typingAids = storedTypingAids();

export function setTypingAids(next: TypingAids) {
  typingAids = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {}
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

export const useTypingAids = () => useSyncExternalStore(subscribe, () => typingAids);

/** Spread onto every text field, so a change in Settings reaches the ones already open. */
export function useTypingAidAttributes() {
  const { autocorrect, predictions } = useTypingAids();
  return { autoCorrect: autocorrect ? "on" : "off", writingsuggestions: predictions ? "true" : "false" } as const;
}

/** For a field that takes a name or a pasted text rather than prose: nothing may change what is typed or offer more of it. */
export const NAME_FIELD_ATTRIBUTES = { autoCorrect: "off", autoCapitalize: "off", spellCheck: false, autoComplete: "off", writingsuggestions: "false" } as const;
