import type { SandboxAvailability, SandboxSetup } from "../../shared/sandbox.ts";
import { AGENT_USER } from "./agent-environment.ts";
import { appleContainerRuntime } from "./availability.ts";
import { containerCli, lastLineOf, type ContainerCli } from "./container-cli.ts";
import { droppedTo, environmentFlags, execProcessEnvironment, readByTool } from "./exec-environment.ts";
import { buildImage, DEFAULT_BASE_PATH, defaultBaseTag, imageExists, mustRun, pulledOrHere, PULL_TIMEOUT_MS, serviceRuns, startService } from "./image.ts";
import { HOST_LABEL, isAnotherMiradors, SandboxNotReady, VM_READY_LINE, withoutTrailingSlash, type AgentInVm, type Mount, type OwnBase, type ThrowawayRun, type VmPlan, type VmLauncher } from "./vm-launcher.ts";

const READY_WITHIN_S = 30;

/** What the `container` process itself reads of this Mac's environment to run: the agent's values of these go on its command line. */
export const CONTAINER_READS = readByTool(["PATH", "HOME", "TMPDIR", "USER", "LOGNAME", "SHELL"]);

const mountFlags = ({ source, target, readOnly }: Mount) => ["-v", `${source}:${target}${readOnly ? ":ro" : ""}`];

/**
 * `container run` of a room's VM: detached, removed once stopped, its first process, as root that may mount whatever
 * user the image names, under an init that passes signals on, with no network at all.
 */
export const runArguments = ({ name, labels, image, memory, mounts, entrypoint, args }: VmPlan) => [
  "run",
  "--detach",
  "--rm",
  "--init",
  "--name",
  name,
  ...Object.entries(labels).flatMap(([label, value]) => ["--label", `${label}=${value}`]),
  "--user",
  "0:0",
  "--cap-add",
  "CAP_SYS_ADMIN",
  "--memory",
  memory,
  "--network",
  "none",
  "--progress",
  "none",
  ...mounts.flatMap(mountFlags),
  "--entrypoint",
  entrypoint,
  image,
  ...args,
];

/** `container image pull` of the owner's base image, for this Mac's processor. */
export const pullArguments = (name: string) => ["image", "pull", "--progress", "plain", "--platform", "linux/arm64", name];

/**
 * How far a pull got, as `container image pull --progress plain` says it about once a second: `[1/2] Fetching image 45%
 * (3 of 7 blobs, …) [12s]`, then, its last part, `[2/2] Unpacking image for platform linux/arm64/v8 80% (…) [14s]`.
 */
export function pullProgressIn(line: string): SandboxSetup | null {
  const part = /^\[(\d+)\/(\d+)\] /.exec(line);
  if (!part) return null;
  const percent = /\s(\d{1,3})%/.exec(line)?.[1];
  const unpacking = Number(part[2]) > 1 && part[1] === part[2];
  return { stage: "pulling-image", ...(percent === undefined ? {} : { percent: Math.min(Number(percent), 100) }), ...(unpacking ? { unpacking } : {}) };
}

/**
 * The owner's base image as `container image inspect` gives it, `[{ name, index: { digest } }]`: run by its name, as
 * `container` runs a name with a digest only where it pulled that very name, and its content the index's digest.
 */
export function ownBaseIn(inspected: string, name: string): OwnBase | null {
  try {
    const digest = (JSON.parse(inspected) as { index?: { digest?: unknown } }[])[0]?.index?.digest;
    return typeof digest === "string" ? { image: name, content: digest } : null;
  } catch {
    return null;
  }
}

/** `container run` of a throwaway container, removed once it ends. */
export const runOnceArguments = ({ image, mounts, entrypoint, args, user, network }: ThrowawayRun) => [
  "run",
  "--rm",
  "--progress",
  "none",
  "--user",
  user,
  ...(network ? [] : ["--network", "none"]),
  ...mounts.flatMap(mountFlags),
  "--entrypoint",
  entrypoint,
  image,
  ...args,
];

/** The most a command run as the agent user may print: what a put-back of held files tells, with room to spare. */
const AGENT_RUN_MOST_BYTES = 16 * 1024 * 1024;

/** `container exec` of an agent, as its user, in its folder, its values by name. */
export const execArguments = ({ vm, user, workingDirectory, environment, command }: AgentInVm) => [
  "exec",
  "-i",
  "--user",
  "0:0",
  "-w",
  workingDirectory,
  ...environmentFlags(environment, CONTAINER_READS),
  vm,
  ...droppedTo(user, command),
];

type ListedMount = { source?: unknown; options?: unknown };

type ListedContainer = { configuration?: { id?: unknown; labels?: Record<string, unknown>; mounts?: ListedMount[] } };

function containersIn(listed: string): ListedContainer[] {
  try {
    const containers = JSON.parse(listed);
    return Array.isArray(containers) ? containers : [];
  } catch {
    return [];
  }
}

const idOf = ({ configuration }: ListedContainer) => (typeof configuration?.id === "string" ? [configuration.id] : []);

/** The ids of the containers `container list --format json` gives. */
export const vmIdsIn = (listed: string): string[] => containersIn(listed).flatMap(idOf);

/** The ids of the containers `container list --format json` gives whose label has this value. */
export const vmIdsLabelled = (listed: string, label: string, value: string): string[] => containersIn(listed).filter(({ configuration }) => configuration?.labels?.[label] === value).flatMap(idOf);

const isReadOnly = ({ options }: ListedMount) => Array.isArray(options) && options.includes("ro");

const writableSourcesOf = (mounts: unknown): string[] =>
  (Array.isArray(mounts) ? (mounts as ListedMount[]) : []).filter((mount) => typeof mount?.source === "string" && !isReadOnly(mount)).map(({ source }) => withoutTrailingSlash(source as string));

/** What the containers `container list --all --format json` gives that another Mirador started mount read and write, as this Mac spells it. */
export function writtenByOthersIn(listed: string, hostLabel: string): string[] {
  const othersVms = containersIn(listed).filter(({ configuration }) => isAnotherMiradors(configuration?.labels?.[HOST_LABEL], hostLabel));
  return othersVms.flatMap(({ configuration }) => writableSourcesOf(configuration?.mounts));
}

/** Rooms' VMs on Apple's `container`, macOS 26 on Apple silicon: its service started and the base image built on first use. */
export class AppleContainer implements VmLauncher {
  constructor(
    private readonly cli: ContainerCli | null,
    private readonly available: SandboxAvailability,
  ) {}

  /** The `container` the setting names, else the one installed; none where the setting is off or this Mac can't run it. */
  static here(setting: string | undefined, path: string) {
    const { program, availability } = appleContainerRuntime(setting, path);
    return new AppleContainer(program ? containerCli(program) : null, availability);
  }

  /** The files of this Mac that the VM mounts are its agents' to them. */
  readonly filesOwner = AGENT_USER;

  availability() {
    return this.available;
  }

  async prepare(progress: (setup: SandboxSetup) => void) {
    await startService(this.usable(), progress);
  }

  async defaultBase(progress: (setup: SandboxSetup) => void) {
    const cli = this.usable();
    const tag = await defaultBaseTag();
    if (!(await imageExists(cli, tag))) await buildImage(cli, tag, progress);
    return { image: tag, path: DEFAULT_BASE_PATH };
  }

  async ownBase(name: string, progress: (setup: SandboxSetup) => void) {
    const cli = this.usable();
    const here = async () => {
      const inspected = await cli.run(["image", "inspect", name]);
      return inspected.exitCode === 0 ? ownBaseIn(inspected.stdout, name) : null;
    };
    const told = (line: string) => {
      const pulled = pullProgressIn(line);
      if (pulled) progress(pulled);
    };
    return pulledOrHere(name, () => cli.run(pullArguments(name), { timeoutMs: PULL_TIMEOUT_MS, onLine: told }), here);
  }

  async installerImage(image: string, progress: (pulled: SandboxSetup) => void) {
    const cli = this.usable();
    if (await imageExists(cli, image)) return;
    progress({ stage: "pulling-image" });
    const told = (line: string) => {
      const pulled = pullProgressIn(line);
      if (pulled) progress(pulled);
    };
    await mustRun(cli, pullArguments(image), { timeoutMs: PULL_TIMEOUT_MS, onLine: told });
  }

  async runOnce(run: ThrowawayRun, timeoutMs: number) {
    const ran = await this.usable().run(runOnceArguments(run), { timeoutMs });
    return { exitCode: ran.exitCode, output: ran.output };
  }

  async start(plan: VmPlan) {
    const run = await this.usable().run(runArguments(plan));
    if (run.exitCode !== 0) throw new SandboxNotReady({ kind: "could-not-start", cause: lastLineOf(run.output) || `exit ${run.exitCode}` });
    await this.ready(plan.name);
  }

  agentProcess(agent: AgentInVm) {
    const cli = this.usable();
    return { command: [cli.program, ...execArguments(agent)], environment: execProcessEnvironment(agent.environment, process.env, CONTAINER_READS) };
  }

  async runAsAgent(vm: string, user: string, command: string[], input: string, timeoutMs: number) {
    const ran = await this.usable().run(["exec", "-i", "--user", "0:0", vm, ...droppedTo(user, command)], { input, timeoutMs, stdoutMostBytes: AGENT_RUN_MOST_BYTES });
    return { exitCode: ran.exitCode, stdout: ran.stdout };
  }

  /** Stops the VM and removes it, then makes sure `container` no longer lists it; throws where it still does. */
  async stop(vm: string) {
    const cli = this.usable();
    await cli.run(["stop", vm]);
    await cli.run(["delete", "--force", vm]);
    const listed = await cli.run(["list", "--all", "--format", "json"]);
    if (listed.exitCode !== 0 || vmIdsIn(listed.stdout).includes(vm)) throw new Error(`the VM ${vm} did not stop: ${lastLineOf(listed.output)}`);
  }

  async listMiradors(hostLabel: string) {
    const listed = await this.usable().run(["list", "--all", "--format", "json"]);
    return vmIdsLabelled(listed.stdout, HOST_LABEL, hostLabel);
  }

  async writtenByOtherMiradors(hostLabel: string) {
    const listed = await this.usable().run(["list", "--all", "--format", "json"]);
    if (listed.exitCode !== 0) throw new SandboxNotReady({ kind: "could-not-start", cause: `the VMs of other Miradors here couldn't be listed: ${lastLineOf(listed.output)}` });
    return writtenByOthersIn(listed.stdout, hostLabel);
  }

  async removeLeftovers(hostLabel: string) {
    if (!this.cli || !this.available.available || !(await serviceRuns(this.cli))) return;
    const leftovers = await this.listMiradors(hostLabel);
    if (leftovers.length > 0) await this.cli.run(["delete", "--force", ...leftovers]);
  }

  private usable(): ContainerCli {
    if (!this.cli || !this.available.available) throw new SandboxNotReady({ kind: "unavailable", why: this.available.available ? "turned-off" : this.available.why });
    return this.cli;
  }

  private async ready(vm: string) {
    const giveUpAt = Date.now() + READY_WITHIN_S * 1000;
    while (Date.now() < giveUpAt) {
      if ((await this.usable().run(["logs", vm])).output.includes(VM_READY_LINE)) return;
      await Bun.sleep(150);
    }
    throw new SandboxNotReady({ kind: "not-ready-in-time", seconds: READY_WITHIN_S });
  }
}
