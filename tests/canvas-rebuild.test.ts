import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { SessionUpdate } from "@agentclientprotocol/sdk";
import { canvasCallsIn, rebuildCanvas } from "../host/canvas/canvas-calls.ts";
import { answerAsToolResult, CanvasService, pastAnswerOf } from "../host/canvas/service.ts";
import type { ConversationService } from "../host/conversations.ts";
import type { Hub } from "../host/hub.ts";
import type { SystemNotifications } from "../host/system-notifications.ts";
import type { AskItem, ConversationEvent, StoredEvent } from "../shared/model.ts";
import { canvasPluginHost } from "./canvas-plugin-host.ts";

const FIXTURES = join(import.meta.dir, "fixtures", "canvas-plugins");

const stored = (events: ConversationEvent[]): StoredEvent[] => events.map((event, index) => ({ seq: index + 1, at: index + 1, event }));
const acp = (update: SessionUpdate): ConversationEvent => ({ type: "acp", update });
const userSays = (text: string) => acp({ sessionUpdate: "user_message_chunk", content: { type: "text", text } });

/** A tool call as claude-agent-acp replays it: named first, its input in an update, then its result. */
function claudeCall(id: string, tool: string, input: Record<string, unknown>, result: string, status: "completed" | "failed" = "completed"): ConversationEvent[] {
  return [
    acp({ sessionUpdate: "tool_call", toolCallId: id, title: tool, kind: "other", status: "pending", _meta: { claudeCode: { toolName: tool } } }),
    acp({ sessionUpdate: "tool_call_update", toolCallId: id, rawInput: input }),
    acp({ sessionUpdate: "tool_call_update", toolCallId: id, status, content: [{ type: "content", content: { type: "text", text: result } }] }),
  ];
}

const single: AskItem = {
  id: "a",
  conversationId: "c1",
  kind: "ask",
  title: "Which?",
  question: "Which?",
  options: [{ label: "One" }, { label: "Two" }],
  status: "cancelled",
  createdAt: 1,
};
const several: AskItem = {
  ...single,
  question: "First?",
  questions: [
    { question: "First?", options: [{ label: "A" }, { label: "B" }] },
    { question: "Second?", options: [{ label: "C" }, { label: "D" }] },
  ],
};

describe("canvasCallsIn", () => {
  test("keeps completed canvas calls with their input, result and the user's next message, and leaves out failed and other calls", () => {
    const events = stored([
      userSays("Draw it"),
      ...claudeCall("t1", "mcp__canvas__show", { title: "Plan", html: "<p>x</p>" }, "Shown to the user as canvas item 1."),
      ...claudeCall("t2", "Bash", { command: "ls" }, "a b"),
      ...claudeCall("t3", "mcp__canvas__show", { title: "Broken", html: "" }, "Invalid", "failed"),
      ...claudeCall("t4", "canvas_ask", { question: "Which?", options: [] }, "The question is now showing in the user's browser."),
      userSays("My answer to your question "),
      userSays('"Which?": Two'),
    ]);
    expect(canvasCallsIn(events)).toEqual([
      { tool: "show", input: { title: "Plan", html: "<p>x</p>" }, result: "Shown to the user as canvas item 1.", nextUserMessage: 'My answer to your question "Which?": Two', userMessagesBefore: 1 },
      { tool: "ask", input: { question: "Which?", options: [] }, result: "The question is now showing in the user's browser.", nextUserMessage: 'My answer to your question "Which?": Two', userMessagesBefore: 1 },
    ]);
  });
});

describe("pastAnswerOf", () => {
  test("reads back the answer a tool result gave, for one question and for several", () => {
    expect(pastAnswerOf(single, answerAsToolResult({ label: "Two", note: "because" }), null)).toEqual({ label: "Two", note: "because", deliveredAs: "tool-result" });
    const answers = [
      { question: "First?", label: "B" },
      { question: "Second?", label: "C", note: "sure" },
    ];
    expect(pastAnswerOf(several, answerAsToolResult({ label: "B · C", answers, note: "all" }), null)).toEqual({
      label: "B · C",
      note: "all",
      answers,
      deliveredAs: "tool-result",
    });
  });

  test("reads back an answer that came as the user's next message", () => {
    expect(pastAnswerOf(single, "The question is now showing in the user's browser.", 'My answer to your question "Which?": One\nNote: fine')).toEqual({
      label: "One",
      note: "fine",
      deliveredAs: "next-message",
    });
    expect(pastAnswerOf(several, "Showing.", 'My answers to your questions:\n1. "First?": A\n2. "Second?": D\n   Note: why not')).toEqual({
      label: "A · D",
      answers: [
        { question: "First?", label: "A" },
        { question: "Second?", label: "D", note: "why not" },
      ],
      deliveredAs: "next-message",
    });
  });

  test("finds no answer when neither holds one for every question", () => {
    expect(pastAnswerOf(single, "The question is now showing in the user's browser.", "Never mind, do something else")).toBeNull();
    expect(pastAnswerOf(several, "The user answered 2 questions:\n1. First?\n   The user chose: A", null)).toBeNull();
  });
});

describe("rebuildCanvas", () => {
  async function setUp() {
    const { store, plugins, items, prompts } = await canvasPluginHost(FIXTURES, undefined, {}, { rebuiltFromTheirCalls: new Set(["board"]) });
    const hub = { publishToConversation: () => {}, isShown: () => false } as unknown as Hub;
    const conversations = { questionsChanged: () => {} } as unknown as ConversationService;
    const canvas = new CanvasService(store, hub, conversations, { notify: () => {} } as unknown as SystemNotifications, ["http://127.0.0.1:4601"]);
    return { store, canvas, plugins, items, prompts };
  }

  test("puts back pages, answered questions with the pages shown before them, and the items plugin calls made, pages in order", async () => {
    const { store, canvas, plugins, prompts } = await setUp();
    const events = stored([
      userSays("Go"),
      ...claudeCall("t1", "mcp__canvas__show", { title: "Plan", html: "<p>plan</p>" }, "Shown."),
      ...claudeCall("t2", "mcp__canvas__ask", { question: "Which?", options: [{ label: "One" }, { label: "Two" }] }, answerAsToolResult({ label: "One" })),
      ...claudeCall("t3", "mcp__canvas__track_steps", { title: "Steps", steps: ["a", "b"] }, "Tracking 2 steps."),
      ...claudeCall("t4", "mcp__canvas__finish_step", {}, "1 done."),
      ...claudeCall("t5", "mcp__canvas__hand_over", { profile: "other", task: "help" }, "Handed over to x."),
      ...claudeCall("t6", "mcp__canvas__ask", { question: "Left open?", options: [{ label: "Yes" }, { label: "No" }] }, "Showing."),
    ]);

    await rebuildCanvas("c1", events, canvas, plugins);

    const items = store.listCanvasItems("c1");
    const [page, question, unanswered, ...rest] = items.filter(({ kind }) => kind !== "plugin");
    const [steps, ...otherPluginItems] = items.filter(({ kind }) => kind === "plugin");
    expect([...rest, ...otherPluginItems]).toEqual([]);
    expect(page).toMatchObject({ kind: "show", title: "Plan", html: "<p>plan</p>", status: "shown" });
    expect(question).toMatchObject({ kind: "ask", question: "Which?", status: "answered", answer: { label: "One", deliveredAs: "tool-result" }, shownBefore: [page!.id] });
    expect(steps).toMatchObject({ kind: "plugin", plugin: "board", title: "Steps", data: { steps: ["a", "b"], done: 1 } });
    expect(unanswered).toMatchObject({ kind: "ask", question: "Left open?", status: "cancelled" });
    expect(unanswered).not.toHaveProperty("shownBefore");
    expect(prompts).toEqual([]);
  });

  test("leaves out the calls of plugins not rebuilt from their calls", async () => {
    const { store, canvas } = await setUp();
    const { plugins } = await canvasPluginHost(FIXTURES, store);
    await rebuildCanvas("c1", stored(claudeCall("t1", "mcp__canvas__track_steps", { title: "Steps", steps: ["a"] }, "Tracking 1 steps.")), canvas, plugins);
    expect(store.listCanvasItems("c1")).toEqual([]);
  });
});
