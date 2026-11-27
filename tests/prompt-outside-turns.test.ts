import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RequestPermissionRequest, RequestPermissionResponse, SessionNotification } from "@agentclientprotocol/sdk/unstable";
import { loadConfig } from "../host/config.ts";
import { agentProcessKey, ConversationService } from "../host/conversations.ts";
import { Hub } from "../host/hub.ts";
import { KEEP_WARM_PROMPT } from "../host/prompt-cache-keep-alive.ts";
import { Store } from "../host/store.ts";
import { SystemNotifications } from "../host/system-notifications.ts";

const scratch = mkdtempSync(join(tmpdir(), "prompt-outside-turns-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const sessionId = "ses_warm";
async function until(condition: () => boolean) {
  for (let tries = 0; tries < 500 && !condition(); tries++) await Bun.sleep(10);
}

const textOf = (prompt: { type: string; text?: string }[]) => prompt.map(({ text }) => text ?? "").join("");

/**
 * A YOLO conversation on a profile that keeps its cache warm, whose agent answers each prompt at once, but holds the
 * keep-alive's answer until `answerKeepAlive`, and says "ok" meanwhile, as Claude Code would.
 */
function conversationKeptWarm() {
  const store = new Store(":memory:");
  const project = join(scratch, `project-${crypto.randomUUID()}`);
  mkdirSync(project);
  store.saveProfile({ id: "p1", name: "p", harness: "claude", environment: "", prelaunch: "", model: null, mode: null, effort: null, bypassPermissions: true, askMode: "wait", color: null, pluginsOff: [], keepCacheWarm: true, createdAt: 1 });
  store.insertWorkspace({ id: "w1", name: "p", path: project, defaultLaunch: { harness: "claude", profileId: "p1" }, createdAt: 1 });
  const config = loadConfig({ MIRADOR_DATA_DIR: join(scratch, `data-${crypto.randomUUID()}`) });
  const conversations = new ConversationService(store, new Hub(), config, {} as never, {} as never, {} as never, new SystemNotifications(store, new Hub()));
  const internals = conversations as unknown as {
    agentProcesses: Map<string, unknown>;
    sessions: { bind(conversationId: string, sessionId: string): void };
    runtime(conversationId: string): object;
    handleSessionUpdate(notification: SessionNotification): void;
    handlePermissionRequest(request: RequestPermissionRequest, signal: AbortSignal): Promise<RequestPermissionResponse>;
    promptOutsideTurns(conversationId: string, text: string, options: { shown: boolean }): Promise<string | null>;
  };
  const conversation = conversations.create("w1", { harness: "claude", profileId: "p1" });
  const prompted: string[] = [];
  let answerKeepAlive = () => {};
  const keepAliveAnswered = new Promise<void>((resolve) => (answerKeepAlive = resolve));
  const agent = {
    prompt: async (_session: string, prompt: { type: string; text?: string }[]) => {
      const text = textOf(prompt);
      prompted.push(text);
      if (text === KEEP_WARM_PROMPT) {
        internals.handleSessionUpdate({ sessionId, update: { sessionUpdate: "agent_message_chunk", messageId: "msg_ok", content: { type: "text", text: "ok" } } });
        await keepAliveAnswered;
      }
      return { stopReason: "end_turn" };
    },
    cancel: async () => {},
  };
  internals.agentProcesses.set(agentProcessKey({ id: "p1", harness: "claude" }, conversation, false), agent);
  internals.sessions.bind(conversation.id, sessionId);
  Object.assign(internals.runtime(conversation.id), { sessionId: Promise.resolve(sessionId), harness: agent });
  const keepAlive = internals.promptOutsideTurns(conversation.id, KEEP_WARM_PROMPT, { shown: false });
  const askPermission = () =>
    internals.handlePermissionRequest(
      {
        sessionId,
        toolCall: { toolCallId: "toolu_1", title: "Bash" },
        options: [
          { optionId: "allow", name: "Allow", kind: "allow_once" },
          { optionId: "reject", name: "Reject", kind: "reject_once" },
        ],
      },
      new AbortController().signal,
    );
  const eventTypes = () => store.listEvents(conversation.id).map(({ event }) => event.type);
  return { conversations, conversation, prompted, keepAlive, answerKeepAlive, askPermission, eventTypes };
}

test("a keep-alive shows nothing of its answer, and turns down what it asks permission for, even on YOLO", async () => {
  const { keepAlive, answerKeepAlive, askPermission, eventTypes } = conversationKeptWarm();

  expect(await askPermission()).toEqual({ outcome: { outcome: "selected", optionId: "reject" } });
  answerKeepAlive();
  expect(await keepAlive).toBe("end_turn");
  expect(eventTypes()).toEqual([]);
  expect(await askPermission()).toEqual({ outcome: { outcome: "selected", optionId: "allow" } });
});

test("a message sent during a keep-alive waits in the queue, and a turn started directly meanwhile goes before it", async () => {
  const { conversations, conversation, prompted, keepAlive, answerKeepAlive } = conversationKeptWarm();

  await conversations.send(conversation.id, "queued meanwhile");
  expect(conversations.get(conversation.id).queuedMessages.map(({ text }) => text)).toEqual(["queued meanwhile"]);
  const startedDirectly = conversations.prompt(conversation.id, "started directly");
  answerKeepAlive();
  await keepAlive;

  await startedDirectly;
  await until(() => prompted.length === 3);
  expect(prompted.map((text) => text.split("\n").at(-1))).toEqual([KEEP_WARM_PROMPT, "started directly", "queued meanwhile"]);
});
