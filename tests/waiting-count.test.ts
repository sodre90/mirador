import { expect, test } from "bun:test";
import { Hub, socketData, type BrowserSocket, type SocketData } from "../host/hub.ts";
import type { Conversation } from "../shared/model.ts";
import type { ServerMessage } from "../shared/protocol.ts";
import {
  countWaiting,
  lastsUntilOpened,
  summarizeWaiting,
  waitingByUrgency,
  waitingShowsOnDot,
  type WaitingConversation,
  type WaitingSummary,
  type WaitingTone,
} from "../shared/waiting.ts";
import { tabTitle } from "../web/tab-title.ts";

const c = (waitingFor: Conversation["waitingFor"]) => ({ waitingFor }) as Conversation;

test("counts every conversation waiting for you, whatever it waits for, your own Unread marks too", () => {
  expect(countWaiting([c("permission"), c("question"), c("finished"), c("error"), c("unread"), c(null)])).toBe(5);
  expect(countWaiting([])).toBe(0);
  expect(countWaiting([c(null)])).toBe(0);
});

test("an Unread mark comes after everything the agent waits on, and opening clears it as it clears Done and Failed", () => {
  expect(waitingByUrgency([c("unread"), c("finished"), c(null), c("permission"), c("error")]).map(({ waitingFor }) => waitingFor)).toEqual([
    "permission",
    "error",
    "finished",
    "unread",
  ]);
  expect(["finished", "error", "unread"].every((waitingFor) => lastsUntilOpened(waitingFor as Conversation["waitingFor"]))).toBe(true);
  expect([null, "permission", "question"].some((waitingFor) => lastsUntilOpened(waitingFor as Conversation["waitingFor"]))).toBe(false);
});

test("the tab title carries the count only while something waits", () => {
  expect(tabTitle(0)).toBe("Mirador");
  expect(tabTitle(2)).toBe("(2) Mirador");
});

function connect(hub: Hub, role: SocketData["role"]) {
  const received: ServerMessage[] = [];
  const socket = { data: socketData(role, null), send: (payload: string) => received.push(JSON.parse(payload)) } as unknown as BrowserSocket;
  hub.add(socket);
  return received;
}

const waitingConversation = (conversationId: string, tone: WaitingTone, title = `Conversation ${conversationId}`): WaitingConversation => ({
  conversationId,
  title,
  workspace: "mirador",
  tone,
});

const summary = (...conversations: WaitingConversation[]): WaitingSummary => ({ count: conversations.length, mostUrgent: conversations[0]?.tone ?? null, conversations });

test("summarizes how many wait, the most urgent tone among them, and which, most urgent first", () => {
  const [finished, unread, decision] = [waitingConversation("a", "done"), waitingConversation("b", "unread"), waitingConversation("c", "decision")];
  expect(summarizeWaiting([finished, unread, decision])).toEqual({ count: 3, mostUrgent: "decision", conversations: [decision, finished, unread] });
  expect(summarizeWaiting([])).toEqual({ count: 0, mostUrgent: null, conversations: [] });
});

test("only the desktop app hears what waits", () => {
  const hub = new Hub();
  const page = connect(hub, "page");
  const notifier = connect(hub, "notifier");
  const waiting = summary(waitingConversation("a", "decision"));
  hub.announceWaiting(waiting);
  expect(notifier).toEqual([{ type: "waiting.counted", ...waiting }]);
  expect(page).toEqual([]);
});

test("the desktop app hears what waits only when something about it changed, a title included", () => {
  const hub = new Hub();
  const notifier = connect(hub, "notifier");
  const announced = [
    summary(waitingConversation("a", "done")),
    summary(waitingConversation("a", "done")),
    summary(waitingConversation("a", "done", "Renamed")),
    summary(waitingConversation("b", "decision"), waitingConversation("a", "done", "Renamed")),
    summary(waitingConversation("b", "decision"), waitingConversation("a", "done", "Renamed")),
    summary(),
  ];
  announced.forEach((waiting) => hub.announceWaiting(waiting));
  expect(notifier).toEqual([announced[0], announced[2], announced[3], announced[5]].map((waiting) => ({ type: "waiting.counted", ...waiting })));
});

test("only the desktop app hears the running turns count, and only when it changed", () => {
  const hub = new Hub();
  const page = connect(hub, "page");
  const notifier = connect(hub, "notifier");
  hub.announceRunningTurnsCount(2);
  hub.announceRunningTurnsCount(2);
  hub.announceRunningTurnsCount(0);
  expect(notifier).toEqual([
    { type: "running-turns.counted", count: 2 },
    { type: "running-turns.counted", count: 0 },
  ]);
  expect(page).toEqual([]);
});

test("a running turn takes the dot from a Done, Failed or Unread mark, but not from a decision, which needs you now", () => {
  const on = (waitingFor: Conversation["waitingFor"], status: Conversation["status"]) => waitingShowsOnDot({ waitingFor, status } as Conversation);
  expect([on("permission", "running"), on("question", "running")]).toEqual([true, true]);
  expect([on("finished", "running"), on("error", "running"), on("unread", "running"), on(null, "running")]).toEqual([false, false, false, false]);
  // Starting also covers switching a profile or loading a session's history, which no mark gives way to.
  for (const status of ["starting", "idle", "error"] as const) {
    expect([on("permission", status), on("finished", status), on("error", status), on("unread", status), on(null, status)]).toEqual([true, true, true, true, false]);
  }
});
