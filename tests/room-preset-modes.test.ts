import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionConfigOption } from "@agentclientprotocol/sdk/unstable";
import { loadConfig } from "../host/config.ts";
import { agentProcessKey, ConversationService } from "../host/conversations.ts";
import { Hub } from "../host/hub.ts";
import { SystemNotifications } from "../host/system-notifications.ts";
import { Store } from "../host/store.ts";
import { ALL_OF_CLAUDE_SETUP } from "../shared/room-agent-setup.ts";
import { allowsMode, askingModeOf, offeredConfigOption } from "../shared/room-permissions.ts";
import { NO_SANDBOX } from "../shared/sandbox.ts";

const scratch = mkdtempSync(join(tmpdir(), "room-preset-modes-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const CODEX_MODES = ["read-only", "agent", "workspace-write", "agent-full-access"];

const modesOn = (mode: string): SessionConfigOption[] => [
  { id: "mode", name: "Mode", category: "mode", type: "select", currentValue: mode, options: CODEX_MODES.map((value) => ({ value, name: value })) },
];

/** Codex, which starts each session in its agent mode unless its user's settings start it in another, and writes down the mode each message went out in. */
function codexAgent(opensIn = "agent") {
  const promptedIn: string[] = [];
  const modes = new Map<string, string>();
  let sessions = 0;
  const agent = {
    spec: { id: "codex", label: "Codex" },
    start: async () => ({}),
    newSession: async () => {
      const sessionId = `session-${++sessions}`;
      modes.set(sessionId, opensIn);
      return { sessionId, configOptions: modesOn(opensIn) };
    },
    setConfigOption: async (sessionId: string, _configId: string, value: string) => {
      modes.set(sessionId, value);
      return { configOptions: modesOn(value) };
    },
    prompt: async (sessionId: string) => {
      promptedIn.push(modes.get(sessionId)!);
      return { stopReason: "end_turn" };
    },
    cancel: async () => {},
    closeSession: async () => {},
  };
  return { agent, promptedIn };
}

async function until(condition: () => boolean, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("timed out waiting");
    await Bun.sleep(10);
  }
}

test("a room's agent runs in its preset's mode, not its profile's, ignores its profile's YOLO, and follows a changed preset at once", async () => {
  const store = new Store(":memory:");
  const project = join(scratch, `project-${crypto.randomUUID()}`);
  mkdirSync(project);
  store.saveProfile({ id: "p1", name: "p", harness: "codex", environment: "", prelaunch: "", model: null, mode: "agent-full-access", effort: null, bypassPermissions: true, askMode: "wait", color: null, pluginsOff: [], createdAt: 1 });
  store.insertWorkspace({ id: "w1", name: "p", path: project, defaultLaunch: { harness: "codex", profileId: "p1" }, createdAt: 1 });
  store.insertRoom({ id: "r1", name: "Room", workspaceId: "w1", agents: [{ profileId: "p1", conversationId: null, answering: null, model: null, effort: null, variables: {}, wholeHostEnvironment: false }], permissions: "read-freely", people: [], peoplesTasksWait: true, claudeSetup: ALL_OF_CLAUDE_SETUP, agentsReadGuests: true, membersBringAgents: true, sandbox: NO_SANDBOX, plugins: [], createdAt: 1 });
  const conversations = new ConversationService(store, new Hub(), loadConfig({ MIRADOR_DATA_DIR: join(scratch, `data-${crypto.randomUUID()}`) }), { mute() {}, unmute() {} } as never, {} as never, {} as never, new SystemNotifications(store, new Hub()));
  const { agent, promptedIn } = codexAgent();
  const inRoom = conversations.startInRoom("r1", "w1", { harness: "codex", profileId: "p1" }, "Room: p");
  (conversations as unknown as { agentProcesses: Map<string, unknown> }).agentProcesses.set(agentProcessKey(store.findProfile("p1")!, inRoom, false), agent);
  expect(conversations.get(inRoom.id).bypassPermissions).toBe(false);

  await conversations.send(inRoom.id, "first", []);
  await until(() => promptedIn.length === 1 && conversations.get(inRoom.id).status === "idle");
  store.setRoomPermissions("r1", "work-freely");
  await conversations.followRoomPreset(inRoom.id);
  await conversations.send(inRoom.id, "second", []);
  await until(() => promptedIn.length === 2);

  expect(promptedIn).toEqual(["read-only", "workspace-write"]);
});

const modelAndEffortOn = (model: string, effort: string): SessionConfigOption[] => [
  {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue: model,
    options: ["default", "opus", "haiku"].map((value) => ({ value, name: value })),
  },
  { id: "effort", name: "Effort", category: "thought_level", type: "select", currentValue: effort, options: ["low", "high"].map((value) => ({ value, name: value })) },
];

/** An agent with models and efforts, which writes down what each message went out on. */
function agentWithModels() {
  const promptedOn: string[] = [];
  const chosen = new Map<string, { model: string; effort: string }>();
  let sessions = 0;
  const optionsOf = (sessionId: string) => modelAndEffortOn(chosen.get(sessionId)!.model, chosen.get(sessionId)!.effort);
  const agent = {
    spec: { id: "codex", label: "Codex" },
    start: async () => ({}),
    newSession: async () => {
      const sessionId = `session-${++sessions}`;
      chosen.set(sessionId, { model: "default", effort: "low" });
      return { sessionId, configOptions: optionsOf(sessionId) };
    },
    setConfigOption: async (sessionId: string, configId: string, value: string) => {
      chosen.set(sessionId, { ...chosen.get(sessionId)!, [configId]: value });
      return { configOptions: optionsOf(sessionId) };
    },
    prompt: async (sessionId: string) => {
      promptedOn.push(`${chosen.get(sessionId)!.model} ${chosen.get(sessionId)!.effort}`);
      return { stopReason: "end_turn" };
    },
    cancel: async () => {},
    closeSession: async () => {},
  };
  return { agent, promptedOn };
}

test("a room's agent opens its session on the model and effort chosen for it in the room, over its profile's, and takes a new choice at once", async () => {
  const store = new Store(":memory:");
  const project = join(scratch, `project-${crypto.randomUUID()}`);
  mkdirSync(project);
  store.saveProfile({ id: "p1", name: "p", harness: "codex", environment: "", prelaunch: "", model: "haiku", mode: null, effort: null, bypassPermissions: false, askMode: "wait", color: null, pluginsOff: [], createdAt: 1 });
  store.insertWorkspace({ id: "w1", name: "p", path: project, defaultLaunch: { harness: "codex", profileId: "p1" }, createdAt: 1 });
  store.insertRoom({ id: "r1", name: "Room", workspaceId: "w1", agents: [{ profileId: "p1", conversationId: null, answering: null, model: "opus", effort: "high", variables: {}, wholeHostEnvironment: false }], permissions: "read-freely", people: [], peoplesTasksWait: true, claudeSetup: ALL_OF_CLAUDE_SETUP, agentsReadGuests: true, membersBringAgents: true, sandbox: NO_SANDBOX, plugins: [], createdAt: 1 });
  const conversations = new ConversationService(store, new Hub(), loadConfig({ MIRADOR_DATA_DIR: join(scratch, `data-${crypto.randomUUID()}`) }), { mute() {}, unmute() {} } as never, {} as never, {} as never, new SystemNotifications(store, new Hub()));
  const { agent, promptedOn } = agentWithModels();
  const inRoom = conversations.startInRoom("r1", "w1", { harness: "codex", profileId: "p1" }, "Room: p");
  (conversations as unknown as { agentProcesses: Map<string, unknown> }).agentProcesses.set(agentProcessKey(store.findProfile("p1")!, inRoom, false), agent);

  await conversations.send(inRoom.id, "first", []);
  await until(() => promptedOn.length === 1 && conversations.get(inRoom.id).status === "idle");
  store.setRoomAgentModel("r1", "p1", { model: "default", effort: "low" });
  await conversations.followRoomAgentModel(inRoom.id);
  await conversations.send(inRoom.id, "second", []);
  await until(() => promptedOn.length === 2);

  expect(promptedOn).toEqual(["opus high", "default low"]);
  expect(store.listEvents(inRoom.id).filter(({ event }) => event.type === "error")).toEqual([]);
});

test.each([
  { profile: "never asks", mode: "agent-full-access", opensIn: "agent", asksIn: "read-only" },
  { profile: "names no mode, while its user's settings start it in one that never asks", mode: null, opensIn: "agent-full-access", asksIn: "read-only" },
  { profile: "names no mode, while the agent's own default leaves the asking to itself", mode: null, opensIn: "agent", asksIn: "read-only" },
  { profile: "names a mode that still asks", mode: "workspace-write", opensIn: "agent-full-access", asksIn: "workspace-write" },
])("an agent brought into someone else's room, whose profile $profile, goes out in $asksIn and never on YOLO", async ({ mode, opensIn, asksIn }) => {
  const store = new Store(":memory:");
  const project = join(scratch, `project-${crypto.randomUUID()}`);
  mkdirSync(project);
  store.saveProfile({ id: "p1", name: "p", harness: "codex", environment: "", prelaunch: "", model: null, mode, effort: null, bypassPermissions: true, askMode: "wait", color: null, pluginsOff: [], createdAt: 1 });
  store.insertWorkspace({ id: "w1", name: "p", path: project, defaultLaunch: { harness: "codex", profileId: "p1" }, createdAt: 1 });
  const conversations = new ConversationService(store, new Hub(), loadConfig({ MIRADOR_DATA_DIR: join(scratch, `data-${crypto.randomUUID()}`) }), { mute() {}, unmute() {} } as never, {} as never, {} as never, new SystemNotifications(store, new Hub()));
  const { agent, promptedIn } = codexAgent(opensIn);
  const withSessions = conversations as unknown as { ensureSession: (id: string) => Promise<string> };
  const ensureSession = withSessions.ensureSession;
  withSessions.ensureSession = async () => "not-started";
  const brought = conversations.createBroughtIntoRoom("w1", { harness: "codex", profileId: "p1" }, "Garden · Ann's machine", false);
  withSessions.ensureSession = ensureSession;
  (conversations as unknown as { agentProcesses: Map<string, unknown> }).agentProcesses.set(agentProcessKey(store.findProfile("p1")!, brought, false), agent);
  expect(conversations.get(brought.id).bypassPermissions).toBe(false);
  expect(() => conversations.setBypassPermissions(brought.id, true)).toThrow();

  await conversations.send(brought.id, "first", []);
  await until(() => promptedIn.length === 1);

  expect(promptedIn).toEqual([asksIn]);
});

test("a profile's mode that still asks is kept for a brought agent; one that never asks, or none, gives way to the mode that asks", () => {
  expect(askingModeOf("claude", "acceptEdits")).toBe("acceptEdits");
  expect(askingModeOf("claude", "default")).toBe("default");
  expect(askingModeOf("claude", "bypassPermissions")).toBe("default");
  expect(askingModeOf("claude", null)).toBe("default");
  expect(askingModeOf("codex", "workspace-write")).toBe("workspace-write");
  expect(askingModeOf("codex", "agent-full-access")).toBe("read-only");
  expect(askingModeOf("opencode", "build")).toBe("build");
  expect(askingModeOf("opencode", null)).toBeUndefined();
});

test("a brought agent's conversation refuses switching to a mode that never asks, and its Mode picker leaves those modes out", async () => {
  const store = new Store(":memory:");
  const project = join(scratch, `project-${crypto.randomUUID()}`);
  mkdirSync(project);
  store.saveProfile({ id: "p1", name: "p", harness: "codex", environment: "", prelaunch: "", model: null, mode: null, effort: null, bypassPermissions: false, askMode: "wait", color: null, pluginsOff: [], createdAt: 1 });
  store.saveProfile({ id: "p2", name: "c", harness: "claude", environment: "", prelaunch: "", model: null, mode: null, effort: null, bypassPermissions: false, askMode: "wait", color: null, pluginsOff: [], createdAt: 1 });
  store.insertWorkspace({ id: "w1", name: "p", path: project, defaultLaunch: { harness: "codex", profileId: "p1" }, createdAt: 1 });
  const conversations = new ConversationService(store, new Hub(), loadConfig({ MIRADOR_DATA_DIR: join(scratch, `data-${crypto.randomUUID()}`) }), { mute() {}, unmute() {} } as never, {} as never, {} as never, new SystemNotifications(store, new Hub()));
  const { agent, promptedIn } = codexAgent("agent");
  const claude = codexAgent("default");
  const withSessions = conversations as unknown as { ensureSession: (id: string) => Promise<string> };
  const ensureSession = withSessions.ensureSession;
  withSessions.ensureSession = async () => "not-started";
  const brought = conversations.createBroughtIntoRoom("w1", { harness: "codex", profileId: "p1" }, "Garden · Ann's machine", false);
  const inRooms = conversations.createBroughtIntoRoom("w1", { harness: "claude", profileId: "p2" }, "Garden · Ann's machine", true);
  withSessions.ensureSession = ensureSession;
  const processes = (conversations as unknown as { agentProcesses: Map<string, unknown> }).agentProcesses;
  processes.set(agentProcessKey(store.findProfile("p1")!, brought, false), agent);
  processes.set(agentProcessKey(store.findProfile("p2")!, inRooms, false), claude.agent);

  await expect(conversations.setConfigOption(brought.id, "mode", "agent-full-access")).rejects.toThrow("A conversation that works for a room always asks.");
  await expect(conversations.setConfigOption(brought.id, "mode", "agent")).rejects.toThrow("A conversation that works for a room always asks.");
  await conversations.setConfigOption(brought.id, "mode", "workspace-write");
  await conversations.send(brought.id, "first", []);
  await until(() => promptedIn.length === 1);
  expect(promptedIn).toEqual(["workspace-write"]);

  await expect(conversations.setConfigOption(inRooms.id, "mode", "acceptEdits")).rejects.toThrow("A conversation that works for a room always asks.");
  await conversations.setConfigOption(inRooms.id, "mode", "default");

  const claudeModes: SessionConfigOption = {
    id: "mode",
    name: "Mode",
    category: "mode",
    type: "select",
    currentValue: "default",
    options: ["default", "acceptEdits", "plan", "dontAsk", "bypassPermissions"].map((value) => ({ value, name: value })),
  };
  const valuesOf = (option: SessionConfigOption) => (option.type === "select" ? option.options.map((entry) => ("value" in entry ? entry.value : "")) : []);
  expect(valuesOf(offeredConfigOption({ harness: "claude", broughtIntoRoom: true }, claudeModes))).toEqual(["default", "acceptEdits"]);
  expect(valuesOf(offeredConfigOption({ harness: "claude", broughtIntoRoom: true, worksInRoomsWorkspace: true }, claudeModes))).toEqual(["default"]);
  expect(valuesOf(offeredConfigOption({ harness: "claude" }, claudeModes))).toEqual(["default", "acceptEdits", "plan", "dontAsk", "bypassPermissions"]);
  expect(allowsMode({ harness: "claude", broughtIntoRoom: true, sideChatOf: "parent" }, "plan")).toBe(true);
  expect(allowsMode({ harness: "claude", broughtIntoRoom: true, sideChatOf: "parent" }, "bypassPermissions")).toBe(false);
  expect(valuesOf(offeredConfigOption({ harness: "claude", sideChatOf: "parent" }, { ...claudeModes, currentValue: "plan" })), "a side chat held to reading").toEqual(["plan"]);
  expect(valuesOf(offeredConfigOption({ harness: "claude", sideChatOf: "parent", sideChatMayChangeFiles: true }, claudeModes)), "a side chat that may change files").toEqual(["default", "acceptEdits", "plan", "dontAsk", "bypassPermissions"]);
});
