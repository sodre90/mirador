import type { FindingDecision } from "./review.ts";

export type WalkthroughTab = "overview" | "flow" | "files" | "findings" | "conversations";

/** Where the user was in a review or tour: shown as they left it when they come back to it. */
export interface PlaceInWalkthrough {
  tab: WalkthroughTab;
  stepIndex: number;
  path: string | null;
  hunkIndex: number;
  findingId: string | null;
  answerId: string | null;
  /** How far each scrolling part of a tab was scrolled, by its class. */
  scrolled: Partial<Record<WalkthroughTab, Record<string, number>>>;
}

export interface StoredPaneShares {
  listShare: number;
  bandShare: number;
}

/** What a review's or tour's view sends the code review plugin's host code, as `canvas.item-action`. */
export type WalkthroughAction =
  | { kind: "recall" }
  | { kind: "remember-pane-shares"; shares: StoredPaneShares }
  | { kind: "leave-place"; place: PlaceInWalkthrough }
  | { kind: "read-file"; path: string }
  | { kind: "open-in-editor"; path: string; line: number }
  | { kind: "update-finding"; findingId: string; decision?: FindingDecision; body?: string }
  | { kind: "update-answer"; answerId: string; decision?: FindingDecision; body?: string; resolve?: boolean }
  | { kind: "check-github-cli" }
  | { kind: "post" }
  | { kind: "review-again" };

/** What the view draws with from its first paint: the pane shares the user last left, and where they were in this item. */
export interface Recalled {
  paneShares: StoredPaneShares | null;
  place: PlaceInWalkthrough | null;
}
