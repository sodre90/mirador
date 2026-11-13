import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionConfigOption } from "@agentclientprotocol/sdk/unstable";
import { loadConfig } from "../host/config.ts";
import { ConversationService } from "../host/conversations.ts";
import { Hub } from "../host/hub.ts";
import { SystemNotifications } from "../host/system-notifications.ts";
import { Store } from "../host/store.ts";

const scratch = mkdtempSync(join(tmpdir(), "profile-model-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** Claude Code's models and efforts as claude-agent-acp offers them: its Haiku offers no effort. */
function optionsOn(model: string, effort: string): SessionConfigOption[] {
  const models: SessionConfigOption = {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue: model,
    options: [
      { value: "default", name: "Default (recommended)", description: "Sonnet 5.5" },
      { value: "opus", name: "Opus 5.5" },
      { value: "sonnet", name: "Sonnet 5.5" },
      { value: "haiku", name: "Haiku 4.5" },
    ],
  };
  const efforts: SessionConfigOption = {
    id: "effort",
    name: "Effort",
    category: "thought_level",
    type: "select",
    currentValue: effort,
    options: ["low", "medium", "high"].map((value) => ({ value, name: value })),
  };
  return model === "haiku" ? [models] : [models, efforts];
}

/** An agent that writes down each option change it takes and the choices each message went out on. */
function agentStartingOn(model: string, effort: string) {
  const heard: string[] = [];
  let on = { model, effort };
  let sessions = 0;
  const agent = {
    spec: { id: "opencode", label: "opencode" },
    start: async () => ({}),
    newSession: async () => ({ sessionId: `session-${++sessions}`, configOptions: optionsOn(on.model, on.effort) }),
    setConfigOption: async (_sessionId: string, configId: string, value: string) => {
      on = configId === "model" ? { ...on, model: value } : { ...on, effort: value };
      heard.push(`set ${configId} to ${value}`);
      return { configOptions: optionsOn(on.model, on.effort) };
    },
    prompt: async () => {
      heard.push(`prompt on ${on.model}` + (on.model === "haiku" ? "" : ` at ${on.effort}`));
      return { stopReason: "end_turn" };
    },
    closeSession: async () => {},
  };
  return { agent, heard };
}

/** A workspace whose new conversations run on one profile, on `model` and `effort` where the profile names them. */
function hostOnProfile({ model = null, effort = null }: { model?: string | null; effort?: string | null } = {}) {
  const store = new Store(":memory:");
  const project = join(scratch, `project-${crypto.randomUUID()}`);
  mkdirSync(project);
  store.saveProfile({ id: "p1", name: "p", harness: "opencode", environment: "", prelaunch: "", model, mode: null, effort, bypassPermissions: false, askMode: "wait", color: null, pluginsOff: [], createdAt: 1 });
  store.insertWorkspace({ id: "w1", name: "p", path: project, defaultLaunch: { harness: "opencode", profileId: "p1" }, createdAt: 1 });
  const config = loadConfig({ MIRADOR_DATA_DIR: join(scratch, `data-${crypto.randomUUID()}`) });
  const { agent, heard } = agentStartingOn("default", "medium");
  const conversations = new ConversationService(store, new Hub(), config, {} as never, {} as never, {} as never, new SystemNotifications(store, new Hub()));
  (conversations as unknown as { agentProcesses: Map<string, unknown> }).agentProcesses.set("p1", agent);
  const conversation = conversations.create("w1", { harness: "opencode", profileId: "p1" });
  const problems = () => store.listEvents(conversation.id).flatMap(({ event }) => (event.type === "error" && event.problem ? [event.problem.code] : []));
  const asStartChoices = (choices: { model?: string }) => {
    (conversations as unknown as { runtime(id: string): { startChoices?: unknown } }).runtime(conversation.id).startChoices = choices;
  };
  return { conversations, heard, problems, asStartChoices, conversationId: conversation.id };
}

test("a conversation that starts on a profile naming a model takes it before its first message goes out", async () => {
  const { conversations, heard, conversationId } = hostOnProfile({ model: "opus" });

  await conversations.send(conversationId, "go");

  expect(heard).toEqual(["set model to opus", "prompt on opus at medium"]);
});

test("a profile that names no model leaves the conversation on the agent's own", async () => {
  const { conversations, heard, conversationId } = hostOnProfile();

  await conversations.send(conversationId, "go");

  expect(heard).toEqual(["prompt on default at medium"]);
});

test("the profile's effort is read after its model, so a model that offers no effort takes none", async () => {
  const { conversations, heard, conversationId } = hostOnProfile({ model: "haiku", effort: "high" });

  await conversations.send(conversationId, "go");

  expect(heard).toEqual(["set model to haiku", "prompt on haiku"]);
});

test("a model the agent does not offer leaves the conversation on its own and says why", async () => {
  const { conversations, heard, problems, conversationId } = hostOnProfile({ model: "gpt-9" });

  await conversations.send(conversationId, "go");

  expect(heard).toEqual(["prompt on default at medium"]);
  expect(problems()).toEqual(["could-not-set-option"]);
});

test("a model the profile named for its whole conversation goes under the one a plugin asked this one to start on", async () => {
  const { conversations, heard, asStartChoices, conversationId } = hostOnProfile({ model: "opus" });

  asStartChoices({ model: "sonnet" });
  await conversations.send(conversationId, "go");

  expect(heard).toEqual(["set model to opus", "set model to sonnet", "prompt on sonnet at medium"]);
});
