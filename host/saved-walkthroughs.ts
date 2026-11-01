import type { CanvasItemBase, PluginCanvasItem } from "../shared/model.ts";
import { verdictInBrief, type Review, type Tour } from "../shared/review.ts";

/** A tour as Mirador saved it before tours came from the code review plugin. */
export interface SavedTour extends Omit<CanvasItemBase, "kind"> {
  kind: "tour";
  tour: Tour;
}

/** A review as Mirador saved it before reviews came from the code review plugin. */
export interface SavedReview extends Omit<CanvasItemBase, "kind"> {
  kind: "review";
  review: Review;
}

/** The code review plugin's item for a tour or review saved before it. Changed now, so a device catching up on what changed since it last looked gets it too. */
export function pluginItemOfSavedWalkthrough(saved: SavedTour | SavedReview, now: number): PluginCanvasItem {
  const { kind: _, ...base } = saved;
  const plugin = { kind: "plugin", plugin: "review", placement: "page", updatedAt: now } as const;
  if (saved.kind === "tour") {
    const { tour: data, ...rest } = base as Omit<SavedTour, "kind">;
    return { ...rest, ...plugin, type: "tour", icon: "↯", data };
  }
  const { review, ...rest } = base as Omit<SavedReview, "kind">;
  return { ...rest, ...plugin, type: "review", icon: "⇄", data: { ...review, posting: false }, outcome: verdictInBrief(review.verdict), opensWithRoom: true };
}
