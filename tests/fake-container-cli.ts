import type { ContainerCli, ContainerRun, ContainerRunOptions } from "../host/sandbox/container-cli.ts";
import { runHere } from "./in-vm-here.ts";

const done = (output = ""): ContainerRun => ({ exitCode: 0, output, stdout: output });
const failed = (output: string): ContainerRun => ({ exitCode: 1, output, stdout: "" });

const valueAfter = (args: string[], flag: string) => args[args.indexOf(flag) + 1]!;

/** The images a build of the recipe pulls for its stages. */
export const BASE_IMAGES = ["docker.io/library/node:22-bookworm-slim", "docker.io/oven/bun:1.4.4-slim"];

/** Apple's `container`, as far as the sandboxes use it: a service, a builder, images and VMs, all in memory. */
export class FakeContainerCli implements ContainerCli {
  readonly program = "/fake/bin/container";
  readonly calls: string[][] = [];
  serviceRunning = false;
  builderRunning = false;
  readonly images = new Set<string>(["docker.io/library/node:22-bookworm-slim"]);
  readonly vms = new Map<string, Record<string, string>>();
  /** A run whose arguments this matches fails with what it gives. */
  failing: (args: string[]) => string | null = () => null;
  buildSteps = 3;

  callsOf(command: string) {
    return this.calls.filter(([first]) => first === command);
  }

  async run(args: string[], options: ContainerRunOptions = {}): Promise<ContainerRun> {
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
      args.slice(1).filter((arg) => !arg.startsWith("-")).forEach((name) => this.vms.delete(name));
      return done();
    }
    if (command === "exec") return this.exec(args, options);
    if (command === "list") return done(JSON.stringify([...this.vms].map(([id, labels]) => ({ configuration: { id, labels }, status: "running" }))));
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
    if (sub === "inspect") return names.every((name) => this.images.has(name)) ? done("[]") : failed("image not found");
    if (sub === "delete") names.forEach((name) => this.images.delete(name));
    return done();
  }

  private start(args: string[]) {
    const name = valueAfter(args, "--name");
    const labels = Object.fromEntries(args.flatMap((arg, index) => (args[index - 1] === "--label" ? [arg.split("=") as [string, string]] : [])));
    this.vms.set(name, labels);
    return done(name);
  }
}
