import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/** Text measured apart from its box can come out a fraction of a pixel wider than the box draws it. */
const MEASURING_SLACK = 0.5;

/** Whether text this wide runs past the room its box gives it. */
export const runsPast = (textWidth: number, room: number) => textWidth > room + MEASURING_SLACK;

/** Whether a box that ends its text in an ellipsis cuts it short, including a brought agent's base name truncated before its bringer. */
export const textCutShort = (element: HTMLElement) =>
  element.scrollWidth > element.clientWidth ||
  [...element.querySelectorAll<HTMLElement>(".room-agent-base, .room-agent-bringer")].some((part) => part.scrollWidth > part.clientWidth);

/** Whether a box clamped to a number of lines cuts its text short. */
export const linesCutShort = (element: HTMLElement) => element.scrollHeight > element.clientHeight;

let measuring: CanvasRenderingContext2D | null = null;

/** Whether a select cuts the label of its chosen option short; the select's own size tells nothing of its label's. */
export function chosenLabelCutShort(select: HTMLSelectElement) {
  const style = getComputedStyle(select);
  measuring ??= document.createElement("canvas").getContext("2d")!;
  measuring.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const room = select.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  return runsPast(measuring.measureText(select.selectedOptions[0]?.text ?? "").width, room);
}

/** Whether the element cuts its text short, measured again as its box resizes and as its text changes. */
export function useCutShort<T extends HTMLElement>(cutShort: (element: T) => boolean, text: string) {
  const element = useRef<T>(null);
  const [isCutShort, setCutShort] = useState(false);
  useLayoutEffect(() => {
    const target = element.current;
    if (!target) return;
    const measure = () => setCutShort(cutShort(target));
    measure();
    const resizes = new ResizeObserver(measure);
    resizes.observe(target);
    return () => resizes.disconnect();
  }, [text]);
  return [element, isCutShort] as const;
}

/** A line that ends in an ellipsis where its box is too narrow for it, and then holds all of it in a hint. */
export function HintedWhenCutShort({ className, whole, children }: { className: string; whole: string; children: ReactNode }) {
  const [element, cutShort] = useCutShort<HTMLSpanElement>(textCutShort, whole);
  return (
    <span ref={element} className={className} data-hint={cutShort ? whole : undefined}>
      {children}
    </span>
  );
}

/** Renders "Agent (Bringer)" so a narrow box cuts the agent's name before " (Bringer)", keeping who brought it visible. */
export function BroughtAgentName({ prefix = "", name, bringer, suffix = "" }: { prefix?: string; name: string; bringer: string; suffix?: string }) {
  return (
    <span className="brought-agent-name">
      <span className="room-agent-base">{`${prefix}${name}`}</span>
      <span className="room-agent-bringer">{` (${bringer})${suffix}`}</span>
    </span>
  );
}
