import { useEffect, useRef, type RefObject } from "react";
import { authorOf, type TimelineBlock } from "../shared/timeline.ts";
import type { EarlierHistory } from "./earlier-history.ts";

export type MessageStep = 1 | -1;

/** A message the user wrote, by its place in the timeline; `top` is where it is drawn in the transcript, null while it isn't drawn yet. */
export interface OwnMessagePlace {
  index: number;
  top: number | null;
}

const isOwn = (block: TimelineBlock) => block.kind === "user" && authorOf(block) === "user";

/** How far under the transcript's top edge a message stepped to is put, and so the line the reader counts as where they are. */
const READING_LINE = 8;

/**
 * The user's message a step away from the reading line: back to the nearest one above it, drawn or not, forward to the
 * nearest drawn one below it. Null where there is none that way.
 */
export function ownMessageAway(places: OwnMessagePlace[], readingLine: number, step: MessageStep): OwnMessagePlace | null {
  if (step === -1) return places.findLast(({ top }) => top === null || top < readingLine - 1) ?? null;
  return places.find(({ top }) => top !== null && top > readingLine + 1) ?? null;
}

type Listener = (step: MessageStep) => void;
const listeners = new Set<Listener>();

/** Asks the conversation on screen to show the user's previous or next message. */
export const stepThroughOwnMessages = (step: MessageStep) => listeners.forEach((listener) => listener(step));

const drawnEntries = (timeline: HTMLElement) => [...timeline.querySelectorAll<HTMLElement>(":scope > .timeline-entry")];

const topIn = (timeline: HTMLElement, entry: HTMLElement) => entry.getBoundingClientRect().top - timeline.getBoundingClientRect().top + timeline.scrollTop;

const flash = (entry: HTMLElement) => entry.animate([{ background: "var(--accent-soft)" }, { background: "transparent" }], { duration: 1200, easing: "ease-out" });

/**
 * Lets the keyboard step through the user's own messages in the conversation on screen: back past the entries drawn,
 * to those the page holds and then those only the host holds, and forward to the latest once no message is left.
 */
export function useOwnMessageSteps({
  timeline,
  timelineRef,
  firstLoaded,
  loadFrom,
  earlier,
  rememberPlace,
  jumpToLatest,
  takesSteps,
}: {
  timeline: TimelineBlock[];
  timelineRef: RefObject<HTMLDivElement | null>;
  firstLoaded: number;
  loadFrom: (index: number) => void;
  earlier: EarlierHistory;
  rememberPlace: () => void;
  jumpToLatest: () => void;
  /** A side chat shows beside its conversation, which is the one the keys step through. */
  takesSteps: boolean;
}) {
  const keyToShow = useRef<string | null>(null);
  const goesBackOnceLoaded = useRef(false);

  const show = (element: HTMLElement, entry: HTMLElement) => {
    element.scrollTop = topIn(element, entry) - READING_LINE;
    rememberPlace();
    flash(entry);
  };

  const step = (direction: MessageStep) => {
    const element = timelineRef.current;
    if (!takesSteps || !element?.checkVisibility()) return;
    const drawn = drawnEntries(element);
    if (drawn.length !== timeline.length - firstLoaded) return;
    const places = timeline.flatMap((block, index) => (isOwn(block) ? [{ index, top: index < firstLoaded ? null : topIn(element, drawn[index - firstLoaded]!) }] : []));
    const target = ownMessageAway(places, element.scrollTop + READING_LINE, direction);
    if (target?.top != null) return show(element, drawn[target.index - firstLoaded]!);
    if (target) {
      keyToShow.current = timeline[target.index]!.key;
      return loadFrom(target.index);
    }
    if (direction === 1) return jumpToLatest();
    goesBackOnceLoaded.current = earlier.load();
  };
  const latestStep = useRef(step);
  latestStep.current = step;

  useEffect(() => {
    const listener: Listener = (direction) => latestStep.current(direction);
    listeners.add(listener);
    return () => void listeners.delete(listener);
  }, []);

  useEffect(() => {
    const element = timelineRef.current;
    if (!element) return;
    if (keyToShow.current !== null) {
      const index = timeline.findIndex(({ key }) => key === keyToShow.current);
      if (index === -1) return void (keyToShow.current = null);
      if (index < firstLoaded) return;
      keyToShow.current = null;
      const entry = drawnEntries(element)[index - firstLoaded];
      return entry && show(element, entry);
    }
    if (goesBackOnceLoaded.current && !earlier.loading) {
      goesBackOnceLoaded.current = false;
      step(-1);
    }
  }, [timeline, firstLoaded, earlier.loading]);
}
