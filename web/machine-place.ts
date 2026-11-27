const PLACE_MESSAGE = "mirador:machine-place";
const SHOWN_MESSAGE = "mirador:machine-shown";
const BROUGHT_WORK_MESSAGE = "mirador:open-brought-work";

/** Request from an invited room's frame to open Its work for an agent the viewer brought, optionally jumped to one room message. */
export interface OpenBroughtWorkRequest {
  roomId: string;
  agentId: string;
  messageSeq?: number;
}

/** Asks the bringer's outer Mirador to open Its work for an agent they brought into this room. */
export function askParentToOpenBroughtWork(request: OpenBroughtWorkRequest) {
  if (window.parent !== window) window.parent.postMessage({ type: BROUGHT_WORK_MESSAGE, ...request }, "*");
}

/** A valid open-brought-work message from an invited room's frame; anything else is ignored. */
export function openBroughtWorkIn(data: unknown): OpenBroughtWorkRequest | null {
  const { type, roomId, agentId, messageSeq } = (typeof data === "object" && data !== null ? data : {}) as Record<string, unknown>;
  if (type !== BROUGHT_WORK_MESSAGE || typeof roomId !== "string" || typeof agentId !== "string" || !roomId || !agentId) return null;
  if (messageSeq !== undefined && (!Number.isSafeInteger(messageSeq) || (messageSeq as number) <= 0)) return null;
  return { roomId, agentId, ...(typeof messageSeq === "number" && { messageSeq }) };
}

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
