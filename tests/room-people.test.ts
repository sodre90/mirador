import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { freePorts } from "../e2e/free-ports.ts";
import { DeviceService } from "../host/devices.ts";
import { Store } from "../host/store.ts";
import { PROBLEM_HEADER } from "../shared/host-problems.ts";
import type { Person, Profile, Workspace } from "../shared/model.ts";
import { PERSON_MESSAGE_TYPES } from "../shared/person-messages.ts";
import { TOKEN_COOKIE, type ClientMessage, type ServerMessage } from "../shared/protocol.ts";
import type { Room, RoomThread } from "../shared/rooms.ts";

/**
 * A real host, with the owner and three other people of the machine, each signed in on a device of their own: Mia and
 * Gus, whom the owner lets into a room, and Stan, who is in none. What they send and what reaches them is checked against
 * what the owner does meanwhile.
 */

const repoRoot = join(import.meta.dirname, "..");
const root = mkdtempSync(join(tmpdir(), "mirador-room-people-"));
const dataDir = join(root, "data");
const projectDir = join(root, "project");
const fakePrograms = join(root, "fake-programs");
const promptsFile = join(root, "prompts.txt");
const STEP_MS = 15_000;
const SETTLE_MS = 400;
const PRELAUNCH_SECRET = "owner-prelaunch-secret";
const PLUGIN_OFF_SECRET = "owner-plugin-off-secret";

/** Every message a page can send; a type missing here does not compile. */
const EVERY_CLIENT_MESSAGE: Record<ClientMessage["type"], true> = {
  "workspace.create": true,
  "workspace.delete": true,
  "workspace.set-default-launch": true,
  "workspace.move": true,
  "workspace.set-color": true,
  "workspace.set-worktree-settings": true,
  "workspace-group.create": true,
  "workspace-group.rename": true,
  "workspace-group.move": true,
  "workspace-group.delete": true,
  "profile.save": true,
  "profile.delete": true,
  "profile.turn-plugin": true,
  "profile.choices.get": true,
  "profile.test": true,
  "plugin.check-profile": true,
  "prompt-template.save": true,
  "prompt-template.delete": true,
  "settings.set-canvas-use": true,
  "settings.set-keep-awake": true,
  "settings.set-reminder-morning": true,
  "settings.set-conversation-order": true,
  "settings.set-keep-deleted-canvas": true,
  "settings.set-older-after": true,
  "settings.set-conversations-shown": true,
  "settings.set-claude-program": true,
  "newer-version.check": true,
  "newer-version.pull": true,
  "settings.set-script-program": true,
  "settings.set-editor": true,
  "settings.set-machine-name": true,
  "settings.set-push-relay": true,
  "push.register": true,
  "push.unregister": true,
  "notification.shown": true,
  "settings.set-avatar": true,
  "person.set-own-profile": true,
  "conversation.create": true,
  "conversation.move": true,
  "sessions.list": true,
  "sessions.search": true,
  "slash-commands.list": true,
  "prompt-history.list": true,
  "mentions.suggest": true,
  "conversation.adopt": true,
  "conversation.fork": true,
  "conversation.check-fork": true,
  "conversation.side-chat.start": true,
  "conversation.side-chat.promote": true,
  "conversation.delete": true,
  "conversations.delete": true,
  "conversation.rename": true,
  "conversation.set-favourite": true,
  "conversation.set-unread": true,
  "conversation.set-reminder": true,
  "conversation.set-profile": true,
  "conversation.subscribe": true,
  "conversation.load-earlier": true,
  "conversation.find": true,
  "tool-raw-output.get": true,
  "tool-output.get": true,
  "conversation.unsubscribe": true,
  "conversation.prompt": true,
  "conversation.cancel": true,
  "conversation.revert-preview": true,
  "conversation.revert": true,
  "conversation.rewind-preview": true,
  "conversation.rewind": true,
  "conversation.run-command": true,
  "conversation.stop-command": true,
  "conversation.drop-command-outputs": true,
  "conversation.queue.remove": true,
  "images.discard": true,
  "conversation.queue.move": true,
  "conversation.queue.set-after-turn": true,
  "conversation.usage-limit.continue": true,
  "conversation.try-again": true,
  "conversation.usage-limit.stop-waiting": true,
  "conversation.job-wait.stop": true,
  "conversation.async-task.stop": true,
  "conversation.async-task.dismiss": true,
  "conversation.async-task.clear-finished": true,
  "conversation.delegation.dismiss": true,
  "conversation.delegation.clear-finished": true,
  "async-task.output.get": true,
  "conversation.set-ask-mode": true,
  "conversation.set-plugin-setting": true,
  "conversation.set-bypass-permissions": true,
  "conversation.set-config": true,
  "permission.respond": true,
  "ask.answer": true,
  "canvas.report": true,
  "app.subscribe": true,
  "app.unsubscribe": true,
  "app.apply": true,
  "app.use-in": true,
  "app.storage-set": true,
  "app.run": true,
  "app.open-file": true,
  "app.stop-task": true,
  "canvas.item-action": true,
  "canvas.run-command": true,
  "plugin-window.subscribe": true,
  "plugin-window.action": true,
  "plugin-tab.subscribe": true,
  "plugin-tab.action": true,
  "canvas.dismiss": true,
  "canvas.export": true,
  "canvas.save-to-project": true,
  "canvas.save-image-to-project": true,
  "changes.list": true,
  "changes.diff": true,
  "changes.files": true,
  "changes.committable": true,
  "changes.commit": true,
  "changes.landable": true,
  "changes.land": true,
  "changes.open-in-editor": true,
  "files.open": true,
  "fs.complete": true,
  "statusline.render": true,
  "subagent-usage.get": true,
  "terminals.attach": true,
  "terminal.open": true,
  "terminal.replay": true,
  "terminal.open-login": true,
  "terminal.follow-job": true,
  "terminal.open-panel-command": true,
  "terminal.input": true,
  "terminal.resize": true,
  "terminal.close": true,
  "terminal.close-tab": true,
  "terminal.clear": true,
  "presence": true,
  "ping": true,
  "page.error": true,
  "host.restart": true,
  "devices.list": true,
  "plugins.list": true,
  "plugins.choose-setting": true,
  "plugins.offer": true,
  "plugins.offer-update": true,
  "plugins.install": true,
  "plugins.discard": true,
  "plugins.find-commits": true,
  "plugins.remove": true,
  "settings.set-plugin-update-mode": true,
  "plugins.set-updates-by-itself": true,
  "plugins.undo-update": true,
  "devices.invite": true,
  "address.find": true,
  "address.serve": true,
  "device.revoke": true,
  "join-request.approve": true,
  "join-request.deny": true,
  "settings.set-public-address": true,
  "settings.set-network": true,
  "voice.set-settings": true,
  "voice.engine.set-up": true,
  "voice.engine.cancel": true,
  "voice.engine.remove": true,
  "voice.engine.remove-model": true,
  "machine.add": true,
  "machine.remove": true,
  "machine.set-color": true,
  "machine.hide": true,
  "machine.show-again": true,
  "machine.join": true,
  "machine.ask-to-join": true,
  "search": true,
  "room.create": true,
  "room.rename": true,
  "room.set-agents": true,
  "room.set-permissions": true,
  "room.set-person-role": true,
  "room.remove-person": true,
  "room.approve": true,
  "room.delete": true,
  "room.subscribe": true,
  "room.unsubscribe": true,
  "room.write": true,
};

/** All a person other than the owner may get from the host. */
const SHOWN_TO_PEOPLE = new Set<ServerMessage["type"]>(["snapshot", "people.listed", "profile.upserted", "room.upserted", "room.deleted", "room.timeline", "room.message", "canvas.upserted", "error", "pong"]);

type Snapshot = Extract<ServerMessage, { type: "snapshot" }>;
type ProblemError = Extract<ServerMessage, { type: "error" }>;

const problemCode = (message: ServerMessage) => (message.type === "error" ? (message as ProblemError).problem?.code : undefined);

class Page {
  readonly received: ServerMessage[] = [];
  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener("message", (event) => this.received.push(JSON.parse(String(event.data)) as ServerMessage));
  }

  static open(port: number, token: string, path = "/ws") {
    const socket = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers: { Cookie: `${TOKEN_COOKIE}=${token}`, Origin: `http://127.0.0.1:${port}` } } as unknown as string[]);
    const page = new Page(socket);
    return new Promise<Page>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(page));
      socket.addEventListener("error", () => reject(new Error("The page could not connect.")));
    });
  }

  send(message: unknown) {
    this.socket.send(typeof message === "string" ? message : JSON.stringify(message));
  }

  get mark() {
    return this.received.length;
  }

  /** The first message since `after` that `pick` takes. */
  async waitFor<T extends ServerMessage>(pick: (message: ServerMessage) => message is T, after = 0, timeoutMs = STEP_MS): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const found = this.received.slice(after).find(pick);
      if (found) return found;
      await Bun.sleep(20);
    }
    throw new Error(`No such message came; since then: ${this.received.slice(after).map(({ type }) => type).join(", ")}`);
  }

  async waitForError(code: string, after: number) {
    return this.waitFor((message): message is ProblemError => problemCode(message) === code, after);
  }

  async waitForErrors(code: string, count: number, after: number) {
    const errors = () => this.received.slice(after).filter((message) => problemCode(message) === code).length;
    const deadline = Date.now() + STEP_MS;
    while (errors() < count && Date.now() < deadline) await Bun.sleep(20);
    expect(errors()).toBe(count);
  }

  /** What came since `after`, once nothing more is on its way. */
  async settledSince(after: number) {
    await Bun.sleep(SETTLE_MS);
    return this.received.slice(after);
  }

  get snapshot() {
    return this.received.find((message): message is Snapshot => message.type === "snapshot")!;
  }

  close() {
    this.socket.close();
  }
}

const isType =
  <K extends ServerMessage["type"]>(type: K, matches: (message: Extract<ServerMessage, { type: K }>) => boolean = () => true) =>
  (message: ServerMessage): message is Extract<ServerMessage, { type: K }> =>
    message.type === type && matches(message as Extract<ServerMessage, { type: K }>);

let host: ChildProcess;
let hostOutput = "";
let port = 0;
let profile: Profile;
let workspace: Workspace;
const mia: Person = { id: crypto.randomUUID(), name: "Mia", color: "mint" };
const gus: Person = { id: crypto.randomUUID(), name: "Gus", color: "sky" };
const stan: Person = { id: crypto.randomUUID(), name: "Stan", color: null };
const tokens: Record<string, string> = {};
let owner: Page;
let miaPage: Page;
let gusPage: Page;
let stanPage: Page;
let roomA: Room;
let roomB: Room;
let ownersConversationId = "";
let agentConversationId = "";
let miasThread: RoomThread;

function seed() {
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, "README.md"), "# project\n");
  writeFileSync(promptsFile, "");
  mkdirSync(fakePrograms, { recursive: true });
  writeFileSync(join(fakePrograms, "opencode"), `#!/bin/sh\nexec bun '${join(repoRoot, "e2e", "fake-acp-agent.ts")}' "$@"\n`);
  chmodSync(join(fakePrograms, "opencode"), 0o755);
  const store = new Store(join(dataDir, "state.sqlite"));
  profile = { id: crypto.randomUUID(), name: "Builder", harness: "opencode", environment: `FAKE_ACP_PROMPTS=${promptsFile}`, prelaunch: `echo ${PRELAUNCH_SECRET}`, model: null, mode: null, effort: null, bypassPermissions: false, askMode: "wait", color: null, pluginsOff: [PLUGIN_OFF_SECRET], createdAt: Date.now() };
  store.saveProfile(profile);
  workspace = store.insertWorkspace({ id: crypto.randomUUID(), name: "project", path: projectDir, defaultLaunch: { harness: "opencode", profileId: profile.id }, createdAt: Date.now() });
  const devices = new DeviceService(store);
  [mia, gus, stan].forEach((person) => {
    store.insertPerson(person);
    tokens[person.id] = devices.admit(`${person.name}'s laptop`, person.id).token;
  });
  store.close();
}

/** The host's own environment, none of the MIRADOR_ settings of the one running the tests. */
function hostEnvironment() {
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("MIRADOR_")));
  return {
    ...inherited,
    PATH: `${fakePrograms}:${process.env.PATH}`,
    CLAUDE_CONFIG_DIR: join(root, "claude-config"),
    SHELL: "/bin/sh",
    MIRADOR_PORT: String(port),
    MIRADOR_DATA_DIR: dataDir,
    MIRADOR_NETWORK: "off",
    MIRADOR_TAILSCALE: join(root, "no-tailscale-on-this-machine"),
    MIRADOR_NOTIFIER_DIR: join(root, "notifier"),
    MIRADOR_TEST_SKIP_USER_SETTINGS: "1",
    MIRADOR_STATUSLINE: "off",
    MIRADOR_NEWER_VERSION_CHECK: "off",
    MIRADOR_PLUGIN_UPDATE_CHECK: "off",
    MIRADOR_SOURCE_WATCH: "off",
    MIRADOR_PLUGIN_CATALOG: "off",
    MIRADOR_PI_RELEASE_URL: "off",
    MIRADOR_DEFAULT_PLUGINS: "off",
    MIRADOR_PUSH_RELAY: "off",
  };
}

async function startHost() {
  port = await freePorts(4);
  host = spawn("bun", ["host/main.ts"], { cwd: repoRoot, env: hostEnvironment(), stdio: ["ignore", "pipe", "pipe"] });
  const capture = (chunk: Buffer) => void (hostOutput += chunk);
  host.stdout!.on("data", capture);
  host.stderr!.on("data", capture);
  const deadline = Date.now() + 20_000;
  while (!hostOutput.includes("Mirador is running")) {
    if (Date.now() > deadline || host.exitCode !== null) throw new Error(`The host did not start:\n${hostOutput.split("\n").filter((line) => !line.includes("auth?token")).join("\n")}`);
    await Bun.sleep(100);
  }
}

async function ownerCreatesRoom(name: string) {
  const mark = owner.mark;
  owner.send({ type: "room.create", requestId: name, name, workspaceId: workspace.id, profileIds: [profile.id], permissions: "read-freely" });
  const { roomId } = await owner.waitFor(isType("room.created", ({ requestId }) => requestId === name), mark);
  return (await owner.waitFor(isType("room.upserted", ({ room }) => room.id === roomId), mark)).room;
}

async function ownerWritesIn(room: Room, text: string, tags: string[] = []) {
  const mark = owner.mark;
  owner.send({ type: "room.write", roomId: room.id, text, tags, threadId: null });
  return (await owner.waitFor(isType("room.message", ({ message }) => message.text === text), mark)).message;
}

const roomMessageSaying = (text: string) => isType("room.message", ({ message }) => message.text === text);

beforeAll(async () => {
  seed();
  await startHost();
  owner = await Page.open(port, readFileSync(join(dataDir, "browser-token"), "utf8").trim());
  await owner.waitFor(isType("snapshot"));
  roomA = await ownerCreatesRoom("Launch");
  roomB = await ownerCreatesRoom("Payroll");
  owner.send({ type: "room.subscribe", roomId: roomA.id });
  owner.send({ type: "room.subscribe", roomId: roomB.id });
  const mark = owner.mark;
  owner.send({ type: "conversation.create", workspaceId: workspace.id, prompt: "SAY The owner's own work" });
  ownersConversationId = (await owner.waitFor(isType("conversation.upserted", ({ conversation }) => conversation.roomId === undefined || conversation.roomId === null), mark)).conversation.id;
  [miaPage, gusPage, stanPage] = await Promise.all([mia, gus, stan].map((person) => Page.open(port, tokens[person.id]!)));
  await Promise.all([miaPage, gusPage, stanPage].map((page) => page.waitFor(isType("snapshot"))));
}, 60_000);

afterAll(async () => {
  [owner, miaPage, gusPage, stanPage].forEach((page) => page?.close());
  if (host && host.exitCode === null) {
    const exited = new Promise((resolve) => host.once("exit", resolve));
    host.kill("SIGTERM");
    await Promise.race([exited, Bun.sleep(8_000)]);
    if (host.exitCode === null) host.kill("SIGKILL");
  }
  rmSync(root, { recursive: true, force: true });
}, 20_000);

describe("a person other than the owner", () => {
  test("starts with a snapshot of nothing but themselves and the owner, before the owner lets them into a room", () => {
    [miaPage, gusPage, stanPage].forEach((page, index) => {
      const person = [mia, gus, stan][index]!;
      const snapshot = page.snapshot;
      expect(snapshot.you).toBe(person.id);
      expect(snapshot.rooms).toEqual([]);
      expect(snapshot.workspaces).toEqual([]);
      expect(snapshot.conversations).toEqual([]);
      expect(snapshot.profiles).toEqual([]);
      expect(snapshot.roomApprovals).toEqual([]);
      expect(snapshot.homeDir).toBe("");
      expect(snapshot.people.map(({ id }) => id).toSorted()).toEqual([snapshot.ownerId, person.id].toSorted());
    });
  });

  test("is shown a room on their open page as soon as the owner lets them in, with only themselves among its people", async () => {
    const [miaMark, gusMark] = [miaPage.mark, gusPage.mark];
    owner.send({ type: "room.set-person-role", roomId: roomA.id, personId: mia.id, role: "member" });
    owner.send({ type: "room.set-person-role", roomId: roomA.id, personId: gus.id, role: "guest" });
    const shownToMia = (await miaPage.waitFor(isType("room.upserted", ({ room }) => room.people.some(({ personId }) => personId === mia.id)), miaMark)).room;
    expect(shownToMia).toMatchObject({ id: roomA.id, name: "Launch", workspaceId: "", people: [{ personId: mia.id, role: "member" }] });
    const shownToGus = await gusPage.waitFor(isType("room.upserted", ({ room }) => room.people.some(({ personId, role }) => personId === gus.id && role === "guest")), gusMark);
    expect(shownToGus.room.people).toEqual([{ personId: gus.id, role: "guest" }]);
    for (const [page, mark] of [[miaPage, miaMark], [gusPage, gusMark]] as const) {
      const { profile: agent } = await page.waitFor(isType("profile.upserted", ({ profile: shown }) => shown.id === profile.id), mark);
      expect(agent).toEqual({ ...profile, environment: "", prelaunch: "", pluginsOff: [], createdAt: 0 });
    }
    const people = await miaPage.waitFor(isType("people.listed", ({ people }) => people.some(({ id }) => id === gus.id)), miaMark);
    expect(people.people.map(({ id }) => id)).not.toContain(stan.id);
    const owners = await owner.waitFor(isType("room.upserted", ({ room }) => room.people.length === 2));
    expect(owners.room.people).toEqual([{ personId: mia.id, role: "member" }, { personId: gus.id, role: "guest" }]);
  });

  test("reads and writes in their room, and in no other", async () => {
    let mark = miaPage.mark;
    miaPage.send({ type: "room.subscribe", roomId: roomA.id });
    await miaPage.waitFor(isType("room.timeline", ({ roomId }) => roomId === roomA.id), mark);
    miaPage.send({ type: "room.write", roomId: roomA.id, text: "Hello from Mia", tags: [], threadId: null });
    await miaPage.waitFor(roomMessageSaying("Hello from Mia"), mark);
    await owner.waitFor(roomMessageSaying("Hello from Mia"));
    mark = miaPage.mark;
    miaPage.send({ type: "room.subscribe", roomId: roomB.id });
    await miaPage.waitForError("room-gone", mark);
    mark = miaPage.mark;
    miaPage.send({ type: "room.write", roomId: roomB.id, text: "Mia in payroll", tags: [], threadId: null });
    await miaPage.waitForError("room-gone", mark);
    mark = miaPage.mark;
    await ownerWritesIn(roomB, "Payroll is private");
    await ownerWritesIn(roomA, "The owner in Launch");
    await miaPage.waitFor(roomMessageSaying("The owner in Launch"), mark);
    expect((await miaPage.settledSince(mark)).some(roomMessageSaying("Payroll is private"))).toBe(false);
    expect(JSON.stringify(await owner.settledSince(0))).not.toContain("Mia in payroll");
  });

  test("as a guest writes, but tags no agent and follows up in no thread; as a member does both", async () => {
    let gusMark = gusPage.mark;
    gusPage.send({ type: "room.subscribe", roomId: roomA.id });
    await gusPage.waitFor(isType("room.timeline", ({ roomId }) => roomId === roomA.id), gusMark);
    gusPage.send({ type: "room.write", roomId: roomA.id, text: "Hello from Gus", tags: [], threadId: null });
    await gusPage.waitFor(roomMessageSaying("Hello from Gus"), gusMark);
    gusMark = gusPage.mark;
    gusPage.send({ type: "room.write", roomId: roomA.id, text: "@Builder SAY Gus asks", tags: [profile.id], threadId: null });
    await gusPage.waitForError("room-guests-only-write", gusMark);

    let miaMark = miaPage.mark;
    const show = JSON.stringify({ title: "Launch plan", html: "<h1>Ship on Friday</h1>" });
    miaPage.send({ type: "room.write", roomId: roomA.id, text: `@Builder CANVAS show ${show}`, tags: [profile.id], threadId: null });
    const tagged = await miaPage.waitFor(isType("room.message", ({ message }) => message.tags.includes(profile.id)), miaMark);
    miasThread = tagged.threads[0]!;
    const canvasItem = await miaPage.waitFor(isType("canvas.upserted", ({ item }) => item.kind === "show"), miaMark);
    agentConversationId = canvasItem.item.conversationId;
    await miaPage.waitFor(isType("room.message", ({ message }) => message.answers === tagged.message.id && "profileId" in message.author), miaMark);
    expect(JSON.stringify(gusPage.received)).not.toContain("Gus asks");

    gusMark = gusPage.mark;
    gusPage.send({ type: "room.write", roomId: roomA.id, text: "Gus follows up", tags: [], threadId: miasThread.id });
    await gusPage.waitForError("room-guests-only-write", gusMark);
    miaMark = miaPage.mark;
    miaPage.send({ type: "room.write", roomId: roomA.id, text: "SAY Mia's follow-up answered", tags: [], threadId: miasThread.id });
    await miaPage.waitFor(roomMessageSaying("Mia's follow-up answered"), miaMark);
    await gusPage.waitFor(roomMessageSaying("Mia's follow-up answered"), gusMark);
    expect(JSON.stringify(stanPage.received)).not.toContain(roomA.id);
  }, 40_000);

  test("approves nothing a room's agent asks, as a member or as a guest", async () => {
    const ownerMark = owner.mark;
    const asked = JSON.stringify([{ kind: "execute", title: "Run ls", command: "ls" }]);
    miaPage.send({ type: "room.write", roomId: roomA.id, text: `@Builder ASK ${asked}`, tags: [profile.id], threadId: null });
    const { approvals } = await owner.waitFor(isType("room.approvals", ({ roomId, approvals }) => roomId === roomA.id && approvals.length === 1), ownerMark);
    const { conversationId, request } = approvals[0]!;
    for (const page of [miaPage, gusPage]) {
      const mark = page.mark;
      page.send({ type: "room.approve", conversationId, permissionId: request.permissionId, answer: "allow" });
      page.send({ type: "permission.respond", conversationId, permissionId: request.permissionId, optionId: request.options[0]?.optionId ?? null });
      await page.waitForErrors("only-the-owner", 2, mark);
    }
    expect((await owner.settledSince(ownerMark)).some(isType("room.approvals", ({ approvals }) => approvals.length === 0))).toBe(false);
    const answered = owner.mark;
    owner.send({ type: "room.approve", conversationId, permissionId: request.permissionId, answer: "deny" });
    await owner.waitFor(isType("room.approvals", ({ approvals }) => approvals.length === 0), answered);
  }, 40_000);

  test("is refused every message type but their own few, whatever it names", async () => {
    const refusedTypes = Object.keys(EVERY_CLIENT_MESSAGE).filter((type) => !(PERSON_MESSAGE_TYPES as readonly string[]).includes(type));
    expect(refusedTypes.length).toBe(Object.keys(EVERY_CLIENT_MESSAGE).length - PERSON_MESSAGE_TYPES.length);
    const naming = {
      requestId: "probe",
      conversationId: agentConversationId,
      conversationIds: [ownersConversationId, agentConversationId],
      workspaceId: workspace.id,
      roomId: roomA.id,
      profileId: profile.id,
      personId: mia.id,
      role: "member",
      path: projectDir,
      text: "probe",
      name: "probe",
      title: "probe",
      prompt: "SAY probe",
      launch: { harness: "opencode", profileId: profile.id },
      permissionId: "probe",
      answer: "allow",
      profileIds: [profile.id],
      permissions: "work-freely",
      tags: [],
      threadId: null,
    };
    for (const page of [miaPage, gusPage, stanPage]) {
      const mark = page.mark;
      refusedTypes.forEach((type) => page.send({ type, ...naming }));
      await page.waitForErrors("only-the-owner", refusedTypes.length, mark);
      const came = await page.settledSince(mark);
      expect(came.every(({ type }) => type === "error")).toBe(true);
    }
    const mark = owner.mark;
    const fresh = await Page.open(port, readFileSync(join(dataDir, "browser-token"), "utf8").trim());
    const { workspaces, rooms, conversations } = await fresh.waitFor(isType("snapshot"));
    fresh.close();
    expect(workspaces.map(({ id }) => id)).toContain(workspace.id);
    expect(rooms.find(({ id }) => id === roomA.id)?.people).toEqual([{ personId: mia.id, role: "member" }, { personId: gus.id, role: "guest" }]);
    expect(rooms.find(({ id }) => id === roomA.id)?.permissions).toBe("read-freely");
    expect(conversations.map(({ id }) => id)).toEqual(expect.arrayContaining([ownersConversationId, agentConversationId]));
    expect((await owner.settledSince(mark)).some(roomMessageSaying("probe"))).toBe(false);
  }, 60_000);

  test("is refused messages the host cannot read, and the ones of theirs that name what is not theirs", async () => {
    const unreadable = ["not json", "{}", JSON.stringify({ type: "toString" }), JSON.stringify({ type: "__proto__" }), JSON.stringify({ type: "room.write", roomId: roomA.id, text: 5, tags: [], threadId: null }), JSON.stringify({ type: "room.write", roomId: roomA.id, text: "x", tags: "all", threadId: null }), JSON.stringify({ type: "room.subscribe", roomId: { id: roomA.id } }), JSON.stringify({ type: "person.set-own-profile", name: ["Mia"], color: null }), JSON.stringify({ type: "person.set-own-profile", name: "Mia", color: "neon" })];
    const mark = miaPage.mark;
    unreadable.forEach((sent) => miaPage.send(sent));
    const deadline = Date.now() + STEP_MS;
    while (miaPage.received.slice(mark).filter(({ type }) => type === "error").length < unreadable.length && Date.now() < deadline) await Bun.sleep(20);
    const came = await miaPage.settledSince(mark);
    expect(came.map(({ type }) => type)).toEqual(unreadable.map(() => "error"));
  });

  test("keeps their own name and colour, and gets a pong", async () => {
    const mark = miaPage.mark;
    miaPage.send({ type: "person.set-own-profile", name: "Mia R", color: "rose" });
    const { people } = await miaPage.waitFor(isType("people.listed", ({ people }) => people.some(({ id, name }) => id === mia.id && name === "Mia R")), mark);
    expect(people.find(({ id }) => id === mia.id)?.color).toBe("rose");
    expect(people.map(({ id }) => id)).not.toContain(stan.id);
    miaPage.send({ type: "ping" });
    await miaPage.waitFor(isType("pong"), mark);
  });

  test("reaches no route of the host's over HTTP but the page itself and joining", async () => {
    const source = readFileSync(join(repoRoot, "host", "server.ts"), "utf8");
    const routesOf = (name: string) => {
      const start = source.indexOf(`const ${name} = refusingPeople({`);
      expect(start).toBeGreaterThan(-1);
      return source.slice(start, source.indexOf("\n  });", start));
    };
    const routeLines = [...`${routesOf("routesForDevices")}\n${routesOf("routesForThisMachine")}`.matchAll(/^\s*"(\/[^"]*)":\s*(.*)$/gm)];
    expect(routeLines.length).toBeGreaterThan(20);
    const open = new Set(["/", "/join", "/join-requests", "/join-requests/:id/reveal", "/join-requests/:id/poll", "/mirador-ca.pem", "/mirador-here", "/auth"]);
    const filled = (path: string) =>
      path
        .replace(":conversationId", agentConversationId)
        .replace(":workspaceId", workspace.id)
        .replace(":app", "media")
        .replace(":imageId", "image")
        .replace(":seq", "1")
        .replace(":index", "0")
        .replace(":sessionId", "session")
        .replace(":id", "request");
    const refused: string[] = [];
    for (const [, path, handler] of routeLines) {
      if (open.has(path!)) continue;
      const methods = handler!.startsWith("{") ? [...handler!.matchAll(/([A-Z]+):/g)].map(([, method]) => method!) : ["GET", "POST"];
      for (const method of methods) {
        const response = await fetch(`http://127.0.0.1:${port}${filled(path!)}`, {
          method,
          headers: { Cookie: `${TOKEN_COOKIE}=${tokens[mia.id]}`, Origin: `http://127.0.0.1:${port}`, "Sec-Fetch-Site": "same-origin" },
          ...(method === "POST" && { body: "{}" }),
        });
        expect({ path, method, status: response.status, problem: decodeURIComponent(response.headers.get(PROBLEM_HEADER) ?? "") }).toEqual({ path, method, status: 403, problem: JSON.stringify({ code: "only-the-owner" }) });
        refused.push(`${method} ${path}`);
      }
    }
    expect(refused).toEqual(expect.arrayContaining(["POST /conversations/:conversationId/images", "GET /conversations/:conversationId/images/:imageId", "GET /workspaces/:workspaceId/apps/:app/file", "POST /tunnel", "GET /devices"]));
    await expect(Page.open(port, tokens[mia.id]!, "/notifications")).rejects.toThrow();
    const page = await fetch(`http://127.0.0.1:${port}/`, { headers: { Cookie: `${TOKEN_COOKIE}=${tokens[mia.id]}` } });
    expect(page.status).toBe(200);
  }, 60_000);

  test("can't follow a room agent's conversation, and hears none of its events", async () => {
    const mark = miaPage.mark;
    miaPage.send({ type: "conversation.subscribe", conversationId: agentConversationId });
    await miaPage.waitForError("only-the-owner", mark);
    miaPage.send({ type: "room.write", roomId: roomA.id, text: "@Builder SAY Busy agent", tags: [profile.id], threadId: null });
    await miaPage.waitFor(roomMessageSaying("Busy agent"), mark);
    const came = await miaPage.settledSince(mark);
    expect(came.some(({ type }) => type.startsWith("conversation."))).toBe(false);
  }, 30_000);

  test("loses what a role took away, and a room they were taken out of, on the page they have open", async () => {
    let gusMark = gusPage.mark;
    owner.send({ type: "room.set-person-role", roomId: roomA.id, personId: gus.id, role: "member" });
    await gusPage.waitFor(isType("room.upserted", ({ room }) => room.people[0]?.role === "member"), gusMark);
    gusPage.send({ type: "room.write", roomId: roomA.id, text: "@Builder SAY Gus is a member now", tags: [profile.id], threadId: null });
    await gusPage.waitFor(isType("room.message", ({ message }) => message.text.includes("Gus is a member now") && message.tags.length === 1), gusMark);

    let miaMark = miaPage.mark;
    owner.send({ type: "room.set-person-role", roomId: roomA.id, personId: mia.id, role: "guest" });
    await miaPage.waitFor(isType("room.upserted", ({ room }) => room.people[0]?.role === "guest"), miaMark);
    miaMark = miaPage.mark;
    miaPage.send({ type: "room.write", roomId: roomA.id, text: "@Builder SAY Mia tags as a guest", tags: [profile.id], threadId: null });
    await miaPage.waitForError("room-guests-only-write", miaMark);

    gusMark = gusPage.mark;
    owner.send({ type: "room.remove-person", roomId: roomA.id, personId: gus.id });
    await gusPage.waitFor(isType("room.deleted", ({ roomId }) => roomId === roomA.id), gusMark);
    await ownerWritesIn(roomA, "After Gus left");
    await miaPage.waitFor(roomMessageSaying("After Gus left"), miaMark);
    gusPage.send({ type: "room.write", roomId: roomA.id, text: "Gus is still here?", tags: [], threadId: null });
    await gusPage.waitForError("room-gone", gusMark);
    const subscribing = gusPage.mark;
    gusPage.send({ type: "room.subscribe", roomId: roomA.id });
    await gusPage.waitForError("room-gone", subscribing);
    const sinceRemoval = await gusPage.settledSince(gusMark);
    expect(sinceRemoval.some(roomMessageSaying("After Gus left"))).toBe(false);
    expect(sinceRemoval.some(isType("room.upserted"))).toBe(false);
  }, 40_000);

  test("hears nothing of conversations, workspaces, settings or rooms of others while the owner works", async () => {
    const ownerMark = owner.mark;
    owner.send({ type: "settings.set-canvas-use", canvasUse: "often" });
    owner.send({ type: "workspace.set-color", workspaceId: workspace.id, color: "peach" });
    owner.send({ type: "conversation.rename", conversationId: ownersConversationId, title: "Owner's secret plan" });
    await ownerWritesIn(roomB, "@Builder SAY Payroll answer", [profile.id]);
    await owner.waitFor(roomMessageSaying("Payroll answer"), ownerMark);
    await owner.waitFor(isType("conversation.upserted", ({ conversation }) => conversation.title === "Owner's secret plan"), ownerMark);
    await owner.waitFor(isType("workspace.upserted"), ownerMark);
    await Bun.sleep(SETTLE_MS);
    const miaAgain = await Page.open(port, tokens[mia.id]!);
    const { rooms, profiles, people, workspaces, conversations } = await miaAgain.waitFor(isType("snapshot"));
    expect(rooms.map(({ id, workspaceId, people }) => ({ id, workspaceId, people }))).toEqual([{ id: roomA.id, workspaceId: "", people: [{ personId: mia.id, role: "guest" }] }]);
    expect(profiles).toEqual([{ id: profile.id, name: "Builder", harness: "opencode", environment: "", prelaunch: "", model: null, mode: null, effort: null, bypassPermissions: false, askMode: "wait", color: null, pluginsOff: [], createdAt: 0 }]);
    expect(people.map(({ id }) => id).toSorted()).toEqual([miaAgain.snapshot.ownerId, mia.id].toSorted());
    expect([workspaces, conversations]).toEqual([[], []]);
    await Bun.sleep(SETTLE_MS);
    miaAgain.close();
    const secretsFrom = (page: Page) => [workspace.id, projectDir, ownersConversationId, roomB.id, "Payroll", "Owner's secret plan", promptsFile, PRELAUNCH_SECRET, PLUGIN_OFF_SECRET, ...(page === stanPage ? [roomA.id, mia.id] : [stan.id])];
    for (const page of [miaPage, gusPage, stanPage, miaAgain]) {
      const types = new Set(page.received.map(({ type }) => type));
      expect([...types].filter((type) => !SHOWN_TO_PEOPLE.has(type))).toEqual([]);
      const everything = JSON.stringify(page.received);
      secretsFrom(page).forEach((secret) => expect(everything).not.toContain(secret));
    }
  }, 40_000);
});
