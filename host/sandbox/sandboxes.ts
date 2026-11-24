import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { HostProblemError } from "../../shared/host-problems.ts";
import {
  HELD_CHANGES_MOST,
  ownerKey,
  roomSandbox,
  SANDBOXED_HARNESSES,
  SETUP_NOT_STARTED,
  sharesKernel,
  workspaceSandbox,
  type HeldChange,
  type HeldChangeAnswer,
  type HeldChangeText,
  type SandboxBlocker,
  type SandboxedHarness,
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
import { AGENT_USER, BUN_IN_VM, environmentInVm, IN_VM, SCRIPTS_IN_VM, type SandboxedKind } from "./agent-environment.ts";
import { startCanvasSocket, type SandboxCanvas } from "./canvas-socket.ts";
import { HeldFiles, HeldFilesRefused, type HeldSandbox } from "./held-files.ts";
import type { PlacesPutBack, PlacesRequest } from "./in-vm/held-places.ts";
import type { AgentImage } from "./image.ts";
import { secretsOf, startModelProxy, type ModelRoute, type RunningSocket } from "./model-proxy.ts";
import { startPresenceSocket } from "./presence-socket.ts";
import { removeLeftSocketFolders, SOCKETS_FOLDER_PREFIX } from "./socket-folders.ts";
import { HOST_LABEL, OWNER_LABEL, SandboxNotReady, type AgentInVm, type VmLauncher } from "./vm-launcher.ts";
import { asTheyStand, gitFoldersOf, isInside, realOrAsIs, replacedAmong, sandboxRefusalOf, workspaceMounts, type MiradorPlaces, type Mount, type StoodSource } from "./workspace-mounts.ts";

/** The ports a sandbox's VM gives its agents on its own 127.0.0.1, relayed to Mirador's sockets on this computer. */
export const CANVAS_RELAY_PORT = 7701;
export const MODEL_RELAY_PORT = 7702;

/** The port the VM of an agent someone brought gives nothing on: its relay is there for that VM to end once Mirador is gone. */
const PRESENCE_RELAY_PORT = 7703;

const IN_VM_SCRIPTS = join(import.meta.dir, "in-vm");
const SOCKETS_IN_VM = "/run/mirador";
const PUT_BACK_WITHIN_MS = 30_000;

/** Claude Code took about 600 MiB after a short turn; two agents at once fit in this. */
const VM_MEMORY = "3G";

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** A sandbox's own folder in Mirador's data: a room's by its id, as it always was, and a workspace's apart from them. */
const sandboxFolder = (dataDir: string, { kind, id }: SandboxOwner) => (kind === "room" ? join(dataDir, "sandbox", id) : join(dataDir, "sandbox", "workspaces", id));

/** Where a sandbox's agents of a kind keep their config and sessions: in Mirador's data, and at the same path in the VM. */
export const sandboxConfigFolder = (dataDir: string, owner: SandboxOwner, harness: SandboxedHarness) => join(sandboxFolder(dataDir, owner), harness);

const sandboxConfigFolders = (dataDir: string, owner: SandboxOwner) => SANDBOXED_HARNESSES.map((harness) => sandboxConfigFolder(dataDir, owner, harness));

/** Where the copies of a sandboxed workspace's repository config, which its VMs read, are taken as the first of them starts, each time in a folder of their own. */
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
  /** The room's or workspace's own agents at work in the sandbox, by profile id, and their conversations. */
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
 * shares this computer's kernel, its profile's agent kind at its version, the folder it works in, what it is given, the
 * model API its requests go on to with the key, and its command in the VM.
 */
export interface AgentInSandbox {
  owner: SandboxOwner;
  allowsSharedKernel: boolean;
  profileId: string;
  kind: SandboxedKind;
  /** The version of its kind's program on this computer, which its image installs. */
  version: string;
  workingDirectory: string;
  given: Record<string, string>;
  route: ModelRoute;
  agent: string[];
}

/**
 * An agent someone brought into a room, which runs on their own computer and has its calls in the room's workspace done
 * in a VM: the images that VM may run, as whatever agent's they are it runs none of it, and the command of one call.
 */
export interface BroughtAgentInSandbox {
  owner: SandboxOwner;
  agentId: string;
  allowsSharedKernel: boolean;
  images(): Promise<AgentImage[]>;
  workingDirectory: string;
  command: string[];
}

interface SandboxVm {
  key: string;
  owner: SandboxOwner;
  /** The agent someone brought that the VM is for alone; null for the VM of the room's or workspace's own agents. */
  broughtAgent: string | null;
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
  /** Over once its start is, however that came out. */
  startOver: Promise<unknown>;
  /** The VM's start on this computer, once asked for: a stop waits for it, as one that came first would leave it running. */
  launching?: Promise<void>;
  running: boolean;
  /** The VM's stop, once asked for. */
  halted?: Promise<void>;
  /** The VM stopped, and its held files are no longer its business. */
  left: boolean;
  /** The agents at work in it, or a brought agent's calls under way there. */
  agents: number;
  stopTimer?: ReturnType<typeof setTimeout>;
  sockets: RunningSocket[];
  /** The folder of the VM's own sockets, once made. */
  socketsFolder?: string;
  /** The model API of each agent's profile, by profile id, as the agents last started. */
  routes: Map<string, ModelRoute>;
  stopping?: Promise<void>;
}

/** What a sandbox's VMs all mount of the workspace while any of them works there, and each source of it as it stood when it was planned. */
interface WorkspacePlan {
  mounts: Mount[];
  stood: StoodSource[];
}

/** What a VM sees besides the workspace and Mirador's scripts, and each port of its own with the socket of this computer it leads to. */
interface SeenInVm {
  mounts: Mount[];
  relays: { port: number; socket: string }[];
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

const worksIn = (folder: string) => (vm: SandboxVm) => vm.writableRoots.some((root) => overlap(root, folder));

const isBrought = ({ broughtAgent }: SandboxVm) => broughtAgent !== null;

const agentsVmKey = ownerKey;

const broughtVmKey = (owner: SandboxOwner, agentId: string) => `${ownerKey(owner)}/${agentId}`;

/** The folder of this computer's packages, with Mirador's own claude-agent-acp, which its agents run in the VM. */
const agentPackages = () => dirname(dirname(dirname(Bun.resolveSync("@agentclientprotocol/claude-agent-acp/package.json", import.meta.dir))));

/** This host's VMs, told from another Mirador's on this computer by the data folder they were started for. */
const hostLabelOf = (dataDir: string) => shortHash(dataDir);

/**
 * One light VM per sandboxed room and per sandboxed workspace, run by the launcher this computer has: set up on first use
 * (the runtime, then the image, built here), started on its first turn, and stopped once its last agent has gone. Its
 * agents start in it as the agent user; it has no network, only Mirador's canvas and model sockets relayed in, and the
 * workspace with its repository's config and hooks read-only. No VM sees another's sockets, config folder or canvases.
 * Whatever is not ready fails the turn. An agent someone brought into a sandboxed room has its calls done in a VM of its
 * own, which sees the workspace as the room's own VM does and none of what that one's agents have: their models, canvases,
 * settings, sessions or added folders.
 */
export class Sandboxes {
  private setupState: SandboxSetup = SETUP_NOT_STARTED;
  private settingUp?: Promise<string>;
  /** The VMs by their keys. */
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
    private readonly broughtIdleStopMs = 60_000,
  ) {
    this.hostLabel = hostLabelOf(host.dataDir);
  }

  availability() {
    return this.launcher.availability();
  }

  setup(): SandboxSetup {
    return this.setupState;
  }

  private agentsVm(owner: SandboxOwner) {
    return this.vms.get(agentsVmKey(owner));
  }

  private vmsOf(owner: SandboxOwner) {
    return [...this.vms.values()].filter((vm) => ownerKey(vm.owner) === ownerKey(owner));
  }

  confirmedRunning(owner: SandboxOwner): boolean {
    return this.agentsVm(owner)?.running === true;
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
      sandboxOwn: [...sandboxConfigFolders(this.host.dataDir, owner), agentPackages(), IN_VM_SCRIPTS, SCRIPTS_IN_VM, SOCKETS_IN_VM],
      socketsParent: this.socketsParent,
      otherSandboxes: { workspaces: await real(workspaces), writableFolders: await real(writableFolders), writableFoldersOn: await real(writableFoldersOn) },
    };
  }

  /** Whether the sandbox's VM runs, or is starting, with other folders than the owner has added to it now. */
  runsWithOtherFolders(owner: SandboxOwner) {
    const vm = this.agentsVm(owner);
    return vm !== undefined && !vm.stopping && !sameFolders(vm.folders, this.host.foldersOf(owner));
  }

  /** What each VM of a sandbox mounted of its added folders and left out as it last started, by `ownerKey`, kept once it stops. */
  private readonly folderStarts = new Map<string, FolderStart>();

  /** The added folders the sandbox's running VM mounted; none where it doesn't run. */
  mountedFolders(owner: SandboxOwner): MountedFolder[] {
    return this.agentsVm(owner)?.running ? (this.folderStarts.get(ownerKey(owner))?.mounted ?? []) : [];
  }

  /**
   * Where an added folder stands with its access: left out as the VM last started with it so, waiting where the VM runs
   * without it so, or in the sandbox.
   */
  folderStateOf(owner: SandboxOwner, folder: MountedFolder): SandboxFolderState {
    const started = this.folderStarts.get(ownerKey(owner));
    const leftOut = started?.startedWith.some(sameFolder(folder)) ? started.leftOut.get(folder.path) : undefined;
    if (leftOut) return leftOut;
    return this.agentsVm(owner)?.running && !started?.mounted.some(sameFolder(folder)) ? { kind: "waiting" } : { kind: "in-sandbox" };
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
    await Promise.all(working.map((vm) => this.stopVm(vm)));
  }

  /** Sets up what every sandbox needs, and the image of this agent, as the owner turns one on, so the first turn need not wait for it. */
  prepareInBackground(agent: AgentImage) {
    if (this.availability().available) void this.preparedImage(agent).catch(() => {});
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
    this.assertMayLaunch(agent);
    const { harness } = agent.kind;
    const vm = await this.oneLaunchAtATime(agent.owner, () => this.startedAgentsVm(agent.owner, { harness, version: agent.version }));
    const places = { configFolder: sandboxConfigFolder(this.host.dataDir, agent.owner, harness), modelBaseUrl: modelAddress(agent.profileId) };
    const environment = environmentInVm(agent.given, agent.kind, places, secretsOf(agent.route));
    const launched = this.launchedIn(vm, { workingDirectory: agent.workingDirectory, environment, command: agent.agent });
    vm.routes.set(agent.profileId, agent.route);
    return launched;
  }

  /**
   * The command and environment that do a brought agent's call in its own VM, started first where it isn't running; it
   * throws SandboxNotReady as `launch` does.
   */
  async launchForBrought(agent: BroughtAgentInSandbox): Promise<AgentLaunch> {
    this.assertMayLaunch(agent);
    const vm = await this.oneLaunchAtATime(agent.owner, () => this.startedBroughtVm(agent));
    return this.launchedIn(vm, { workingDirectory: agent.workingDirectory, environment: { ...IN_VM }, command: agent.command });
  }

  private assertMayLaunch({ owner, allowsSharedKernel }: Pick<AgentInSandbox, "owner" | "allowsSharedKernel">) {
    const available = this.availability();
    if (!available.available) throw new SandboxNotReady({ kind: "unavailable", why: available.why });
    if (sharesKernel(available.kind) && !allowsSharedKernel) throw new SandboxNotReady({ kind: "shared-kernel-not-allowed" });
    if (this.holdsTooMany(owner)) throw new SandboxNotReady({ kind: "too-many-held-changes", most: HELD_CHANGES_MOST });
  }

  private launchedIn(vm: SandboxVm, process: Pick<AgentInVm, "workingDirectory" | "environment" | "command">): AgentLaunch {
    const started = this.launcher.agentProcess({ vm: vm.name, user: AGENT_USER, ...process });
    vm.agents += 1;
    clearTimeout(vm.stopTimer);
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

  /** One of the VM's agents went away; with the last of them, the VM stops a moment later, a brought agent's after it made no call for a while. */
  private agentGone(vm: SandboxVm) {
    if (this.vms.get(vm.key) !== vm) return;
    vm.agents = Math.max(0, vm.agents - 1);
    if (vm.agents > 0) return;
    clearTimeout(vm.stopTimer);
    vm.stopTimer = setTimeout(() => void this.stopVm(vm), vm.broughtAgent === null ? this.idleStopMs : this.broughtIdleStopMs);
    vm.stopTimer.unref();
  }

  /** At each turn's end the held files are looked at again, in case a watch event was missed. */
  async turnEnded(owner: SandboxOwner) {
    const helds = new Set(this.vmsOf(owner).flatMap((vm) => vm.helds));
    await Promise.all([...helds].map((held) => held.check()));
  }

  async answerHeldChange(owner: SandboxOwner, changeId: string, answer: HeldChangeAnswer) {
    await Promise.all(this.heldsOf(owner).map((held) => held.answer(changeId, answer)));
  }

  /** The held files of the sandbox, its running VMs' and those a stopped one left waiting for the owner, each once. */
  private heldsOf(owner: SandboxOwner): HeldFiles[] {
    return [...new Set([...this.vmsOf(owner).flatMap(({ helds }) => helds), ...(this.stoppedHeld.get(ownerKey(owner))?.helds ?? [])])];
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

  /** Stops the VM of the sandbox's own agents. */
  async stop(owner: SandboxOwner) {
    const vm = this.agentsVm(owner);
    if (vm) await this.stopVm(vm);
  }

  /** Stops the VM of an agent someone brought, as it works in the workspace no longer. */
  async stopBrought(owner: SandboxOwner, agentId: string) {
    const vm = this.vms.get(broughtVmKey(owner, agentId));
    if (vm) await this.stopVm(vm);
  }

  /** Stops the VM, its sockets and its watch, after a last look at the held files. */
  private async stopVm(vm: SandboxVm) {
    vm.stopping ??= this.tearDown(vm);
    await vm.stopping;
  }

  /** A deleted room's or workspace's VMs stop, and what they held goes unanswered: the files are as they were. */
  async ownerGone(owner: SandboxOwner) {
    await Promise.all(this.vmsOf(owner).map((vm) => this.stopVm(vm)));
    this.stoppedHeld.delete(ownerKey(owner));
    this.folderStarts.delete(ownerKey(owner));
    this.host.heldChanged(owner, [], false);
  }

  async stopAll() {
    await Promise.all([...this.vms.values()].map((vm) => this.stopVm(vm)));
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
    clearTimeout(vm.stopTimer);
    const halted = await this.haltOrSay(vm);
    await vm.startOver;
    await Promise.all(vm.sockets.map((socket) => socket.stop().catch(() => {})));
    if (vm.socketsFolder) await rm(vm.socketsFolder, { recursive: true, force: true }).catch(() => {});
    await this.leaveHeldFiles(vm);
    if (halted) this.knownToHaveStopped(vm);
    else this.lingering.add(vm);
    if (this.vms.get(vm.key) === vm) this.vms.delete(vm.key);
  }

  /** VMs that did not stop when they were to, and may run still. */
  private readonly lingering = new Set<SandboxVm>();

  private knownToHaveStopped(vm: SandboxVm) {
    this.lingering.delete(vm);
    vm.helds.forEach((held) => this.vmsAmong.get(held)?.delete(vm));
  }

  /** Nothing starts in the folder while a VM that worked there may run on: each is stopped again first. */
  private async untilNoneLingersIn(folder: string) {
    await Promise.all([...this.lingering].filter(worksIn(folder)).map((vm) => this.launcher.stop(vm.name).then(() => this.knownToHaveStopped(vm), () => {})));
    if ([...this.lingering].some(worksIn(folder))) throw new SandboxNotReady({ kind: "could-not-start", cause: "another VM that worked there did not stop" });
  }

  /** The held files no other VM works among stop, and what they hold goes on waiting; the rest are looked at once more. */
  private async leaveHeldFiles(vm: SandboxVm) {
    vm.left = true;
    const stopped = vm.helds.filter((held) => this.workingAmong(held).length === 0);
    const goingOn = vm.helds.filter((held) => !stopped.includes(held));
    await Promise.all([...stopped.map((held) => held.stop().catch(() => {})), ...goingOn.map((held) => held.check().catch(() => false))]);
    this.keepWaiting(vm.owner, stopped);
  }

  /** The VMs that write among each folder's held files, or did and are not known to have stopped. */
  private readonly vmsAmong = new WeakMap<HeldFiles, Set<SandboxVm>>();

  private workingAmong(held: HeldFiles) {
    return [...(this.vmsAmong.get(held) ?? [])].filter(({ left }) => !left);
  }

  /** The VM stops, and nothing is put back inside it from then on; the rest of its teardown may follow. */
  private halt(vm: SandboxVm) {
    vm.running = false;
    vm.halted ??= vm.launching ? vm.launching.catch(() => {}).then(() => this.launcher.stop(vm.name)) : Promise.resolve();
    return vm.halted;
  }

  private assertNotStopped(vm: SandboxVm) {
    if (vm.halted) throw new SandboxNotReady({ kind: "could-not-start", cause: "it was stopped while it started" });
  }

  private haltOrSay(vm: SandboxVm) {
    return this.halt(vm).then(
      () => true,
      (error: unknown) => {
        console.error(`stopping the VM of ${vm.key} failed:`, error);
        return false;
      },
    );
  }

  /** What a folder's held files ask of the sandbox's VMs that work in it, given as they come and go: a put-back is done in one of them, and all of them stop where it does not hold. */
  private heldSandbox(owner: SandboxOwner, vms: Set<SandboxVm>): HeldSandbox {
    return {
      atWork: () => {
        const { agents, conversationIds } = this.host.atWork(owner);
        return { agents: [...agents, ...[...vms].flatMap(({ broughtAgent }) => broughtAgent ?? [])], conversationIds };
      },
      changed: () => this.heldChanged(owner),
      inVm: () => {
        const vm = [...vms].find(({ running }) => running);
        return vm ? (request) => this.putBackInVm(vm, request) : null;
      },
      halt: async () => {
        const working = [...vms].filter(({ left }) => !left);
        await Promise.all(working.map((vm) => this.haltOrSay(vm)));
        working.forEach((vm) => void this.stopVm(vm));
      },
      untilStopped: () =>
        Promise.all([...vms].map(({ halted }) => halted)).then(
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
   * The VM of the sandbox's own agents, running: the one there is, or a new one where there is none, where the workspace
   * it works in changed, or where it runs another image or started with other added folders and no agent of it is at work.
   */
  private async startedAgentsVm(owner: SandboxOwner, agent: AgentImage): Promise<SandboxVm> {
    const image = await this.preparedImage(agent);
    const folders = this.host.foldersOf(owner);
    const existing = this.agentsVm(owner);
    const outdatedWhileIdle = (vm: SandboxVm) => vm.agents === 0 && (vm.image !== image || !sameFolders(vm.folders, folders));
    const outdated = existing && !existing.stopping && (existing.workspace !== this.host.workspaceOf(owner) || outdatedWhileIdle(existing));
    if (outdated) await this.stop(owner);
    if (existing && !existing.stopping) {
      if (existing.image !== image) throw new SandboxNotReady({ kind: "versions-differ" });
      await existing.started;
      return existing;
    }
    return this.startedNew({ key: agentsVmKey(owner), owner, broughtAgent: null, image, folders });
  }

  /** The VM of an agent someone brought, running: the one there is, where it works in the workspace as it now is, or a new one. */
  private async startedBroughtVm({ owner, agentId, images }: BroughtAgentInSandbox): Promise<SandboxVm> {
    const key = broughtVmKey(owner, agentId);
    const existing = this.vms.get(key);
    if (existing && !existing.stopping && existing.workspace === this.host.workspaceOf(owner)) {
      await existing.started;
      return existing;
    }
    if (existing) await this.stopVm(existing);
    return this.startedNew({ key, owner, broughtAgent: agentId, image: await this.anyImageOf(await images()), folders: [] });
  }

  /** Any of these images, one that is set up before one to be built: they differ only in their agent's program. */
  private anyImageOf(images: AgentImage[]) {
    const image = images.find((each) => this.readyImage(each) !== null) ?? images[0];
    if (!image) throw new SandboxNotReady({ kind: "no-agent-version", harness: "claude" });
    return this.preparedImage(image);
  }

  private async startedNew(given: Pick<SandboxVm, "key" | "owner" | "broughtAgent" | "image" | "folders">): Promise<SandboxVm> {
    await this.untilNoneStops(given.owner);
    const vm: SandboxVm = {
      ...given,
      name: `mirador-${this.hostLabel}-${shortHash(given.key, 8)}`,
      workspace: this.host.workspaceOf(given.owner),
      writableRoots: [],
      helds: [],
      started: Promise.resolve(),
      startOver: Promise.resolve(),
      running: false,
      left: false,
      agents: 0,
      sockets: [],
      routes: new Map(),
    };
    this.vms.set(vm.key, vm);
    const start = this.start(vm);
    vm.startOver = start.catch(() => {});
    vm.started = start.catch(async (error: unknown) => {
      await this.stopVm(vm);
      throw error instanceof HostProblemError ? error : new SandboxNotReady({ kind: "could-not-start", cause: messageOf(error) });
    });
    await vm.started;
    return vm;
  }

  /** A VM that stops hands over what it held only once it has, so none starts in its folders before. */
  private async untilNoneStops(owner: SandboxOwner) {
    const stopping = () => this.vmsOf(owner).flatMap((vm) => vm.stopping ?? []);
    while (stopping().length > 0) await Promise.all(stopping());
  }

  private async start(vm: SandboxVm) {
    const workspace = vm.workspace && (await realpath(vm.workspace).catch(() => null));
    if (!workspace) throw new HostProblemError({ code: "workspace-gone" });
    const refused = await this.workspaceRefusal(workspace);
    if (refused) throw new SandboxNotReady({ kind: "blocked", blocker: refused });
    const mounts = await this.mountsIn(workspace, vm);
    const folders = vm.broughtAgent === null ? await this.addedFoldersMounted(vm) : null;
    // Unix socket paths hold about a hundred bytes on macOS, so each VM's sockets live in a short private folder.
    vm.socketsFolder = await mkdtemp(join(this.socketsParent, SOCKETS_FOLDER_PREFIX));
    const seen = vm.broughtAgent === null ? await this.agentsOwn(vm, vm.socketsFolder) : await this.presenceOnly(vm, vm.socketsFolder);
    if (this.launcher.firstProcessUser === "nobody") await reachableByNobody(seen.relays.map(({ socket }) => socket));
    const inVm = (socket: string) => `${SOCKETS_IN_VM}/${basename(socket)}`;
    this.assertNotStopped(vm);
    vm.launching = this.launcher.start({
      name: vm.name,
      labels: { [HOST_LABEL]: this.hostLabel, [OWNER_LABEL]: ownerKey(vm.owner) },
      image: vm.image,
      memory: VM_MEMORY,
      mounts: [
        ...mounts,
        ...(folders?.mounts ?? []),
        ...seen.mounts,
        { source: IN_VM_SCRIPTS, target: SCRIPTS_IN_VM, readOnly: true },
        ...seen.relays.map(({ socket }) => ({ source: socket, target: inVm(socket), readOnly: false })),
      ],
      entry: ["sh", `${SCRIPTS_IN_VM}/room-vm.sh`, this.launcher.firstProcessUser, ...seen.relays.map(({ port, socket }) => `${port}=${inVm(socket)}`)],
    });
    await vm.launching;
    this.assertNotStopped(vm);
    vm.running = true;
    if (!folders) return;
    this.folderStarts.set(ownerKey(vm.owner), { ...folders.started, startedWith: vm.folders.map(({ path, writable }) => ({ path, writable })) });
    this.host.foldersStarted(vm.owner);
  }

  /** What the sandbox's own agents have in their VM: their kinds' folders, the packages they run, and the canvas and model sockets. */
  private async agentsOwn(vm: SandboxVm, socketsFolder: string): Promise<SeenInVm> {
    const configFolders = sandboxConfigFolders(this.host.dataDir, vm.owner);
    await Promise.all(configFolders.map((folder) => mkdir(folder, { recursive: true, mode: 0o700 })));
    const [canvas, model] = [join(socketsFolder, "canvas.sock"), join(socketsFolder, "model.sock")];
    vm.sockets.push(await startCanvasSocket(canvas, CANVAS_RELAY_PORT, this.host.canvasOf(vm.owner)));
    vm.sockets.push(await startModelProxy(model, MODEL_RELAY_PORT, (profileId) => vm.routes.get(profileId) ?? null));
    return {
      mounts: [...configFolders.map((folder) => atItsOwnPath(folder, false)), atItsOwnPath(agentPackages(), true)],
      relays: [
        { port: CANVAS_RELAY_PORT, socket: canvas },
        { port: MODEL_RELAY_PORT, socket: model },
      ],
    };
  }

  /** The VM of an agent someone brought has none of that: a socket that gives nothing, for the VM to end once Mirador is gone. */
  private async presenceOnly(vm: SandboxVm, socketsFolder: string): Promise<SeenInVm> {
    const socket = join(socketsFolder, "presence.sock");
    vm.sockets.push(await startPresenceSocket(socket));
    return { mounts: [], relays: [{ port: PRESENCE_RELAY_PORT, socket }] };
  }

  /**
   * What the VM mounts of the workspace, planned while no VM of an agent someone brought works there that could swap a
   * folder of it for a link to elsewhere. Beside this sandbox's own VMs there it mounts just what they do: none of that
   * can be swapped from within them, where each is a mount point.
   */
  private async mountsIn(workspace: string, vm: SandboxVm): Promise<Mount[]> {
    vm.writableRoots.push(workspace);
    await this.keepBroughtAgentsOfOthersOut(workspace, vm);
    await this.untilNoneLingersIn(workspace);
    const shared = await this.planShared(workspace, vm);
    return (shared ?? (await this.newPlan(workspace, vm))).mounts;
  }

  /** Beside another room's or workspace's VM, or this one's in another workspace, a brought agent's does not start, and those of brought agents stop. */
  private async keepBroughtAgentsOfOthersOut(workspace: string, vm: SandboxVm) {
    const sharesPlan = ({ owner, writableRoots }: SandboxVm) => ownerKey(owner) === ownerKey(vm.owner) && writableRoots[0] === workspace;
    const others = [...this.vms.values()].filter((other) => !sharesPlan(other) && worksIn(workspace)(other));
    if (isBrought(vm) && others.length > 0) throw new SandboxNotReady({ kind: "blocked", blocker: { kind: "workspace-overlaps-sandbox-folder", folder: workspace } });
    await Promise.all(others.filter(isBrought).map((other) => this.stopVm(other)));
  }

  /**
   * The plan of the sandbox's other VMs in the workspace, where they are, whose held files the VM then works among; null
   * where there are none. Where a source of it was replaced meanwhile, as by the owner, a brought agent's VM does not
   * start, and the sandbox's own agents' stops theirs, for it all to be planned anew.
   */
  private async planShared(workspace: string, vm: SandboxVm): Promise<WorkspacePlan | null> {
    const others = () => this.vmsOf(vm.owner).filter((other) => other !== vm && worksIn(workspace)(other));
    const stopping = () => others().flatMap((other) => other.stopping ?? []);
    while (stopping().length > 0) await Promise.all(stopping());
    const held = others().flatMap(({ helds }) => helds).find((each) => each.workspace === workspace);
    const plan = held && this.plans.get(held);
    if (!held || !plan) return null;
    vm.helds.push(held);
    this.vmsAmong.get(held)?.add(vm);
    const replaced = await replacedAmong(plan.stood);
    if (replaced === null) return plan;
    if (isBrought(vm)) throw new HeldFilesRefused(`${relative(workspace, replaced)} was moved or replaced`);
    vm.helds = [];
    this.vmsAmong.get(held)?.delete(vm);
    await Promise.all(others().map((other) => this.stopVm(other)));
    await this.untilNoneLingersIn(workspace);
    return this.planShared(workspace, vm);
  }

  /** The plan each held workspace's VMs share. */
  private readonly plans = new WeakMap<HeldFiles, WorkspacePlan>();

  private async newPlan(workspace: string, vm: SandboxVm): Promise<WorkspacePlan> {
    const held = await this.newHeldFiles(workspace, vm, false);
    vm.helds.push(held);
    this.takeOverStoppedHeld(vm.owner, held);
    const heldReadOnly = await held.start();
    const copies = gitConfigCopies(this.host.dataDir, vm.owner);
    if (this.vmsOf(vm.owner).length === 1) await rm(copies, { recursive: true, force: true });
    const planned = await workspaceMounts(workspace, join(copies, crypto.randomUUID()), this.host.places, heldReadOnly);
    if ("refused" in planned) throw new SandboxNotReady({ kind: "blocked", blocker: planned.refused });
    const plan = { mounts: planned.mounts, stood: await asTheyStand(planned.mounts.filter(({ source }) => isInside(source, workspace))) };
    this.plans.set(held, plan);
    return plan;
  }

  private async newHeldFiles(folder: string, vm: SandboxVm, isAddedFolder: boolean) {
    const vms = new Set([vm]);
    const held = new HeldFiles(folder, vm.owner, await gitFoldersOf(folder), this.heldSandbox(vm.owner, vms), isAddedFolder);
    this.vmsAmong.set(held, vms);
    return held;
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
    const held = await this.newHeldFiles(folder, vm, true);
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

  /**
   * The runtime runs and the image of this agent kind and version is there: set up once for every sandbox, one image at
   * a time, its progress told as it goes.
   */
  private async preparedImage(agent: AgentImage): Promise<string> {
    const image = this.readyImage(agent);
    if (this.setupState.stage === "ready" && image) return image;
    const previous = this.settingUp ?? Promise.resolve("");
    const settingUp = previous.catch(() => "").then(async () => this.readyImage(agent) ?? this.setUp(agent));
    this.settingUp = settingUp;
    return settingUp;
  }

  /** Each agent kind's image as last set up: building another version of a kind removes the one before. */
  private readonly ready = new Map<SandboxedHarness, { version: string; image: string }>();

  private readyImage({ harness, version }: AgentImage) {
    const ready = this.ready.get(harness);
    return ready?.version === version ? ready.image : null;
  }

  private async setUp(agent: AgentImage) {
    const progress = (setup: SandboxSetup) => {
      this.setupState = setup;
      this.host.setupChanged(setup);
    };
    try {
      const image = await this.launcher.prepare(agent, progress);
      this.ready.set(agent.harness, { version: agent.version, image });
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
