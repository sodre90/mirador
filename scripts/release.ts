#!/usr/bin/env bun
/**
 * Makes a release, as the Makefile's release goals run it:
 *   release <version> [from-step]  bumps the version, gates, builds, signs and checks every app, and leaves a checked
 *                                  draft on GitHub with the notes in dist/release-notes-<version>.md; with WINDOWS=no in
 *                                  the environment, without the Windows app and install.ps1
 *   publish <version>              publishes that draft as the latest release
 *   tap <version>                  pushes the Homebrew cask of the published release to the tap, then removes the
 *                                  release's worktree
 * The release is made in a worktree of its own, so nothing uncommitted in this checkout reaches it, and into
 * dist/<version>/. An x.y.0 release is made from main and starts the branch release/x.y.x at its commit; a patch x.y.z
 * is made from that branch, so a fix ships without what main gained since. After the gate the Linux, Windows and macOS
 * builds run at once, each making its patches once it is in, and the draft waits for all three. A step that fails names
 * the steps to go on from once it is fixed.
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { CASK_ASSETS } from "../desktop/scripts/homebrew-cask.ts";
import { LOGIN_KEYCHAIN, NOTARY_CREDENTIALS, NOTARY_PROFILE } from "../desktop/scripts/sign-macos-app.ts";
import { buildMachineBun, definedBunVersion, requireDefinedBun } from "../desktop/scripts/ship-build-bun.ts";
import type { Platform } from "../desktop/scripts/update-files.ts";
import { isNewerVersion, RELEASES_REPOSITORY } from "../shared/newer-version.ts";

const CHECKOUT = join(import.meta.dir, "..");
const VERSION_FILE = join("shared", "version.ts");
const RELEASE_ASSET = /^(Mirador-|stable-)|^install\.(sh|ps1)$/;
const CHECKSUMS_HEADING = "## Checksums (SHA-256)";
const PLATFORMS = ["macos-arm64", "linux-x64", "linux-arm64", "win-x64"];
const WINDOWS_INSTALLER = "Mirador-windows-x64-Setup.zip";
const REQUIRED_ASSETS = [...Object.values(CASK_ASSETS), WINDOWS_INSTALLER, "install.sh", "install.ps1", ...PLATFORMS.map((platform) => `stable-${platform}-update.json`)];
const BUILD_LINE = "== release of ";
const WINDOWS_WORKFLOW = "windows-release.yml";
const WINDOWS_ARTIFACT = "mirador-windows-x64";
const WINDOWS_FILE = /^(Mirador-windows-|stable-win-)/;
const WINDOWS_RUN_FILE = "windows-run.json";
const isWindowsOnly = (file: string) => WINDOWS_FILE.test(file) || file === "install.ps1";

export interface Release {
  version: string;
  tag: string;
  branch: string;
  patchBranch: string;
  worktree: string;
  dist: string;
  notes: string;
  windows: boolean;
}

export function releaseOf(version: string, checkout = CHECKOUT, temporary = tmpdir(), windows = true): Release {
  const [, major, minor, patch] = version.match(/^(\d+)\.(\d+)\.(\d+)$/) ?? [];
  if (patch === undefined) throw new Error(`Name the release as x.y.z, not "${version}"`);
  const patchBranch = `release/${major}.${minor}.x`;
  return {
    version,
    tag: `v${version}`,
    branch: patch === "0" ? "main" : patchBranch,
    patchBranch,
    worktree: join(temporary, `mirador-release-${version}`),
    dist: join(checkout, "dist", version),
    notes: join(checkout, "dist", `release-notes-${version}.md`),
    windows,
  };
}

/** The notes as approved, with the checksums of what the release holds in place of any the notes had. */
export function notesWithChecksums(notes: string, checksums: string) {
  const withoutChecksums = notes.split(`\n${CHECKSUMS_HEADING}`)[0]!.trimEnd();
  return `${withoutChecksums}\n\n${CHECKSUMS_HEADING}\n\n\`\`\`\n${checksums.trim()}\n\`\`\`\n`;
}

export const releaseAssets = (files: string[], windows = true) => files.filter((file) => RELEASE_ASSET.test(file) && (windows || !isWindowsOnly(file))).sort();

export const missingAssets = (files: string[], windows = true) => REQUIRED_ASSETS.filter((asset) => (windows || !isWindowsOnly(asset)) && !files.includes(asset));

/** `git describe` shortens the commit to as few digits as its clone needs, so the build machine's may be shorter or longer. */
export function isBuildOf(buildLine: string, commit: string) {
  const abbreviated = buildLine.slice(BUILD_LINE.length).trim().match(/^(?:.*-g)?([0-9a-f]{4,40})$/)?.[1];
  return abbreviated !== undefined && commit.startsWith(abbreviated);
}

/** The assets GitHub holds whose digest differs from the file that was uploaded, or that never arrived. */
export function digestMismatches(local: Record<string, string>, uploaded: Record<string, string>) {
  return Object.entries(local)
    .filter(([asset, sha256]) => uploaded[asset] !== `sha256:${sha256}`)
    .map(([asset]) => asset);
}

/** The cask's assets whose published SHA-256 the cask does not name. */
export function caskMismatches(cask: string, uploaded: Record<string, string>) {
  return Object.values(CASK_ASSETS).filter((asset) => {
    const sha256 = uploaded[asset]?.replace(/^sha256:/, "");
    return !sha256 || !cask.includes(`"${sha256}"`);
  });
}

/** The Windows run a release started, kept in dist/ so that going on from the windows step takes it up again. */
export interface WindowsRun {
  id: string;
  commit: string;
}

export interface RunState {
  status: string;
  conclusion: string;
}

export type WindowsRunStep = "start a run" | "wait for it" | "take its files" | "run its failed jobs again";

/**
 * What the windows step does with the run an earlier try of the release started: it starts a run when there is none of
 * this commit, waits for one still going, takes the files of one that passed, and runs only the failed jobs of one that
 * failed again, as the build and the shards that passed keep their artifacts.
 */
export function windowsRunStep(earlier: WindowsRun | null, head: string, state: RunState | null): WindowsRunStep {
  if (!earlier || earlier.commit !== head || !state) return "start a run";
  if (state.status !== "completed") return "wait for it";
  return state.conclusion === "success" ? "take its files" : "run its failed jobs again";
}

/** The run `gh workflow run` started, from the URL it prints. */
export const runIdIn = (output: string) => output.match(/\/actions\/runs\/(\d+)/)?.[1] ?? null;

export function stepsFrom<Step extends { name: string }>(steps: Step[], from: string | undefined) {
  if (!from) return steps;
  const start = steps.findIndex((step) => step.name === from);
  if (start === -1) throw new Error(`There is no step "${from}"; the steps are ${steps.map((step) => step.name).join(", ")}`);
  return steps.slice(start);
}

export interface Step {
  name: string;
  /** A step of another build that must end well first, when this run makes it. */
  waitsFor?: string;
}

/** The steps before the builds run one after another, then the builds at once, each its steps in order, then the steps after. */
export interface Plan<S extends Step> {
  before: S[];
  builds: S[][];
  after: S[];
}

/**
 * What a run that goes on from the named steps makes: from a step before or after the builds, everything from there on;
 * from steps of the builds, at most one of each, those builds from those steps and then the steps after the builds.
 */
export function planFrom<S extends Step>(steps: Plan<S>, from: string | undefined): Plan<S> {
  if (!from) return steps;
  const names = from.split(",");
  const everyStep = [...steps.before, ...steps.builds.flat(), ...steps.after];
  const unknown = names.find((name) => !everyStep.some((step) => step.name === name));
  if (unknown !== undefined) throw new Error(`There is no step "${unknown}"; the steps are ${everyStep.map((step) => step.name).join(", ")}`);
  const isIn = (list: S[]) => names.length === 1 && list.some((step) => step.name === from);
  if (isIn(steps.before)) return { ...steps, before: stepsFrom(steps.before, from) };
  if (isIn(steps.after)) return { before: [], builds: [], after: stepsFrom(steps.after, from) };
  const outsideTheBuilds = names.find((name) => !steps.builds.flat().some((step) => step.name === name));
  if (outsideTheBuilds !== undefined) throw new Error(`Only steps of the builds go on together; go on from ${outsideTheBuilds} alone`);
  return { before: [], builds: steps.builds.flatMap((build) => buildFrom(build, names)), after: steps.after };
}

function buildFrom<S extends Step>(build: S[], names: string[]) {
  const named = build.filter((step) => names.includes(step.name));
  if (named.length > 1) throw new Error(`${named.map((step) => step.name).join(" and ")} are steps of one build; go on from the one that failed`);
  return named.map((step) => stepsFrom(build, step.name));
}

/** Where a run stopped: the step before or after the builds that failed, or the step each failed build failed at. */
export class Stopped extends Error {
  constructor(readonly at: string[]) {
    super(`Stopped at ${at.join(", ")}`);
  }
}

/** Runs the plan and tells of each step that fails as it fails; the steps after the builds run only once every build ended well. */
export async function runPlan<S extends Step>(plan: Plan<S>, perform: (step: S) => void | Promise<void>, failed: (step: S, error: unknown) => void) {
  const inOrder = async (steps: S[]) => {
    for (const step of steps) {
      try {
        await perform(step);
      } catch (error) {
        failed(step, error);
        throw new Stopped([step.name]);
      }
    }
  };
  await inOrder(plan.before);
  const failedBuildSteps = await runBuilds(plan.builds, perform, failed);
  if (failedBuildSteps.length > 0) throw new Stopped(failedBuildSteps);
  await inOrder(plan.after);
}

async function runBuilds<S extends Step>(builds: S[][], perform: (step: S) => void | Promise<void>, failed: (step: S, error: unknown) => void) {
  const endedWell = new Map(builds.flat().map((step) => [step.name, Promise.withResolvers<boolean>()]));
  const waitedForEndedWell = (name: string) => endedWell.get(name)?.promise ?? Promise.resolve(true);
  const runBuild = async (build: S[]) => {
    for (const [index, step] of build.entries()) {
      try {
        if (step.waitsFor && !(await waitedForEndedWell(step.waitsFor))) throw new Error(`The ${step.waitsFor} step it waits for failed`);
        await perform(step);
        endedWell.get(step.name)!.resolve(true);
      } catch (error) {
        failed(step, error);
        for (const unreached of build.slice(index)) endedWell.get(unreached.name)!.resolve(false);
        return [step.name];
      }
    }
    return [];
  };
  return (await Promise.all(builds.map(runBuild))).flat();
}

/** Work handed in runs one piece at a time, in the order handed in, whether the piece before ended well or not. */
export function inTurn() {
  let previous: Promise<unknown> = Promise.resolve();
  return <T>(work: () => Promise<T>) => {
    const turn = previous.then(work);
    previous = turn.catch(() => undefined);
    return turn;
  };
}

/** The whole lines of text that comes in pieces, and the last line once the text has ended without a newline. */
export function linesOf() {
  let partial = "";
  return {
    add(text: string) {
      const lines = (partial + text).split("\n");
      partial = lines.pop()!;
      return lines;
    },
    end() {
      const last = partial;
      partial = "";
      return last === "" ? [] : [last];
    },
  };
}

/** Each line of the stream as it comes, and the whole text once the stream ends. */
async function readLines(stream: ReadableStream<Uint8Array>, eachLine: (line: string) => void) {
  const decoder = new TextDecoder();
  const lines = linesOf();
  let text = "";
  for await (const chunk of stream) {
    const piece = decoder.decode(chunk, { stream: true });
    text += piece;
    lines.add(piece).forEach(eachLine);
  }
  const rest = decoder.decode();
  [...lines.add(rest), ...lines.end()].forEach(eachLine);
  return text + rest;
}

/** The builds print at once, so each line a build step prints is marked with the step. */
interface Shell {
  /** Shows what the command prints as it goes, unless quietly, and gives back what it printed on stdout. */
  run(command: string[], cwd: string, quietly?: boolean): Promise<string>;
  say(line: string): void;
}

export function shellOf(step: string): Shell {
  const mark = `[${step}] `;
  const shown = (output: NodeJS.WriteStream, quietly: boolean) => (line: string) => {
    if (!quietly) output.write(`${mark}${line}\n`);
  };
  return {
    say: (line) => console.log(`${mark}${line}`),
    async run(command, cwd, quietly = false) {
      console.log(`${mark}$ ${command.join(" ")}`);
      const child = Bun.spawn(command, { cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
      const [stdout] = await Promise.all([readLines(child.stdout, shown(process.stdout, quietly)), readLines(child.stderr, shown(process.stderr, quietly))]);
      const exitCode = await child.exited;
      if (exitCode !== 0) throw new Error(`${command.join(" ")} failed with exit code ${exitCode}`);
      return stdout;
    },
  };
}

function run(command: string[], cwd: string, env: Record<string, string | undefined> = process.env) {
  console.log(`$ ${command.join(" ")}`);
  const { exitCode } = Bun.spawnSync(command, { cwd, env, stdio: ["inherit", "inherit", "inherit"] });
  if (exitCode !== 0) throw new Error(`${command.join(" ")} failed with exit code ${exitCode}`);
}

/** What the command printed on both its outputs. */
function readBoth(command: string[], cwd = CHECKOUT) {
  const { exitCode, stdout, stderr } = Bun.spawnSync(command, { cwd, stdout: "pipe", stderr: "pipe" });
  if (exitCode !== 0) throw new Error(`${command.join(" ")} failed: ${stderr.toString().trim()}`);
  return `${stdout}${stderr}`;
}

function read(command: string[], cwd = CHECKOUT) {
  const { exitCode, stdout, stderr } = Bun.spawnSync(command, { cwd, stdout: "pipe", stderr: "pipe" });
  if (exitCode !== 0) throw new Error(`${command.join(" ")} failed: ${stderr.toString().trim()}`);
  return stdout.toString().trim();
}

const sha256Of = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const headOf = (release: Release) => read(["git", "rev-parse", "HEAD"], release.worktree);
const versionIn = (folder: string) => readFileSync(join(folder, VERSION_FILE), "utf8").match(/MIRADOR_VERSION = "([^"]+)"/)![1]!;

const releasesNamed = (release: Release) => read(["gh", "api", `repos/${RELEASES_REPOSITORY}/releases`, "--jq", `.[] | select(.tag_name=="${release.tag}") | .id`]);

function uploadedDigests(release: Release) {
  const listing = read(["gh", "api", `repos/${RELEASES_REPOSITORY}/releases`, "--jq", `.[] | select(.tag_name=="${release.tag}") | .assets[] | "\\(.name) \\(.digest)"`]);
  return Object.fromEntries(listing.split("\n").filter(Boolean).map((line) => line.split(" ") as [string, string]));
}

const removeWorktree = (release: Release) => run(["git", "worktree", "remove", "--force", release.worktree], CHECKOUT);

function makeWorktree(release: Release) {
  run(["git", "fetch", "-q", "origin"], CHECKOUT);
  if (existsSync(release.worktree)) removeWorktree(release);
  run(["git", "worktree", "add", "-q", "--detach", release.worktree, `origin/${release.branch}`], CHECKOUT);
  for (const folder of [".", "video", "desktop"]) run(["bun", "install", "--frozen-lockfile"], join(release.worktree, folder));
  rmSync(release.dist, { recursive: true, force: true });
  mkdirSync(release.dist, { recursive: true });
}

export function bump(release: Release) {
  const current = versionIn(release.worktree);
  if (current === release.version) console.log(`${release.branch} already names release ${release.version}`);
  else nameTheRelease(release, current);
  if (release.branch !== release.patchBranch) run(["git", "push", "-q", "origin", `HEAD:refs/heads/${release.patchBranch}`], release.worktree);
}

function nameTheRelease(release: Release, current: string) {
  if (!isNewerVersion(release.version, current)) throw new Error(`${release.version} is not newer than ${current}, the version on ${release.branch}`);
  const file = join(release.worktree, VERSION_FILE);
  writeFileSync(file, readFileSync(file, "utf8").replace(`MIRADOR_VERSION = "${current}"`, `MIRADOR_VERSION = "${release.version}"`));
  run(["git", "commit", "-q", "-m", `Name this release ${release.version}`, "--", VERSION_FILE], release.worktree);
  run(["git", "push", "-q", "origin", `HEAD:refs/heads/${release.branch}`], release.worktree);
}

/** Restart specs flake under load, so the gate waits for a mirador-mobile e2e run another session started. */
function gate(release: Release) {
  if (Bun.spawnSync(["pgrep", "-f", "mirador-mobile/e2e/run.ts"]).exitCode === 0) throw new Error("A mirador-mobile e2e run is going on; wait for it to end");
  requireDefinedBun(buildMachineBun(), definedBunVersion(release.worktree));
  run(["bunx", "tsc", "--noEmit", "-p", "."], release.worktree);
  run(["bun", "run", "test"], release.worktree);
  run(["scripts/e2e.sh"], release.worktree);
}

function requireLinuxHost() {
  const linuxHost = process.env.LINUX_HOST;
  if (!linuxHost) throw new Error("Name the x64 Linux machine that builds the installers: LINUX_HOST=user@host");
  return linuxHost;
}

/** Both installers build on that machine, as Electrobun's toolchain crashes in Docker on Apple Silicon. */
async function linux(release: Release, shell: Shell) {
  const log = await shell.run(["make", "linux-remote", `LINUX_HOST=${requireLinuxHost()}`, `DIST=${release.dist}`], release.worktree);
  const head = headOf(release);
  const built = log.split("\n").filter((line) => line.startsWith(BUILD_LINE));
  if (built.length === 0 || !built.every((line) => isBuildOf(line, head))) throw new Error(`The Linux builds are not of ${head}: ${built.join("; ")}`);
}

const runUrl = (runId: string) => `https://github.com/${RELEASES_REPOSITORY}/actions/runs/${runId}`;

function earlierWindowsRun(release: Release) {
  const file = join(release.dist, WINDOWS_RUN_FILE);
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as WindowsRun) : null;
}

/** None when GitHub no longer has the run. */
function windowsRunState(runId: string) {
  try {
    return JSON.parse(read(["gh", "run", "view", runId, "--repo", RELEASES_REPOSITORY, "--json", "status,conclusion"])) as RunState;
  } catch {
    return null;
  }
}

function startWindowsRun(release: Release, head: string) {
  const started = readBoth(["gh", "workflow", "run", WINDOWS_WORKFLOW, "--repo", RELEASES_REPOSITORY, "--ref", release.branch, "-f", `commit=${head}`]);
  const runId = runIdIn(started);
  if (!runId) throw new Error(`gh started the Windows build without naming its run; find "Windows release of ${head}" with gh run list --workflow ${WINDOWS_WORKFLOW}`);
  mkdirSync(release.dist, { recursive: true });
  writeFileSync(join(release.dist, WINDOWS_RUN_FILE), JSON.stringify({ id: runId, commit: head } satisfies WindowsRun));
  return runId;
}

/** gh run rerun can return before GitHub has the run going again, and a watch then would end at once on the failed try. */
async function runFailedJobsAgain(runId: string, release: Release, shell: Shell) {
  await shell.run(["gh", "run", "rerun", runId, "--repo", RELEASES_REPOSITORY, "--failed"], release.worktree);
  const deadline = Date.now() + 120_000;
  while (windowsRunState(runId)?.status === "completed") {
    if (Date.now() > deadline) throw new Error(`GitHub has not started the failed jobs of ${runUrl(runId)} again after two minutes`);
    await Bun.sleep(5_000);
  }
}

const unfinishedJobsOf = (runId: string) =>
  read(["gh", "run", "view", runId, "--repo", RELEASES_REPOSITORY, "--json", "jobs", "--jq", '.jobs[] | select(.conclusion != "success" and .conclusion != "skipped") | .name'])
    .split("\n")
    .filter(Boolean);

async function waitForWindowsRun(runId: string, release: Release, shell: Shell) {
  shell.say(`Waiting for ${runUrl(runId)}`);
  try {
    await shell.run(["gh", "run", "watch", runId, "--repo", RELEASES_REPOSITORY, "--exit-status", "--compact", "--interval", "30"], release.worktree, true);
  } catch (error) {
    const failed = unfinishedJobsOf(runId);
    if (failed.length === 0) throw error;
    throw new Error(
      `The Windows run failed in ${failed.join(", ")}: ${runUrl(runId)}. Going on from the windows step runs only those jobs again; once the shards' artifacts are over 7 days old, delete ${join(release.dist, WINDOWS_RUN_FILE)} for a new run.`,
    );
  }
}

/** Built on GitHub's Windows runner from the release's commit, as Electrobun does not cross-compile. */
export async function windows(release: Release, shell: Shell) {
  const head = headOf(release);
  const earlierRun = earlierWindowsRun(release);
  const step = windowsRunStep(earlierRun, head, earlierRun && windowsRunState(earlierRun.id));
  const runId = step === "start a run" ? startWindowsRun(release, head) : earlierRun!.id;
  if (step === "run its failed jobs again") await runFailedJobsAgain(runId, release, shell);
  if (step !== "take its files") await waitForWindowsRun(runId, release, shell);
  for (const earlier of readdirSync(release.dist).filter((file) => WINDOWS_FILE.test(file))) rmSync(join(release.dist, earlier));
  await shell.run(["gh", "run", "download", runId, "--repo", RELEASES_REPOSITORY, "--name", WINDOWS_ARTIFACT, "--dir", release.dist], release.worktree);
  const { version } = JSON.parse(readFileSync(join(release.dist, "stable-win-x64-update.json"), "utf8")) as { version: string };
  if (version !== release.version) throw new Error(`The Windows build says ${version}, not ${release.version}`);
}

/** Checked before the build, as notarizing comes last, hours into a release. */
export function requireReadableNotaryProfile(xcrun = "xcrun") {
  const { exitCode, stderr } = Bun.spawnSync([xcrun, "notarytool", "history", ...NOTARY_CREDENTIALS], { stdout: "pipe", stderr: "pipe" });
  if (exitCode === 0) return;
  const reason = stderr.toString().split("\n")[0].trim();
  throw new Error(
    `The notary profile ${NOTARY_PROFILE} cannot be read from the login keychain. Store it there once with \`xcrun notarytool store-credentials ${NOTARY_PROFILE} --keychain ${LOGIN_KEYCHAIN}\`.${reason ? ` ${reason}` : ""}`,
  );
}

async function macos(release: Release, shell: Shell) {
  requireReadableNotaryProfile();
  await shell.run(["make", "macos-signed", `DIST=${release.dist}`], release.worktree);
}

async function assessSignature(app: string) {
  const assessment = Bun.spawn(["spctl", "--assess", "--type", "execute", "-v", app], { stdout: "ignore", stderr: "pipe" });
  const verdict = await new Response(assessment.stderr).text();
  await assessment.exited;
  if (!verdict.includes("accepted") || !verdict.includes("source=Notarized Developer ID")) throw new Error(`macOS does not let ${app} open as notarized: ${verdict.trim()}`);
}

/** The zip is what users get, so the app unzipped from it is checked too. */
async function verifyMacos(release: Release, shell: Shell) {
  const signed = join(release.dist, "signing", "Mirador.app");
  const bundleVersion = read(["plutil", "-extract", "CFBundleVersion", "raw", join(signed, "Contents", "Info.plist")]);
  if (bundleVersion !== release.version) throw new Error(`The macOS app says ${bundleVersion}, not ${release.version}`);
  await assessSignature(signed);
  const unzipped = mkdtempSync(join(tmpdir(), "mirador-release-unzipped-"));
  try {
    const zip = readdirSync(release.dist).find((file) => /^Mirador-macos-.+\.zip$/.test(file));
    if (!zip) throw new Error(`No macOS zip in ${release.dist}`);
    await shell.run(["ditto", "-x", "-k", join(release.dist, zip), unzipped], release.worktree);
    await assessSignature(join(unzipped, "Mirador.app"));
  } finally {
    rmSync(unzipped, { recursive: true, force: true });
  }
}

/** bsdiff takes many times an archive's size in memory, so one platform's patches are made at a time. */
const oneAtATime = inTurn();

const patchesFor = (platform: Platform) => async (release: Release, shell: Shell) => {
  await oneAtATime(() => shell.run(["bun", join("desktop", "scripts", "update-files.ts"), release.dist, "--platform", platform], release.worktree));
};

function draft(release: Release) {
  run(["make", "checksums", `DIST=${release.dist}`], release.worktree);
  if (releasesNamed(release) !== "") throw new Error(`GitHub has a release ${release.tag} already, maybe a draft an earlier run left; delete it with gh release delete ${release.tag} --yes`);
  const assets = releaseAssets(readdirSync(release.dist), release.windows);
  const missing = missingAssets(assets, release.windows);
  if (missing.length > 0) throw new Error(`${release.dist} lacks ${missing.join(", ")}`);
  const checksums = assets.map((asset) => `${sha256Of(join(release.dist, asset))}  ${asset}`).join("\n");
  const notes = join(release.dist, "release-notes.md");
  writeFileSync(notes, notesWithChecksums(readFileSync(release.notes, "utf8"), checksums));
  const assetPaths = assets.map((asset) => join(release.dist, asset));
  run(["gh", "release", "create", release.tag, "--draft", "--title", `Mirador ${release.version}`, "--target", headOf(release), "--notes-file", notes, ...assetPaths], release.worktree);
  const mismatches = digestMismatches(Object.fromEntries(assets.map((asset) => [asset, sha256Of(join(release.dist, asset))])), uploadedDigests(release));
  if (mismatches.length > 0) throw new Error(`GitHub holds other files than dist/ for: ${mismatches.join(", ")}`);
  console.log(`\nThe draft of Mirador ${release.version} holds ${assets.length} files, each as built. Publish it with: make publish VERSION=${release.version}`);
}

interface ReleaseStep extends Step {
  run(release: Release, shell: Shell): void | Promise<void>;
}

/** Electrobun's tools, which make the patches, come with the macOS build. */
const MACOS_BUILD = "macos";

export function releaseSteps(windowsToo: boolean): Plan<ReleaseStep> {
  const windowsBuild = [
    { name: "windows", run: windows },
    { name: "windows-patches", run: patchesFor("win"), waitsFor: MACOS_BUILD },
  ];
  return {
    before: [
      { name: "worktree", run: makeWorktree },
      { name: "bump", run: bump },
      { name: "gate", run: gate },
    ],
    builds: [
      [
        { name: "linux", run: linux },
        { name: "linux-patches", run: patchesFor("linux"), waitsFor: MACOS_BUILD },
      ],
      ...(windowsToo ? [windowsBuild] : []),
      [
        { name: MACOS_BUILD, run: macos },
        { name: "verify", run: verifyMacos },
        { name: "macos-patches", run: patchesFor("macos") },
      ],
    ],
    after: [{ name: "draft", run: draft }],
  };
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

async function makeRelease(release: Release, from: string | undefined) {
  if (!existsSync(release.notes)) throw new Error(`Write the release notes into ${release.notes} first; the checksums are added to them`);
  const plan = planFrom(releaseSteps(release.windows), from);
  const steps = [...plan.before, ...plan.builds.flat(), ...plan.after];
  if (steps.some((step) => step.run === linux)) requireLinuxHost();
  if (steps.some((step) => step.run === macos)) requireReadableNotaryProfile();
  if (steps[0]?.run !== makeWorktree && !existsSync(release.worktree)) throw new Error(`There is no release worktree at ${release.worktree} to go on in; start from the beginning`);
  const goOn = (from: string[]) => `make release VERSION=${release.version}${process.env.LINUX_HOST ? ` LINUX_HOST=${process.env.LINUX_HOST}` : ""}${release.windows ? "" : " WINDOWS=no"} FROM=${from.join(",")}`;
  const perform = (step: ReleaseStep) => {
    console.log(`\n== ${step.name} at ${new Date().toTimeString().slice(0, 8)}`);
    return step.run(release, shellOf(step.name));
  };
  try {
    await runPlan(plan, perform, (step, error) => console.error(`\nThe ${step.name} step failed: ${messageOf(error)}`));
  } catch (error) {
    if (!(error instanceof Stopped)) throw error;
    if (error.at.includes(MACOS_BUILD)) {
      const stapled = error.at.map((step) => (step === MACOS_BUILD ? "verify" : step));
      console.error(`\nIf Apple's notarization outlasted the wait, once it says Accepted: cd ${release.worktree} && make macos-staple DIST=${release.dist}, then go on with: ${goOn(stapled)}`);
    }
    throw new Error(`\nOnce ${error.at.length === 1 ? "it is" : "they are"} fixed, go on with: ${goOn(error.at)}`);
  }
}

function publish(release: Release) {
  run(["gh", "release", "edit", release.tag, "--draft=false", "--latest"], CHECKOUT);
  const target = read(["gh", "release", "view", release.tag, "--json", "targetCommitish", "--jq", ".targetCommitish"]);
  const tagged = read(["gh", "api", `repos/${RELEASES_REPOSITORY}/git/ref/tags/${release.tag}`, "--jq", ".object.sha"]);
  if (tagged !== target) throw new Error(`${release.tag} points at ${tagged}, not at the release's commit ${target}`);
  console.log(`Mirador ${release.version} is out. The cask goes to the tap with: make tap VERSION=${release.version}`);
}

/** The cask names the published assets by their SHA-256, so each must be one GitHub holds. */
function tap(release: Release) {
  const tapFolder = process.env.TAP_DIR || join(homedir(), "prj", "homebrew-tap");
  run(["make", "cask", `DIST=${release.dist}`], release.worktree);
  const cask = join(release.dist, "mirador.rb");
  const mismatches = caskMismatches(readFileSync(cask, "utf8"), uploadedDigests(release));
  if (mismatches.length > 0) throw new Error(`The cask does not name the published SHA-256 of ${mismatches.join(", ")}`);
  if (read(["git", "status", "--porcelain"], tapFolder) !== "") throw new Error(`${tapFolder} has uncommitted changes`);
  copyFileSync(cask, join(tapFolder, "Casks", "mirador.rb"));
  run(["git", "commit", "-q", "-m", `Mirador ${release.version}`, "--", join("Casks", "mirador.rb")], tapFolder);
  run(["git", "push", "-q"], tapFolder);
  removeWorktree(release);
  console.log("The tap has the new cask, and the release worktree is removed. Audit and test it in the Homebrew kit on the Linux machine (run-real.sh).");
}

async function main([command, version, from]: string[]) {
  const release = releaseOf(version ?? "", CHECKOUT, tmpdir(), process.env.WINDOWS !== "no");
  if (command === "release") await makeRelease(release, from);
  else if (command === "publish") publish(release);
  else if (command === "tap") tap(release);
  else throw new Error("Usage: release.ts release|publish|tap <version> [step to go on from]");
}

if (import.meta.main) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
