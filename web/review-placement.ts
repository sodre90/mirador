import type { CanvasItem } from "../shared/model.ts";

const FRESH_REVIEW_MS = 30_000;
const placedOnArrival = new Set<string>();

/** A plugin's item that takes room when it opens, as the code review plugin's reviews do. */
export const opensWithRoom = (item: CanvasItem | undefined) => item?.kind === "plugin" && item.opensWithRoom === true;

/** A review that just arrived opens where its plugin's setting says, once; one opened again later stays where the user put the pane. */
export function takeArrivedReview(item: CanvasItem | undefined) {
  if (!item || !opensWithRoom(item) || Date.now() - item.createdAt > FRESH_REVIEW_MS || placedOnArrival.has(item.id)) return false;
  placedOnArrival.add(item.id);
  return true;
}
