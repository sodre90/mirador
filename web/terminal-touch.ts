import type { Terminal } from "@xterm/xterm";

const DRAG_STARTS_AFTER = 8;
const FLING_AFTER_A_PAUSE_OF = 100;
const FRAME = 16;
const FLING_SLOWS_BY_EACH_FRAME = 0.95;
const FLING_STOPS_BELOW = 0.05;

interface Point {
  clientX: number;
  clientY: number;
}

interface Drag extends Point {
  at: number;
  velocity: number;
  dragging: boolean;
}

/** Turns the pixels a finger moves into whole lines, keeping what is left of a line for its next move. */
export function lineCounter() {
  let unscrolled = 0;
  return {
    lines(pixels: number, lineHeight: number) {
      unscrolled += pixels;
      const lines = Math.trunc(unscrolled / lineHeight);
      unscrolled -= lines * lineHeight;
      return lines;
    },
    reset() {
      unscrolled = 0;
    },
  };
}

export const flingSlowedDown = (velocity: number, elapsed: number) => velocity * FLING_SLOWS_BY_EACH_FRAME ** (elapsed / FRAME);

export const flingStopped = (velocity: number) => Math.abs(velocity) <= FLING_STOPS_BELOW;

/**
 * xterm.js 6 has no touch scrolling. A finger drags the shell's output, and a quick one keeps it going a while. Over a
 * full-screen program it scrolls as a wheel does, which xterm turns into arrow keys or, for a program that follows the
 * mouse, into its wheel reports. The phone bundles this file into its WebView and calls scrollWithAFinger(view, screen)
 * from a string in mirador-mobile's terminal-page.ts, which no type checker sees: renaming the export fails its vendor
 * build, but changing the parameters fails only on the phone.
 */
export function scrollWithAFinger(view: Terminal, screen: HTMLElement) {
  const counter = lineCounter();
  let drag: Drag | null = null;
  let fling: number | null = null;

  const lineHeight = () => screen.querySelector(".xterm-screen")!.clientHeight / view.rows;
  const showsTheScrollback = () => view.buffer.active.type === "normal" && view.modes.mouseTrackingMode === "none";
  // To xterm's root, past its scroll area: a full-screen program's screen has lines to scroll there after the terminal
  // grew and shrank, which would take the wheel instead.
  let sendingItsOwnWheel = false;
  const wheelAt = (deltaY: number, { clientX, clientY }: Point) => {
    sendingItsOwnWheel = true;
    view.element?.dispatchEvent(new WheelEvent("wheel", { deltaY, deltaMode: WheelEvent.DOM_DELTA_PIXEL, clientX, clientY, cancelable: true }));
    sendingItsOwnWheel = false;
  };
  const scrollBy = (deltaY: number, point: Point) => (showsTheScrollback() ? view.scrollLines(counter.lines(deltaY, lineHeight())) : wheelAt(deltaY, point));

  const stopFling = () => {
    if (fling !== null) cancelAnimationFrame(fling);
    fling = null;
  };
  const flingOn = (velocity: number, point: Point) => {
    let last = performance.now();
    const step = (now: number) => {
      velocity = flingSlowedDown(velocity, now - last);
      scrollBy(velocity * (now - last), point);
      last = now;
      fling = flingStopped(velocity) ? null : requestAnimationFrame(step);
    };
    fling = requestAnimationFrame(step);
  };

  const touchStarted = (event: TouchEvent) => {
    stopFling();
    counter.reset();
    const [touch] = event.touches;
    drag = event.touches.length === 1 && touch ? { clientX: touch.clientX, clientY: touch.clientY, at: event.timeStamp, velocity: 0, dragging: false } : null;
  };
  const touchMoved = (event: TouchEvent) => {
    const [touch] = event.touches;
    if (event.touches.length !== 1 || !touch || !drag) return;
    const deltaY = drag.clientY - touch.clientY;
    if (!drag.dragging && Math.abs(deltaY) < DRAG_STARTS_AFTER) return;
    scrollBy(deltaY, drag);
    const elapsed = Math.max(1, event.timeStamp - drag.at);
    drag = { clientX: touch.clientX, clientY: touch.clientY, at: event.timeStamp, velocity: deltaY / elapsed, dragging: true };
  };
  const touchEnded = (event: TouchEvent) => {
    if (drag?.dragging && event.timeStamp - drag.at < FLING_AFTER_A_PAUSE_OF) flingOn(drag.velocity, drag);
    drag = null;
  };
  const touchCancelled = () => {
    drag = null;
  };

  screen.addEventListener("touchstart", touchStarted, { passive: true });
  screen.addEventListener("touchmove", touchMoved, { passive: true });
  screen.addEventListener("touchend", touchEnded);
  screen.addEventListener("touchcancel", touchCancelled);
  const typing = view.onData(() => {
    if (!sendingItsOwnWheel) stopFling();
  });
  return () => {
    stopFling();
    typing.dispose();
    screen.removeEventListener("touchstart", touchStarted);
    screen.removeEventListener("touchmove", touchMoved);
    screen.removeEventListener("touchend", touchEnded);
    screen.removeEventListener("touchcancel", touchCancelled);
  };
}
