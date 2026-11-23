import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative } from "node:path";
import { HostProblemError } from "../../shared/host-problems.ts";
import {
  HELD_CHANGES_MOST,
  ownerKey,
  roomSandbox,
  SETUP_NOT_STARTED,
  sharesKernel,
  workspaceSandbox,
  type HeldChange,
  type HeldChangeAnswer,
  type HeldChangeText,
  type SandboxBlocker,
  type SandboxFolder,
  type SandboxFolderRefusal,
  type SandboxFolderState,
  type SandboxOwner,
  type SandboxSetting,
  type SandboxSetup,
} from "../../shared/sandbox.ts";
import type { Conversation } from "../../shared/model.ts";
import type { AgentLaunch } from "../acp/harness.ts";
import type { Store } from "../store.ts";
import { addedFolderRefusal, foldersMounted, repositoryRefusal, type FolderSurroundings, type FoldersMounted, type LeftOutFolder, type MountedFolder, type OtherSandboxes } from "./added-folders.ts";
import { AGENT_USER, BUN_IN_VM, environmentInVm } from "./agent-environment.ts";
import { startCanvasSocket, type SandboxCanvas } from "./canvas-socket.ts";
import { HeldFiles, HeldFilesRefused, type HeldSandbox } from "./held-files.ts";
import type { PlacesPutBack, PlacesRequest } from "./in-vm/held-places.ts";
import { startModelProxy, type ModelRoute, type RunningSocket } from "./model-proxy.ts";
import { removeLeftSocketFolders, SOCKETS_FOLDER_PREFIX } from "./socket-folders.ts";
import { HOST_LABEL, OWNER_LABEL, SandboxNotReady, type VmLauncher } from "./vm-launcher.ts";
import { gitFoldersOf, realOrAsIs, sandboxRefusalOf, workspaceMounts, type MiradorPlaces, type Mount } from "./workspace-mounts.ts";

/** The ports a sandbox's VM gives its agents on its own 127.0.0.1, relayed to Mirador's sockets on this computer. */
export const CANVAS_RELAY_PORT = 7701;
export const MODEL_RELAY_PORT = 7702;

const IN_VM_SCRIPTS = join(import.meta.dir, "in-vm");
const SCRIPTS_IN_VM = "/mirador/sandbox";
const SOCKETS_IN_VM = "/run/mirador";
const PUT_BACK_WITHIN_MS = 30_000;

/** Claude Code took about 600 MiB after a short turn; two agents at once fit in this. */
const VM_MEMORY = "3G";

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** A sandbox's own folder in Mirador's data: a room's by its id, as it always was, and a workspace's apart from them. */
const sandboxFolder = (dataDir: string, { kind, id }: SandboxOwner) => (kind === "room" ? join(dataDir, "sandbox", id) : join(dataDir, "sandbox", "workspaces", id));

/** Where a sandbox's agents keep their Claude Code config: in Mirador's data, and at the same path in the VM. */
export const sandboxConfigFolder = (dataDir: string, owner: SandboxOwner) => join(sandboxFolder(dataDir, owner), "claude");

/** Where the copies of a sandboxed workspace's repository config, which its VM reads, are taken as the VM starts. */
const gitConfigCopies = (dataDir: string, owner: SandboxOwner) => join(sandboxFolder(dataDir, owner), "git-config");

/** Where the copies of the repository config of the sandbox's folders read and write are taken, each folder's apart, never among the workspace's. */
const folderGitConfigCopies = (dataDir: string, owner: SandboxOwner) => join(sandboxFolder(dataDir, owner), "folder-git-config");

const gitConfigCopiesOf = (dataDir: string, owner: SandboxOwner, folder: string) => join(folderGitConfigCopies(dataDir, owner), shortHash(folder, 16));

/** The canvas of a conversation, as its agent reaches it in its sandbox's VM. */
export const sandboxCanvasAddress = (conversationId: string) => `http://127.0.0.1:${CANVAS_RELAY_PORT}/mcp/${conversationId}`;

/** Whether the conversation's agent works in this sandbox: a room's work in their room's, a workspace's own, outside its rooms, in its workspace's. */
export const belongsToSandbox = ({ roomId, workspaceId }: Pick<Conversation, "roomId" | "workspaceId">, owner: SandboxOwner) =>
  owner.kind === "room" ? roomId === owner.id : workspaceId === owner.id && roomId === undefined;

/** The sandbox a conversation's agent runs in: its room's or workspace's, and how that has it set. */
export interface ConversationSandbox {
  owner: SandboxOwner;
  setting: SandboxSetting;
}

/**
 * The sandbox a conversation's agent runs in while its room, or else its workspace, has one on: nothing of the
 * conversation runs on this computer then. Null where it runs on this computer.
 */
export function sandboxOfConversation(store: Pick<Store, "findRoom" | "findWorkspace">, { roomId, workspaceId }: { roomId?: string; workspaceId?: string }): ConversationSandbox | null {
  if (roomId) {
    const room = store.findRoom(roomId);
    return room?.sandbox.on ? { owner: roomSandbox(roomId), setting: room.sandbox } : null;
  }
  const workspace = workspaceId === undefined ? undefined : store.findWorkspace(workspaceId);
  return workspace?.sandbox.on ? { owner: workspaceSandbox(workspace.id), setting: workspace.sandbox } : null;
}

const modelAddress = (profileId: string) => `http://127.0.0.1:${MODEL_RELAY_PORT}/p/${profileId}`;

/** What the sandboxes need of the rest of the host, for each room or workspace with one. */
export interface SandboxHost {
  dataDir: string;
  places: MiradorPlaces;
  workspaceOf(owner: SandboxOwner): string | null;
  canvasOf(owner: SandboxOwner): SandboxCanvas;
  /** The agents at work in the sandbox, by profile id, and their conversations. */
  atWork(owner: SandboxOwner): { agents: string[]; conversationIds: string[] };
  setupChanged(setup: SandboxSetup): void;
  /** The sandbox's held changes, each time one comes or is answered, and whether it holds as many as it may. */
  heldChanged(owner: SandboxOwner, changes: HeldChange[], full: boolean): void;
  /** The folders of this computer the owner added to the sandbox, oldest first. */
  foldersOf(owner: SandboxOwner): SandboxFolder[];
  /** What the other rooms' and workspaces' sandboxes work in. */
  otherSandboxes(owner: SandboxOwner): OtherSandboxes;
  /** The sandbox's VM started, with what of its added folders it mounted and what it left out. */
  foldersStarted(owner: SandboxOwner): void;
}

/**
 * What an agent's launch in the VM needs: the room or workspace it works for and whether that allows a sandbox that
 * shares this computer's kernel, its profile's Claude Code version, the folder it works in, what it is given, the model
 * API its requests go on to with the key, and its command in the VM.
 */
export interface AgentInSandbox {
  owner: SandboxOwner;
  allowsSharedKernel: boolean;
  profileId: string;
  claudeCodeVersion: string;
  workingDirectory: string;
  given: Record<string, string>;
  route: ModelRoute;
  agent: string[];
}

interface SandboxVm {
  owner: SandboxOwner;
  name: string;
  image: string;
  /** The workspace as its room or workspace named it when the VM started. */
  workspace: string | null;
  /** What the VM's agents can write, without links, as the VM starts on it: the workspace, then each folder added read and write it mounts. */
  writableRoots: string[];
  /** The held files of each of `writableRoots`. */
  helds: HeldFiles[];
  /** The folders the owner had added as the VM started. */
  folders: SandboxFolder[];
  started: Promise<void>;
  running: boolean;
  /** The VM's stop, once asked for. */
  halted?: Promise<void>;
  agents: number;
  stopTimer?: ReturnType<typeof setTimeout>;
  sockets: RunningSocket[];
  /** The folder of the VM's own sockets, once made. */
  socketsFolder?: string;
  /** The model API of each agent's profile, by profile id, as the agents last started. */
  routes: Map<string, ModelRoute>;
  stopping?: Promise<void>;
}

/** What a sandbox's VM mounted of its added folders and left out as it last started, and the folders it started with. */
interface FolderStart extends FoldersMounted {
  startedWith: MountedFolder[];
}

const sameFolder = (a: MountedFolder) => (b: MountedFolder) => a.path === b.path && a.writable === b.writable;

const leftOutAs = (refusal: SandboxFolderRefusal) => ({ leftOut: { kind: "refused", refusal } as LeftOutFolder });

const leftOutFor = (error: unknown) => leftOutAs(error instanceof HeldFilesRefused ? { kind: "held-files-refused" } : { kind: "could-not-mount", cause: messageOf(error) });

const shortHash = (text: string, length = 10) => createHash("sha256").update(text).digest("hex").slice(0, length);

const atItsOwnPath = (path: string, readOnly: boolean): Mount => ({ source: path, target: path, readOnly });

const overlap = (a: string, b: string) => [relative(a, b), relative(b, a)].some((inside) => inside === "" || (!inside.startsWith("..") && !isAbsolute(inside)));

const sameFolders = (a: SandboxFolder[], b: SandboxFolder[]) => JSON.stringify(a.map(({ path, writable }) => [path, writable])) === JSON.stringify(b.map(({ path, writable }) => [path, writable]));

/**
 * Lets the relays, which run as nobody from the start, another user of this computer to Mirador, connect to its
 * sockets: their folder, this user's alone, keeps every other user out, and the container is shown the sockets alone.
 */
const reachableByNobody = (sockets: string[]) => Promise.all(sockets.map((socket) => chmod(socket, 0o666)));

/** What a put-back in the VM printed, as far as it has the shape of one: anything else is taken as no answer. */
function putBackIn(printed: string): PlacesPutBack {
  const parsed = JSON.parse(printed) as Partial<PlacesPutBack>;
  if (!Array.isArray(parsed.found) || !parsed.found.every((entry) => typeof entry?.path === "string" && typeof entry.found?.kind === "string")) throw new Error("not a put-back");
  return { found: parsed.found, failed: [] };
}

/** The folder of this computer's packages, with Mirador's own claude-agent-acp, which its agents run in the VM. */
const agentPackages = () => dirname(dirname(dirname(Bun.resolveSync("@agentclientprotocol/claude-agent-acp/package.json", import.meta.dir))));

/** This host's VMs, told from another Mirador's on this computer by the data folder they were started for. */
const hostLabelOf = (dataDir: string) => shortHash(dataDir);

/**
 * One light VM per sandboxed room and per sandboxed workspace, run by the launcher this computer has: set up on first use
 * (the runtime, then the image, built here), started on its first turn, and stopped once its last agent has gone. Its
 * agents start in it as the agent user; it has no network, only Mirador's canvas and model sockets relayed in, and the
 * workspace with its repository's config and hooks read-only. No VM sees another's sockets, config folder or canvases.
 * Whatever is not ready fails the turn.
 */
export class Sandboxes {
  private setupState: SandboxSetup = SETUP_NOT_STARTED;
  private settingUp?: Promise<string>;
  /** The VMs by `ownerKey`. */
  private readonly vms = new Map<string, SandboxVm>();
  /** Each sandbox's launch under way: one at a time, so no two VMs of one room or workspace ever start. */
  private readonly launching = new Map<string, Promise<unknown>>();
  private readonly hostLabel: string;

  constructor(
    private readonly launcher: VmLauncher,
    private readonly host: SandboxHost,
    private readonly idleStopMs = 5_000,
    /** Where each VM's sockets get a folder of their own. */
    private readonly socketsParent = tmpdir(),
  ) {
    this.hostLabel = hostLabelOf(host.dataDir);
  }

  availability() {
    return this.launcher.availability();
  }

  setup(): SandboxSetup {
    return this.setupState;
  }

  confirmedRunning(owner: SandboxOwner): boolean {
    return this.vms.get(ownerKey(owner))?.running === true;
  }

  heldChanges(): HeldChange[] {
    return this.allHelds().flatMap((held) => held.changes());
  }

  /** The rooms and workspaces whose VM stopped as they hold as many changes as one may, in the workspace or in a folder. */
  holdingTooMany(): SandboxOwner[] {
    const owners = new Map([...this.vms.values(), ...this.stoppedHeld.values()].map(({ owner }) => [ownerKey(owner), owner]));
    return [...owners.values()].filter((owner) => this.holdsTooMany(owner));
  }

  heldChangeText(owner: SandboxOwner, changeId: string): HeldChangeText | null {
    return (
      this.heldsOf(owner)
        .map((held) => held.textOf(changeId))
        .find((text) => text !== null) ?? null
    );
  }

  /**
   * Why a sandbox can't work in the workspace: what keeps it from any sandbox; and, for the room's or workspace's sandbox
   * `turningOn`, another sandbox that is on writing in it or around it through a folder read and write, whose agents
   * could swap it for a link. Null where it can.
   */
  async workspaceRefusal(workspace: string, turningOn?: SandboxOwner): Promise<SandboxBlocker | null> {
    const refused = await sandboxRefusalOf(workspace, this.host.places);
    if (refused || !turningOn) return refused;
    const real = await realOrAsIs(workspace);
    const writableFoldersOn = await Promise.all(this.host.otherSandboxes(turningOn).writableFoldersOn.map(realOrAsIs));
    const written = writableFoldersOn.find((folder) => overlap(real, folder));
    return written ? { kind: "workspace-overlaps-sandbox-folder", folder: written } : null;
  }

  /** Why the folder, given without links, can't be in the sandbox with this access beside `others`, its other added folders; null where it can. */
  async folderRefusal(owner: SandboxOwner, folder: MountedFolder, others: string[]): Promise<SandboxFolderRefusal | null> {
    return addedFolderRefusal(folder, await this.folderSurroundings(owner), others);
  }

  private async folderSurroundings(owner: SandboxOwner): Promise<FolderSurroundings> {
    const workspace = this.host.workspaceOf(owner);
    const { workspaces, writableFolders, writableFoldersOn } = this.host.otherSandboxes(owner);
    const real = (paths: string[]) => Promise.all(paths.map(realOrAsIs));
    return {
      places: this.host.places,
      workspace: workspace && (await realpath(workspace).catch(() => null)),
      sandboxOwn: [sandboxConfigFolder(this.host.dataDir, owner), agentPackages(), IN_VM_SCRIPTS, SCRIPTS_IN_VM, SOCKETS_IN_VM],
      socketsParent: this.socketsParent,
      otherSandboxes: { workspaces: await real(workspaces), writableFolders: await real(writableFolders), writableFoldersOn: await real(writableFoldersOn) },
    };
  }

  /** Whether the sandbox's VM runs, or is starting, with other folders than the owner has added to it now. */
  runsWithOtherFolders(owner: SandboxOwner) {
    const vm = this.vms.get(ownerKey(owner));
    return vm !== undefined && !vm.stopping && !sameFolders(vm.folders, this.host.foldersOf(owner));
  }

  /** What each VM of a sandbox mounted of its added folders and left out as it last started, by `ownerKey`, kept once it stops. */
  private readonly folderStarts = new Map<string, FolderStart>();

  /** The added folders the sandbox's running VM mounted; none where it doesn't run. */
  mountedFolders(owner: SandboxOwner): MountedFolder[] {
    const key = ownerKey(owner);
    return this.vms.get(key)?.running ? (this.folderStarts.get(key)?.mounted ?? []) : [];
  }

  /**
   * Where an added folder stands with its access: left out as the VM last started with it so, waiting where the VM runs
   * without it so, or in the sandbox.
   */
  folderStateOf(owner: SandboxOwner, folder: MountedFolder): SandboxFolderState {
    const key = ownerKey(owner);
    const started = this.folderStarts.get(key);
    const leftOut = started?.startedWith.some(sameFolder(folder)) ? started.leftOut.get(folder.path) : undefined;
    if (leftOut) return leftOut;
    return this.vms.get(key)?.running && !started?.mounted.some(sameFolder(folder)) ? { kind: "waiting" } : { kind: "in-sandbox" };
  }

  /**
   * Before an agent session starts on this computer in a folder a sandbox works in, its workspace or one added read and
   * write, its held files are looked at once more, so none the agents planted is loaded meanwhile; where one stays, the
   * session does not start.
   */
  async settleHeldFilesFor(directory: string) {
    const real = await realpath(directory).catch(() => directory);
    const settled = await Promise.all(this.allHelds().filter((held) => overlap(real, held.workspace)).map((held) => held.check()));
    if (settled.includes(false)) throw new HostProblemError({ code: "sandbox-held-files-unsettled" });
  }

  /** The VMs working in or around this folder, as their workspace or a folder added read and write, stop before Mirador writes there itself, so none races it. */
  async stopSandboxesWorkingIn(directory: string) {
    const real = await realpath(directory).catch(() => directory);
    const working = [...this.vms.values()].filter((vm) => vm.writableRoots.some((root) => overlap(real, root)));
    await Promise.all(working.map(({ owner }) => this.stop(owner)));
  }

  /** Sets up what every sandbox needs, as the owner turns one on, so the first turn need not wait for it. */
  prepareInBackground(claudeCodeVersion: string) {
    if (this.availability().available) void this.preparedImage(claudeCodeVersion).catch(() => {});
  }

  /** The VMs a previous run of this host left behind, from a crash, and the socket folders of any host gone since. */
  async reapLeftovers() {
    await removeLeftSocketFolders(this.socketsParent);
    if (this.availability().available) await this.launcher.removeLeftovers(this.hostLabel);
  }

  /**
   * The command and environment that start the agent in its sandbox's VM, the VM started first where it isn't running.
   * Throws SandboxNotReady when anything of it is not ready; nothing here ever runs the agent on this computer.
   */
  async launch(agent: AgentInSandbox): Promise<AgentLaunch> {
    const available = this.availability();
    if (!available.available) throw new SandboxNotReady({ kind: "unavailable", why: available.why });
    if (sharesKernel(available.kind) && !agent.allowsSharedKernel) throw new SandboxNotReady({ kind: "shared-kernel-not-allowed" });
    if (this.holdsTooMany(agent.owner)) throw new SandboxNotReady({ kind: "too-many-held-changes", most: HELD_CHANGES_MOST });
    const vm = await this.oneLaunchAtATime(agent.owner, () => this.startedVm(agent.owner, agent.claudeCodeVersion));
    const configDir = sandboxConfigFolder(this.host.dataDir, agent.owner);
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
        this.agentGone(vm);
      },
    };
  }

  private oneLaunchAtATime<T>(owner: SandboxOwner, launch: () => Promise<T>): Promise<T> {
    const key = ownerKey(owner);
    const launched = (this.launching.get(key) ?? Promise.resolve()).catch(() => {}).then(launch);
    this.launching.set(key, launched);
    const forget = () => {
      if (this.launching.get(key) === launched) this.launching.delete(key);
    };
    launched.then(forget, forget);
    return launched;
  }

  /** One of the VM's agents went away; with the last of them, the VM stops a moment later. */
  private agentGone(vm: SandboxVm) {
    if (this.vms.get(ownerKey(vm.owner)) !== vm) return;
    vm.agents = Math.max(0, vm.agents - 1);
    if (vm.agents > 0) return;
    clearTimeout(vm.stopTimer);
    vm.stopTimer = setTimeout(() => void this.stop(vm.owner), this.idleStopMs);
    vm.stopTimer.unref();
  }

  /** At each turn's end the held files are looked at again, in case a watch event was missed. */
  async turnEnded(owner: SandboxOwner) {
    await Promise.all((this.vms.get(ownerKey(owner))?.helds ?? []).map((held) => held.check()));
  }

  async answerHeldChange(owner: SandboxOwner, changeId: string, answer: HeldChangeAnswer) {
    await Promise.all(this.heldsOf(owner).map((held) => held.answer(changeId, answer)));
  }

  /** The held files of the sandbox, its running VM's and those a stopped one left waiting for the owner, each once. */
  private heldsOf(owner: SandboxOwner): HeldFiles[] {
    const key = ownerKey(owner);
    return [...new Set([...(this.vms.get(key)?.helds ?? []), ...(this.stoppedHeld.get(key)?.helds ?? [])])];
  }

  private allHelds(): HeldFiles[] {
    return [...new Set([...this.vms.values(), ...this.stoppedHeld.values()].flatMap(({ helds }) => helds))];
  }

  /** Whether the held files of the workspace or of a folder hold as many changes as each may: past that, the VM does not start until the owner answers some. */
  private holdsTooMany(owner: SandboxOwner) {
    return this.heldsOf(owner).some((held) => held.full());
  }

  private heldChanged(owner: SandboxOwner) {
    this.host.heldChanged(
      owner,
      this.heldsOf(owner).flatMap((held) => held.changes()),
      this.holdsTooMany(owner),
    );
  }

  /** Stops the VM, its sockets and its watch, after a last look at the held files. */
  async stop(owner: SandboxOwner) {
    const vm = this.vms.get(ownerKey(owner));
    if (!vm) return;
    vm.stopping ??= this.tearDown(vm);
    await vm.stopping;
  }

  /** A deleted room's or workspace's VM stops, and what it held goes unanswered: the files are as they were. */
  async ownerGone(owner: SandboxOwner) {
    await this.stop(owner);
    this.stoppedHeld.delete(ownerKey(owner));
    this.folderStarts.delete(ownerKey(owner));
    this.host.heldChanged(owner, [], false);
  }

  async stopAll() {
    await Promise.all([...this.vms.values()].map(({ owner }) => this.stop(owner)));
  }

  /**
   * Held files whose VM stopped wait for the owner's answer still, by `ownerKey`: each folder's until a VM holds that
   * folder's files again, or for good where none does.
   */
  private readonly stoppedHeld = new Map<string, { owner: SandboxOwner; helds: HeldFiles[] }>();

  private keepWaiting(owner: SandboxOwner, helds: HeldFiles[]) {
    const kept = [...(this.stoppedHeld.get(ownerKey(owner))?.helds ?? []), ...helds].filter((held) => held.changes().length > 0);
    if (kept.length > 0) this.stoppedHeld.set(ownerKey(owner), { owner, helds: [...new Set(kept)] });
    else this.stoppedHeld.delete(ownerKey(owner));
  }

  /** The changes a stopped VM held in the folder these held files are of go on waiting in them. */
  private takeOverStoppedHeld(owner: SandboxOwner, held: HeldFiles) {
    const stopped = this.stoppedHeld.get(ownerKey(owner))?.helds ?? [];
    const ofSameFolder = stopped.filter((previous) => previous.workspace === held.workspace);
    ofSameFolder.forEach((previous) => held.takeOver(previous));
    this.stoppedHeld.delete(ownerKey(owner));
    this.keepWaiting(
      owner,
      stopped.filter((previous) => !ofSameFolder.includes(previous)),
    );
  }

  private async tearDown(vm: SandboxVm) {
    const key = ownerKey(vm.owner);
    clearTimeout(vm.stopTimer);
    await this.halt(vm).catch((error: unknown) => console.error(`stopping the VM of ${key} failed:`, error));
    await Promise.all(vm.sockets.map((socket) => socket.stop().catch(() => {})));
    if (vm.socketsFolder) await rm(vm.socketsFolder, { recursive: true, force: true }).catch(() => {});
    await Promise.all(vm.helds.map((held) => held.stop().catch(() => {})));
    this.keepWaiting(vm.owner, vm.helds);
    if (this.vms.get(key) === vm) this.vms.delete(key);
  }

  /** The VM stops, and nothing is put back inside it from then on; the rest of its teardown may follow. */
  private halt(vm: SandboxVm) {
    vm.running = false;
    vm.halted ??= this.launcher.stop(vm.name);
    return vm.halted;
  }

  private heldSandbox(vm: SandboxVm): HeldSandbox {
    return {
      atWork: () => this.host.atWork(vm.owner),
      changed: () => this.heldChanged(vm.owner),
      inVm: () => (vm.running ? (request) => this.putBackInVm(vm, request) : null),
      halt: async () => {
        await this.halt(vm).catch((error: unknown) => console.error(`stopping the VM of ${ownerKey(vm.owner)} failed:`, error));
        void this.stop(vm.owner);
      },
      untilStopped: () => (vm.halted ?? Promise.resolve()).then(
        () => true,
        () => false,
      ),
    };
  }

  /** Puts held places back inside the VM as the agent user, so a link on the way leads only to what the VM sees. */
  private async putBackInVm(vm: SandboxVm, request: PlacesRequest): Promise<PlacesPutBack> {
    const ran = await this.launcher.runAsAgent(vm.name, AGENT_USER, [BUN_IN_VM, `${SCRIPTS_IN_VM}/held-places.ts`], JSON.stringify(request), PUT_BACK_WITHIN_MS);
    if (ran.exitCode !== 0) throw new Error(`putting held files back in the VM failed: exit ${ran.exitCode}`);
    return putBackIn(ran.stdout);
  }

  /**
   * The sandbox's VM, running: the one there is, or a new one where there is none, where the workspace it works in
   * changed, or where it runs another image or started with other added folders and no agent of it is at work.
   */
  private async startedVm(owner: SandboxOwner, claudeCodeVersion: string): Promise<SandboxVm> {
    const image = await this.preparedImage(claudeCodeVersion);
    const key = ownerKey(owner);
    const existing = this.vms.get(key);
    const outdatedWhileIdle = (vm: SandboxVm) => vm.agents === 0 && (vm.image !== image || !sameFolders(vm.folders, this.host.foldersOf(owner)));
    const outdated = existing && !existing.stopping && (existing.workspace !== this.host.workspaceOf(owner) || outdatedWhileIdle(existing));
    if (outdated) await this.stop(owner);
    if (existing && !existing.stopping) {
      if (existing.image !== image) throw new SandboxNotReady({ kind: "versions-differ" });
      await existing.started;
      return existing;
    }
    await existing?.stopping;
    const vm: SandboxVm = {
      owner,
      name: `mirador-${this.hostLabel}-${shortHash(key, 8)}`,
      image,
      workspace: this.host.workspaceOf(owner),
      writableRoots: [],
      helds: [],
      folders: this.host.foldersOf(owner),
      started: Promise.resolve(),
      running: false,
      agents: 0,
      sockets: [],
      routes: new Map(),
    };
    vm.started = this.start(vm).catch(async (error: unknown) => {
      await this.tearDown(vm);
      throw error instanceof HostProblemError ? error : new SandboxNotReady({ kind: "could-not-start", cause: messageOf(error) });
    });
    this.vms.set(key, vm);
    await vm.started;
    return vm;
  }

  private async start(vm: SandboxVm) {
    const { owner } = vm;
    const key = ownerKey(owner);
    const workspace = vm.workspace && (await realpath(vm.workspace).catch(() => null));
    if (!workspace) throw new HostProblemError({ code: "workspace-gone" });
    const refused = await this.workspaceRefusal(workspace);
    if (refused) throw new SandboxNotReady({ kind: "blocked", blocker: refused });
    vm.writableRoots.push(workspace);
    const held = new HeldFiles(workspace, owner, await gitFoldersOf(workspace), this.heldSandbox(vm), false);
    vm.helds.push(held);
    this.takeOverStoppedHeld(owner, held);
    const heldReadOnly = await held.start();
    const planned = await workspaceMounts(workspace, gitConfigCopies(this.host.dataDir, owner), this.host.places, heldReadOnly);
    if ("refused" in planned) throw new SandboxNotReady({ kind: "blocked", blocker: planned.refused });
    const folders = await this.addedFoldersMounted(vm);
    const configFolder = sandboxConfigFolder(this.host.dataDir, owner);
    await mkdir(configFolder, { recursive: true, mode: 0o700 });
    // Unix socket paths hold about a hundred bytes on macOS, so each VM's sockets live in a short private folder.
    vm.socketsFolder = await mkdtemp(join(this.socketsParent, SOCKETS_FOLDER_PREFIX));
    const sockets = { canvas: join(vm.socketsFolder, "canvas.sock"), model: join(vm.socketsFolder, "model.sock") };
    vm.sockets.push(await startCanvasSocket(sockets.canvas, CANVAS_RELAY_PORT, this.host.canvasOf(owner)));
    vm.sockets.push(await startModelProxy(sockets.model, MODEL_RELAY_PORT, (profileId) => vm.routes.get(profileId) ?? null));
    if (this.launcher.firstProcessUser === "nobody") await reachableByNobody(Object.values(sockets));
    await this.launcher.start({
      name: vm.name,
      labels: { [HOST_LABEL]: this.hostLabel, [OWNER_LABEL]: key },
      image: vm.image,
      memory: VM_MEMORY,
      mounts: [
        ...planned.mounts,
        ...folders.mounts,
        atItsOwnPath(configFolder, false),
        atItsOwnPath(agentPackages(), true),
        { source: IN_VM_SCRIPTS, target: SCRIPTS_IN_VM, readOnly: true },
        { source: sockets.canvas, target: `${SOCKETS_IN_VM}/canvas.sock`, readOnly: false },
        { source: sockets.model, target: `${SOCKETS_IN_VM}/model.sock`, readOnly: false },
      ],
      entry: ["sh", `${SCRIPTS_IN_VM}/room-vm.sh`, this.launcher.firstProcessUser, `${CANVAS_RELAY_PORT}=${SOCKETS_IN_VM}/canvas.sock`, `${MODEL_RELAY_PORT}=${SOCKETS_IN_VM}/model.sock`],
    });
    vm.running = true;
    this.folderStarts.set(key, { ...folders.started, startedWith: vm.folders.map(({ path, writable }) => ({ path, writable })) });
    this.host.foldersStarted(owner);
  }

  /**
   * The mounts of the sandbox's added folders, each looked at as it stands now: a read-only one at its own path, and one
   * read and write as the workspace is, with held files and copies of its git config of its own. A folder that fails
   * anywhere is left out whole, never mounted in part.
   */
  private async addedFoldersMounted(vm: SandboxVm): Promise<{ mounts: Mount[]; started: FoldersMounted }> {
    const checked = await foldersMounted(vm.folders, await this.folderSurroundings(vm.owner));
    await rm(folderGitConfigCopies(this.host.dataDir, vm.owner), { recursive: true, force: true });
    const mounted: MountedFolder[] = [];
    const mounts: Mount[] = [];
    for (const folder of checked.mounted) {
      const planned = folder.writable ? await this.writableFolderMounts(vm, folder.path) : { mounts: [atItsOwnPath(folder.path, true)] };
      if ("leftOut" in planned) checked.leftOut.set(folder.path, planned.leftOut);
      else {
        mounted.push(folder);
        mounts.push(...planned.mounts);
      }
    }
    return { mounts, started: { mounted, leftOut: checked.leftOut } };
  }

  /** A folder read and write, mounted as the workspace is, its held files watched from now on; or why it is left out. */
  private async writableFolderMounts(vm: SandboxVm, folder: string): Promise<{ mounts: Mount[] } | { leftOut: LeftOutFolder }> {
    const held = new HeldFiles(folder, vm.owner, await gitFoldersOf(folder), this.heldSandbox(vm), true);
    const heldReadOnly = await held.start().catch(leftOutFor);
    if (!Array.isArray(heldReadOnly)) return heldReadOnly;
    const planned = await workspaceMounts(folder, gitConfigCopiesOf(this.host.dataDir, vm.owner, folder), this.host.places, heldReadOnly).catch(leftOutFor);
    if (!("mounts" in planned)) {
      await held.stop().catch(() => {});
      return "refused" in planned ? leftOutAs(repositoryRefusal(planned.refused)) : planned;
    }
    vm.helds.push(held);
    vm.writableRoots.push(folder);
    this.takeOverStoppedHeld(vm.owner, held);
    return planned;
  }

  /** The runtime runs and the image of this Claude Code version is there: set up once for every sandbox, its progress told as it goes. */
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

/** What the conversations of sandboxed rooms and workspaces need of the sandboxes. */
export type SandboxedAgents = Pick<Sandboxes, "launch" | "confirmedRunning" | "turnEnded" | "settleHeldFilesFor" | "stopSandboxesWorkingIn" | "stop" | "mountedFolders" | "runsWithOtherFolders">;

/** Until the host gives its conversations the sandboxes, a sandboxed room's or workspace's agent never starts. */
export const NO_SANDBOXES: SandboxedAgents = {
  launch: () => Promise.reject(new SandboxNotReady({ kind: "unavailable", why: "turned-off" })),
  confirmedRunning: () => false,
  turnEnded: async () => {},
  settleHeldFilesFor: async () => {},
  stopSandboxesWorkingIn: async () => {},
  stop: async () => {},
  mountedFolders: () => [],
  runsWithOtherFolders: () => false,
};
