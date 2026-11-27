import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { RequestPermissionRequest } from "@agentclientprotocol/sdk";
import type { SessionConfigOption } from "@agentclientprotocol/sdk/unstable";
import { loadConfig } from "../host/config.ts";
import { agentProcessKey, ConversationService } from "../host/conversations.ts";
import { Hub } from "../host/hub.ts";
import { HOOKS_OFF_AFTER_SANDBOX_MS, repositoryHooksOff } from "../host/sandbox/hooks-off.ts";
import { NO_SANDBOX_CONTROL, type SandboxControl } from "../host/sandbox/sandbox-control.ts";
import { belongsToSandbox, NO_SANDBOXES, sandboxConfigFolder, Sandboxes, type SandboxHost } from "../host/sandbox/sandboxes.ts";
import { OWNER_LABEL } from "../host/sandbox/vm-launcher.ts";
import { Store } from "../host/store.ts";
import { SystemNotifications } from "../host/system-notifications.ts";
import { WorkspaceSandboxes } from "../host/workspace-sandbox.ts";
import { englishProblem, type HostProblem } from "../shared/host-problems.ts";
import type { Conversation, HarnessId, Profile } from "../shared/model.ts";
import { ALL_OF_CLAUDE_SETUP } from "../shared/room-agent-setup.ts";
import { DEFAULT_PERMISSION_PRESET } from "../shared/room-permissions.ts";
import { NO_SANDBOX, ownerKey, roomSandbox, workspaceSandbox, type SandboxOwner, type SandboxSetting } from "../shared/sandbox.ts";
import { agentWithModes } from "./agent-with-modes.ts";
import { FakeVmLauncher } from "./fake-vm-launcher.ts";
import { prepareProgramsLeavingAMark, programLeavingAMark } from "./program-leaving-a-mark.ts";

setDefaultTimeout(20_000);

const scratch = mkdtempSync(join(tmpdir(), "sandboxed-workspace-turns-"));
const sandboxesMade: Sandboxes[] = [];
beforeAll(() => prepareProgramsLeavingAMark(scratch), 120_000);
afterAll(async () => {
  await Promise.all(sandboxesMade.map((sandboxes) => sandboxes.stopAll()));
  rmSync(scratch, { recursive: true, force: true });
});

const SANDBOX_ON: SandboxSetting = { on: true, workFreely: true, allowsSharedKernel: false, network: "closed" };
const BUILDER = { harness: "claude" as const, profileId: "builder" };

/** Claude Code as this computer runs it. */
const claudeCodeLeavingAMark = () => programLeavingAMark(scratch, "claude", "2.1.330 (Claude Code)");

function repository() {
  const folder = join(scratch, `project-${crypto.randomUUID()}`);
  mkdirSync(folder);
  Bun.spawnSync(["git", "init", "-q", folder]);
  return realpathSync.native(folder);
}

const profileOf = (id: string, name: string, harness: HarnessId, environment: string): Profile => ({
  id,
  name,
  harness,
  environment,
  prelaunch: "",
  model: null,
  mode: null,
  effort: null,
  bypassPermissions: false,
  askMode: "wait",
  color: null,
  pluginsOff: [],
  createdAt: 1,
});

/**
 * Two workspaces on one Claude profile that signs in with a key, the first sandboxed; a Claude profile that signs in
 * with a subscription, and a Codex one, beside it.
 */
function sandboxedWorkspace(sandbox: SandboxSetting = SANDBOX_ON) {
  const claude = claudeCodeLeavingAMark();
  const project = repository();
  const other = repository();
  const store = new Store(":memory:");
  store.saveProfile(profileOf("builder", "Builder", "claude", `ANTHROPIC_API_KEY=sk-ant-kept-on-this-mac\nCLAUDE_CODE_EXECUTABLE=${claude.program}`));
  store.saveProfile(profileOf("subscriber", "Subscriber", "claude", `CLAUDE_CODE_EXECUTABLE=${claude.program}`));
  store.saveProfile(profileOf("coder", "Coder", "codex", ""));
  store.insertWorkspace({ id: "w1", name: "project", path: project, defaultLaunch: BUILDER, createdAt: 1 });
  store.insertWorkspace({ id: "w2", name: "other", path: other, defaultLaunch: BUILDER, createdAt: 1 });
  store.setWorkspaceSandbox("w1", sandbox);
  const config = loadConfig({ MIRADOR_DATA_DIR: join(scratch, `data-${crypto.randomUUID()}`) });
  const hub = new Hub();
  const conversationsOnThisHost = () => new ConversationService(store, hub, config, { mute: () => {}, unmute: () => {} } as never, {} as never, {} as never, new SystemNotifications(store, hub));
  const conversations = conversationsOnThisHost();
  const launcher = new FakeVmLauncher();
  const host: SandboxHost = {
    dataDir: config.dataDir,
    workspaceOf: (owner) => store.findWorkspace(owner.kind === "workspace" ? owner.id : (store.findRoom(owner.id)?.workspaceId ?? ""))?.path ?? null,
    canvasOf: () => ({ belongs: () => false, tokenOf: () => "", handle: () => new Response() }),
    atWork: () => ({ agents: [], conversationIds: [] }),
    setupChanged: () => {},
    heldChanged: () => {},
    foldersOf: () => [],
    networkOf: () => "closed" as const,
    otherSandboxes: () => ({ workspaces: [], writableFolders: [], writableFoldersOn: [] }),
    foldersStarted: () => {},
    places: { home: "/nonexistent-home", dataDir: config.dataDir, checkout: "/nonexistent-checkout", computersOwn: [] },
  };
  const sandboxes = new Sandboxes(launcher, host, 60_000);
  sandboxesMade.push(sandboxes);
  conversations.startsSandboxedAgentsIn(sandboxes);
  const preparedFor: string[][] = [];
  const networkTold: string[] = [];
  const leftBy: string[] = [];
  const control: SandboxControl = {
    ...NO_SANDBOX_CONTROL,
    availability: () => sandboxes.availability(),
    prepare: (profiles) => void preparedFor.push(profiles.map(({ id }) => id)),
    answerHeldChange: (owner, changeId, answer) => sandboxes.answerHeldChange(owner, changeId, answer),
    workspaceRefusal: (workspace, turningOn) => sandboxes.workspaceRefusal(workspace, turningOn),
    ownerGone: (owner) => sandboxes.ownerGone(owner),
    ownerLeft: async (owner) => void leftBy.push(ownerKey(owner)),
    networkChanged: (owner) => void networkTold.push(`${ownerKey(owner)} ${store.findWorkspace(owner.id)!.sandbox.network}`),
  };
  const agentTabsClosed: string[] = [];
  const workspaceSandboxes = new WorkspaceSandboxes(store, hub, conversations, { closeAgentPrograms: (conversationId) => void agentTabsClosed.push(conversationId) });
  workspaceSandboxes.keepsSandboxesWith(control);
  const turnFailure = (conversationId: string) => store.listEvents(conversationId).findLast(({ event }) => event.type === "error" && event.endsTurn)?.event as { problem?: HostProblem } | undefined;
  return { store, config, conversations, conversationsOnThisHost, launcher, sandboxes, workspaceSandboxes, agentTabsClosed, claude, project, other, turnFailure, preparedFor, networkTold, leftBy };
}

type Inside = {
  agentProcesses: Map<string, unknown>;
  sandboxStarts: WeakMap<object, object>;
  runtime(conversationId: string): { harness?: unknown; running: boolean };
  agentInSandbox(sandbox: { owner: SandboxOwner; setting: SandboxSetting }, launch: Conversation, profile: unknown, onThisComputer: { command: string[]; environment: Record<string, string> }): Promise<unknown>;
  handlePermissionRequest(request: RequestPermissionRequest, signal: AbortSignal): Promise<{ outcome: { outcome: string; optionId?: string } }>;
};
const inside = (conversations: ConversationService) => conversations as unknown as Inside;

/** An agent that opens sessions and answers turns at once, counting its stops and the sessions closed on it. */
function fakeAgent() {
  const closed: string[] = [];
  let stops = 0;
  let sessions = 0;
  let prompts = 0;
  const agent = {
    spec: { id: "claude", label: "Claude Code", environment: {} },
    start: async () => ({ agentCapabilities: {} }),
    newSession: async () => ({ sessionId: `session-${++sessions}`, configOptions: [] }),
    setConfigOption: async () => ({ configOptions: [] }),
    prompt: async () => {
      prompts += 1;
      return { stopReason: "end_turn" };
    },
    cancel: async () => {},
    closeSession: async (sessionId: string) => void closed.push(sessionId),
    stop: async () => void (stops += 1),
  };
  return { agent, closed, stops: () => stops, prompts: () => prompts };
}

/**
 * Once the session its creation began to open has failed, as no real agent starts in a test's VM, the conversation goes
 * on on a fake agent where its process in the VM would be, and finishes a turn there.
 */
async function onFakeAgentForItsVm(conversations: ConversationService, store: Store, conversationId: string) {
  await until(() => conversations.get(conversationId).status === "error");
  const fake = fakeAgent();
  inside(conversations).agentProcesses.set(agentProcessKey(store.findProfile("builder")!, store.findConversation(conversationId)!, true), fake.agent);
  await conversations.send(conversationId, "go");
  return fake;
}

async function until(condition: () => boolean, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("timed out waiting");
    await Bun.sleep(10);
  }
}

const vmOf = (launcher: FakeVmLauncher, owner: SandboxOwner) => launcher.started.filter(({ labels }) => labels[OWNER_LABEL] === `${owner.kind}:${owner.id}`);

test("a sandboxed workspace's conversation starts its agent in the workspace's VM, in its folder, and never on this computer", async () => {
  const { conversations, launcher, claude, project } = sandboxedWorkspace();
  const conversation = conversations.create("w1", BUILDER);

  await conversations.send(conversation.id, "go");

  expect(vmOf(launcher, workspaceSandbox("w1"))).toHaveLength(1);
  expect(launcher.agents.length).toBeGreaterThan(0);
  expect(launcher.agents.every(({ workingDirectory }) => workingDirectory === project)).toBe(true);
  expect(claude.ranHere()).toBe(false);
  await conversations.shutdown();
});

test("a key a command of the profile gives is read as its agent starts in the VM, stays out of the VM, and keeps no sandbox off before it ran", async () => {
  const { store, conversations, launcher, workspaceSandboxes, claude, turnFailure } = sandboxedWorkspace();
  store.saveProfile(profileOf("vault", "Vault", "claude", `ANTHROPIC_API_KEY=$(printf sk-ant-from-the-vault)\nCLAUDE_CODE_EXECUTABLE=${claude.program}`));
  expect((await workspaceSandboxes.sandboxCheck("w1")).profilesThatRun).toEqual(["builder", "vault"]);
  const conversation = conversations.create("w1", { harness: "claude", profileId: "vault" });

  await conversations.send(conversation.id, "go");

  expect(turnFailure(conversation.id)?.problem?.code).not.toBe("workspace-sandbox-not-ready");
  expect(launcher.agents.length).toBeGreaterThan(0);
  expect(JSON.stringify(launcher.agents)).not.toContain("sk-ant-from-the-vault");
  expect(claude.ranHere()).toBe(false);
  await conversations.shutdown();
});

test("a sandbox turned on while a command gives a profile its key still keeps the agent's own sign-in, and ! commands, off this computer", async () => {
  const { store, conversations, claude } = sandboxedWorkspace(NO_SANDBOX);
  store.saveProfile(profileOf("vault", "Vault", "claude", `ANTHROPIC_API_KEY=$(sleep 0.5; printf sk-ant-from-the-vault)\nCLAUDE_CODE_EXECUTABLE=${claude.program}`));
  const conversation = conversations.create("w2", { harness: "claude", profileId: "vault" });
  await conversations.shutdown();
  store.saveProfile(profileOf("vault", "Vault", "claude", `ANTHROPIC_API_KEY=$(sleep 0.6; printf sk-ant-from-the-vault)\nCLAUDE_CODE_EXECUTABLE=${claude.program}`));

  const signIn = conversations.loginProgram(conversation.id, false).catch((error) => error);
  const command = conversations.runCommand(conversation.id, "true").catch((error) => error);
  store.setWorkspaceSandbox("w2", SANDBOX_ON);

  expect(await signIn).toMatchObject({ problem: { code: "sandboxed-agent-here" } });
  expect(await command).toMatchObject({ problem: { code: "sandboxed-workspace-command" } });
  expect(store.listEventsOfTypes(conversation.id, ["user-command"])).toEqual([]);
});

test("a sandboxed workspace's conversation with no sandbox to start in fails its turn saying so, and never runs on this computer, after a restart of the host too", async () => {
  const { conversations, conversationsOnThisHost, claude, turnFailure } = sandboxedWorkspace();
  const conversation = conversations.create("w1", BUILDER);
  await conversations.shutdown();
  const afterRestart = conversationsOnThisHost();

  await afterRestart.send(conversation.id, "go");

  expect(turnFailure(conversation.id)?.problem).toEqual({ code: "workspace-sandbox-not-ready", why: { kind: "unavailable", why: "turned-off" } });
  expect(claude.ranHere()).toBe(false);
  await afterRestart.shutdown();
});

test("a sandboxed workspace's conversation moved to a profile that can't run in a sandbox, or started on one, is refused with what to do, and nothing runs on this computer", async () => {
  const { conversations, claude, launcher, turnFailure } = sandboxedWorkspace();
  const conversation = conversations.create("w1", BUILDER);
  await conversations.setProfile(conversation.id, "subscriber");

  await conversations.send(conversation.id, "go");

  const refused = turnFailure(conversation.id)?.problem;
  expect(refused).toEqual({ code: "workspace-sandbox-not-ready", why: { kind: "blocked", blocker: { kind: "agent-signs-in-elsewhere", agent: "Subscriber", how: "subscription" } } });
  expect(englishProblem(refused!)).toEndWith("Pick a profile that can run there, or turn the sandbox off for this workspace.");
  const onCodex = conversations.create("w1", { harness: "codex", profileId: "coder" });
  await conversations.send(onCodex.id, "go");
  expect(turnFailure(onCodex.id)?.problem).toEqual({ code: "workspace-sandbox-not-ready", why: { kind: "blocked", blocker: { kind: "agent-kind-coming", agent: "Coder", harness: "codex" } } });
  expect(launcher.agents.filter(({ environment }) => environment.CLAUDE_CODE_EXECUTABLE === undefined && environment.CODEX_HOME !== undefined)).toEqual([]);
  expect(claude.ranHere()).toBe(false);
  await conversations.shutdown();
});

/**
 * pi as this computer runs it, as claudeCodeLeavingAMark is Claude Code, with an agent folder of its own: a models.json
 * gateway provider whose key comes from the profile, an auth.json and an extension the VM must never see.
 */
function piLeavingAMark(settings: Record<string, unknown>) {
  const pi = programLeavingAMark(scratch, "pi", "1.6.0");
  const agentFolder = join(scratch, `pi-agent-${crypto.randomUUID()}`);
  mkdirSync(join(agentFolder, "extensions"), { recursive: true });
  const provider = { baseUrl: "https://llm-gateway.example/v1", api: "openai-responses", apiKey: "${LLM_GATEWAY_KEY}", models: [{ id: "gpt-6.1" }] };
  writeFileSync(join(agentFolder, "models.json"), JSON.stringify({ providers: { gateway: provider } }));
  writeFileSync(join(agentFolder, "settings.json"), JSON.stringify({ packages: ["npm:pi-web-access"], ...settings }));
  writeFileSync(join(agentFolder, "auth.json"), JSON.stringify({ anthropic: { type: "api_key", key: "sk-ant-in-auth-json-of-this-mac" } }));
  writeFileSync(join(agentFolder, "extensions", "session.ts"), "export default () => {};\n");
  return { ...pi, agentFolder };
}

const GATEWAY_KEY = "gw-key-kept-on-this-mac-2468";

test("a sandboxed workspace's pi conversation starts pi in the VM from its own image, on its models.json provider through the model proxy, its key and agent folder kept on this computer; one the proxy can't stand in for is refused saying why", async () => {
  const { store, config, conversations, launcher, turnFailure } = sandboxedWorkspace();
  const pi = piLeavingAMark({ defaultProvider: "gateway", defaultModel: "gpt-6.1" });
  store.saveProfile(profileOf("pier", "Pier", "pi", `PI_CODING_AGENT_DIR=${pi.agentFolder}\nPI_ACP_PI_COMMAND=${pi.program}\nLLM_GATEWAY_KEY=${GATEWAY_KEY}\nOPENAI_API_KEY=sk-another-providers-key`));
  const conversation = conversations.create("w1", { harness: "pi", profileId: "pier" });

  await conversations.send(conversation.id, "go");

  expect(launcher.prepared).toContainEqual({ harness: "pi", version: "1.6.0" });
  const [agent] = launcher.agents.filter(({ environment }) => environment.MIRADOR_PI_MODELS !== undefined);
  expect(agent).toBeDefined();
  expect(agent!.command.slice(0, 2)).toEqual(["/usr/local/bin/bun", join(dirname(Bun.resolveSync("pi-acp/package.json", import.meta.dir)), "dist", "index.js")]);
  const { environment } = agent!;
  expect(JSON.stringify(environment)).not.toContain(GATEWAY_KEY);
  expect(JSON.stringify(environment)).not.toContain(pi.agentFolder);
  expect(["LLM_GATEWAY_KEY", "OPENAI_API_KEY"].filter((name) => Object.hasOwn(environment, name))).toEqual([]);
  expect(environment).toMatchObject({ PI_CODING_AGENT_DIR: sandboxConfigFolder(config.dataDir, workspaceSandbox("w1"), "pi", "pier"), PI_ACP_PI_COMMAND: "/mirador/sandbox/pi.sh", PI_OFFLINE: "1" });
  expect(JSON.parse(environment.MIRADOR_PI_MODELS!)).toEqual({ providers: { gateway: { api: "openai-responses", models: [{ id: "gpt-6.1" }], baseUrl: "http://127.0.0.1:7702/p/pier", apiKey: "kept-by-mirador" } } });
  expect(JSON.parse(environment.MIRADOR_PI_SETTINGS!)).toEqual({ defaultProvider: "gateway", defaultModel: "gpt-6.1" });
  const [vm] = vmOf(launcher, workspaceSandbox("w1"));
  expect(vm!.image).toBe("fake-image:pi-1.6.0");
  expect(vm!.mounts.some(({ source }) => source.startsWith(pi.agentFolder))).toBe(false);
  const piFolder = sandboxConfigFolder(config.dataDir, workspaceSandbox("w1"), "pi");
  expect(vm!.mounts).toContainEqual({ source: piFolder, target: piFolder, readOnly: false });
  expect(pi.ranHere()).toBe(false);

  const lost = piLeavingAMark({ defaultProvider: "anthropic", defaultModel: "claude-opus-5" });
  store.saveProfile(profileOf("lost", "Lost", "pi", `PI_CODING_AGENT_DIR=${lost.agentFolder}\nPI_ACP_PI_COMMAND=${lost.program}`));
  const onBuiltIn = conversations.create("w1", { harness: "pi", profileId: "lost" });
  await conversations.send(onBuiltIn.id, "go");
  const refused = turnFailure(onBuiltIn.id)?.problem;
  expect(refused).toEqual({ code: "workspace-sandbox-not-ready", why: { kind: "blocked", blocker: { kind: "pi-model-elsewhere", agent: "Lost", why: "built-in-provider" } } });
  expect(englishProblem(refused!)).toContain("Lost uses a model pi knows by itself.");
  expect(lost.ranHere()).toBe(false);
  await conversations.shutdown();
});

test("a workspace's sandbox check names the profiles that can run in it, for the workspace to start its new conversations on, and none where none can", async () => {
  const { store, workspaceSandboxes, conversations } = sandboxedWorkspace();
  store.setWorkspaceDefaultLaunch("w1", { harness: "codex", profileId: "coder" });

  const onCodex = await workspaceSandboxes.sandboxCheck("w1");

  expect(onCodex.startsOn).toEqual({ kind: "agent-kind-coming", agent: "Coder", harness: "codex" });
  expect(onCodex.profilesThatRun).toEqual(["builder"]);
  store.setWorkspaceDefaultLaunch("w1", BUILDER);
  expect(await workspaceSandboxes.sandboxCheck("w1")).toMatchObject({ startsOn: null, profilesThatRun: ["builder"] });
  store.setWorkspaceDefaultLaunch("w1", { harness: "claude", profileId: "subscriber" });
  store.deleteProfile("builder");
  expect(await workspaceSandboxes.sandboxCheck("w1")).toMatchObject({
    startsOn: { kind: "agent-signs-in-elsewhere", agent: "Subscriber", how: "subscription" },
    profilesThatRun: [],
  });
  await conversations.shutdown();
});

test("a sandboxed workspace's side chats and forks start in its VM too", async () => {
  const { store, conversations, launcher, claude } = sandboxedWorkspace();
  const conversation = conversations.create("w1", BUILDER);
  await conversations.send(conversation.id, "go");
  const launchedBefore = launcher.agents.length;

  const sideChat = conversations.startSideChat(conversation.id, "why?");
  await until(() => store.listEvents(sideChat.id).some(({ event }) => event.type === "error"));
  expect(launcher.agents.length).toBeGreaterThan(launchedBefore);

  store.updateConversation({ ...store.findConversation(conversation.id)!, acpSessionId: "in-the-vm" });
  store.setSetupOfSession(conversation.id, JSON.stringify({ sandbox: "works-freely" }));
  store.appendEvent(conversation.id, { type: "turn-end", stopReason: "end_turn" } as never);
  const launchedBeforeFork = launcher.agents.length;
  const forked = conversations.fork(conversation.id);
  await until(() => launcher.agents.length > launchedBeforeFork || store.listEvents(forked.id).some(({ event }) => event.type === "error"));
  expect(launcher.agents.length).toBeGreaterThan(launchedBeforeFork);
  expect(claude.ranHere()).toBe(false);
  await conversations.shutdown();
});

test("turned on, the workspace's sandbox prepares the image of the profile its new conversations start on, only where that one can run there", async () => {
  const { store, workspaceSandboxes, preparedFor } = sandboxedWorkspace(NO_SANDBOX);
  await workspaceSandboxes.setSandbox("w1", SANDBOX_ON);
  await workspaceSandboxes.setSandbox("w1", NO_SANDBOX);
  store.setWorkspaceDefaultLaunch("w1", { harness: "claude", profileId: "subscriber" });
  await workspaceSandboxes.setSandbox("w1", SANDBOX_ON);
  expect(preparedFor).toEqual([["builder"], []]);
});

test("turned off, or gone with its workspace, the workspace's sandbox tells the sandboxes it left, so it hears of no new held change there", async () => {
  const { workspaceSandboxes, leftBy } = sandboxedWorkspace(NO_SANDBOX);
  await workspaceSandboxes.setSandbox("w1", SANDBOX_ON);
  expect(leftBy).toEqual([]);
  await workspaceSandboxes.setSandbox("w1", NO_SANDBOX);
  expect(leftBy).toEqual([ownerKey(workspaceSandbox("w1"))]);
  await workspaceSandboxes.setSandbox("w1", SANDBOX_ON);
  workspaceSandboxes.workspaceGone("w1");
  expect(leftBy).toHaveLength(2);
});

test("what a workspace's sandbox reaches changes by itself, its conversations going on in their sessions, stays as it is however else the sandbox is set, and is closed again once that is turned off", async () => {
  const { store, conversations, workspaceSandboxes, networkTold } = sandboxedWorkspace();
  const shared = fakeAgent();
  const conversation = conversations.create("w1", BUILDER);
  const processKey = agentProcessKey(store.findProfile("builder")!, conversation, true);
  inside(conversations).agentProcesses.set(processKey, shared.agent);
  inside(conversations).sandboxStarts.set(shared.agent, {});
  await conversations.send(conversation.id, "go");

  workspaceSandboxes.setNetwork("w1", "internet");
  workspaceSandboxes.setNetwork("w1", "internet");
  expect(store.findWorkspace("w1")!.sandbox).toEqual({ ...SANDBOX_ON, network: "internet" });
  await conversations.send(conversation.id, "go on");
  expect(store.listEventsOfTypes(conversation.id, ["context-cleared"])).toEqual([]);
  expect(shared.prompts()).toBe(2);

  await workspaceSandboxes.setSandbox("w1", { ...SANDBOX_ON, workFreely: false, network: "everything" });
  expect(store.findWorkspace("w1")!.sandbox).toEqual({ ...SANDBOX_ON, workFreely: false, network: "internet" });
  await workspaceSandboxes.setSandbox("w1", NO_SANDBOX);
  workspaceSandboxes.setNetwork("w1", "everything");
  expect(store.findWorkspace("w1")!.sandbox.network).toBe("closed");
  await workspaceSandboxes.setSandbox("w1", { ...SANDBOX_ON, network: "everything" });
  expect(store.findWorkspace("w1")!.sandbox).toEqual(SANDBOX_ON);
  expect(networkTold).toEqual(["workspace:w1 internet", "workspace:w1 internet", "workspace:w1 closed", "workspace:w1 closed"]);
  await conversations.shutdown();
});

test("a session started on this computer before the workspace was sandboxed is not resumed: the conversation starts afresh in the VM", async () => {
  const { store, conversations, launcher, workspaceSandboxes, claude } = sandboxedWorkspace(NO_SANDBOX);
  const shared = fakeAgent();
  inside(conversations).agentProcesses.set("builder", shared.agent);
  const conversation = conversations.create("w1", BUILDER);
  await conversations.send(conversation.id, "go");
  expect(conversations.canFork(conversation.id)).toBe(true);

  await workspaceSandboxes.setSandbox("w1", SANDBOX_ON);
  expect(conversations.canFork(conversation.id)).toBe(false);
  await conversations.send(conversation.id, "go on");

  expect(store.listEventsOfTypes(conversation.id, ["context-cleared"])).toHaveLength(1);
  expect(launcher.agents.length).toBeGreaterThan(0);
  expect(shared.prompts()).toBe(1);
  expect(claude.ranHere()).toBe(false);
  await conversations.shutdown();
});

test("a sandboxed workspace takes in no session from this computer, runs no ! command, and starts its new conversations in its folder", async () => {
  const { conversations, store } = sandboxedWorkspace();
  const outside = { code: "sandboxed-workspace-outside-session" };
  await expect(conversations.listSessionsInWorkspace("w1", BUILDER)).rejects.toMatchObject({ problem: outside });
  await expect(conversations.searchSessionsInWorkspace("w1", BUILDER, "deploy")).rejects.toMatchObject({ problem: outside });
  expect(() => conversations.adopt("w1", BUILDER, { sessionId: "from-a-terminal", title: "Terminal" }, "continue")).toThrow(expect.objectContaining({ problem: outside }));
  const conversation = conversations.create("w1", BUILDER);
  await expect(conversations.runCommand(conversation.id, "touch ran")).rejects.toMatchObject({ problem: { code: "sandboxed-workspace-command" } });

  store.setWorktreeSettings("w1", "worktree", "");
  const started = await conversations.start("w1", BUILDER, undefined, "worktree");
  expect(started.worktree).toBeUndefined();
  await conversations.shutdown();
});

test("in a sandboxed workspace a plugin's conversation starts in the folder with its agent in the VM, one in a worktree of its own is refused, and Claude Code's own panels and sign-in don't open", async () => {
  const { store, conversations, launcher, claude, project } = sandboxedWorkspace();
  store.setWorktreeSettings("w1", "worktree", "");

  const routine = await conversations.startForPlugin("w1", "Routines", { profileId: "builder", prompt: "go" });
  expect(routine.worktree).toBeUndefined();
  await until(() => launcher.agents.length > 0);
  expect(launcher.agents.every(({ workingDirectory }) => workingDirectory === project)).toBe(true);

  const caller = conversations.create("w1", BUILDER);
  await expect(conversations.startInOwnWorktree(caller.id, "Reviews", "Builder", "review")).rejects.toThrow("no worktree");
  const agentHere = { problem: { code: "sandboxed-agent-here" } };
  await expect(conversations.loginProgram(caller.id, false)).rejects.toMatchObject(agentHere);
  await expect(conversations.panelCommandProgram(caller.id, "/mcp")).rejects.toMatchObject(agentHere);
  expect(claude.ranHere()).toBe(false);
  await conversations.shutdown();
});

test("a sandboxed workspace's conversation that works in a worktree, which its VM doesn't see, is refused", async () => {
  const { store, conversations } = sandboxedWorkspace();
  const conversation = conversations.create("w1", BUILDER);
  const inWorktree = store.insertConversation({
    ...store.findConversation(conversation.id)!,
    id: "in-worktree",
    worktree: { id: "elsewhere", root: join(scratch, "elsewhere"), folder: join(scratch, "elsewhere"), branch: "mirador/elsewhere" },
  });
  const onThisComputer = { command: ["claude-agent-acp"], environment: { ANTHROPIC_API_KEY: "sk-ant-kept-on-this-mac", CLAUDE_CODE_EXECUTABLE: "/bin/false" } };

  const refused = inside(conversations).agentInSandbox({ owner: workspaceSandbox("w1"), setting: SANDBOX_ON }, inWorktree, store.findProfile("builder"), onThisComputer);

  await expect(refused).rejects.toMatchObject({ problem: { code: "sandbox-not-ready", why: { kind: "blocked", blocker: { kind: "conversation-in-worktree" } } } });
  await conversations.shutdown();
});

test("YOLO approves a sandboxed workspace's requests only while its agent runs in the VM and the VM is known to run", async () => {
  const { store, conversations } = sandboxedWorkspace();
  let vmRunning = false;
  conversations.startsSandboxedAgentsIn({ ...NO_SANDBOXES, confirmedRunning: () => vmRunning });
  const conversation = conversations.create("w1", BUILDER);
  const { agent } = await onFakeAgentForItsVm(conversations, store, conversation.id);
  conversations.setBypassPermissions(conversation.id, true);
  const sessionId = store.findConversation(conversation.id)!.acpSessionId!;
  const asked = (toolCallId: string) =>
    Promise.race([
      inside(conversations).handlePermissionRequest(
        { sessionId, toolCall: { toolCallId, title: "rm -rf build", kind: "execute" }, options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }, { optionId: "reject", name: "Reject", kind: "reject_once" }] },
        new AbortController().signal,
      ),
      Bun.sleep(300).then(() => "asks the owner"),
    ]);

  expect(await asked("on-this-computer-as-far-as-known")).toBe("asks the owner");
  inside(conversations).sandboxStarts.set(agent, {});
  expect(await asked("vm-not-confirmed")).toBe("asks the owner");
  vmRunning = true;
  expect(await asked("vm-running")).toEqual({ outcome: { outcome: "selected", optionId: "allow" } });
  await conversations.shutdown();
});

test("turning a workspace's sandbox off stops its agents in the VM, starts its conversations afresh on this computer, and leaves the repository's hooks off for 7 days", async () => {
  const { store, conversations, workspaceSandboxes, claude } = sandboxedWorkspace();
  const conversation = conversations.create("w1", BUILDER);
  const { stops } = await onFakeAgentForItsVm(conversations, store, conversation.id);
  const library = repository();
  store.addSandboxFolder(workspaceSandbox("w1"), { path: library, writable: true, addedAt: 1 });
  const before = Date.now();

  await workspaceSandboxes.setSandbox("w1", NO_SANDBOX);
  expect(repositoryHooksOff(store, [library], before + HOOKS_OFF_AFTER_SANDBOX_MS - 1)).toBe(true);
  expect(repositoryHooksOff(store, [library], Date.now() + HOOKS_OFF_AFTER_SANDBOX_MS)).toBe(false);

  expect(stops()).toBe(1);
  expect([...inside(conversations).agentProcesses.keys()].some((key) => key.endsWith("/sandboxed"))).toBe(false);
  await conversations.send(conversation.id, "go on");
  expect(store.listEventsOfTypes(conversation.id, ["context-cleared"])).toHaveLength(1);
  expect(claude.ranHere()).toBe(true);
  const project = store.findWorkspace("w1")!.path;
  const [{ leftAt: turnedOffAt }] = store.foldersSandboxesLeft().filter(({ path }) => path === realpathSync.native(project));
  expect(turnedOffAt).toBeGreaterThanOrEqual(before);
  expect(repositoryHooksOff(store, [project], turnedOffAt + HOOKS_OFF_AFTER_SANDBOX_MS - 1)).toBe(true);
  expect(repositoryHooksOff(store, [project], turnedOffAt + HOOKS_OFF_AFTER_SANDBOX_MS)).toBe(false);
  await conversations.shutdown();
});

test("a sandboxed workspace removed leaves the repositories' hooks off in its folder and its folders read and write for 7 days, though it is added again", async () => {
  const { store, workspaceSandboxes, project, other } = sandboxedWorkspace();
  const library = repository();
  store.addSandboxFolder(workspaceSandbox("w1"), { path: library, writable: true, addedAt: 1 });
  const before = Date.now();

  workspaceSandboxes.workspaceGone("w1");
  store.deleteWorkspace("w1");
  store.insertWorkspace({ id: "w9", name: "project", path: project, defaultLaunch: BUILDER, createdAt: 2 });

  expect(repositoryHooksOff(store, [join(project, "nested")], before + HOOKS_OFF_AFTER_SANDBOX_MS - 1)).toBe(true);
  expect(repositoryHooksOff(store, [join(project, "nested")], Date.now() + HOOKS_OFF_AFTER_SANDBOX_MS)).toBe(false);
  expect(repositoryHooksOff(store, [join(library, "nested")], before + HOOKS_OFF_AFTER_SANDBOX_MS - 1)).toBe(true);
  expect(repositoryHooksOff(store, [library], Date.now() + HOOKS_OFF_AFTER_SANDBOX_MS)).toBe(false);
  expect(repositoryHooksOff(store, [other], before)).toBe(false);
});

test("turning a workspace's sandbox on lets its conversations go of the process their profile shares, which goes on serving the other workspaces", async () => {
  const { store, conversations, workspaceSandboxes } = sandboxedWorkspace(NO_SANDBOX);
  const shared = fakeAgent();
  inside(conversations).agentProcesses.set("builder", shared.agent);
  const sandboxed = conversations.create("w1", BUILDER);
  const elsewhere = conversations.create("w2", BUILDER);
  await until(() => store.findConversation(sandboxed.id)?.acpSessionId !== null && store.findConversation(elsewhere.id)?.acpSessionId !== null);
  const sandboxedSession = store.findConversation(sandboxed.id)!.acpSessionId!;

  await workspaceSandboxes.setSandbox("w1", SANDBOX_ON);

  expect(shared.stops()).toBe(0);
  expect(shared.closed).toEqual([sandboxedSession]);
  expect(inside(conversations).runtime(sandboxed.id).harness).toBeUndefined();
  expect(inside(conversations).runtime(elsewhere.id).harness).toBe(shared.agent);
  await conversations.shutdown();
});

test("a sandboxed workspace's agent gets none of this computer's own environment beyond what every program needs, and no way to reach Mirador as the owner's scripts do", async () => {
  const { conversations, launcher } = sandboxedWorkspace();
  process.env.ONLY_ON_THIS_MAC = "of-this-mac";
  try {
    const conversation = conversations.create("w1", BUILDER);
    await conversations.send(conversation.id, "go");
  } finally {
    delete process.env.ONLY_ON_THIS_MAC;
  }

  expect(launcher.agents.length).toBeGreaterThan(0);
  launcher.agents.forEach(({ environment }) => {
    expect(environment.ONLY_ON_THIS_MAC).toBeUndefined();
    expect(environment.MIRADOR_SCRIPT_TOKEN).toBeUndefined();
    expect(environment.PATH).toBeDefined();
  });
  await conversations.shutdown();
});

test("one workspace's VM sees neither another workspace's nor a room's: its own name, folder, config and conversations", async () => {
  const { store, sandboxes, launcher, config, project, other } = sandboxedWorkspace();
  store.setWorkspaceSandbox("w2", SANDBOX_ON);
  store.insertRoom({ id: "r1", name: "Launch", workspaceId: "w1", agents: [], people: [], permissions: DEFAULT_PERMISSION_PRESET, peoplesTasksWait: true, claudeSetup: ALL_OF_CLAUDE_SETUP, agentsReadGuests: true, membersBringAgents: true, sandbox: SANDBOX_ON, createdAt: 1 });
  const owners = [workspaceSandbox("w1"), workspaceSandbox("w2"), roomSandbox("r1")];
  const agentOf = (owner: SandboxOwner, workingDirectory: string) => ({
    owner,
    allowsSharedKernel: false,
    profileId: "builder",
    kind: { harness: "claude" as const, keyVariable: "ANTHROPIC_API_KEY" as const },
    version: "2.1.330",
    workingDirectory,
    given: { ANTHROPIC_API_KEY: "sk-ant-kept-on-this-mac", PATH: "/usr/bin" },
    route: { upstream: "https://api.anthropic.com", api: "anthropic-messages" as const, key: "sk-ant-kept-on-this-mac", keyHeader: "x-api-key" as const, headers: [] },
    agent: ["/usr/local/bin/bun", "agent.js"],
  });

  await sandboxes.launch(agentOf(owners[0]!, project));
  await sandboxes.launch(agentOf(owners[1]!, other));
  await sandboxes.launch(agentOf(owners[2]!, project));

  const vms = owners.map((owner) => vmOf(launcher, owner));
  expect(vms.map((each) => each.length)).toEqual([1, 1, 1]);
  expect(new Set(vms.map(([vm]) => vm!.name)).size).toBe(3);
  const sources = vms.map(([vm]) => vm!.mounts.map(({ source }) => source));
  expect(sources[0]!.some((source) => source.startsWith(other))).toBe(false);
  expect(sources[1]!.some((source) => source.startsWith(project))).toBe(false);
  const configFolders = owners.map((owner) => sandboxConfigFolder(config.dataDir, owner, "claude"));
  expect(new Set(configFolders).size).toBe(3);
  sources.forEach((mounted, index) => expect(configFolders.filter((folder, each) => each !== index && mounted.includes(folder))).toEqual([]));
  const socketFolders = vms.map(([vm]) => vm!.mounts.filter(({ target }) => target.startsWith("/run/mirador/")).map(({ source }) => source));
  expect(new Set(socketFolders.flat()).size).toBe(9);

  const ownConversation = { workspaceId: "w1", roomId: undefined };
  const roomsConversation = { workspaceId: "w1", roomId: "r1" };
  const otherWorkspaces = { workspaceId: "w2", roomId: undefined };
  expect(owners.map((owner) => belongsToSandbox(ownConversation, owner))).toEqual([true, false, false]);
  expect(owners.map((owner) => belongsToSandbox(roomsConversation, owner))).toEqual([false, false, true]);
  expect(owners.map((owner) => belongsToSandbox(otherWorkspaces, owner))).toEqual([false, true, false]);
});

const modeOf = (store: Store, conversationId: string) => store.findConversation(conversationId)!.configOptions.find(({ category }) => category === "mode")?.currentValue;

/** The conversation's next session opens on `agent`, in the workspace's VM as far as the host knows. */
function inItsVm(conversations: ConversationService, store: Store, conversationId: string, agent: object) {
  inside(conversations).agentProcesses.set(agentProcessKey(store.findProfile("builder")!, store.findConversation(conversationId)!, true), agent);
  inside(conversations).sandboxStarts.set(agent, {});
}

test("the mode a sandbox's work-freely set never follows its conversation to this computer: turned off, the next session starts in its profile's mode or the agent's own", async () => {
  const { store, conversations, workspaceSandboxes } = sandboxedWorkspace();
  conversations.startsSandboxedAgentsIn({ ...NO_SANDBOXES, confirmedRunning: () => true });
  const log: string[] = [];
  const conversation = conversations.create("w1", BUILDER);
  await until(() => conversations.get(conversation.id).status === "error");
  inItsVm(conversations, store, conversation.id, agentWithModes("vm", log));
  await conversations.send(conversation.id, "go");
  expect(log).toEqual(["vm:mode=bypassPermissions"]);

  await workspaceSandboxes.setSandbox("w1", NO_SANDBOX);
  inside(conversations).agentProcesses.set("builder", agentWithModes("computer", log));
  await conversations.send(conversation.id, "go on");

  expect(log).not.toContain("computer:mode=bypassPermissions");
  expect(modeOf(store, conversation.id)).toBe("default");
  await conversations.shutdown();
});

test("a sandboxed workspace's side chat that may change files starts in its VM too, never in the mode its conversation works freely in, and asks before it does anything", async () => {
  const { store, conversations, launcher, claude } = sandboxedWorkspace();
  store.setSideChatAccess("can-change-files");
  const log: string[] = [];
  const conversation = conversations.create("w1", BUILDER);
  await until(() => conversations.get(conversation.id).status === "error");
  const worksFreely: SessionConfigOption = { id: "mode", name: "Mode", category: "mode", type: "select", currentValue: "bypassPermissions", options: [{ value: "bypassPermissions", name: "Bypass permissions" }] };
  store.updateConversation({ ...store.findConversation(conversation.id)!, configOptions: [worksFreely] });
  const launchedBefore = launcher.agents.length;

  const sideChat = conversations.startSideChat(conversation.id, "fix it", store.ownerId());
  await until(() => store.listEvents(sideChat.id).some(({ event }) => event.type === "error"));
  expect(launcher.agents.length).toBeGreaterThan(launchedBefore);
  expect(claude.ranHere()).toBe(false);

  conversations.startsSandboxedAgentsIn({ ...NO_SANDBOXES, confirmedRunning: () => true });
  inItsVm(conversations, store, sideChat.id, agentWithModes("side", log, "bypassPermissions"));
  await conversations.send(sideChat.id, "and now?");
  expect(store.findConversation(sideChat.id)?.sideChatMayChangeFiles).toBe(true);
  expect(log).toEqual(["side:mode=default"]);

  const sessionId = store.findConversation(sideChat.id)!.acpSessionId!;
  const answered = await Promise.race([
    inside(conversations).handlePermissionRequest(
      { sessionId, toolCall: { toolCallId: "edit", title: "Edit README.md", kind: "edit" }, options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }, { optionId: "reject", name: "Reject", kind: "reject_once" }] },
      new AbortController().signal,
    ),
    Bun.sleep(300).then(() => "asks the owner"),
  ]);
  expect(answered).toBe("asks the owner");
  await conversations.shutdown();
});

test("where the profile's permission mode still applies in the sandbox, each new session there is set to it, so a default mode the agents planted in the sandbox's settings never holds", async () => {
  const { store, conversations, workspaceSandboxes } = sandboxedWorkspace();
  conversations.startsSandboxedAgentsIn({ ...NO_SANDBOXES, confirmedRunning: () => true });
  await workspaceSandboxes.setSandbox("w1", { ...SANDBOX_ON, workFreely: false });
  const log: string[] = [];
  const conversation = conversations.create("w1", BUILDER);
  await until(() => conversations.get(conversation.id).status === "error");
  inItsVm(conversations, store, conversation.id, agentWithModes("first", log, "bypassPermissions"));

  await conversations.send(conversation.id, "go");
  expect(log).toEqual(["first:mode=default"]);

  await workspaceSandboxes.setSandbox("w1", SANDBOX_ON);
  await conversations.send(conversation.id, "go on");
  inItsVm(conversations, store, conversation.id, agentWithModes("freely", log));
  await conversations.send(conversation.id, "go on, freely");
  expect(modeOf(store, conversation.id)).toBe("bypassPermissions");

  await workspaceSandboxes.setSandbox("w1", { ...SANDBOX_ON, workFreely: false });
  inItsVm(conversations, store, conversation.id, agentWithModes("replaced", log, "bypassPermissions"));
  await conversations.setConfigOption(conversation.id, "model", "opus");

  expect(log.filter((entry) => entry.startsWith("replaced:"))).toEqual(["replaced:mode=default", "replaced:model=opus"]);
  expect(modeOf(store, conversation.id)).toBe("default");
  await conversations.shutdown();
});

test("an agent brought into someone else's room, working in a sandboxed workspace's folder, never starts in its VM beside the workspace's own conversations, nor on this computer", async () => {
  const { conversations, launcher, claude, turnFailure } = sandboxedWorkspace();
  const brought = conversations.createBroughtIntoRoom("w1", BUILDER, "Launch · Ann's Mac", false);

  await conversations.send(brought.id, "fix it");

  expect(turnFailure(brought.id)?.problem).toEqual({ code: "brought-agent-in-sandboxed-workspace" });
  expect(vmOf(launcher, workspaceSandbox("w1"))).toEqual([]);
  expect(launcher.agents).toEqual([]);
  expect(claude.ranHere()).toBe(false);
  await conversations.shutdown();
});

test("a turn that goes on in the VM after the workspace's sandbox was turned off leaves the VM as it ends, so the VM stops with no conversation left in it", async () => {
  const { store, conversations, workspaceSandboxes } = sandboxedWorkspace();
  const conversation = conversations.create("w1", BUILDER);
  await until(() => conversations.get(conversation.id).status === "error");
  let finishTurn = () => {};
  const turnHeld = new Promise<void>((resolve) => (finishTurn = resolve));
  const fake = fakeAgent();
  const heldInTheVm = { ...fake.agent, prompt: () => turnHeld.then(() => ({ stopReason: "end_turn" })) };
  inItsVm(conversations, store, conversation.id, heldInTheVm);
  const turn = conversations.send(conversation.id, "go");
  await until(() => conversations.isAtWork(conversation.id) && conversations.get(conversation.id).status === "running");

  await workspaceSandboxes.setSandbox("w1", NO_SANDBOX);
  expect(fake.stops()).toBe(0);
  finishTurn();
  await turn;

  await until(() => fake.stops() === 1);
  await conversations.shutdown();
});

test("turning a workspace's sandbox on stops a turn on the process its profile shares and closes its session there, with the shells it runs, and the sign-in and panel tabs of its conversations", async () => {
  const { store, conversations, workspaceSandboxes, agentTabsClosed } = sandboxedWorkspace(NO_SANDBOX);
  let cancelTurn = () => {};
  const shared = fakeAgent();
  const turnUntilCancelled = new Promise<{ stopReason: string }>((resolve) => (cancelTurn = () => resolve({ stopReason: "cancelled" })));
  const sharedAgent = { ...shared.agent, prompt: () => turnUntilCancelled, cancel: async () => cancelTurn() };
  inside(conversations).agentProcesses.set("builder", sharedAgent);
  const sandboxed = conversations.create("w1", BUILDER);
  const elsewhere = conversations.create("w2", BUILDER);
  await until(() => store.findConversation(sandboxed.id)?.acpSessionId !== null && store.findConversation(elsewhere.id)?.acpSessionId !== null);
  const sandboxedSession = store.findConversation(sandboxed.id)!.acpSessionId!;
  expect((await conversations.loginProgram(sandboxed.id, false)).runsTheAgent).toBe(true);
  expect((await conversations.panelCommandProgram(sandboxed.id, "/mcp")).runsTheAgent).toBe(true);
  const turn = conversations.send(sandboxed.id, "go");
  await until(() => conversations.get(sandboxed.id).status === "running");

  await workspaceSandboxes.setSandbox("w1", SANDBOX_ON);
  await turn;

  await until(() => shared.closed.includes(sandboxedSession));
  expect(shared.closed).toEqual([sandboxedSession]);
  expect(shared.stops()).toBe(0);
  expect(inside(conversations).runtime(sandboxed.id).harness).toBeUndefined();
  expect(inside(conversations).runtime(elsewhere.id).harness).toBe(sharedAgent);
  expect(agentTabsClosed).toEqual([sandboxed.id]);

  await workspaceSandboxes.setSandbox("w1", NO_SANDBOX);
  expect(agentTabsClosed).toEqual([sandboxed.id]);
  await conversations.shutdown();
});
