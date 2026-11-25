import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { gzipSync } from "node:zlib";
import type { SandboxedHarness, SandboxSetup } from "../../shared/sandbox.ts";
import { lastLineOf, type ContainerCli } from "./container-cli.ts";
import { guardSource } from "./guard.ts";

export const RECIPE = join(import.meta.dir, "room-agent.Containerfile");

export const IMAGE_NAME = "mirador-room-agent";

/** The kernel download on the service's first start takes about a minute; the image build a few. */
const SERVICE_START_TIMEOUT_MS = 10 * 60_000;
const BUILD_TIMEOUT_MS = 30 * 60_000;

/** The agent an image is of: its kind and its version. */
export interface AgentImage {
  harness: SandboxedHarness;
  version: string;
}

/** Each kind's npm package, and the program it installs, which says its version once installed. */
const AGENT_PACKAGES: Record<SandboxedHarness, { npmPackage: string; program: string }> = {
  claude: { npmPackage: "@anthropic-ai/claude-code", program: "claude" },
  pi: { npmPackage: "@earendil-works/pi-coding-agent", program: "pi" },
};

/** The images of an agent kind, whatever their version, as their tags begin. */
export const imagesOfKind = (harness: SandboxedHarness) => `${IMAGE_NAME}:${harness}-`;

/** The image of one agent kind and version, Bun version, recipe and guard: another of any of them is another image. */
export async function imageTag({ harness, version }: AgentImage, bunVersion = Bun.version) {
  const madeOf = [await readFile(RECIPE, "utf8"), JSON.stringify(await guardSource())];
  const hash = createHash("sha256").update(madeOf.join("\0")).digest("hex").slice(0, 10);
  return `${imagesOfKind(harness)}${version}-bun-${bunVersion}-${hash}`;
}

/** What the recipe builds the image of this agent with, the guard's source as the recipe unpacks it. */
export async function buildArguments({ harness, version }: AgentImage) {
  const { npmPackage, program } = AGENT_PACKAGES[harness];
  const source = gzipSync(JSON.stringify(await guardSource())).toString("base64");
  const given = [`BUN_VERSION=${Bun.version}`, `AGENT_PACKAGE=${npmPackage}@${version}`, `AGENT_PROGRAM=${program}`, `GUARD_SOURCE=${source}`];
  return given.flatMap((argument) => ["--build-arg", argument]);
}

/** The step a build is on, as `container build --progress plain` says it, `#7 [stage 3/6] RUN …`, or `podman build`, `[1/2] STEP 3/6: RUN …`. */
export function buildStepIn(line: string): SandboxSetup["step"] | null {
  const match = /^#\d+ \[(?:[^\]\s]+ )?(\d+)\/(\d+)\]/.exec(line) ?? /^(?:\[\d+\/\d+\] )?STEP (\d+)\/(\d+): /.exec(line);
  return match ? { at: Number(match[1]), of: Number(match[2]) } : null;
}

/** The image each of the recipe's stages builds on, as its FROM lines name it. */
export const baseImageOf = (recipe: string) => /^FROM\s+(\S+)/m.exec(recipe)?.[1] ?? null;

/** The images `container image list --format json` lists, `[{ reference, descriptor, fullSize }]`, by their references. */
export function imageReferencesIn(listed: string): Set<string> {
  try {
    const images = JSON.parse(listed) as { reference?: unknown }[];
    return new Set(images.flatMap(({ reference }) => (typeof reference === "string" ? [reference] : [])));
  } catch {
    return new Set();
  }
}

const listImages = async (cli: ContainerCli) => imageReferencesIn((await cli.run(["image", "list", "--format", "json"])).output);

export class SetupFailed extends Error {}

export const mustRun = async (cli: ContainerCli, args: string[], options?: Parameters<ContainerCli["run"]>[1]) => {
  const result = await cli.run(args, options);
  if (result.exitCode !== 0) throw new SetupFailed(`${basename(cli.program)} ${args.slice(0, 2).join(" ")}: ${lastLineOf(result.output) || `exit ${result.exitCode}`}`);
  return result.output;
};

/** The container service runs, started with the kernel it downloads the first time, where it was not running. */
export async function startService(cli: ContainerCli, progress: (setup: SandboxSetup) => void) {
  if ((await cli.run(["system", "status"])).exitCode === 0) return;
  progress({ stage: "starting-service" });
  await mustRun(cli, ["system", "start", "--enable-kernel-install", "--timeout", "300"], { timeoutMs: SERVICE_START_TIMEOUT_MS });
}

/** Whether the service runs now, asked without starting it. */
export const serviceRuns = async (cli: ContainerCli) => (await cli.run(["system", "status"])).exitCode === 0;

/** Whether the builder runs now: `container builder status --format json` lists it as running, and says so in words when it isn't. */
export async function builderRuns(cli: ContainerCli) {
  const { output } = await cli.run(["builder", "status", "--format", "json"]);
  try {
    return (JSON.parse(output) as { status?: unknown }[]).some(({ status }) => status === "running");
  } catch {
    return false;
  }
}

/**
 * Builds the image on this Mac from the recipe, with an empty folder as the build's context, then removes the builder
 * it started, the images the build pulled for its stages, and the images of the agent's other versions built before.
 * A builder that ran before is left as it was, and so is every image that was there before, other agent kinds' too.
 * The builder's own image stays: `container` keeps it out of its image list, as its own.
 */
export async function buildImage(cli: ContainerCli, tag: string, agent: AgentImage, progress: (setup: SandboxSetup) => void) {
  progress({ stage: "building-image" });
  const builderRanBefore = await builderRuns(cli);
  const imagesBefore = await listImages(cli);
  const emptyContext = await mkdtemp(join(tmpdir(), "mirador-image-"));
  try {
    if (!builderRanBefore) await mustRun(cli, ["builder", "start"], { timeoutMs: SERVICE_START_TIMEOUT_MS });
    const build = ["build", "--platform", "linux/arm64", "--progress", "plain", "-f", RECIPE, ...(await buildArguments(agent)), "-t", tag, emptyContext];
    await mustRun(cli, build, {
      timeoutMs: BUILD_TIMEOUT_MS,
      onLine: (line) => {
        const step = buildStepIn(line);
        if (step) progress({ stage: "building-image", step });
      },
    });
  } finally {
    await rm(emptyContext, { recursive: true, force: true });
    if (!builderRanBefore) await removeBuilder(cli);
    await removeImagesPulledFor(cli, tag, imagesBefore);
  }
  await removeOtherVersions(cli, tag, agent);
}

async function removeImagesPulledFor(cli: ContainerCli, built: string, imagesBefore: Set<string>) {
  const pulled = [...(await listImages(cli))].filter((name) => !imagesBefore.has(name) && name !== built);
  if (pulled.length > 0) await cli.run(["image", "delete", ...pulled]);
}

async function removeBuilder(cli: ContainerCli) {
  await cli.run(["builder", "stop"]);
  await cli.run(["builder", "delete"]);
}

async function removeOtherVersions(cli: ContainerCli, kept: string, { harness }: AgentImage) {
  const others = [...(await listImages(cli))].filter((name) => name.split("/").at(-1)!.startsWith(imagesOfKind(harness)) && !name.endsWith(kept));
  if (others.length > 0) await cli.run(["image", "delete", ...others]);
}

export const imageExists = async (cli: ContainerCli, tag: string) => (await cli.run(["image", "inspect", tag])).exitCode === 0;
