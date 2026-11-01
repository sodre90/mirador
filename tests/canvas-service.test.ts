import { describe, expect, setSystemTime, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConversationService } from "../host/conversations.ts";
import { answerAsToolResult, CanvasService } from "../host/canvas/service.ts";
import { Hub } from "../host/hub.ts";
import { Store } from "../host/store.ts";
import type { SystemNotifications } from "../host/system-notifications.ts";
import { questionsOf } from "../shared/ask.ts";
import type { AskItem, CanvasItem } from "../shared/model.ts";
import type { NotificationReason } from "../shared/system-notifications.ts";
import { completeDirectories } from "../host/paths.ts";

function asAsk(item: CanvasItem | undefined) {
  expect(item?.kind).toBe("ask");
  return item as AskItem | undefined;
}

function setUp(hub = new Hub()) {
  const store = new Store(":memory:");
  store.insertWorkspace({ id: "w1", name: "p", path: "/tmp/p", defaultLaunch: { harness: "claude", profileId: null }, createdAt: 1 });
  store.insertConversation({
    id: "c1",
    workspaceId: "w1",
    harness: "claude",
    profileId: null,
    title: "t",
    titleSetByUser: false,
    acpSessionId: null,
    askMode: "wait",
    bypassPermissions: false,
    status: "idle",
    statusDetail: null,
    openInTerminal: null,
    contextUsage: null,
    queuedMessages: [],
    usageLimit: null,
    jobWaits: [],
    asyncTasks: [],
    waitingFor: null,
    pendingRequest: null,
    lastWords: null,
    activity: null,
    configOptions: [],
    createdAt: 1,
    updatedAt: 1,
  });
  const nextMessages: string[] = [];
  const sendOptions: unknown[] = [];
  const questionsChanged: string[] = [];
  const conversations = {
    send: async (_id: string, text: string, _imageIds?: string[], options?: unknown) => {
      nextMessages.push(text);
      sendOptions.push(options);
    },
    questionsChanged: (conversationId: string) => void questionsChanged.push(conversationId),
  } as unknown as ConversationService;
  const notified: [string, NotificationReason][] = [];
  const notifications = { notify: (conversationId: string, reason: NotificationReason) => void notified.push([conversationId, reason]) } as SystemNotifications;
  const canvas = new CanvasService(store, hub, conversations, notifications, ["http://127.0.0.1:4601"]);
  const ask = () => canvas.openAsk("c1", { question: "Color?", options: [{ label: "Red" }, { label: "Blue" }] });
  const askSeveral = () =>
    canvas.openAsk("c1", {
      questions: [
        { question: "Color?", options: [{ label: "Red" }, { label: "Blue" }] },
        { question: "Size?", options: [{ label: "Small" }, { label: "Large" }], allowOther: true },
      ],
    });
  return { store, canvas, nextMessages, sendOptions, ask, askSeveral, notified, questionsChanged };
}

describe("CanvasService", () => {
  test("a question asks for a system notification", () => {
    const { ask, notified } = setUp();
    ask();
    expect(notified).toEqual([["c1", { kind: "question", question: "Color?" }]]);
  });

  test("a question keeps the least width the agent asked for its answer boxes", () => {
    const { store, canvas, ask } = setUp();
    const roomy = canvas.openAsk("c1", { question: "Which fix?", options: [{ label: "Fix" }, { label: "Leave" }], optionWidth: 480 });
    expect(asAsk(store.findCanvasItem(roomy.id))?.optionWidth).toBe(480);
    expect(asAsk(store.findCanvasItem(ask().id))).not.toHaveProperty("optionWidth");
  });

  test("the conversation hears when its question opens, is answered and is withdrawn, but not about pages shown", async () => {
    const { canvas, ask, questionsChanged } = setUp();
    canvas.answer(ask().id, "Red");
    ask();
    canvas.withdrawWaitingAsks("c1");
    await canvas.show("c1", { title: "x", html: "<p>" });
    expect(questionsChanged).toEqual(["c1", "c1", "c1", "c1"]);
  });

  test("a question carries the pages shown since the user last wrote or answered, so both are seen together", async () => {
    const { store, canvas, ask } = setUp();
    setSystemTime(new Date("2026-10-02T10:00:00Z"));
    const seenEarlier = await canvas.show("c1", { title: "seen", html: "<p>seen" });
    canvas.answer(ask().id, "Red");
    await canvas.show("c1", { title: "also seen", html: "<p>also" });
    setSystemTime(new Date("2026-10-02T10:01:00Z"));
    store.appendEvent("c1", { type: "user-message", text: "explain it" });
    setSystemTime(new Date("2026-10-02T10:02:00Z"));
    const explained = await canvas.show("c1", { title: "explained", html: "<p>why" });
    const diagram = await canvas.show("c1", { title: "diagram", html: "<p>how" });
    expect(ask().shownBefore).toEqual([explained.item.id, diagram.item.id]);
    expect(ask().shownBefore).toBeUndefined();
    expect(seenEarlier.item.id).not.toBe(explained.item.id);
    setSystemTime();
  });

  test("returns the answer to a waiting tool call", async () => {
    const { canvas, nextMessages, ask } = setUp();
    const item = ask();
    const answer = canvas.waitForAnswer(item, new AbortController().signal);
    canvas.answer(item.id, "Blue", " keep it subtle ");
    expect(await answer).toEqual({ label: "Blue", note: "keep it subtle" });
    expect(nextMessages).toEqual([]);
  });

  test("sends a late answer as the next message once the tool call is gone", async () => {
    const { store, canvas, nextMessages, ask } = setUp();
    const item = ask();
    const aborted = new AbortController();
    const answer = canvas.waitForAnswer(item, aborted.signal);
    aborted.abort(new Error("timeout"));
    await expect(answer).rejects.toThrow("timeout");
    canvas.answer(item.id, "Red");
    expect(nextMessages).toEqual(['My answer to your question "Color?": Red']);
    expect(asAsk(store.findCanvasItem(item.id))?.answer?.deliveredAs).toBe("next-message");
  });

  test("an install question installs the offered plugin only on Install, discards it otherwise, then tells the agent what came of it", async () => {
    const { canvas, nextMessages } = setUp();
    const settled: [string, boolean][] = [];
    canvas.installsPluginsWith({
      offer: async () => {
        throw new Error("not offered here");
      },
      settle: async (offerId, accepted) => {
        settled.push([offerId, accepted]);
        return accepted ? "Mirador installed the Media plugin." : "Nothing was installed.";
      },
    });
    const installQuestion = (offerId: string) =>
      canvas.openAsk("c1", { question: "Install the Media plugin?", options: [{ label: "Install" }, { label: "Not now" }] }, { installsPluginOffer: offerId });
    canvas.answer(installQuestion("declined").id, "Not now");
    canvas.answer(installQuestion("agreed").id, "Install");
    await Bun.sleep(0);
    expect(settled).toEqual([
      ["declined", false],
      ["agreed", true],
    ]);
    expect(nextMessages).toEqual([
      'My answer to your question "Install the Media plugin?": Not now\nNothing was installed.',
      'My answer to your question "Install the Media plugin?": Install\nMirador installed the Media plugin.',
    ]);
  });

  test("several questions are one item, and their answers come back together as the tool result", async () => {
    const { canvas, askSeveral, notified } = setUp();
    const item = askSeveral();
    expect(item).toMatchObject({ title: "2 questions: Color?", status: "waiting" });
    expect(notified.at(-1)).toEqual(["c1", { kind: "question", question: "2 questions: Color?" }]);
    const answer = canvas.waitForAnswer(item, new AbortController().signal);
    canvas.answer(item.id, "", undefined, [{ label: "Blue", note: " subtle " }, { label: "Huge" }]);
    const given = await answer;
    expect(given.label).toBe("Blue · Huge");
    expect(answerAsToolResult(given)).toBe(
      ["The user answered 2 questions:", "1. Color?", "   The user chose: Blue", "   Their note: subtle", "2. Size?", "   The user chose: Huge"].join("\n"),
    );
  });

  test("a note for all several answers comes after the list, in the tool result and the message", async () => {
    const { store, canvas, nextMessages, askSeveral } = setUp();
    const item = askSeveral();
    const answer = canvas.waitForAnswer(item, new AbortController().signal);
    canvas.answer(item.id, "", " Keep it short ", [{ label: "Blue" }, { label: "Huge" }]);
    const given = await answer;
    expect(asAsk(store.findCanvasItem(item.id))?.answer?.note).toBe("Keep it short");
    expect(answerAsToolResult(given)).toBe(
      ["The user answered 2 questions:", "1. Color?", "   The user chose: Blue", "2. Size?", "   The user chose: Huge", "Their note on all the answers: Keep it short"].join("\n"),
    );
    const late = askSeveral();
    canvas.answer(late.id, "", "   ", [{ label: "Red" }, { label: "Small" }]);
    expect(nextMessages.at(-1)).toBe('My answers to your questions:\n1. "Color?": Red\n2. "Size?": Small');
  });

  test("several answers sent late arrive as one next message", async () => {
    const { store, canvas, nextMessages, askSeveral } = setUp();
    const item = askSeveral();
    canvas.answer(item.id, "", undefined, [{ label: "Red" }, { label: "Small", note: "tight fit" }]);
    expect(nextMessages).toEqual(['My answers to your questions:\n1. "Color?": Red\n2. "Size?": Small\n   Note: tight fit']);
    expect(asAsk(store.findCanvasItem(item.id))?.answer).toMatchObject({ label: "Red · Small", deliveredAs: "next-message" });
  });

  test("an answer to several questions must answer each, and one question takes one answer", () => {
    const { canvas, ask, askSeveral } = setUp();
    const several = askSeveral();
    expect(() => canvas.answer(several.id, "Red")).toThrow("Answer all 2 questions");
    expect(() => canvas.answer(several.id, "", undefined, [{ label: "Red" }])).toThrow("Answer all 2 questions");
    expect(() => canvas.answer(several.id, "", undefined, [{ label: "Red" }, { label: " " }])).toThrow("Answer all 2 questions");
    expect(canvas.list("c1").find(({ id }) => id === several.id)?.status).toBe("waiting");
    expect(() => canvas.answer(ask().id, "Red", undefined, [{ label: "Red" }])).toThrow("takes one answer");
  });

  test("questionsOf gives the one question of an item that holds just one", () => {
    const { ask, askSeveral } = setUp();
    expect(questionsOf(ask())).toEqual([{ question: "Color?", options: [{ label: "Red" }, { label: "Blue" }], allowOther: false }]);
    expect(questionsOf(askSeveral()).map(({ question }) => question)).toEqual(["Color?", "Size?"]);
  });

  test("withdrawing waiting asks fails their tool calls and refuses later answers", async () => {
    const { canvas, ask } = setUp();
    const item = ask();
    const answer = canvas.waitForAnswer(item, new AbortController().signal);
    canvas.withdrawWaitingAsks("c1");
    await expect(answer).rejects.toThrow("withdrew");
    expect(() => canvas.answer(item.id, "Red")).toThrow("already answered or withdrawn");
  });

  test("does not wait for a render report when nobody is viewing", async () => {
    const { canvas } = setUp();
    const { render } = await canvas.show("c1", { title: "x", html: "<p>" });
    expect(render).toBe("no-viewer");
  });
});

describe("CanvasService pages shown while nobody viewed them", () => {
  const charts = { title: "Charts", html: "<p>Charts</p>" };

  test("the errors a page's first view reports reach the agent once, with the next message", async () => {
    const { canvas } = setUp();
    const { item, render } = await canvas.show("c1", charts);
    expect(render).toBe("no-viewer");
    expect(canvas.pageErrorsNote("c1")).toBeNull();

    canvas.reportRender(item.id, { errors: ["SyntaxError: Unexpected token ']' (script 1 on the page)"] });
    const note = canvas.pageErrorsNote("c1");
    expect(note?.text).toBe(
      `The page "Charts" (canvas item ${item.id}), shown while nobody was viewing, reported errors when the user opened it:\n- SyntaxError: Unexpected token ']' (script 1 on the page)`,
    );
    expect(canvas.notesForAgent("c1").map(({ text }) => text)).toEqual([note!.text]);
    note?.heard();
    expect(canvas.pageErrorsNote("c1")).toBeNull();
    canvas.reportRender(item.id, { errors: ["seen again"] });
    expect(canvas.pageErrorsNote("c1")).toBeNull();
  });

  test("a first view without errors leaves nothing to tell, now or after", async () => {
    const { canvas } = setUp();
    const { item } = await canvas.show("c1", charts);
    canvas.reportRender(item.id, { errors: [] });
    canvas.reportRender(item.id, { errors: ["a later error"] });
    expect(canvas.notesForAgent("c1")).toEqual([]);
  });

  test("a page someone saw render as it was shown has told the agent already", async () => {
    const hub = new Hub();
    hub.isShown = () => true;
    const { canvas, store } = setUp(hub);
    const shown = canvas.show("c1", charts);
    const [item] = store.listCanvasItems("c1");
    canvas.reportRender(item!.id, { errors: ["told in the tool result"] });
    expect((await shown).render).toEqual({ errors: ["told in the tool result"] });
    canvas.reportRender(item!.id, { errors: ["a later view"] });
    expect(canvas.pageErrorsNote("c1")).toBeNull();
  });
});

describe("completeDirectories", () => {
  test("lists matching subdirectories and hides dotfiles unless asked", async () => {
    const root = mkdtempSync(join(tmpdir(), "mirador-paths-"));
    ["alpha", "alps", "beta", ".hidden"].forEach((name) => mkdirSync(join(root, name)));
    expect(await completeDirectories(`${root}/al`)).toEqual([`${root}/alpha/`, `${root}/alps/`]);
    expect(await completeDirectories(`${root}/`)).toEqual([`${root}/alpha/`, `${root}/alps/`, `${root}/beta/`]);
    expect(await completeDirectories(`${root}/.h`)).toEqual([`${root}/.hidden/`]);
  });
});
