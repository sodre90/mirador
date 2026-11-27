import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { SandboxSetup } from "../../shared/sandbox.ts";
import { lastLineOf, type ContainerCli } from "./container-cli.ts";
import type { OwnBase } from "./vm-launcher.ts";

export const BASE_RECIPE = join(import.meta.dir, "base.Containerfile");

export const BASE_IMAGE_NAME = "mirador-sandbox-base";

/** The PATH of Debian's images, which Mirador's base keeps. */
export const DEFAULT_BASE_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

/** The kernel download on the service's first start takes about a minute; the image build a few. */
const SERVICE_START_TIMEOUT_MS = 10 * 60_000;
export const BUILD_TIMEOUT_MS = 30 * 60_000;

/** Mirador's base image, by its recipe: another recipe is another image. */
export async function defaultBaseTag() {
  const hash = createHash("sha256").update(await readFile(BASE_RECIPE, "utf8")).digest("hex").slice(0, 10);
  return `${BASE_IMAGE_NAME}:${hash}`;
}

/** Whether an image of this name, as a runtime lists it, `localhost/…` on Podman, is a base Mirador built, of any recipe. */
export const isMiradorsBase = (name: string) => name.split("/").at(-1)!.startsWith(`${BASE_IMAGE_NAME}:`);

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

export const listImages = async (cli: ContainerCli) => imageReferencesIn((await cli.run(["image", "list", "--format", "json"])).output);

export class SetupFailed extends Error {}

/** The owner's base image could be neither pulled nor found here: what the pull said last. */
export class BaseNotPulled extends Error {}

export const PULL_TIMEOUT_MS = 30 * 60_000;

/**
 * The owner's base image, pulled afresh, unless it names its digest and is here already, and else the one here, where the
 * pull fails, as it does offline or for an image built here. Throws BaseNotPulled where there is none here.
 */
export async function pulledOrHere(name: string, pull: () => Promise<{ exitCode: number; output: string }>, here: () => Promise<OwnBase | null>): Promise<OwnBase> {
  const pinned = name.includes("@");
  const pinnedHere = pinned ? await here() : null;
  if (pinnedHere) return pinnedHere;
  const pulled = await pull();
  const found = await here();
  if (!found) throw new BaseNotPulled(lastLineOf(pulled.output) || `exit ${pulled.exitCode}`);
  return found;
}

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

/** Each line of a build that says its step, told as progress. */
export const buildProgress = (progress: (setup: SandboxSetup) => void) => (line: string) => {
  const step = buildStepIn(line);
  if (step) progress({ stage: "building-image", step });
};

/**
 * Builds Mirador's base image on this Mac from its recipe, with an empty folder as the build's context, then removes the
 * builder it started, the image it builds on where the build pulled it, and the bases of other recipes built before. A
 * builder that ran before is left as it was, and so is every other image, pulled meanwhile too, as an owner's base image
 * may be. The builder's own image stays: `container` keeps it out of its image list, as its own.
 */
export async function buildImage(cli: ContainerCli, tag: string, progress: (setup: SandboxSetup) => void) {
  progress({ stage: "building-image" });
  const builderRanBefore = await builderRuns(cli);
  const base = baseImageOf(await readFile(BASE_RECIPE, "utf8"));
  const baseWasThere = base !== null && (await listImages(cli)).has(base);
  const emptyContext = await mkdtemp(join(tmpdir(), "mirador-image-"));
  try {
    if (!builderRanBefore) await mustRun(cli, ["builder", "start"], { timeoutMs: SERVICE_START_TIMEOUT_MS });
    const build = ["build", "--platform", "linux/arm64", "--progress", "plain", "-f", BASE_RECIPE, "-t", tag, emptyContext];
    await mustRun(cli, build, { timeoutMs: BUILD_TIMEOUT_MS, onLine: buildProgress(progress) });
  } finally {
    await rm(emptyContext, { recursive: true, force: true });
    if (!builderRanBefore) await removeBuilder(cli);
    if (base !== null && !baseWasThere) await cli.run(["image", "delete", base]);
  }
  await removeOtherBases(cli, tag);
}

async function removeBuilder(cli: ContainerCli) {
  await cli.run(["builder", "stop"]);
  await cli.run(["builder", "delete"]);
}

async function removeOtherBases(cli: ContainerCli, kept: string) {
  const others = [...(await listImages(cli))].filter((name) => isMiradorsBase(name) && !name.endsWith(kept));
  if (others.length > 0) await cli.run(["image", "delete", ...others]);
}

export const imageExists = async (cli: ContainerCli, tag: string) => (await cli.run(["image", "inspect", tag])).exitCode === 0;
