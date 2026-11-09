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

/** Claude Code's options as claude-agent-acp offers them: its Haiku has no effort. */
function claudeOptions(model: string, effort: string): SessionConfigOption[] {
  const models: SessionConfigOption = {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue: model,
    options: [
      { value: "default", name: "Default (recommended)", description: "Sonnet 5.5" },
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

test("what a conversation ran on is the model that answered, by the id the agent recorded, else the one chosen, with the effort chosen", () => {
  expect(ranOnOf(claudeOptions("opus", "high"), "claude-opus-5-5")).toEqual({ model: { id: "claude-opus-5-5", name: "Opus 5.5" }, effort: "high" });
  expect(ranOnOf(claudeOptions("opus", "high"), null)).toEqual({ model: { id: "opus", name: "Opus 5.5" }, effort: "high" });
  expect(ranOnOf(claudeOptions("default", "low"), null), "the header's own name for the default").toEqual({ model: { id: "default", name: "Default (recommended)" }, effort: "low" });
  expect(ranOnOf(claudeOptions("haiku", "high"), null), "a model with no effort").toEqual({ model: { id: "haiku", name: "Haiku 4.5" }, effort: null });
  expect(ranOnOf([], "my-local-model"), "an id that isn't Claude's keeps its name").toEqual({ model: { id: "my-local-model", name: "my-local-model" }, effort: null });
  expect(ranOnOf([], null), "an agent that names no model").toBeNull();
});

interface StubAgentOptions {
  harness?: HarnessId;
  /** Holds the agent's answer to a model change until it settles. */
  modelChangeAnswered?: Promise<void>;
  /** Called with each session as the agent opens it. */
  opened?: (sessionId: string) => void;
  /** Called with each session as the agent takes a prompt in it. */
  prompted?: (sessionId: string) => void;
}

/** An agent offering Claude Code's models, which writes down the option changes it answers and the choices each prompt went out on. */
function stubAgent({ harness = "opencode", modelChangeAnswered = Promise.resolve(), opened = () => {}, prompted = () => {} }: StubAgentOptions = {}) {
  const heard: string[] = [];
  let sessions = 0;
  let model = "default";
  let effort = "medium";
  const agent = {
    spec: { id: harness, label: harness },
    start: async () => ({}),
    newSession: async () => {
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
      return { stopReason: "end_turn" };
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

const problemsOf = (store: Store, conversationId: string) =>
  store.listEvents(conversationId).flatMap(({ event }) => (event.type === "error" && event.problem ? [event.problem] : []));

test("a plugin's model and effort are set, the model first, before the first message goes out, over the profile's effort", async () => {
  const prompted = Promise.withResolvers<void>();
  const { agent, heard } = stubAgent({ prompted: () => prompted.resolve() });
  const { conversations, callerId, replies, replied } = callerBesideHelper({ helper: agent, profileEffort: "low" });

  conversations.startBeside(callerId, "board", "Helper", "Review the change", undefined, { model: "opus", effort: "high" });

  await prompted.promise;
  expect(heard).toEqual(["set effort to low", "set model to opus", "set effort to high", "prompt on opus at high"]);
  await replied;
  expect(replies[0]?.ranOn).toEqual({ model: { id: "opus", name: "Opus 5.5" }, effort: "high" });
});

test("the first message waits for a plugin's model however long the agent takes to answer, where other changes stop waiting", async () => {
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

test("on a test host's own Claude Code, a plugin's model and effort win over the test model and effort", async () => {
  const prompted = Promise.withResolvers<void>();
  const { agent, heard } = stubAgent({ harness: "claude", prompted: () => prompted.resolve() });
  const { conversations, callerId } = callerBesideHelper({ helper: agent, harness: "claude", hostEnvironment: { MIRADOR_TEST_MODEL: "haiku", MIRADOR_TEST_EFFORT: "low" } });

  conversations.startBeside(callerId, "board", "Helper", "Review the change", undefined, { model: "sonnet", effort: "high" });

  await prompted.promise;
  expect(heard).toEqual(["set model to haiku", "set model to sonnet", "set effort to high", "prompt on sonnet at high"]);
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
  expect(replies[0]?.ranOn, "the plugin hears what it ran on instead").toEqual({ model: { id: "default", name: "Default (recommended)" }, effort: "high" });
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
