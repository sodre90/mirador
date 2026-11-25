import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SandboxAvailability, SandboxSetup } from "../../shared/sandbox.ts";
import { AGENT_USER } from "./agent-environment.ts";
import { askPodman, podmanAvailability, podmanProgram, podmanStorageIn, SELINUX_ENFORCE } from "./availability.ts";
import { containerCli, lastLineOf, type ContainerCli } from "./container-cli.ts";
import { droppedTo, environmentFlags, execProcessEnvironment, readByTool } from "./exec-environment.ts";
import { baseImageOf, buildArguments, buildStepIn, imagesOfKind, imageTag, mustRun, RECIPE, type AgentImage } from "./image.ts";
import { HOST_LABEL, SandboxNotReady, VM_READY_LINE, type AgentInVm, type Mount, type VmPlan, type VmLauncher } from "./vm-launcher.ts";

const READY_WITHIN_S = 30;
const BUILD_TIMEOUT_MS = 30 * 60_000;
/** The first start of an image as the agent user's own may copy its files for that user, which takes a while. */
const RUN_TIMEOUT_MS = 10 * 60_000;

/** As many CPUs as Apple's `container` gives a VM, and room for the processes of a few agents at work and their builds. */
const CPUS = "4";
const MOST_PROCESSES = "4096";

/**
 * What the container's first process may do as its root, who is nobody on this computer: mount the folders it guards and
 * keep the agents out of what it mounts them from, let the relays reach Mirador's sockets, and then give all of it up.
 */
const FIRST_PROCESS_MAY = ["SYS_ADMIN", "DAC_OVERRIDE", "FOWNER", "SETUID", "SETGID", "SETPCAP"];

/** The most of the container's log Podman keeps: its relays say a few lines. */
const LOG_MOST = "1mb";

/**
 * What the `podman` process itself reads of this computer's environment to find its storage, runtime, config and the
 * Podman it talks to: the agent's values of these go on its command line, into the container, and never steer Podman.
 */
export const PODMAN_READS = readByTool(
  ["PATH", "HOME", "TMPDIR", "USER", "LOGNAME", "SHELL", "XDG_RUNTIME_DIR", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "DBUS_SESSION_BUS_ADDRESS", "REGISTRIES_CONFIG_PATH", "REGISTRY_AUTH_FILE"],
  ["CONTAINER_", "CONTAINERS_", "_CONTAINERS_", "STORAGE_", "PODMAN_"],
);

const mountFlags = ({ source, target, readOnly }: Mount) => ["-v", `${source}:${target}${readOnly ? ":ro" : ""}`];

/**
 * `podman run` of a room's sandbox, a plain container: detached, removed once stopped, its first process under an init
 * that passes signals on. That process is the container's root, which guards the folders through FUSE; the agents start
 * as the agent user, who is this computer's user there, so the workspace's files stay theirs, and have no capability,
 * nor any to gain. The container has no network at all, and a log of its own that keeps only so much. SELinux labels are
 * left off, so the workspace is shown as it is rather than relabelled.
 */
export function runArguments({ name, labels, image, memory, mounts, entry }: VmPlan) {
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
    image,
    ...entry,
  ];
}

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
const AGENT_RUN_MOST_BYTES = 16 * 1024 * 1024;

type ListedContainer = { Names?: unknown; Labels?: Record<string, unknown> | null };

/** The names of the containers `podman ps --format json` lists whose label has this value. */
export function containersLabelled(listed: string, label: string, value: string): string[] {
  try {
    const containers = JSON.parse(listed) as ListedContainer[];
    if (!Array.isArray(containers)) return [];
    const labelled = containers.filter(({ Labels }) => Labels?.[label] === value);
    return labelled.flatMap(({ Names }) => (Array.isArray(Names) && typeof Names[0] === "string" ? [Names[0]] : []));
  } catch {
    return [];
  }
}

/** The names `podman images --format json` lists, `localhost/mirador-room-agent:…` among them; an image without a name has none. */
export function imageNamesIn(listed: string): string[] {
  try {
    const images = JSON.parse(listed) as { Names?: unknown }[];
    return Array.isArray(images) ? images.flatMap(({ Names }) => (Array.isArray(Names) ? Names.filter((name): name is string => typeof name === "string") : [])) : [];
  } catch {
    return [];
  }
}

const imageExists = async (cli: ContainerCli, image: string) => (await cli.run(["image", "exists", image])).exitCode === 0;

/**
 * Builds the image on this computer from the recipe, with an empty folder as the build's context and no layers kept
 * besides the image's own, then removes the image it builds on where the build pulled it, and the images of the agent's
 * other versions built before. Every other image is left as it was, other agent kinds' too: other programs share
 * Podman's images.
 */
async function buildImage(cli: ContainerCli, tag: string, agent: AgentImage, progress: (setup: SandboxSetup) => void) {
  progress({ stage: "building-image" });
  const base = baseImageOf(await readFile(RECIPE, "utf8"));
  const baseWasThere = base !== null && (await imageExists(cli, base));
  const emptyContext = await mkdtemp(join(tmpdir(), "mirador-image-"));
  try {
    const build = ["build", "--layers=false", "-f", RECIPE, ...(await buildArguments(agent)), "-t", tag, emptyContext];
    await mustRun(cli, build, {
      timeoutMs: BUILD_TIMEOUT_MS,
      onLine: (line) => {
        const step = buildStepIn(line);
        if (step) progress({ stage: "building-image", step });
      },
    });
  } finally {
    await rm(emptyContext, { recursive: true, force: true });
    if (base !== null && !baseWasThere) await cli.run(["image", "rm", base]);
  }
  await removeOtherVersions(cli, tag, agent);
}

async function removeOtherVersions(cli: ContainerCli, kept: string, { harness }: AgentImage) {
  const listed = await cli.run(["images", "--format", "json"]);
  const others = imageNamesIn(listed.stdout).filter((name) => name.split("/").at(-1)!.startsWith(imagesOfKind(harness)) && !name.endsWith(`/${kept}`) && name !== kept);
  if (others.length > 0) await cli.run(["image", "rm", ...others]);
}

/**
 * Rooms' sandboxes on rootless Podman on Linux, each in a plain container, which shares this computer's kernel. The
 * image is built on first use.
 */
export class Podman implements VmLauncher {
  constructor(
    private readonly cli: ContainerCli | null,
    private readonly available: SandboxAvailability,
    /** Where Podman keeps its images and containers, and their state while they run. */
    readonly storage: string[] = [],
  ) {}

  /** The `podman` the setting names, else the one installed, as it says it runs here; none where the setting is off or it can't run sandboxes. */
  static here(setting: string | undefined, path: string, selinuxEnforce = SELINUX_ENFORCE) {
    const program = podmanProgram(setting, path);
    if (program === "off") return new Podman(null, { available: false, why: "turned-off" });
    if (program === null) return new Podman(null, { available: false, why: "no-podman" });
    const here = askPodman(program, selinuxEnforce);
    const availability = podmanAvailability(here);
    return new Podman(availability.available ? containerCli(program) : null, availability, here.info === null ? [] : podmanStorageIn(here.info));
  }

  availability() {
    return this.available;
  }

  async prepare(agent: AgentImage, progress: (setup: SandboxSetup) => void) {
    const cli = this.usable();
    const tag = await imageTag(agent);
    if (!(await imageExists(cli, tag))) await buildImage(cli, tag, agent, progress);
    return tag;
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

  async removeLeftovers(hostLabel: string) {
    if (!this.cli || !this.available.available) return;
    const leftovers = await this.listMiradors(hostLabel);
    if (leftovers.length > 0) await this.cli.run(["rm", "--force", "--ignore", "--time", "5", ...leftovers]);
  }

  private usable(): ContainerCli {
    if (!this.cli || !this.available.available) throw new SandboxNotReady({ kind: "unavailable", why: this.available.available ? "turned-off" : this.available.why });
    return this.cli;
  }

  /** Ready once its first process says so; one that ended before, and so was removed, did not start, as the last it said tells. */
  private async ready(vm: string) {
    const giveUpAt = Date.now() + READY_WITHIN_S * 1000;
    let said = "";
    while (Date.now() < giveUpAt) {
      const logs = await this.usable().run(["logs", vm]);
      if (logs.output.includes(VM_READY_LINE)) return;
      if (logs.exitCode !== 0) throw new SandboxNotReady({ kind: "could-not-start", cause: lastLineOf(said) || lastLineOf(logs.output) || `exit ${logs.exitCode}` });
      said = logs.output;
      await Bun.sleep(150);
    }
    throw new SandboxNotReady({ kind: "not-ready-in-time", seconds: READY_WITHIN_S });
  }
}

/**
 * What of this Linux computer it runs programs from by itself, which no sandbox may hold: the user's config and local
 * programs, and Podman's storage, whose images other containers run.
 */
export const computersOwnOnLinux = (home: string, podman: Podman) => [join(home, ".config"), join(home, ".local"), ...podman.storage];
