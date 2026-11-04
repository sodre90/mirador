import { type RefObject, useEffect, useRef } from "react";
import type { Step } from "./visit-trail.ts";

const MOUSE_STEP_EVENT = "mirador-mouse-step";
const STEP_OF_BUTTON: Record<number, Step> = { 3: "back", 4: "forward" };

export const stepOfMouseButton = (button: number): Step | undefined => STEP_OF_BUTTON[button];

/** Hands a press of the mouse's back or forward button to the part of the page under it: it bubbles up from `where`. */
export function stepPressedOn(where: EventTarget, step: Step) {
  where.dispatchEvent(new CustomEvent<Step>(MOUSE_STEP_EVENT, { bubbles: true, cancelable: true, detail: step }));
}

/**
 * The back and forward buttons step through what the part of the page they were pressed on shows; `onStep` takes the
 * steps no such part took. The browser's own step, which would leave Mirador, is cancelled.
 */
export function useMouseSteps(onStep: (step: Step) => void) {
  const onStepRef = useRef(onStep);
  onStepRef.current = onStep;
  useEffect(() => {
    const cancelBrowserStep = (event: MouseEvent) => {
      if (stepOfMouseButton(event.button)) event.preventDefault();
    };
    const pressed = (event: MouseEvent) => {
      const step = stepOfMouseButton(event.button);
      if (!step || !event.target) return;
      event.preventDefault();
      stepPressedOn(event.target, step);
    };
    const notTaken = (event: Event) => {
      if (!event.defaultPrevented) onStepRef.current((event as CustomEvent<Step>).detail);
    };
    window.addEventListener("mousedown", cancelBrowserStep, true);
    window.addEventListener("mouseup", pressed, true);
    window.addEventListener(MOUSE_STEP_EVENT, notTaken);
    return () => {
      window.removeEventListener("mousedown", cancelBrowserStep, true);
      window.removeEventListener("mouseup", pressed, true);
      window.removeEventListener(MOUSE_STEP_EVENT, notTaken);
    };
  }, []);
}

/** The steps pressed within `area` are its own: `onStep` takes them, and no part around it gets them. */
export function useOwnMouseSteps(area: RefObject<HTMLElement | null>, onStep: (step: Step) => void) {
  const onStepRef = useRef(onStep);
  onStepRef.current = onStep;
  useEffect(() => {
    const element = area.current;
    if (!element) return;
    const take = (event: Event) => {
      event.preventDefault();
      onStepRef.current((event as CustomEvent<Step>).detail);
    };
    element.addEventListener(MOUSE_STEP_EVENT, take);
    return () => element.removeEventListener(MOUSE_STEP_EVENT, take);
  }, []);
}
