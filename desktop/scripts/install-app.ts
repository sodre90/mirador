#!/usr/bin/env bun
/**
 * The last step of `bun run app` on macOS: puts the new build where Mirador runs from, so the app runs this checkout's
 * code. A running app's bundle can't be swapped under it, so a process left behind waits until Mirador is quit, copies
 * the build over it and opens it again. Its log is install-app.log in the temporary folder.
 */
import { spawn, spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { HOST_ENTRY } from "../src/core/host-command.ts";
import { PidFileOnDisk, systemProcesses } from "../src/core/processes.ts";
import { dataPaths, resolveRuntime } from "../src/core/runtime.ts";

const executables = (processes: string) => processes.split("\n").map((line) => line.replace(/^\s*\d+\s+/, ""));

/** The stable Mirador.app bundles whose launcher runs, by `ps -axo pid=,comm=` output; not the dev build. */
export const runningMiradorApps = (processes: string): string[] => [
  ...new Set(executables(processes).flatMap((executable) => /^(.*\/Mirador\.app)\/Contents\/MacOS\/launcher$/.exec(executable)?.[1] ?? [])),
];

/** Its launcher and the processes it runs inside the bundle would still use the bundle's files. */
export const runsFrom = (bundle: string, processes: string) =>
  executables(processes).some((executable) => executable.startsWith(`${bundle}/Contents/MacOS/`));

export type InstallPlan =
  | { kind: "after-quit"; target: string; copies: boolean }
  | { kind: "now"; target: string }
  | { kind: "nowhere" };

/** Over the app that runs, once it is quit; else over the one installed; else nowhere, for the build to be opened where it is. */
export function installPlan(built: string, running: string[], installed: string[]): InstallPlan {
  const [app] = running;
  if (app) return { kind: "after-quit", target: app, copies: app !== built };
  const [target] = installed;
  return target ? { kind: "now", target } : { kind: "nowhere" };
}

const BUILT = join(import.meta.dir, "..", "build", `stable-macos-${process.arch}`, "Mirador.app");
const INSTALLED = [join(homedir(), "Applications", "Mirador.app"), "/Applications/Mirador.app"];
const WAITER_PID_FILE = join(tmpdir(), "mirador-install-app.pid");
const LOG_FILE = join(tmpdir(), "install-app.log");

/** Executables, not command lines, as a command line can name the launcher, such as a shell's that ran `ls` on it. */
const processList = () => spawnSync("ps", ["-axo", "pid=,comm="], { encoding: "utf8" }).stdout;

const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

const isWritable = (path: string) => {
  try {
    accessSync(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
};

/** Copies beside it first, so a failed copy leaves the app as it was. */
function copyOver(target: string) {
  const copy = `${target}.installing`;
  rmSync(copy, { recursive: true, force: true });
  const { status } = spawnSync("ditto", [BUILT, copy], { stdio: "inherit" });
  if (status !== 0) throw new Error(`ditto could not copy ${BUILT} to ${copy}`);
  rmSync(target, { recursive: true, force: true });
  renameSync(copy, target);
}

const isWaiter = (pid: number) =>
  isAlive(pid) && spawnSync("ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8" }).stdout.includes("install-app.ts --wait");

/** A waiter left by an earlier `bun run app` would copy its build over this one's. A pid file outliving its waiter can name another process by now. */
function stopEarlierWaiter() {
  const pid = existsSync(WAITER_PID_FILE) ? Number(readFileSync(WAITER_PID_FILE, "utf8")) : NaN;
  if (Number.isInteger(pid) && isWaiter(pid)) process.kill(pid);
  rmSync(WAITER_PID_FILE, { force: true });
}

function leaveWaiter(plan: Extract<InstallPlan, { kind: "after-quit" }>) {
  stopEarlierWaiter();
  const log = openSync(LOG_FILE, "a");
  const waiter = spawn(process.execPath, [import.meta.path, "--wait", plan.target, plan.copies ? "copy" : "open"], {
    detached: true,
    stdio: ["ignore", log, log],
  });
  writeFileSync(WAITER_PID_FILE, String(waiter.pid));
  waiter.unref();
}

/** The app stops the host it started as it quits, without waiting for it, and an app opened before that host is gone would take it for one it didn't start. */
function ownedHost(): number | null {
  const pid = new PidFileOnDisk(dataPaths(resolveRuntime(process.env, homedir()).dataDir).ownedHostPid).read();
  return pid !== null && systemProcesses.commandLine(pid)?.includes(HOST_ENTRY) ? pid : null;
}

async function waitThenInstall(target: string, copies: boolean) {
  const host = ownedHost();
  while (runsFrom(target, processList()) || (host !== null && isAlive(host))) await Bun.sleep(1000);
  rmSync(WAITER_PID_FILE, { force: true });
  try {
    if (copies) copyOver(target);
    console.log(`${new Date().toISOString()} ${copies ? `copied the new build over ${target}` : `the new build is ${target}`}`);
  } finally {
    spawnSync("open", [target]);
  }
}

function install() {
  if (process.platform !== "darwin") return;
  const running = runningMiradorApps(processList());
  const plan = installPlan(BUILT, running, INSTALLED.filter((path) => existsSync(path)));
  if (plan.kind === "nowhere") return console.log(`Built ${BUILT}. Open it from there, or copy it into Applications.`);
  if (plan.kind !== "after-quit" || plan.copies) {
    if (!isWritable(dirname(plan.target))) return console.log(`Built ${BUILT}. ${dirname(plan.target)} is not writable for you, so copy it over ${plan.target} yourself.`);
  }
  if (plan.kind === "now") {
    copyOver(plan.target);
    return console.log(`Installed the new build as ${plan.target}.`);
  }
  leaveWaiter(plan);
  console.log(`Quit Mirador when it suits you: ${plan.copies ? `the new build replaces ${plan.target} and opens` : "it opens again with the new build"}.`);
}

const [mode, target, then] = process.argv.slice(2);
if (import.meta.main) {
  if (mode === "--wait") await waitThenInstall(target!, then === "copy");
  else install();
}
