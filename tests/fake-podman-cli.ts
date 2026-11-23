import type { ContainerCli, ContainerRun, ContainerRunOptions } from "../host/sandbox/container-cli.ts";
import { runHere } from "./in-vm-here.ts";

const done = (output = ""): ContainerRun => ({ exitCode: 0, output, stdout: output });
const failed = (output: string, exitCode = 125): ContainerRun => ({ exitCode, output, stdout: "" });

const valueAfter = (args: string[], flag: string) => args[args.indexOf(flag) + 1]!;

/** The image the recipe builds on, which a build pulls where it is not there. */
export const NODE_IMAGE = "docker.io/library/node:22-bookworm-slim";

/** Podman as it names an image built here. */
const localName = (tag: string) => (tag.includes("/") ? tag : `localhost/${tag}`);

/** Rootless `podman`, as far as the sandboxes use it: images and containers, all in memory. */
export class FakePodmanCli implements ContainerCli {
  readonly program = "/fake/bin/podman";
  readonly calls: string[][] = [];
  readonly images = new Set<string>(["docker.io/library/postgres:16"]);
  readonly containers = new Map<string, Record<string, string>>();
  /** A run whose arguments this matches fails with what it gives. */
  failing: (args: string[]) => string | null = () => null;
  /** What a container's first process says before it ends, where it ends at once and is removed. */
  endsAtStart: string | null = null;
  /** Containers that `rm` leaves where they are. */
  readonly staying = new Set<string>();
  buildSteps = 8;

  /** The calls of this subcommand. */
  callsOf(command: string) {
    return this.calls.filter(([first]) => first === command);
  }

  async run(args: string[], options: ContainerRunOptions = {}): Promise<ContainerRun> {
    this.calls.push(args);
    const failure = this.failing(args);
    if (failure !== null) return failed(failure);
    const [command, sub] = args;
    if (command === "build") return this.build(args, options);
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
    return failed(`unknown command ${command}`);
  }

  private build(args: string[], { onLine }: ContainerRunOptions) {
    onLine?.(`STEP 1/${this.buildSteps}: FROM ${NODE_IMAGE}`);
    this.images.add(NODE_IMAGE);
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

  private readonly ending = new Map<string, string>();

  private start(args: string[]) {
    const name = valueAfter(args, "--name");
    const labels = Object.fromEntries(args.flatMap((arg, index) => (args[index - 1] === "--label" ? [arg.split("=") as [string, string]] : [])));
    this.containers.set(name, labels);
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
      .forEach((name) => this.containers.delete(name));
    return done();
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
