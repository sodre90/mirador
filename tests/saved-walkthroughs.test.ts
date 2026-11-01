import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pluginItemOfSavedWalkthrough, type SavedReview, type SavedTour } from "../host/saved-walkthroughs.ts";
import { Store } from "../host/store.ts";
import type { CanvasItem, PluginCanvasItem } from "../shared/model.ts";
import { verdictInBrief, type Review, type Tour } from "../shared/review.ts";
import { storeWithConversation } from "./canvas-plugin-host.ts";

const savedTour: SavedTour = {
  id: "saved-tour",
  conversationId: "c1",
  kind: "tour",
  title: "How it serves",
  status: "shown",
  createdAt: 5,
  tour: { folder: "/tmp/p", changes: null, summary: "Serves.", flow: [{ title: "Entry", at: { path: "a.ts", line: 1, endLine: 1 }, say: "Starts.", excerpt: [] }], files: [] } as unknown as Tour,
};

describe("a review's verdict in brief, as the canvas bar shows it", () => {
  test("is its first words, before the reason after a colon or a dash", () => {
    expect(verdictInBrief('Request changes: "Not recommended" is read as the recommended option.')).toBe("Request changes");
    expect(verdictInBrief("Approve — a small, correct CSS fix.")).toBe("Approve");
    expect(verdictInBrief("Approve.")).toBe("Approve.");
    expect(verdictInBrief(": nothing before the colon")).toBe(": nothing before the colon");
  });
});

describe("tours saved before tours came from the review plugin", () => {
  test("become the plugin's items, as they were, changed now", () => {
    expect(pluginItemOfSavedWalkthrough(savedTour, 100)).toEqual({
      id: "saved-tour",
      conversationId: "c1",
      kind: "plugin",
      plugin: "review",
      type: "tour",
      icon: "↯",
      placement: "page",
      title: "How it serves",
      status: "shown",
      createdAt: 5,
      updatedAt: 100,
      data: savedTour.tour,
    });
  });

  test("are handed to the plugin when Mirador opens its database", () => {
    const path = join(mkdtempSync(join(tmpdir(), "saved-tours-")), "state.sqlite");
    const before = storeWithConversation(path);
    before.saveCanvasItem(savedTour as unknown as CanvasItem);
    before.close();
    const opened = new Store(path);
    expect(opened.listCanvasItems("c1") as PluginCanvasItem[]).toMatchObject([{ id: "saved-tour", kind: "plugin", plugin: "review", type: "tour", data: savedTour.tour }]);
  });
});

const savedReviewRow: SavedReview = {
  id: "saved-review",
  conversationId: "c1",
  kind: "review",
  title: "PR 7",
  status: "shown",
  createdAt: 5,
  review: { verdict: "Request changes.", findings: [], posting: true } as unknown as Review,
};

describe("reviews saved before reviews came from the review plugin", () => {
  test("become the plugin's items that open with room, with their verdict, not posting, changed now", () => {
    expect(pluginItemOfSavedWalkthrough(savedReviewRow, 100)).toEqual({
      id: "saved-review",
      conversationId: "c1",
      kind: "plugin",
      plugin: "review",
      type: "review",
      icon: "⇄",
      placement: "page",
      title: "PR 7",
      status: "shown",
      createdAt: 5,
      updatedAt: 100,
      data: { ...savedReviewRow.review, posting: false },
      outcome: "Request changes.",
      opensWithRoom: true,
    });
  });

  test("are handed to the plugin when Mirador opens its database, with the tours", () => {
    const path = join(mkdtempSync(join(tmpdir(), "saved-reviews-")), "state.sqlite");
    const before = storeWithConversation(path);
    before.saveCanvasItem(savedReviewRow as unknown as CanvasItem);
    before.saveCanvasItem(savedTour as unknown as CanvasItem);
    before.close();
    const opened = new Store(path);
    expect(opened.listCanvasItems("c1") as PluginCanvasItem[]).toMatchObject([
      { id: "saved-review", kind: "plugin", type: "review", outcome: "Request changes." },
      { id: "saved-tour", kind: "plugin", type: "tour" },
    ]);
  });
});
