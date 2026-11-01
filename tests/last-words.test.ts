import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionUpdate } from "@agentclientprotocol/sdk";
import { loadConfig } from "../host/config.ts";
import { ConversationService } from "../host/conversations.ts";
import { Hub } from "../host/hub.ts";
import { SystemNotifications } from "../host/system-notifications.ts";
import { Store } from "../host/store.ts";
import type { ConversationEvent, StoredEvent } from "../shared/model.ts";
import { replyOf, LAST_WORDS_GRAPHEMES, lastWordsOf } from "../shared/last-words.ts";

const scratch = mkdtempSync(join(tmpdir(), "last-words-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const stored = (events: ConversationEvent[]): StoredEvent[] => events.map((event, index) => ({ seq: index + 1, at: (index + 1) * 1000, event }));
const acp = (update: SessionUpdate): ConversationEvent => ({ type: "acp", update });
const agentText = (text: string) => acp({ sessionUpdate: "agent_message_chunk", content: { type: "text", text } });
const thought = (text: string) => acp({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text } });
const toolCall = (toolCallId: string) => acp({ sessionUpdate: "tool_call", toolCallId, title: "Bash", status: "completed" });
const turn = (...events: ConversationEvent[]) => stored([{ type: "user-message", text: "Fix the tests" }, ...events, { type: "turn-end", stopReason: "end_turn" }]);

describe("the agent's last words in a turn", () => {
  test("are its last message, not what it said before its last step", () => {
    expect(lastWordsOf(turn(agentText("Looking at the failures."), toolCall("t1"), agentText("All **12** tests pass now.\n")))).toBe("All **12** tests pass now.");
  });

  test("are nothing when the agent only thought and worked", () => {
    expect(lastWordsOf(turn(thought("Which test fails?"), toolCall("t1")))).toBeNull();
    expect(lastWordsOf(turn())).toBeNull();
  });

  test("keep a long message's end, from the start of a line, after an ellipsis", () => {
    const steps = Array.from({ length: 10 }, (_, index) => `- step ${index + 1} of the fix is done`).join("\n");
    expect(lastWordsOf(turn(agentText(`${"x".repeat(LAST_WORDS_GRAPHEMES)}\n${steps}`)))).toBe(`…${steps}`);
  });

  test("keep a long paragraph's end from the start of a word", () => {
    const words = lastWordsOf(turn(agentText(`${"word ".repeat(LAST_WORDS_GRAPHEMES)}done`)))!;
    expect(words.startsWith("…word ")).toBe(true);
    expect(words.endsWith(" done")).toBe(true);
    expect(words.length).toBeLessThanOrEqual(LAST_WORDS_GRAPHEMES + 1);
  });
});

/** A host started on a conversation whose turns ended while no one watched, the latest one unseen. */
function hostAfterTurnsEndedUnseen(...turns: ConversationEvent[][]) {
  const store = new Store(":memory:");
  store.saveProfile({ id: "p1", name: "p", harness: "opencode", environment: "", prelaunch: "", mode: null, effort: null, bypassPermissions: false, askMode: "wait", color: null, createdAt: 1 });
  store.insertWorkspace({ id: "w1", name: "p", path: join(scratch, "project"), defaultLaunch: { harness: "opencode", profileId: "p1" }, createdAt: 1 });
  store.insertConversation({
    id: "c1",
    workspaceId: "w1",
    harness: "opencode",
    profileId: "p1",
    title: "t",
    titleSetByUser: false,
    acpSessionId: "ses_1",
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
  turns.flat().forEach((event) => store.appendEvent("c1", event));
  store.setUnseenTurnEnd("c1", "finished");
  const config = loadConfig({ MIRADOR_DATA_DIR: join(scratch, `data-${crypto.randomUUID()}`) });
  return new ConversationService(store, new Hub(), config, {} as never, {} as never, {} as never, new SystemNotifications(store, new Hub()));
}

const turnFrom = (message: ConversationEvent, events: ConversationEvent[]): ConversationEvent[] => [message, ...events, { type: "turn-end", stopReason: "end_turn" }];
const turnOf = (request: string, ...events: ConversationEvent[]) => turnFrom({ type: "user-message", text: request }, events);
const turnKeepingTheFiles = (checkpoint: string, request: string, ...events: ConversationEvent[]) => turnFrom({ type: "user-message", text: request, checkpoint }, events);

describe("a conversation's last words", () => {
  test("come with a turn that ended unseen, after a host restart too, and go once the conversation is seen", () => {
    const host = hostAfterTurnsEndedUnseen(turnOf("Fix the tests", agentText("Fixed.")), turnOf("Ship it", agentText("Shipped 2.0.")));
    expect(host.get("c1").lastWords).toBe("Shipped 2.0.");
    host.markSeen("c1");
    expect(host.get("c1").lastWords).toBeNull();
  });

  test("are not an earlier turn's when the latest one said nothing in words", () => {
    const host = hostAfterTurnsEndedUnseen(turnOf("Fix the tests", agentText("Fixed.")), turnOf("Run them again", toolCall("t1")));
    expect(host.get("c1").lastWords).toBeNull();
  });

  test("are the latest turn's in a repository, where each turn's message keeps the files", () => {
    const fixed = turnKeepingTheFiles("c0ffee1", "Fix the tests", agentText("Fixed."));
    const ranAgain = turnKeepingTheFiles("c0ffee2", "Run them again", toolCall("t1"));
    expect(hostAfterTurnsEndedUnseen(fixed, ranAgain).get("c1").lastWords).toBeNull();
    const shipped = turnKeepingTheFiles("c0ffee3", "Ship it", agentText("Shipped 2.0."));
    expect(hostAfterTurnsEndedUnseen(fixed, shipped).get("c1").lastWords).toBe("Shipped 2.0.");
  });
});

describe("the reply of a turn", () => {
  test("is the agent's whole last message, however long, and the turn finished", () => {
    const long = "y".repeat(LAST_WORDS_GRAPHEMES * 2);
    expect(replyOf(turn(agentText("Looking."), toolCall("t1"), agentText(long)))).toEqual({ text: long, ended: "finished" });
  });

  test("says the turn was stopped, or failed when it has no end, and has no text when the agent said nothing", () => {
    expect(replyOf(stored([{ type: "user-message", text: "Find" }, toolCall("t1"), { type: "turn-end", stopReason: "cancelled" }]))).toEqual({ text: null, ended: "stopped" });
    expect(replyOf(stored([{ type: "user-message", text: "Find" }, agentText("Half")]))).toEqual({ text: "Half", ended: "failed" });
  });
});
