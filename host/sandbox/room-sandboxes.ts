import { createHash } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative } from "node:path";
import { HostProblemError } from "../../shared/host-problems.ts";
import { HELD_CHANGES_MOST, SETUP_NOT_STARTED, type HeldChange, type HeldChangeAnswer, type HeldChangeText, type SandboxSetup } from "../../shared/sandbox.ts";
import type { AgentLaunch } from "../acp/harness.ts";
import { AGENT_USER, BUN_IN_VM, environmentInVm } from "./agent-environment.ts";
import { startCanvasSocket, type RoomCanvas } from "./canvas-socket.ts";
import { HeldFiles, type HeldRoom } from "./held-files.ts";
import type { PlacesPutBack, PlacesRequest } from "./in-vm/held-places.ts";
import { startModelProxy, type ModelRoute, type RunningSocket } from "./model-proxy.ts";
import { HOST_LABEL, ROOM_LABEL, SandboxNotReady, type VmLauncher } from "./vm-launcher.ts";
import { gitFoldersOf, sandboxRefusalOf, workspaceMounts, type MiradorPlaces, type Mount } from "./workspace-mounts.ts";

/** The ports a room's VM gives its agents on its own 127.0.0.1, relayed to Mirador's sockets on this Mac. */
export const CANVAS_RELAY_PORT = 7701;
export const MODEL_RELAY_PORT = 7702;

const IN_VM_SCRIPTS = join(import.meta.dir, "in-vm");
const SCRIPTS_IN_VM = "/mirador/sandbox";
const SOCKETS_IN_VM = "/run/mirador";
const PUT_BACK_WITHIN_MS = 30_000;

/** Claude Code took about 600 MiB after a short turn; two agents at once fit in this. */
const VM_MEMORY = "3G";

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Where a sandboxed room's agents keep their Claude Code config: in Mirador's data, and at the same path in the VM. */
export const sandboxConfigFolder = (dataDir: string, roomId: string) => join(dataDir, "sandbox", roomId, "claude");

/** Where the copies of a sandboxed room's repository config, which its VM reads, are taken as the VM starts. */
const gitConfigCopies = (dataDir: string, roomId: string) => join(dataDir, "sandbox", roomId, "git-config");

/** The canvas of a conversation, as its agent reaches it in its room's VM. */
export const sandboxCanvasAddress = (conversationId: string) => `http://127.0.0.1:${CANVAS_RELAY_PORT}/mcp/${conversationId}`;

const modelAddress = (profileId: string) => `http://127.0.0.1:${MODEL_RELAY_PORT}/p/${profileId}`;

/** What the sandboxes need of the rest of the host. */
export interface SandboxHost {
  dataDir: string;
  places: MiradorPlaces;
  workspaceOf(roomId: string): string | null;
  canvasOf(roomId: string): RoomCanvas;
  agentsAtWork(roomId: string): string[];
  setupChanged(setup: SandboxSetup): void;
  /** The room's held changes, each time one comes or is answered, and whether it holds as many as it may. */
  heldChanged(roomId: string, changes: HeldChange[], full: boolean): void;
}

/**
 * What an agent's launch in the VM needs: its profile's Claude Code version, the folder it works in, what its room gives
 * it, the model API its requests go on to with the key, and its command in the VM.
 */
export interface AgentInSandbox {
  roomId: string;
  profileId: string;
  claudeCodeVersion: string;
  workingDirectory: string;
  given: Record<string, string>;
  route: ModelRoute;
  agent: string[];
}

interface RoomVm {
  name: string;
  image: string;
  /** The workspace as the room named it when the VM started. */
  workspace: string | null;
  /** The workspace's own path, without links, once the VM started on it. */
  realWorkspace?: string;
  started: Promise<void>;
  running: boolean;
  /** The VM's stop, once asked for. */
  halted?: Promise<void>;
  agents: number;
  stopTimer?: ReturnType<typeof setTimeout>;
  sockets: RunningSocket[];
  /** The model API of each agent's profile, by profile id, as the agents last started. */
  routes: Map<string, ModelRoute>;
  held?: HeldFiles;
  stopping?: Promise<void>;
}

const shortHash = (text: string, length = 10) => createHash("sha256").update(text).digest("hex").slice(0, length);

const atItsOwnPath = (path: string, readOnly: boolean): Mount => ({ source: path, target: path, readOnly });

const overlap = (a: string, b: string) => [relative(a, b), relative(b, a)].some((inside) => inside === "" || (!inside.startsWith("..") && !isAbsolute(inside)));

/** What a put-back in the VM printed, as far as it has the shape of one: anything else is taken as no answer. */
function putBackIn(printed: string): PlacesPutBack {
  const parsed = JSON.parse(printed) as Partial<PlacesPutBack>;
  if (!Array.isArray(parsed.found) || !parsed.found.every((entry) => typeof entry?.path === "string" && typeof entry.found?.kind === "string")) throw new Error("not a put-back");
  return { found: parsed.found, failed: [] };
}

/** The folder of this Mac's packages, with Mirador's own claude-agent-acp, which its agents run in the VM. */
const agentPackages = () => dirname(dirname(dirname(Bun.resolveSync("@agentclientprotocol/claude-agent-acp/package.json", import.meta.dir))));

/** This host's VMs, told from another Mirador's on this computer by the data folder they were started for. */
const hostLabelOf = (dataDir: string) => shortHash(dataDir);

/**
 * One light VM per sandboxed room, run by the launcher this computer has: set up on first use (the runtime, then the
 * image, built here), started on the room's first turn, and stopped once its last agent has gone. Its agents start in it
 * as the agent user; it has no network, only Mirador's canvas and model sockets relayed in, and the workspace with its
 * repository's config and hooks read-only. Whatever is not ready fails the turn.
 */
export class RoomSandboxes {
  private setupState: SandboxSetup = SETUP_NOT_STARTED;
  private settingUp?: Promise<string>;
  private readonly rooms = new Map<string, RoomVm>();
  /** Each room's launch under way: one at a time, so no two VMs of one room ever start. */
  private readonly launching = new Map<string, Promise<unknown>>();
  private socketsFolder?: Promise<string>;
  private readonly hostLabel: string;

  constructor(
    private readonly launcher: VmLauncher,
    private readonly host: SandboxHost,
    private readonly idleStopMs = 5_000,
  ) {
    this.hostLabel = hostLabelOf(host.dataDir);
  }

  availability() {
    return this.launcher.availability();
  }

  setup(): SandboxSetup {
    return this.setupState;
  }

  confirmedRunning(roomId: string): boolean {
    return this.rooms.get(roomId)?.running === true;
  }

  heldChanges(): HeldChange[] {
    return [...this.rooms.values()].flatMap(({ held }) => held?.changes() ?? []).concat(this.heldOfStoppedRooms());
  }

  /** The rooms whose VM stopped as they hold as many changes as a room may. */
  roomsHoldingTooMany(): string[] {
    return [...new Set([...this.rooms.keys(), ...this.stoppedRoomsHeld.keys()])].filter((roomId) => this.heldOf(roomId)?.full());
  }

  heldChangeText(roomId: string, changeId: string): HeldChangeText | null {
    return this.heldOf(roomId)?.textOf(changeId) ?? null;
  }

  /** The workspace's own path, as this host's sandboxes know it: whether it can be shown to one. */
  workspaceRefusal(workspace: string) {
    return sandboxRefusalOf(workspace, this.host.places);
  }

  /**
   * Before an agent session starts on this Mac in a folder a sandboxed room works in, its held files are looked at once
   * more, so none the agents planted is loaded meanwhile; where one stays, the session does not start.
   */
  async settleHeldFilesFor(directory: string) {
    const real = await realpath(directory).catch(() => directory);
    const helds = [...[...this.rooms.values()].flatMap(({ held }) => (held ? [held] : [])), ...this.stoppedRoomsHeld.values()];
    const settled = await Promise.all(helds.filter((held) => overlap(real, held.workspace)).map((held) => held.check()));
    if (settled.includes(false)) throw new HostProblemError({ code: "sandbox-held-files-unsettled" });
  }

  /** The VMs of rooms working in or around this folder stop, before Mirador writes there itself, so none races it. */
  async stopRoomsWorkingIn(directory: string) {
    const real = await realpath(directory).catch(() => directory);
    const working = [...this.rooms.entries()].filter(([, vm]) => vm.realWorkspace && overlap(real, vm.realWorkspace)).map(([roomId]) => roomId);
    await Promise.all(working.map((roomId) => this.stopRoom(roomId)));
  }

  /** Sets up what every sandbox needs, as the owner turns one on, so the first turn need not wait for it. */
  prepareInBackground(claudeCodeVersion: string) {
    if (this.availability().available) void this.preparedImage(claudeCodeVersion).catch(() => {});
  }

  /** The VMs a previous run of this host left behind, from a crash. */
  async reapLeftovers() {
    if (this.availability().available) await this.launcher.removeLeftovers(this.hostLabel);
  }

  /**
   * The command and environment that start the agent in its room's VM, the VM started first where it isn't running.
   * Throws SandboxNotReady when anything of it is not ready; nothing here ever runs the agent on this Mac.
   */
  async launch(agent: AgentInSandbox): Promise<AgentLaunch> {
    const available = this.availability();
    if (!available.available) throw new SandboxNotReady({ kind: "unavailable", why: available.why });
    if (this.heldOf(agent.roomId)?.full()) throw new SandboxNotReady({ kind: "too-many-held-changes", most: HELD_CHANGES_MOST });
    const vm = await this.oneLaunchAtATime(agent.roomId, () => this.startedVm(agent.roomId, agent.claudeCodeVersion));
    const configDir = sandboxConfigFolder(this.host.dataDir, agent.roomId);
    const environment = environmentInVm(agent.given, { configDir, modelBaseUrl: modelAddress(agent.profileId), keyVariable: agent.route.keyVariable });
    const started = this.launcher.agentProcess({ vm: vm.name, user: AGENT_USER, workingDirectory: agent.workingDirectory, environment, command: agent.agent });
    vm.agents += 1;
    clearTimeout(vm.stopTimer);
    vm.routes.set(agent.profileId, agent.route);
    let gone = false;
    return {
      ...started,
      gone: () => {
        if (gone) return;
        gone = true;
        this.agentGone(agent.roomId, vm);
      },
    };
  }

  private oneLaunchAtATime<T>(roomId: string, launch: () => Promise<T>): Promise<T> {
    const launched = (this.launching.get(roomId) ?? Promise.resolve()).catch(() => {}).then(launch);
    this.launching.set(roomId, launched);
    const forget = () => {
      if (this.launching.get(roomId) === launched) this.launching.delete(roomId);
    };
    launched.then(forget, forget);
    return launched;
  }

  /** One of the room's agents went away; with the last of them, the VM stops a moment later. */
  private agentGone(roomId: string, vm: RoomVm) {
    if (this.rooms.get(roomId) !== vm) return;
    vm.agents = Math.max(0, vm.agents - 1);
    if (vm.agents > 0) return;
    clearTimeout(vm.stopTimer);
    vm.stopTimer = setTimeout(() => void this.stopRoom(roomId), this.idleStopMs);
    vm.stopTimer.unref();
  }

  /** At each turn's end the held files are looked at again, in case a watch event was missed. */
  async turnEnded(roomId: string) {
    await this.rooms.get(roomId)?.held?.check();
  }

  async answerHeldChange(roomId: string, changeId: string, answer: HeldChangeAnswer) {
    await this.heldOf(roomId)?.answer(changeId, answer);
  }

  private heldOf(roomId: string) {
    return this.rooms.get(roomId)?.held ?? this.stoppedRoomsHeld.get(roomId);
  }

  private heldChanged(roomId: string) {
    const held = this.heldOf(roomId);
    this.host.heldChanged(roomId, held?.changes() ?? [], held?.full() ?? false);
  }

  /** Stops the room's VM, its sockets and its watch, after a last look at the held files. */
  async stopRoom(roomId: string) {
    const vm = this.rooms.get(roomId);
    if (!vm) return;
    vm.stopping ??= this.tearDown(roomId, vm);
    await vm.stopping;
  }

  /** A deleted room's VM stops, and what it held goes unanswered: the files are as they were. */
  async roomGone(roomId: string) {
    await this.stopRoom(roomId);
    this.stoppedRoomsHeld.delete(roomId);
    this.host.heldChanged(roomId, [], false);
  }

  async stopAll() {
    await Promise.all([...this.rooms.keys()].map((roomId) => this.stopRoom(roomId)));
    const folder = await this.socketsFolder?.catch(() => null);
    this.socketsFolder = undefined;
    if (folder) await rm(folder, { recursive: true, force: true });
  }

  /** Held files of rooms whose VM stopped wait for the owner's answer still. */
  private readonly stoppedRoomsHeld = new Map<string, HeldFiles>();

  private heldOfStoppedRooms() {
    return [...this.stoppedRoomsHeld.entries()].filter(([roomId]) => !this.rooms.has(roomId)).flatMap(([, held]) => held.changes());
  }

  private async tearDown(roomId: string, vm: RoomVm) {
    clearTimeout(vm.stopTimer);
    await this.halt(vm).catch((error: unknown) => console.error(`stopping the VM of room ${roomId} failed:`, error));
    await Promise.all(vm.sockets.map((socket) => socket.stop().catch(() => {})));
    if (vm.held) {
      await vm.held.stop().catch(() => {});
      if (vm.held.changes().length > 0) this.stoppedRoomsHeld.set(roomId, vm.held);
    }
    if (this.rooms.get(roomId) === vm) this.rooms.delete(roomId);
  }

  /** The VM stops, and nothing is put back inside it from then on; the rest of its teardown may follow. */
  private halt(vm: RoomVm) {
    vm.running = false;
    vm.halted ??= this.launcher.stop(vm.name);
    return vm.halted;
  }

  private heldRoom(roomId: string, vm: RoomVm): HeldRoom {
    return {
      agentsAtWork: () => this.host.agentsAtWork(roomId),
      changed: () => this.heldChanged(roomId),
      inVm: () => (vm.running ? (request) => this.putBackInVm(vm, request) : null),
      halt: async () => {
        await this.halt(vm).catch((error: unknown) => console.error(`stopping the VM of room ${roomId} failed:`, error));
        void this.stopRoom(roomId);
      },
      untilStopped: () => (vm.halted ?? Promise.resolve()).then(
        () => true,
        () => false,
      ),
    };
  }

  /** Puts held places back inside the VM as the agent user, so a link on the way leads only to what the VM sees. */
  private async putBackInVm(vm: RoomVm, request: PlacesRequest): Promise<PlacesPutBack> {
    const ran = await this.launcher.runAsAgent(vm.name, AGENT_USER, [BUN_IN_VM, `${SCRIPTS_IN_VM}/held-places.ts`], JSON.stringify(request), PUT_BACK_WITHIN_MS);
    if (ran.exitCode !== 0) throw new Error(`putting held files back in the VM failed: exit ${ran.exitCode}`);
    return putBackIn(ran.stdout);
  }

  /**
   * The room's VM, running: the one there is, or a new one where there is none, where the room's workspace changed, or
   * where it runs another image and no agent of it is at work.
   */
  private async startedVm(roomId: string, claudeCodeVersion: string): Promise<RoomVm> {
    const image = await this.preparedImage(claudeCodeVersion);
    const existing = this.rooms.get(roomId);
    const outdated = existing && !existing.stopping && (existing.workspace !== this.host.workspaceOf(roomId) || (existing.image !== image && existing.agents === 0));
    if (outdated) await this.stopRoom(roomId);
    if (existing && !existing.stopping) {
      if (existing.image !== image) throw new SandboxNotReady({ kind: "versions-differ" });
      await existing.started;
      return existing;
    }
    await existing?.stopping;
    const vm: RoomVm = {
      name: `mirador-${this.hostLabel}-${shortHash(roomId, 8)}`,
      image,
      workspace: this.host.workspaceOf(roomId),
      started: Promise.resolve(),
      running: false,
      agents: 0,
      sockets: [],
      routes: new Map(),
    };
    vm.started = this.start(roomId, vm).catch(async (error: unknown) => {
      await this.tearDown(roomId, vm);
      throw error instanceof HostProblemError ? error : new SandboxNotReady({ kind: "could-not-start", cause: messageOf(error) });
    });
    this.rooms.set(roomId, vm);
    await vm.started;
    return vm;
  }

  private async start(roomId: string, vm: RoomVm) {
    const workspace = vm.workspace && (await realpath(vm.workspace).catch(() => null));
    if (!workspace) throw new HostProblemError({ code: "workspace-gone" });
    const refused = await this.workspaceRefusal(workspace);
    if (refused) throw new SandboxNotReady({ kind: "blocked", blocker: refused });
    vm.realWorkspace = workspace;
    vm.held = new HeldFiles(workspace, roomId, await gitFoldersOf(workspace), this.heldRoom(roomId, vm));
    const stoppedHeld = this.stoppedRoomsHeld.get(roomId);
    if (stoppedHeld) vm.held.takeOver(stoppedHeld);
    this.stoppedRoomsHeld.delete(roomId);
    const heldReadOnly = await vm.held.start();
    const planned = await workspaceMounts(workspace, gitConfigCopies(this.host.dataDir, roomId), this.host.places, heldReadOnly);
    if ("refused" in planned) throw new SandboxNotReady({ kind: "blocked", blocker: planned.refused });
    const sockets = join(await this.privateSocketsFolder(), shortHash(roomId, 8));
    await mkdir(sockets, { recursive: true, mode: 0o700 });
    const configFolder = sandboxConfigFolder(this.host.dataDir, roomId);
    await mkdir(configFolder, { recursive: true, mode: 0o700 });
    vm.sockets.push(await startCanvasSocket(join(sockets, "canvas.sock"), CANVAS_RELAY_PORT, this.host.canvasOf(roomId)));
    vm.sockets.push(await startModelProxy(join(sockets, "model.sock"), MODEL_RELAY_PORT, (profileId) => vm.routes.get(profileId) ?? null));
    await this.launcher.start({
      name: vm.name,
      labels: { [HOST_LABEL]: this.hostLabel, [ROOM_LABEL]: roomId },
      image: vm.image,
      memory: VM_MEMORY,
      mounts: [
        ...planned.mounts,
        atItsOwnPath(configFolder, false),
        atItsOwnPath(agentPackages(), true),
        { source: IN_VM_SCRIPTS, target: SCRIPTS_IN_VM, readOnly: true },
        { source: join(sockets, "canvas.sock"), target: `${SOCKETS_IN_VM}/canvas.sock`, readOnly: false },
        { source: join(sockets, "model.sock"), target: `${SOCKETS_IN_VM}/model.sock`, readOnly: false },
      ],
      entry: ["sh", `${SCRIPTS_IN_VM}/room-vm.sh`, `${CANVAS_RELAY_PORT}=${SOCKETS_IN_VM}/canvas.sock`, `${MODEL_RELAY_PORT}=${SOCKETS_IN_VM}/model.sock`],
    });
    vm.running = true;
  }

  /** Unix socket paths have room for about a hundred bytes on macOS, so they live in a short private folder of their own. */
  private privateSocketsFolder() {
    this.socketsFolder ??= mkdtemp(join(tmpdir(), "mirador-sandbox-"));
    return this.socketsFolder;
  }

  /** The runtime runs and the image of this Claude Code version is there: set up once for every room, its progress told as it goes. */
  private async preparedImage(claudeCodeVersion: string): Promise<string> {
    if (this.setupState.stage === "ready" && this.ready?.claudeCodeVersion === claudeCodeVersion) return this.ready.image;
    const previous = this.settingUp ?? Promise.resolve("");
    const settingUp = previous
      .catch(() => "")
      .then(async () => (this.ready?.claudeCodeVersion === claudeCodeVersion ? this.ready.image : this.setUp(claudeCodeVersion)));
    this.settingUp = settingUp;
    return settingUp;
  }

  private ready?: { claudeCodeVersion: string; image: string };

  private async setUp(claudeCodeVersion: string) {
    const progress = (setup: SandboxSetup) => {
      this.setupState = setup;
      this.host.setupChanged(setup);
    };
    try {
      const image = await this.launcher.prepare(claudeCodeVersion, progress);
      this.ready = { claudeCodeVersion, image };
      progress({ stage: "ready" });
      return image;
    } catch (error) {
      const problem = messageOf(error);
      progress({ stage: "failed", problem });
      throw new SandboxNotReady({ kind: "setup-failed", cause: problem });
    }
  }
}

/** What a room's conversations need of the sandboxes. */
export type RoomAgentSandboxes = Pick<RoomSandboxes, "launch" | "confirmedRunning" | "turnEnded" | "settleHeldFilesFor" | "stopRoomsWorkingIn">;

/** Until the host gives its conversations the sandboxes, a sandboxed room's agent never starts. */
export const NO_SANDBOXES: RoomAgentSandboxes = {
  launch: () => Promise.reject(new SandboxNotReady({ kind: "unavailable", why: "turned-off" })),
  confirmedRunning: () => false,
  turnEnded: async () => {},
  settleHeldFilesFor: async () => {},
  stopRoomsWorkingIn: async () => {},
};
