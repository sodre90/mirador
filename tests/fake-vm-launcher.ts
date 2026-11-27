import type { SandboxAvailability, SandboxSetup } from "../shared/sandbox.ts";
import { pulledOrHere } from "../host/sandbox/image.ts";
import { SandboxNotReady, type AgentInVm, type ThrowawayRun, type VmPlan, type VmLauncher } from "../host/sandbox/vm-launcher.ts";
import { runHere } from "./in-vm-here.ts";

/** A launcher of rooms' VMs that starts nothing: it notes what it was asked, and fails where a test says. */
export class FakeVmLauncher implements VmLauncher {
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

  /** The base image built, each time it was. */
  readonly basesBuilt: string[] = [];
  /** The throwaway containers run, the installers of tools among them. */
  readonly ranOnce: ThrowawayRun[] = [];
  /** A throwaway container's run waits for this. */
  runningOnce: Promise<void> = Promise.resolve();
  /** A throwaway container whose arguments name this fails, saying so. */
  runOnceFailsFor: string | null = null;

  async prepare() {
    if (this.prepareFails) throw new Error(this.prepareFails);
  }

  async defaultBase(progress: (setup: SandboxSetup) => void) {
    const image = "fake-base:1";
    if (!this.basesBuilt.includes(image)) progress({ stage: "building-image" });
    this.basesBuilt.push(image);
    return { image, path: null };
  }

  /** What a registry has, by full name: each image's content. */
  readonly registry = new Map<string, string>();
  /** The images here, by full name: each one's content. */
  readonly imagesHere = new Map<string, string>();
  /** The owner's base images pulled, by full name, each time one was. */
  readonly pulled: string[] = [];
  /** A pull of an owner's base image waits for this. */
  pulling: Promise<void> = Promise.resolve();
  /** Tells how far the pull under way got, as a runtime would. */
  pullMoves: (setup: SandboxSetup) => void = () => {};

  async ownBase(name: string, progress: (setup: SandboxSetup) => void) {
    const pull = async () => {
      this.pulled.push(name);
      this.pullMoves = progress;
      await this.pulling;
      const content = this.registry.get(name);
      if (content) this.imagesHere.set(name, content);
      return content ? { exitCode: 0, output: "" } : { exitCode: 1, output: `Error: ${name} is not in the registry` };
    };
    const here = async () => {
      const content = this.imagesHere.get(name);
      return content ? { image: `runs-${name}`, content } : null;
    };
    return pulledOrHere(name, pull, here);
  }

  /** What a check of a base image says, by the image it runs: usable, with a PATH, where it isn't given. */
  checkSays = (_image: string) => ({ exitCode: 0, output: "mirador-base-check\nPATH=/own/bin:/usr/bin:/bin" });

  /** The checks of owners' base images run, by the image each ran. */
  checked() {
    return this.ranOnce.filter(isCheck).map(({ image }) => image);
  }

  /** What a check of an agent's program on an owner's base image says, by the image it runs: that it runs, where it isn't given. */
  agentCheckSays = (_image: string) => ({ exitCode: 0, output: "mirador-agent-check\nagent-runs" });

  async runOnce(run: ThrowawayRun) {
    this.ranOnce.push(run);
    await this.runningOnce;
    if (isCheck(run)) return this.checkSays(run.image);
    if (isAgentCheck(run)) return this.agentCheckSays(run.image);
    const fails = this.runOnceFailsFor !== null && run.args.join(" ").includes(this.runOnceFailsFor);
    return fails ? { exitCode: 1, output: `npm error 404 ${this.runOnceFailsFor} is not in this registry` } : { exitCode: 0, output: "" };
  }

  /** What the throwaway containers installed: each npm package at its version, `@anthropic-ai/claude-code@2.1.330`, the guard or Node.js. */
  installed() {
    return this.ranOnce.filter((run) => !isCheck(run) && !isAgentCheck(run)).map(({ args }) => {
      const script = args.join(" ");
      return /--loglevel=error ([^\s;]+)/.exec(script)?.[1] ?? (script.includes("/src/build.sh") ? "guard" : "node");
    });
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

  /** What other Miradors' VMs mount read and write, by how many times the launcher was asked before. */
  otherMiradorsWrite: (askedBefore: number) => string[] = () => [];
  private askedForOtherMiradors = 0;

  async writtenByOtherMiradors() {
    return this.otherMiradorsWrite(this.askedForOtherMiradors++);
  }

  async removeLeftovers() {}
}

const isCheck = ({ args }: ThrowawayRun) => args.join(" ").includes("mirador-base-check");
const isAgentCheck = ({ args }: ThrowawayRun) => args.join(" ").includes("mirador-agent-check");
