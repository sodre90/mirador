import { createHash } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { HostProblemError, type AgentGone } from "../../shared/host-problems.ts";
import {
  HELD_CHANGES_MOST,
  ownerKey,
  roomSandbox,
  sameOwner,
  SANDBOXED_HARNESSES,
  SETUP_NOT_STARTED,
  sharesKernel,
  toolNameOf,
  workspaceSandbox,
  type HeldChange,
  type HeldChangeAnswer,
  type HeldChangeText,
  type SandboxBlocker,
  type SandboxedHarness,
  type SandboxFolder,
  type SandboxFolderRefusal,
  type SandboxFolderState,
  type SandboxNetwork,
  type SandboxOwner,
  type SandboxSetting,
  type SandboxSetup,
  type SandboxTool,
} from "../../shared/sandbox.ts";
import type { BusyWith, Conversation } from "../../shared/model.ts";
import type { AgentLaunch } from "../acp/harness.ts";
import type { Store } from "../store.ts";
import { addedFolderRefusal, foldersMounted, repositoryRefusal, type FolderSurroundings, type FoldersMounted, type LeftOutFolder, type MountedFolder, type OtherSandboxes } from "./added-folders.ts";
import { AGENT_USER, environmentInVm, NETWORK_RELAY_PORT, SCRIPTS_IN_VM, vmEnvironment, withAnyFolderSafe, type SandboxedKind } from "./agent-environment.ts";
import { startCanvasSocket, type SandboxCanvas } from "./canvas-socket.ts";
import { behindGuard, guardMounts, MANIFEST_FOLDER_IN_VM, RAW_FOLDERS_IN_VM, type GuardedFolder } from "./guard.ts";
import { guardPlanOf, partsNamedFrom, sandboxRefusalOf, withMoreParts, type GuardPlan, type MiradorPlaces, type NamedByGit } from "./guarded-workspace.ts";
import { HeldFiles, HeldFilesRefused, type HeldSandbox } from "./held-files.ts";
import type { PlacesPutBack, PlacesRequest } from "./in-vm/held-places.ts";
import { SetupFailed } from "./image.ts";
import { secretsOf, startModelProxy, type ModelRoute } from "./model-proxy.ts";
import { startNetworkProxy, type NetworkProxy } from "./network-proxy.ts";
import { entryOf, isInside, realOrAsIs, wayTo, type WayTo } from "./paths-on-disk.ts";
import { PlanWatch } from "./plan-watch.ts";
import { removeLeftSocketFolders, SOCKETS_FOLDER_PREFIX } from "./socket-folders.ts";
import { BUN_IN_VM, TOOLS_IN_VM, TOOLS_OF_EVERY_VM, toolOfAgent, ToolInstallFailed, ToolsFolder, type AgentTools } from "./tools-folder.ts";
import type { RunningSocket } from "./vm-connections.ts";
import { HOST_LABEL, OWNER_LABEL, SandboxNotReady, type AgentInVm, type BaseImage, type Mount, type VmLauncher } from "./vm-launcher.ts";

/** The ports a sandbox's VM gives its agents on its own 127.0.0.1, relayed to Mirador's sockets on this computer. */
export const CANVAS_RELAY_PORT = 7701;
export const MODEL_RELAY_PORT = 7702;

const IN_VM_SCRIPTS = join(import.meta.dir, "in-vm");
const SOCKETS_IN_VM = "/run/mirador";
const PUT_BACK_WITHIN_MS = 30_000;

/** Claude Code took about 600 MiB after a short turn; two agents at once fit in this. */
const VM_MEMORY = "3G";

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** A sandbox's own folder in Mirador's data: a room's by its id, as it always was, and a workspace's apart from them. */
const sandboxFolder = (dataDir: string, { kind, id }: SandboxOwner) => (kind === "room" ? join(dataDir, "sandbox", id) : join(dataDir, "sandbox", "workspaces", id));

/** Where a sandbox's agents of a kind keep their config and sessions: in Mirador's data, and at the same path in the VM. */
export const sandboxConfigFolder = (dataDir: string, owner: SandboxOwner, harness: SandboxedHarness, profileId?: string) =>
  profileId ? join(sandboxFolder(dataDir, owner), harness, shortHash(profileId, 16)) : join(sandboxFolder(dataDir, owner), harness);

/** Where a VM's guard is told what it guards: a folder of its own, which nothing else is mounted from. */
const manifestFolder = (dataDir: string, { owner, name }: Pick<SandboxVm, "owner" | "name">) => join(sandboxFolder(dataDir, owner), "guard", name);

const sandboxConfigFolders = (dataDir: string, owner: SandboxOwner) => SANDBOXED_HARNESSES.map((harness) => sandboxConfigFolder(dataDir, owner, harness));

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
  /** What the sandbox reaches now besides the model and Mirador; closed while it is off or gone. */
  networkOf(owner: SandboxOwner): SandboxNetwork;
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
  /** The version of its kind's program on this computer, which its VM runs from the tools folder. */
  version: string;
  workingDirectory: string;
  given: Record<string, string>;
  route: ModelRoute;
  agent: string[];
}

/**
 * An agent someone brought into a room, which runs on their own computer and has its calls in the room's workspace done
 * in a VM, which runs none of the agent kinds: the command of one call.
 */
export interface BroughtAgentInSandbox {
  owner: SandboxOwner;
  agentId: string;
  allowsSharedKernel: boolean;
  workingDirectory: string;
  command: string[];
}

interface SandboxVm {
  key: string;
  owner: SandboxOwner;
  /** The agent someone brought that the VM is for alone; null for the VM of the room's or workspace's own agents. */
  broughtAgent: string | null;
  name: string;
  base: BaseImage;
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
  /** Why it was stopped, where its agents' processes went away with it for a reason to be told. */
  stoppedAs?: AgentGone;
  /** The VM stopped, and its held files are no longer its business. */
  left: boolean;
  /** The agents at work in it, or a brought agent's calls under way there. */
  agents: number;
  stopTimer?: ReturnType<typeof setTimeout>;
  sockets: RunningSocket[];
  /** The VM's way out, once it is there. */
  network?: NetworkProxy;
  /** The folder of the VM's own sockets, once made. */
  socketsFolder?: string;
  /** The model API of each agent's profile, by profile id, as the agents last started. */
  routes: Map<string, ModelRoute>;
  stopping?: Promise<void>;
}

/** How the guard of each VM that works in a workspace guards it while any of them does, and the folder of the disk it was when that was planned. */
interface WorkspacePlan {
  guarded: PlannedFolder;
  entry: string | null;
}

/** A folder the VM's agents write, as its guard keeps it, with what git there names by whole path, wherever it is. */
interface PlannedFolder extends GuardedFolder {
  named: NamedByGit;
}

/** A port of the VM's own, and the socket of this computer it leads to. */
interface Relay {
  port: number;
  socket: string;
}

/** What a VM sees of its agents' besides the workspace and Mirador's scripts, and what leads to their canvases and models. */
interface SeenInVm {
  mounts: Mount[];
  relays: Relay[];
}

/** The VM of an agent someone brought sees none of it. */
const NOTHING_OF_THE_AGENTS: SeenInVm = { mounts: [], relays: [] };

/** What a sandbox's VM mounted of its added folders and left out as it last started, and the folders it started with. */
interface FolderStart extends FoldersMounted {
  startedWith: MountedFolder[];
}

const sameFolder = (a: MountedFolder) => (b: MountedFolder) => a.path === b.path && a.writable === b.writable;

/** What git names by whole path in one of a sandbox's folders, its workspace or one added read and write. */
interface NamedIn {
  folder: string;
  named: NamedByGit;
}

/**
 * The folders a VM's agents write, each guarded also for what git in the sandbox's other folders reads or runs in it,
 * as a config of one includes a file of another or names a hooks folder there, whether that other folder is in this VM
 * or not, as for a brought agent's; the VM does not start where its guard couldn't keep that.
 */
async function guardedTogether(folders: GuardedFolder[], namedInSandbox: NamedIn[]): Promise<GuardedFolder[]> {
  return Promise.all(
    folders.map(async ({ folder, parts }) => {
      const others = namedInSandbox.filter((other) => other.folder !== folder).map(({ named }) => named);
      const named = await partsNamedFrom(folder, others, parts.gitFolders);
      if ("refused" in named) throw new SandboxNotReady({ kind: "blocked", blocker: named.refused });
      return { folder, parts: withMoreParts(parts, named) };
    }),
  );
}

const leftOutAs = (refusal: SandboxFolderRefusal) => ({ leftOut: { kind: "refused", refusal } as LeftOutFolder });

const leftOutFor = (error: unknown) => leftOutAs(error instanceof HeldFilesRefused ? { kind: "held-files-refused" } : { kind: "could-not-mount", cause: messageOf(error) });

const shortHash = (text: string, length = 10) => createHash("sha256").update(text).digest("hex").slice(0, length);

const atItsOwnPath = (path: string, readOnly: boolean): Mount => ({ source: path, target: path, readOnly });

const overlap = (a: string, b: string) => isInside(a, b) || isInside(b, a);

const isWithin = (path: string, folder: string) => path !== folder && isInside(path, folder);

const endOf = ({ places }: WayTo) => places.at(-1)!;

const isOnTheWay = (folder: string, way: WayTo) => way.places.some((place) => isInside(place, folder)) || isInside(folder, endOf(way));

const nests = (a: WayTo, b: WayTo) => [[a, b] as const, [b, a] as const].some(([inner, outer]) => inner.places.some((place) => isWithin(place, endOf(outer))));

const sameFolders = (a: SandboxFolder[], b: SandboxFolder[]) => JSON.stringify(a.map(({ path, writable }) => [path, writable])) === JSON.stringify(b.map(({ path, writable }) => [path, writable]));

/** What a put-back in the VM printed, as far as it has the shape of one: anything else is taken as no answer. */
function putBackIn(printed: string): PlacesPutBack {
  const parsed = JSON.parse(printed) as Partial<PlacesPutBack>;
  if (!Array.isArray(parsed.found) || !parsed.found.every((entry) => typeof entry?.path === "string" && typeof entry.found?.kind === "string")) throw new Error("not a put-back");
  return { found: parsed.found, failed: [] };
}

const writesOnTheWay = (way: WayTo) => (vm: SandboxVm) => vm.writableRoots.some((root) => isOnTheWay(root, way));

const worksInWorkspace = (workspace: string) => (vm: SandboxVm) => vm.writableRoots[0] === workspace;

const isBrought = ({ broughtAgent }: SandboxVm) => broughtAgent !== null;

/** Where the VM writes on the way to another's workspace, as what keeps that one's from starting. */
function overlappedBy({ writableRoots }: SandboxVm, way: WayTo): SandboxBlocker {
  const folder = writableRoots.find((root) => isOnTheWay(root, way))!;
  return { kind: folder === writableRoots[0] ? "workspace-overlaps-sandbox-workspace" : "workspace-overlaps-sandbox-folder", folder };
}

const agentsVmKey = ownerKey;

const broughtVmKey = (owner: SandboxOwner, agentId: string) => `${ownerKey(owner)}/${agentId}`;

/** The folder of this computer's packages, with Mirador's own claude-agent-acp, which its agents run in the VM. */
const agentPackages = () => dirname(dirname(dirname(Bun.resolveSync("@agentclientprotocol/claude-agent-acp/package.json", import.meta.dir))));

/** This host's VMs, told from another Mirador's on this computer by the data folder they were started for. */
const hostLabelOf = (dataDir: string) => shortHash(dataDir);

/**
 * One light VM per sandboxed room and per sandboxed workspace, run by the launcher this computer has: set up on first use
 * (the runtime, the base image, built here, then the tools folder, with each agent kind at its version as one first
 * starts), started on its first turn, and stopped once its last agent has gone. Agents of every kind run in it at once. Its
 * agents start in it as the agent user; it has no network, only Mirador's canvas, model and web proxy sockets relayed in,
 * the proxy letting through what the owner has the sandbox reach, and the workspace, through a guard in the VM that keeps
 * its repository's config and hooks, and its held files, as they are. No VM sees another's sockets, config folder or canvases.
 * Whatever is not ready fails the turn. An agent someone brought into a sandboxed room has its calls done in a VM of its
 * own, which sees the workspace as the room's own VM does and none of what that one's agents have: their models, canvases,
 * settings, sessions or added folders.
 *
 * A mount follows whatever link stands where its source was, and a running VM's agents can put one wherever they write. So
 * whatever a starting VM mounts lies outside every running VM's writable roots, or is one of them, which nothing in that VM
 * can move: none starts where its workspace lies in or around where one that works elsewhere writes, and they start one at
 * a time. The VMs of one workspace, whoever's they are, share one plan of what their guards keep of it; once git reads or
 * runs more of it than that, they stop.
 */
export class Sandboxes {
  private setupState: SandboxSetup = SETUP_NOT_STARTED;
  /** What of the setup is ready on this computer, by piece: the runtime, the base image and each tool. */
  private readonly ready = new Map<string, unknown>();
  /** The last piece of setup asked for: each is set up once the one before is over, one at a time. */
  private settingUp: Promise<unknown> = Promise.resolve();
  private readonly tools: ToolsFolder;
  /** The VMs by their keys. */
  private readonly vms = new Map<string, SandboxVm>();
  /** Each sandbox's launch under way: one at a time, so no two VMs of one room or workspace ever start. */
  private readonly launching = new Map<string, Promise<unknown>>();
  /** The last VM's start asked for, over however it came out: the next VM is planned and mounted only then. */
  private lastStart: Promise<unknown> = Promise.resolve();
  private readonly hostLabel: string;

  constructor(
    private readonly launcher: VmLauncher,
    private readonly host: SandboxHost,
    private readonly idleStopMs = 5_000,
    /** Where each VM's sockets get a folder of their own. */
    private readonly socketsParent = tmpdir(),
    private readonly broughtIdleStopMs = 60_000,
    private readonly planLookedAtMs = 2_000,
  ) {
    this.hostLabel = hostLabelOf(host.dataDir);
    this.tools = new ToolsFolder(host.dataDir, launcher);
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
    return this.ownersOfHeld().flatMap((owner) => this.changesFor(owner));
  }

  private ownersOfHeld(): SandboxOwner[] {
    return [...new Map(this.allHelds().flatMap((held) => held.owners().map((owner) => [ownerKey(owner), owner]))).values()];
  }

  private changesFor(owner: SandboxOwner): HeldChange[] {
    return this.heldsOf(owner).flatMap((held) => held.changesFor(owner));
  }

  /** The rooms and workspaces whose VM stopped as they hold as many changes as one may, in the workspace or in a folder. */
  holdingTooMany(): SandboxOwner[] {
    return this.ownersOfHeld().filter((owner) => this.holdsTooMany(owner));
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
   * `turningOn`, another sandbox that is on writing in it or around it, as in its own workspace or a folder read and
   * write, whose agents could swap it for a link. Null where it can.
   */
  async workspaceRefusal(workspace: string, turningOn?: SandboxOwner): Promise<SandboxBlocker | null> {
    const refused = await sandboxRefusalOf(workspace, this.host.places);
    if (refused || !turningOn) return refused;
    return (await this.besideOthersRefusal(workspace, turningOn)) ?? this.besideWritableFoldersRefusal(workspace, turningOn);
  }

  /**
   * Another sandbox's agents could have put a link on the way to the workspace, or could yet: those of one that is on and
   * works inside it or around it, in the very same workspace aside, where they can't move it; or of one with a folder
   * read and write, where the way follows a link in that folder; or of any that worked in a folder once, this one too,
   * where the way follows a link inside it. Null where none could.
   */
  private async besideOthersRefusal(workspace: string, owner: SandboxOwner): Promise<SandboxBlocker | null> {
    const others = this.host.otherSandboxes(owner);
    const way = await wayTo(workspace);
    const nested = (await Promise.all(others.workspaces.map(wayTo))).find((other) => nests(way, other));
    if (nested) return { kind: "workspace-overlaps-sandbox-workspace", folder: endOf(nested) };
    const writable = await Promise.all(others.writableFolders.map(realOrAsIs));
    const linking = writable.find((folder) => way.links.some((link) => isInside(link, folder)));
    if (linking) return { kind: "workspace-overlaps-sandbox-folder", folder: linking };
    const left = await Promise.all(others.foldersLeft.map(realOrAsIs));
    const leftBehind = way.links.find((link) => left.some((folder) => link !== folder && isInside(link, folder)));
    return leftBehind ? { kind: "way-through-link-sandbox-left", link: leftBehind } : null;
  }

  private async besideWritableFoldersRefusal(workspace: string, owner: SandboxOwner): Promise<SandboxBlocker | null> {
    const way = await wayTo(workspace);
    const writableFoldersOn = await Promise.all(this.host.otherSandboxes(owner).writableFoldersOn.map(realOrAsIs));
    const written = writableFoldersOn.find((folder) => isOnTheWay(folder, way));
    return written ? { kind: "workspace-overlaps-sandbox-folder", folder: written } : null;
  }

  /** Why the folder, given without links, can't be in the sandbox with this access beside `others`, its other added folders; null where it can. */
  async folderRefusal(owner: SandboxOwner, folder: MountedFolder, others: string[]): Promise<SandboxFolderRefusal | null> {
    return addedFolderRefusal(folder, await this.folderSurroundings(owner), others);
  }

  private async folderSurroundings(owner: SandboxOwner): Promise<FolderSurroundings> {
    const workspace = this.host.workspaceOf(owner);
    const { workspaces, writableFolders, writableFoldersOn, foldersLeft } = this.host.otherSandboxes(owner);
    const real = (paths: string[]) => Promise.all(paths.map(realOrAsIs));
    return {
      places: this.host.places,
      workspace: workspace && (await realpath(workspace).catch(() => null)),
      sandboxOwn: [...sandboxConfigFolders(this.host.dataDir, owner), agentPackages(), IN_VM_SCRIPTS, SCRIPTS_IN_VM, SOCKETS_IN_VM, RAW_FOLDERS_IN_VM, MANIFEST_FOLDER_IN_VM],
      socketsParent: this.socketsParent,
      otherSandboxes: { workspaces: await real(workspaces), writableFolders: await real(writableFolders), writableFoldersOn: await real(writableFoldersOn), foldersLeft: await real(foldersLeft) },
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

  /** Sets up what every sandbox needs, and this agent kind at its version, as the owner turns one on, so the first turn need not wait for it. */
  prepareInBackground(agent: AgentTools) {
    if (this.availability().available) void this.preparedFor(agent).catch(() => {});
  }

  /**
   * Removes the tools of agents' versions no profile runs any more, and what an install cut short left: only while no VM
   * runs, as a running one may run any of them.
   */
  async removeToolsNoneUses(used: AgentTools[]) {
    if (!this.availability().available) return;
    const kept: SandboxTool[] = [...TOOLS_OF_EVERY_VM, ...used.map(toolOfAgent)];
    await this.setupStep(async () => {
      if (this.vms.size > 0) return;
      await this.tools.keepOnly(kept);
      [...this.ready.keys()].filter(isToolKey).forEach((key) => this.ready.delete(key));
    });
  }

  /** The VMs a previous run of this host left behind, from a crash, and the socket folders of any host gone since. */
  async reapLeftovers() {
    await removeLeftSocketFolders(this.socketsParent);
    if (this.availability().available) await this.launcher.removeLeftovers(this.hostLabel);
  }

  /**
   * The command and environment that start the agent in its sandbox's VM, the VM started first where it isn't running,
   * telling as it goes what it waits for. Throws SandboxNotReady when anything of it is not ready; nothing here ever runs
   * the agent on this computer.
   */
  async launch(agent: AgentInSandbox, told: (step: SandboxStartStep) => void = () => {}): Promise<AgentLaunch> {
    this.assertMayLaunch(agent, false);
    const { harness } = agent.kind;
    const tools = { harness, version: agent.version };
    let toldLast: SandboxStartStep | null = null;
    const tell = (step: SandboxStartStep) => step !== toldLast && told((toldLast = step));
    const first = this.firstStepOf(agent.owner, tools);
    if (first) tell(first);
    const vm = await this.oneLaunchAtATime(agent.owner, () => this.startedAgentsVm(agent.owner, tools, tell));
    const places = { configFolder: sandboxConfigFolder(this.host.dataDir, agent.owner, harness, harness === "pi" ? agent.profileId : undefined), modelBaseUrl: modelAddress(agent.profileId) };
    const environment = environmentInVm(agent.given, { kind: agent.kind, version: agent.version, base: vm.base }, places, secretsOf(agent.route));
    const launched = this.launchedIn(vm, { workingDirectory: agent.workingDirectory, environment, command: agent.agent });
    vm.routes.set(agent.profileId, agent.route);
    return launched;
  }

  /**
   * The command and environment that do a brought agent's call in its own VM, started first where it isn't running; it
   * throws SandboxNotReady as `launch` does.
   */
  async launchForBrought(agent: BroughtAgentInSandbox): Promise<AgentLaunch> {
    this.assertMayLaunch(agent, true);
    const vm = await this.oneLaunchAtATime(agent.owner, () => this.startedBroughtVm(agent));
    return this.launchedIn(vm, { workingDirectory: agent.workingDirectory, environment: withAnyFolderSafe(vmEnvironment(vm.base, null)), command: agent.command });
  }

  private assertMayLaunch({ owner, allowsSharedKernel }: Pick<AgentInSandbox, "owner" | "allowsSharedKernel">, brought: boolean) {
    const available = this.availability();
    if (!available.available) throw new SandboxNotReady({ kind: "unavailable", why: available.why });
    if (sharesKernel(available.kind) && !allowsSharedKernel) throw new SandboxNotReady({ kind: "shared-kernel-not-allowed" });
    if (this.tooManyHeldFor(owner, brought)) throw new SandboxNotReady({ kind: "too-many-held-changes", most: HELD_CHANGES_MOST });
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
      goneAs: () => vm.stoppedAs,
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

  /** At each turn's start the folders its VM works in are looked through. */
  async turnStarted(owner: SandboxOwner) {
    await this.lookThroughFolders(owner);
  }

  /** At each turn's end the held files are looked at again, in case a watch event was missed, and the folders looked through. */
  async turnEnded(owner: SandboxOwner) {
    await Promise.all(this.heldsOfVms(owner).map((held) => held.check()));
    await this.lookThroughFolders(owner);
  }

  /** The folders the sandbox's VMs work in are looked through for what repositories made there since they started have git read or run. */
  private async lookThroughFolders(owner: SandboxOwner) {
    await Promise.all(this.heldsOfVms(owner).map((held) => this.planWatches.get(held)?.lookThrough()));
  }

  private heldsOfVms(owner: SandboxOwner) {
    return [...new Set(this.vmsOf(owner).flatMap((vm) => vm.helds))];
  }

  async answerHeldChange(owner: SandboxOwner, changeId: string, answer: HeldChangeAnswer) {
    await Promise.all(this.heldsOf(owner).map((held) => held.answer(changeId, answer)));
  }

  /** The held files of the folders the sandbox works in, running VMs' and those a stopped one left waiting for the owner, each once. */
  private heldsOf(owner: SandboxOwner): HeldFiles[] {
    return this.allHelds().filter((held) => held.owners().some((of) => sameOwner(of, owner)));
  }

  private allHelds(): HeldFiles[] {
    return [...new Set([...[...this.vms.values()].flatMap(({ helds }) => helds), ...this.stoppedHeld])];
  }

  /** Whether the held files of the workspace or of a folder hold as many changes as each may: past that, the VM does not start until the owner answers some. */
  private holdsTooMany(owner: SandboxOwner) {
    return this.heldsOf(owner).some((held) => held.full());
  }

  /** Whether brought agents hold as many changes in the folder as they may: past that, only their VMs stay stopped. */
  private holdsTooManyForBrought(owner: SandboxOwner) {
    return this.heldsOf(owner).some((held) => held.fullForBrought());
  }

  private tooManyHeldFor(owner: SandboxOwner, brought: boolean) {
    return this.holdsTooMany(owner) || (brought && this.holdsTooManyForBrought(owner));
  }

  private heldChanged(owner: SandboxOwner) {
    this.host.heldChanged(owner, this.changesFor(owner), this.holdsTooMany(owner));
  }

  /** What the sandbox reaches changed: what its VMs may reach no longer is cut off, as the rest of their way out follows by itself. */
  networkChanged(owner: SandboxOwner) {
    this.vmsOf(owner).forEach(({ network }) => network?.networkChanged());
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

  /**
   * The sandbox was turned off, or its room moved to another workspace: once its VMs stopped, whose last look at the
   * held files is still its own, it hears of no new held changes where it worked, and still answers those it was told
   * of; unless it started working again meanwhile.
   */
  async ownerLeft(owner: SandboxOwner) {
    await Promise.all(this.vmsOf(owner).map((vm) => this.stopVm(vm)));
    if (this.vmsOf(owner).length > 0) return;
    this.allHelds().forEach((held) => held.left(owner));
    [...this.stoppedHeld].filter((held) => held.owners().length === 0).forEach((held) => this.stoppedHeld.delete(held));
    this.heldChanged(owner);
  }

  /** A deleted room's or workspace's VMs stop, and what they held goes unanswered, where no other sandbox works among it: the files are as they were. */
  async ownerGone(owner: SandboxOwner) {
    await Promise.all(this.vmsOf(owner).map((vm) => this.stopVm(vm)));
    this.allHelds().forEach((held) => held.worksThereNoLonger(owner));
    [...this.stoppedHeld].filter((held) => held.owners().length === 0).forEach((held) => this.stoppedHeld.delete(held));
    this.folderStarts.delete(ownerKey(owner));
    this.host.heldChanged(owner, [], false);
  }

  async stopAll() {
    await Promise.all([...this.vms.values()].map((vm) => this.stopVm(vm)));
  }

  /**
   * Held files whose last VM stopped wait for the owner's answer still: each folder's until a VM holds that folder's
   * files again, or for good where none does.
   */
  private readonly stoppedHeld = new Set<HeldFiles>();

  private keepWaiting(helds: HeldFiles[]) {
    helds.forEach((held) => this.stoppedHeld.add(held));
    [...this.stoppedHeld].filter((held) => !held.holdsAny()).forEach((held) => this.stoppedHeld.delete(held));
  }

  /** The changes stopped VMs held in the folder these held files are of, whoever's they were, go on waiting in them. */
  private takeOverStoppedHeld(held: HeldFiles) {
    const ofSameFolder = [...this.stoppedHeld].filter((previous) => previous.workspace === held.workspace);
    ofSameFolder.forEach((previous) => {
      held.takeOver(previous);
      this.stoppedHeld.delete(previous);
    });
  }

  /** The VM writes among these held files from now on, and what they hold is its room's or workspace's to answer too. */
  private worksAmong(held: HeldFiles, vm: SandboxVm, asAddedFolder = false) {
    vm.helds.push(held);
    this.vmsAmong.get(held)?.add(vm);
    held.worksThere(vm.owner, asAddedFolder);
    if (held.holdsAny()) this.heldChanged(vm.owner);
  }

  private async tearDown(vm: SandboxVm) {
    clearTimeout(vm.stopTimer);
    const halted = await this.haltOrSay(vm);
    await vm.startOver;
    await Promise.all(vm.sockets.map((socket) => socket.stop().catch(() => {})));
    const own = [manifestFolder(this.host.dataDir, vm), ...(vm.socketsFolder ? [vm.socketsFolder] : [])];
    await Promise.all(own.map((folder) => rm(folder, { recursive: true, force: true }).catch(() => {})));
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

  /**
   * Where the VMs of other Miradors on this computer write now, without links; throws where one writes on the way to the
   * workspace, in it, or around or in what this VM is to mount, as that host plans nothing with this one and its agents
   * could swap a folder for a link.
   */
  private async keepClearOfOtherMiradors(way: WayTo, mounted: string[]): Promise<string[]> {
    const written = await Promise.all((await this.launcher.writtenByOtherMiradors(this.hostLabel)).map(realOrAsIs));
    const folder = written.find((each) => isOnTheWay(each, way) || mounted.some((mount) => overlap(each, mount)));
    if (folder) throw new SandboxNotReady({ kind: "blocked", blocker: { kind: "workspace-overlaps-other-mirador", folder } });
    return written;
  }

  /** Nothing is planned while a VM that writes on the way to the workspace stops, until it has. */
  private async untilNoneStopsOnTheWay(way: WayTo, vm: SandboxVm) {
    const stopping = () => this.othersOnTheWay(way, vm).flatMap((other) => other.stopping ?? []);
    while (stopping().length > 0) await Promise.all(stopping());
  }

  private othersOnTheWay(way: WayTo, vm: SandboxVm) {
    return [...this.vms.values()].filter((other) => other !== vm && writesOnTheWay(way)(other));
  }

  /** Nothing starts where a VM that wrote on the way to its workspace may run on: each is stopped again first. */
  private async untilNoneLingersOnTheWay(way: WayTo) {
    const lingering = () => [...this.lingering].filter(writesOnTheWay(way));
    await Promise.all(lingering().map((vm) => this.launcher.stop(vm.name).then(() => this.knownToHaveStopped(vm), () => {})));
    if (lingering().length > 0) throw new SandboxNotReady({ kind: "could-not-start", cause: "another VM that worked there did not stop" });
  }

  /** The held files no other VM works among stop, and what they hold goes on waiting; the rest are looked at once more. */
  private async leaveHeldFiles(vm: SandboxVm) {
    vm.left = true;
    const stopped = vm.helds.filter((held) => this.workingAmong(held).length === 0);
    const goingOn = vm.helds.filter((held) => !stopped.includes(held));
    stopped.forEach((held) => this.planWatches.get(held)?.stop());
    stopped.forEach((held) => this.planWatches.delete(held));
    await Promise.all([...stopped.map((held) => held.stop().catch(() => {})), ...goingOn.map((held) => held.check().catch(() => false))]);
    this.keepWaiting(stopped);
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

  /** What a folder's held files ask of the VMs that work in it, given as they come and go: a put-back is done in one of them, and all of them stop where it does not hold. */
  private heldSandbox(owners: () => SandboxOwner[], vms: Set<SandboxVm>): HeldSandbox {
    return {
      atWork: () => {
        const working = [...new Map([...vms].map(({ owner }) => [ownerKey(owner), owner])).values()].map((owner) => this.host.atWork(owner));
        const agents = [...working.flatMap((atWork) => atWork.agents), ...[...vms].flatMap(({ broughtAgent }) => broughtAgent ?? [])];
        return { agents: [...new Set(agents)], conversationIds: working.flatMap(({ conversationIds }) => conversationIds) };
      },
      broughtAtWork: () => [...vms].some((vm) => isBrought(vm) && vm.running && !vm.left && !vm.halted),
      changed: () => owners().forEach((owner) => this.heldChanged(owner)),
      inVm: () => {
        const vm = [...vms].find((candidate) => candidate.running && !isBrought(candidate)) ?? [...vms].find(({ running }) => running);
        return vm ? (request) => this.putBackInVm(vm, request) : null;
      },
      halt: async () => {
        const working = [...vms].filter(({ left }) => !left);
        await Promise.all(working.map((vm) => this.haltOrSay(vm)));
        working.forEach((vm) => void this.stopVm(vm));
      },
      haltBrought: async () => {
        const working = [...vms].filter((vm) => !vm.left && isBrought(vm));
        await Promise.all(working.map((vm) => this.haltOrSay(vm)));
        working.forEach((vm) => void this.stopVm(vm));
      },
      untilStopped: () => {
        const current = [...vms];
        if (current.some(({ halted }) => halted === undefined)) return Promise.resolve(false);
        return Promise.all(current.map(({ halted }) => halted)).then(
          () => true,
          () => false,
        );
      },
    };
  }

  /** Puts held places back inside the VM as the agent user, so a link on the way leads only to what the VM sees. */
  private async putBackInVm(vm: SandboxVm, request: PlacesRequest): Promise<PlacesPutBack> {
    const ran = await this.launcher.runAsAgent(vm.name, AGENT_USER, [BUN_IN_VM, `${SCRIPTS_IN_VM}/held-places.ts`], JSON.stringify(request), PUT_BACK_WITHIN_MS);
    if (ran.exitCode !== 0) throw new Error(`putting held files back in the VM failed: exit ${ran.exitCode}`);
    return putBackIn(ran.stdout);
  }

  /** What a launch of this agent waits for before it can start in the owner's VM, as things stand: nothing where the VM runs and its tools are there. */
  private firstStepOf(owner: SandboxOwner, agent: AgentTools): SandboxStartStep | null {
    if (!this.readyFor(agent)) return "preparing-sandbox";
    return this.agentsVm(owner)?.running ? null : "starting-sandbox";
  }

  /**
   * The VM of the sandbox's own agents, running, whatever kinds of agent are at work in it: the one there is, or a new
   * one where there is none, where the workspace it works in changed, or where it runs on another base image or started
   * with other added folders and no agent of it is at work.
   */
  private async startedAgentsVm(owner: SandboxOwner, agent: AgentTools, told: (step: SandboxStartStep) => void): Promise<SandboxVm> {
    const base = await this.preparedFor(agent);
    const folders = this.host.foldersOf(owner);
    const existing = this.agentsVm(owner);
    const outdatedWhileIdle = (vm: SandboxVm) => vm.agents === 0 && (vm.base.image !== base.image || !sameFolders(vm.folders, folders));
    const outdated = existing && !existing.stopping && (existing.workspace !== this.host.workspaceOf(owner) || outdatedWhileIdle(existing));
    const reused = existing && !existing.stopping && !outdated;
    if (!reused || !existing.running) told("starting-sandbox");
    if (outdated) await this.stop(owner);
    if (existing && !existing.stopping) {
      await existing.started;
      return existing;
    }
    return this.startedNew({ key: agentsVmKey(owner), owner, broughtAgent: null, base, folders });
  }

  /** The VM of an agent someone brought, running: the one there is, where it works in the workspace as it now is, or a new one. */
  private async startedBroughtVm({ owner, agentId }: BroughtAgentInSandbox): Promise<SandboxVm> {
    const key = broughtVmKey(owner, agentId);
    const existing = this.vms.get(key);
    if (existing && !existing.stopping && existing.workspace === this.host.workspaceOf(owner)) {
      await existing.started;
      return existing;
    }
    if (existing) await this.stopVm(existing);
    return this.startedNew({ key, owner, broughtAgent: agentId, base: await this.preparedFor(null), folders: [] });
  }

  private async startedNew(given: Pick<SandboxVm, "key" | "owner" | "broughtAgent" | "base" | "folders">): Promise<SandboxVm> {
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
    const start = this.lastStart.then(() => this.start(vm));
    vm.startOver = start.catch(() => {});
    vm.started = start.catch(async (error: unknown) => {
      await this.stopVm(vm);
      throw error instanceof HostProblemError ? error : new SandboxNotReady({ kind: "could-not-start", cause: messageOf(error) });
    });
    this.lastStart = vm.started.catch(() => {});
    await vm.started;
    return vm;
  }

  /** A VM that stops hands over what it held only once it has, so none starts in its folders before. */
  private async untilNoneStops(owner: SandboxOwner) {
    const stopping = () => this.vmsOf(owner).flatMap((vm) => vm.stopping ?? []);
    while (stopping().length > 0) await Promise.all(stopping());
  }

  private async start(vm: SandboxVm) {
    this.assertNotStopped(vm);
    const way = vm.workspace === null ? null : await wayTo(vm.workspace);
    const workspace = vm.workspace && (await realpath(vm.workspace).catch(() => null));
    if (!way || !workspace) throw new HostProblemError({ code: "workspace-gone" });
    const refused = (await this.workspaceRefusal(workspace)) ?? (await this.besideOthersRefusal(vm.workspace!, vm.owner));
    if (refused) throw new SandboxNotReady({ kind: "blocked", blocker: refused });
    const otherMiradorsWrite = await this.keepClearOfOtherMiradors(way, []);
    const guardedWorkspace = await this.guardedIn(workspace, way, vm);
    const folders = vm.broughtAgent === null ? await this.addedFoldersIn(vm, otherMiradorsWrite) : null;
    // Unix socket paths hold about a hundred bytes on macOS, so each VM's sockets live in a short private folder.
    vm.socketsFolder = await mkdtemp(join(this.socketsParent, SOCKETS_FOLDER_PREFIX));
    const mounted = [guardedWorkspace, ...(folders?.guarded ?? [])];
    const guarded = await guardMounts(await guardedTogether(mounted, await this.namedInSandbox(vm.owner, mounted)), manifestFolder(this.host.dataDir, vm));
    const wayOut = await this.wayOut(vm, vm.socketsFolder);
    const seen = vm.broughtAgent === null ? await this.agentsOwn(vm, vm.socketsFolder) : NOTHING_OF_THE_AGENTS;
    const relays = [...seen.relays, wayOut];
    const inVm = (socket: string) => `${SOCKETS_IN_VM}/${basename(socket)}`;
    this.assertNotStopped(vm);
    await this.keepClearOfOtherMiradors(way, [...vm.writableRoots, ...(folders?.readOnly ?? []).map(({ source }) => source)]);
    vm.launching = this.launcher.start({
      name: vm.name,
      labels: { [HOST_LABEL]: this.hostLabel, [OWNER_LABEL]: ownerKey(vm.owner) },
      image: vm.base.image,
      memory: VM_MEMORY,
      mounts: [
        ...guarded,
        ...(folders?.readOnly ?? []),
        ...seen.mounts,
        { source: this.tools.root, target: TOOLS_IN_VM, readOnly: true },
        { source: IN_VM_SCRIPTS, target: SCRIPTS_IN_VM, readOnly: true },
        ...relays.map(({ socket }) => ({ source: socket, target: inVm(socket), readOnly: false })),
      ],
      ...behindGuard(SOCKETS_IN_VM, [BUN_IN_VM, `${SCRIPTS_IN_VM}/relays.mjs`, ...relays.map(({ port, socket }) => `${port}=${inVm(socket)}`)]),
    });
    await vm.launching;
    this.assertNotStopped(vm);
    vm.running = true;
    if (!folders) return;
    this.folderStarts.set(ownerKey(vm.owner), { ...folders.started, startedWith: vm.folders.map(({ path, writable }) => ({ path, writable })) });
    this.host.foldersStarted(vm.owner);
  }

  /**
   * What git names by whole path in the sandbox's folders: those the VM mounts, as planned, and each other folder the
   * owner added read and write, left out of it or for another VM of the sandbox, planned now; one that can't be planned
   * is a repository no sandbox knows, as any other of this computer.
   */
  private async namedInSandbox(owner: SandboxOwner, mounted: PlannedFolder[]): Promise<NamedIn[]> {
    const known = new Set(mounted.map(({ folder }) => folder));
    const notMounted = this.host.foldersOf(owner).filter(({ writable, path }) => writable && !known.has(path));
    const planned = await Promise.all(
      notMounted.map(async ({ path }) => {
        const plan = await guardPlanOf(path, this.host.places).catch(() => null);
        return plan && "named" in plan ? [{ folder: path, named: plan.named }] : [];
      }),
    );
    return [...mounted.map(({ folder, named }) => ({ folder, named })), ...planned.flat()];
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

  /** Each VM's only way out besides its canvases and models, which lets through what the owner has the sandbox reach at the moment. */
  private async wayOut(vm: SandboxVm, socketsFolder: string): Promise<Relay> {
    const socket = join(socketsFolder, "network.sock");
    vm.network = await startNetworkProxy(socket, () => this.host.networkOf(vm.owner));
    vm.sockets.push(vm.network);
    return { port: NETWORK_RELAY_PORT, socket };
  }

  /**
   * The workspace as the VM's guard is to guard it, planned while no VM writes on the way to it that could swap a folder
   * for a link to elsewhere, and just as the guards of the VMs that work there do.
   */
  private async guardedIn(workspace: string, way: WayTo, vm: SandboxVm): Promise<PlannedFolder> {
    vm.writableRoots.push(workspace);
    await this.untilNoneStopsOnTheWay(way, vm);
    await this.keepOthersOffTheWay(workspace, way, vm);
    const shared = await this.planShared(workspace, vm);
    await this.untilNoneLingersOnTheWay(way);
    if ((await realpath(vm.workspace!).catch(() => null)) !== workspace) throw new HeldFilesRefused("the workspace was moved or replaced");
    const plan = shared ?? (await this.newPlan(workspace, vm));
    if (this.tooManyHeldFor(vm.owner, isBrought(vm))) throw new SandboxNotReady({ kind: "too-many-held-changes", most: HELD_CHANGES_MOST });
    return plan.guarded;
  }

  /**
   * A VM that writes on the way to the workspace and works elsewhere keeps this one from starting, except a brought
   * agent's VM stops for an own agents' VM that needs the folder.
   */
  private async keepOthersOffTheWay(workspace: string, way: WayTo, vm: SandboxVm) {
    const others = this.othersOnTheWay(way, vm).filter((other) => !worksInWorkspace(workspace)(other));
    if (isBrought(vm) && others.length > 0) throw new SandboxNotReady({ kind: "blocked", blocker: overlappedBy(others[0]!, way) });
    const staying = others.find((other) => !isBrought(other));
    if (staying) throw new SandboxNotReady({ kind: "blocked", blocker: overlappedBy(staying, way) });
    await Promise.all(others.map((other) => this.stopVm(other)));
  }

  /**
   * The plan of the other VMs in the workspace, where there are any, whose held files the VM then works among; null where
   * there are none. Where the folder itself was replaced meanwhile, as by the owner, a brought agent's VM does not start,
   * nor one beside another room's or workspace's agents at work; else the others stop, for it all to be planned anew.
   */
  private async planShared(workspace: string, vm: SandboxVm): Promise<WorkspacePlan | null> {
    const others = () => [...this.vms.values()].filter((other) => other !== vm && worksInWorkspace(workspace)(other));
    const stopping = () => others().flatMap((other) => other.stopping ?? []);
    while (stopping().length > 0) await Promise.all(stopping());
    const held = others().flatMap(({ helds }) => helds).find((each) => each.workspace === workspace);
    const plan = held && this.plans.get(held);
    if (!held || !plan) return null;
    if (plan.entry !== null && (await entryOf(workspace)) === plan.entry) {
      this.worksAmong(held, vm);
      return plan;
    }
    if (isBrought(vm) || others().some((other) => this.isAnothersAtWork(other, vm))) throw new HeldFilesRefused("the workspace was moved or replaced");
    await Promise.all(others().map((other) => this.stopVm(other)));
    return this.planShared(workspace, vm);
  }

  private isAnothersAtWork(other: SandboxVm, vm: SandboxVm) {
    if (sameOwner(other.owner, vm.owner)) return false;
    const { agents, conversationIds } = this.host.atWork(other.owner);
    return agents.length + conversationIds.length > 0;
  }

  /** The plan each held workspace's VMs share. */
  private readonly plans = new WeakMap<HeldFiles, WorkspacePlan>();

  /** The watch of each held folder's plan, while a VM works there. */
  private readonly planWatches = new Map<HeldFiles, PlanWatch>();

  private watchPlan(held: HeldFiles, plan: GuardPlan) {
    this.planWatches.set(held, new PlanWatch(plan, () => guardPlanOf(held.workspace, this.host.places), () => this.stopOutgrown(held), this.planLookedAtMs));
  }

  /** Git reads or runs more of the folder than the guards of the VMs that work there keep as it is: they stop at once, and the next one is planned anew. */
  private async stopOutgrown(held: HeldFiles) {
    this.plans.delete(held);
    const working = this.workingAmong(held);
    working.forEach((vm) => (vm.stoppedAs = { kind: "sandbox-outgrown" }));
    await Promise.all(working.map((vm) => this.stopVm(vm)));
  }

  private async newPlan(workspace: string, vm: SandboxVm): Promise<WorkspacePlan> {
    const held = await this.newHeldFiles(workspace, vm);
    const planned = await guardPlanOf(workspace, this.host.places, await held.start());
    if ("refused" in planned) {
      await held.stop().catch(() => {});
      throw new SandboxNotReady({ kind: "blocked", blocker: planned.refused });
    }
    const plan = { guarded: { folder: workspace, parts: planned.parts, named: planned.named }, entry: await entryOf(workspace) };
    this.plans.set(held, plan);
    this.takeOverStoppedHeld(held);
    this.worksAmong(held, vm);
    this.watchPlan(held, planned);
    return plan;
  }

  private async newHeldFiles(folder: string, vm: SandboxVm) {
    const vms = new Set([vm]);
    const held: HeldFiles = new HeldFiles(folder, this.heldSandbox(() => held.owners(), vms));
    this.vmsAmong.set(held, vms);
    return held;
  }

  /**
   * The sandbox's added folders as its VM shows them, each looked at as it stands now: a read-only one mounted at its own
   * path, and one read and write guarded as the workspace is, with held files of its own. One that fails is left out.
   */
  private async addedFoldersIn(vm: SandboxVm, otherMiradorsWrite: string[]): Promise<{ readOnly: Mount[]; guarded: PlannedFolder[]; started: FoldersMounted }> {
    const checked = await foldersMounted(vm.folders, await this.surroundingsBesideRunning(vm, otherMiradorsWrite));
    const guarded: PlannedFolder[] = [];
    for (const { path } of checked.mounted.filter(({ writable }) => writable)) {
      const planned = await this.writableFolderIn(vm, path);
      if ("leftOut" in planned) checked.leftOut.set(path, planned.leftOut);
      else guarded.push(planned);
    }
    const mounted = checked.mounted.filter(({ path }) => !checked.leftOut.has(path));
    const readOnly = mounted.filter(({ writable }) => !writable).map(({ path }) => atItsOwnPath(path, true));
    return { readOnly, guarded, started: { mounted, leftOut: checked.leftOut } };
  }

  /**
   * As the owner set the other sandboxes, and where their VMs write now, as one whose room moved to another workspace may
   * still, or one of another Mirador on this computer.
   */
  private async surroundingsBesideRunning(vm: SandboxVm, otherMiradorsWrite: string[]): Promise<FolderSurroundings> {
    const surroundings = await this.folderSurroundings(vm.owner);
    const writtenHere = [...this.vms.values(), ...this.lingering].filter((other) => other !== vm).flatMap(({ writableRoots }) => writableRoots);
    const writtenNow = [...writtenHere, ...otherMiradorsWrite];
    return { ...surroundings, otherSandboxes: { ...surroundings.otherSandboxes, workspaces: [...surroundings.otherSandboxes.workspaces, ...writtenNow] } };
  }

  /** A folder read and write, guarded as the workspace is, its held files watched from now on; or why it is left out. */
  private async writableFolderIn(vm: SandboxVm, folder: string): Promise<PlannedFolder | { leftOut: LeftOutFolder }> {
    const held = await this.newHeldFiles(folder, vm);
    const heldThere = await held.start().catch(leftOutFor);
    if (!Array.isArray(heldThere)) return heldThere;
    const planned = await guardPlanOf(folder, this.host.places, heldThere).catch(leftOutFor);
    if (!("parts" in planned)) {
      await held.stop().catch(() => {});
      return "refused" in planned ? leftOutAs(repositoryRefusal(planned.refused)) : planned;
    }
    vm.writableRoots.push(folder);
    this.takeOverStoppedHeld(held);
    this.worksAmong(held, vm, true);
    this.watchPlan(held, planned);
    return { folder, parts: planned.parts, named: planned.named };
  }

  /** Whether every piece of setup a VM of this agent needs is ready, as far as this host knows. */
  private readyFor(agent: AgentTools | null) {
    return [RUNTIME, DEFAULT_BASE, ...toolsOf(agent).map(toolKey)].every((key) => this.ready.has(key));
  }

  /**
   * The runtime runs, the base image is there and so is each tool a VM of this agent needs, the agent kind's own at its
   * version: each set up once, on first use, one at a time, its progress told as it goes. The base image, to run on.
   */
  private async preparedFor(agent: AgentTools | null): Promise<BaseImage> {
    try {
      await this.piece(RUNTIME, () => this.launcher.prepare(this.progress));
      const base = await this.piece(DEFAULT_BASE, () => this.launcher.defaultBase(this.progress));
      for (const tool of toolsOf(agent)) await this.piece(toolKey(tool), () => this.installed(tool));
      if (this.setupState.stage !== "ready") this.progress({ stage: "ready" });
      return base;
    } catch (error) {
      const problem = messageOf(error);
      this.progress({ stage: "failed", problem });
      throw new SandboxNotReady({ kind: "setup-failed", cause: problem });
    }
  }

  private readonly progress = (setup: SandboxSetup) => {
    this.setupState = setup;
    this.host.setupChanged(setup);
  };

  /** A piece of setup, made once: its result where it is ready, else made after the pieces asked for before. */
  private async piece<T>(key: string, make: () => Promise<T>): Promise<T> {
    if (this.ready.has(key)) return this.ready.get(key) as T;
    return this.setupStep(async () => {
      if (this.ready.has(key)) return this.ready.get(key) as T;
      const made = await make();
      this.ready.set(key, made);
      return made;
    });
  }

  private setupStep<T>(step: () => Promise<T>): Promise<T> {
    const done = this.settingUp.catch(() => {}).then(step);
    this.settingUp = done;
    return done;
  }

  private async installed(tool: SandboxTool) {
    if (await this.tools.has(tool)) return;
    this.progress({ stage: "installing-tool", tool });
    try {
      await this.tools.install(tool);
    } catch (error) {
      throw error instanceof ToolInstallFailed ? new SetupFailed(`installing ${toolNameOf(tool)}: ${error.message}`) : error;
    }
  }
}

const RUNTIME = "runtime";
const DEFAULT_BASE = "base:default";
const TOOL_KEY = "tool:";
const toolKey = (tool: SandboxTool) => `${TOOL_KEY}${tool.kind}${"version" in tool ? `-${tool.version}` : ""}`;
const isToolKey = (key: string) => key.startsWith(TOOL_KEY);

/** The tools a VM of this agent runs on: those of every VM, and its kind's at its version. */
const toolsOf = (agent: AgentTools | null): SandboxTool[] => [...TOOLS_OF_EVERY_VM, ...(agent ? [toolOfAgent(agent)] : [])];

/** What a sandboxed agent's start waits for, where it waits: its sandbox set up, or its VM started. */
export type SandboxStartStep = Extract<BusyWith, "preparing-sandbox" | "starting-sandbox">;

/** What the conversations of sandboxed rooms and workspaces need of the sandboxes. */
export type SandboxedAgents = Pick<Sandboxes, "launch" | "confirmedRunning" | "turnStarted" | "turnEnded" | "settleHeldFilesFor" | "stopSandboxesWorkingIn" | "stop" | "mountedFolders" | "runsWithOtherFolders">;

/** Until the host gives its conversations the sandboxes, a sandboxed room's or workspace's agent never starts. */
export const NO_SANDBOXES: SandboxedAgents = {
  launch: () => Promise.reject(new SandboxNotReady({ kind: "unavailable", why: "turned-off" })),
  confirmedRunning: () => false,
  turnStarted: async () => {},
  turnEnded: async () => {},
  settleHeldFilesFor: async () => {},
  stopSandboxesWorkingIn: async () => {},
  stop: async () => {},
  mountedFolders: () => [],
  runsWithOtherFolders: () => false,
};
