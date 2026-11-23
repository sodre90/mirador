import { useEffect, useLayoutEffect, useRef, useState } from "react";

const SHOW_DELAY_MS = 700;
const GAP = 6;
const EDGE = 8;
/** How long a long hint waits for the pointer to cross from what it explains into it. */
const LONG_HINT_GRACE_MS = 300;

interface Hint {
  text: string;
  shortcut: string | null;
  long: boolean;
  anchor: DOMRect;
}

/** A hint inside a canvas frame, which the page's own listeners can't see into; its anchor is where it shows on the page. */
export type FramedHint = { text: string; anchor: DOMRect } | null;

const framedHintListeners = new Set<(hint: FramedHint) => void>();

export const showFramedHint = (hint: FramedHint) => framedHintListeners.forEach((listener) => listener(hint));

const hintedElementAt = (target: EventTarget | null) => (target instanceof Element ? target.closest<HTMLElement>("[data-hint], [data-shortcut]") : null);

/**
 * Shows the `data-hint` text of whatever is pointed at or focused with the keyboard, one hint at a time, with the
 * key that does the same (`data-shortcut`) when there is one.
 * A long one (`data-hint-long`) shows every paragraph alike, shows on a press too, and stays while the pointer is in it,
 * so it can be read and scrolled.
 * Pressing an element puts its hint away until the pointer moves to something else or the element loses focus.
 */
export function HintLayer() {
  const [hint, setHint] = useState<Hint | null>(null);
  const bubble = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let current: HTMLElement | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    let visible = false;
    let shownLong = false;
    let pointerInBubble = false;
    let dismissed: HTMLElement | null = null;
    const isInBubble = (target: EventTarget | null) => target instanceof Node && Boolean(bubble.current?.contains(target));
    const isLong = (element: HTMLElement | null): element is HTMLElement => element?.dataset.hintLong !== undefined;
    const keepShown = () => clearTimeout(hideTimer);
    const hide = () => {
      clearTimeout(timer);
      keepShown();
      current = null;
      visible = false;
      shownLong = false;
      pointerInBubble = false;
      setHint(null);
    };
    const hideSoonIfLong = () => {
      if (!shownLong) return hide();
      keepShown();
      hideTimer = setTimeout(hide, LONG_HINT_GRACE_MS);
    };
    const showFor = (element: HTMLElement, delay: number) => {
      clearTimeout(timer);
      keepShown();
      current = element;
      timer = setTimeout(() => {
        const text = element.dataset.hint ?? "";
        const shortcut = element.dataset.shortcut ?? null;
        if ((!text && !shortcut) || !element.isConnected) return;
        visible = true;
        shownLong = isLong(element);
        setHint({ text, shortcut, long: shownLong, anchor: element.getBoundingClientRect() });
      }, delay);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (isInBubble(event.target)) return;
      const element = hintedElementAt(event.target);
      if (isLong(element)) {
        if (element !== current || !visible) showFor(element, 0);
        return;
      }
      dismissed = element;
      hide();
    };
    const onPointerOver = (event: PointerEvent) => {
      pointerInBubble = isInBubble(event.target);
      if (pointerInBubble) return keepShown();
      const element = hintedElementAt(event.target);
      if (element !== dismissed) dismissed = null;
      if (element === current) return keepShown();
      if (element && element !== dismissed) showFor(element, visible ? 0 : SHOW_DELAY_MS);
      else hideSoonIfLong();
    };
    const onFocusIn = (event: FocusEvent) => {
      const element = hintedElementAt(event.target);
      if (element && element !== dismissed && event.target instanceof Element && event.target.matches(":focus-visible")) showFor(element, 0);
    };
    const onFocusOut = (event: FocusEvent) => {
      if (event.target instanceof Node && dismissed?.contains(event.target)) dismissed = null;
      if (!pointerInBubble) hide();
    };
    const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && hide();
    const onScroll = (event: Event) => isInBubble(event.target) || hide();
    const onFramedHint = (framed: FramedHint) => {
      if (!framed) return hide();
      clearTimeout(timer);
      current = null;
      timer = setTimeout(
        () => {
          visible = true;
          setHint({ text: framed.text, shortcut: null, long: false, anchor: framed.anchor });
        },
        visible ? 0 : SHOW_DELAY_MS,
      );
    };
    framedHintListeners.add(onFramedHint);
    document.addEventListener("pointerover", onPointerOver);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("blur", hide);
    return () => {
      clearTimeout(timer);
      keepShown();
      framedHintListeners.delete(onFramedHint);
      document.removeEventListener("pointerover", onPointerOver);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("blur", hide);
    };
  }, []);

  useLayoutEffect(() => {
    const element = bubble.current;
    if (!hint || !element) return;
    element.style.left = "0px";
    element.style.top = "0px";
    const roomBelow = window.innerHeight - EDGE - hint.anchor.bottom - GAP;
    const roomAbove = hint.anchor.top - GAP - EDGE;
    element.style.maxHeight = hint.long ? `${Math.max(roomBelow, roomAbove)}px` : "";
    const { width, height } = element.getBoundingClientRect();
    const fitsBelow = height <= roomBelow;
    const top = fitsBelow ? hint.anchor.bottom + GAP : hint.anchor.top - GAP - height;
    const left = Math.min(Math.max(EDGE, hint.anchor.left), window.innerWidth - width - EDGE);
    element.style.top = `${Math.max(EDGE, top)}px`;
    element.style.left = `${left}px`;
    element.style.visibility = "visible";
  }, [hint]);

  if (!hint) return null;
  if (hint.long)
    return (
      <div ref={bubble} className="hint-bubble long" role="tooltip" style={{ visibility: "hidden" }}>
        {hint.text.split("\n\n").map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </div>
    );
  const [summary, ...details] = hint.text.split("\n\n");
  return (
    <div ref={bubble} className="hint-bubble" role="tooltip" style={{ visibility: "hidden" }}>
      <div className="hint-summary">
        {summary && (details.length > 0 ? <strong>{summary}</strong> : <span>{summary}</span>)}
        {hint.shortcut && <kbd>{hint.shortcut}</kbd>}
      </div>
      {details.map((paragraph) => (
        <p key={paragraph}>{paragraph}</p>
      ))}
    </div>
  );
}
