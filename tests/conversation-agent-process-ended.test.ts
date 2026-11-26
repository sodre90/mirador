import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../host/config.ts";
import { ConversationService } from "../host/conversations.ts";
import { Hub } from "../host/hub.ts";
import { SystemNotifications } from "../host/system-notifications.ts";
import { Store } from "../host/store.ts";
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
}

/**
 * A Claude conversation whose log holds `events`, on an agent process that is a stand-in. The subagent flag is driven
 * through the real path, handleSessionUpdate, with the session `s1` registered to the conversation.
 */
function conversationWithLog(events: ConversationEvent[] = []) {
  const store = new Store(":memory:");
  const project = join(scratch, `project-${crypto.randomUUID()}`);
  mkdirSync(project);
  store.saveProfile({ id: "p1", name: "p", harness: "claude", environment: "", prelaunch: "", model: null, mode: null, effort: null, bypassPermissions: false, askMode: "wait", color: null, pluginsOff: [], createdAt: 1 });
  store.insertWorkspace({ id: "w1", name: "p", path: project, defaultLaunch: { harness: "claude", profileId: "p1" }, createdAt: 1 });
  const config = loadConfig({ MIRADOR_DATA_DIR: join(scratch, `data-${crypto.randomUUID()}`) });
  const conversations = new ConversationService(store, new Hub(), config, {} as never, {} as never, {} as never, new SystemNotifications(store, new Hub()));
  // Not `create`, which opens a session on a real agent process at once.
  const conversation = (conversations as unknown as { insertConversation(workspaceId: string, launch: object, title: string, titleSetByUser: boolean): { id: string } }).insertConversation("w1", { harness: "claude", profileId: "p1" }, "Untitled", false);
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

test("a session opening on a new process with a log that shows a task left running appends agent-process-ended once", async () => {
  const { internals, conversationId, runtime, processEnds } = conversationWithLog([...yourTurn, eventUpdate("a1", "running")]);
  runtime.harness = undefined;
  expect(await internals.ensureSession(conversationId, async () => "s2")).toBe("s2");
  expect(processEnds()).toBe(1);
  runtime.sessionId = undefined;
  await internals.ensureSession(conversationId, async () => "s3");
  expect(processEnds(), "the event ended it in the log").toBe(1);
});

test("the log is read for tasks left running once per host run: a later open in the same run does not read it again", async () => {
  const { internals, conversationId, runtime, store, processEnds } = conversationWithLog(yourTurn);
  runtime.harness = undefined;
  expect(await internals.ensureSession(conversationId, async () => "s2")).toBe("s2");
  expect(processEnds()).toBe(0);

  store.appendEvent(conversationId, eventUpdate("a1", "running"));
  runtime.sessionId = undefined;
  expect(await internals.ensureSession(conversationId, async () => "s3")).toBe("s3");
  expect(processEnds(), "the run's own process ends are logged as they happen, so the later read is not needed").toBe(0);
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
