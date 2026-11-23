import { HostProblemError } from "../../shared/host-problems.ts";
import type { SandboxAvailability, SandboxNotReadyWhy, SandboxSetup } from "../../shared/sandbox.ts";
import type { AgentLaunch } from "../acp/harness.ts";
import type { Mount } from "./workspace-mounts.ts";

/** Why a room's agent can't run in its sandbox: the turn fails with it, and never runs on this computer instead. */
export class SandboxNotReady extends HostProblemError {
  constructor(readonly why: SandboxNotReadyWhy) {
    super({ code: "sandbox-not-ready", why });
  }
}

/** The labels Mirador gives its VMs: the host that started one, told apart by its data folder, and the room it is for. */
export const HOST_LABEL = "mirador.host";
export const ROOM_LABEL = "mirador.room";

/** What a VM's first process prints once its agents can reach Mirador's sockets. */
export const VM_READY_LINE = "relays ready";

/** A room's VM: its name, labels and image, its memory, what of this computer it sees, and its first process, run as root. */
export interface RoomVmPlan {
  name: string;
  labels: Record<string, string>;
  image: string;
  memory: string;
  mounts: Mount[];
  entry: string[];
}

/** An agent run in a room's VM as an unprivileged user that can't regain root, in its folder, with only the environment it is given. */
export interface AgentInVm {
  vm: string;
  user: string;
  workingDirectory: string;
  environment: Record<string, string>;
  command: string[];
}

/**
 * What runs rooms' VMs on this computer, with no network of their own: Apple's `container` on a Mac. A launcher for
 * another computer takes its place without anything else of the sandboxes changing.
 */
export interface VmLauncher {
  /** Whether VMs run here, and why not where they don't. */
  availability(): SandboxAvailability;
  /** The runtime runs and the image of this Claude Code version is there, built where it was not, its progress told; the image. */
  prepare(claudeCodeVersion: string, progress: (setup: SandboxSetup) => void): Promise<string>;
  /** Starts the VM, once its first process says it is ready; throws SandboxNotReady where it does not get there. */
  start(plan: RoomVmPlan): Promise<void>;
  /** The process on this computer that runs the agent in its VM, its stdin, stdout and signals the agent's. */
  agentProcess(agent: AgentInVm): Pick<AgentLaunch, "command" | "environment">;
  /** Runs a command in the VM as this user, dropped as an agent is, reading `input`: its exit code and stdout. */
  runAsAgent(vm: string, user: string, command: string[], input: string, timeoutMs: number): Promise<{ exitCode: number; stdout: string }>;
  /** Stops the VM and removes it; throws where it is still there after. */
  stop(vm: string): Promise<void>;
  /** The VMs, running or not, that the host with this label started. */
  listMiradors(hostLabel: string): Promise<string[]>;
  /** Removes the VMs the host with this label left from a crash; starts nothing to look for them. */
  removeLeftovers(hostLabel: string): Promise<void>;
}
