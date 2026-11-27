import { describe, expect, jest, setSystemTime, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConversationService } from "../host/conversations.ts";
import { answerAsToolResult, canvasQuestion, CanvasService, severalQuestionsRequest } from "../host/canvas/service.ts";
import { Hub } from "../host/hub.ts";
import { Store } from "../host/store.ts";
import type { SystemNotifications } from "../host/system-notifications.ts";
import { questionsOf } from "../shared/ask.ts";
import type { AskItem, AskQuestion, CanvasItem } from "../shared/model.ts";
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
    canvas.answer(ask().id, { label: "Red" });
    ask();
    canvas.withdrawWaitingAsks("c1");
    await canvas.show("c1", { title: "x", html: "<p>" });
    expect(questionsChanged).toEqual(["c1", "c1", "c1", "c1"]);
  });

  test("a question carries the pages shown since the user last wrote or answered, so both are seen together", async () => {
    const { store, canvas, ask } = setUp();
    setSystemTime(new Date("2026-10-02T10:00:00Z"));
    const seenEarlier = await canvas.show("c1", { title: "seen", html: "<p>seen" });
    canvas.answer(ask().id, { label: "Red" });
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
    canvas.answer(item.id, { label: "Blue", note: " keep it subtle " });
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
    canvas.answer(item.id, { label: "Red" });
    expect(nextMessages).toEqual(['My answer to your question "Color?": Red']);
    expect(asAsk(store.findCanvasItem(item.id))?.answer?.deliveredAs).toBe("next-message");
  });

  test("a late answer goes out as the next message of the person who gave it", () => {
    const { canvas, sendOptions, ask } = setUp();
    canvas.answer(ask().id, { label: "Red" }, undefined, "ada");
    expect(sendOptions).toEqual([{ authorId: "ada" }]);
  });

  test("a question waited on for a limited time gives the answer given in time", async () => {
    const { store, canvas, ask } = setUp();
    const item = ask();
    const answer = canvas.waitForAnswerDuringTurn(item, new AbortController().signal, 60_000);
    canvas.answer(item.id, { label: "Blue" });
    expect(await answer).toEqual({ label: "Blue" });
    expect(asAsk(store.findCanvasItem(item.id))?.answer?.deliveredAs).toBe("tool-result");
  });

  test("a question waited on for a limited time stays open past it, and its answer then goes as the next message", async () => {
    const { store, canvas, nextMessages, ask } = setUp();
    const item = ask();
    expect(await canvas.waitForAnswerDuringTurn(item, new AbortController().signal, 10)).toBe("time-up");
    expect(asAsk(store.findCanvasItem(item.id))?.status).toBe("waiting");
    canvas.answer(item.id, { label: "Red" });
    expect(nextMessages).toEqual(['My answer to your question "Color?": Red']);
    expect(asAsk(store.findCanvasItem(item.id))?.answer?.deliveredAs).toBe("next-message");
  });

  test("a question waited on for a limited time still fails when the tool call goes first", async () => {
    const { canvas, ask } = setUp();
    const gone = new AbortController();
    const answer = canvas.waitForAnswerDuringTurn(ask(), gone.signal, 60_000);
    gone.abort(new Error("the agent went away"));
    await expect(answer).rejects.toThrow("the agent went away");
  });

  test("a question whose turn ends before the answer stays open, and its answer then goes as the next message", async () => {
    const { store, canvas, nextMessages, ask } = setUp();
    const item = ask();
    const answer = canvas.waitForAnswerDuringTurn(item, new AbortController().signal);
    canvas.turnEnded("c1");
    expect(await answer).toBe("turn-ended");
    expect(asAsk(store.findCanvasItem(item.id))?.status).toBe("waiting");
    canvas.answer(item.id, { label: "Red" });
    expect(nextMessages).toEqual(['My answer to your question "Color?": Red']);
    expect(asAsk(store.findCanvasItem(item.id))?.answer?.deliveredAs).toBe("next-message");
  });

  test("another conversation's turn ending leaves the question's tool call waiting for its answer", async () => {
    const { canvas, nextMessages, ask } = setUp();
    const item = ask();
    const answer = canvas.waitForAnswerDuringTurn(item, new AbortController().signal);
    canvas.turnEnded("c2");
    canvas.answer(item.id, { label: "Blue" });
    expect(await answer).toEqual({ label: "Blue" });
    expect(nextMessages).toEqual([]);
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
    canvas.answer(installQuestion("declined").id, { label: "Not now" });
    canvas.answer(installQuestion("agreed").id, { label: "Install" });
    await Bun.sleep(0);
    expect(settled).toEqual([
      ["declined", false],
      ["agreed", true],
    ]);
    expect(nextMessages).toEqual([
      'Nothing was installed.\n\nMy answer to your question "Install the Media plugin?": Not now',
      'Mirador installed the Media plugin.\n\nMy answer to your question "Install the Media plugin?": Install',
    ]);
  });

  test("several questions are one item, and their answers come back together as the tool result", async () => {
    const { canvas, askSeveral, notified } = setUp();
    const item = askSeveral();
    expect(item).toMatchObject({ title: "2 questions: Color?", status: "waiting" });
    expect(notified.at(-1)).toEqual(["c1", { kind: "question", question: "2 questions: Color?" }]);
    const answer = canvas.waitForAnswer(item, new AbortController().signal);
    canvas.answer(item.id, { label: "" }, [{ label: "Blue", note: " subtle " }, { label: "Huge" }]);
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
    canvas.answer(item.id, { label: "", note: " Keep it short " }, [{ label: "Blue" }, { label: "Huge" }]);
    const given = await answer;
    expect(asAsk(store.findCanvasItem(item.id))?.answer?.note).toBe("Keep it short");
    expect(answerAsToolResult(given)).toBe(
      ["The user answered 2 questions:", "1. Color?", "   The user chose: Blue", "2. Size?", "   The user chose: Huge", "Their note on all the answers: Keep it short"].join("\n"),
    );
    const late = askSeveral();
    canvas.answer(late.id, { label: "", note: "   " }, [{ label: "Red" }, { label: "Small" }]);
    expect(nextMessages.at(-1)).toBe('My answers to your questions:\n1. "Color?": Red\n2. "Size?": Small');
  });

  test("several answers sent late arrive as one next message", async () => {
    const { store, canvas, nextMessages, askSeveral } = setUp();
    const item = askSeveral();
    canvas.answer(item.id, { label: "" }, [{ label: "Red" }, { label: "Small", note: "tight fit" }]);
    expect(nextMessages).toEqual(['My answers to your questions:\n1. "Color?": Red\n2. "Size?": Small\n   Note: tight fit']);
    expect(asAsk(store.findCanvasItem(item.id))?.answer).toMatchObject({ label: "Red · Small", deliveredAs: "next-message" });
  });

  test("an answer to several questions must answer each, and one question takes one answer", () => {
    const { canvas, ask, askSeveral } = setUp();
    const several = askSeveral();
    expect(() => canvas.answer(several.id, { label: "Red" })).toThrow("Answer all 2 questions");
    expect(() => canvas.answer(several.id, { label: "" }, [{ label: "Red" }])).toThrow("Answer all 2 questions");
    expect(() => canvas.answer(several.id, { label: "" }, [{ label: "Red" }, { label: " " }])).toThrow("Answer all 2 questions");
    expect(canvas.list("c1").find(({ id }) => id === several.id)?.status).toBe("waiting");
    expect(() => canvas.answer(ask().id, { label: "Red" }, [{ label: "Red" }])).toThrow("takes one answer");
  });

  test("a question the agent asks offers Something else, whatever allowOther it passed, and so does each of several", () => {
    const { canvas } = setUp();
    const passedFalse: AskQuestion = { question: "Color?", options: [{ label: "Red" }, { label: "Blue" }], allowOther: false };
    const left: AskQuestion = { question: "Size?", options: [{ label: "S" }, { label: "L" }] };
    expect(canvasQuestion(passedFalse)).toEqual({ ...passedFalse, allowOther: true });
    expect(canvasQuestion(left)).toEqual({ ...left, allowOther: true });
    expect(severalQuestionsRequest([passedFalse, left], undefined)).toEqual({ questions: [{ ...passedFalse, allowOther: true }, { ...left, allowOther: true }] });
    expect(canvas.openAsk("c1", canvasQuestion(passedFalse)).allowOther).toBe(true);
  });

  test("questionsOf gives the one question of an item that holds just one", () => {
    const { ask, askSeveral } = setUp();
    expect(questionsOf(ask())).toEqual([{ question: "Color?", options: [{ label: "Red" }, { label: "Blue" }], allowOther: false }]);
    expect(questionsOf(askSeveral()).map(({ question }) => question)).toEqual(["Color?", "Size?"]);
  });

  test("a question that takes several keeps its flag, and its answer keeps the ticked options and the user's own words apart", async () => {
    const { store, canvas, ask } = setUp();
    const fixes = canvas.openAsk("c1", { question: "Which fixes?", options: [{ label: "Cache" }, { label: "Cache; with a TTL" }, { label: "Neither" }], allowOther: true, multiple: true });
    expect(questionsOf(fixes)[0]!.multiple).toBe(true);
    expect(ask()).not.toHaveProperty("multiple");
    const waited = canvas.waitForAnswer(fixes, new AbortController().signal);
    const picked = { options: ["Cache; with a TTL"], own: "Neither; or both" };
    canvas.answer(fixes.id, { label: "", picked, note: "soon" });
    expect(asAsk(store.findCanvasItem(fixes.id))?.answer).toMatchObject({ label: "Cache; with a TTL; Neither; or both", picked, note: "soon" });
    expect(answerAsToolResult(await waited)).toBe('The user chose: "Cache; with a TTL"\nIn their own words: Neither; or both\nTheir note: soon');
  });

  test("an answer to a question that takes several that comes as one line, as a spoken one does, is the option it names or the user's own words", async () => {
    const { store, canvas } = setUp();
    const answerGiven = async (label: string) => {
      const asked = canvas.openAsk("c1", { question: "Which apply?", options: [{ label: "Red" }, { label: "Blue" }], multiple: true });
      const waited = canvas.waitForAnswer(asked, new AbortController().signal);
      canvas.answer(asked.id, { label });
      return [asAsk(store.findCanvasItem(asked.id))?.answer?.picked, answerAsToolResult(await waited)];
    };
    expect(await answerGiven("Red")).toEqual([{ options: ["Red"] }, 'The user chose: "Red"']);
    expect(await answerGiven("all but red")).toEqual([{ options: [], own: "all but red" }, "The user chose: none of the options\nIn their own words: all but red"]);
  });

  test("of several questions, only those that take several have their answer in parts, and a late answer tells them apart too", () => {
    const { store, canvas, nextMessages } = setUp();
    const asked = canvas.openAsk("c1", {
      questions: [
        { question: "Which colours?", options: [{ label: "Red" }, { label: "Blue" }], allowOther: true, multiple: true },
        { question: "Size?", options: [{ label: "Small" }, { label: "Large" }] },
      ],
    });
    canvas.answer(asked.id, { label: "" }, [{ label: "Red; teal", picked: { options: ["Red"], own: "teal" }, note: "bright" }, { label: "Small" }]);
    expect(asAsk(store.findCanvasItem(asked.id))?.answer?.answers).toEqual([
      { question: "Which colours?", label: "Red; teal", picked: { options: ["Red"], own: "teal" }, note: "bright" },
      { question: "Size?", label: "Small" },
    ]);
    expect(nextMessages).toEqual(['My answers to your questions:\n1. "Which colours?": "Red"\n   In my own words: teal\n   Note: bright\n2. "Size?": Small']);
  });

  test("withdrawing waiting asks fails their tool calls and refuses later answers", async () => {
    const { canvas, ask } = setUp();
    const item = ask();
    const answer = canvas.waitForAnswer(item, new AbortController().signal);
    canvas.withdrawWaitingAsks("c1");
    await expect(answer).rejects.toThrow("withdrew");
    expect(() => canvas.answer(item.id, { label: "Red" })).toThrow("already answered or withdrawn");
  });

  test("does not wait for a render report when nobody is viewing", async () => {
    const { canvas } = setUp();
    const { render } = await canvas.show("c1", { title: "x", html: "<p>" });
    expect(render).toBe("no-viewer");
  });
});

describe("severalQuestionsRequest", () => {
  const color = { question: "Which color?", options: [{ label: "Red" }, { label: "Blue" }] };
  const size = { question: "Which size?", options: [{ label: "Small" }, { label: "Large" }] };

  const offered = { allowOther: true };

  test("a page given beside the questions goes to the first question when it has none of its own", () => {
    expect(severalQuestionsRequest([color, size], "<p>Wall</p>")).toEqual({ questions: [{ ...color, ...offered, html: "<p>Wall</p>" }, { ...size, ...offered }] });
    expect(severalQuestionsRequest([{ ...color, html: "" }, size], "<p>Wall</p>")).toEqual({ questions: [{ ...color, ...offered, html: "<p>Wall</p>" }, { ...size, ...offered }] });
  });

  test("the first question's own page stays, and without a page beside them the questions go as they are, each offering Something else", () => {
    const withPage = { ...color, html: "<p>Own</p>" };
    expect(severalQuestionsRequest([withPage, size], "<p>Wall</p>")).toEqual({ questions: [{ ...withPage, ...offered }, { ...size, ...offered }] });
    expect(severalQuestionsRequest([color, size], undefined)).toEqual({ questions: [{ ...color, ...offered }, { ...size, ...offered }] });
    expect(severalQuestionsRequest([], "<p>Wall</p>")).toEqual({ questions: [] });
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
      `The page "Charts" (canvas item ${item.id}) reported errors after your show call had returned:\n- SyntaxError: Unexpected token ']' (script 1 on the page)`,
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

  test("a page that takes too long to render while someone views it tells of its errors with the next message", async () => {
    const hub = new Hub();
    hub.isShown = () => true;
    const { canvas, store } = setUp(hub);
    jest.useFakeTimers();
    try {
      const shown = canvas.show("c1", charts);
      jest.advanceTimersByTime(6_000);
      expect((await shown).render).toBe("no-report");
    } finally {
      jest.useRealTimers();
    }
    const [item] = store.listCanvasItems("c1");
    canvas.reportRender(item!.id, { errors: ["Mermaid: Parse error on line 3"] });
    expect(canvas.notesForAgent("c1").map(({ text }) => text)).toEqual([
      `The page "Charts" (canvas item ${item!.id}) reported errors after your show call had returned:\n- Mermaid: Parse error on line 3`,
    ]);
  });
});

describe("CanvasService questions whose pages report errors", () => {
  const withPages = { question: "Color?", html: "<p>Wall</p>", options: [{ label: "Red", html: "<p>Red</p>" }, { label: "Blue" }] };
  const above = { question: 0, option: null };
  const onRed = { question: 0, option: 0 };
  const BROKEN = { errors: ["Mermaid: Parse error on line 3"] };
  const FINE = { errors: [] };
  const uncancelled = () => new AbortController().signal;

  const viewed = () => {
    const hub = new Hub();
    hub.isShown = () => true;
    return setUp(hub);
  };

  test("the wait for an answer gives up once all its pages have reported, with the errors and the page each is on, and the question stays open", async () => {
    const { store, canvas, nextMessages } = setUp();
    const item = canvas.openAsk("c1", withPages);
    const answer = canvas.waitForAnswerDuringTurn(item, uncancelled());
    canvas.reportAskPage(item.id, onRed, BROKEN);
    canvas.reportAskPage(item.id, above, { errors: ["ReferenceError: draw is not defined"] });
    expect(await answer).toEqual({ pageErrors: ['option "Red": Mermaid: Parse error on line 3', "the page above the options: ReferenceError: draw is not defined"] });
    expect(asAsk(store.findCanvasItem(item.id))?.status).toBe("waiting");

    canvas.answer(item.id, { label: "Red" });
    expect(nextMessages).toEqual(['My answer to your question "Color?": Red']);
    expect(canvas.notesForAgent("c1"), "the agent has heard of the errors").toEqual([]);
  });

  test("pages that render without errors leave the tool call waiting for its answer", async () => {
    const { canvas } = setUp();
    const item = canvas.openAsk("c1", withPages);
    const answer = canvas.waitForAnswerDuringTurn(item, uncancelled());
    canvas.reportAskPage(item.id, above, FINE);
    canvas.reportAskPage(item.id, onRed, FINE);
    canvas.answer(item.id, { label: "Blue" });
    expect(await answer).toEqual({ label: "Blue" });
    expect(canvas.takeAskErrors(item.id)).toEqual([]);
  });

  test("an answer that comes before every page has reported brings the errors reported by then", async () => {
    const { canvas } = setUp();
    const item = canvas.openAsk("c1", withPages);
    const answer = canvas.waitForAnswerDuringTurn(item, uncancelled());
    canvas.reportAskPage(item.id, onRed, BROKEN);
    canvas.answer(item.id, { label: "Red" });
    expect(await answer).toEqual({ label: "Red" });
    expect(canvas.takeAskErrors(item.id)).toEqual(['option "Red": Mermaid: Parse error on line 3']);
    expect(canvas.takeAskErrors(item.id)).toEqual([]);
  });

  test("errors of a later question of several wait for the answer, as the user has answered the ones before it", async () => {
    const { canvas } = setUp();
    const item = canvas.openAsk("c1", { questions: [withPages, { question: "Size?", options: [{ label: "Small" }, { label: "Large", html: "<p>Large</p>" }] }] });
    const answer = canvas.waitForAnswerDuringTurn(item, uncancelled());
    canvas.reportAskPage(item.id, above, FINE);
    canvas.reportAskPage(item.id, onRed, FINE);
    canvas.reportAskPage(item.id, { question: 1, option: 1 }, BROKEN);
    canvas.reportAskPage(item.id, { question: 1, option: 1 }, BROKEN);
    canvas.answer(item.id, { label: "" }, [{ label: "Red" }, { label: "Large" }]);
    await answer;
    expect(canvas.takeAskErrors(item.id)).toEqual(['question 2, option "Large": Mermaid: Parse error on line 3']);
  });

  test("an agent that does not wait for the answer hears of the errors where someone is viewing the question", async () => {
    const { canvas } = viewed();
    const item = canvas.openAsk("c1", withPages);
    const errors = canvas.errorsOfOpeningPages(item);
    canvas.reportAskPage(item.id, above, FINE);
    canvas.reportAskPage(item.id, onRed, BROKEN);
    expect(await errors).toEqual(['option "Red": Mermaid: Parse error on line 3']);
    expect(canvas.notesForAgent("c1")).toEqual([]);
  });

  test("a question answered before its pages reported is not told to be asked again; its errors go with the answer", async () => {
    const { canvas } = viewed();
    const item = canvas.openAsk("c1", withPages);
    jest.useFakeTimers();
    try {
      const errors = canvas.errorsOfOpeningPages(item);
      canvas.reportAskPage(item.id, onRed, BROKEN);
      canvas.answer(item.id, { label: "Blue" });
      jest.advanceTimersByTime(6_000);
      expect(await errors).toEqual([]);
    } finally {
      jest.useRealTimers();
    }
    expect(canvas.notesForAgent("c1").map(({ text }) => text)).toEqual([
      `The pages of your question "Color?" (canvas item ${item.id}) reported errors:\n- option "Red": Mermaid: Parse error on line 3`,
    ]);
  });

  test("a question without pages, or one nobody is viewing, holds up no agent that does not wait for the answer", async () => {
    const { canvas, ask } = viewed();
    expect(await canvas.errorsOfOpeningPages(ask())).toEqual([]);
    const unviewed = setUp().canvas;
    expect(await unviewed.errorsOfOpeningPages(unviewed.openAsk("c1", withPages))).toEqual([]);
  });

  test("a question first seen after its tool call returned tells of its errors once, with the user's next message, however often it is seen", () => {
    const { canvas } = setUp();
    const item = canvas.openAsk("c1", withPages);
    canvas.reportAskPage(item.id, onRed, BROKEN);
    canvas.reportAskPage(item.id, onRed, BROKEN);
    const [note, ...others] = canvas.notesForAgent("c1");
    expect(others).toEqual([]);
    expect(note?.text).toBe(`The pages of your question "Color?" (canvas item ${item.id}) reported errors:\n- option "Red": Mermaid: Parse error on line 3`);
    note?.heard();
    canvas.reportAskPage(item.id, onRed, BROKEN);
    expect(canvas.notesForAgent("c1")).toEqual([]);
  });

  test("what the pages of an answered or withdrawn question report is of no use to the agent", () => {
    const { canvas } = setUp();
    const answered = canvas.openAsk("c1", withPages);
    canvas.answer(answered.id, { label: "Red" });
    canvas.reportAskPage(answered.id, onRed, BROKEN);
    const withdrawn = canvas.openAsk("c1", withPages);
    canvas.reportAskPage(withdrawn.id, onRed, BROKEN);
    canvas.cancelAsk(withdrawn.id);
    expect(canvas.notesForAgent("c1")).toEqual([]);
  });

  test("asking again in the turn that heard of broken pages takes the broken question back, and leaves the others", async () => {
    const { store, canvas, ask } = setUp();
    const sound = ask();
    const broken = canvas.openAsk("c1", withPages);
    const answer = canvas.waitForAnswerDuringTurn(broken, uncancelled());
    canvas.reportAskPage(broken.id, above, FINE);
    canvas.reportAskPage(broken.id, onRed, BROKEN);
    await answer;
    canvas.takeBackBrokenAsks("c1");
    expect(store.findCanvasItem(broken.id)?.status).toBe("cancelled");
    expect(store.findCanvasItem(sound.id)?.status).toBe("waiting");
  });

  test("a question whose broken pages the agent left as they are stays open past the turn", async () => {
    const { store, canvas } = setUp();
    const broken = canvas.openAsk("c1", withPages);
    const answer = canvas.waitForAnswerDuringTurn(broken, uncancelled());
    canvas.reportAskPage(broken.id, above, FINE);
    canvas.reportAskPage(broken.id, onRed, BROKEN);
    await answer;
    canvas.turnEnded("c1");
    canvas.takeBackBrokenAsks("c1");
    expect(store.findCanvasItem(broken.id)?.status).toBe("waiting");
  });

  test("a question answered before the agent asks again keeps its answer", async () => {
    const { store, canvas, nextMessages } = setUp();
    const broken = canvas.openAsk("c1", withPages);
    const answer = canvas.waitForAnswerDuringTurn(broken, uncancelled());
    canvas.reportAskPage(broken.id, above, FINE);
    canvas.reportAskPage(broken.id, onRed, BROKEN);
    await answer;
    canvas.answer(broken.id, { label: "Blue" });
    canvas.takeBackBrokenAsks("c1");
    expect(asAsk(store.findCanvasItem(broken.id))).toMatchObject({ status: "answered", answer: { label: "Blue", deliveredAs: "next-message" } });
    expect(nextMessages).toEqual(['My answer to your question "Color?": Blue']);
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
