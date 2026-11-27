import type { ContainerCli, ContainerRun, ContainerRunOptions } from "../host/sandbox/container-cli.ts";
import { runHere } from "./in-vm-here.ts";

const done = (output = ""): ContainerRun => ({ exitCode: 0, output, stdout: output });
const failed = (output: string): ContainerRun => ({ exitCode: 1, output, stdout: "" });

const valueAfter = (args: string[], flag: string) => args[args.indexOf(flag) + 1]!;

const isThrowaway = ([command, ...args]: string[]) => command === "run" && !args.includes("--detach");

/** Whether a throwaway run is the check of an owner's base image. */
export const isBaseCheck = (args: string[]) => args.join(" ").includes("mirador-base-check");

/** What a check of a base image that has all the agents need says: that it started, and the image's PATH. */
export const checkFinding = (path: string) => done(`mirador-base-check\nPATH=${path}`);

/** Whether a throwaway run is the check that an agent kind's own program runs on an owner's base image. */
export const isAgentCheck = (args: string[]) => args.join(" ").includes("mirador-agent-check");

/** What a check of an agent's program says where it runs, or what it said as it failed. */
export const agentCheckFinding = (failed?: string) => done(`mirador-agent-check\n${failed === undefined ? "agent-runs" : `agent-fails ${failed}`}`);

/** The image a throwaway run runs: the one after its program. */
export const imageOfRun = (args: string[]) => args[args.indexOf("--entrypoint") + 2]!;

/** Each `-v source:target[:ro]` of a run, as `container list` shows a folder's: its source with a slash at its end. */
const mountsOf = (args: string[]) =>
  args.flatMap((arg, index) => {
    if (args[index - 1] !== "-v") return [];
    const [source, , access] = arg.split(":");
    return [{ source: `${source}/`, options: access === "ro" ? ["ro"] : [] }];
  });

/** The images a build of the base recipe pulls. */
export const BASE_IMAGES = ["docker.io/library/debian:bookworm-slim"];

/** Apple's `container`, as far as the sandboxes use it: a service, a builder, images and VMs, all in memory. */
export class FakeContainerCli implements ContainerCli {
  readonly program = "/fake/bin/container";
  readonly calls: string[][] = [];
  serviceRunning = false;
  builderRunning = false;
  readonly images = new Set<string>(["docker.io/library/node:22-bookworm-slim"]);
  readonly vms = new Map<string, Record<string, string>>();
  /** What each VM mounts, as `container list` tells it. */
  private readonly mounts = new Map<string, { source: string; options: string[] }[]>();
  /** A run whose arguments this matches fails with what it gives. */
  failing: (args: string[]) => string | null = () => null;
  buildSteps = 3;
  /** What the registry has, by full name: each image's index digest. */
  readonly registry = new Map<string, string>();
  /** The index digest of each image pulled here. */
  private readonly digests = new Map<string, string>();
  /** What a check of an owner's base image says, by the image it runs. */
  checkSays: (image: string) => ContainerRun = () => checkFinding("/own/bin:/usr/bin:/bin");
  /** What a check of an agent's program on an owner's base image says, by the image it runs. */
  agentCheckSays: (image: string) => ContainerRun = () => agentCheckFinding();

  callsOf(command: string) {
    return this.calls.filter(([first]) => first === command);
  }

  async run(args: string[], options: ContainerRunOptions = {}): Promise<ContainerRun> {
    if (isThrowaway(args)) return this.runOnce(args);
    this.calls.push(args);
    const failure = this.failing(args);
    if (failure !== null) return failed(failure);
    const [command, sub] = args;
    if (command === "system" && sub === "status") return this.serviceRunning ? done("apiserver is running") : failed("apiserver is not running");
    if (command === "system" && sub === "start") return this.startService();
    if (command === "builder") return this.builder(sub!);
    if (command === "build") return this.build(args, options);
    if (command === "image") return this.image(sub!, args.slice(2));
    if (command === "run") return this.start(args);
    if (command === "logs") return this.vms.has(args.at(-1)!) ? done("relays ready\n") : failed("not found");
    if (command === "stop" || command === "delete") {
      args
        .slice(1)
        .filter((arg) => !arg.startsWith("-"))
        .forEach((name) => this.vms.delete(name) && this.mounts.delete(name));
      return done();
    }
    if (command === "exec") return this.exec(args, options);
    if (command === "list") return done(JSON.stringify([...this.vms].map(([id, labels]) => ({ configuration: { id, labels, mounts: this.mounts.get(id) ?? [] }, status: "running" }))));
    return failed(`unknown command ${command}`);
  }

  /** `exec -i --user U VM COMMAND…`: the command, run on this computer as it would run in the VM. */
  private async exec(args: string[], { input = "" }: ContainerRunOptions) {
    const vm = args[args.indexOf("--user") + 2]!;
    if (!this.vms.has(vm)) return failed(`container ${vm} not found`);
    return runHere(args.slice(args.indexOf("--user") + 3), input);
  }

  private startService() {
    this.serviceRunning = true;
    return done();
  }

  private builder(sub: string) {
    if (sub === "status") return done(this.builderRunning ? JSON.stringify([{ status: "running", configuration: { id: "buildkit" } }]) : "builder is not running");
    if (sub === "start") this.builderRunning = true;
    if (sub === "stop") this.builderRunning = false;
    return done();
  }

  private build(args: string[], { onLine }: ContainerRunOptions) {
    if (!this.builderRunning) return failed("the builder is not running");
    Array.from({ length: this.buildSteps }, (_, index) => index + 1).forEach((step) => onLine?.(`#${step + 4} [stage-1 ${step}/${this.buildSteps}] RUN something`));
    BASE_IMAGES.forEach((image) => this.images.add(image));
    this.images.add(valueAfter(args, "-t"));
    return done();
  }

  private image(sub: string, names: string[]) {
    if (sub === "list") return done(JSON.stringify([...this.images].map((reference) => ({ reference }))));
    if (sub === "pull") return this.pull(names.at(-1)!);
    if (sub === "inspect") return names.every((name) => this.images.has(name)) ? done(JSON.stringify(names.map((name) => ({ name, index: { digest: this.digests.get(name) ?? `sha256:${"0".repeat(64)}` } })))) : failed("image not found");
    if (sub === "delete") names.forEach((name) => this.images.delete(name));
    return done();
  }

  /** The throwaway containers run, installers of tools among them, by their arguments: kept apart from the calls, as VMs' runs are what those tell. */
  readonly ranOnce: string[][] = [];

  private pull(name: string) {
    const digest = this.registry.get(name);
    if (!digest) return failed(`Error: HTTP request to ${name} failed with response: 404 Not Found`);
    this.images.add(name);
    this.digests.set(name, digest);
    return done();
  }

  private runOnce(args: string[]) {
    this.ranOnce.push(args);
    const failure = this.failing(args);
    if (failure !== null) return failed(failure);
    if (isAgentCheck(args)) return this.agentCheckSays(imageOfRun(args));
    return isBaseCheck(args) ? this.checkSays(imageOfRun(args)) : done();
  }

  private start(args: string[]) {
    const name = valueAfter(args, "--name");
    const labels = Object.fromEntries(args.flatMap((arg, index) => (args[index - 1] === "--label" ? [arg.split("=") as [string, string]] : [])));
    this.vms.set(name, labels);
    this.mounts.set(name, mountsOf(args));
    return done(name);
  }
}
