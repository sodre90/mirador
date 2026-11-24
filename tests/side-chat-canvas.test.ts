import { describe, expect, test } from "bun:test";
import type { OpenApp } from "../shared/apps.ts";
import type { CanvasItem } from "../shared/model.ts";
import { pickCanvas, sideChatInFront, type CanvasPair } from "../web/side-chat-canvas.ts";

const page = (conversationId: string, createdAt: number): CanvasItem => ({ id: `${conversationId}-page-${createdAt}`, conversationId, kind: "show", title: "page", status: "shown", createdAt });
const question = (conversationId: string, createdAt: number, status: "waiting" | "answered" = "waiting"): CanvasItem => ({
  id: `${conversationId}-question-${createdAt}`,
  conversationId,
  kind: "ask",
  title: "question",
  status,
  createdAt,
});
const appOpenedBy = (conversationId: string, shownAt: number): OpenApp => ({ conversationId, documentId: "d1", workspaceId: "w1", app: "media", title: "Media", file: "a.media.json", shownAt });

const mainPage = (at: number) => page("main", at);
const mainQuestion = (at: number, status?: "waiting" | "answered") => question("main", at, status);
const sidePage = (at: number) => page("side", at);
const sideQuestion = (at: number, status?: "waiting" | "answered") => question("side", at, status);

const pairOf = (main: CanvasItem[], side: CanvasItem[], openApps: OpenApp[] = []): CanvasPair => ({
  main: { conversationId: "main", canvas: main },
  side: { conversationId: "side", canvas: side },
  openApps,
});
const comesForward = (main: CanvasItem[], side: CanvasItem[], openApps?: OpenApp[]) => sideChatInFront(pairOf(main, side, openApps), undefined);

describe("the side chat's canvas comes forward by itself", () => {
  test("for what is newer than anything on the main chat's, a page, a question or an app its agent opened", () => {
    expect(comesForward([mainPage(10)], [sidePage(20)])).toBe(true);
    expect(comesForward([mainPage(10)], [sideQuestion(20)])).toBe(true);
    expect(comesForward([mainPage(10)], [], [appOpenedBy("side", 20)])).toBe(true);
    expect(comesForward([], [sidePage(20)])).toBe(true);
  });

  test("not for what is older than the main chat's latest, a settled question there included", () => {
    expect(comesForward([mainPage(30)], [sidePage(20)])).toBe(false);
    expect(comesForward([mainQuestion(30, "answered")], [sidePage(20)])).toBe(false);
    expect(comesForward([], [sidePage(20)], [appOpenedBy("main", 30)])).toBe(false);
  });

  test("and gives the pane back once its question is answered, whatever it showed before", () => {
    expect(comesForward([mainPage(10)], [sideQuestion(20, "answered")])).toBe(false);
    expect(comesForward([mainPage(10)], [sidePage(15), sideQuestion(20, "answered")])).toBe(false);
  });

  test("and keeps its waiting question in front of the main chat's newer pages, but not of its newer question", () => {
    expect(comesForward([mainPage(30)], [sideQuestion(20)])).toBe(true);
    expect(comesForward([mainQuestion(30)], [sideQuestion(20)])).toBe(false);
    expect(comesForward([mainQuestion(30, "answered")], [sideQuestion(20)])).toBe(true);
  });

  test("with a page the user just asked it for, also while the main chat waits on an older question", () => {
    expect(comesForward([mainQuestion(10)], [sidePage(20)])).toBe(true);
  });
});

describe("the canvas the user switched to", () => {
  test("is the main chat's until there is news on the side chat's, whatever the main chat shows meanwhile", () => {
    const pick = pickCanvas(pairOf([mainPage(10)], [sideQuestion(20)]), false);
    expect(sideChatInFront(pairOf([mainPage(10)], [sideQuestion(20)]), pick)).toBe(false);
    expect(sideChatInFront(pairOf([mainPage(10), mainPage(30)], [sideQuestion(20)]), pick)).toBe(false);
    expect(sideChatInFront(pairOf([mainPage(10)], [sideQuestion(20), sidePage(30)]), pick)).toBe(true);
  });

  test("is the side chat's until there is news on either", () => {
    const pick = pickCanvas(pairOf([mainPage(30)], [sidePage(20)]), true);
    expect(sideChatInFront(pairOf([mainPage(30)], [sidePage(20)]), pick)).toBe(true);
    expect(sideChatInFront(pairOf([mainPage(30), mainPage(40)], [sidePage(20)]), pick)).toBe(false);
  });

  test("goes back to the main chat's once the side chat's question the user switched to is answered", () => {
    const pick = pickCanvas(pairOf([mainQuestion(30)], [sideQuestion(20)]), true);
    expect(sideChatInFront(pairOf([mainQuestion(30)], [sideQuestion(20)]), pick)).toBe(true);
    expect(sideChatInFront(pairOf([mainQuestion(30)], [sideQuestion(20, "answered")]), pick)).toBe(false);
  });
});
