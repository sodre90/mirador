import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SandboxAvailability, SandboxSetup } from "../../shared/sandbox.ts";
import { AGENT_USER } from "./agent-environment.ts";
import { askEngineAgain, podmanAvailability, podmanStorageIn, sameAvailability, type EngineHere, type EngineProgram } from "./availability.ts";
import { containerCli, lastLineOf, type ContainerCli } from "./container-cli.ts";
import { droppedTo, environmentFlags, execProcessEnvironment, readByTool } from "./exec-environment.ts";
import { BASE_RECIPE, baseImageOf, BUILD_TIMEOUT_MS, buildProgress, DEFAULT_BASE_PATH, defaultBaseTag, isMiradorsBase, mustRun, pulledOrHere, PULL_TIMEOUT_MS } from "./image.ts";
import { HOST_LABEL, isAnotherMiradors, SandboxNotReady, VM_READY_LINE, withoutTrailingSlash, type AgentInVm, type Mount, type OwnBase, type ThrowawayRun, type VmPlan, type VmLauncher } from "./vm-launcher.ts";

const READY_WITHIN_S = 30;
/** The first start of an image as the agent user's own may copy its files for that user, which takes a while. */
export const RUN_TIMEOUT_MS = 10 * 60_000;

/** As many CPUs as Apple's `container` gives a VM, and room for the processes of a few agents at work and their builds. */
export const CPUS = "4";
export const MOST_PROCESSES = "4096";

/**
 * What the container's first process may do as its root, who is nobody on this computer: mount the folders it guards and
 * keep the agents out of what it mounts them from, let the relays reach Mirador's sockets, and then give all of it up.
 */
export const FIRST_PROCESS_MAY = ["SYS_ADMIN", "DAC_OVERRIDE", "FOWNER", "SETUID", "SETGID", "SETPCAP"];

/** The most of the container's log Podman keeps: its relays say a few lines. */
export const LOG_MOST = "1mb";

/**
 * What the `podman` process itself reads of this computer's environment to find its storage, runtime, config and the
 * Podman it talks to: the agent's values of these go on its command line, into the container, and never steer Podman.
 */
export const PODMAN_READS = readByTool(
  ["PATH", "HOME", "TMPDIR", "USER", "LOGNAME", "SHELL", "XDG_RUNTIME_DIR", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "DBUS_SESSION_BUS_ADDRESS", "REGISTRIES_CONFIG_PATH", "REGISTRY_AUTH_FILE"],
  ["CONTAINER_", "CONTAINERS_", "_CONTAINERS_", "STORAGE_", "PODMAN_"],
);

export const mountFlags = ({ source, target, readOnly }: Mount) => ["-v", `${source}:${target}${readOnly ? ":ro" : ""}`];

/**
 * `podman run` of a room's sandbox, a plain container: detached, removed once stopped, its first process under an init
 * that passes signals on. That process is the container's root, which guards the folders through FUSE; the agents start
 * as the agent user, who is this computer's user there, so the workspace's files stay theirs, and have no capability,
 * nor any to gain. The container has no network at all, and a log of its own that keeps only so much. SELinux labels are
 * left off, so the workspace is shown as it is rather than relabelled.
 */
export function runArguments({ name, labels, image, memory, mounts, entrypoint, args }: VmPlan) {
  const [uid, gid] = AGENT_USER.split(":");
  return [
    "run",
    "--detach",
    "--rm",
    "--init",
    "--name",
    name,
    ...Object.entries(labels).flatMap(([label, value]) => ["--label", `${label}=${value}`]),
    "--userns",
    `keep-id:uid=${uid},gid=${gid}`,
    "--user",
    "0:0",
    "--cap-drop",
    "all",
    "--cap-add",
    FIRST_PROCESS_MAY.join(","),
    "--device",
    "/dev/fuse",
    "--security-opt",
    "no-new-privileges",
    "--security-opt",
    "label=disable",
    "--network",
    "none",
    "--http-proxy=false",
    "--memory",
    memory,
    "--memory-swap",
    memory,
    "--cpus",
    CPUS,
    "--pids-limit",
    MOST_PROCESSES,
    "--log-driver",
    "k8s-file",
    "--log-opt",
    `max-size=${LOG_MOST}`,
    ...mounts.flatMap(mountFlags),
    "--entrypoint",
    JSON.stringify([entrypoint]),
    image,
    ...args,
  ];
}

/** `podman run` of a throwaway container, removed once it ends, its mounts shown as they are rather than relabelled. */
export const runOnceArguments = ({ image, mounts, entrypoint, args, user, network }: ThrowawayRun) => [
  "run",
  "--rm",
  "--user",
  user,
  "--security-opt",
  "label=disable",
  ...(network ? [] : ["--network", "none"]),
  ...mounts.flatMap(mountFlags),
  "--entrypoint",
  JSON.stringify([entrypoint]),
  image,
  ...args,
];

/** `podman exec` of an agent, as its user, in its folder, its values by name. */
export const execArguments = ({ vm, user, workingDirectory, environment, command }: AgentInVm) => [
  "exec",
  "-i",
  "--user",
  "0:0",
  "-w",
  workingDirectory,
  ...environmentFlags(environment, PODMAN_READS),
  vm,
  ...droppedTo(user, command),
];

/** The most a command run as the agent user may print: what a put-back of held files tells, with room to spare. */
export const AGENT_RUN_MOST_BYTES = 16 * 1024 * 1024;

type ListedContainer = { Names?: unknown; Labels?: Record<string, unknown> | null };

export function arrayIn<T>(json: string): T[] | null {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const nameOf = ({ Names }: ListedContainer) => (Array.isArray(Names) && typeof Names[0] === "string" ? [Names[0]] : []);

/** The names of the containers `podman ps --format json` lists whose label has this value. */
export const containersLabelled = (listed: string, label: string, value: string): string[] =>
  (arrayIn<ListedContainer>(listed) ?? [])
    .filter(({ Labels }) => Labels?.[label] === value)
    .flatMap(nameOf);

/** The names of the containers `podman ps --format json` lists that another Mirador on this computer started. */
export const othersContainersIn = (listed: string, hostLabel: string): string[] =>
  (arrayIn<ListedContainer>(listed) ?? [])
    .filter(({ Labels }) => isAnotherMiradors(Labels?.[HOST_LABEL], hostLabel))
    .flatMap(nameOf);

type InspectedContainer = { Mounts?: { Source?: unknown; RW?: unknown }[] };

/** What the containers `podman inspect --format json` gives mount read and write; null where it gives no list of them. */
export const writableSourcesIn = (inspected: string): string[] | null =>
  arrayIn<InspectedContainer>(inspected)?.flatMap(({ Mounts }) =>
    (Array.isArray(Mounts) ? Mounts : []).flatMap(({ Source, RW }) => (RW === true && typeof Source === "string" ? [withoutTrailingSlash(Source)] : [])),
  ) ?? null;

/** The names `podman images --format json` lists, `localhost/mirador-sandbox-base:…` among them; an image without a name has none. */
export function imageNamesIn(listed: string): string[] {
  try {
    const images = JSON.parse(listed) as { Names?: unknown }[];
    return Array.isArray(images) ? images.flatMap(({ Names }) => (Array.isArray(Names) ? Names.filter((name): name is string => typeof name === "string") : [])) : [];
  } catch {
    return [];
  }
}

const imageExists = async (cli: ContainerCli, image: string) => (await cli.run(["image", "exists", image])).exitCode === 0;

/** The owner's base image as `podman image inspect --format json` gives it, `[{ Id }]`: run by its ID, which is its content. */
export function ownBaseIn(inspected: string): OwnBase | null {
  const id = arrayIn<{ Id?: unknown }>(inspected)?.[0]?.Id;
  return typeof id === "string" && /^[a-f0-9]{64}$/.test(id) ? { image: id, content: id } : null;
}

/**
 * Builds Mirador's base image on this computer from its recipe, with an empty folder as the build's context and no layers
 * kept besides the image's own, then removes the image it builds on where the build pulled it, and the bases of other
 * recipes built before. Every other image is left as it was: other programs share Podman's images.
 */
async function buildImage(cli: ContainerCli, tag: string, progress: (setup: SandboxSetup) => void) {
  progress({ stage: "building-image" });
  const base = baseImageOf(await readFile(BASE_RECIPE, "utf8"));
  const baseWasThere = base !== null && (await imageExists(cli, base));
  const emptyContext = await mkdtemp(join(tmpdir(), "mirador-image-"));
  try {
    await mustRun(cli, ["build", "--layers=false", "-f", BASE_RECIPE, "-t", tag, emptyContext], { timeoutMs: BUILD_TIMEOUT_MS, onLine: buildProgress(progress) });
  } finally {
    await rm(emptyContext, { recursive: true, force: true });
    if (base !== null && !baseWasThere) await cli.run(["image", "rm", base]);
  }
  await removeOtherBases(cli, tag);
}

async function removeOtherBases(cli: ContainerCli, kept: string) {
  const listed = await cli.run(["images", "--format", "json"]);
  const others = imageNamesIn(listed.stdout).filter((name) => isMiradorsBase(name) && !name.endsWith(`/${kept}`) && name !== kept);
  if (others.length > 0) await cli.run(["image", "rm", ...others]);
}

/**
 * Rooms' sandboxes on rootless Podman on Linux, each in a plain container, which shares this computer's kernel. The
 * base image is built on first use.
 */
export class Podman implements VmLauncher {
  constructor(
    private cli: ContainerCli | null,
    private available: SandboxAvailability,
    /** Where Podman keeps its images and containers, and their state while they run. */
    public storage: string[] = [],
    /** The program to ask again where Podman couldn't run sandboxes; none for one that is never asked. */
    private readonly asked: EngineProgram | null = null,
  ) {}

  /** The `podman` of `asked`, as it says it runs here: none where it can't run sandboxes. */
  static of(asked: EngineProgram, here: EngineHere) {
    const podman = new Podman(null, podmanAvailability(here), [], asked);
    podman.took(here);
    return podman;
  }

  private asking: Promise<boolean> | null = null;

  askAgain() {
    const asked = this.asked;
    if (this.available.available || asked === null) return Promise.resolve(false);
    return (this.asking ??= askEngineAgain(asked.program, asked.selinuxEnforce)
      .then((here) => this.took(here))
      .finally(() => (this.asking = null)));
  }

  /** Takes what Podman says of itself: whether it runs sandboxes, and where it keeps its images; whether it runs them otherwise than before. */
  private took(here: EngineHere) {
    const availability = podmanAvailability(here);
    const changed = !sameAvailability(availability, this.available);
    this.available = availability;
    this.cli = availability.available && this.asked ? containerCli(this.asked.program) : null;
    if (here.info !== null) this.storage = podmanStorageIn(here.info);
    return changed;
  }

  /** Podman maps this computer's user to the agents' user, as Mirador runs it. */
  readonly filesOwner = AGENT_USER;

  availability() {
    return this.available;
  }

  async prepare() {
    this.usable();
  }

  async defaultBase(progress: (setup: SandboxSetup) => void) {
    const cli = this.usable();
    const tag = await defaultBaseTag();
    if (!(await imageExists(cli, tag))) await buildImage(cli, tag, progress);
    return { image: tag, path: DEFAULT_BASE_PATH };
  }

  async ownBase(name: string) {
    const cli = this.usable();
    const here = async () => {
      const inspected = await cli.run(["image", "inspect", "--format", "json", name]);
      return inspected.exitCode === 0 ? ownBaseIn(inspected.stdout) : null;
    };
    return pulledOrHere(name, () => cli.run(["pull", "--quiet", name], { timeoutMs: PULL_TIMEOUT_MS }), here);
  }

  /** Podman's pull says nothing of how far it got that is read here: only that it started. */
  async installerImage(image: string, progress: (pulled: SandboxSetup) => void) {
    const cli = this.usable();
    if (await imageExists(cli, image)) return;
    progress({ stage: "pulling-image" });
    await mustRun(cli, ["pull", "--quiet", image], { timeoutMs: PULL_TIMEOUT_MS });
  }

  async runOnce(run: ThrowawayRun, timeoutMs: number) {
    const ran = await this.usable().run(runOnceArguments(run), { timeoutMs });
    return { exitCode: ran.exitCode, output: ran.output };
  }

  async start(plan: VmPlan) {
    const run = await this.usable().run(runArguments(plan), { timeoutMs: RUN_TIMEOUT_MS });
    if (run.exitCode !== 0) throw new SandboxNotReady({ kind: "could-not-start", cause: lastLineOf(run.output) || `exit ${run.exitCode}` });
    await this.ready(plan.name);
  }

  agentProcess(agent: AgentInVm) {
    const cli = this.usable();
    return { command: [cli.program, ...execArguments(agent)], environment: execProcessEnvironment(agent.environment, process.env, PODMAN_READS) };
  }

  async runAsAgent(vm: string, user: string, command: string[], input: string, timeoutMs: number) {
    const ran = await this.usable().run(["exec", "-i", "--user", "0:0", vm, ...droppedTo(user, command)], { input, timeoutMs, stdoutMostBytes: AGENT_RUN_MOST_BYTES });
    return { exitCode: ran.exitCode, stdout: ran.stdout };
  }

  /** Stops the sandbox and removes it, then makes sure Podman no longer has it; throws where it still does. */
  async stop(vm: string) {
    const cli = this.usable();
    await cli.run(["rm", "--force", "--ignore", "--time", "5", vm]);
    const exists = await cli.run(["container", "exists", vm]);
    if (exists.exitCode !== 1) throw new Error(`the sandbox ${vm} did not stop: ${lastLineOf(exists.output) || `exit ${exists.exitCode}`}`);
  }

  async listMiradors(hostLabel: string) {
    const listed = await this.usable().run(["ps", "--all", "--filter", `label=${HOST_LABEL}=${hostLabel}`, "--format", "json"]);
    return containersLabelled(listed.stdout, HOST_LABEL, hostLabel);
  }

  /** A container gone between the list and the look gets inspect to fail, but it still prints the others. */
  async writtenByOtherMiradors(hostLabel: string) {
    const cli = this.usable();
    const listed = await cli.run(["ps", "--all", "--filter", `label=${HOST_LABEL}`, "--format", "json"]);
    if (listed.exitCode !== 0) throw new SandboxNotReady({ kind: "could-not-start", cause: `the VMs of other Miradors here couldn't be listed: ${lastLineOf(listed.output)}` });
    const others = othersContainersIn(listed.stdout, hostLabel);
    if (others.length === 0) return [];
    const inspected = await cli.run(["inspect", "--type", "container", "--format", "json", ...others]);
    const written = writableSourcesIn(inspected.stdout);
    if (!written) throw new SandboxNotReady({ kind: "could-not-start", cause: `the VMs of other Miradors here couldn't be looked at: ${lastLineOf(inspected.output)}` });
    return written;
  }

  async removeLeftovers(hostLabel: string) {
    if (!this.cli || !this.available.available) return;
    const leftovers = await this.listMiradors(hostLabel);
    if (leftovers.length > 0) await this.cli.run(["rm", "--force", "--ignore", "--time", "5", ...leftovers]);
  }

  private usable(): ContainerCli {
    if (!this.cli || !this.available.available) throw new SandboxNotReady({ kind: "unavailable", why: this.available.available ? "turned-off" : this.available.why });
    return this.cli;
  }

  private async ready(vm: string) {
    await readyOnceItSays(this.usable(), vm);
  }
}

/** Ready once the VM's first process says so; one that ended before, and so was removed, did not start, as the last it said tells. */
export async function readyOnceItSays(cli: ContainerCli, vm: string) {
  const giveUpAt = Date.now() + READY_WITHIN_S * 1000;
  let said = "";
  while (Date.now() < giveUpAt) {
    const logs = await cli.run(["logs", vm]);
    if (logs.output.includes(VM_READY_LINE)) return;
    if (logs.exitCode !== 0) throw new SandboxNotReady({ kind: "could-not-start", cause: lastLineOf(said) || lastLineOf(logs.output) || `exit ${logs.exitCode}` });
    said = logs.output;
    await Bun.sleep(150);
  }
  throw new SandboxNotReady({ kind: "not-ready-in-time", seconds: READY_WITHIN_S });
}

/**
 * What of this Linux computer it runs programs from by itself, which no sandbox may hold: the user's config and local
 * programs, and where the engines here keep their images, which other containers run.
 */
export const computersOwnOnLinux = (home: string, enginesStorage: string[]) => [join(home, ".config"), join(home, ".local"), ...enginesStorage];
