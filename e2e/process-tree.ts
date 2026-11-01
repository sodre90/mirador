import { execFileSync } from "node:child_process";
import { join } from "node:path";
import type { WindowsProcess } from "../host/windows-processes.ts";

const POLL_INTERVAL_MS = 100;
const KILLED_PROCESSES_EXIT_MS = 2_000;

export interface RunningProcess {
  pid: number;
  parentPid: number;
  startedAt: string;
}

/** Processes by pid, each with when it started: a later process that gets the same pid is not one of them. */
export type ProcessTree = ReadonlyMap<number, string>;

/** Windows has no ps; the host's own snapshot of its processes is read on Bun, as the specs run in Node. */
function runningWindowsProcesses(): RunningProcess[] {
  const processes: WindowsProcess[] = JSON.parse(execFileSync("bun", [join(import.meta.dirname, "windows-process-list.ts")], { encoding: "utf8" }));
  return processes.map(({ pid, parentPid, startedAt }) => ({ pid, parentPid, startedAt: String(startedAt) }));
}

/** Every process on this computer that still runs; zombies are left out, as they have ended and only wait to be reaped. */
function runningProcesses(): RunningProcess[] {
  if (process.platform === "win32") return runningWindowsProcesses();
  return execFileSync("ps", ["-A", "-o", "pid=,ppid=,stat=,lstart="], { encoding: "utf8" })
    .trim()
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .filter(([, , state]) => !state.startsWith("Z"))
    .map(([pid, parentPid, , ...startedAt]) => ({ pid: Number(pid), parentPid: Number(parentPid), startedAt: startedAt.join(" ") }));
}

/**
 * Windows keeps a process's parent pid after that parent exits, and gives the pid to later processes, so there a process
 * only counts as a child of one that started before it. Elsewhere an orphan gets a new parent.
 */
const isNewChild = (tree: ProcessTree, { pid, parentPid, startedAt }: RunningProcess, platform: NodeJS.Platform) =>
  tree.has(parentPid) && !tree.has(pid) && (platform !== "win32" || Number(tree.get(parentPid)) < Number(startedAt));

/** The tree with every process its members started, at any depth. */
export function withDescendants(tree: ProcessTree, processes: RunningProcess[], platform = process.platform): ProcessTree {
  const children = processes.filter((running) => isNewChild(tree, running, platform));
  const grown = new Map([...tree, ...children.map(({ pid, startedAt }) => [pid, startedAt] as const)]);
  return children.length === 0 ? grown : withDescendants(grown, processes, platform);
}

function stillRunningWithDescendants(tree: ProcessTree): ProcessTree {
  const processes = runningProcesses();
  const stillRunning = processes.filter(({ pid, startedAt }) => tree.get(pid) === startedAt);
  return withDescendants(new Map(stillRunning.map(({ pid, startedAt }) => [pid, startedAt])), processes);
}

/** The process, if it still runs, and every process it started, at any depth. */
export function processTreeOf(pid: number): ProcessTree {
  const processes = runningProcesses();
  const root = processes.find((running) => running.pid === pid);
  return root ? withDescendants(new Map([[pid, root.startedAt]]), processes) : new Map();
}

async function stillRunningAfter(tree: ProcessTree, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  let running = stillRunningWithDescendants(tree);
  while (running.size > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    running = stillRunningWithDescendants(running);
  }
  return running;
}

function killIfStillRunning(pid: number) {
  try {
    process.kill(pid, "SIGKILL");
  } catch {}
}

/**
 * Waits until none of these processes runs any more, nor any process they start meanwhile. Those still running when the
 * time is up are killed outright.
 */
export async function waitForProcessesToEnd(tree: ProcessTree, timeoutMs: number) {
  const survivors = await stillRunningAfter(tree, timeoutMs);
  [...survivors.keys()].forEach(killIfStillRunning);
  await stillRunningAfter(survivors, KILLED_PROCESSES_EXIT_MS);
}
