import { HostProblemError } from "../../shared/host-problems.ts";
import type { SandboxAvailability, SandboxNotReadyWhy, SandboxSetup } from "../../shared/sandbox.ts";
import type { AgentLaunch } from "../acp/harness.ts";
import type { AgentImage } from "./image.ts";

/** A folder or file of this computer shown in the VM at `target`, read-only or not. */
export interface Mount {
  source: string;
  target: string;
  readOnly: boolean;
}

/** Why a sandboxed agent can't run in its sandbox: the turn fails with it, and never runs on this computer instead. */
export class SandboxNotReady extends HostProblemError {
  constructor(readonly why: SandboxNotReadyWhy) {
    super({ code: "sandbox-not-ready", why });
  }
}

/** The labels Mirador gives its VMs: the host that started one, told apart by its data folder, and the room or workspace it is for. */
export const HOST_LABEL = "mirador.host";
export const OWNER_LABEL = "mirador.owner";

/** Whether a VM whose host label is this was started by another Mirador on this computer, not by this one. */
export const isAnotherMiradors = (label: unknown, hostLabel: string) => typeof label === "string" && label !== hostLabel;

/** A mount's source as the runtime lists it, a folder's with a slash at its end, as a path. */
export const withoutTrailingSlash = (path: string) => path.replace(/(.)\/+$/, "$1");

/** What a VM's first process prints once its agents can reach Mirador's sockets. */
export const VM_READY_LINE = "relays ready";

/**
 * A sandbox's VM: its name, labels and image, its memory, what of this computer is mounted in it, and its first process,
 * which is root there, able to mount the folders it guards.
 */
export interface VmPlan {
  name: string;
  labels: Record<string, string>;
  image: string;
  memory: string;
  mounts: Mount[];
  entry: string[];
}

/** An agent run in a sandbox's VM as an unprivileged user that can't regain root, in its folder, with only the environment it is given. */
export interface AgentInVm {
  vm: string;
  user: string;
  workingDirectory: string;
  environment: Record<string, string>;
  command: string[];
}

/**
 * What runs sandboxes' VMs on this computer, with no network of their own: Apple's `container` on a Mac, rootless Podman's
 * containers on Linux. A launcher for another computer takes its place without anything else of the sandboxes changing.
 */
export interface VmLauncher {
  /** Whether VMs run here, and why not where they don't. */
  availability(): SandboxAvailability;
  /** The runtime runs and the image of this agent kind and version is there, built where it was not, its progress told; the image. */
  prepare(agent: AgentImage, progress: (setup: SandboxSetup) => void): Promise<string>;
  /** Starts the VM, once its first process says it is ready; throws SandboxNotReady where it does not get there. */
  start(plan: VmPlan): Promise<void>;
  /** The process on this computer that runs the agent in its VM, its stdin, stdout and signals the agent's. */
  agentProcess(agent: AgentInVm): Pick<AgentLaunch, "command" | "environment">;
  /** Runs a command in the VM as this user, dropped as an agent is, reading `input`: its exit code and stdout. */
  runAsAgent(vm: string, user: string, command: string[], input: string, timeoutMs: number): Promise<{ exitCode: number; stdout: string }>;
  /** Stops the VM and removes it; throws where it is still there after. */
  stop(vm: string): Promise<void>;
  /** The VMs, running or not, that the host with this label started. */
  listMiradors(hostLabel: string): Promise<string[]>;
  /**
   * What the VMs of every other Mirador on this computer mount read and write, booting, running or just stopped: the
   * places another host's agents may write now. Throws SandboxNotReady where the runtime can't list them.
   */
  writtenByOtherMiradors(hostLabel: string): Promise<string[]>;
  /** Removes the VMs the host with this label left from a crash; starts nothing to look for them. */
  removeLeftovers(hostLabel: string): Promise<void>;
}
