import { expect, test } from "bun:test";
import type { OpenApp } from "../shared/apps.ts";
import type { CanvasItem } from "../shared/model.ts";
import { bringsHiddenCanvasBack, latestCanvasNews } from "../web/canvas-news.ts";

const page = (id: string, createdAt: number): CanvasItem => ({ id, conversationId: "c1", kind: "show", title: id, status: "shown", createdAt });
const question = (id: string, createdAt: number, status: "waiting" | "answered"): CanvasItem => ({ id, conversationId: "c1", kind: "ask", title: id, status, createdAt });
const checklist = (id: string, createdAt: number, dismissed = false): CanvasItem => ({
  id,
  conversationId: "c1",
  kind: "plugin",
  title: id,
  status: "shown",
  createdAt,
  plugin: "checklist",
  type: "checklist",
  icon: "",
  placement: "tab",
  data: null,
  dismissed,
});
const app = (shownBy?: OpenApp["shownBy"]): OpenApp => ({ workspaceId: "w1", app: "media", title: "Media", file: "a.media.json", conversationIds: ["c1", "c2"], ...(shownBy && { shownBy }) });

test("the latest news is the newest page, open question, checklist or app this conversation's agent opened", () => {
  expect(latestCanvasNews([page("p1", 10), question("q1", 20, "waiting")], [], "c1")).toEqual({ key: "q1", at: 20 });
  expect(latestCanvasNews([page("p1", 10), checklist("t1", 30)], [app({ conversationId: "c1", at: 25 })], "c1")).toEqual({ key: "t1", at: 30 });
  expect(latestCanvasNews([page("p1", 10)], [app({ conversationId: "c1", at: 25 })], "c1")).toEqual({ key: "w1:media@25", at: 25 });
});

test("an answered question, a dismissed checklist and an app another conversation's agent opened are no news here", () => {
  expect(latestCanvasNews([page("p1", 10), question("q1", 20, "answered"), checklist("t1", 30, true)], [app({ conversationId: "c2", at: 40 }), app()], "c1")).toEqual({ key: "p1", at: 10 });
  expect(latestCanvasNews([], [app({ conversationId: "c2", at: 40 })], "c1")).toBeUndefined();
});

test("news newer than the canvas had when it was hidden brings it back, however long ago, and the news it had never does", () => {
  expect(bringsHiddenCanvasBack({ key: "p2", at: 5_000 }, 4_000, 999_000)).toBe(true);
  expect(bringsHiddenCanvasBack({ key: "p1", at: 4_000 }, 4_000, 5_000)).toBe(false);
  expect(bringsHiddenCanvasBack(undefined, 4_000, 5_000)).toBe(false);
});

test("a canvas hidden in a layout kept before hiding noted the news comes back only for news from the last 30 s", () => {
  expect(bringsHiddenCanvasBack({ key: "p1", at: 1_000 }, undefined, 31_000)).toBe(true);
  expect(bringsHiddenCanvasBack({ key: "p1", at: 1_000 }, undefined, 31_001)).toBe(false);
});
