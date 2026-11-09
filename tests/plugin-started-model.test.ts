import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import { modelChoiceFor } from "../host/claude-transcript.ts";
import { loadConfig } from "../host/config.ts";
import { ConversationService, type HearReply } from "../host/conversations.ts";
import { Hub } from "../host/hub.ts";
import { SystemNotifications } from "../host/system-notifications.ts";
import { Store } from "../host/store.ts";
import type { ConversationReply } from "../shared/canvas-plugins.ts";
import { ranOnOf } from "../shared/config-options.ts";
import type { HarnessId } from "../shared/model.ts";

const scratch = mkdtempSync(join(tmpdir(), "plugin-started-model-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const EFFORTS = ["low", "medium", "high"];

/** Claude Code's options as claude-agent-acp offers them: its Haiku has no effort, and its default names the model it stands for. */
function claudeOptions(model: string, effort: string, defaultDescription = "Sonnet 5.5"): SessionConfigOption[] {
  const models: SessionConfigOption = {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue: model,
    options: [
      { value: "default", name: "Default (recommended)", description: defaultDescription },
      { value: "opus", name: "Opus 5.5", description: "Opus 5.5 · Best for everyday, complex tasks" },
      { value: "sonnet", name: "Sonnet 5.5", description: "Sonnet 5.5 · Efficient for routine tasks" },
      { value: "haiku", name: "Haiku 4.5", description: "Haiku 4.5 · Fastest for quick answers" },
    ],
  };
  const efforts: SessionConfigOption = { id: "effort", name: "Effort", category: "thought_level", type: "select", currentValue: effort, options: EFFORTS.map((value) => ({ value, name: value })) };
  return model === "haiku" ? [models] : [models, efforts];
}

test("a plugin's model is matched to the agent's models by id, alias or name, and to none it lacks", () => {
  const options = claudeOptions("default", "medium");
  expect(modelChoiceFor(options, "sonnet")).toBe("sonnet");
  expect(modelChoiceFor(options, "Sonnet 5.5")).toBe("sonnet");
  expect(modelChoiceFor(options, "claude-sonnet-5-5")).toBe("sonnet");
  expect(modelChoiceFor(options, "gpt-9")).toBeNull();
});

const withDefaultDescribed = (description: string) => claudeOptions("default", "low", description);

test("Claude Code's default reads as the model it stands for, named by another choice or by its id, else as the default", () => {
  expect(ranOnOf(withDefaultDescribed("Opus 5.5"), null)?.model).toEqual({ id: "opus", name: "Opus 5.5" });
  expect(ranOnOf(withDefaultDescribed("claude-opus-5-5"), null)?.model).toEqual({ id: "claude-opus-5-5", name: "Opus 5.5" });
  expect(ranOnOf(withDefaultDescribed("Whatever suits the task"), null)?.model).toEqual({ id: "default", name: "Default (recommended)" });
  expect(ranOnOf(withDefaultDescribed(""), null)?.model).toEqual({ id: "default", name: "Default (recommended)" });
});

test("what a conversation ran on is the model that answered, by the id the agent recorded, else the one chosen, with the effort chosen", () => {
  expect(ranOnOf(claudeOptions("opus", "high"), "claude-opus-5-5")).toEqual({ model: { id: "claude-opus-5-5", name: "Opus 5.5" }, effort: "high" });
  expect(ranOnOf(claudeOptions("opus", "high"), null)).toEqual({ model: { id: "opus", name: "Opus 5.5" }, effort: "high" });
  expect(ranOnOf(claudeOptions("default", "low"), null), "the model the default stands for").toEqual({ model: { id: "sonnet", name: "Sonnet 5.5" }, effort: "low" });
  expect(ranOnOf(claudeOptions("haiku", "high"), null), "a model with no effort").toEqual({ model: { id: "haiku", name: "Haiku 4.5" }, effort: null });
  expect(ranOnOf([], "my-local-model"), "an id that isn't Claude's keeps its name").toEqual({ model: { id: "my-local-model", name: "my-local-model" }, effort: null });
  expect(ranOnOf([], null), "an agent that names no model").toBeNull();
});

interface StubAgentOptions {
  harness?: HarnessId;
  /** The model a new session opens on. */
  onModel?: string;
  /** How many of its first sessions fail to open, once the first message waits for them. */
  failedOpens?: number;
  /** How its turns end. */
  stopReason?: "end_turn" | "cancelled";
  /** Holds the agent's answer to a model change until it settles. */
  modelChangeAnswered?: Promise<void>;
  /** Called with each session as the agent opens it. */
  opened?: (sessionId: string) => void;
  /** Called with each session as the agent takes a prompt in it. */
  prompted?: (sessionId: string) => void;
}

/** An agent offering Claude Code's models, which writes down the option changes it answers and the choices each prompt went out on. */
function stubAgent({
  harness = "opencode",
  onModel = "default",
  failedOpens = 0,
  stopReason = "end_turn",
  modelChangeAnswered = Promise.resolve(),
  opened = () => {},
  prompted = () => {},
}: StubAgentOptions = {}) {
  const heard: string[] = [];
  let sessions = 0;
  let opens = 0;
  let model = onModel;
  let effort = "medium";
  const agent = {
    spec: { id: harness, label: harness },
    start: async () => ({}),
    newSession: async () => {
      if (++opens <= failedOpens) {
        await Bun.sleep(50);
        throw new Error("The agent couldn't open a session.");
      }
      const sessionId = `session-${++sessions}`;
      opened(sessionId);
      return { sessionId, configOptions: claudeOptions(model, effort) };
    },
    setConfigOption: async (_sessionId: string, configId: string, value: string) => {
      if (configId === "model") await modelChangeAnswered;
      if (configId === "model") model = value;
      else effort = value;
      heard.push(`set ${configId} to ${value}`);
      return { configOptions: claudeOptions(model, effort) };
    },
    prompt: async (sessionId: string) => {
      heard.push(model === "haiku" ? `prompt on ${model}` : `prompt on ${model} at ${effort}`);
      prompted(sessionId);
      return { stopReason };
    },
    closeSession: async () => {},
  };
  return { agent, heard };
}

const callerAgent = {
  spec: { id: "opencode", label: "opencode" },
  start: async () => ({}),
  newSession: async () => ({ sessionId: "caller-session" }),
  prompt: async () => ({ stopReason: "end_turn" }),
  closeSession: async () => {},
};

interface HostOptions {
  helper: unknown;
  harness?: HarnessId;
  environment?: string;
  profileEffort?: string | null;
  hostEnvironment?: Record<string, string>;
}

/** A caller whose plugin starts conversations on the Helper profile, whose agent is `helper`; `replies` collects what the plugin hears. */
function callerBesideHelper({ helper, harness = "opencode", environment = "", profileEffort = null, hostEnvironment = {} }: HostOptions) {
  const store = new Store(":memory:");
  const project = join(scratch, `project-${crypto.randomUUID()}`);
  mkdirSync(project);
  const profile = { prelaunch: "", mode: null, bypassPermissions: false, askMode: "wait" as const, color: null, createdAt: 1 };
  store.saveProfile({ ...profile, id: "caller", name: "Caller", harness: "opencode", environment: "", effort: null });
  store.saveProfile({ ...profile, id: "helper", name: "Helper", harness, environment, effort: profileEffort });
  store.insertWorkspace({ id: "w1", name: "p", path: project, defaultLaunch: { harness: "opencode", profileId: "caller" }, createdAt: 1 });
  const config = loadConfig({ MIRADOR_DATA_DIR: join(scratch, `data-${crypto.randomUUID()}`), ...hostEnvironment });
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
  (conversations as unknown as { hearReply: HearReply }).hearReply = hearReply;
  const caller = conversations.create("w1");
  const slowToAnswer = (conversations as unknown as { sessionsSlowToAnswer: Set<string> }).sessionsSlowToAnswer;
  return { conversations, store, callerId: caller.id, replies, replied: replied.promise, slowToAnswer };
}

/** What the agent sends the host about a session as a turn runs. */
const sendUpdate = (conversations: ConversationService, sessionId: string, update: unknown) =>
  (conversations as unknown as { handleSessionUpdate(notification: unknown): void }).handleSessionUpdate({ sessionId, update });

const problemsOf = (store: Store, conversationId: string) =>
  store.listEvents(conversationId).flatMap(({ event }) => (event.type === "error" && event.problem ? [event.problem] : []));

test("a plugin's model is set first, then the profile's effort and the plugin's over it, before the first message goes out", async () => {
  const prompted = Promise.withResolvers<void>();
  const { agent, heard } = stubAgent({ prompted: () => prompted.resolve() });
  const { conversations, callerId, replies, replied } = callerBesideHelper({ helper: agent, profileEffort: "low" });

  conversations.startBeside(callerId, "board", "Helper", "Review the change", undefined, { model: "opus", effort: "high" });

  await prompted.promise;
  expect(heard).toEqual(["set model to opus", "set effort to low", "set effort to high", "prompt on opus at high"]);
  await replied;
  expect(replies[0]?.ranOn).toEqual({ model: { id: "opus", name: "Opus 5.5" }, effort: "high" });
});

test("the profile's effort applies to the plugin's model, even when the agent's default model had no effort", async () => {
  const prompted = Promise.withResolvers<void>();
  const { agent, heard } = stubAgent({ onModel: "haiku", prompted: () => prompted.resolve() });
  const { conversations, callerId } = callerBesideHelper({ helper: agent, profileEffort: "high" });

  conversations.startBeside(callerId, "board", "Helper", "Review the change", undefined, { model: "opus" });

  await prompted.promise;
  expect(heard).toEqual(["set model to opus", "set effort to high", "prompt on opus at high"]);
});

test("the first message waits for a plugin's model while the agent takes to answer, where other changes stop waiting", async () => {
  const answerModelChange = Promise.withResolvers<void>();
  const prompted = Promise.withResolvers<void>();
  let slowToAnswer = new Set<string>();
  const { agent, heard } = stubAgent({ modelChangeAnswered: answerModelChange.promise, opened: (sessionId) => slowToAnswer.add(sessionId), prompted: () => prompted.resolve() });
  const host = callerBesideHelper({ helper: agent });
  slowToAnswer = host.slowToAnswer;

  host.conversations.startBeside(host.callerId, "board", "Helper", "Review the change", undefined, { model: "opus" });

  await Bun.sleep(100);
  expect(heard, "nothing went out on the agent's default model").toEqual([]);
  answerModelChange.resolve();
  await prompted.promise;
  expect(heard).toEqual(["set model to opus", "prompt on opus at medium"]);
});

test("the user's own conversation doesn't wait for a change its agent is slow to answer, as before", async () => {
  const answerModelChange = Promise.withResolvers<void>();
  const prompted = Promise.withResolvers<void>();
  let slowToAnswer = new Set<string>();
  const { agent, heard } = stubAgent({ modelChangeAnswered: answerModelChange.promise, opened: (sessionId) => slowToAnswer.add(sessionId), prompted: () => prompted.resolve() });
  const host = callerBesideHelper({ helper: agent, hostEnvironment: { MIRADOR_TEST_MODEL: "opus" }, harness: "claude" });
  slowToAnswer = host.slowToAnswer;

  host.conversations.create("w1", { harness: "claude", profileId: "helper" }, "Review the change");

  await prompted.promise;
  expect(heard).toEqual(["prompt on default at medium"]);
  answerModelChange.resolve();
});

test("an agent that never answers a plugin's choice holds the first message back for a while, then the conversation says so and goes on", async () => {
  const prompted = Promise.withResolvers<void>();
  const { agent, heard } = stubAgent({ modelChangeAnswered: new Promise<void>(() => {}), prompted: () => prompted.resolve() });
  const { conversations, store, callerId } = callerBesideHelper({ helper: agent });
  (conversations as unknown as { startChoicesTimeoutMs: number }).startChoicesTimeoutMs = 50;

  const started = conversations.startBeside(callerId, "board", "Helper", "Review the change", undefined, { model: "opus", effort: "high" });

  await prompted.promise;
  expect(heard, "the effort, asked for past the wait, held nothing back").toEqual(["set effort to high", "prompt on default at high"]);
  expect(problemsOf(store, started.id)).toMatchObject([{ code: "option-change-unanswered", option: "Model", current: "default", value: "opus" }]);
});

test("on a test host's own Claude Code, a plugin's model and effort win over the test model and effort", async () => {
  const prompted = Promise.withResolvers<void>();
  const { agent, heard } = stubAgent({ harness: "claude", prompted: () => prompted.resolve() });
  const { conversations, callerId } = callerBesideHelper({ helper: agent, harness: "claude", hostEnvironment: { MIRADOR_TEST_MODEL: "haiku", MIRADOR_TEST_EFFORT: "low" } });

  conversations.startBeside(callerId, "board", "Helper", "Review the change", undefined, { model: "sonnet", effort: "high" });

  await prompted.promise;
  expect(heard).toEqual(["set model to haiku", "set model to sonnet", "set effort to low", "set effort to high", "prompt on sonnet at high"]);
});

test("a plugin's model and effort hold for the session that opens after a failed open", async () => {
  const prompted = Promise.withResolvers<void>();
  const { agent, heard } = stubAgent({ failedOpens: 1, prompted: () => prompted.resolve() });
  const { conversations, callerId, replies, replied } = callerBesideHelper({ helper: agent });

  const started = conversations.startBeside(callerId, "board", "Helper", "Review the change", undefined, { model: "opus", effort: "high" });
  await replied;
  expect(replies[0], "the open that failed ran on no model").toEqual({ text: null, ended: "failed" });

  await conversations.prompt(started.id, "Try again");
  await prompted.promise;
  expect(heard).toEqual(["set model to opus", "set effort to high", "prompt on opus at high"]);
});

test("a model the agent doesn't offer leaves its own, says so in the conversation, and the first message goes out all the same", async () => {
  const prompted = Promise.withResolvers<void>();
  const { agent, heard } = stubAgent({ prompted: () => prompted.resolve() });
  const { conversations, store, callerId, replies, replied } = callerBesideHelper({ helper: agent });

  const started = conversations.startBeside(callerId, "board", "Helper", "Review the change", undefined, { model: "gpt-9", effort: "high" });

  await prompted.promise;
  expect(heard).toEqual(["set effort to high", "prompt on default at high"]);
  expect(problemsOf(store, started.id)).toEqual([
    { code: "could-not-set-option", option: "Model", value: "gpt-9", cause: "gpt-9 is not one of the choices of Model.", causeProblem: { code: "not-a-setting-choice", value: "gpt-9", setting: "Model" } },
  ]);
  await replied;
  expect(replies[0]?.ranOn, "the plugin hears what it ran on instead").toEqual({ model: { id: "sonnet", name: "Sonnet 5.5" }, effort: "high" });
});

test("an effort the model doesn't offer says so, and one for a model with no effort is skipped", async () => {
  const unknownPrompted = Promise.withResolvers<void>();
  const unknown = stubAgent({ prompted: () => unknownPrompted.resolve() });
  const withUnknownEffort = callerBesideHelper({ helper: unknown.agent });
  const startedWithUnknownEffort = withUnknownEffort.conversations.startBeside(withUnknownEffort.callerId, "board", "Helper", "Review", undefined, { effort: "extreme" });
  await unknownPrompted.promise;
  expect(unknown.heard).toEqual(["prompt on default at medium"]);
  expect(problemsOf(withUnknownEffort.store, startedWithUnknownEffort.id)).toMatchObject([{ code: "could-not-set-option", option: "Effort", value: "extreme" }]);

  const haikuPrompted = Promise.withResolvers<void>();
  const haiku = stubAgent({ prompted: () => haikuPrompted.resolve() });
  const onHaiku = callerBesideHelper({ helper: haiku.agent });
  const startedOnHaiku = onHaiku.conversations.startBeside(onHaiku.callerId, "board", "Helper", "Review", undefined, { model: "haiku", effort: "high" });
  await haikuPrompted.promise;
  expect(haiku.heard).toEqual(["set model to haiku", "prompt on haiku"]);
  expect(problemsOf(onHaiku.store, startedOnHaiku.id)).toEqual([]);
  await onHaiku.replied;
  expect(onHaiku.replies[0]?.ranOn).toEqual({ model: { id: "haiku", name: "Haiku 4.5" }, effort: null });
});

test("a Claude Code conversation's reply names the model that answered in its transcript", async () => {
  const claudeConfigDir = join(scratch, `claude-${crypto.randomUUID()}`);
  const answeredIn = (sessionId: string) => {
    mkdirSync(join(claudeConfigDir, "projects", "p"), { recursive: true });
    const answer = { type: "assistant", message: { role: "assistant", model: "claude-opus-5-5", content: [] } };
    writeFileSync(join(claudeConfigDir, "projects", "p", `${sessionId}.jsonl`), `${JSON.stringify(answer)}\n`);
  };
  const { agent } = stubAgent({ harness: "claude", prompted: answeredIn });
  const { conversations, callerId, replies, replied } = callerBesideHelper({ helper: agent, harness: "claude", environment: `CLAUDE_CONFIG_DIR=${claudeConfigDir}` });

  conversations.startBeside(callerId, "board", "Helper", "Review the change", undefined, { model: "opus", effort: "high" });

  await replied;
  expect(replies[0]).toEqual({ text: null, ended: "finished", ranOn: { model: { id: "claude-opus-5-5", name: "Opus 5.5" }, effort: "high" } });
});

test("a reply from an agent that names no model carries no ranOn", async () => {
  const { conversations, callerId, replies, replied } = callerBesideHelper({ helper: { ...callerAgent, newSession: async () => ({ sessionId: "plain-session" }) } });

  conversations.startBeside(callerId, "board", "Helper", "Review the change", undefined, { model: "opus" });

  await replied;
  expect(replies).toEqual([{ text: null, ended: "finished" }]);
  expect(replies[0]).not.toHaveProperty("ranOn");
});

test("a Claude Code conversation's reply names the model its usage updates named, with no transcript to read", async () => {
  let conversations: ConversationService | undefined;
  const { agent } = stubAgent({
    harness: "claude",
    prompted: (sessionId) => sendUpdate(conversations!, sessionId, { sessionUpdate: "usage_update", used: 1, size: 2, _meta: { "_claude/model": "claude-opus-5-5" } }),
  });
  const host = callerBesideHelper({ helper: agent, harness: "claude", environment: `CLAUDE_CONFIG_DIR=${join(scratch, "no-transcripts")}` });
  conversations = host.conversations;

  conversations.startBeside(host.callerId, "board", "Helper", "Review the change", undefined, { model: "opus", effort: "high" });

  await host.replied;
  expect(host.replies[0]?.ranOn).toEqual({ model: { id: "claude-opus-5-5", name: "Opus 5.5" }, effort: "high" });
});

test("a turn stopped before the agent answered anything ran on no model", async () => {
  const { agent } = stubAgent({ stopReason: "cancelled" });
  const { conversations, callerId, replies, replied } = callerBesideHelper({ helper: agent });

  conversations.startBeside(callerId, "board", "Helper", "Review the change", undefined, { model: "opus" });

  await replied;
  expect(replies).toEqual([{ text: null, ended: "stopped" }]);
});

test("a turn that failed before the agent answered anything ran on no model; one that failed after it had, did", async () => {
  const before = stubAgent({
    prompted: () => {
      throw new Error("The model server went away.");
    },
  });
  const failedBefore = callerBesideHelper({ helper: before.agent });
  failedBefore.conversations.startBeside(failedBefore.callerId, "board", "Helper", "Review the change", undefined, { model: "opus" });
  await failedBefore.replied;
  expect(failedBefore.replies).toEqual([{ text: null, ended: "failed" }]);

  let conversations: ConversationService | undefined;
  const after = stubAgent({
    prompted: (sessionId) => {
      sendUpdate(conversations!, sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Reading the change." } });
      throw new Error("The model server went away.");
    },
  });
  const failedAfter = callerBesideHelper({ helper: after.agent });
  conversations = failedAfter.conversations;
  conversations.startBeside(failedAfter.callerId, "board", "Helper", "Review the change", undefined, { model: "opus" });
  await failedAfter.replied;
  expect(failedAfter.replies[0]).toMatchObject({ ended: "failed", ranOn: { model: { id: "opus", name: "Opus 5.5" }, effort: "medium" } });
});
