import type { SandboxAvailability, SandboxSetup } from "../shared/sandbox.ts";
import type { AgentImage } from "../host/sandbox/image.ts";
import { SandboxNotReady, type AgentInVm, type VmPlan, type VmLauncher } from "../host/sandbox/vm-launcher.ts";
import { runHere } from "./in-vm-here.ts";

/** A launcher of rooms' VMs that starts nothing: it notes what it was asked, and fails where a test says. */
export class FakeVmLauncher implements VmLauncher {
  readonly firstProcessUser = "root";
  readonly started: VmPlan[] = [];
  readonly stopped: string[] = [];
  readonly agents: AgentInVm[] = [];
  readonly ranAsAgent: string[][] = [];
  /** A command run as the agent user gives this instead, where it gives anything. */
  ranAsAgentGives: ((command: string[]) => { exitCode: number; stdout: string } | null) | null = null;
  prepareFails: string | null = null;
  startFails: string | null = null;
  /** A start waits for this before it has started its VM. */
  starting: Promise<void> = Promise.resolve();
  available: SandboxAvailability = { available: true, kind: "apple-container" };

  availability() {
    return this.available;
  }

  readonly prepared: AgentImage[] = [];

  async prepare(agent: AgentImage, progress: (setup: SandboxSetup) => void) {
    this.prepared.push(agent);
    progress({ stage: "building-image" });
    if (this.prepareFails) throw new Error(this.prepareFails);
    return `fake-image:${agent.harness}-${agent.version}`;
  }

  async start(plan: VmPlan) {
    await this.starting;
    if (this.startFails) throw new SandboxNotReady({ kind: "could-not-start", cause: this.startFails });
    this.started.push(plan);
  }

  agentProcess(agent: AgentInVm) {
    this.agents.push(agent);
    return { command: ["/fake/launcher/runs/nothing"], environment: {} };
  }

  async runAsAgent(vm: string, _user: string, command: string[], input: string) {
    this.ranAsAgent.push(command);
    if (!this.started.some(({ name }) => name === vm) || this.stopped.includes(vm)) return { exitCode: 1, stdout: "" };
    return this.ranAsAgentGives?.(command) ?? (await runHere(command, input));
  }

  /** The VMs started and not stopped since, as a runtime would list them. */
  running() {
    const last = (names: string[], name: string) => names.filter((each) => each === name).length;
    const started = this.started.map(({ name }) => name);
    return [...new Set(started)].filter((name) => last(started, name) > last(this.stoppedOnceStarted, name));
  }

  private readonly stoppedOnceStarted: string[] = [];

  async stop(vm: string) {
    this.stopped.push(vm);
    if (this.running().includes(vm)) this.stoppedOnceStarted.push(vm);
  }

  async listMiradors() {
    return [];
  }

  async removeLeftovers() {}
}
