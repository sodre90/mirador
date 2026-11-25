import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionNotification } from "@agentclientprotocol/sdk/unstable";
import { loadConfig } from "../host/config.ts";
import { agentProcessKey, ConversationService } from "../host/conversations.ts";
import { Hub } from "../host/hub.ts";
import type { HarnessId } from "../shared/model.ts";
import { SystemNotifications } from "../host/system-notifications.ts";
import { Store } from "../host/store.ts";

const scratch = mkdtempSync(join(tmpdir(), "conversation-usage-limit-reply-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const sessionId = "ses_limit";
const banner = "You've hit your 5-hour limit · resets 3:30am (Europe/Zagreb)";
const noAgyToReadQuotasWith = `AGY_PATH=${join(scratch, "no-agy")}`;
const bannerId = "6f1c2a3e-9b7d-4c58-8e21-0a5d3b9c7e41";

type Update = SessionNotification["update"];
const says = (text: string, messageId: string): Update => ({ sessionUpdate: "agent_message_chunk", messageId, content: { type: "text", text } });
const ownToolCall: Update[] = [
  { sessionUpdate: "tool_call", toolCallId: "toolu_main", title: "Bash", kind: "execute", status: "pending" },
  { sessionUpdate: "tool_call_update", toolCallId: "toolu_main", status: "completed" },
];
const subagentFailed: Update = { sessionUpdate: "tool_call_update", toolCallId: "toolu_agent", _meta: { claudeCode: { subagentTaskStatus: "failed" } } };

/** A conversation, Claude's unless another agent is named, whose agent plays the updates of one turn through the service's own handler, then ends the turn by itself. */
function turnThatPlays(updates: Update[], harness: HarnessId = "claude") {
  const store = new Store(":memory:");
  const project = join(scratch, `project-${crypto.randomUUID()}`);
  mkdirSync(project);
  store.saveProfile({ id: "p1", name: "p", harness, environment: noAgyToReadQuotasWith, prelaunch: "", model: null, mode: null, effort: null, bypassPermissions: false, askMode: "wait", color: null, pluginsOff: [], createdAt: 1 });
  store.insertWorkspace({ id: "w1", name: "p", path: project, defaultLaunch: { harness, profileId: "p1" }, createdAt: 1 });
  const config = loadConfig({ MIRADOR_DATA_DIR: join(scratch, `data-${crypto.randomUUID()}`) });
  const conversations = new ConversationService(store, new Hub(), config, {} as never, {} as never, {} as never, new SystemNotifications(store, new Hub()));
  const internals = conversations as unknown as {
    agentProcesses: Map<string, unknown>;
    sessions: { bind(conversationId: string, sessionId: string): void };
    runtime(conversationId: string): object;
    handleSessionUpdate(notification: SessionNotification): void;
  };
  const conversation = conversations.create("w1", { harness, profileId: "p1" });
  const agent = {
    prompt: async () => {
      updates.forEach((update) => internals.handleSessionUpdate({ sessionId, update }));
      return { stopReason: "end_turn", usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 } };
    },
  };
  internals.agentProcesses.set(agentProcessKey({ id: "p1", harness }, conversation, false), agent);
  internals.sessions.bind(conversation.id, sessionId);
  Object.assign(internals.runtime(conversation.id), { sessionId: Promise.resolve(sessionId), harness: agent });
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

describe("Antigravity's quota notice", () => {
  const notice = "⚠ Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 4h15m13s.";
  const FOUR_HOURS_AND_A_QUARTER_MS = 4.25 * 60 * 60 * 1000;
  const agySays = (text: string): Update => ({ sessionUpdate: "agent_message_chunk", content: { type: "text", text } });

  test("records the limit, not a turn end, and holds the queue until about a minute after the delay it names", async () => {
    const { conversations, conversation, eventsOfTurn } = turnThatPlays([...ownToolCall, agySays(`\n${notice}\n`)], "antigravity");

    const startedAt = Date.now();
    await conversations.send(conversation.id, "go");
    await conversations.send(conversation.id, "and then this", [], { afterTurn: true });

    expect(eventsOfTurn().at(-1)).toMatchObject({ type: "error", message: notice, usageLimit: { resetsAt: expect.any(Number) }, endsTurn: true, continuable: true });
    expect(eventsOfTurn().some((event) => event.type === "turn-end")).toBe(false);
    const wait = conversations.get(conversation.id).usageLimit;
    expect(wait?.resetsAt).toBeGreaterThan(startedAt + FOUR_HOURS_AND_A_QUARTER_MS);
    expect(wait?.continuesAt).toBeGreaterThan(wait!.resetsAt!);
    expect(conversations.get(conversation.id).queuedMessages.map(({ text }) => text)).toEqual(["and then this"]);
  });

  test("waits for you as a failed turn, not as a finished one", async () => {
    const { conversations, conversation } = turnThatPlays([agySays(`\n${notice}\n`)], "antigravity");

    await conversations.send(conversation.id, "go");

    expect(conversations.get(conversation.id).waitingFor).toBe("error");
  });

  test("of another error ends the turn as an ordinary reply, with no wait", async () => {
    const { conversations, conversation, eventsOfTurn } = turnThatPlays([agySays("\n⚠ bad key\n")], "antigravity");

    await conversations.send(conversation.id, "go");

    expect(eventsOfTurn().at(-1)).toMatchObject({ type: "turn-end", stopReason: "end_turn" });
    expect(conversations.get(conversation.id).usageLimit).toBeNull();
  });
});
