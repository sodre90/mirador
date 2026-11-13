import { describe, expect, spyOn, test } from "bun:test";
import { join } from "node:path";
import type { CanvasHost, PluginActivityEvent } from "../shared/canvas-plugins.ts";
import { isPluginName, pluginWindowName, pluginWindowRoute, pluginWindowRouteOf, pluginWindowTitle } from "../shared/item-window.ts";
import type { ConversationEvent } from "../shared/model.ts";
import { activityOf, turnEndedAs } from "../shared/plugin-activity.ts";
import board from "./fixtures/canvas-plugins/board/host.ts";
import { canvasPluginHost } from "./canvas-plugin-host.ts";

const FIXTURES = join(import.meta.dir, "fixtures", "canvas-plugins");

const userMessage = (from: Partial<Extract<ConversationEvent, { type: "user-message" }>> = {}): ConversationEvent => ({ type: "user-message", text: "secret", ...from });

describe("activity plugins hear", () => {
  test("is the user's own messages, never a script's, Mirador's or a plugin's, and never their text", () => {
    expect(activityOf(userMessage())).toEqual({ kind: "user-message" });
    expect(activityOf(userMessage({ fromScript: true }))).toBeNull();
    expect(activityOf(userMessage({ fromMirador: true }))).toBeNull();
    expect(activityOf(userMessage({ fromPlugin: "Board" }))).toBeNull();
  });

  test("is tool calls starting with their kind and ending, without their title or arguments", () => {
    const started = activityOf({ type: "acp", update: { sessionUpdate: "tool_call", toolCallId: "t1", title: "Read secret.ts", kind: "read", rawInput: { path: "secret.ts" } } });
    expect(started).toEqual({ kind: "tool-started", toolCallId: "t1", toolKind: "read" });
    expect(activityOf({ type: "acp", update: { sessionUpdate: "tool_call", toolCallId: "t2", title: "Think" } })).toEqual({ kind: "tool-started", toolCallId: "t2", toolKind: null });
    expect(activityOf({ type: "acp", update: { sessionUpdate: "tool_call_update", toolCallId: "t1", status: "completed" } })).toEqual({ kind: "tool-ended", toolCallId: "t1", failed: false });
    expect(activityOf({ type: "acp", update: { sessionUpdate: "tool_call_update", toolCallId: "t1", status: "failed" } })).toEqual({ kind: "tool-ended", toolCallId: "t1", failed: true });
    expect(activityOf({ type: "acp", update: { sessionUpdate: "tool_call_update", toolCallId: "t1", status: "in_progress" } })).toBeNull();
    expect(activityOf({ type: "acp", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hi" } } })).toBeNull();
    expect(activityOf({ type: "turn-end", stopReason: "end_turn" })).toBeNull();
  });

  test("tells how a turn ended: finished, stopped by the user, or failed without an answer", () => {
    expect(turnEndedAs("end_turn", false)).toBe("finished");
    expect(turnEndedAs("max_tokens", false)).toBe("finished");
    expect(turnEndedAs("cancelled", false)).toBe("stopped");
    expect(turnEndedAs(undefined, true)).toBe("stopped");
    expect(turnEndedAs(undefined, false)).toBe("failed");
  });
});

describe("plugin window route", () => {
  test("names the plugin, and is no plugin's for any other address", () => {
    expect(pluginWindowRoute("board")).toBe("#/plugin/board");
    expect(pluginWindowRouteOf("#/plugin/board")).toBe("board");
    for (const hash of ["", "#/plugin/", "#/plugin/Board", "#/plugin/a/b", "#/plugin/-x", "#/c/board"]) expect(pluginWindowRouteOf(hash)).toBeNull();
    expect(isPluginName("mirador-pet")).toBe(true);
    expect(pluginWindowName("mirador-pet")).toBe("mirador-plugin-mirador-pet");
    expect(pluginWindowTitle("mirador-pet")).toBe("Mirador: mirador-pet");
  });
});

describe("a plugin's window and activity", () => {
  const nextTick = () => new Promise((resolve) => setTimeout(resolve, 0));

  test("plugins hear activity after the event, with the conversation's title and their settings for it", async () => {
    const heard: PluginActivityEvent[] = [];
    let settingSeen: string | null | undefined;
    const listening: CanvasHost = {
      ...board,
      activity(event, context) {
        heard.push(event);
        settingSeen = context.profileSetting("hand-over-to");
      },
    };
    const { plugins } = await canvasPluginHost(FIXTURES, undefined, { board: listening });
    plugins.activity("c1", { kind: "turn-started" });
    expect(heard).toEqual([]);
    await nextTick();
    expect(heard).toEqual([{ kind: "turn-started", conversationId: "c1", conversationTitle: "t", sessionId: null, at: expect.any(Number) }]);
    expect(settingSeen).toBeNull();
    plugins.activity("no-such-conversation", { kind: "turn-started" });
    await nextTick();
    expect(heard).toHaveLength(1);
  });

  test("a plugin whose activity hook throws or rejects harms nothing, and the host log says so", async () => {
    const throwing: CanvasHost = { ...board, activity: () => { throw new Error("broken"); } };
    const rejecting: CanvasHost = { ...board, activity: async () => { throw new Error("broken later"); } };
    const logged = spyOn(console, "error").mockImplementation(() => {});
    try {
      for (const host of [throwing, rejecting]) {
        const { plugins } = await canvasPluginHost(FIXTURES, undefined, { board: host });
        expect(() => plugins.activity("c1", { kind: "user-message" })).not.toThrow();
        await nextTick();
        await nextTick();
      }
      expect(logged.mock.calls.map(([words, error]) => `${words} ${(error as Error).message}`)).toEqual([
        "the activity hook of the board plugin failed: broken",
        "the activity hook of the board plugin failed: broken later",
      ]);
    } finally {
      logged.mockRestore();
    }
  });

  test("the window's state reaches its windows once it settles, however often the plugin changes it", async () => {
    let changes = 0;
    const counting: CanvasHost = {
      ...board,
      activity: (_event, context) => {
        changes++;
        context.windowChanged();
      },
      window: { state: () => ({ changes }), action: (action) => ({ echoed: action }) },
    };
    const { plugins, toPluginWindows } = await canvasPluginHost(FIXTURES, undefined, { board: counting });
    expect(plugins.windowTitles()).toEqual({ board: "Board" });
    expect(plugins.windowStateMessage("board")).toEqual({ type: "plugin-window.state", plugin: "board", state: { changes: 0 }, problem: null });
    plugins.activity("c1", { kind: "user-message" });
    plugins.activity("c1", { kind: "turn-started" });
    plugins.activity("c1", { kind: "tool-started", toolCallId: "t1", toolKind: "read" });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(toPluginWindows).toEqual([{ type: "plugin-window.state", plugin: "board", state: { changes: 3 }, problem: null }]);
    expect(await plugins.actInWindow("board", { kind: "wave" })).toEqual({ echoed: { kind: "wave" } });
  });

  test("a plugin without a window says so to whoever asks for it", async () => {
    const { plugins } = await canvasPluginHost(FIXTURES, undefined, { board: { ...board, window: undefined } });
    expect(plugins.windowTitles()).toEqual({});
    expect(plugins.windowStateMessage("board")).toMatchObject({ state: null, problem: "Board has no window of its own." });
    expect(plugins.windowStateMessage("nope")).toMatchObject({ problem: "No plugin named nope is installed." });
    expect(plugins.actInWindow("board", {})).rejects.toThrow("Board has no window of its own.");
  });
});
