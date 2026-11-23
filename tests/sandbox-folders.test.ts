import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { claudeRoomSessionMeta, claudeSessionMeta } from "../host/acp/harnesses.ts";
import { loadConfig } from "../host/config.ts";
import { agentProcessKey, ConversationService } from "../host/conversations.ts";
import { Hub } from "../host/hub.ts";
import { addedFolderRefusal, folderToAdd, foldersMounted, type FolderSurroundings } from "../host/sandbox/added-folders.ts";
import { AppleContainer } from "../host/sandbox/apple-container.ts";
import { NO_SANDBOXES, Sandboxes, type SandboxedAgents, type SandboxHost } from "../host/sandbox/sandboxes.ts";
import { Store } from "../host/store.ts";
import { SystemNotifications } from "../host/system-notifications.ts";
import type { Conversation, Profile } from "../shared/model.ts";
import { ALL_OF_CLAUDE_SETUP } from "../shared/room-agent-setup.ts";
import { DEFAULT_PERMISSION_PRESET } from "../shared/room-permissions.ts";
import { NO_SANDBOX, roomSandbox, workspaceSandbox, type SandboxFolder, type SandboxOwner, type SandboxSetting } from "../shared/sandbox.ts";
import { FakeContainerCli } from "./fake-container-cli.ts";

setDefaultTimeout(20_000);

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "sandbox-folders-")));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function folderIn(parent: string, ...names: string[]) {
  const folder = join(parent, ...names);
  mkdirSync(folder, { recursive: true });
  return folder;
}

/** A home with notes, hidden settings, a Library, Mirador's checkout and a project, and Mirador's data hidden in it. */
function homeOfTheOwner() {
  const home = folderIn(scratch, `home-${crypto.randomUUID()}`);
  const checkout = folderIn(home, "prj", "mirador");
  const surroundings: FolderSurroundings = {
    places: { home, dataDir: folderIn(home, ".mirador"), checkout, computersOwn: [join(home, ".config")] },
    workspace: folderIn(home, "prj", "app"),
    sandboxOwn: [join(home, ".mirador", "sandbox", "room-1"), join(checkout, "node_modules"), join(checkout, "host", "sandbox", "in-vm"), "/mirador/sandbox", "/run/mirador"],
    socketsParent: folderIn(scratch, `sockets-${crypto.randomUUID()}`),
  };
  return { home, checkout, surroundings };
}

const refusalOf = (folder: string, surroundings: FolderSurroundings, others: string[] = []) => addedFolderRefusal(folder, surroundings, others);

describe("a folder added to a sandbox", () => {
  test("goes in from inside the owner's home, outside its hidden folders, its Library, Mirador's own places and the workspace", async () => {
    const { home, checkout, surroundings } = homeOfTheOwner();
    const notes = folderIn(home, "notes");

    expect(await refusalOf(notes, surroundings)).toBeNull();
    expect(await refusalOf(folderIn(home, "notes", "deep"), surroundings)).toBeNull();
    expect(await refusalOf(home, surroundings)).toEqual({ kind: "is-home" });
    expect(await refusalOf(scratch, surroundings)).toEqual({ kind: "outside-home" });
    expect(await refusalOf("/etc", surroundings)).toEqual({ kind: "outside-home" });
    expect(await refusalOf(folderIn(home, ".ssh"), surroundings)).toEqual({ kind: "hidden-in-home", entry: ".ssh" });
    expect(await refusalOf(folderIn(home, ".config", "gh"), surroundings)).toEqual({ kind: "hidden-in-home", entry: ".config" });
    expect(await refusalOf(folderIn(home, "Library", "Preferences"), surroundings)).toEqual({ kind: "in-library" });
    expect(await refusalOf(folderIn(home, "Library"), surroundings)).toEqual({ kind: "in-library" });
    expect(await refusalOf(join(home, "prj"), surroundings)).toEqual({ kind: "is-mirador" });
    expect(await refusalOf(folderIn(checkout, "web"), surroundings)).toEqual({ kind: "is-mirador" });
    expect(await refusalOf(surroundings.workspace!, surroundings)).toEqual({ kind: "overlaps-workspace" });
    expect(await refusalOf(folderIn(surroundings.workspace!, "docs"), surroundings)).toEqual({ kind: "overlaps-workspace" });
    expect(await refusalOf(join(home, "a:b"), surroundings)).toEqual({ kind: "path-has-colon" });
    expect(await refusalOf(notes, surroundings, [notes])).toEqual({ kind: "already-added" });
    expect(await refusalOf(join(notes, "deep"), surroundings, [notes])).toEqual({ kind: "overlaps-folder", folder: notes });
    expect(await refusalOf(notes, surroundings, [join(notes, "deep")])).toEqual({ kind: "overlaps-folder", folder: join(notes, "deep") });
  });

  test("keeps clear of Mirador's data and the computer's own folders where they aren't hidden, and of every VM's sockets", async () => {
    const { home, surroundings } = homeOfTheOwner();
    const dataDir = folderIn(home, "mirador-data");
    const storage = folderIn(home, "data", "containers");
    const socketsParent = folderIn(home, "tmp");
    const around: FolderSurroundings = { ...surroundings, places: { ...surroundings.places, dataDir, computersOwn: [storage] }, sandboxOwn: [join(dataDir, "sandbox", "room-1")], socketsParent };

    expect(await refusalOf(dataDir, around)).toEqual({ kind: "holds-mirador-data" });
    expect(await refusalOf(folderIn(dataDir, "sandbox", "room-1"), around)).toEqual({ kind: "holds-mirador-data" });
    expect(await refusalOf(join(home, "data"), around)).toEqual({ kind: "holds-computers-own", folder: storage });
    expect(await refusalOf(socketsParent, around)).toEqual({ kind: "holds-sandbox-files" });
    expect(await refusalOf(folderIn(socketsParent, "mirador-sandbox-a1b2c3"), around)).toEqual({ kind: "holds-sandbox-files" });
    expect(await refusalOf(folderIn(socketsParent, "downloads"), around)).toBeNull();
  });

  test("never shadows where Mirador puts its scripts and sockets in the VM, nor the sandbox's config folder or the agents' packages", async () => {
    const { home, checkout, surroundings } = homeOfTheOwner();
    const homeAt = (place: string): FolderSurroundings => ({ ...surroundings, places: { ...surroundings.places, home: place } });

    expect(await refusalOf("/mirador/sandbox", homeAt("/mirador"))).toEqual({ kind: "holds-sandbox-files" });
    expect(await refusalOf("/mirador", homeAt("/"))).toEqual({ kind: "holds-sandbox-files" });
    expect(await refusalOf("/run/mirador", homeAt("/run"))).toEqual({ kind: "holds-sandbox-files" });
    expect(await refusalOf("/run/mirador/canvas", homeAt("/run"))).toEqual({ kind: "holds-sandbox-files" });
    expect(await refusalOf(join(home, ".mirador", "sandbox", "room-1"), surroundings)).toEqual({ kind: "hidden-in-home", entry: ".mirador" });
    expect(await refusalOf(folderIn(checkout, "node_modules"), surroundings)).toEqual({ kind: "is-mirador" });
  });

  test("is found as typed, without links, `~` standing for home; a file, a relative path or nothing there is no folder", async () => {
    const { home } = homeOfTheOwner();
    const notes = folderIn(home, "notes");
    symlinkSync(notes, join(home, "notes-link"));
    writeFileSync(join(home, "todo.txt"), "");

    expect(await folderToAdd(`  ${join(home, "notes-link")}  `)).toEqual({ folder: notes });
    expect(await folderToAdd("~")).toEqual({ folder: realpathSync(homedir()) });
    expect(await folderToAdd(join(home, "todo.txt"))).toEqual({ refused: { kind: "not-a-folder" } });
    expect(await folderToAdd(join(home, "gone"))).toEqual({ refused: { kind: "not-a-folder" } });
    expect(await folderToAdd("notes")).toEqual({ refused: { kind: "not-a-folder" } });
  });

  test("is looked at again as the VM starts: one gone is missing, one turned into a link or now refused is left out, and the others are mounted", async () => {
    const { home, surroundings } = homeOfTheOwner();
    const notes = folderIn(home, "notes");
    const deep = folderIn(home, "notes", "deep");
    const elsewhere = folderIn(home, "elsewhere");
    const linked = join(home, "linked");
    symlinkSync(elsewhere, linked);
    const added = (path: string, addedAt: number): SandboxFolder => ({ path, writable: false, addedAt });

    const keys = folderIn(home, ".ssh");
    const started = await foldersMounted([added(notes, 1), added(deep, 2), added(join(home, "gone"), 3), added(linked, 4), added(keys, 5)], surroundings);

    expect(started.mounted).toEqual([notes]);
    expect(Object.fromEntries(started.leftOut)).toEqual({
      [deep]: { kind: "refused", refusal: { kind: "overlaps-folder", folder: notes } },
      [join(home, "gone")]: { kind: "missing" },
      [linked]: { kind: "refused", refusal: { kind: "now-a-link" } },
      [keys]: { kind: "refused", refusal: { kind: "hidden-in-home", entry: ".ssh" } },
    });
  });
});

describe("the sandbox's VM", () => {
  const ROOM = roomSandbox("room-1");
  const KEY = "sk-ant-the-profiles-own-key-1234";

  function sandboxWithFolders() {
    const { home, surroundings } = homeOfTheOwner();
    let folders: SandboxFolder[] = [];
    const started: SandboxOwner[] = [];
    const host: SandboxHost = {
      dataDir: join(scratch, `data-${crypto.randomUUID()}`),
      workspaceOf: () => surroundings.workspace,
      canvasOf: () => ({ belongs: () => true, tokenOf: () => "token", handle: () => new Response("canvas") }),
      atWork: () => ({ agents: ["builder"], conversationIds: [] }),
      setupChanged: () => {},
      heldChanged: () => {},
      foldersOf: () => folders,
      foldersStarted: (owner) => void started.push(owner),
      places: surroundings.places,
    };
    Bun.spawnSync(["git", "init", "-q", surroundings.workspace!]);
    const cli = new FakeContainerCli();
    const sandboxes = new Sandboxes(new AppleContainer(cli, { available: true, kind: "apple-container" }), host, 60_000);
    const launch = () =>
      sandboxes.launch({
        owner: ROOM,
        allowsSharedKernel: false,
        profileId: "builder",
        claudeCodeVersion: "2.1.330",
        workingDirectory: surroundings.workspace!,
        given: { ANTHROPIC_API_KEY: KEY },
        route: { upstream: "https://api.anthropic.com", keyVariable: "ANTHROPIC_API_KEY", key: KEY, customHeaders: "" },
        agent: ["/usr/local/bin/bun", "agent.js"],
      });
    const setFolders = (...paths: string[]) => (folders = paths.map((path, index) => ({ path, writable: false, addedAt: index })));
    const mounts = (run: string[]) => run.filter((_, index) => run[index - 1] === "-v");
    return { home, cli, sandboxes, launch, setFolders, started, mounts };
  }

  test("mounts each added folder read-only at its own path, says where each stands, and runs on with other folders while an agent works", async () => {
    const { home, cli, sandboxes, launch, setFolders, started, mounts } = sandboxWithFolders();
    const notes = folderIn(home, "notes");
    const docs = folderIn(home, "docs");
    setFolders(notes, join(home, "gone"));

    const first = await launch();

    const [run] = cli.callsOf("run");
    expect(mounts(run!)).toContain(`${notes}:${notes}:ro`);
    expect(mounts(run!).some((mount) => mount.startsWith(join(home, "gone")))).toBe(false);
    expect(started).toEqual([ROOM]);
    expect(sandboxes.mountedFolders(ROOM)).toEqual([notes]);
    expect(sandboxes.folderStateOf(ROOM, notes)).toEqual({ kind: "in-sandbox" });
    expect(sandboxes.folderStateOf(ROOM, join(home, "gone"))).toEqual({ kind: "missing" });
    expect(sandboxes.runsWithOtherFolders(ROOM)).toBe(false);

    setFolders(notes, docs);
    expect(sandboxes.runsWithOtherFolders(ROOM)).toBe(true);
    expect(sandboxes.folderStateOf(ROOM, docs)).toEqual({ kind: "waiting" });
    const second = await launch();
    expect(cli.callsOf("run")).toHaveLength(1);

    first.gone!();
    second.gone!();
    await launch();
    const [, restarted] = cli.callsOf("run");
    expect(mounts(restarted!)).toEqual(expect.arrayContaining([`${notes}:${notes}:ro`, `${docs}:${docs}:ro`]));
    expect(sandboxes.folderStateOf(ROOM, docs)).toEqual({ kind: "in-sandbox" });
    expect(sandboxes.runsWithOtherFolders(ROOM)).toBe(false);
    await sandboxes.stopAll();
    expect(sandboxes.mountedFolders(ROOM)).toEqual([]);
  });
});

const SANDBOX_ON: SandboxSetting = { on: true, workFreely: true, allowsSharedKernel: false };
const BUILDER = { harness: "claude" as const, profileId: "builder" };

const builder: Profile = {
  id: "builder",
  name: "Builder",
  harness: "claude",
  environment: "ANTHROPIC_API_KEY=sk-ant-kept-on-this-mac\nCLAUDE_CODE_EXECUTABLE=/bin/false",
  prelaunch: "",
  model: null,
  mode: null,
  effort: null,
  bypassPermissions: false,
  askMode: "wait",
  color: null,
  pluginsOff: [],
  createdAt: 1,
};

type Inside = {
  agentProcesses: Map<string, unknown>;
  sandboxStarts: WeakMap<object, object>;
  sessionSetupOf(conversation: Conversation): string | null;
};
const inside = (conversations: ConversationService) => conversations as unknown as Inside;

async function until(condition: () => boolean, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("timed out waiting");
    await Bun.sleep(10);
  }
}

interface SessionRequest {
  sessionId?: string;
  additionalDirectories?: string[];
  _meta: { systemPrompt: { append: string } };
}

/** An agent process in the sandbox's VM that resumes sessions and takes folders beside its workspace, its turns held until let go where asked. */
function agentInVm(sessionId: string) {
  const opened: { how: "new" | "resume"; request: SessionRequest }[] = [];
  let prompts = 0;
  let stops = 0;
  let holdsTurns = false;
  let letTurnGo = () => {};
  const agent = {
    spec: { id: "claude", label: "Claude Code", environment: {} },
    start: async () => ({ agentCapabilities: { sessionCapabilities: { resume: {}, additionalDirectories: {} } } }),
    takesAdditionalDirectories: async () => true,
    newSession: async (request: SessionRequest) => {
      opened.push({ how: "new", request });
      return { sessionId, configOptions: [] };
    },
    resumeSession: async (request: SessionRequest) => {
      opened.push({ how: "resume", request });
      return { configOptions: [] };
    },
    setConfigOption: async () => ({ configOptions: [] }),
    prompt: async () => {
      prompts += 1;
      if (holdsTurns) await new Promise<void>((resolve) => (letTurnGo = resolve));
      return { stopReason: "end_turn" };
    },
    cancel: async () => letTurnGo(),
    closeSession: async () => {},
    stop: async () => {
      stops += 1;
      letTurnGo();
    },
  };
  return {
    agent,
    opened,
    prompts: () => prompts,
    stops: () => stops,
    holdTurns: () => (holdsTurns = true),
    letTurnGo: () => letTurnGo(),
  };
}

/**
 * A sandboxed workspace whose conversations' agents run on stand-ins for their processes in its VM. Stopping the VM
 * puts fresh ones where the next VM's processes would be, as starting it again would.
 */
function sandboxedWorkspace() {
  const project = folderIn(scratch, `project-${crypto.randomUUID()}`);
  Bun.spawnSync(["git", "init", "-q", project]);
  const store = new Store(":memory:");
  store.saveProfile(builder);
  store.insertWorkspace({ id: "w1", name: "project", path: project, defaultLaunch: BUILDER, createdAt: 1 });
  store.setWorkspaceSandbox("w1", SANDBOX_ON);
  const config = loadConfig({ MIRADOR_DATA_DIR: join(scratch, `data-${crypto.randomUUID()}`) });
  const hub = new Hub();
  const conversations = new ConversationService(store, hub, config, { mute: () => {}, unmute: () => {} } as never, {} as never, {} as never, new SystemNotifications(store, hub));
  const owner = workspaceSandbox("w1");
  const vm = { mounted: [] as string[], otherFolders: false, stops: 0 };
  const agents = new Map<string, ReturnType<typeof agentInVm>[]>();
  const keyOf = (conversationId: string) => agentProcessKey(builder, store.findConversation(conversationId)!, true);
  const putAgent = (conversationId: string) => {
    const agent = agentInVm(`session-of-${conversationId}`);
    inside(conversations).agentProcesses.set(keyOf(conversationId), agent.agent);
    inside(conversations).sandboxStarts.set(agent.agent, {});
    agents.set(conversationId, [...(agents.get(conversationId) ?? []), agent]);
    return agent;
  };
  const sandboxes: SandboxedAgents = {
    ...NO_SANDBOXES,
    confirmedRunning: () => true,
    mountedFolders: () => vm.mounted,
    runsWithOtherFolders: () => vm.otherFolders,
    stop: async () => {
      vm.stops += 1;
      vm.otherFolders = false;
      vm.mounted = store.sandboxFoldersOf(owner).map(({ path }) => path);
      [...agents.keys()].forEach(putAgent);
    },
  };
  conversations.startsSandboxedAgentsIn(sandboxes);
  const conversationOnItsAgent = async () => {
    const conversation = conversations.create("w1", BUILDER);
    await until(() => conversations.get(conversation.id).status === "error");
    return { id: conversation.id, agent: putAgent(conversation.id) };
  };
  const latestAgentOf = (conversationId: string) => agents.get(conversationId)!.at(-1)!;
  const addFolder = (path: string) => {
    store.addSandboxFolder(owner, { path, writable: false, addedAt: Date.now() });
    vm.otherFolders = true;
    return conversations.sandboxFoldersChanged(owner);
  };
  return { store, conversations, owner, vm, conversationOnItsAgent, latestAgentOf, addFolder };
}

describe("a change of a sandbox's folders", () => {
  test("waits for the turn at work, holds new turns at their start, then restarts the VM, and each agent resumes its own session there with the folders", async () => {
    const { store, conversations, owner, vm, conversationOnItsAgent, latestAgentOf, addFolder } = sandboxedWorkspace();
    const working = await conversationOnItsAgent();
    const waiting = await conversationOnItsAgent();
    await conversations.send(working.id, "first");
    await conversations.send(waiting.id, "first");
    const sessionsBefore = [working.id, waiting.id].map((id) => store.findConversation(id)!.acpSessionId!);
    const setupBefore = store.setupOfSession(working.id);
    working.agent.holdTurns();
    void conversations.send(working.id, "a long task");
    await until(() => working.agent.prompts() === 2);

    const taken = addFolder("/Users/owner/notes");
    void conversations.send(waiting.id, "next");
    await until(() => conversations.get(waiting.id).busyWith === "waiting-for-sandbox-folders");

    expect(conversations.waitsForSandboxFolders(owner)).toBe(true);
    expect(vm.stops).toBe(0);
    expect(waiting.agent.prompts()).toBe(1);
    working.agent.letTurnGo();
    await taken;
    await until(() => latestAgentOf(waiting.id).prompts() === 1);

    expect(vm.stops).toBe(1);
    expect(conversations.waitsForSandboxFolders(owner)).toBe(false);
    expect([working.agent.stops(), waiting.agent.stops()]).toEqual([1, 1]);
    const resumed = latestAgentOf(waiting.id).opened;
    expect(resumed.map(({ how, request }) => [how, request.sessionId])).toEqual([["resume", sessionsBefore[1]]]);
    expect(resumed[0]!.request.additionalDirectories).toEqual(["/Users/owner/notes"]);
    expect(resumed[0]!.request._meta.systemPrompt.append).toContain("- /Users/owner/notes");
    await conversations.send(working.id, "and now");
    expect(latestAgentOf(working.id).opened.map(({ how, request }) => [how, request.sessionId])).toEqual([["resume", sessionsBefore[0]]]);
    expect([working.id, waiting.id].map((id) => store.findConversation(id)!.acpSessionId)).toEqual(sessionsBefore);
    expect([working.id, waiting.id].flatMap((id) => store.listEventsOfTypes(id, ["context-cleared"]))).toEqual([]);
    expect(store.setupOfSession(working.id)).toBe(setupBefore);
    await conversations.shutdown();
  });

  test("with no turn at work restarts the VM at once; Apply now stops the turns at work for it; a turn stopped while held stops waiting", async () => {
    const { conversations, owner, vm, conversationOnItsAgent, latestAgentOf, addFolder } = sandboxedWorkspace();
    const idle = await conversationOnItsAgent();
    await conversations.send(idle.id, "first");

    await addFolder("/Users/owner/notes");
    expect(vm.stops).toBe(1);
    expect(idle.agent.stops()).toBe(1);

    const busy = latestAgentOf(idle.id);
    busy.holdTurns();
    void conversations.send(idle.id, "a long task");
    await until(() => busy.prompts() === 1);
    const held = await conversationOnItsAgent();
    const taken = addFolder("/Users/owner/docs");
    void conversations.send(held.id, "held");
    await until(() => conversations.get(held.id).busyWith === "waiting-for-sandbox-folders");
    await conversations.cancel(held.id);
    await until(() => conversations.get(held.id).status === "idle");
    expect(conversations.waitsForSandboxFolders(owner)).toBe(true);

    conversations.applySandboxFoldersNow(owner);
    await taken;
    expect(vm.stops).toBe(2);
    expect(vm.mounted).toEqual(["/Users/owner/notes", "/Users/owner/docs"]);
    await conversations.shutdown();
  });

  test("a VM that doesn't run, or already runs with the folders, waits for nothing", async () => {
    const { conversations, owner, vm, conversationOnItsAgent, addFolder } = sandboxedWorkspace();
    const conversation = await conversationOnItsAgent();
    await conversations.send(conversation.id, "first");

    await addFolder("/Users/owner/notes").then(() => conversations.sandboxFoldersChanged(owner));
    vm.otherFolders = false;
    await conversations.sandboxFoldersChanged(owner);

    expect(vm.stops).toBe(1);
    expect(conversations.waitsForSandboxFolders(owner)).toBe(false);
    await conversations.shutdown();
  });
});

describe("the folders added to a sandbox", () => {
  test("stay out of what a session is started under, so adding one never starts an agent afresh", async () => {
    const { store, conversations, owner } = sandboxedWorkspace();
    store.insertRoom({ id: "r1", name: "Launch", workspaceId: "w1", agents: [], people: [], permissions: DEFAULT_PERMISSION_PRESET, peoplesTasksWait: true, claudeSetup: ALL_OF_CLAUDE_SETUP, agentsReadGuests: true, membersBringAgents: true, sandbox: SANDBOX_ON, createdAt: 1 });
    const conversation = conversations.create("w1", BUILDER);
    const inRoom = { ...conversation, roomId: "r1" };
    const setups = () => [inside(conversations).sessionSetupOf(conversation), inside(conversations).sessionSetupOf(inRoom)];
    const before = setups();

    store.addSandboxFolder(owner, { path: "/Users/owner/notes", writable: false, addedAt: 1 });
    store.addSandboxFolder(roomSandbox("r1"), { path: "/Users/owner/docs", writable: false, addedAt: 1 });

    expect(setups()).toEqual(before);
    expect(JSON.stringify([store.findWorkspace("w1"), store.findRoom("r1")])).not.toContain("/Users/owner");
    await conversations.shutdown();
  });

  test("go with their room or workspace", () => {
    const store = new Store(":memory:");
    store.insertWorkspace({ id: "w1", name: "project", path: "/p", defaultLaunch: BUILDER, createdAt: 1 });
    const room = (id: string) => ({ id, name: id, workspaceId: "w1", agents: [], people: [], permissions: DEFAULT_PERMISSION_PRESET, peoplesTasksWait: true, claudeSetup: ALL_OF_CLAUDE_SETUP, agentsReadGuests: true, membersBringAgents: true, sandbox: NO_SANDBOX, createdAt: 1 });
    store.insertRoom(room("r1"));
    store.insertRoom(room("r2"));
    const add = (owner: SandboxOwner, path: string) => store.addSandboxFolder(owner, { path, writable: false, addedAt: 1 });
    add(workspaceSandbox("w1"), "/home/me/a");
    add(roomSandbox("r1"), "/home/me/b");
    add(roomSandbox("r2"), "/home/me/c");

    store.deleteRoom("r1");
    expect(store.ownersWithSandboxFolders()).toEqual(expect.arrayContaining([workspaceSandbox("w1"), roomSandbox("r2")]));
    expect(store.sandboxFoldersOf(roomSandbox("r1"))).toEqual([]);
    store.deleteWorkspace("w1");
    expect(store.ownersWithSandboxFolders()).toEqual([]);
  });

  test("are told to a Claude agent as read-only, in and out of rooms, and nothing is said where there are none", () => {
    const guidance = "# Folders from the owner's computer";
    expect(claudeSessionMeta("often", { sandboxFolders: ["/home/me/notes"] }).systemPrompt.append).toContain(`${guidance}\n`);
    expect(claudeRoomSessionMeta("as-needed", { sandboxFolders: ["/home/me/notes"] }).systemPrompt.append).toMatch(/read-only[\s\S]*- \/home\/me\/notes$/);
    expect(claudeSessionMeta("often").systemPrompt.append).not.toContain(guidance);
    expect(claudeRoomSessionMeta("as-needed").systemPrompt.append).toBe("");
  });
});
