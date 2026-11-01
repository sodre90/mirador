import { useState } from "react";
export {
  lastsUntilOpened,
  mostUrgentTone,
  tonesByUrgency,
  waitingByUrgency,
  waitingShowsOnDot,
  waitingTones,
  type WaitingTone,
} from "../shared/waiting.ts";
import type { WaitingTone } from "../shared/waiting.ts";
import { t } from "./i18n/index.ts";

export type WaitingStyle = "pills" | "dots" | "list";

export const waitingLabels: Record<WaitingTone, string> = t.shell.sidebar.waiting;

export const waitingStyleLabels: Record<WaitingStyle, string> = t.labels.waitingStyle;

const STORAGE_KEY = "mirador-waiting-style";

export function storedWaitingStyle(): WaitingStyle {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === "dots" || saved === "list" ? saved : "pills";
  } catch {
    return "pills";
  }
}

/** The stylesheet hides the pills and counts, or shows the list on top, by the root element's data-waiting. */
export function applyWaitingStyle(style: WaitingStyle) {
  document.documentElement.dataset.waiting = style;
}

export function useWaitingStyle() {
  const [style, setStyle] = useState(storedWaitingStyle);
  const choose = (next: WaitingStyle) => {
    applyWaitingStyle(next);
    setStyle(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {}
  };
  return [style, choose] as const;
}
