import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { freePorts } from "../e2e/free-ports.ts";
import { DeviceService, inviteKey } from "../host/devices.ts";
import { conversationStandIn } from "../host/person-view.ts";
import { NO_AUTHORITY, roomJoinStatement } from "../host/person-keys.ts";
import { DEVICE_ROUTES, OPEN_TO_PEOPLE, THIS_MACHINE_ROUTES } from "../host/routes.ts";
import { Store } from "../host/store.ts";
import { PROBLEM_HEADER } from "../shared/host-problems.ts";
import type { Person, Profile, StoredEvent, Workspace } from "../shared/model.ts";
import { PERSON_MESSAGE_TYPES } from "../shared/person-messages.ts";
import { OUT_OF_ROOMS_CLOSE_CODE, TOKEN_COOKIE, type ClientMessage, type ServerMessage } from "../shared/protocol.ts";
import { inviteIn, machineAddress } from "../shared/machines.ts";
import { ALL_OF_CLAUDE_SETUP, type ClaudeSetup } from "../shared/room-agent-setup.ts";
import { type Room, type RoomInviteLetsIn, type RoomInviteSeats, type RoomRole, type RoomThread } from "../shared/rooms.ts";

/**
 * A real host, with the owner and three other people of the machine, each signed in on a device of their own: Mia and
 * Gus, whom the owner lets into a room, and Stan, who is in none. What they send and what reaches them is checked against
 * what the owner does meanwhile.
 */

const repoRoot = join(import.meta.dirname, "..");
const root = mkdtempSync(join(tmpdir(), "mirador-room-people-"));
const dataDir = join(root, "data");
const projectDir = join(root, "project");
const otherProjectDir = join(root, "other-project");
const fakePrograms = join(root, "fake-programs");
const promptsFile = join(root, "prompts.txt");
const STEP_MS = 15_000;
const SETTLE_MS = 400;
const PRELAUNCH_SECRET = "owner-prelaunch-secret";
const PLUGIN_OFF_SECRET = "owner-plugin-off-secret";

/** Every message a page can send; a type missing here does not compile. */
const EVERY_CLIENT_MESSAGE: Record<ClientMessage["type"], true> = {
  "room.set-sandbox": true,
  "room.check-sandbox": true,
  "sandbox.answer-held-change": true,
  "sandbox.held-change-text": true,
  "sandbox.add-folder": true,
  "sandbox.set-folder-access": true,
  "sandbox.remove-folder": true,
  "sandbox.apply-folders-now": true,
  "workspace.create": true,
  "workspace.delete": true,
  "workspace.set-default-launch": true,
  "workspace.move": true,
  "workspace.set-color": true,
  "workspaces.find-icons": true,
  "workspace.set-worktree-settings": true,
  "workspace.set-side-chat-access": true,
  "workspace.set-sandbox": true,
  "workspace.check-sandbox": true,
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
  "settings.set-room-invites-connect": true,
  "settings.set-older-after": true,
  "settings.set-conversations-shown": true,
  "settings.set-side-chat-access": true,
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
  "machine.room-opened": true,
  "machine.mute-room": true,
  "machine.leave-room": true,
  "machine.dismiss-knock": true,
  "search": true,
  "room.create": true,
  "room.rename": true,
  "room.set-agents": true,
  "room.set-agent-model": true,
  "room.set-permissions": true,
  "room.set-workspace": true,
  "room.set-person-role": true,
  "room.let-in": true,
  "room.turn-away": true,
  "room.remove-person": true,
  "room.invite": true,
  "room.withdraw-invite": true,
  "room.approve": true,
  "room.answer-task": true,
  "room.set-peoples-tasks-wait": true,
  "room.set-claude-setup": true,
  "room.set-agent-variable": true,
  "room.set-agent-host-environment": true,
  "room.set-agents-read-guests": true,
  "room.delete": true,
  "room.subscribe": true,
  "room.unsubscribe": true,
  "room.write": true,
  "room.writing": true,
  "room.usage.get": true,
  "room.vote": true,
  "room.confirm": true,
  "room.mute": true,
  "room.leave": true,
  "room.set-members-bring-agents": true,
  "room.bring-agent": true,
  "room.take-agent-out": true,
  "room.brought-agents-here": true,
  "room.brought-task-started": true,
  "room.brought-task-answered": true,
  "machine.bring-agent": true,
  "machine.take-agent-out": true,
  "brought-task.answer": true,
};

/** All a person other than the owner may get from the host. */
const SHOWN_TO_PEOPLE = new Set<ServerMessage["type"]>(["conversation.upserted", "conversation.deleted", "conversation.history", "conversation.earlier", "conversation.event", "tool-raw-output.got", "snapshot", "people.listed", "profile.upserted", "room.upserted", "room.deleted", "room.timeline", "room.message", "room.presence", "canvas.upserted", "settings.saved", "error", "pong", "room.votes", "rooms.reading", "room.alert", "room.agent-brought", "room.brought-task", "rooms.waiting-to-join", "room.approvals"]);

type Snapshot = Extract<ServerMessage, { type: "snapshot" }>;
type SettingsSaved = Extract<ServerMessage, { type: "settings.saved" }>;
type ProblemError = Extract<ServerMessage, { type: "error" }>;

const problemCode = (message: ServerMessage) => (message.type === "error" ? (message as ProblemError).problem?.code : undefined);

class Page {
  readonly received: ServerMessage[] = [];
  /** The code the host closed it with. */
  readonly closed: Promise<number>;
  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener("message", (event) => this.received.push(JSON.parse(String(event.data)) as ServerMessage));
    this.closed = new Promise((resolve) => socket.addEventListener("close", ({ code }) => resolve(code)));
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
let otherWorkspace: Workspace;
const mia: Omit<Person, "number"> = { id: crypto.randomUUID(), name: "Mia", color: "mint" };
const gus: Omit<Person, "number"> = { id: crypto.randomUUID(), name: "Gus", color: "sky" };
const stan: Omit<Person, "number"> = { id: crypto.randomUUID(), name: "Stan", color: null };
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
  profile = { id: crypto.randomUUID(), name: "Builder", harness: "opencode", environment: `OPENCODE_FAKE_ACP_PROMPTS=${promptsFile}\nOPENCODE_FAKE_ACP_COMMANDS='${JSON.stringify(OWNERS_COMMANDS)}'\nROOM_ONLY_SECRET_NAME=room-only`, prelaunch: `echo ${PRELAUNCH_SECRET}`, model: null, mode: null, effort: null, bypassPermissions: false, askMode: "wait", color: null, pluginsOff: [PLUGIN_OFF_SECRET], createdAt: Date.now() };
  store.saveProfile(profile);
  workspace = store.insertWorkspace({ id: crypto.randomUUID(), name: "project", path: projectDir, defaultLaunch: { harness: "opencode", profileId: profile.id }, createdAt: Date.now() });
  mkdirSync(otherProjectDir, { recursive: true });
  otherWorkspace = store.insertWorkspace({ id: crypto.randomUUID(), name: "other", path: otherProjectDir, defaultLaunch: { harness: "opencode", profileId: profile.id }, createdAt: Date.now() });
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
    MIRADOR_P2P: "off",
    MIRADOR_PUBLIC_ORIGIN: `http://127.0.0.1:${port}`,
    MIRADOR_PUBLIC_CANVAS_ORIGIN: `http://127.0.0.1:${port + 1}`,
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
  owner.send({ type: "room.create", requestId: name, name, workspaceId: workspace.id, profileIds: [profile.id], permissions: "read-freely", models: {} });
  const { roomId } = await owner.waitFor(isType("room.created", ({ requestId }) => requestId === name), mark);
  return (await owner.waitFor(isType("room.upserted", ({ room }) => room.id === roomId), mark)).room;
}

async function ownerWritesIn(room: Room, text: string, tags: string[] = []) {
  const mark = owner.mark;
  owner.send({ type: "room.write", roomId: room.id, text, tags, threadId: null });
  return (await owner.waitFor(isType("room.message", ({ message }) => message.text === text), mark)).message;
}

const roomMessageSaying = (text: string) => isType("room.message", ({ message }) => message.text === text);

async function settingOwnProfile(page: Page, name: string, color: string | null = null) {
  const mark = page.mark;
  const requestId = crypto.randomUUID();
  page.send({ type: "person.set-own-profile", requestId, name, color });
  return page.waitFor(isType("settings.saved", (saved) => saved.requestId === requestId), mark);
}

const problemOf = ({ problemAbout }: SettingsSaved) => problemAbout?.code ?? null;

const CLEAN_CLAUDE_SETUP: ClaudeSetup = { ownSettings: false, workspaceSettings: false, mcpServers: false, hooks: false, claudeMdAndMemory: false };

/** Sends each message type a person may not, naming what the owner has, and expects each refused and nothing else. */
async function refusesAllButTheirOwnMessages(pages: Page[]) {
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
    inviteId: "probe",
    answer: "allow",
    profileIds: [profile.id],
    permissions: "work-freely",
    tags: [],
    threadId: null,
  };
  for (const page of pages) {
    const mark = page.mark;
    refusedTypes.forEach((type) => page.send({ type, ...naming }));
    await page.waitForErrors("only-the-owner", refusedTypes.length, mark);
    const came = await page.settledSince(mark);
    expect(came.every(({ type }) => type === "error")).toBe(true);
  }
}

/** The room agent's / menu, which its session announces as it starts: the owner's to see. */
const OWNERS_COMMANDS = [{ name: "owners-command", description: "Owned" }];

/** What came to a page about conversations, refusals included. */
const answersAboutConversations = (came: ServerMessage[]) => came.filter(({ type }) => type.startsWith("conversation.") || type === "error");

/** Asks for every route of the host's but the ones open to people, signed in with the token, and expects each refused; the ones it asked for. */
async function routesRefusedTo(token: string) {
  const routes = [...Object.entries(DEVICE_ROUTES), ...Object.entries(THIS_MACHINE_ROUTES)].flatMap(([path, methods]) => (methods === "any" ? ["GET", "POST"] : [...methods]).map((method) => [path, method] as const));
  expect(routes.length).toBeGreaterThan(30);
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
  for (const [path, method] of routes) {
    if (OPEN_TO_PEOPLE.has(path)) continue;
    const response = await fetch(`http://127.0.0.1:${port}${filled(path)}`, {
      method,
      headers: { Cookie: `${TOKEN_COOKIE}=${token}`, Origin: `http://127.0.0.1:${port}`, "Sec-Fetch-Site": "same-origin" },
      ...(method === "POST" && { body: "{}" }),
    });
    expect({ path, method, status: response.status, problem: decodeURIComponent(response.headers.get(PROBLEM_HEADER) ?? "") }).toEqual({ path, method, status: 403, problem: JSON.stringify({ code: "only-the-owner" }) });
    refused.push(`${method} ${path}`);
  }
  await expect(Page.open(port, token, "/notifications")).rejects.toThrow();
  return refused;
}

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
      expect(snapshot.heldChanges).toEqual([]);
      expect(snapshot.homeDir).toBe("");
      expect(snapshot.people.map(({ id }) => id).toSorted()).toEqual([snapshot.ownerId, person.id].toSorted());
    });
  });

  test("is shown a room on their open page as soon as the owner lets them in, with its people by id and role alone", async () => {
    const [miaMark, gusMark] = [miaPage.mark, gusPage.mark];
    owner.send({ type: "room.set-person-role", roomId: roomA.id, personId: mia.id, role: "member" });
    owner.send({ type: "room.set-person-role", roomId: roomA.id, personId: gus.id, role: "guest" });
    const bothIn = ({ room }: { room: Room }) => room.people.length === 2;
    const shownToMia = (await miaPage.waitFor(isType("room.upserted", bothIn), miaMark)).room;
    const roomPeople = [
      { personId: mia.id, role: "member" as const },
      { personId: gus.id, role: "guest" as const },
    ];
    expect(shownToMia).toMatchObject({ id: roomA.id, name: "Launch", workspaceId: "" });
    expect(shownToMia.people.toSorted((a, b) => a.personId.localeCompare(b.personId))).toEqual(roomPeople.toSorted((a, b) => a.personId.localeCompare(b.personId)));
    const shownToGus = await gusPage.waitFor(isType("room.upserted", bothIn), gusMark);
    expect(shownToGus.room.people).toEqual(shownToMia.people);
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

  test("as a member asks a task of an agent that waits until the owner, told who asks and as what, allows it or declines it", async () => {
    let [miaMark, ownerMark] = [miaPage.mark, owner.mark];
    const asking = "@Builder SAY Mia's task answered";
    miaPage.send({ type: "room.write", roomId: roomA.id, text: asking, tags: [profile.id], threadId: null });
    const posted = (await miaPage.waitFor(roomMessageSaying(asking), miaMark)).message;
    expect(posted).toMatchObject({ authorRole: "member", taskHeld: "waiting", tags: [profile.id] });
    const { tasks } = await owner.waitFor(isType("room.approvals", ({ roomId, tasks }) => roomId === roomA.id && tasks.length === 1), ownerMark);
    expect(tasks).toEqual([expect.objectContaining({ roomId: roomA.id, messageId: posted.id, profileIds: [profile.id], personId: mia.id, role: "member", text: asking })]);
    agentConversationId = (await owner.waitFor(isType("room.upserted", ({ room }) => room.id === roomA.id && room.agents[0]!.conversationId !== null), ownerMark)).room.agents[0]!.conversationId!;
    const refusing = miaPage.mark;
    miaPage.send({ type: "room.answer-task", roomId: roomA.id, messageId: posted.id, answer: "allow" });
    miaPage.send({ type: "room.set-peoples-tasks-wait", roomId: roomA.id, wait: false });
    await miaPage.waitForErrors("room-approval-not-yours", 1, refusing);
    await miaPage.waitForErrors("only-the-owner", 1, refusing);
    expect(miaPage.received.slice(miaMark).filter(isType("room.approvals")).flatMap(({ approvals, tasks }) => [...approvals, ...tasks])).toEqual([]);
    await Bun.sleep(SETTLE_MS);
    expect(readFileSync(promptsFile, "utf8")).not.toContain("Mia's task answered");

    owner.send({ type: "room.answer-task", roomId: roomA.id, messageId: posted.id, answer: "allow" });
    await owner.waitFor(isType("room.approvals", ({ roomId, tasks }) => roomId === roomA.id && tasks.length === 0), ownerMark);
    const answeredTo = isType("room.message", ({ message }) => message.answers === posted.id && "profileId" in message.author && message.text === "Mia's task answered");
    await Promise.all([miaPage.waitFor(answeredTo, miaMark), owner.waitFor(answeredTo, ownerMark)]);
    expect(readFileSync(promptsFile, "utf8")).toMatch(/\[member\] Mia tagged you there\.[\s\S]*#\d+ \[member\] Mia, .*\n> @Builder SAY Mia's task answered/);

    [miaMark, ownerMark] = [miaPage.mark, owner.mark];
    const declining = "@Builder SAY Mia's declined task";
    miaPage.send({ type: "room.write", roomId: roomA.id, text: declining, tags: [profile.id], threadId: null });
    const declined = (await miaPage.waitFor(roomMessageSaying(declining), miaMark)).message;
    await owner.waitFor(isType("room.approvals", ({ tasks }) => tasks.some(({ messageId }) => messageId === declined.id)), ownerMark);
    owner.send({ type: "room.answer-task", roomId: roomA.id, messageId: declined.id, answer: "deny" });
    const declinedLine = await miaPage.waitFor(isType("room.message", ({ message }) => message.answers === declined.id), miaMark);
    expect(declinedLine.message).toMatchObject({ author: { profileId: profile.id }, text: "", ended: "declined" });
    await Bun.sleep(SETTLE_MS);
    expect(readFileSync(promptsFile, "utf8")).not.toContain("Mia's declined task");

    ownerMark = owner.mark;
    owner.send({ type: "room.set-peoples-tasks-wait", roomId: roomA.id, wait: false });
    await owner.waitFor(isType("room.upserted", ({ room }) => room.id === roomA.id && !room.peoplesTasksWait), ownerMark);
  }, 40_000);

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
    expect(canvasItem.item.conversationId).toBe(conversationStandIn(roomA.id, profile.id, agentConversationId));
    expect(tagged.message.taskHeld).toBeUndefined();
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
    const marks = new Map([miaPage, gusPage].map((page) => [page, page.mark]));
    const asked = JSON.stringify([{ kind: "execute", title: "Run ls", command: "ls" }]);
    miaPage.send({ type: "room.write", roomId: roomA.id, text: `@Builder ASK ${asked}`, tags: [profile.id], threadId: null });
    const { approvals } = await owner.waitFor(isType("room.approvals", ({ roomId, approvals }) => roomId === roomA.id && approvals.length === 1), ownerMark);
    const { conversationId, request } = approvals[0]!;
    for (const page of [miaPage, gusPage]) {
      const mark = page.mark;
      page.send({ type: "room.approve", roomId: roomA.id, profileId: profile.id, permissionId: request.permissionId, answer: "allow" });
      page.send({ type: "permission.respond", conversationId, permissionId: request.permissionId, optionId: request.options[0]?.optionId ?? null });
      await page.waitForErrors("room-approval-not-yours", 1, mark);
      await page.waitForErrors("only-the-owner", 1, mark);
    }
    expect((await owner.settledSince(ownerMark)).some(isType("room.approvals", ({ approvals }) => approvals.length === 0))).toBe(false);
    const toldOf = [...marks].flatMap(([page, mark]) => page.received.slice(mark).filter(isType("room.approvals")));
    expect(toldOf.length).toBeGreaterThan(0);
    expect(toldOf.flatMap(({ approvals, tasks }) => [...approvals, ...tasks])).toEqual([]);
    const answered = owner.mark;
    const miaAnswered = miaPage.mark;
    owner.send({ type: "room.approve", roomId: roomA.id, profileId: profile.id, permissionId: request.permissionId, answer: "deny" });
    await owner.waitFor(isType("room.approvals", ({ approvals }) => approvals.length === 0), answered);
    await miaPage.waitFor(roomMessageSaying("Run ls: reject"), miaAnswered);
  }, 40_000);

  test("as an approver answers what a room's agent asks and the tasks people give it, told of each by its agent's stand-in, while their own tasks wait for nobody; no longer one, is told of none", async () => {
    const roleOf = (room: Room, personId: string) => room.people.find((person) => person.personId === personId)?.role;
    let [miaMark, gusMark] = [miaPage.mark, gusPage.mark];
    owner.send({ type: "room.set-peoples-tasks-wait", roomId: roomA.id, wait: true });
    owner.send({ type: "room.set-person-role", roomId: roomA.id, personId: mia.id, role: "approver" });
    owner.send({ type: "room.set-person-role", roomId: roomA.id, personId: gus.id, role: "member" });
    await miaPage.waitFor(isType("room.upserted", ({ room }) => room.peoplesTasksWait && roleOf(room, mia.id) === "approver" && roleOf(room, gus.id) === "member"), miaMark);

    miaMark = miaPage.mark;
    const asked = JSON.stringify([{ kind: "execute", title: "Run pwd", command: "pwd" }]);
    miaPage.send({ type: "room.write", roomId: roomA.id, text: `@Builder ASK ${asked}`, tags: [profile.id], threadId: null });
    const own = (await miaPage.waitFor(isType("room.message", ({ message }) => message.text.includes("Run pwd") && message.tags.length === 1), miaMark)).message;
    expect(own).toMatchObject({ authorRole: "approver" });
    expect(own.taskHeld).toBeUndefined();
    const { approvals } = await miaPage.waitFor(isType("room.approvals", ({ roomId, approvals }) => roomId === roomA.id && approvals.length === 1), miaMark);
    const { request } = approvals[0]!;
    expect(approvals[0]).toMatchObject({ conversationId: conversationStandIn(roomA.id, profile.id, agentConversationId), profileId: profile.id, approvers: expect.arrayContaining([mia.id]) });
    await miaPage.waitFor(isType("rooms.reading", ({ readings }) => readings.some(({ roomId, toApprove }) => roomId === roomA.id && toApprove === 1)), miaMark);
    await miaPage.waitFor(isType("room.alert", ({ roomId, alert }) => roomId === roomA.id && alert.about === "approve" && alert.what === "Run pwd"), miaMark);
    const miaOpensAgain = await Page.open(port, tokens[mia.id]!);
    const { roomApprovals } = await miaOpensAgain.waitFor(isType("snapshot"));
    miaOpensAgain.close();
    expect(roomApprovals.map(({ conversationId, request: { permissionId } }) => [conversationId, permissionId])).toEqual([[conversationStandIn(roomA.id, profile.id, agentConversationId), request.permissionId]]);

    gusPage.send({ type: "room.approve", roomId: roomA.id, profileId: profile.id, permissionId: request.permissionId, answer: "allow" });
    await gusPage.waitForError("room-approval-not-yours", gusMark);
    expect(gusPage.received.slice(gusMark).filter(isType("room.approvals")).flatMap(({ approvals, tasks }) => [...approvals, ...tasks])).toEqual([]);
    miaMark = miaPage.mark;
    miaPage.send({ type: "room.approve", roomId: roomA.id, profileId: profile.id, permissionId: request.permissionId, answer: "allow" });
    await miaPage.waitFor(roomMessageSaying("Run pwd: allow"), miaMark);
    expect(readFileSync(promptsFile, "utf8")).toMatch(/#\d+ \[approver\] Mia, .*\n> @Builder ASK .*Run pwd/);

    [miaMark, gusMark] = [miaPage.mark, gusPage.mark];
    const gusTask = "@Builder SAY Gus's task Mia allows";
    gusPage.send({ type: "room.write", roomId: roomA.id, text: gusTask, tags: [profile.id], threadId: null });
    const held = (await gusPage.waitFor(roomMessageSaying(gusTask), gusMark)).message;
    expect(held).toMatchObject({ authorRole: "member", taskHeld: "waiting" });
    const { tasks } = await miaPage.waitFor(isType("room.approvals", ({ tasks }) => tasks.some(({ messageId }) => messageId === held.id)), miaMark);
    expect(tasks).toEqual([expect.objectContaining({ personId: gus.id, role: "member", text: gusTask })]);
    miaPage.send({ type: "room.answer-task", roomId: roomA.id, messageId: held.id, answer: "allow" });
    await gusPage.waitFor(isType("room.message", ({ message }) => message.answers === held.id && message.text === "Gus's task Mia allows"), gusMark);

    [miaMark, gusMark] = [miaPage.mark, gusPage.mark];
    const leftWaiting = "@Builder SAY Gus's task Mia no longer approves";
    gusPage.send({ type: "room.write", roomId: roomA.id, text: leftWaiting, tags: [profile.id], threadId: null });
    const stillHeld = (await gusPage.waitFor(roomMessageSaying(leftWaiting), gusMark)).message;
    await miaPage.waitFor(isType("room.approvals", ({ tasks }) => tasks.some(({ messageId }) => messageId === stillHeld.id)), miaMark);
    [miaMark, gusMark] = [miaPage.mark, gusPage.mark];
    const ownerMark = owner.mark;
    owner.send({ type: "room.set-person-role", roomId: roomA.id, personId: mia.id, role: "member" });
    await miaPage.waitFor(isType("room.approvals", ({ roomId, tasks }) => roomId === roomA.id && tasks.length === 0), miaMark);
    const { tasks: ownersTasks } = await owner.waitFor(isType("room.approvals", ({ roomId, tasks }) => roomId === roomA.id && tasks.length === 1), ownerMark);
    expect(ownersTasks[0]!.approvers).toEqual([owner.snapshot.ownerId]);
    miaPage.send({ type: "room.answer-task", roomId: roomA.id, messageId: stillHeld.id, answer: "allow" });
    await miaPage.waitForError("room-approval-not-yours", miaMark);
    owner.send({ type: "room.answer-task", roomId: roomA.id, messageId: stillHeld.id, answer: "deny" });
    await gusPage.waitFor(isType("room.message", ({ message }) => message.answers === stillHeld.id && message.ended === "declined"), gusMark);

    miaMark = miaPage.mark;
    owner.send({ type: "room.set-person-role", roomId: roomA.id, personId: gus.id, role: "guest" });
    owner.send({ type: "room.set-peoples-tasks-wait", roomId: roomA.id, wait: false });
    await miaPage.waitFor(isType("room.upserted", ({ room }) => !room.peoplesTasksWait && roleOf(room, mia.id) === "member" && roleOf(room, gus.id) === "guest"), miaMark);
    await Promise.all([miaPage, gusPage].map((page) => page.settledSince(page.mark)));
  }, 60_000);

  test("as a collaborator follows a room agent's work by its conversation's stand-in, never its id, without what its turns took; so does an approver; no longer either, lets go of it", async () => {
    const roleOf = (room: Room, personId: string) => room.people.find((person) => person.personId === personId)?.role;
    const standIn = conversationStandIn(roomA.id, profile.id, agentConversationId);
    let [miaMark, gusMark] = [miaPage.mark, gusPage.mark];
    owner.send({ type: "room.set-person-role", roomId: roomA.id, personId: mia.id, role: "collaborator" });
    const { room } = await miaPage.waitFor(isType("room.upserted", ({ room }) => roleOf(room, mia.id) === "collaborator"), miaMark);
    expect(room.agents[0]!.conversationId).toBe(standIn);
    const { conversation } = await miaPage.waitFor(isType("conversation.upserted", ({ conversation }) => conversation.id === standIn), miaMark);
    expect(conversation).toMatchObject({ id: standIn, roomId: roomA.id, workspaceId: "", title: "", acpSessionId: null, configOptions: [], queuedMessages: [], contextUsage: null });
    gusMark = gusPage.mark;
    gusPage.send({ type: "conversation.subscribe", conversationId: standIn });
    expect(answersAboutConversations(await gusPage.settledSince(gusMark))).toEqual([]);

    miaMark = miaPage.mark;
    miaPage.send({ type: "conversation.subscribe", conversationId: agentConversationId });
    miaPage.send({ type: "conversation.subscribe", conversationId: standIn, lowData: { latestTurns: 1 } });
    miaPage.send({ type: "tool-raw-output.get", requestId: "raw-by-id", conversationId: agentConversationId, toolCallId: "probe" });
    await miaPage.waitForErrors("only-the-owner", 2, miaMark);
    expect(answersAboutConversations(await miaPage.settledSince(miaMark)).filter(({ type }) => type !== "error")).toEqual([]);

    miaMark = miaPage.mark;
    miaPage.send({ type: "conversation.subscribe", conversationId: standIn });
    const history = await miaPage.waitFor(isType("conversation.history", ({ conversationId }) => conversationId === standIn), miaMark);
    expect(history.events.some(({ event }) => event.type === "user-message" && event.roomMessageId !== undefined)).toBe(true);
    const toolCall = history.events.flatMap(({ event }) => (event.type === "acp" && event.update.sessionUpdate === "tool_call" ? [event.update.toolCallId] : []))[0]!;
    expect(toolCall).toBeDefined();
    miaPage.send({ type: "tool-raw-output.get", requestId: "raw", conversationId: standIn, toolCallId: toolCall });
    await miaPage.waitFor(isType("tool-raw-output.got", ({ requestId }) => requestId === "raw"), miaMark);
    miaPage.send({ type: "conversation.load-earlier", requestId: "earlier", conversationId: standIn, beforeSeq: history.events[0]!.seq });
    expect((await miaPage.waitFor(isType("conversation.earlier", ({ requestId }) => requestId === "earlier"), miaMark)).conversationId).toBe(standIn);

    miaMark = miaPage.mark;
    await ownerWritesIn(roomA, "@Builder TOKENS 1200 300 0.05 SAY Spent where Mia reads", [profile.id]);
    const turnEnd = await miaPage.waitFor(isType("conversation.event", ({ conversationId, event }) => conversationId === standIn && event.event.type === "turn-end"), miaMark);
    expect(Object.keys(turnEnd.event.event).filter((key) => !["type", "stopReason", "startedAt", "toolCalls", "filesEdited"].includes(key))).toEqual([]);
    const ownerMark = owner.mark;
    owner.send({ type: "conversation.subscribe", conversationId: agentConversationId });
    const ownersHistory = await owner.waitFor(isType("conversation.history", ({ conversationId }) => conversationId === agentConversationId), ownerMark);
    owner.send({ type: "conversation.unsubscribe", conversationId: agentConversationId });
    const ofSessionState = ({ event }: StoredEvent) => event.type === "acp" && ["available_commands_update", "session_info_update", "config_option_update"].includes(event.update.sessionUpdate);
    expect(ownersHistory.events.some(ofSessionState)).toBe(true);
    expect(history.events.some(ofSessionState)).toBe(false);
    const sentToMia = miaPage.received.slice(miaMark).filter(isType("conversation.event"));
    expect(sentToMia.every(({ conversationId }) => conversationId === standIn)).toBe(true);
    expect(sentToMia.some(({ event }) => ofSessionState(event))).toBe(false);

    gusMark = gusPage.mark;
    owner.send({ type: "room.set-person-role", roomId: roomA.id, personId: gus.id, role: "approver" });
    await gusPage.waitFor(isType("conversation.upserted", ({ conversation }) => conversation.id === standIn), gusMark);
    gusMark = gusPage.mark;
    owner.send({ type: "room.set-person-role", roomId: roomA.id, personId: gus.id, role: "guest" });
    await gusPage.waitFor(isType("conversation.deleted", ({ conversationId }) => conversationId === standIn), gusMark);

    miaMark = miaPage.mark;
    owner.send({ type: "room.set-workspace", roomId: roomA.id, workspaceId: otherWorkspace.id });
    await miaPage.waitFor(isType("conversation.deleted", ({ conversationId }) => conversationId === standIn), miaMark);
    const movedMark = owner.mark;
    await ownerWritesIn(roomA, "@Builder SAY Started afresh", [profile.id]);
    const freshId = (await owner.waitFor(isType("room.upserted", ({ room }) => room.id === roomA.id && room.agents[0]!.conversationId !== null), movedMark)).room.agents[0]!.conversationId!;
    const freshStandIn = conversationStandIn(roomA.id, profile.id, freshId);
    expect(freshStandIn).not.toBe(standIn);
    await miaPage.waitFor(isType("conversation.upserted", ({ conversation }) => conversation.id === freshStandIn), miaMark);
    miaPage.send({ type: "conversation.subscribe", conversationId: freshStandIn });
    await miaPage.waitFor(isType("conversation.history", ({ conversationId }) => conversationId === freshStandIn), miaMark);

    miaMark = miaPage.mark;
    owner.send({ type: "room.set-person-role", roomId: roomA.id, personId: mia.id, role: "member" });
    await miaPage.waitFor(isType("conversation.deleted", ({ conversationId }) => conversationId === freshStandIn), miaMark);
    const demotedMark = miaPage.mark;
    await ownerWritesIn(roomA, "@Builder SAY After Mia's collaboration", [profile.id]);
    await miaPage.waitFor(roomMessageSaying("After Mia's collaboration"), demotedMark);
    expect((await miaPage.settledSince(demotedMark)).some(({ type }) => type.startsWith("conversation."))).toBe(false);
    const followingMark = miaPage.mark;
    miaPage.send({ type: "conversation.subscribe", conversationId: freshStandIn });
    expect(answersAboutConversations(await miaPage.settledSince(followingMark))).toEqual([]);

    const backMark = owner.mark;
    owner.send({ type: "room.set-workspace", roomId: roomA.id, workspaceId: workspace.id });
    await owner.waitFor(isType("room.upserted", ({ room }) => room.id === roomA.id && room.workspaceId === workspace.id), backMark);
    for (const page of [miaPage, gusPage, stanPage]) [agentConversationId, freshId].forEach((id) => expect(JSON.stringify(page.received)).not.toContain(id));
    await ownerWritesIn(roomA, "@Builder SAY Back in the project", [profile.id]);
    agentConversationId = (await owner.waitFor(isType("room.upserted", ({ room }) => room.id === roomA.id && room.agents[0]!.conversationId !== null), backMark)).room.agents[0]!.conversationId!;
    await miaPage.waitFor(roomMessageSaying("Back in the project"), demotedMark);
    await Promise.all([miaPage, gusPage, stanPage].map((page) => page.settledSince(page.mark)));
  }, 90_000);

  test("is refused every message type but their own few, whatever it names", async () => {
    await refusesAllButTheirOwnMessages([miaPage, gusPage, stanPage]);
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
    expect(problemOf(await settingOwnProfile(miaPage, "Mia R", "rose"))).toBeNull();
    const { people } = await miaPage.waitFor(isType("people.listed", ({ people }) => people.some(({ id, name }) => id === mia.id && name === "Mia R")), mark);
    expect(people.find(({ id }) => id === mia.id)?.color).toBe("rose");
    expect(people.map(({ id }) => id)).not.toContain(stan.id);
    miaPage.send({ type: "ping" });
    await miaPage.waitFor(isType("pong"), mark);
  });

  test("takes no name the owner, an agent or another person of their rooms, or Mirador itself goes by, however it is written", async () => {
    expect(problemOf(await settingOwnProfile(owner, "Ann"))).toBeNull();
    const takenForMia = ["builder", "\uFF22\uFF55\uFF49\uFF4C\uFF44\uFF45\uFF52", "Bui\u200Blder", "GUS\u00A0", "Ann\u3164", "Member"];
    for (const name of takenForMia) expect({ name, problem: problemOf(await settingOwnProfile(miaPage, name)) }).toEqual({ name, problem: "person-name-taken" });
    expect(problemOf(await settingOwnProfile(miaPage, "\u202EnnA"))).toBe("person-name-reorders");
    expect(problemOf(await settingOwnProfile(miaPage, "B\u0443ilder"))).toBe("person-name-mixes-scripts");
    expect(problemOf(await settingOwnProfile(miaPage, "[owner] Peter"))).toBe("person-name-has-brackets");
    const takenForStan = ["ANN", "owner", "Someone without a name", "Someone without a name 4821", "S0meone without a name 482l", "You"];
    for (const name of takenForStan) expect({ name, problem: problemOf(await settingOwnProfile(stanPage, name)) }).toEqual({ name, problem: "person-name-taken" });
    expect(problemOf(await settingOwnProfile(owner, "Builder"))).toBeNull();
    expect(problemOf(await settingOwnProfile(owner, "Ann"))).toBeNull();
  });

  test("leaves the owner no name another person goes by, nor one that reads as someone without a name", async () => {
    for (const name of ["mia  r", "stan\u200B", "Someone without a name 1234", "Alguien sin nombre \u0664\u0662"]) {
      expect({ name, problem: problemOf(await settingOwnProfile(owner, name)) }).toEqual({ name, problem: "person-name-taken" });
    }
    expect(problemOf(await settingOwnProfile(owner, "Ann"))).toBeNull();
  });

  test("is told nothing of the names of people and agents outside their rooms, which they may take", async () => {
    for (const name of ["Mia R", "builder", "Stan"]) expect({ name, problem: problemOf(await settingOwnProfile(stanPage, name)) }).toEqual({ name, problem: null });
  });

  test("changes their profile at most ten times a minute, while the owner changes theirs as often as they like", async () => {
    const tries = Array.from({ length: 11 }, (_, index) => `Gus ${index}`);
    const answers = [];
    for (const name of tries) answers.push(problemOf(await settingOwnProfile(gusPage, name)));
    expect(answers).toEqual([...Array<null>(10).fill(null), "profile-changing-too-fast"]);
    for (const name of tries) expect(problemOf(await settingOwnProfile(owner, name.replace("Gus", "Ann")))).toBeNull();
    expect(problemOf(await settingOwnProfile(owner, "Ann"))).toBeNull();
  });

  test("reaches no route of the host's over HTTP but the page itself and joining", async () => {
    const refused = await routesRefusedTo(tokens[mia.id]!);
    expect([...OPEN_TO_PEOPLE].toSorted()).toEqual(["/", "/auth", "/join", "/join-challenges", "/join-requests", "/join-requests/:id/poll", "/join-requests/:id/reveal", "/mirador-ca.pem", "/mirador-here"]);
    expect(refused).toEqual(expect.arrayContaining(["POST /conversations/:conversationId/images", "GET /conversations/:conversationId/images/:imageId", "GET /workspaces/:workspaceId/apps/:app/file", "POST /tunnel", "GET /devices"]));
    const page = await fetch(`http://127.0.0.1:${port}/`, { headers: { Cookie: `${TOKEN_COOKIE}=${tokens[mia.id]}` } });
    expect(page.status).toBe(200);
  }, 60_000);

  test("can't follow a room agent's conversation, and hears none of its events", async () => {
    const mark = miaPage.mark;
    miaPage.send({ type: "conversation.subscribe", conversationId: agentConversationId });
    miaPage.send({ type: "room.write", roomId: roomA.id, text: "@Builder SAY Busy agent", tags: [profile.id], threadId: null });
    await miaPage.waitFor(roomMessageSaying("Busy agent"), mark);
    expect(answersAboutConversations(await miaPage.settledSince(mark))).toEqual([]);
  }, 30_000);

  test("changes nothing of what a room's agents are given or read, as a member or as a guest", async () => {
    const ownerMark = owner.mark;
    for (const page of [miaPage, gusPage]) {
      const mark = page.mark;
      page.send({ type: "room.set-claude-setup", roomId: roomA.id, setup: CLEAN_CLAUDE_SETUP });
      page.send({ type: "room.set-agent-variable", roomId: roomA.id, profileId: profile.id, name: "ROOM_ONLY_SECRET_NAME", given: true });
      page.send({ type: "room.set-agent-host-environment", roomId: roomA.id, profileId: profile.id, given: true });
      page.send({ type: "room.set-agents-read-guests", roomId: roomA.id, read: false });
      await page.waitForErrors("only-the-owner", 4, mark);
    }
    expect((await owner.settledSince(ownerMark)).some(isType("room.upserted", ({ room }) => room.id === roomA.id))).toBe(false);
  });

  test("loses what a role took away on the page they have open, and, taken out of their last room, every way in at once, while their messages keep their name", async () => {
    let gusMark = gusPage.mark;
    owner.send({ type: "room.set-person-role", roomId: roomA.id, personId: gus.id, role: "member" });
    await gusPage.waitFor(isType("room.upserted", ({ room }) => room.people[0]?.role === "member"), gusMark);
    gusPage.send({ type: "room.write", roomId: roomA.id, text: "@Builder SAY Gus is a member now", tags: [profile.id], threadId: null });
    await gusPage.waitFor(isType("room.message", ({ message }) => message.text.includes("Gus is a member now") && message.tags.length === 1), gusMark);
    await gusPage.waitFor(roomMessageSaying("Gus is a member now"), gusMark);

    let miaMark = miaPage.mark;
    owner.send({ type: "room.set-person-role", roomId: roomA.id, personId: mia.id, role: "guest" });
    await miaPage.waitFor(isType("room.upserted", ({ room }) => room.people[0]?.role === "guest"), miaMark);
    miaMark = miaPage.mark;
    miaPage.send({ type: "room.write", roomId: roomA.id, text: "@Builder SAY Mia tags as a guest", tags: [profile.id], threadId: null });
    await miaPage.waitForError("room-guests-only-write", miaMark);

    gusMark = gusPage.mark;
    const ownerMark = owner.mark;
    const miaBeforeGusLeft = miaPage.mark;
    owner.send({ type: "room.remove-person", roomId: roomA.id, personId: gus.id });
    await gusPage.waitFor(isType("room.deleted", ({ roomId }) => roomId === roomA.id), gusMark);
    expect(await gusPage.closed).toBe(OUT_OF_ROOMS_CLOSE_CODE);
    const { devices } = await owner.waitFor(isType("devices.listed"), ownerMark);
    expect(devices.some(({ personId }) => personId === gus.id)).toBe(false);
    await expect(Page.open(port, tokens[gus.id]!)).rejects.toThrow();
    await ownerWritesIn(roomA, "After Gus left");
    await miaPage.waitFor(roomMessageSaying("After Gus left"), miaMark);
    const sinceRemoval = gusPage.received.slice(gusMark);
    expect(sinceRemoval.some(roomMessageSaying("After Gus left"))).toBe(false);
    expect(sinceRemoval.some(isType("room.upserted"))).toBe(false);
    const { people } = await owner.waitFor(isType("people.listed"), ownerMark);
    const gusAsNamed = people.find(({ id }) => id === gus.id);
    expect(gusAsNamed?.name).toStartWith("Gus");
    const { people: seenByMia } = await miaPage.waitFor(isType("people.listed"), miaBeforeGusLeft);
    expect(seenByMia.find(({ id }) => id === gus.id)).toEqual(gusAsNamed);
  }, 40_000);

  test("hears nothing of conversations, workspaces, settings or rooms of others while the owner works", async () => {
    const ownerMark = owner.mark;
    owner.send({ type: "settings.set-canvas-use", canvasUse: "often" });
    owner.send({ type: "workspace.set-color", workspaceId: workspace.id, color: "peach" });
    owner.send({ type: "conversation.rename", conversationId: ownersConversationId, title: "Owner's secret plan" });
    owner.send({ type: "room.set-claude-setup", roomId: roomA.id, setup: CLEAN_CLAUDE_SETUP });
    owner.send({ type: "room.set-agent-variable", roomId: roomA.id, profileId: profile.id, name: "ROOM_ONLY_SECRET_NAME", given: true });
    owner.send({ type: "room.set-agent-host-environment", roomId: roomA.id, profileId: profile.id, given: true });
    owner.send({ type: "room.set-agents-read-guests", roomId: roomA.id, read: false });
    const { room: launchAsOwnerSees } = await owner.waitFor(isType("room.upserted", ({ room }) => room.id === roomA.id && !room.agentsReadGuests), ownerMark);
    expect(launchAsOwnerSees).toMatchObject({ claudeSetup: CLEAN_CLAUDE_SETUP, agents: [expect.objectContaining({ variables: { ROOM_ONLY_SECRET_NAME: true }, wholeHostEnvironment: true })] });
    await ownerWritesIn(roomB, "@Builder SAY Payroll answer", [profile.id]);
    await owner.waitFor(roomMessageSaying("Payroll answer"), ownerMark);
    await owner.waitFor(isType("conversation.upserted", ({ conversation }) => conversation.title === "Owner's secret plan"), ownerMark);
    await owner.waitFor(isType("workspace.upserted"), ownerMark);
    await Bun.sleep(SETTLE_MS);
    const miaAgain = await Page.open(port, tokens[mia.id]!);
    const { rooms, profiles, people, workspaces, conversations } = await miaAgain.waitFor(isType("snapshot"));
    expect(rooms.map(({ id, workspaceId, people }) => ({ id, workspaceId, people }))).toEqual([{ id: roomA.id, workspaceId: "", people: [{ personId: mia.id, role: "guest" }] }]);
    const settingsSeen = (seen: Room[]) => seen.map(({ claudeSetup, agentsReadGuests, agents }) => ({ claudeSetup, agentsReadGuests, variables: agents.map(({ variables }) => variables) }));
    const roomsMiaWasSent = miaPage.received.filter(isType("room.upserted")).map(({ room }) => room);
    expect([...settingsSeen(rooms), ...settingsSeen(roomsMiaWasSent)]).toEqual([...rooms, ...roomsMiaWasSent].map(() => ({ claudeSetup: ALL_OF_CLAUDE_SETUP, agentsReadGuests: true, variables: [{}] })));
    expect(profiles).toEqual([{ id: profile.id, name: "Builder", harness: "opencode", environment: "", prelaunch: "", model: null, mode: null, effort: null, bypassPermissions: false, askMode: "wait", color: null, pluginsOff: [], createdAt: 0 }]);
    expect(people.map(({ id }) => id).toSorted()).toEqual([miaAgain.snapshot.ownerId, mia.id, gus.id].toSorted());
    expect([workspaces, conversations]).toEqual([[], []]);
    await Bun.sleep(SETTLE_MS);
    miaAgain.close();
    const secretsFrom = (page: Page) => [workspace.id, projectDir, ownersConversationId, agentConversationId, roomB.id, "Payroll", "Owner's secret plan", promptsFile, PRELAUNCH_SECRET, PLUGIN_OFF_SECRET, "ROOM_ONLY_SECRET_NAME", ...(page === stanPage ? [roomA.id, mia.id] : [stan.id])];
    for (const page of [miaPage, gusPage, stanPage, miaAgain]) {
      const types = new Set(page.received.map(({ type }) => type));
      expect([...types].filter((type) => !SHOWN_TO_PEOPLE.has(type))).toEqual([]);
      const everything = JSON.stringify(page.received);
      secretsFrom(page).forEach((secret) => expect(everything).not.toContain(secret));
    }
  }, 40_000);
});

/** A Mirador's owner as another machine knows them: by an Ed25519 key, whose public half is raw and in base64url. */
function keyOf(privateKey: KeyObject) {
  return {
    publicKey: createPublicKey(privateKey).export({ format: "jwk" }).x!,
    sign: (statement: string) => sign(null, Buffer.from(statement), privateKey).toString("base64url"),
  };
}

type Key = ReturnType<typeof keyOf>;

const newKey = () => keyOf(generateKeyPairSync("ed25519").privateKey);

describe("a person a room invite lets in, from their own Mirador", () => {
  let roomC: Room;
  let roomD: Room;
  const doraKey = newKey();
  let dora: { personId: string; token: string; deviceId: string; page: Page };
  let dorasSecondDevice: { token: string; deviceId: string; page: Page };
  const hereAt = () => `127.0.0.1:${port}`;

  const post = (path: string, body: unknown, host = hereAt()) =>
    fetch(`http://127.0.0.1:${port}${path}`, { method: "POST", headers: { "content-type": "application/json", host }, body: JSON.stringify(body) });

  const refusal = async (response: Response) => ({ status: response.status, problem: (JSON.parse(decodeURIComponent(response.headers.get(PROBLEM_HEADER) ?? "null")) as { code: string } | null)?.code ?? null });

  async function ownerInvites(room: Room, role: RoomRole, seats: RoomInviteSeats = 1, letsIn: RoomInviteLetsIn = "at-once") {
    const mark = owner.mark;
    const requestId = crypto.randomUUID();
    owner.send({ type: "room.invite", requestId, roomId: room.id, role, connect: "address", seats, letsIn, lifetime: "15-minutes" });
    const { invite, text } = await owner.waitFor(isType("room.invited", (invited) => invited.requestId === requestId), mark);
    return { invite: invite!, text: text!, code: inviteIn(text!).code };
  }

  async function challengeFor(code: string, host = hereAt()) {
    const response = await post("/join-challenges", { code }, host);
    return response.ok ? ((await response.json()) as { challenge: string }).challenge : null;
  }

  const presented = (key: Key, code: string, challenge: string, { host = hereAt(), authorityFingerprint = NO_AUTHORITY, name = "Dora" as unknown, color = "mint" as unknown } = {}) => ({
    publicKey: key.publicKey,
    name,
    color,
    challenge,
    signature: key.sign(roomJoinStatement({ challenge, inviteKey: inviteKey(code), host, authorityFingerprint, publicKey: key.publicKey })),
  });

  async function joining(code: string, key: Key, options: Parameters<typeof presented>[3] = {}) {
    const challenge = await challengeFor(code);
    expect(challenge).not.toBeNull();
    return post("/join", { code, name: "Dora's Mirador", person: presented(key, code, challenge!, options) });
  }

  async function joined(response: Response) {
    expect(response.status).toBe(200);
    const { token, deviceId } = (await response.json()) as { token: string; deviceId: string };
    const page = await Page.open(port, token);
    const snapshot = await page.waitFor(isType("snapshot"));
    return { token, deviceId, page, snapshot };
  }

  beforeAll(async () => {
    roomC = await ownerCreatesRoom("Garden");
    roomD = await ownerCreatesRoom("Kitchen");
  });

  afterAll(() => [dora?.page, dorasSecondDevice?.page].forEach((page) => page?.close()));

  test("joins exactly the invite's room, with exactly its role, as a person other than the owner", async () => {
    const { code, invite } = await ownerInvites(roomC, "member");
    expect(invite).toMatchObject({ roomId: roomC.id, role: "member" });
    expect(code).toMatch(/^ROOM-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const mark = owner.mark;
    const { token, deviceId, page, snapshot } = await joined(await joining(code, doraKey));
    dora = { personId: snapshot.you, token, deviceId, page };
    expect(snapshot.you).not.toBe(snapshot.ownerId);
    expect(snapshot.rooms.map(({ id, people }) => ({ id, people }))).toEqual([{ id: roomC.id, people: [{ personId: dora.personId, role: "member" }] }]);
    expect(snapshot.people.find(({ id }) => id === dora.personId)).toEqual({ id: dora.personId, name: "Dora", color: "mint", number: expect.any(Number) });
    await owner.waitFor(isType("room.upserted", ({ room }) => room.id === roomC.id && room.people.some(({ personId, role }) => personId === dora.personId && role === "member")), mark);
    await owner.waitFor(isType("room-invites.listed", ({ invites }) => !invites.some(({ id }) => id === invite.id)), mark);
    const { devices } = await owner.waitFor(isType("devices.listed", ({ devices }) => devices.some(({ id }) => id === deviceId)), mark);
    expect(devices.find(({ id }) => id === deviceId)).toMatchObject({ name: "Dora's Mirador", personId: dora.personId });
    const fresh = await Page.open(port, readFileSync(join(dataDir, "browser-token"), "utf8").trim());
    const { rooms } = await fresh.waitFor(isType("snapshot"));
    fresh.close();
    expect(rooms.filter(({ people }) => people.some(({ personId }) => personId === dora.personId)).map(({ id }) => id)).toEqual([roomC.id]);
  });

  test("is invited by a text with one way to this machine: at its address with its name and no tunnel, and none left behind when peer to peer is off", async () => {
    const { text, invite } = await ownerInvites(roomD, "guest");
    expect(machineAddress(text)).toMatchObject({ origin: `http://127.0.0.1:${port}`, forRoom: true, tunnel: null, name: expect.any(String) });
    owner.send({ type: "room.withdraw-invite", inviteId: invite.id });

    const mark = owner.mark;
    owner.send({ type: "room.invite", requestId: "p2p", roomId: roomD.id, role: "guest", connect: "peer-to-peer", seats: 1, letsIn: "at-once", lifetime: "15-minutes" });
    const refused = await owner.waitFor(isType("room.invited", ({ requestId }) => requestId === "p2p"), mark);
    expect(refused).toMatchObject({ invite: null, text: null, problemAbout: { code: "room-invite-needs-peer-to-peer" } });

    owner.send({ type: "settings.set-room-invites-connect", connect: "address" });
    expect((await owner.waitFor(isType("devices.listed", ({ roomInvitesConnect }) => roomInvitesConnect === "address"), mark)).roomInvitesConnect).toBe("address");
    owner.send({ type: "settings.set-room-invites-connect", connect: "peer-to-peer" });
    await owner.waitFor(isType("devices.listed", ({ roomInvitesConnect }) => roomInvitesConnect === "peer-to-peer"), mark);
  });

  test("is let in by an invite once: not again, and not after the owner withdrew it", async () => {
    const someoneElse = newKey();
    const { code: used } = await ownerInvites(roomC, "member");
    await joined(await joining(used, someoneElse, { name: "Ola" })).then(({ page }) => page.close());
    expect(await challengeFor(used)).toBeNull();
    expect(await refusal(await post("/join", { code: used, name: "Again", person: presented(newKey(), used, "A".repeat(43)) }))).toEqual({ status: 403, problem: "invite-code-wrong" });

    const { code, invite } = await ownerInvites(roomC, "guest");
    const challenge = (await challengeFor(code))!;
    const mark = owner.mark;
    owner.send({ type: "room.withdraw-invite", inviteId: invite.id });
    await owner.waitFor(isType("room-invites.listed", ({ invites }) => !invites.some(({ id }) => id === invite.id)), mark);
    expect(await refusal(await post("/join", { code, name: "Late", person: presented(newKey(), code, challenge) }))).toEqual({ status: 403, problem: "invite-code-wrong" });
    expect(await challengeFor(code)).toBeNull();
  });

  test("never makes a person of a device invite, nor an owner's device of a room invite, whatever the request says", async () => {
    let mark = owner.mark;
    owner.send({ type: "devices.invite", requestId: "device-invite" });
    const { code: deviceCode } = await owner.waitFor(isType("devices.invited", ({ requestId }) => requestId === "device-invite"), mark);
    expect(await challengeFor(deviceCode)).toBeNull();
    expect(await refusal(await post("/join", { code: deviceCode, name: "Sneaky", person: presented(newKey(), deviceCode, "A".repeat(43)) }))).toEqual({ status: 403, problem: "invite-code-wrong" });
    expect(await refusal(await post("/join", { code: deviceCode, name: "Sneaky", person: null }))).toEqual({ status: 403, problem: "invite-code-wrong" });

    const { code: roomCode } = await ownerInvites(roomC, "guest");
    expect(await refusal(await post("/join", { code: roomCode, name: "Sneaky" }))).toEqual({ status: 403, problem: "room-invite-needs-mirador" });
    const key = newKey();
    const throughTunnel = { code: roomCode, name: "Sneaky", tunnelKey: "A".repeat(43), person: presented(key, roomCode, (await challengeFor(roomCode))!) };
    expect(await refusal(await post("/join", throughTunnel))).toEqual({ status: 403, problem: "room-invite-not-through-tunnel" });
    const ownerId = owner.snapshot.ownerId;
    const crafted = { ...presented(key, roomCode, (await challengeFor(roomCode))!, { name: "Sneaky" }), personId: ownerId, id: ownerId, role: "owner", isOwner: true };
    const { page, snapshot, token } = await joined(await post("/join", { code: roomCode, name: "Sneaky", person: crafted, personId: ownerId, role: "owner", isOwner: true }));
    page.close();
    expect(snapshot.you).not.toBe(ownerId);
    expect(snapshot.rooms.map(({ id }) => id)).toEqual([roomC.id]);
    expect(snapshot.rooms[0]!.people).toContainEqual({ personId: snapshot.you, role: "guest" });
    expect((await fetch(`http://127.0.0.1:${port}/devices`, { headers: { Cookie: `${TOKEN_COOKIE}=${token}` } })).status).toBe(403);

    mark = owner.mark;
    const ownersDevice = await joined(await post("/join", { code: deviceCode, name: "Owner's tablet" }));
    ownersDevice.page.close();
    expect(ownersDevice.snapshot.you).toBe(ownerId);
    owner.send({ type: "device.revoke", deviceId: ownersDevice.deviceId });
    await owner.waitFor(isType("devices.listed", ({ devices }) => !devices.some(({ id }) => id === ownersDevice.deviceId)), mark);
  });

  test("needs a signature, with the key it presents, over this invite, this host's challenge and this host's address; none works twice", async () => {
    const { code } = await ownerInvites(roomC, "guest");
    const key = newKey();
    const attempt = async (person: (challenge: string) => unknown, { askedAt = hereAt(), sentTo = hereAt() } = {}) =>
      refusal(await post("/join", { code, name: "Eve's Mirador", person: person((await challengeFor(code, askedAt))!) }, sentTo));
    const unproven = { status: 403, problem: "room-join-unproven" };
    const elsewhere = `localhost:${port}`;
    expect(await attempt((challenge) => ({ publicKey: key.publicKey, name: "Eve", color: null, challenge }))).toEqual(unproven);
    expect(await attempt((challenge) => ({ ...presented(key, code, challenge), signature: "" }))).toEqual(unproven);
    expect(await attempt((challenge) => ({ ...presented(newKey(), code, challenge), publicKey: key.publicKey }))).toEqual(unproven);
    expect(await attempt((challenge) => presented(key, "ABCD-EFGH-JKLM", challenge))).toEqual(unproven);
    expect(await attempt((challenge) => presented(key, code, challenge, { host: elsewhere }))).toEqual(unproven);
    expect(await attempt((challenge) => presented(key, code, challenge, { host: elsewhere }), { askedAt: elsewhere })).toEqual(unproven);
    expect(await attempt((challenge) => presented(key, code, challenge, { authorityFingerprint: "an-authority-this-host-never-served" }))).toEqual(unproven);
    expect(await attempt((challenge) => presented(key, code, `${challenge.slice(0, -1)}${challenge.endsWith("A") ? "B" : "A"}`))).toEqual(unproven);

    const spent = (await challengeFor(code))!;
    expect(await refusal(await post("/join", { code, name: "Eve's Mirador", person: { ...presented(key, code, spent), signature: newKey().sign("something else") } }))).toEqual(unproven);
    expect(await refusal(await post("/join", { code, name: "Eve's Mirador", person: presented(key, code, spent) }))).toEqual(unproven);

    const challenge = (await challengeFor(code, elsewhere))!;
    const proven = { code, name: "Eve's Mirador", person: presented(key, code, challenge, { host: elsewhere, name: "Eve" }) };
    const eve = await joined(await post("/join", proven, elsewhere));
    eve.page.close();
    expect(await refusal(await post("/join", proven, elsewhere))).toEqual({ status: 403, problem: "invite-code-wrong" });
    const { code: next } = await ownerInvites(roomC, "guest");
    expect(await refusal(await post("/join", { ...proven, code: next }, elsewhere))).toEqual(unproven);
  });

  test("is the same person when the same key joins with another invite: in both rooms, with two devices", async () => {
    const { code } = await ownerInvites(roomD, "guest");
    const mark = owner.mark;
    const second = await joined(await joining(code, doraKey));
    dorasSecondDevice = { token: second.token, deviceId: second.deviceId, page: second.page };
    expect(second.snapshot.you).toBe(dora.personId);
    const roleIn = (roomId: string) => second.snapshot.rooms.find(({ id }) => id === roomId)?.people;
    expect(second.snapshot.rooms).toHaveLength(2);
    expect(roleIn(roomC.id)).toContainEqual({ personId: dora.personId, role: "member" });
    expect(roleIn(roomD.id)).toContainEqual({ personId: dora.personId, role: "guest" });
    const { devices } = await owner.waitFor(isType("devices.listed", ({ devices }) => devices.some(({ id }) => id === second.deviceId)), mark);
    expect(devices.filter(({ personId }) => personId === dora.personId).map(({ id }) => id).toSorted()).toEqual([dora.deviceId, second.deviceId].toSorted());
    const { people } = await owner.waitFor(isType("people.listed"), mark);
    expect(people.filter(({ name }) => name === "Dora")).toHaveLength(1);
  });

  test("loses only the device the owner revokes in Settings, and stays in their rooms with the others", async () => {
    const { code } = await ownerInvites(roomC, "member");
    const third = await joined(await joining(code, doraKey));
    expect(third.snapshot.you).toBe(dora.personId);
    const mark = owner.mark;
    const doraMark = dora.page.mark;
    owner.send({ type: "device.revoke", deviceId: third.deviceId });
    expect(await third.page.closed).not.toBe(OUT_OF_ROOMS_CLOSE_CODE);
    const { devices } = await owner.waitFor(isType("devices.listed", ({ devices }) => !devices.some(({ id }) => id === third.deviceId)), mark);
    expect(devices.filter(({ personId }) => personId === dora.personId).map(({ id }) => id).toSorted()).toEqual([dora.deviceId, dorasSecondDevice.deviceId].toSorted());
    expect((await fetch(`http://127.0.0.1:${port}/ws`, { headers: { Cookie: `${TOKEN_COOKIE}=${third.token}` } })).status).toBe(401);
    dora.page.send({ type: "ping" });
    await dora.page.waitFor(isType("pong"), doraMark);
    expect(dora.page.received.slice(doraMark).some(isType("room.deleted"))).toBe(false);
    const again = await Page.open(port, dorasSecondDevice.token);
    const { rooms } = await again.waitFor(isType("snapshot"));
    again.close();
    expect(rooms.map(({ id }) => id).toSorted()).toEqual([roomC.id, roomD.id].toSorted());
  });

  test("never costs the owner a device when the owner is named for removal from a room", async () => {
    let mark = owner.mark;
    owner.send({ type: "devices.invite", requestId: "owners-phone" });
    const { code } = await owner.waitFor(isType("devices.invited", ({ requestId }) => requestId === "owners-phone"), mark);
    const ownersPhone = await joined(await post("/join", { code, name: "Owner's phone" }));
    const ownerId = owner.snapshot.ownerId;
    expect(ownersPhone.snapshot.you).toBe(ownerId);

    mark = owner.mark;
    const phoneMark = ownersPhone.page.mark;
    owner.send({ type: "room.remove-person", roomId: roomC.id, personId: ownerId });
    await owner.waitForError("room-person-unknown", mark);
    ownersPhone.page.send({ type: "ping" });
    await ownersPhone.page.waitFor(isType("pong"), phoneMark);
    owner.send({ type: "devices.list" });
    const { devices } = await owner.waitFor(isType("devices.listed"), mark);
    expect(devices.find(({ id }) => id === ownersPhone.deviceId)?.personId).toBe(ownerId);

    owner.send({ type: "device.revoke", deviceId: ownersPhone.deviceId });
    await ownersPhone.page.closed;
  });

  test("is joined by no machine that passes their signed join on to this host while giving its own address", async () => {
    const { code, invite } = await ownerInvites(roomC, "guest");
    const relaysAt = "relay.example:4600";
    const forbiddenHost = { status: 403, problem: null };
    expect(await refusal(await post("/join-challenges", { code }, relaysAt))).toEqual(forbiddenHost);
    const challenge = (await challengeFor(code))!;
    const signedForTheRelay = { code, name: "Relayed", person: presented(doraKey, code, challenge, { host: relaysAt }) };
    expect(await refusal(await post("/join", signedForTheRelay, relaysAt))).toEqual(forbiddenHost);
    expect(await refusal(await post("/join", signedForTheRelay))).toEqual({ status: 403, problem: "room-join-unproven" });
    const mark = owner.mark;
    owner.send({ type: "devices.list" });
    const { devices } = await owner.waitFor(isType("devices.listed"), mark);
    expect(devices.filter(({ personId }) => personId === dora.personId).map(({ id }) => id).toSorted()).toEqual([dora.deviceId, dorasSecondDevice.deviceId].toSorted());
    owner.send({ type: "room.withdraw-invite", inviteId: invite.id });
    await owner.waitFor(isType("room-invites.listed", ({ invites }) => !invites.some(({ id }) => id === invite.id)), mark);
  });

  test("joins without a name when the name rules refuse theirs or Mirador says it, and the owner is told of one already in the room", async () => {
    for (const name of ["Bуilder", "‮nnA", "Someone without a name", "You", "", 7, "x".repeat(500)]) {
      const { code } = await ownerInvites(roomD, "guest");
      const { page, snapshot } = await joined(await joining(code, newKey(), { name }));
      page.close();
      expect({ name, shown: snapshot.people.find(({ id }) => id === snapshot.you)?.name }).toEqual({ name, shown: "" });
    }

    const { code } = await ownerInvites(roomC, "guest");
    const mark = owner.mark;
    const clashing = await joined(await joining(code, newKey(), { name: "DORA" }));
    expect(clashing.snapshot.people.find(({ id }) => id === clashing.snapshot.you)?.name).toBe("");
    expect(clashing.snapshot.rooms[0]?.people).toContainEqual({ personId: clashing.snapshot.you, role: "guest" });
    expect(clashing.snapshot.rooms[0]?.people.every((person) => !("nameClash" in person))).toBe(true);
    const told = await owner.waitFor(isType("room.upserted", ({ room }) => room.people.some(({ personId }) => personId === clashing.snapshot.you)), mark);
    expect(told.room.people.find(({ personId }) => personId === clashing.snapshot.you)).toEqual({ personId: clashing.snapshot.you, role: "guest", nameClash: "DORA" });
    const named = owner.mark;
    expect(problemOf(await settingOwnProfile(clashing.page, "Dorothea"))).toBeNull();
    const cleared = await owner.waitFor(isType("room.upserted", ({ room }) => room.id === roomC.id && room.people.some(({ personId, nameClash }) => personId === clashing.snapshot.you && nameClash === undefined)), named);
    expect(cleared.room.people.some(({ nameClash }) => nameClash !== undefined)).toBe(false);
    clashing.page.close();
  });

  test("gets no owner's rights by presenting the owner's own key, and learns no more of it than of a proof that fails", async () => {
    const ownersKey = keyOf(createPrivateKey(readFileSync(join(dataDir, "owner-key.pem"), "utf8")));
    const { code } = await ownerInvites(roomC, "member");
    const unproven = { status: 403, problem: "room-join-unproven" };
    expect(await refusal(await joining(code, ownersKey))).toEqual(unproven);
    expect(await refusal(await post("/join", { code, name: "Me?", person: { publicKey: ownersKey.publicKey } }))).toEqual(unproven);
    expect(await refusal(await post("/join", { code, name: "Me?", person: { publicKey: newKey().publicKey } }))).toEqual(unproven);
    expect(await challengeFor(code)).not.toBeNull();
  });

  test("is refused every message type but their own few, and every route but the page itself and joining", async () => {
    await refusesAllButTheirOwnMessages([dora.page]);
    const refused = await routesRefusedTo(dora.token);
    expect(refused).toEqual(expect.arrayContaining(["POST /tunnel", "GET /devices"]));
  }, 60_000);

  test("loses every device and socket here at once when taken out of their last room, while their messages keep their name", async () => {
    let mark = dora.page.mark;
    dora.page.send({ type: "room.subscribe", roomId: roomC.id });
    await dora.page.waitFor(isType("room.timeline", ({ roomId }) => roomId === roomC.id), mark);
    dora.page.send({ type: "room.write", roomId: roomC.id, text: "Dora was here", tags: [], threadId: null });
    const { message } = await dora.page.waitFor(roomMessageSaying("Dora was here"), mark);
    expect(message.author).toEqual({ personId: dora.personId });

    mark = dora.page.mark;
    owner.send({ type: "room.remove-person", roomId: roomD.id, personId: dora.personId });
    await dora.page.waitFor(isType("room.deleted", ({ roomId }) => roomId === roomD.id), mark);
    dora.page.send({ type: "ping" });
    await dora.page.waitFor(isType("pong"), mark);

    const ownerMark = owner.mark;
    owner.send({ type: "room.remove-person", roomId: roomC.id, personId: dora.personId });
    expect(await Promise.all([dora.page.closed, dorasSecondDevice.page.closed])).toEqual([OUT_OF_ROOMS_CLOSE_CODE, OUT_OF_ROOMS_CLOSE_CODE]);
    const { devices } = await owner.waitFor(isType("devices.listed"), ownerMark);
    expect(devices.some(({ personId }) => personId === dora.personId)).toBe(false);
    for (const token of [dora.token, dorasSecondDevice.token]) {
      await expect(Page.open(port, token)).rejects.toThrow();
      expect((await fetch(`http://127.0.0.1:${port}/ws`, { headers: { Cookie: `${TOKEN_COOKIE}=${token}` } })).status).toBe(401);
    }

    const fresh = await Page.open(port, readFileSync(join(dataDir, "browser-token"), "utf8").trim());
    const { people } = await fresh.waitFor(isType("snapshot"));
    const subscribed = fresh.mark;
    fresh.send({ type: "room.subscribe", roomId: roomC.id });
    const timeline = await fresh.waitFor(isType("room.timeline", ({ roomId }) => roomId === roomC.id), subscribed);
    fresh.close();
    expect(timeline.messages.find(({ text }) => text === "Dora was here")?.author).toEqual({ personId: dora.personId });
    expect(people.find(({ id }) => id === dora.personId)?.name).toBe("Dora");
  });

  test("comes back as the same person when invited again", async () => {
    const { code } = await ownerInvites(roomD, "member");
    const back = await joined(await joining(code, doraKey));
    back.page.close();
    expect(back.snapshot.you).toBe(dora.personId);
    expect(back.snapshot.rooms.map(({ id }) => id)).toEqual([roomD.id]);
  });

  test("leaves a room on their own word, and only their own place in it: none they are not in, and out of the last, every way in", async () => {
    const { code } = await ownerInvites(roomC, "guest");
    const { page, token } = await joined(await joining(code, doraKey));
    const other = await joined(await joining((await ownerInvites(roomC, "member")).code, newKey(), { name: "Finn" }));

    const beforeLeaving = owner.mark;
    let mark = page.mark;
    page.send({ type: "room.leave", roomId: roomA.id });
    await page.waitForError("room-gone", mark);
    page.send({ type: "room.leave", roomId: roomC.id, personId: other.snapshot.you } as never);
    await page.waitFor(isType("room.deleted", ({ roomId }) => roomId === roomC.id), mark);
    const stillIn = (personId: string, { people }: Room) => people.some((person) => person.personId === personId);
    const { room } = await owner.waitFor(isType("room.upserted", ({ room }) => room.id === roomC.id && !stillIn(dora.personId, room)), beforeLeaving);
    expect(stillIn(other.snapshot.you, room)).toBe(true);
    let ownerMark = owner.mark;
    owner.send({ type: "room.leave", roomId: roomC.id });
    await owner.waitForError("room-person-unknown", ownerMark);

    mark = page.mark;
    page.send({ type: "room.leave", roomId: roomC.id });
    await page.waitForError("room-gone", mark);
    ownerMark = owner.mark;
    page.send({ type: "room.leave", roomId: roomD.id });
    expect(await page.closed).toBe(OUT_OF_ROOMS_CLOSE_CODE);
    const { devices } = await owner.waitFor(isType("devices.listed", ({ devices }) => !devices.some(({ personId }) => personId === dora.personId)), ownerMark);
    expect(devices.some(({ personId }) => personId === other.snapshot.you)).toBe(true);
    await expect(Page.open(port, token)).rejects.toThrow();
    owner.send({ type: "room.remove-person", roomId: roomC.id, personId: other.snapshot.you });
    await other.page.closed;
  });

  describe("with one invite for several people, which waits for the owner's OK", () => {
    let studio: Room;
    let studioInvite: { id: string };
    let studioCode = "";
    const ivyKey = newKey();
    const joKey = newKey();
    let ivy: { personId: string; token: string; page: Page };
    let jo: { personId: string; token: string; page: Page };
    const ownersToken = () => readFileSync(join(dataDir, "browser-token"), "utf8").trim();
    const waitingAt = (roomIds: string[]) => isType("rooms.waiting-to-join", (waiting) => JSON.stringify(waiting.roomIds) === JSON.stringify(roomIds));

    async function knocks(code: string, room: Room, key: Key, name: string) {
      const response = await joining(code, key, { name });
      expect(response.status).toBe(200);
      const answer = (await response.json()) as { token: string; roomId: string; waiting: boolean };
      expect(answer).toMatchObject({ roomId: room.id, waiting: true });
      const page = await Page.open(port, answer.token);
      const snapshot = await page.waitFor(isType("snapshot"));
      await page.waitFor(waitingAt([room.id]));
      return { personId: snapshot.you, token: answer.token, page };
    }

    beforeAll(async () => {
      studio = await ownerCreatesRoom("Studio");
      const invited = await ownerInvites(studio, "member", 5, "after-ok");
      expect(invited.invite).toMatchObject({ roomId: studio.id, role: "member", seats: 5, letsIn: "after-ok", taken: 0 });
      [studioInvite, studioCode] = [invited.invite, invited.code];
    });

    afterAll(() => [ivy?.page, jo?.page].forEach((page) => page?.close()));

    test("takes each person to the room's door, and shows the owner who waits there: by the name they presented, in the invite's role, on which device", async () => {
      const mark = owner.mark;
      ivy = await knocks(studioCode, studio, ivyKey, "Ivy");
      jo = await knocks(studioCode, studio, joKey, "Jo");
      expect([ivy.page.snapshot.rooms, jo.page.snapshot.rooms]).toEqual([[], []]);
      expect(ivy.page.snapshot.people.map(({ id }) => id).toSorted()).toEqual([ivy.page.snapshot.ownerId, ivy.personId].toSorted());
      const { joiners } = await owner.waitFor(isType("room-joiners.listed", ({ joiners }) => joiners.length === 2), mark);
      expect(joiners).toEqual([
        { roomId: studio.id, personId: ivy.personId, role: "member", name: "Ivy", deviceName: "Dora's Mirador", since: expect.any(Number) },
        { roomId: studio.id, personId: jo.personId, role: "member", name: "Jo", deviceName: "Dora's Mirador", since: expect.any(Number) },
      ]);
      await owner.waitFor(isType("room-invites.listed", ({ invites }) => invites.some(({ id, taken }) => id === studioInvite.id && taken === 2)), mark);
      expect(owner.received.slice(mark).some(isType("room.upserted", ({ room }) => room.id === studio.id && room.people.length > 0))).toBe(false);
    });

    test("gives someone at the door nothing of the room while the owner works in it, and takes nothing of theirs into it, but that they wait", async () => {
      const [ivyMark, ownerMark] = [ivy.page.mark, owner.mark];
      owner.send({ type: "room.subscribe", roomId: studio.id });
      await ownerWritesIn(studio, "Studio secret");
      owner.send({ type: "room.rename", roomId: studio.id, name: "Studio plans" });
      owner.send({ type: "room.set-person-role", roomId: studio.id, personId: mia.id, role: "member" });
      await owner.waitFor(isType("room.upserted", ({ room }) => room.id === studio.id && room.name === "Studio plans" && room.people.length === 1), ownerMark);
      const naming = { requestId: "probe", roomId: studio.id, text: "Ivy slips in", tags: [], threadId: null, writing: true, itemId: "item", question: 0, option: 0, answers: [], muted: true, name: "Probe", harness: "opencode", agentId: "agent", taskId: "task", ended: null, conversationId: null, attentive: true, visible: true };
      PERSON_MESSAGE_TYPES.filter((type) => type !== "person.set-own-profile").forEach((type) => ivy.page.send({ type, ...naming }));
      await ivy.page.waitForError("room-gone", ivyMark);

      const came = await ivy.page.settledSince(ivyMark);
      expect([...new Set(came.map(({ type }) => type))].filter((type) => !["error", "pong", "people.listed"].includes(type))).toEqual([]);
      [studio.id, "Studio", mia.id].forEach((secret) => expect(JSON.stringify(came)).not.toContain(secret));
      const fresh = await Page.open(port, ownersToken());
      await fresh.waitFor(isType("snapshot"));
      const subscribed = fresh.mark;
      fresh.send({ type: "room.subscribe", roomId: studio.id });
      const timeline = await fresh.waitFor(isType("room.timeline", ({ roomId }) => roomId === studio.id), subscribed);
      fresh.close();
      expect(timeline.messages.map(({ text }) => text)).toEqual(["Studio secret"]);
      const aboutTheDoor = new Set<ServerMessage["type"]>(["room-joiners.listed", "people.listed", "devices.listed", "room-invites.listed"]);
      expect(JSON.stringify(owner.received.slice(ownerMark).filter(({ type }) => !aboutTheDoor.has(type)))).not.toContain(ivy.personId);
    });

    test("takes no second seat for a key that came already, which it refuses, and counts everyone who came", async () => {
      expect(await refusal(await joining(studioCode, ivyKey, { name: "Ivy again" }))).toEqual({ status: 403, problem: "room-invite-used-already" });
      const fresh = await Page.open(port, ownersToken());
      const { roomInvites, roomJoiners } = await fresh.waitFor(isType("snapshot"));
      fresh.close();
      expect(roomInvites.find(({ id }) => id === studioInvite.id)?.taken).toBe(2);
      expect(roomJoiners.map(({ name }) => name)).toEqual(["Ivy", "Jo"]);
    });

    test("lets one in on the owner's word: their page is shown the room, in the invite's role, before it hears they wait no more", async () => {
      const [ivyMark, ownerMark] = [ivy.page.mark, owner.mark];
      owner.send({ type: "room.let-in", roomId: studio.id, personId: ivy.personId });
      await ivy.page.waitFor(waitingAt([]), ivyMark);
      const came = ivy.page.received.slice(ivyMark);
      const shown = came.findIndex(isType("room.upserted", ({ room }) => room.id === studio.id));
      expect(shown).toBeGreaterThanOrEqual(0);
      expect(shown).toBeLessThan(came.findIndex(waitingAt([])));
      const { room } = came[shown] as Extract<ServerMessage, { type: "room.upserted" }>;
      expect(room.people).toContainEqual({ personId: ivy.personId, role: "member" });
      await owner.waitFor(isType("room-joiners.listed", ({ joiners }) => joiners.map(({ personId }) => personId).join() === jo.personId), ownerMark);

      ivy.page.send({ type: "room.write", roomId: studio.id, text: "Ivy is in", tags: [], threadId: null });
      await owner.waitFor(roomMessageSaying("Ivy is in"), ownerMark);
      owner.send({ type: "room.let-in", roomId: studio.id, personId: ivy.personId });
      await owner.waitForError("room-joiner-gone", ownerMark);
    });

    test("turns one away on the owner's word: they hear they wait no more, then lose every device and socket here at once, and the link takes them nowhere again", async () => {
      const [joMark, ownerMark] = [jo.page.mark, owner.mark];
      owner.send({ type: "room.turn-away", roomId: studio.id, personId: jo.personId });
      await jo.page.waitFor(waitingAt([]), joMark);
      expect(await jo.page.closed).toBe(OUT_OF_ROOMS_CLOSE_CODE);
      expect(jo.page.received.slice(joMark).some(isType("room.upserted"))).toBe(false);
      await owner.waitFor(isType("room-joiners.listed", ({ joiners }) => joiners.length === 0), ownerMark);
      await owner.waitFor(isType("devices.listed", ({ devices }) => !devices.some(({ personId }) => personId === jo.personId)), ownerMark);
      await expect(Page.open(port, jo.token)).rejects.toThrow();

      expect(await refusal(await joining(studioCode, joKey, { name: "Jo" }))).toEqual({ status: 403, problem: "room-invite-used-already" });
      owner.send({ type: "room.turn-away", roomId: studio.id, personId: jo.personId });
      await owner.waitForError("room-joiner-gone", ownerMark);
    });

    test("lets nobody new in once its seats are taken, and its link ends with the last of them", async () => {
      const mark = owner.mark;
      for (const name of ["Kai", "Lu", "Max"]) (await knocks(studioCode, studio, newKey(), name)).page.close();
      await owner.waitFor(isType("room-invites.listed", ({ invites }) => !invites.some(({ id }) => id === studioInvite.id)), mark);
      expect(await challengeFor(studioCode)).toBeNull();
      expect(await refusal(await post("/join", { code: studioCode, name: "Late", person: presented(newKey(), studioCode, "A".repeat(43)) }))).toEqual({ status: 403, problem: "invite-code-wrong" });
    });

    test("signs out someone who waited at the door of a room the owner deletes, when they are in no other room here", async () => {
      const attic = await ownerCreatesRoom("Attic");
      const { code } = await ownerInvites(attic, "guest", 5, "after-ok");
      const kim = await knocks(code, attic, newKey(), "Kim");
      const mark = kim.page.mark;
      owner.send({ type: "room.delete", roomId: attic.id });
      await kim.page.waitFor(waitingAt([]), mark);
      expect(await kim.page.closed).toBe(OUT_OF_ROOMS_CLOSE_CODE);
    });

    test("takes each person straight in when it lets several in at once", async () => {
      const { code } = await ownerInvites(studio, "guest", 5, "at-once");
      for (const name of ["Ned", "Oda"]) {
        const response = await joining(code, newKey(), { name });
        expect(await response.clone().json()).toMatchObject({ roomId: studio.id, waiting: false });
        const { page, snapshot } = await joined(response);
        page.close();
        expect(snapshot.rooms.map(({ id }) => id)).toEqual([studio.id]);
        expect(snapshot.rooms[0]!.people).toContainEqual({ personId: snapshot.you, role: "guest" });
      }
    });

    test("shows the owner someone at the door whose name reads as one in the room without it, marked, in the door list and the alert alike, and the person learns nothing of it", async () => {
      const { code } = await ownerInvites(studio, "guest", 5, "after-ok");
      const mark = owner.mark;
      const answers: Record<string, unknown>[] = [];
      for (const name of ["IVY", "Pia"]) answers.push((await (await joining(code, newKey(), { name })).json()) as Record<string, unknown>);
      expect(Object.keys(answers[0]!).toSorted()).toEqual(Object.keys(answers[1]!).toSorted());
      const pages = await Promise.all(answers.map(({ token }) => Page.open(port, token as string)));
      const snapshots = await Promise.all(pages.map((page) => page.waitFor(isType("snapshot"))));
      pages.forEach((page) => page.close());
      expect(snapshots.map(({ people, you }) => people.find(({ id }) => id === you)?.name)).toEqual(["", ""]);

      const atTheDoor = snapshots.map(({ you }) => you);
      const listed = await owner.waitFor(isType("room-joiners.listed", ({ joiners }) => atTheDoor.every((personId) => joiners.some((joiner) => joiner.personId === personId))), mark);
      const shown = atTheDoor.map((personId) => listed.joiners.find((joiner) => joiner.personId === personId)!);
      expect(shown.map(({ name, nameClash }) => [name, nameClash ?? null])).toEqual([
        ["", "IVY"],
        ["Pia", null],
      ]);
      const alerts = owner.received.slice(mark).filter(isType("system-notification")).map(({ notification }) => notification.body);
      expect(alerts).toEqual(["Someone waits for you to let them in", "Someone waits for you to let them in, giving the name “Pia”"]);
    });
  });
});

describe("joining tried quickly, as by someone guessing invite codes", () => {
  const triedFrom = async (sender: string, path: "/join" | "/join-challenges") => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": sender },
      body: JSON.stringify({ code: "ABCD-EFGH-JKLM" }),
    });
    return { status: response.status, problem: decodeURIComponent(response.headers.get(PROBLEM_HEADER) ?? "") };
  };
  const tooOften = { status: 429, problem: JSON.stringify({ code: "join-too-often" }) };
  const triesFrom = async (sender: string, path: "/join" | "/join-challenges", count: number) => {
    const statuses: number[] = [];
    for (const _ of Array(count)) statuses.push((await triedFrom(sender, path)).status);
    return statuses;
  };

  test("is refused past sixty tries a minute from one address, and past twice that from all addresses together", async () => {
    expect(await triesFrom("203.0.113.1", "/join", 60)).not.toContain(429);
    expect(await triedFrom("203.0.113.1", "/join")).toEqual(tooOften);

    expect(await triesFrom("203.0.113.2", "/join-challenges", 60)).not.toContain(429);
    expect(await triedFrom("203.0.113.2", "/join-challenges")).toEqual(tooOften);
    expect((await triedFrom("203.0.113.3", "/join-challenges")).status).toBe(404);

    const fromOneAddressEach = await Promise.all(Array.from({ length: 60 }, (_, index) => triedFrom(`198.51.100.${index}`, "/join-challenges")));
    expect(fromOneAddressEach.map(({ status }) => status)).toContain(429);
    expect(await triedFrom("192.0.2.1", "/join-challenges")).toEqual(tooOften);
  });
});
