import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../host/config.ts";
import { agentProcessKey, ConversationService } from "../host/conversations.ts";
import { Hub } from "../host/hub.ts";
import { AppleContainer } from "../host/sandbox/apple-container.ts";
import { NO_SANDBOXES, Sandboxes } from "../host/sandbox/sandboxes.ts";
import { HostProblemError } from "../shared/host-problems.ts";
import { Store } from "../host/store.ts";
import { SystemNotifications } from "../host/system-notifications.ts";
import { ALL_OF_CLAUDE_SETUP } from "../shared/room-agent-setup.ts";
import { DEFAULT_PERMISSION_PRESET } from "../shared/room-permissions.ts";
import { NO_SANDBOX, type SandboxSetting } from "../shared/sandbox.ts";
import { agentWithModes } from "./agent-with-modes.ts";
import { FakeContainerCli } from "./fake-container-cli.ts";
import { FakeVmLauncher } from "./fake-vm-launcher.ts";
import { prepareProgramsLeavingAMark, programLeavingAMark } from "./program-leaving-a-mark.ts";

setDefaultTimeout(20_000);

const scratch = mkdtempSync(join(tmpdir(), "sandboxed-room-turns-"));
const sandboxesMade: Sandboxes[] = [];
beforeAll(() => prepareProgramsLeavingAMark(scratch), 120_000);
afterAll(async () => {
  await Promise.all(sandboxesMade.map((sandboxes) => sandboxes.stopAll()));
  rmSync(scratch, { recursive: true, force: true });
});

/** Sandboxes whose VMs and socket folders go once the tests are done, so none is left in the temporary folder. */
function stoppedAfterAll(sandboxes: Sandboxes) {
  sandboxesMade.push(sandboxes);
  return sandboxes;
}

/** Claude Code as this computer runs it. */
const claudeCodeLeavingAMark = () => programLeavingAMark(scratch, "claude", "2.1.330 (Claude Code)");

function sandboxedRoom(sandbox: SandboxSetting) {
  const claude = claudeCodeLeavingAMark();
  const project = join(scratch, `project-${crypto.randomUUID()}`);
  mkdirSync(project);
  Bun.spawnSync(["git", "init", "-q", project]);
  const store = new Store(":memory:");
  const environment = `ANTHROPIC_API_KEY=sk-ant-kept-on-this-mac\nCLAUDE_CODE_EXECUTABLE=${claude.program}`;
  store.saveProfile({ id: "builder", name: "Builder", harness: "claude", environment, prelaunch: "", model: null, mode: null, effort: null, bypassPermissions: false, askMode: "wait", color: null, pluginsOff: [], createdAt: 1 });
  const launch = { harness: "claude" as const, profileId: "builder" };
  store.insertWorkspace({ id: "w1", name: "project", path: project, defaultLaunch: launch, createdAt: 1 });
  store.insertRoom({ id: "r1", name: "Launch", workspaceId: "w1", agents: [], people: [], permissions: DEFAULT_PERMISSION_PRESET, peoplesTasksWait: true, claudeSetup: ALL_OF_CLAUDE_SETUP, agentsReadGuests: true, membersBringAgents: true, sandbox, plugins: [], createdAt: 1 });
  const config = loadConfig({ MIRADOR_DATA_DIR: join(scratch, `data-${crypto.randomUUID()}`) });
  const conversations = new ConversationService(store, new Hub(), config, { mute: () => {} } as never, {} as never, {} as never, new SystemNotifications(store, new Hub()));
  const conversation = conversations.startInRoom("r1", "w1", launch, "Launch: Builder");
  const turnFailure = () => store.listEvents(conversation.id).findLast(({ event }) => event.type === "error" && event.endsTurn)?.event;
  const sandboxHost = { dataDir: config.dataDir, workspaceOf: () => realpathSync.native(project), canvasOf: () => ({ belongs: () => false, tokenOf: () => "", handle: () => new Response() }), atWork: () => ({ agents: [], conversationIds: [] }), setupChanged: () => {}, baseImageOf: () => null, heldChanged: () => {}, foldersOf: () => [], networkOf: () => "closed" as const, otherSandboxes: () => ({ workspaces: [], writableFolders: [], writableFoldersOn: [], foldersLeft: [] }), agentsVmChanged: () => {}, runtimeChanged: () => {}, places: { home: "/nonexistent-home", dataDir: config.dataDir, checkout: "/nonexistent-checkout", computersOwn: [] } };
  return { store, config, conversations, conversation, claude, turnFailure, project, sandboxHost };
}

const SANDBOX_ON: SandboxSetting = { on: true, workFreely: true, allowsSharedKernel: false, network: "closed", baseImage: null };

test("a sandboxed room's agent whose sandbox can't be set up fails its turn, and never runs on this computer", async () => {
  const { conversations, conversation, claude, turnFailure, project, config } = sandboxedRoom(SANDBOX_ON);
  const cli = new FakeContainerCli();
  cli.failing = ([command, sub]) => (command === "system" && sub === "start" ? "kernel download failed" : null);
  const host = { dataDir: config.dataDir, workspaceOf: () => project, canvasOf: () => ({ belongs: () => false, tokenOf: () => "", handle: () => new Response() }), atWork: () => ({ agents: [], conversationIds: [] }), setupChanged: () => {}, baseImageOf: () => null, heldChanged: () => {}, foldersOf: () => [], networkOf: () => "closed" as const, otherSandboxes: () => ({ workspaces: [], writableFolders: [], writableFoldersOn: [], foldersLeft: [] }), agentsVmChanged: () => {}, runtimeChanged: () => {}, places: { home: "/nonexistent-home", dataDir: config.dataDir, checkout: "/nonexistent-checkout", computersOwn: [] } };
  conversations.startsSandboxedAgentsIn(stoppedAfterAll(new Sandboxes(new AppleContainer(cli, { available: true, kind: "apple-container" }), host)));

  await conversations.send(conversation.id, "go");

  expect(turnFailure()).toMatchObject({ problem: { code: "sandbox-not-ready", why: { kind: "setup-failed" } } });
  expect(claude.ranHere()).toBe(false);
  expect(cli.callsOf("exec")).toEqual([]);
  await conversations.shutdown();
});

test("a sandboxed room's agent fails its turn while the host has no sandboxes to give it", async () => {
  const { conversations, conversation, claude, turnFailure } = sandboxedRoom(SANDBOX_ON);
  await conversations.send(conversation.id, "go");
  expect(turnFailure()).toMatchObject({ problem: { code: "sandbox-not-ready", why: { kind: "unavailable", why: "turned-off" } } });
  expect(claude.ranHere()).toBe(false);
  await conversations.shutdown();
});

test("a room without a sandbox runs its agent on this computer, as it always did", async () => {
  const { conversations, conversation, claude, turnFailure } = sandboxedRoom(NO_SANDBOX);
  await conversations.send(conversation.id, "go");
  expect(turnFailure()).toBeDefined();
  expect(claude.ranHere()).toBe(true);
  await conversations.shutdown();
});

test("a sandboxed room's agent whose image isn't ready fails its turn, and never runs on this computer", async () => {
  const { conversations, conversation, claude, turnFailure, sandboxHost } = sandboxedRoom(SANDBOX_ON);
  const launcher = new FakeVmLauncher();
  launcher.prepareFails = "the image did not build";
  conversations.startsSandboxedAgentsIn(stoppedAfterAll(new Sandboxes(launcher, sandboxHost)));

  await conversations.send(conversation.id, "go");

  expect(turnFailure()).toMatchObject({ problem: { code: "sandbox-not-ready", why: { kind: "setup-failed", cause: "the image did not build" } } });
  expect(claude.ranHere()).toBe(false);
  expect(launcher.started).toEqual([]);
  expect(launcher.agents).toEqual([]);
  await conversations.shutdown();
});

test("where this computer's sandbox shares its kernel, a room's agent starts in it only once the room allowed that, and never on this computer", async () => {
  const { store, conversations, conversation, claude, turnFailure, sandboxHost } = sandboxedRoom(SANDBOX_ON);
  const launcher = new FakeVmLauncher();
  launcher.available = { available: true, kind: "podman", selinuxEnforcing: false };
  conversations.startsSandboxedAgentsIn(stoppedAfterAll(new Sandboxes(launcher, sandboxHost)));

  await conversations.send(conversation.id, "go");

  expect(turnFailure()).toMatchObject({ problem: { code: "sandbox-not-ready", why: { kind: "shared-kernel-not-allowed" } } });
  expect(launcher.started).toEqual([]);

  store.setRoomSandbox("r1", { ...SANDBOX_ON, allowsSharedKernel: true });
  await conversations.send(conversation.id, "go again");

  expect(launcher.agents).toHaveLength(1);
  expect(claude.ranHere()).toBe(false);
  await conversations.shutdown();
});

test("a sandboxed room's agent whose VM doesn't start fails its turn, and never runs on this computer", async () => {
  const { conversations, conversation, claude, turnFailure, sandboxHost } = sandboxedRoom(SANDBOX_ON);
  const launcher = new FakeVmLauncher();
  launcher.startFails = "not enough memory";
  conversations.startsSandboxedAgentsIn(stoppedAfterAll(new Sandboxes(launcher, sandboxHost)));

  await conversations.send(conversation.id, "go");

  expect(turnFailure()).toMatchObject({ problem: { code: "sandbox-not-ready", why: { kind: "could-not-start", cause: "not enough memory" } } });
  expect(claude.ranHere()).toBe(false);
  expect(launcher.agents).toEqual([]);
  await conversations.shutdown();
});

test("an agent process started on this computer is not taken up again once its room is sandboxed", async () => {
  const { store, conversations, conversation, claude, turnFailure, sandboxHost } = sandboxedRoom(NO_SANDBOX);
  const launcher = new FakeVmLauncher();
  launcher.startFails = "not enough memory";
  conversations.startsSandboxedAgentsIn(stoppedAfterAll(new Sandboxes(launcher, sandboxHost)));
  await conversations.send(conversation.id, "go");
  expect(claude.ranHere()).toBe(true);

  store.setRoomSandbox("r1", SANDBOX_ON);
  await conversations.send(conversation.id, "go again");

  expect(turnFailure()).toMatchObject({ problem: { code: "sandbox-not-ready", why: { kind: "could-not-start", cause: "not enough memory" } } });
  await conversations.shutdown();
});

test("a room's agent whose room is gone fails its turn, and never runs on this computer", async () => {
  const { store, conversations, conversation, claude, turnFailure, sandboxHost } = sandboxedRoom(SANDBOX_ON);
  conversations.startsSandboxedAgentsIn(stoppedAfterAll(new Sandboxes(new FakeVmLauncher(), sandboxHost)));
  store.deleteRoom("r1");

  await conversations.send(conversation.id, "go");

  expect(turnFailure()).toMatchObject({ problem: { code: "room-gone" } });
  expect(claude.ranHere()).toBe(false);
  await conversations.shutdown();
});

test("a sandboxed room's conversation has no side chat and runs no ! command, as both would run on this computer", async () => {
  const { store, conversations, conversation, claude } = sandboxedRoom(SANDBOX_ON);
  expect(() => conversations.startSideChat(conversation.id, "why?")).toThrow(expect.objectContaining({ problem: { code: "sandboxed-room-side-chat" } }));
  await expect(conversations.runCommand(conversation.id, "touch ran")).rejects.toMatchObject({ problem: { code: "sandboxed-room-command" } });
  expect(store.listConversations().filter(({ sideChatOf }) => sideChatOf)).toEqual([]);
  expect(claude.ranHere()).toBe(false);
  await conversations.shutdown();
});

test("an agent session on this computer does not start in a folder where a sandboxed room's agents left a held file that stays", async () => {
  const { conversations, store } = sandboxedRoom(NO_SANDBOX);
  const settled: string[] = [];
  conversations.startsSandboxedAgentsIn({
    ...NO_SANDBOXES,
    settleHeldFilesFor: async (directory) => {
      settled.push(directory);
      throw new HostProblemError({ code: "sandbox-held-files-unsettled" });
    },
  });
  const onThisMac = conversations.create("w1", { harness: "claude", profileId: "builder" });

  await conversations.send(onThisMac.id, "go");

  const failure = store.listEvents(onThisMac.id).findLast(({ event }) => event.type === "error")?.event;
  expect(failure).toMatchObject({ problem: { code: "sandbox-held-files-unsettled" } });
  expect(new Set(settled)).toEqual(new Set([realpathSync.native(store.findWorkspace("w1")!.path)]));
  expect(store.findConversation(onThisMac.id)?.acpSessionId).toBeNull();
  await conversations.shutdown();
});

test("putting a conversation's files back stops the VMs of rooms working in its folder first, so none races the restore", async () => {
  const { store, conversations } = sandboxedRoom(NO_SANDBOX);
  const stopped: string[] = [];
  conversations.startsSandboxedAgentsIn({ ...NO_SANDBOXES, settleHeldFilesFor: async () => {}, stopSandboxesWorkingIn: async (directory) => void stopped.push(directory) });
  const onThisMac = conversations.create("w1", { harness: "claude", profileId: "builder" });
  const project = store.findWorkspace("w1")!.path;
  writeFileSync(join(project, "notes.md"), "before\n");
  await conversations.send(onThisMac.id, "go");
  writeFileSync(join(project, "notes.md"), "after\n");
  const sent = store.listEvents(onThisMac.id).find(({ event }) => event.type === "user-message")!;

  await conversations.revert(onThisMac.id, sent.seq);

  expect(stopped).toEqual([project]);
  expect(readFileSync(join(project, "notes.md"), "utf8")).toBe("before\n");
  await conversations.shutdown();
});

test("a sandboxed room's agent never gets this computer's whole environment, even where the room gave it", async () => {
  const { store, conversations, conversation, sandboxHost } = sandboxedRoom(SANDBOX_ON);
  store.setRoomAgents("r1", ["builder"]);
  store.setRoomAgentWholeHostEnvironment("r1", "builder", true);
  process.env.ONLY_ON_THIS_MAC = "of-this-mac";
  const launcher = new FakeVmLauncher();
  conversations.startsSandboxedAgentsIn(stoppedAfterAll(new Sandboxes(launcher, sandboxHost)));
  try {
    await conversations.send(conversation.id, "go");
  } finally {
    delete process.env.ONLY_ON_THIS_MAC;
  }

  expect(launcher.agents).toHaveLength(1);
  expect(launcher.agents[0]!.environment.ONLY_ON_THIS_MAC).toBeUndefined();
  expect(launcher.agents[0]!.environment.PATH).toBeDefined();
  await conversations.shutdown();
});

test("the mode a room's sandbox set never follows its agent to this computer: turned off, the agent's next session never asks for nothing there", async () => {
  const { store, conversations, conversation } = sandboxedRoom(SANDBOX_ON);
  conversations.startsSandboxedAgentsIn({ ...NO_SANDBOXES, confirmedRunning: () => true });
  const inside = conversations as unknown as { agentProcesses: Map<string, unknown>; sandboxStarts: WeakMap<object, object> };
  const processKey = agentProcessKey(store.findProfile("builder")!, conversation, false);
  const log: string[] = [];
  const inTheVm = agentWithModes("vm", log);
  inside.agentProcesses.set(processKey, inTheVm);
  inside.sandboxStarts.set(inTheVm, {});
  await conversations.send(conversation.id, "go");
  expect(log).toEqual(["vm:mode=bypassPermissions"]);

  store.setRoomSandbox("r1", { ...SANDBOX_ON, on: false });
  conversations.startAfreshInRoom(conversation.id, { stopsTurn: false });
  inside.agentProcesses.set(processKey, agentWithModes("computer", log));
  await conversations.send(conversation.id, "go on");

  expect(log).not.toContain("computer:mode=bypassPermissions");
  expect(store.findConversation(conversation.id)!.configOptions.find(({ category }) => category === "mode")?.currentValue).toBe("default");
  await conversations.shutdown();
});
