import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../host/config.ts";
import { ConversationService } from "../host/conversations.ts";
import { Hub } from "../host/hub.ts";
import { SystemNotifications } from "../host/system-notifications.ts";
import { Store } from "../host/store.ts";
import { buildTimeline, subagentState, subagentsIn } from "../shared/timeline.ts";
import type * as acp from "@agentclientprotocol/sdk/unstable";
import type { ConversationEvent } from "../shared/model.ts";

const yourTurn: ConversationEvent[] = [{ type: "user-message", text: "Start the screenshot pass" }, { type: "turn-end", stopReason: "end_turn" }];

const scratch = mkdtempSync(join(tmpdir(), "conversation-agent-process-ended-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const taskOf = (toolCallId: string, subagentTaskStatus: string): acp.SessionNotification => ({
  sessionId: "s1",
  update: { sessionUpdate: "tool_call_update", toolCallId, _meta: { claudeCode: { subagentTaskStatus } } },
});
const eventUpdate = (toolCallId: string, subagentTaskStatus: string): ConversationEvent => ({ type: "acp", update: taskOf(toolCallId, subagentTaskStatus).update });

interface Internals {
  runtime(conversationId: string): { harness?: object; sessionId?: Promise<string>; subagentTasksAtWork: Set<string> };
  handleHarnessExit(harness: object): void;
  handleSessionUpdate(notification: acp.SessionNotification): void;
  moveIdleConversationsOff(harness: object): void;
  releaseSession(conversationId: string, runtime: object, sessionId: string | null, options?: { endBackgroundWork?: boolean }): Promise<void>;
  endBackgroundWorkOf(conversationId: string): void;
  ensureSession(conversationId: string, open?: () => Promise<string>): Promise<string>;
  rewind(conversationId: string, seq: number): Promise<{ fromSeq: number; throughSeq: number }>;
}

function storeWithWorkspace() {
  const store = new Store(":memory:");
  const project = join(scratch, `project-${crypto.randomUUID()}`);
  mkdirSync(project);
  store.saveProfile({ id: "p1", name: "p", harness: "claude", environment: "", prelaunch: "", model: null, mode: null, effort: null, bypassPermissions: false, askMode: "wait", color: null, pluginsOff: [], createdAt: 1 });
  store.insertWorkspace({ id: "w1", name: "p", path: project, defaultLaunch: { harness: "claude", profileId: "p1" }, createdAt: 1 });
  return store;
}

/** A host as it starts over `store`: its constructor reads every conversation's log, as it does after a restart. */
function hostOver(store: Store) {
  const config = loadConfig({ MIRADOR_DATA_DIR: join(scratch, `data-${crypto.randomUUID()}`) });
  return new ConversationService(store, new Hub(), config, {} as never, {} as never, {} as never, new SystemNotifications(store, new Hub()));
}

/** Not `create`, which opens a session on a real agent process at once. */
const insertConversation = (conversations: ConversationService) =>
  (conversations as unknown as { insertConversation(workspaceId: string, launch: object, title: string, titleSetByUser: boolean): { id: string } }).insertConversation("w1", { harness: "claude", profileId: "p1" }, "Untitled", false);

/** A conversation whose log holds `events`, in a store a host starts over; `turnInFlight` says the host was killed mid-turn. */
function storeWithLog(events: ConversationEvent[], { turnInFlight = false } = {}) {
  const store = storeWithWorkspace();
  const conversation = insertConversation(hostOver(store));
  events.forEach((event) => store.appendEvent(conversation.id, event));
  if (turnInFlight) store.turnStarted(conversation.id);
  return { store, conversationId: conversation.id };
}

const storedEventsOf = (store: Store, conversationId: string) => store.listEvents(conversationId).map(({ event }) => event);
const processEndsOf = (store: Store, conversationId: string) => storedEventsOf(store, conversationId).filter((event) => event.type === "agent-process-ended").length;

const subagentLaunch = (toolCallId: string): ConversationEvent => ({
  type: "acp",
  update: { sessionUpdate: "tool_call", toolCallId, title: "Task", kind: "think", status: "pending", rawInput: { description: "Verify screenshot pass" }, _meta: { claudeCode: { toolName: "Agent" } } },
});
const subagentAnsweredAtOnce = (toolCallId: string): ConversationEvent => ({
  type: "acp",
  update: { sessionUpdate: "tool_call_update", toolCallId, _meta: { claudeCode: { toolName: "Agent", toolResponse: { isAsync: true, status: "async_launched" } } } },
});

/**
 * A Claude conversation whose log holds `events`, on an agent process that is a stand-in. The subagent flag is driven
 * through the real path, handleSessionUpdate, with the session `s1` registered to the conversation.
 */
function conversationWithLog(events: ConversationEvent[] = []) {
  const store = storeWithWorkspace();
  const conversations = hostOver(store);
  const conversation = insertConversation(conversations);
  events.forEach((event) => store.appendEvent(conversation.id, event));
  const agent = { closeSession: async () => {} };
  const internals = conversations as unknown as Internals & { sessions: { bind(conversationId: string, sessionId: string): void } };
  internals.sessions.bind(conversation.id, "s1");
  const runtime = internals.runtime(conversation.id);
  runtime.harness = agent;
  const eventsNow = () => store.listEvents(conversation.id).map(({ event }) => event);
  const processEnds = () => eventsNow().filter((event) => event.type === "agent-process-ended").length;
  const hear = (notification: acp.SessionNotification) => internals.handleSessionUpdate(notification);
  return { internals, conversationId: conversation.id, runtime, agent, store, hear, eventsNow, processEnds };
}

test("a task reported running is at work until it is reported ended, by any of the four ending statuses", () => {
  const { hear, runtime } = conversationWithLog();
  hear(taskOf("a1", "running"));
  hear(taskOf("a2", "running"));
  expect([...runtime.subagentTasksAtWork]).toEqual(["a1", "a2"]);
  for (const status of ["completed", "failed", "stopped", "killed"]) {
    hear(taskOf("a1", "running"));
    hear(taskOf("a1", status));
    expect(runtime.subagentTasksAtWork.has("a1"), status).toBe(false);
  }
  hear(taskOf("a2", "constructor"));
  expect(runtime.subagentTasksAtWork.has("a2"), "a status it does not know leaves the task at work").toBe(true);
});

test("a harness exit with a subagent task at work appends agent-process-ended once, and the flag is cleared", () => {
  const { internals, agent, hear, runtime, eventsNow, processEnds } = conversationWithLog(yourTurn);
  hear(taskOf("a1", "running"));
  internals.handleHarnessExit(agent);
  expect(eventsNow().at(-1)).toEqual({ type: "agent-process-ended" });
  expect(runtime.subagentTasksAtWork.size).toBe(0);
  internals.handleHarnessExit(agent);
  expect(processEnds()).toBe(1);
});

test("a harness exit with no subagent task at work appends nothing, though earlier tasks ended", () => {
  const { internals, agent, hear, eventsNow } = conversationWithLog(yourTurn);
  hear(taskOf("a1", "running"));
  hear(taskOf("a1", "completed"));
  internals.handleHarnessExit(agent);
  expect(eventsNow().some((event) => event.type === "agent-process-ended")).toBe(false);
});

test("a planned kill, which moves idle conversations off the process before it exits, appends agent-process-ended too", () => {
  const { internals, agent, hear, runtime, processEnds } = conversationWithLog(yourTurn);
  hear(taskOf("a1", "running"));
  internals.moveIdleConversationsOff(agent);
  expect(runtime.harness).toBeUndefined();
  expect(processEnds()).toBe(1);
  internals.handleHarnessExit(agent);
  expect(processEnds(), "the exit no longer finds the conversation").toBe(1);
});

test("releasing the session appends it, unless the caller defers it until after it has deleted events", async () => {
  const kept = conversationWithLog(yourTurn);
  kept.hear(taskOf("a1", "running"));
  await kept.internals.releaseSession(kept.conversationId, kept.runtime, "s1");
  expect(kept.processEnds()).toBe(1);

  const deferred = conversationWithLog(yourTurn);
  deferred.hear(taskOf("a1", "running"));
  await deferred.internals.releaseSession(deferred.conversationId, deferred.runtime, "s1", { endBackgroundWork: false });
  expect(deferred.processEnds()).toBe(0);
  deferred.internals.endBackgroundWorkOf(deferred.conversationId);
  expect(deferred.eventsNow().at(-1)).toEqual({ type: "agent-process-ended" });
});

test("a host starting over a log with a subagent task left running appends agent-process-ended once, and an idle conversation shows the subagent stopped with no message sent", () => {
  const { store, conversationId } = storeWithLog([...yourTurn, subagentLaunch("b1"), eventUpdate("b1", "running"), subagentAnsweredAtOnce("b1")]);
  hostOver(store);
  expect(storedEventsOf(store, conversationId).at(-1)).toEqual({ type: "agent-process-ended" });
  expect(processEndsOf(store, conversationId)).toBe(1);
  const subagentStates = subagentsIn(buildTimeline(store.listEvents(conversationId))).map((block) => subagentState(block, false));
  expect(subagentStates).toEqual(["stopped"]);
});

test("a host starting again over the same log appends nothing more, the first start having ended the task", () => {
  const { store, conversationId } = storeWithLog([...yourTurn, subagentLaunch("b1"), eventUpdate("b1", "running"), subagentAnsweredAtOnce("b1")]);
  hostOver(store);
  hostOver(store);
  expect(processEndsOf(store, conversationId)).toBe(1);
});

test("a host starting over a log whose task ended appends nothing", () => {
  const { store, conversationId } = storeWithLog([...yourTurn, subagentLaunch("b1"), eventUpdate("b1", "running"), subagentAnsweredAtOnce("b1"), eventUpdate("b1", "completed")]);
  hostOver(store);
  expect(processEndsOf(store, conversationId)).toBe(0);
});

test("a host starting over a turn it was killed in ends the task left running, and the turn as cut short, each once", () => {
  const { store, conversationId } = storeWithLog([{ type: "user-message", text: "Go" }, subagentLaunch("b1"), eventUpdate("b1", "running"), subagentAnsweredAtOnce("b1")], { turnInFlight: true });
  hostOver(store);
  expect(storedEventsOf(store, conversationId).slice(-2)).toEqual([{ type: "agent-process-ended" }, { type: "turn-end", stopReason: "cancelled", cutShortByRestart: true }]);
  hostOver(store);
  expect(processEndsOf(store, conversationId)).toBe(1);
});

test("a session opening on a new process no longer reads the log for subagent tasks left running", async () => {
  const { internals, conversationId, runtime, processEnds } = conversationWithLog([...yourTurn, eventUpdate("a1", "running")]);
  runtime.harness = undefined;
  expect(await internals.ensureSession(conversationId, async () => "s2")).toBe("s2");
  expect(processEnds()).toBe(0);
});

test("a session already open appends nothing, nor does one opening where the log shows no task left running", async () => {
  const open = conversationWithLog([...yourTurn, eventUpdate("a1", "running")]);
  open.runtime.sessionId = Promise.resolve("s1");
  await open.internals.ensureSession(open.conversationId, async () => "s2");
  expect(open.processEnds()).toBe(0);

  const ended = conversationWithLog([...yourTurn, eventUpdate("a1", "running"), eventUpdate("a1", "completed")]);
  await ended.internals.ensureSession(ended.conversationId, async () => "s2");
  expect(ended.processEnds()).toBe(0);
});

const agentSaid = (messageId: string): ConversationEvent => ({ type: "acp", update: { sessionUpdate: "agent_message_chunk", messageId, content: { type: "text", text: "On it" } } });
const turnLaunchingSubagent: ConversationEvent[] = [{ type: "user-message", text: "Verify the screenshots" }, agentSaid("m1"), subagentLaunch("b1"), eventUpdate("b1", "running"), subagentAnsweredAtOnce("b1"), { type: "turn-end", stopReason: "end_turn" }];
const nextMessage: ConversationEvent = { type: "user-message", text: "Now the release notes" };

/** Rewinds to `nextMessage`, the second message in the log, and returns the events that rewind appended. */
async function rewindToNextMessage(conversation: ReturnType<typeof conversationWithLog>) {
  const rewindPoint = conversation.store.listEvents(conversation.conversationId).findLast(({ event }) => event.type === "user-message")!.seq;
  const { throughSeq } = await conversation.internals.rewind(conversation.conversationId, rewindPoint);
  return conversation.store.listEvents(conversation.conversationId).filter(({ seq }) => seq > throughSeq).map(({ event }) => event);
}

test("a rewind past where a subagent's task ended appends agent-process-ended, so the kept log shows the subagent stopped", async () => {
  const conversation = conversationWithLog([...turnLaunchingSubagent, nextMessage, agentSaid("m2"), eventUpdate("b1", "completed"), { type: "turn-end", stopReason: "end_turn" }]);
  expect(await rewindToNextMessage(conversation)).toEqual([{ type: "agent-process-ended" }]);
  expect(conversation.runtime.subagentTasksAtWork.size).toBe(0);
  const subagentStates = subagentsIn(buildTimeline(conversation.store.listEvents(conversation.conversationId))).map((block) => subagentState(block, false));
  expect(subagentStates).toEqual(["stopped"]);
});

test("a rewind to after a subagent's task ended appends nothing", async () => {
  const conversation = conversationWithLog([...turnLaunchingSubagent, eventUpdate("b1", "completed"), nextMessage, agentSaid("m2"), { type: "turn-end", stopReason: "end_turn" }]);
  expect(await rewindToNextMessage(conversation)).toEqual([]);
  expect(conversation.processEnds()).toBe(0);
});
