import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionNotification } from "@agentclientprotocol/sdk/unstable";
import { loadConfig } from "../host/config.ts";
import { ConversationService } from "../host/conversations.ts";
import { Hub } from "../host/hub.ts";
import { SystemNotifications } from "../host/system-notifications.ts";
import { Store } from "../host/store.ts";

const scratch = mkdtempSync(join(tmpdir(), "conversation-usage-limit-reply-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const sessionId = "ses_limit";
const banner = "You've hit your 5-hour limit · resets 3:30am (Europe/Zagreb)";
const bannerId = "6f1c2a3e-9b7d-4c58-8e21-0a5d3b9c7e41";

type Update = SessionNotification["update"];
const says = (text: string, messageId: string): Update => ({ sessionUpdate: "agent_message_chunk", messageId, content: { type: "text", text } });
const ownToolCall: Update[] = [
  { sessionUpdate: "tool_call", toolCallId: "toolu_main", title: "Bash", kind: "execute", status: "pending" },
  { sessionUpdate: "tool_call_update", toolCallId: "toolu_main", status: "completed" },
];
const subagentFailed: Update = { sessionUpdate: "tool_call_update", toolCallId: "toolu_agent", _meta: { claudeCode: { subagentTaskStatus: "failed" } } };

/** A Claude conversation whose agent plays the updates of one turn through the service's own handler, then ends the turn by itself. */
function turnThatPlays(updates: Update[]) {
  const store = new Store(":memory:");
  const project = join(scratch, `project-${crypto.randomUUID()}`);
  mkdirSync(project);
  store.saveProfile({ id: "p1", name: "p", harness: "claude", environment: "", prelaunch: "", model: null, mode: null, effort: null, bypassPermissions: false, askMode: "wait", color: null, pluginsOff: [], createdAt: 1 });
  store.insertWorkspace({ id: "w1", name: "p", path: project, defaultLaunch: { harness: "claude", profileId: "p1" }, createdAt: 1 });
  const config = loadConfig({ MIRADOR_DATA_DIR: join(scratch, `data-${crypto.randomUUID()}`) });
  const conversations = new ConversationService(store, new Hub(), config, {} as never, {} as never, {} as never, new SystemNotifications(store, new Hub()));
  const internals = conversations as unknown as {
    agentProcesses: Map<string, unknown>;
    sessions: { bind(conversationId: string, sessionId: string): void };
    runtime(conversationId: string): { sessionId?: Promise<string> };
    handleSessionUpdate(notification: SessionNotification): void;
  };
  const conversation = conversations.create("w1", { harness: "claude", profileId: "p1" });
  internals.sessions.bind(conversation.id, sessionId);
  internals.runtime(conversation.id).sessionId = Promise.resolve(sessionId);
  internals.agentProcesses.set("p1", {
    prompt: async () => {
      updates.forEach((update) => internals.handleSessionUpdate({ sessionId, update }));
      return { stopReason: "end_turn", usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 } };
    },
  });
  const eventsOfTurn = () => store.listEvents(conversation.id).map(({ event }) => event);
  return { conversations, conversation, eventsOfTurn };
}

test("a usage limit Claude Code says as the end of a turn a background subagent's failure joined records the limit, not a turn end, and holds the queue", async () => {
  const { conversations, conversation, eventsOfTurn } = turnThatPlays([says("Starting the subagent.", "msg_a"), ...ownToolCall, subagentFailed, says(banner, bannerId)]);

  await conversations.send(conversation.id, "go");
  await conversations.send(conversation.id, "and then this", [], { afterTurn: true });

  const events = eventsOfTurn();
  expect(events.at(-1)).toMatchObject({ type: "error", message: banner, usageLimit: { resetsAt: expect.any(Number) }, endsTurn: true, continuable: true, usage: expect.objectContaining({ inputTokens: 10, outputTokens: 20 }) });
  expect(events.some((event) => event.type === "turn-end")).toBe(false);
  const wait = conversations.get(conversation.id).usageLimit;
  expect(wait?.continuesAt).toEqual(expect.any(Number));
  expect(conversations.get(conversation.id).queuedMessages.map(({ text }) => text)).toEqual(["and then this"]);
});

test("the same words as a model's own message (msg_ id) end the turn as an ordinary reply, with no wait", async () => {
  const { conversations, conversation, eventsOfTurn } = turnThatPlays([says(banner, "msg_b")]);

  await conversations.send(conversation.id, "go");

  expect(eventsOfTurn().at(-1)).toMatchObject({ type: "turn-end", stopReason: "end_turn" });
  expect(eventsOfTurn().some((event) => event.type === "error")).toBe(false);
  expect(conversations.get(conversation.id).usageLimit).toBeNull();
});

test("text the agent wrote before its tool call does not keep the banner after the call from being recognised", async () => {
  const { conversations, conversation, eventsOfTurn } = turnThatPlays([says("Working on it.", "msg_a"), ...ownToolCall, says(banner, bannerId)]);

  await conversations.send(conversation.id, "go");

  expect(eventsOfTurn().at(-1)).toMatchObject({ type: "error", message: banner, usageLimit: { resetsAt: expect.any(Number) }, endsTurn: true });
  expect(eventsOfTurn().some((event) => event.type === "turn-end")).toBe(false);
  expect(conversations.get(conversation.id).usageLimit).not.toBeNull();
});

test("a turn the limit ended this way is no stall, so a script's next stalled turn is nudged afresh", async () => {
  const { conversations, conversation } = turnThatPlays([says(banner, bannerId)]);
  const runtime = (conversations as unknown as { runtime(conversationId: string): { stallNudges: number } }).runtime(conversation.id);
  runtime.stallNudges = 2;

  await conversations.send(conversation.id, "go");

  expect(runtime.stallNudges).toBe(0);
});
