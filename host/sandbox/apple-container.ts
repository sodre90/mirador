import type { SandboxAvailability, SandboxSetup } from "../../shared/sandbox.ts";
import { sandboxRuntime } from "./availability.ts";
import { containerCli, lastLineOf, type ContainerCli } from "./container-cli.ts";
import { buildImage, imageExists, imageTag, serviceRuns, startService } from "./image.ts";
import { HOST_LABEL, SandboxNotReady, VM_READY_LINE, type AgentInVm, type RoomVmPlan, type VmLauncher } from "./vm-launcher.ts";
import type { Mount } from "./workspace-mounts.ts";

const READY_WITHIN_S = 30;

/** What the `container` process itself needs of this Mac's environment to run: the agent's values of these go on its command line. */
const CLIENTS_OWN = ["PATH", "HOME", "TMPDIR", "USER", "LOGNAME", "SHELL"];

const mountFlags = ({ source, target, readOnly }: Mount) => ["-v", `${source}:${target}${readOnly ? ":ro" : ""}`];

/**
 * `container run` of a room's VM: detached, removed once stopped, its first process under an init that passes signals
 * on, with no network at all.
 */
export const runArguments = ({ name, labels, image, memory, mounts, entry }: RoomVmPlan) => [
  "run",
  "--detach",
  "--rm",
  "--init",
  "--name",
  name,
  ...Object.entries(labels).flatMap(([label, value]) => ["--label", `${label}=${value}`]),
  "--memory",
  memory,
  "--network",
  "none",
  "--progress",
  "none",
  ...mounts.flatMap(mountFlags),
  image,
  ...entry,
];

/** The most a command run as the agent user may print: what a put-back of held files tells, with room to spare. */
const AGENT_RUN_MOST_BYTES = 16 * 1024 * 1024;

/**
 * A command started as root and dropped to the agent user at once, with no capabilities, none it could gain, and none
 * left for regaining root: it can't lift a read-only mount.
 */
export function droppedTo(user: string, command: string[]) {
  const [uid, gid] = user.split(":");
  return ["setpriv", `--reuid=${uid}`, `--regid=${gid}`, "--clear-groups", "--inh-caps=-all", "--bounding-set=-all", "--no-new-privs", "--", ...command];
}

/**
 * `container exec` of an agent, as its user, in its folder. Its values go in by name, from the exec process's own
 * environment, so none shows on its command line; only those that process needs this Mac's of are written out.
 */
export function execArguments({ vm, user, workingDirectory, environment, command }: AgentInVm) {
  const names = Object.keys(environment);
  const written = names.filter((name) => CLIENTS_OWN.includes(name)).flatMap((name) => ["-e", `${name}=${environment[name]}`]);
  const byName = names.filter((name) => !CLIENTS_OWN.includes(name)).flatMap((name) => ["-e", name]);
  return ["exec", "-i", "--user", "0:0", "-w", workingDirectory, ...written, ...byName, vm, ...droppedTo(user, command)];
}

/** The environment of the `container exec` process on this Mac: the agent's values, but this Mac's own of what that process needs. */
export function execProcessEnvironment(environment: Record<string, string>, thisMac: Record<string, string | undefined>) {
  const own = Object.fromEntries(CLIENTS_OWN.flatMap((name) => (thisMac[name] === undefined ? [] : [[name, thisMac[name]!]])));
  return { ...environment, ...own };
}

type ListedContainer = { configuration?: { id?: unknown; labels?: Record<string, unknown> } };

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

/** Rooms' VMs on Apple's `container`, macOS 26 on Apple silicon: its service started and the image built on first use. */
export class AppleContainer implements VmLauncher {
  constructor(
    private readonly cli: ContainerCli | null,
    private readonly available: SandboxAvailability,
  ) {}

  /** The `container` the setting names, else the one installed; none where the setting is off or this Mac can't run it. */
  static here(setting: string | undefined, path: string) {
    const { program, availability } = sandboxRuntime(setting, path);
    return new AppleContainer(program ? containerCli(program) : null, availability);
  }

  availability() {
    return this.available;
  }

  async prepare(claudeCodeVersion: string, progress: (setup: SandboxSetup) => void) {
    const cli = this.usable();
    await startService(cli, progress);
    const tag = await imageTag(claudeCodeVersion);
    if (!(await imageExists(cli, tag))) await buildImage(cli, tag, claudeCodeVersion, progress);
    return tag;
  }

  async start(plan: RoomVmPlan) {
    const run = await this.usable().run(runArguments(plan));
    if (run.exitCode !== 0) throw new SandboxNotReady({ kind: "could-not-start", cause: lastLineOf(run.output) || `exit ${run.exitCode}` });
    await this.ready(plan.name);
  }

  agentProcess(agent: AgentInVm) {
    const cli = this.usable();
    return { command: [cli.program, ...execArguments(agent)], environment: execProcessEnvironment(agent.environment, process.env) };
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
