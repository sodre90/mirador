import { expect, test } from "bun:test";
import { Hub, socketData, type BrowserSocket, type SocketData } from "../host/hub.ts";
import type { Conversation } from "../shared/model.ts";
import type { ServerMessage } from "../shared/protocol.ts";
import { countWaiting, lastsUntilOpened, summarizeWaiting, waitingByUrgency, waitingShowsOnDot } from "../shared/waiting.ts";
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

test("summarizes how many wait and the most urgent tone among them", () => {
  expect(summarizeWaiting(["finished", "unread", "permission"])).toEqual({ count: 3, mostUrgent: "decision" });
  expect(summarizeWaiting([])).toEqual({ count: 0, mostUrgent: null });
});

test("only the desktop app hears what waits", () => {
  const hub = new Hub();
  const page = connect(hub, "page");
  const notifier = connect(hub, "notifier");
  hub.announceWaiting({ count: 3, mostUrgent: "decision" });
  expect(notifier).toEqual([{ type: "waiting.counted", count: 3, mostUrgent: "decision" }]);
  expect(page).toEqual([]);
});

test("the desktop app hears what waits only when the count or the most urgent tone changed", () => {
  const hub = new Hub();
  const notifier = connect(hub, "notifier");
  hub.announceWaiting({ count: 2, mostUrgent: "done" });
  hub.announceWaiting({ count: 2, mostUrgent: "done" });
  hub.announceWaiting({ count: 2, mostUrgent: "decision" });
  hub.announceWaiting({ count: 2, mostUrgent: "decision" });
  hub.announceWaiting({ count: 1, mostUrgent: "decision" });
  hub.announceWaiting({ count: 0, mostUrgent: null });
  expect(notifier).toEqual([
    { type: "waiting.counted", count: 2, mostUrgent: "done" },
    { type: "waiting.counted", count: 2, mostUrgent: "decision" },
    { type: "waiting.counted", count: 1, mostUrgent: "decision" },
    { type: "waiting.counted", count: 0, mostUrgent: null },
  ]);
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
