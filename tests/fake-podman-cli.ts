import type { ContainerCli, ContainerRun, ContainerRunOptions } from "../host/sandbox/container-cli.ts";
import { agentCheckFinding, checkFinding, imageOfRun, isAgentCheck, isBaseCheck } from "./fake-container-cli.ts";
import { runHere } from "./in-vm-here.ts";
import { mountsOfRun } from "./guard-told.ts";

export const done = (output = ""): ContainerRun => ({ exitCode: 0, output, stdout: output });
export const failed = (output: string, exitCode = 125): ContainerRun => ({ exitCode, output, stdout: "" });

const valueAfter = (args: string[], flag: string) => args[args.indexOf(flag) + 1]!;

/** The image the recipe builds on, which a build pulls where it is not there. */
export const DEBIAN_IMAGE = "docker.io/library/debian:bookworm-slim";

/** A throwaway run, which installs a tool: `podman run --rm` that runs to its end, not a sandbox started detached. */
const isThrowaway = ([command, ...args]: string[]) => command === "run" && !args.includes("--detach");

/** Podman as it names an image built here. */
const localName = (tag: string) => (tag.includes("/") ? tag : `localhost/${tag}`);

/** Rootless `podman`, as far as the sandboxes use it: images and containers, all in memory. */
export class FakePodmanCli implements ContainerCli {
  readonly program: string = "/fake/bin/podman";
  readonly calls: string[][] = [];
  readonly images = new Set<string>(["docker.io/library/postgres:16", "docker.io/library/node:22-bookworm-slim", "docker.io/library/alpine:3.22"]);
  readonly containers = new Map<string, Record<string, string>>();
  /** What each container mounts, as `podman inspect` tells it. */
  private readonly mounts = new Map<string, { Source: string; RW: boolean }[]>();
  /** A run whose arguments this matches fails with what it gives. */
  failing: (args: string[]) => string | null = () => null;
  /** What a container's first process says before it ends, where it ends at once and is removed. */
  endsAtStart: string | null = null;
  /** Containers that `rm` leaves where they are. */
  readonly staying = new Set<string>();
  buildSteps = 8;
  /** What the registry has, by full name: each image's ID once pulled. */
  readonly registry = new Map<string, string>();
  /** The ID of each image pulled here, by its name. */
  protected readonly ids = new Map<string, string>();
  /** What a check of an owner's base image says, by the image it runs. */
  checkSays: (image: string) => ContainerRun = () => checkFinding("/own/bin:/usr/bin:/bin");
  /** What a check of an agent's program on an owner's base image says, by the image it runs. */
  agentCheckSays: (image: string) => ContainerRun = () => agentCheckFinding();

  /** The calls of this subcommand. */
  callsOf(command: string) {
    return this.calls.filter(([first]) => first === command);
  }

  /** The throwaway runs, apart from `calls`: what the tools' installers ran. */
  readonly ranOnce: string[][] = [];

  async run(args: string[], options: ContainerRunOptions = {}): Promise<ContainerRun> {
    if (isThrowaway(args)) return this.runOnce(args);
    this.calls.push(args);
    const failure = this.failing(args);
    if (failure !== null) return failed(failure);
    return this.answer(args, options);
  }

  /** What Podman answers a call that is not a throwaway run, nor one set to fail. */
  protected async answer(args: string[], options: ContainerRunOptions): Promise<ContainerRun> {
    const [command, sub] = args;
    if (command === "build") return this.build(args, options);
    if (command === "pull") return this.pull(args.at(-1)!);
    if (command === "image" && sub === "inspect") return this.ids.has(args.at(-1)!) ? done(JSON.stringify([{ Id: this.ids.get(args.at(-1)!) }])) : failed(`Error: ${args.at(-1)}: image not known`);
    if (command === "image" && sub === "exists") return this.images.has(localName(args[2]!)) || this.images.has(args[2]!) ? done() : failed("", 1);
    if (command === "image" && sub === "rm") {
      args.slice(2).forEach((name) => this.images.delete(name));
      return done();
    }
    if (command === "images") return this.listImages();
    if (command === "run") return this.start(args);
    if (command === "logs") return this.logs(args.at(-1)!);
    if (command === "rm") return this.remove(args);
    if (command === "container" && sub === "exists") return this.containers.has(args[2]!) ? done() : failed("", 1);
    if (command === "exec") return this.exec(args, options);
    if (command === "ps") return done(JSON.stringify([...this.containers].map(([name, labels]) => ({ Names: [name], Labels: labels }))));
    if (command === "inspect") return this.inspect(args.slice(1).filter((arg, index, rest) => !arg.startsWith("-") && !rest[index - 1]?.startsWith("--")));
    return failed(`unknown command ${command}`);
  }

  private build(args: string[], { onLine }: ContainerRunOptions) {
    onLine?.(`STEP 1/${this.buildSteps}: FROM ${DEBIAN_IMAGE}`);
    this.images.add(DEBIAN_IMAGE);
    Array.from({ length: this.buildSteps - 1 }, (_, index) => index + 2).forEach((step) => onLine?.(`STEP ${step}/${this.buildSteps}: RUN something`));
    onLine?.("COMMIT");
    this.images.add(localName(valueAfter(args, "-t")));
    return done();
  }

  /** Each image by its names, and one a build left without a name, as Podman lists it. */
  private listImages() {
    const listed: { Names: string[] | null }[] = [...[...this.images].map((name) => ({ Names: [name] })), { Names: null }];
    return done(JSON.stringify(listed));
  }

  private pull(name: string) {
    const id = this.registry.get(name);
    if (!id) return failed(`Error: initializing source docker://${name}: reading manifest: manifest unknown`);
    this.images.add(name);
    this.ids.set(name, id);
    return done(id);
  }

  private runOnce(args: string[]) {
    this.ranOnce.push(args);
    const failure = this.failing(args);
    if (failure !== null) return failed(failure);
    if (isAgentCheck(args)) return this.agentCheckSays(imageOfRun(args));
    return isBaseCheck(args) ? this.checkSays(imageOfRun(args)) : done();
  }

  private readonly ending = new Map<string, string>();

  private start(args: string[]) {
    const name = valueAfter(args, "--name");
    const labels = Object.fromEntries(args.flatMap((arg, index) => (args[index - 1] === "--label" ? [arg.split("=") as [string, string]] : [])));
    this.containers.set(name, labels);
    this.mounts.set(
      name,
      mountsOfRun(args).map(({ source, readOnly }) => ({ Source: source, RW: !readOnly })),
    );
    if (this.endsAtStart !== null) this.ending.set(name, this.endsAtStart);
    return done(name);
  }

  /** What a container's first process said; one that ends at start says its last, then is gone with its logs. */
  private logs(name: string) {
    const lastSaid = this.ending.get(name);
    if (lastSaid !== undefined) {
      this.ending.delete(name);
      this.containers.delete(name);
      return done(lastSaid);
    }
    return this.containers.has(name) ? done("relays ready\n") : failed(`Error: no container with name or ID "${name}" found: no such container`);
  }

  private remove(args: string[]) {
    args
      .slice(1)
      .filter((arg, index, rest) => !arg.startsWith("-") && rest[index - 1] !== "--time")
      .filter((name) => !this.staying.has(name))
      .forEach((name) => this.containers.delete(name) && this.mounts.delete(name));
    return done();
  }

  /** As podman does, the containers it finds, and a failure where it misses one. */
  private inspect(names: string[]) {
    if (names.length === 0) return failed("Error: no names or ids specified");
    const found = names.filter((name) => this.containers.has(name)).map((name) => ({ Name: name, Config: { Labels: this.containers.get(name) }, Mounts: this.mounts.get(name) }));
    const printed = JSON.stringify(found);
    return found.length === names.length ? done(printed) : { exitCode: 125, output: `${printed}\nError: no such container`, stdout: printed };
  }

  /** `exec -i --user U [-w DIR] [-e …]… CONTAINER COMMAND…`: the command, run on this computer as it would run in the sandbox. */
  private async exec(args: string[], { input = "" }: ContainerRunOptions) {
    let index = 1;
    while (args[index]!.startsWith("-")) index += args[index] === "-i" ? 1 : 2;
    const container = args[index]!;
    if (!this.containers.has(container)) return failed(`Error: no container with name or ID "${container}" found: no such container`);
    return runHere(args.slice(index + 1), input);
  }
}
