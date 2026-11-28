import type { ContainerRun, ContainerRunOptions } from "../host/sandbox/container-cli.ts";
import { DEBIAN_IMAGE, done, failed, FakePodmanCli } from "./fake-podman-cli.ts";

/** The label `docker ps --filter label=KEY[=VALUE]` keeps containers by. */
const labelFilterOf = (args: string[]) => {
  const [key, value] = args[args.indexOf("--filter") + 1]!.replace(/^label=/, "").split("=");
  return (labels: Record<string, string>) => key! in labels && (value === undefined || labels[key!] === value);
};

/** The label `{{.Label "KEY"}}` in a `--format` template prints. */
const labelPrintedBy = (format: string) => /\{\{\.Label "([^"]+)"\}\}/.exec(format)?.[1] ?? null;

/**
 * Rootless `docker`, as far as the sandboxes use it. Its runs, logs, execs, pulls and removals are Podman's, whose
 * command line Docker shares; it builds with BuildKit, names the images it builds as tagged, and lists and inspects as
 * Docker does.
 */
export class FakeDockerCli extends FakePodmanCli {
  override readonly program = "/fake/bin/docker";

  protected override async answer(args: string[], options: ContainerRunOptions): Promise<ContainerRun> {
    const [command, sub] = args;
    if (command === "build") return this.buildWithBuildKit(args, options);
    if (command === "image" && sub === "inspect") return this.inspectImage(args.at(-1)!);
    if (command === "images") return done([...this.images, "<none>:<none>"].map((name) => `${name}\n`).join(""));
    if (command === "ps") return this.list(args);
    if (command === "container" && sub === "inspect") return this.containers.has(args[2]!) ? done(JSON.stringify([{ Name: `/${args[2]}` }])) : failed(`Error response from daemon: No such container: ${args[2]}`, 1);
    return super.answer(args, options);
  }

  private buildWithBuildKit(args: string[], { onLine }: ContainerRunOptions) {
    onLine?.("#0 building with \"default\" instance using docker driver");
    onLine?.(`#5 [1/${this.buildSteps}] FROM ${DEBIAN_IMAGE}`);
    this.images.add(DEBIAN_IMAGE);
    Array.from({ length: this.buildSteps - 1 }, (_, index) => index + 2).forEach((step) => onLine?.(`#${step + 5} [${step}/${this.buildSteps}] RUN something`));
    onLine?.("#14 exporting to image");
    this.images.add(args[args.indexOf("-t") + 1]!);
    return done();
  }

  private inspectImage(name: string) {
    if (!this.images.has(name)) return failed(`Error response from daemon: No such image: ${name}`, 1);
    return done(JSON.stringify([{ Id: this.ids.get(name) ?? `sha256:${"0".repeat(64)}` }]));
  }

  private list(args: string[]) {
    const kept = labelFilterOf(args);
    const label = labelPrintedBy(args[args.indexOf("--format") + 1]!);
    const lines = [...this.containers].filter(([, labels]) => kept(labels)).map(([name, labels]) => (label === null ? name : `${name}\t${labels[label] ?? "<no value>"}`));
    return done(lines.map((line) => `${line}\n`).join(""));
  }
}
