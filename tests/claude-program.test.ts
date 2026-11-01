import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeProgramLookUps, claudeProgramMissing, claudeProgramReport, findClaudeProgram, versionOf } from "../host/acp/claude-program.ts";
import { launchEnvironment } from "../host/acp/harnesses.ts";
import { claudeConfigDir } from "../host/terminal-sessions.ts";
import { englishProblem } from "../shared/host-problems.ts";
import type { ClaudeProgram, Profile } from "../shared/model.ts";
import { fakeProgram } from "./fake-program.ts";

const programIn = (directory: string, name: string, script = `console.log("9.9.9 (Claude Code)");`) => fakeProgram(directory, name, script);
const hangs = (seconds: number) => `setTimeout(() => {}, ${seconds * 1000});`;

const scratch = () => mkdtempSync(join(tmpdir(), "claude-program-"));

/** The state letter follows the last ") ": the program's name before it, in parentheses, may itself hold spaces and parentheses. */
const isZombie = (pid: number) => {
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  return stat[stat.lastIndexOf(") ") + 2] === "Z";
};

/** A zombie has ended, and waits only for whatever adopted it to reap it, which nothing may do while the test runs. */
const isRunning = (pid: number) => {
  try {
    if (process.platform === "linux") return !isZombie(pid);
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** taskkill ends the program under a claude.cmd a moment after cmd.exe; a program sent SIGKILL is gone at once. */
const KILL_GRACE_MS = process.platform === "win32" ? 3_000 : 0;
/** SIGKILL reaches a whole process group asynchronously, and on a loaded CI runner takes seconds to. */
const GROUP_KILL_GRACE_MS = 10_000;

async function runsOnAfter(pid: number, graceMs: number) {
  const deadline = Date.now() + graceMs;
  while (isRunning(pid) && Date.now() < deadline) await Bun.sleep(20);
  return isRunning(pid);
}

test("without a program set, claude is found on PATH; a program set in Settings is used only if it can run", () => {
  const onPath = scratch();
  const claude = programIn(onPath, "claude");
  expect(findClaudeProgram("", onPath)).toBe(claude);

  const elsewhere = programIn(scratch(), "claude-nightly");
  expect(findClaudeProgram(elsewhere, onPath)).toBe(elsewhere);
  expect(findClaudeProgram(join(scratch(), "missing"), onPath)).toBeNull();
});

test("Settings shows the program found and the version it reports", async () => {
  const program = programIn(scratch(), "claude");
  const reports: ClaudeProgram[] = [];
  await claudeProgramLookUps((reported) => reports.push(reported))(program);
  expect(reports).toEqual([
    claudeProgramReport(program, program, null),
    claudeProgramReport(program, program, "9.9.9 (Claude Code)"),
  ]);

  const missing = join(scratch(), "missing");
  const missingReports: ClaudeProgram[] = [];
  await claudeProgramLookUps((reported) => missingReports.push(reported))(missing);
  expect(missingReports).toEqual([claudeProgramReport(missing, null, null)]);
});

test("Settings shows the program found while its version is still unknown", async () => {
  const program = programIn(scratch(), "claude", hangs(30));
  const reports: ClaudeProgram[] = [];
  const lookUp = claudeProgramLookUps((reported) => reports.push(reported), 1000)(program);
  expect(reports).toEqual([claudeProgramReport(program, program, null)]);
  await lookUp;
});

test("a lookup overtaken by a newer one does not report over it", async () => {
  const directory = scratch();
  const hanging = programIn(directory, "hanging", hangs(30));
  const working = programIn(directory, "working");
  const reports: ClaudeProgram[] = [];
  const lookUp = claudeProgramLookUps((reported) => reports.push(reported), 4000);
  const staleLookUp = lookUp(hanging);
  await lookUp(working);
  await staleLookUp;
  expect(reports.at(-1)).toEqual(claudeProgramReport(working, working, "9.9.9 (Claude Code)"));
}, 15_000);

test("a claude that hangs on --version is given up on and killed, on Windows with what its claude.cmd runs, and left as found with no version", async () => {
  const directory = scratch();
  const pidFile = join(directory, "pid");
  const hanging = programIn(directory, "hanging", `require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); ${hangs(30)}`);
  expect(await versionOf(hanging, 2000)).toBeNull();
  expect(existsSync(pidFile)).toBe(true);
  expect(await runsOnAfter(Number(readFileSync(pidFile, "utf8")), KILL_GRACE_MS)).toBe(false);
}, 15_000);

test("a version check is given up on within its timeout when a wrapper's child holds stdout open", async () => {
  const wrapper = programIn(scratch(), "wrapper", `require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(hangs(6))}], { stdio: ["ignore", "inherit", "ignore"] }); ${hangs(6)}`);
  const started = Date.now();
  expect(await versionOf(wrapper, 2000)).toBeNull();
  expect(Date.now() - started).toBeLessThan(4000);
});

test("a version check that times out on a wrapper ends the program the wrapper started", async () => {
  const directory = scratch();
  const pidFile = join(directory, "grandchild-pid");
  const grandchild = `require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); ${hangs(30)}`;
  const wrapper = programIn(directory, "wrapper", `require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(grandchild)}], { stdio: "ignore" }); ${hangs(30)}`);
  expect(await versionOf(wrapper, 2000)).toBeNull();
  expect(await runsOnAfter(Number(readFileSync(pidFile, "utf8")), GROUP_KILL_GRACE_MS)).toBe(false);
}, 15_000);

test("a version check is given up on within its timeout when the program ignores SIGTERM", async () => {
  const ignoresTerm = programIn(scratch(), "ignores-term", `process.on("SIGTERM", () => {}); ${hangs(5)}`);
  const started = Date.now();
  expect(await versionOf(ignoresTerm, 2000)).toBeNull();
  expect(Date.now() - started).toBeLessThan(4000);
});

test("Claude Code's agent is told which program to run, a profile may name its own, and a missing one says how to install it", () => {
  const program = programIn(scratch(), "claude");
  expect(launchEnvironment("claude", null, program).CLAUDE_CODE_EXECUTABLE).toBe(program);
  expect(launchEnvironment("opencode", null, program).CLAUDE_CODE_EXECUTABLE).toBeUndefined();

  const profile = { name: "Work", environment: "CLAUDE_CODE_EXECUTABLE=/opt/work/claude" } as Profile;
  expect(launchEnvironment("claude", profile, program).CLAUDE_CODE_EXECUTABLE).toBe("/opt/work/claude");

  const missing = join(scratch(), "missing");
  expect(() => launchEnvironment("claude", null, missing)).toThrow(`The Claude Code program set in Settings › Agents, ${missing}, does not exist or cannot run.`);
});

test("without Claude Code, the host names the folders it looked in and the install command for its own platform", () => {
  expect(englishProblem(claudeProgramMissing("", "darwin"))).toBe(
    "Claude Code is not installed: no claude on PATH or in ~/.local/bin, /opt/homebrew/bin or /usr/local/bin. Install it with `curl -fsSL https://claude.ai/install.sh | bash`, or set its path in Settings › Agents.",
  );
  expect(englishProblem(claudeProgramMissing("", "win32"))).toBe(
    "Claude Code is not installed: no claude on PATH or in %USERPROFILE%\\.local\\bin. Install it with `irm https://claude.ai/install.ps1 | iex`, or set its path in Settings › Agents.",
  );
  expect(claudeProgramReport("", null, null)).toMatchObject({ installCommand: process.platform === "win32" ? "irm https://claude.ai/install.ps1 | iex" : "curl -fsSL https://claude.ai/install.sh | bash" });
});

test("Claude Code's agent environment inherits CLAUDE_CONFIG_DIR from the host environment, and a profile may override it", () => {
  const program = programIn(scratch(), "claude");
  const isolatedDir = join(scratch(), "claude-config");
  const original = process.env.CLAUDE_CONFIG_DIR;
  try {
    process.env.CLAUDE_CONFIG_DIR = isolatedDir;
    expect(launchEnvironment("claude", null, program).CLAUDE_CONFIG_DIR).toBe(isolatedDir);

    const defaultProfile = { name: "Default", environment: "CLAUDE_CODE_MAX_RETRIES=0" } as Profile;
    const defaultEnv = launchEnvironment("claude", defaultProfile, program);
    expect(defaultEnv.CLAUDE_CONFIG_DIR).toBe(isolatedDir);
    expect(claudeConfigDir(defaultEnv)).toBe(isolatedDir);

    const customProfile = { name: "Custom", environment: "CLAUDE_CONFIG_DIR=/custom/dir" } as Profile;
    const customEnv = launchEnvironment("claude", customProfile, program);
    expect(customEnv.CLAUDE_CONFIG_DIR).toBe("/custom/dir");
    expect(claudeConfigDir(customEnv)).toBe("/custom/dir");
  } finally {
    if (original === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = original;
  }
});
