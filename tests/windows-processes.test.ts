import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { childProgramNames, descendantsOf, killProcessTree, processSnapshot, type WindowsProcess } from "../host/windows-processes.ts";
import { fakeProgram } from "./fake-program.ts";

const started = (pid: number, parentPid: number, startedAt: number, name = `program-${pid}.exe`): WindowsProcess => ({ pid, parentPid, startedAt, name });

describe("a Windows process tree", () => {
  test("holds what a process started, at any depth", () => {
    const processes = [started(10, 1, 100), started(20, 10, 200), started(30, 20, 300), started(40, 1, 150)];
    expect(descendantsOf(10, processes).map(({ pid }) => pid)).toEqual([20, 30]);
  });

  test("leaves out an older process that names the pid as its parent, as one whose parent exited before the pid was reused does", () => {
    const shell = started(816, 700, 5_000, "pwsh.exe");
    const systemProcess = started(844, 816, 1_000, "csrss.exe");
    const startedBySystemProcess = started(900, 844, 1_100, "winlogon.exe");
    const program = started(950, 816, 6_000, "bun.exe");
    expect(descendantsOf(816, [systemProcess, startedBySystemProcess, shell, program])).toEqual([program]);
  });

  test("is empty for a pid no process has", () => {
    expect(descendantsOf(5, [started(10, 5, 100)])).toEqual([]);
  });
});

describe("killing a Windows process tree", () => {
  /** Snapshots that show what is still running: the processes listed, but not those already killed. */
  function fakeWindows(snapshots: WindowsProcess[][]) {
    const kills: number[][] = [];
    let taken = 0;
    const snapshot = () => (snapshots[Math.min(taken++, snapshots.length - 1)] ?? []).filter(({ pid }) => !kills.flat().includes(pid));
    const kill = async (pids: number[]) => void kills.push(pids);
    return { kills, killTree: async (pid: number) => (await killProcessTree(pid, { snapshot, kill, lookAgainAfterMs: [0, 0] })).lateStartersKilled };
  }

  test("kills the process and what it started at once", async () => {
    const windows = fakeWindows([[started(10, 1, 100), started(20, 10, 200), started(30, 20, 300)]]);
    await windows.killTree(10);
    expect(windows.kills).toEqual([[10, 20, 30]]);
  });

  test("also kills what the process had begun to start as it was killed, which shows only later", async () => {
    const launcher = started(10, 1, 100, "bash.exe");
    const realBash = started(20, 10, 200, "bash.exe");
    const sleep = started(30, 20, 300, "sleep.exe");
    const windows = fakeWindows([[launcher], [launcher], [realBash], [realBash, sleep]]);
    await windows.killTree(10);
    expect(windows.kills).toEqual([[10], [20], [30]]);
  });

  test("leaves alone a process started by a later one that got a killed process's pid", async () => {
    const killedAtLatest = Date.now() * 1000 + 60_000_000;
    const reusedPid = started(10, 1, killedAtLatest + 1, "code.exe");
    const itsChild = started(40, 10, killedAtLatest + 2, "git.exe");
    const windows = fakeWindows([[started(10, 1, 100)], [started(10, 1, 100)], [reusedPid, itsChild]]);
    await windows.killTree(10);
    expect(windows.kills).toEqual([[10]]);
  });

  test("settles once the tree as it stands is dead, and looks for late starters after", async () => {
    const shell = started(10, 1, 100);
    const program = started(20, 10, 200);
    const lateStarter = started(30, 10, 300);
    const kills: number[][] = [];
    const snapshots = [[shell, program], [shell, program], [lateStarter]];
    const snapshot = () => snapshots.shift() ?? [];
    const { lateStartersKilled } = await killProcessTree(10, { snapshot, kill: async (pids) => void kills.push(pids), lookAgainAfterMs: [0] });
    expect(kills).toEqual([[10, 20]]);
    await lateStartersKilled;
    expect(kills).toEqual([[10, 20], [30]]);
  });

  test("kills a pid the snapshot doesn't show all the same", async () => {
    const windows = fakeWindows([[]]);
    await windows.killTree(10);
    expect(windows.kills).toEqual([[10]]);
  });
});

test.if(process.platform === "win32")("on Windows the snapshot has this process with its parent, program and start", () => {
  const startedAtMs = Date.now() - process.uptime() * 1000;
  const thisProcess = processSnapshot().find(({ pid }) => pid === process.pid);
  expect(thisProcess).toMatchObject({ parentPid: process.ppid, name: "bun.exe" });
  expect(Math.abs(thisProcess!.startedAt / 1000 - startedAtMs)).toBeLessThan(1000);
});

const isRunning = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test.if(process.platform === "win32")("on Windows a cmd.exe's programs are named, and killing its tree ends what they started too", async () => {
  const directory = mkdtempSync(join(tmpdir(), "mirador-process-tree-"));
  const startingAnother = "const child = Bun.spawn([process.execPath, '-e', 'setTimeout(() => {}, 60000)']); console.log(child.pid); await child.exited";
  const viaCmd = Bun.spawn([fakeProgram(directory, "starter", startingAnother)], { stdout: "pipe" });
  const grandchild = Number(new TextDecoder().decode((await viaCmd.stdout.getReader().read()).value).trim());
  try {
    expect(childProgramNames(viaCmd.pid)).toContain("bun");
    await killProcessTree(viaCmd.pid);
    await viaCmd.exited;
    const deadline = Date.now() + 5_000;
    while (isRunning(grandchild) && Date.now() < deadline) await Bun.sleep(50);
    expect(isRunning(grandchild)).toBe(false);
  } finally {
    if (isRunning(grandchild)) process.kill(grandchild);
    rmSync(directory, { recursive: true, force: true });
  }
}, 20_000);
