import { useCallback, useEffect, useLayoutEffect, useState, type RefObject } from "react";
import type { Conversation } from "../shared/model.ts";
import { mostUrgentTone, tonesByUrgency, waitingByUrgency, type WaitingTone } from "../shared/waiting.ts";

/** A sidebar row standing for conversations waiting for you: where it is, for how many and how urgent. */
export interface WaitingMark {
  top: number;
  bottom: number;
  count: number;
  tone: WaitingTone;
}

export interface HiddenWaiting {
  count: number;
  tone: WaitingTone;
}

export interface WaitingOutOfView {
  above: HiddenWaiting | null;
  below: HiddenWaiting | null;
}

const NOTHING_OUT_OF_VIEW: WaitingOutOfView = { above: null, below: null };
const WAITING_ROW = "[data-waiting-tone]";

const hiddenWaiting = (marks: WaitingMark[]): HiddenWaiting | null =>
  marks.length === 0
    ? null
    : {
        count: marks.reduce((sum, { count }) => sum + count, 0),
        tone: tonesByUrgency.find((tone) => marks.some((mark) => mark.tone === tone))!,
      };

/** The conversations waiting for you whose rows are wholly scrolled out of the view, above it and below it. */
export function waitingOutOfView(marks: WaitingMark[], view: { top: number; bottom: number }): WaitingOutOfView {
  return {
    above: hiddenWaiting(marks.filter(({ bottom }) => bottom <= view.top)),
    below: hiddenWaiting(marks.filter(({ top }) => top >= view.bottom)),
  };
}

const sameHidden = (a: HiddenWaiting | null, b: HiddenWaiting | null) => a?.count === b?.count && a?.tone === b?.tone;
const sameOutOfView = (a: WaitingOutOfView, b: WaitingOutOfView) => sameHidden(a.above, b.above) && sameHidden(a.below, b.below);

/** What a folded group's heading stands for: the conversations in it waiting for you, the most urgent setting the tone. */
export function waitingInFoldedGroup(conversations: Conversation[]): HiddenWaiting | null {
  const waiting = waitingByUrgency(conversations);
  return waiting.length === 0 ? null : { count: waiting.length, tone: mostUrgentTone(waiting.map(({ waitingFor }) => waitingFor!))! };
}

function waitingRowsIn(scroller: HTMLElement) {
  return [...scroller.querySelectorAll<HTMLElement>(WAITING_ROW)].map((element) => {
    const { top, bottom } = element.getBoundingClientRect();
    return { element, mark: { top, bottom, count: Number(element.dataset.waitingCount ?? "1"), tone: element.dataset.waitingTone as WaitingTone } };
  });
}

/** The sidebar's conversations waiting for you that are scrolled out of view, kept up to date as it scrolls, resizes and changes. */
export function useWaitingOutOfView(scroller: RefObject<HTMLElement | null>) {
  const [outOfView, setOutOfView] = useState(NOTHING_OUT_OF_VIEW);
  const measure = useCallback(() => {
    const element = scroller.current;
    if (!element) return;
    const { top, bottom } = element.getBoundingClientRect();
    const next = waitingOutOfView(
      waitingRowsIn(element).map(({ mark }) => mark),
      { top, bottom },
    );
    setOutOfView((current) => (sameOutOfView(current, next) ? current : next));
  }, [scroller]);
  useLayoutEffect(measure);
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    element.addEventListener("scroll", measure, { passive: true });
    const resizes = new ResizeObserver(measure);
    resizes.observe(element);
    return () => {
      element.removeEventListener("scroll", measure);
      resizes.disconnect();
    };
  }, [scroller, measure]);
  return outOfView;
}

/** Brings the nearest of the conversations waiting out of view on that side to the middle of the sidebar. */
export function scrollToNearestWaiting(scroller: HTMLElement, side: "above" | "below") {
  const view = scroller.getBoundingClientRect();
  const hidden = waitingRowsIn(scroller).filter(({ mark }) => (side === "above" ? mark.bottom <= view.top : mark.top >= view.bottom));
  const nearest = side === "above" ? hidden.at(-1) : hidden[0];
  nearest?.element.scrollIntoView({ block: "center" });
}
