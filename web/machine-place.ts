const PLACE_MESSAGE = "mirador:machine-place";

/** A machine's page in another computer's rail tells it which conversation it shows, for the rail to come back to. */
export function tellTheRailThePlace(hash: string) {
  if (window.parent !== window) window.parent.postMessage({ type: PLACE_MESSAGE, hash }, "*");
}

/** The address part of a place message, if it names a conversation or none; anything else a frame sends is ignored. */
export function placeIn(data: unknown) {
  const { type, hash } = (typeof data === "object" && data !== null ? data : {}) as { type?: unknown; hash?: unknown };
  return type === PLACE_MESSAGE && typeof hash === "string" && /^(#\/c\/[\w-]+)?$/.test(hash) ? hash : null;
}
