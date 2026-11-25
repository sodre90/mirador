import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../host/config.ts";
import { ConversationService } from "../host/conversations.ts";
import { Hub } from "../host/hub.ts";
import { SystemNotifications } from "../host/system-notifications.ts";
import { Store } from "../host/store.ts";
import type { SessionUpdate } from "@agentclientprotocol/sdk/unstable";
import type { ConversationEvent } from "../shared/model.ts";

const scratch = mkdtempSync(join(tmpdir(), "conversation-agent-process-ended-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const acp = (update: SessionUpdate): ConversationEvent => ({ type: "acp", update });
const launch = (toolCallId: string) =>
  acp({ sessionUpdate: "tool_call", toolCallId, title: "Task", kind: "think", status: "pending", rawInput: { description: "Verify screenshot pass" }, _meta: { claudeCode: { toolName: "Agent" } } });
const answeredAtOnce = (toolCallId: string) =>
  acp({ sessionUpdate: "tool_call_update", toolCallId, _meta: { claudeCode: { toolName: "Agent", toolResponse: { isAsync: true, status: "async_launched" } } } });
const finish = (toolCallId: string) => acp({ sessionUpdate: "tool_call_update", toolCallId, status: "completed" });
const yourTurn: ConversationEvent[] = [{ type: "user-message", text: "Start the screenshot pass" }, { type: "turn-end", stopReason: "end_turn" }];

/** A Claude conversation whose log holds `events`, and whose agent process is a stand-in that `exitAgent` ends as the host sees an exit. */
function conversationWithLog(events: ConversationEvent[]) {
  const store = new Store(":memory:");
  const project = join(scratch, `project-${crypto.randomUUID()}`);
  mkdirSync(project);
  store.saveProfile({ id: "p1", name: "p", harness: "claude", environment: "", prelaunch: "", model: null, mode: null, effort: null, bypassPermissions: false, askMode: "wait", color: null, pluginsOff: [], createdAt: 1 });
  store.insertWorkspace({ id: "w1", name: "p", path: project, defaultLaunch: { harness: "claude", profileId: "p1" }, createdAt: 1 });
  const config = loadConfig({ MIRADOR_DATA_DIR: join(scratch, `data-${crypto.randomUUID()}`) });
  const conversations = new ConversationService(store, new Hub(), config, {} as never, {} as never, {} as never, new SystemNotifications(store, new Hub()));
  const conversation = conversations.create("w1", { harness: "claude", profileId: "p1" });
  events.forEach((event) => store.appendEvent(conversation.id, event));
  const agent = {};
  const internals = conversations as unknown as {
    runtime(conversationId: string): { harness?: object };
    handleHarnessExit(harness: object): void;
  };
  internals.runtime(conversation.id).harness = agent;
  const exitAgent = () => internals.handleHarnessExit(agent);
  const eventsNow = () => store.listEvents(conversation.id).map(({ event }) => event);
  return { exitAgent, eventsNow };
}

test("a conversation with a subagent Claude Code started between turns, still at work, gets agent-process-ended when its agent process exits", () => {
  const { exitAgent, eventsNow } = conversationWithLog([...yourTurn, launch("b1"), answeredAtOnce("b1"), finish("b1")]);
  exitAgent();
  expect(eventsNow().at(-1)).toEqual({ type: "agent-process-ended" });
});

test("a conversation without such a subagent gets no agent-process-ended when its agent process exits", () => {
  const { exitAgent, eventsNow } = conversationWithLog([...yourTurn]);
  exitAgent();
  expect(eventsNow().some((event) => event.type === "agent-process-ended")).toBe(false);
});
