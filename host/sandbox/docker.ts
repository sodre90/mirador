import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SandboxAvailability, SandboxSetup } from "../../shared/sandbox.ts";
import { dockerAvailability, dockerStorageIn, type EngineHere } from "./availability.ts";
import { containerCli, lastLineOf, type ContainerCli } from "./container-cli.ts";
import { droppedTo, environmentFlags, execProcessEnvironment, readByTool } from "./exec-environment.ts";
import { BASE_RECIPE, baseImageOf, BUILD_TIMEOUT_MS, buildProgress, DEFAULT_BASE_PATH, defaultBaseTag, isMiradorsBase, mustRun, pulledOrHere, PULL_TIMEOUT_MS } from "./image.ts";
import { AGENT_RUN_MOST_BYTES, arrayIn, CPUS, FIRST_PROCESS_MAY, LOG_MOST, MOST_PROCESSES, mountFlags, readyOnceItSays, RUN_TIMEOUT_MS, writableSourcesIn } from "./podman.ts";
import { HOST_LABEL, isAnotherMiradors, SandboxNotReady, type AgentInVm, type OwnBase, type ThrowawayRun, type VmPlan, type VmLauncher } from "./vm-launcher.ts";

/**
 * What the `docker` process itself reads of this computer's environment to find its daemon, context and config: the
 * agent's values of these go on its command line, into the container, and never steer Docker.
 */
export const DOCKER_READS = readByTool(["PATH", "HOME", "TMPDIR", "USER", "LOGNAME", "SHELL", "XDG_RUNTIME_DIR", "XDG_CONFIG_HOME"], ["DOCKER_", "BUILDKIT_", "BUILDX_"]);

/** The proxies Docker gives each container it starts from its config, which a sandbox's never takes: its agents go through Mirador's. */
const PROXIES_OF_DOCKERS_CONFIG = ["HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy", "FTP_PROXY", "ftp_proxy", "NO_PROXY", "no_proxy", "ALL_PROXY", "all_proxy"];

/** Rootless Docker shows this computer's user's files as its containers' root's, which the guard writes them as. */
const ROOT_OF_THE_CONTAINER = "0:0";

/**
 * `docker run` of a room's sandbox, as Podman's: a plain container, detached, removed once stopped, its first process
 * under an init that passes signals on, the container's root, who is this computer's user under rootless Docker, and who
 * guards the folders through FUSE. The agents start as the agent user, who owns nothing of this computer, and have no
 * capability, nor any to gain. The container has no network at all, none of Docker's proxies, and a log that keeps only
 * so much. SELinux labels are left off, so the workspace is shown as it is rather than relabelled.
 */
export function runArguments({ name, labels, image, memory, mounts, entrypoint, args }: VmPlan) {
  return [
    "run",
    "--detach",
    "--rm",
    "--init",
    "--name",
    name,
    ...Object.entries(labels).flatMap(([label, value]) => ["--label", `${label}=${value}`]),
    "--user",
    "0:0",
    "--cap-drop",
    "all",
    ...FIRST_PROCESS_MAY.flatMap((capability) => ["--cap-add", capability]),
    "--device",
    "/dev/fuse",
    "--security-opt",
    "no-new-privileges",
    "--security-opt",
    "label=disable",
    "--network",
    "none",
    ...PROXIES_OF_DOCKERS_CONFIG.flatMap((variable) => ["--env", `${variable}=`]),
    "--memory",
    memory,
    "--memory-swap",
    memory,
    "--cpus",
    CPUS,
    "--pids-limit",
    MOST_PROCESSES,
    "--log-driver",
    "json-file",
    "--log-opt",
    `max-size=${LOG_MOST}`,
    ...mounts.flatMap(mountFlags),
    "--entrypoint",
    entrypoint,
    image,
    ...args,
  ];
}

/** `docker run` of a throwaway container, removed once it ends, its mounts shown as they are rather than relabelled. */
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
  entrypoint,
  image,
  ...args,
];

/** `docker exec` of an agent, as its user, in its folder, its values by name. */
export const execArguments = ({ vm, user, workingDirectory, environment, command }: AgentInVm) => [
  "exec",
  "-i",
  "--user",
  "0:0",
  "-w",
  workingDirectory,
  ...environmentFlags(environment, DOCKER_READS),
  vm,
  ...droppedTo(user, command),
];

/** The owner's base image as `docker image inspect` gives it, `[{ Id }]`: run by its ID, which is its content. */
export function ownBaseIn(inspected: string): OwnBase | null {
  const id = arrayIn<{ Id?: unknown }>(inspected)?.[0]?.Id;
  return typeof id === "string" && /^sha256:[a-f0-9]{64}$/.test(id) ? { image: id, content: id } : null;
}

const linesOf = (printed: string) => printed.split("\n").filter((line) => line !== "");

/** What `{{.Label "…"}}` prints for a container without that label. */
const NO_LABEL = "<no value>";

/** The containers `docker ps --format '{{.Names}}\t{{.Label "…"}}'` lists that another Mirador on this computer started. */
export const othersContainersIn = (listed: string, hostLabel: string): string[] =>
  linesOf(listed).flatMap((line) => {
    const [name, label] = line.split("\t");
    return name && label !== NO_LABEL && isAnotherMiradors(label, hostLabel) ? [name] : [];
  });

/** Whether `docker container inspect` said the container is not there, as it says for a missing one, rather than failed. */
export const saysNoSuchContainer = (output: string) => /no such container/i.test(output);

const imageExists = async (cli: ContainerCli, image: string) => (await cli.run(["image", "inspect", image])).exitCode === 0;

/**
 * Builds Mirador's base image on this computer from its recipe, with an empty folder as the build's context, then removes
 * the image it builds on where the build pulled it, and the bases of other recipes built before. Every other image is left
 * as it was, and so is Docker's build cache: other programs share both.
 */
async function buildImage(cli: ContainerCli, tag: string, progress: (setup: SandboxSetup) => void) {
  progress({ stage: "building-image" });
  const base = baseImageOf(await readFile(BASE_RECIPE, "utf8"));
  const baseWasThere = base !== null && (await imageExists(cli, base));
  const emptyContext = await mkdtemp(join(tmpdir(), "mirador-image-"));
  try {
    await mustRun(cli, ["build", "-f", BASE_RECIPE, "-t", tag, emptyContext], { timeoutMs: BUILD_TIMEOUT_MS, onLine: buildProgress(progress) });
  } finally {
    await rm(emptyContext, { recursive: true, force: true });
    if (base !== null && !baseWasThere) await cli.run(["image", "rm", base]);
  }
  const listed = await cli.run(["images", "--format", "{{.Repository}}:{{.Tag}}"]);
  const others = linesOf(listed.stdout).filter((name) => isMiradorsBase(name) && name !== tag);
  if (others.length > 0) await cli.run(["image", "rm", ...others]);
}

/**
 * Rooms' sandboxes on rootless Docker on Linux, each in a plain container, which shares this computer's kernel. Docker has
 * no way to show this computer's user as the agent user, so the guard writes the folders' files as the container's root,
 * whom Docker maps to this computer's user, and shows them to the agents as theirs. The base image is built on first use.
 */
export class Docker implements VmLauncher {
  constructor(
    private readonly cli: ContainerCli | null,
    private readonly available: SandboxAvailability,
    /** Where Docker keeps its images and containers. */
    readonly storage: string[] = [],
  ) {}

  /** The `docker` at `program`, as it says it runs here: none where it can't run sandboxes. */
  static of(program: string, here: EngineHere) {
    const availability = dockerAvailability(here);
    return new Docker(availability.available ? containerCli(program) : null, availability, here.info === null ? [] : dockerStorageIn(here.info));
  }

  readonly filesOwner = ROOT_OF_THE_CONTAINER;

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
      const inspected = await cli.run(["image", "inspect", name]);
      return inspected.exitCode === 0 ? ownBaseIn(inspected.stdout) : null;
    };
    return pulledOrHere(name, () => cli.run(["pull", "--quiet", name], { timeoutMs: PULL_TIMEOUT_MS }), here);
  }

  /** Docker's quiet pull says nothing of how far it got: only that it started. */
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
    const cli = this.usable();
    const run = await cli.run(runArguments(plan), { timeoutMs: RUN_TIMEOUT_MS });
    if (run.exitCode !== 0) throw new SandboxNotReady({ kind: "could-not-start", cause: lastLineOf(run.output) || `exit ${run.exitCode}` });
    await readyOnceItSays(cli, plan.name);
  }

  agentProcess(agent: AgentInVm) {
    const cli = this.usable();
    return { command: [cli.program, ...execArguments(agent)], environment: execProcessEnvironment(agent.environment, process.env, DOCKER_READS) };
  }

  async runAsAgent(vm: string, user: string, command: string[], input: string, timeoutMs: number) {
    const ran = await this.usable().run(["exec", "-i", "--user", "0:0", vm, ...droppedTo(user, command)], { input, timeoutMs, stdoutMostBytes: AGENT_RUN_MOST_BYTES });
    return { exitCode: ran.exitCode, stdout: ran.stdout };
  }

  /** Removes the sandbox, stopping it, then makes sure Docker no longer has it; throws where it still does. */
  async stop(vm: string) {
    const cli = this.usable();
    await cli.run(["rm", "--force", vm]);
    const inspected = await cli.run(["container", "inspect", vm]);
    if (inspected.exitCode === 0 || !saysNoSuchContainer(inspected.output)) throw new Error(`the sandbox ${vm} did not stop: ${lastLineOf(inspected.output) || `exit ${inspected.exitCode}`}`);
  }

  async listMiradors(hostLabel: string) {
    const listed = await this.usable().run(["ps", "--all", "--filter", `label=${HOST_LABEL}=${hostLabel}`, "--format", "{{.Names}}"]);
    return linesOf(listed.stdout);
  }

  /** A container gone between the list and the look gets inspect to fail, but it still prints the others. */
  async writtenByOtherMiradors(hostLabel: string) {
    const cli = this.usable();
    const listed = await cli.run(["ps", "--all", "--filter", `label=${HOST_LABEL}`, "--format", `{{.Names}}\t{{.Label "${HOST_LABEL}"}}`]);
    if (listed.exitCode !== 0) throw new SandboxNotReady({ kind: "could-not-start", cause: `the VMs of other Miradors here couldn't be listed: ${lastLineOf(listed.output)}` });
    const others = othersContainersIn(listed.stdout, hostLabel);
    if (others.length === 0) return [];
    const inspected = await cli.run(["inspect", "--type", "container", ...others]);
    const written = writableSourcesIn(inspected.stdout);
    if (!written) throw new SandboxNotReady({ kind: "could-not-start", cause: `the VMs of other Miradors here couldn't be looked at: ${lastLineOf(inspected.output)}` });
    return written;
  }

  async removeLeftovers(hostLabel: string) {
    if (!this.cli || !this.available.available) return;
    const leftovers = await this.listMiradors(hostLabel);
    if (leftovers.length > 0) await this.cli.run(["rm", "--force", ...leftovers]);
  }

  private usable(): ContainerCli {
    if (!this.cli || !this.available.available) throw new SandboxNotReady({ kind: "unavailable", why: this.available.available ? "turned-off" : this.available.why });
    return this.cli;
  }
}
