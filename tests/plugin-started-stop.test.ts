import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../host/config.ts";
import { ConversationService, type HearReply } from "../host/conversations.ts";
import { Hub } from "../host/hub.ts";
import { SystemNotifications } from "../host/system-notifications.ts";
import { Store } from "../host/store.ts";
import type { ConversationReply } from "../shared/canvas-plugins.ts";

const scratch = mkdtempSync(join(tmpdir(), "plugin-started-stop-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const callerAgent = {
  spec: { id: "opencode", label: "opencode" },
  start: async () => ({}),
  newSession: async () => ({ sessionId: `caller-${crypto.randomUUID()}` }),
  prompt: async () => ({ stopReason: "end_turn" }),
  closeSession: async () => {},
};

/** An agent whose turn runs until cancelled, as a long review's does. */
function hangingAgent() {
  const prompted = Promise.withResolvers<void>();
  const cancelled = Promise.withResolvers<void>();
  let cancels = 0;
  const agent = {
    spec: { id: "opencode", label: "opencode" },
    start: async () => ({}),
    newSession: async () => ({ sessionId: `helper-${crypto.randomUUID()}` }),
    prompt: async () => {
      prompted.resolve();
      await cancelled.promise;
      return { stopReason: "cancelled" };
    },
    cancel: async () => {
      cancels += 1;
      cancelled.resolve();
    },
    closeSession: async () => {},
  };
  return { agent, prompted: prompted.promise, cancels: () => cancels };
}

/** An agent whose turn ends by itself at once. */
function quickAgent() {
  let cancels = 0;
  const agent = {
    spec: { id: "opencode", label: "opencode" },
    start: async () => ({}),
    newSession: async () => ({ sessionId: `helper-${crypto.randomUUID()}` }),
    prompt: async () => ({ stopReason: "end_turn" }),
    cancel: async () => void (cancels += 1),
    closeSession: async () => {},
  };
  return { agent, cancels: () => cancels };
}

/** A caller whose plugin starts conversations on the Helper profile, whose agent is `helper`; `replies` collects what the plugin hears. */
function callerBesideHelper(helper: unknown) {
  const store = new Store(":memory:");
  const project = join(scratch, `project-${crypto.randomUUID()}`);
  mkdirSync(project);
  const profile = { prelaunch: "", model: null, mode: null, bypassPermissions: false, askMode: "wait" as const, color: null, createdAt: 1 };
  store.saveProfile({ ...profile, id: "caller", name: "Caller", harness: "opencode", environment: "", effort: null });
  store.saveProfile({ ...profile, id: "helper", name: "Helper", harness: "opencode", environment: "", effort: null });
  store.insertWorkspace({ id: "w1", name: "p", path: project, defaultLaunch: { harness: "opencode", profileId: "caller" }, createdAt: 1 });
  const config = loadConfig({ MIRADOR_DATA_DIR: join(scratch, `data-${crypto.randomUUID()}`) });
  const notifier = { mute() {}, unmute() {} };
  const conversations = new ConversationService(store, new Hub(), config, notifier as never, {} as never, {} as never, new SystemNotifications(store, new Hub()));
  const agentProcesses = (conversations as unknown as { agentProcesses: Map<string, unknown> }).agentProcesses;
  agentProcesses.set("caller", callerAgent);
  agentProcesses.set("helper", helper);
  const replies: ConversationReply[] = [];
  const replied = Promise.withResolvers<void>();
  const hearReply: HearReply = (_started, _startedBy, reply) => {
    replies.push(reply);
    replied.resolve();
  };
  conversations.hearRepliesWith(hearReply, () => true);
  const caller = conversations.create("w1");
  return { conversations, store, callerId: caller.id, replies, replied: replied.promise };
}

test("stopping a conversation a plugin started cancels its turn, and the plugin hears it end as stopped", async () => {
  const { agent, prompted, cancels } = hangingAgent();
  const { conversations, callerId, replies, replied } = callerBesideHelper(agent);

  const started = conversations.startBeside(callerId, "board", "Helper", "Review the change");
  await prompted;

  await conversations.stopStarted(callerId, "board", started.id);

  expect(cancels()).toBe(1);
  await replied;
  expect(replies).toEqual([{ text: null, ended: "stopped" }]);
});

test("stopping a conversation before its first message reaches the agent cancels the turn once it does", async () => {
  const { agent, prompted, cancels } = hangingAgent();
  const { conversations, callerId, replies, replied } = callerBesideHelper(agent);

  const started = conversations.startBeside(callerId, "board", "Helper", "Review the change");
  await conversations.stopStarted(callerId, "board", started.id);
  expect(cancels()).toBe(0);

  await prompted;
  await replied;
  expect(cancels()).toBe(1);
  expect(replies).toEqual([{ text: null, ended: "stopped" }]);
});

test("stopping one another caller or another plugin started throws, and its turn goes on", async () => {
  const { agent, prompted, cancels } = hangingAgent();
  const { conversations, callerId, replies, replied } = callerBesideHelper(agent);

  const started = conversations.startBeside(callerId, "board", "Helper", "Review the change");
  await prompted;
  const otherCaller = conversations.create("w1");

  await expect(conversations.stopStarted(otherCaller.id, "board", started.id)).rejects.toThrow("wasn't started by the board plugin from this conversation");
  await expect(conversations.stopStarted(callerId, "other", started.id)).rejects.toThrow("wasn't started by the other plugin from this conversation");
  expect(cancels()).toBe(0);
  expect(await Promise.race([replied.then(() => true), Bun.sleep(50).then(() => false)]), "the turn goes on").toBe(false);

  await conversations.stopStarted(callerId, "board", started.id);
  expect(cancels()).toBe(1);
  await replied;
  expect(replies.map(({ ended }) => ended)).toEqual(["stopped"]);
});

test("stopping one whose turn already ended, or an unknown conversation, resolves without effect", async () => {
  const { agent, cancels } = quickAgent();
  const { conversations, callerId, replied } = callerBesideHelper(agent);

  const started = conversations.startBeside(callerId, "board", "Helper", "Review the change");
  await replied;

  await conversations.stopStarted(callerId, "board", started.id);
  await conversations.stopStarted(callerId, "board", "no-such-conversation");

  expect(cancels()).toBe(0);
});
