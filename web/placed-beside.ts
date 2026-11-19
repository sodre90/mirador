import { useLayoutEffect, useRef } from "react";

const GAP = 6;
const WINDOW_EDGE = 8;

type Size = { width: number; height: number };

/** Below the entry, or above it where the window has no room below, and always inside the window. */
export function placeBeside(entry: Pick<DOMRect, "top" | "bottom" | "left">, prompt: Size, room: Size): { top: number; left: number } {
  const fitsBelow = entry.bottom + GAP + prompt.height <= room.height - WINDOW_EDGE;
  const top = fitsBelow ? entry.bottom + GAP : entry.top - GAP - prompt.height;
  const inside = (start: number, size: number, roomSize: number) => Math.max(WINDOW_EDGE, Math.min(start, roomSize - size - WINDOW_EDGE));
  return { top: inside(top, prompt.height, room.height), left: inside(entry.left, prompt.width, room.width) };
}

/**
 * Keeps a fixed prompt beside the sidebar entry it asks about, following it as the sidebar scrolls. Where that entry
 * isn't on screen, the prompt keeps the place its stylesheet gives it.
 */
export function usePlacedBeside<Prompt extends HTMLElement>(asking: unknown, findEntry: () => Element | null) {
  const prompt = useRef<Prompt>(null);
  useLayoutEffect(() => {
    const element = prompt.current;
    if (!element) return;
    const place = () => {
      const entry = findEntry()?.getBoundingClientRect();
      if (!entry?.height) {
        for (const property of ["top", "left", "transform"]) element.style.removeProperty(property);
        return;
      }
      const { width, height } = element.getBoundingClientRect();
      const { top, left } = placeBeside(entry, { width, height }, { width: window.innerWidth, height: window.innerHeight });
      Object.assign(element.style, { top: `${top}px`, left: `${left}px`, transform: "none" });
    };
    place();
    document.addEventListener("scroll", place, { capture: true, passive: true });
    window.addEventListener("resize", place, { passive: true });
    return () => {
      document.removeEventListener("scroll", place, { capture: true });
      window.removeEventListener("resize", place);
    };
  }, [asking]);
  return prompt;
}
