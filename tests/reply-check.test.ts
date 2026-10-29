import { describe, expect, test } from "bun:test";
import {
  ASK_IN_CANVAS,
  asksInChat,
  canvasFollowUp,
  canvasUseOf,
  isCanvasFollowUp,
  repeatsPageInChat,
  SHORTEN_AFTER_PAGE,
} from "../host/canvas/reply-check.ts";
import type { CanvasItem } from "../shared/model.ts";

const show = (createdAt: number): CanvasItem => ({ id: `s${createdAt}`, conversationId: "c1", kind: "show", title: "Page", status: "shown", createdAt });
const ask = (createdAt: number): CanvasItem => ({ id: `a${createdAt}`, conversationId: "c1", kind: "ask", title: "Which?", status: "waiting", createdAt });
const pluginItem = (placement: "page" | "tab", createdAt: number, agentEditedAt?: number): CanvasItem => ({
  id: `p${createdAt}`,
  conversationId: "c1",
  kind: "plugin",
  plugin: "review",
  type: "review",
  icon: "",
  placement,
  title: "Review",
  status: "shown",
  data: {},
  createdAt,
  ...(agentEditedAt !== undefined && { agentEditedAt }),
});

describe("asksInChat", () => {
  test("a line ending in a question mark is a question, markup after it included", () => {
    expect(asksInChat("The job is running.\n\nWant me to add a launchd plist so it starts on boot?")).toBe(true);
    expect(asksInChat("Done.\n**Go ahead?**")).toBe(true);
    expect(asksInChat("- **The key.** I can't read GitHub secrets, so where should I take it from?")).toBe(true);
  });

  test("a question mark in code, a heading, a quote or a table row, or mid-line, is not a question to the user", () => {
    expect(asksInChat("The regex is:\n```\nconst optional = /colou?r?/;\n```\nIt matches both spellings.")).toBe(false);
    expect(asksInChat("It reads `value ?? fallback?`")).toBe(false);
    expect(asksInChat("## Why does it fail?\nBecause the cache is stale.")).toBe(false);
    expect(asksInChat("> Why don't you use canvas?\nFair point: I'll use it from now on.")).toBe(false);
    expect(asksInChat("| Does it build? | yes |\n|---|---|")).toBe(false);
    expect(asksInChat("Why? Because the lock is held, so the second run waits.")).toBe(false);
  });
});

describe("repeatsPageInChat", () => {
  test("more than 5 lines outside code, or a table, repeats the page", () => {
    expect(repeatsPageInChat(["Line 1", "- 2", "- 3", "- 4", "- 5", "- 6"].join("\n"))).toBe(true);
    expect(repeatsPageInChat("The breakdown is on the canvas.\n| Kind | Share |\n|---|---|\n| reads | 65% |")).toBe(true);
  });

  test("a few lines pointing at the page pass, and code blocks don't count", () => {
    expect(repeatsPageInChat("Cache reads are 65% of the spend. The full breakdown is on the canvas.")).toBe(false);
    expect(repeatsPageInChat("Run it with:\n```\na\nb\nc\nd\ne\nf\n```\nThe page has the rest.")).toBe(false);
  });
});

describe("canvasUseOf", () => {
  const startedAt = 100;
  test("a page the turn ended on, with only canvas steps after it, is what the reply sums up", () => {
    const items = [show(110), ask(120), pluginItem("tab", 50, 130)];
    expect(canvasUseOf({ startedAt, toolCallsAt: [105, 115, 125], items, jobWaitsSince: [] })).toEqual({ asked: true, showedPage: true });
  });

  test("a page followed by other work is not", () => {
    expect(canvasUseOf({ startedAt, toolCallsAt: [105, 115, 125], items: [show(110)], jobWaitsSince: [] })).toEqual({ asked: false, showedPage: false });
  });

  test("a job wait after the page counts as a canvas step", () => {
    expect(canvasUseOf({ startedAt, toolCallsAt: [105, 115], items: [show(110)], jobWaitsSince: [116] }).showedPage).toBe(true);
  });

  test("items from earlier turns don't count, and a plugin page edited in the turn does", () => {
    expect(canvasUseOf({ startedAt, toolCallsAt: [], items: [show(10), ask(20)], jobWaitsSince: [] })).toEqual({ asked: false, showedPage: false });
    expect(canvasUseOf({ startedAt, toolCallsAt: [105], items: [pluginItem("page", 10, 110)], jobWaitsSince: [] }).showedPage).toBe(true);
  });
});

describe("canvasFollowUp", () => {
  test("a question in chat with no ask in the turn gets bounced to ask", () => {
    const reply = "Started the e2e run; I'll be told when it ends.\n\n- Should the fix also cover pi?\n- Keep the old flag?";
    expect(canvasFollowUp({ reply, asked: false, showedPage: false })).toBe(ASK_IN_CANVAS);
  });

  test("a long reply after the turn's page gets bounced to at most 3 lines", () => {
    const reply = "The breakdown is on the canvas.\n| Part | Tokens |\n|---|---|\n| tools | 8k |\n\nCaveats:\n- estimates\n- one session";
    expect(canvasFollowUp({ reply, asked: true, showedPage: true })).toBe(SHORTEN_AFTER_PAGE);
  });

  test("both at once go in one message", () => {
    const reply = ["a", "b", "c", "d", "e", "Want me to go on?"].join("\n");
    expect(canvasFollowUp({ reply, asked: false, showedPage: true })).toBe(`${ASK_IN_CANVAS} ${SHORTEN_AFTER_PAGE}`);
  });

  test("a short answer with no canvas use, or a question asked on the canvas, passes", () => {
    expect(canvasFollowUp({ reply: "The function is in host/canvas/mcp.ts:113.", asked: false, showedPage: false })).toBeNull();
    expect(canvasFollowUp({ reply: "Which one should I take? It's on the canvas.", asked: true, showedPage: false })).toBeNull();
    expect(canvasFollowUp({ reply: ["1", "2", "3", "4", "5", "6"].join("\n"), asked: false, showedPage: false })).toBeNull();
  });

  test("a turn begun by a follow-up is recognised, so it goes through unchecked", () => {
    expect(isCanvasFollowUp(ASK_IN_CANVAS)).toBe(true);
    expect(isCanvasFollowUp("Why don't you use canvas?")).toBe(false);
  });
});
