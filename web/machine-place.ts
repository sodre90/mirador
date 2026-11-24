const PLACE_MESSAGE = "mirador:machine-place";
const SHOWN_MESSAGE = "mirador:machine-shown";

/** In the frame another computer's Mirador shows this machine in: its rail, or the pane its invited rooms open in. */
export const shownInAnotherMirador = () => window.self !== window.top;

/** A machine's page in another computer's rail tells it which conversation it shows, for the rail to come back to. */
export function tellTheRailThePlace(hash: string) {
  if (window.parent !== window) window.parent.postMessage({ type: PLACE_MESSAGE, hash }, "*");
}

/** The address part of a place message, if it names a conversation or none; anything else a frame sends is ignored. */
export function placeIn(data: unknown) {
  const { type, hash } = (typeof data === "object" && data !== null ? data : {}) as { type?: unknown; hash?: unknown };
  return type === PLACE_MESSAGE && typeof hash === "string" && /^(#\/c\/[\w-]+)?$/.test(hash) ? hash : null;
}

/** The rail keeps a machine it no longer shows loaded a while, hidden, where the machine's page would still be in sight; it tells the page each time. */
export function tellTheMachineItIsShown(frame: HTMLIFrameElement | null, shown: boolean) {
  frame?.contentWindow?.postMessage({ type: SHOWN_MESSAGE, shown }, "*");
}

const shownListeners = new Set<() => void>();
let shownByTheRail = true;

/** Listening from the start, before the page renders, so that what the rail says as the page loads is heard. */
if (typeof window !== "undefined" && window.parent !== window) {
  window.addEventListener("message", ({ source, data }: MessageEvent) => {
    const { type, shown } = (typeof data === "object" && data !== null ? data : {}) as { type?: unknown; shown?: unknown };
    if (source !== window.parent || type !== SHOWN_MESSAGE || typeof shown !== "boolean" || shown === shownByTheRail) return;
    shownByTheRail = shown;
    shownListeners.forEach((listener) => listener());
  });
}

/** Whether the rail of the computer this page is a machine in shows it; a page in no rail is always shown. */
export const isShownByTheRail = () => shownByTheRail;

export function whenTheRailShowsOrHides(listener: () => void) {
  shownListeners.add(listener);
  return () => void shownListeners.delete(listener);
}
