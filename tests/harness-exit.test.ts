import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessProcess } from "../host/acp/harness.ts";
import { fakeProgram } from "./fake-program.ts";

/** Answers initialize and session/new, then dies with exit code 3 in the middle of the first prompt. */
const crashingAgent = `
process.stdin.on("data", (chunk) => {
  for (const line of chunk.toString().split("\\n")) {
    if (!line.trim()) continue;
    const request = JSON.parse(line);
    if (request.method === "session/prompt") setTimeout(() => process.exit(3), 50);
    else if (request.id !== undefined) {
      const result = request.method === "initialize" ? { protocolVersion: request.params.protocolVersion, agentCapabilities: {} } : { sessionId: "crashing" };
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\\n");
    }
  }
});
process.stdin.resume();
`;

/** Bun on Windows sometimes never reports the end of an exited agent's stdout; a child holding it open does the same anywhere. */
const crashingAgentWhoseChildHoldsItsOutput = `
require("node:child_process").spawn(process.execPath, ["-e", "setTimeout(() => {}, 10_000)"], { stdio: ["ignore", "inherit", "ignore"] });
${crashingAgent}`;

/** Bun on Windows ends an agent's own children with it, but not one started apart, as a tool's shell starts its programs. */
const crashingAgentWithAChildApart = (pidFile: string) => `
const child = require("node:child_process").spawn(process.execPath, ["-e", "setTimeout(() => {}, 30_000)"], { stdio: "ignore", detached: true });
require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(child.pid));
${crashingAgent}`;

const isRunning = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

function crashingHarness(agent = crashingAgent, onExit: (harness: HarnessProcess) => void = () => {}) {
  const directory = mkdtempSync(join(tmpdir(), "mirador-harness-exit-"));
  const script = join(directory, "crashing-agent.js");
  writeFileSync(script, agent);
  return new HarnessProcess(
    { id: "opencode", label: "Crashing agent", logName: "crashing", command: [process.execPath, script], environment: {}, prelaunch: "", startsOneAtATime: false },
    { onSessionUpdate: () => {}, onPermissionRequest: async () => ({ outcome: { outcome: "cancelled" } } as never), onElicitationRequest: async () => ({ action: "cancel" }), onExit },
    directory,
  );
}

/** taskkill ends the program under a .cmd a moment after cmd.exe. */
const KILL_GRACE_MS = process.platform === "win32" ? 3_000 : 0;

async function runsOnAfter(pid: number, graceMs: number) {
  const deadline = Date.now() + graceMs;
  while (isRunning(pid) && Date.now() < deadline) await Bun.sleep(20);
  return isRunning(pid);
}

describe("HarnessProcess.start", () => {
  test("starts an agent whose program is a script, on Windows a .cmd as npm installs opencode, in a folder whose name holds a space, and stopping it ends the program the script runs", async () => {
    const directory = join(mkdtempSync(join(tmpdir(), "mirador-harness-script-")), "npm global");
    mkdirSync(directory);
    const pidFile = join(directory, "agent.pid");
    const agentRecordingItsPid = `require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));\n${crashingAgent}`;
    const harness = new HarnessProcess(
      {
        id: "opencode",
        label: "Scripted agent",
        logName: "scripted",
        command: [fakeProgram(directory, "opencode", agentRecordingItsPid), "acp"],
        environment: { ...process.env } as Record<string, string>,
        prelaunch: "",
        startsOneAtATime: false,
      },
      { onSessionUpdate: () => {}, onPermissionRequest: async () => ({ outcome: { outcome: "cancelled" } } as never), onElicitationRequest: async () => ({ action: "cancel" }), onExit: () => {} },
      directory,
    );
    await harness.start();
    expect(await harness.newSession({ cwd: tmpdir(), mcpServers: [] })).toMatchObject({ sessionId: "crashing" });
    expect(existsSync(pidFile)).toBe(true);
    const agentPid = Number(readFileSync(pidFile, "utf8"));
    await harness.stop();
    expect(await runsOnAfter(agentPid, KILL_GRACE_MS)).toBe(false);
  }, 15_000);
});

describe("HarnessProcess.prompt", () => {
  test("fails with how the agent process went away when it dies during the turn, not with a closed connection", async () => {
    const harness = crashingHarness();
    await harness.start();
    const { sessionId } = await harness.newSession({ cwd: tmpdir(), mcpServers: [] });
    await expect(harness.prompt(sessionId, [{ type: "text", text: "hello" }])).rejects.toThrow("The Crashing agent agent process exited with 3.");
  }, 15_000);

  test("fails with how its own agent process went away, even when the next one starts while that one's output is still open", async () => {
    let startedAgain: Promise<unknown> | undefined;
    const harness = crashingHarness(crashingAgentWhoseChildHoldsItsOutput, (exited) => {
      startedAgain ??= exited.start();
    });
    await harness.start();
    const { sessionId } = await harness.newSession({ cwd: tmpdir(), mcpServers: [] });
    await expect(harness.prompt(sessionId, [{ type: "text", text: "hello" }])).rejects.toThrow("The Crashing agent agent process exited with 3.");
    await startedAgain;
    await harness.stop();
  }, 15_000);

  test("fails with how the agent process went away even when its output never ends", async () => {
    const harness = crashingHarness(crashingAgentWhoseChildHoldsItsOutput);
    await harness.start();
    const { sessionId } = await harness.newSession({ cwd: tmpdir(), mcpServers: [] });
    await expect(harness.prompt(sessionId, [{ type: "text", text: "hello" }])).rejects.toThrow("The Crashing agent agent process exited with 3.");
  }, 5_000);

  test("fails with the reason the host gave when it stops the agent during the turn", async () => {
    const harness = crashingHarness();
    await harness.start();
    const { sessionId } = await harness.newSession({ cwd: tmpdir(), mcpServers: [] });
    const prompt = harness.prompt(sessionId, [{ type: "text", text: "hello" }]);
    void harness.stop({ kind: "restarted-for-profile" });
    await expect(prompt).rejects.toThrow("The Crashing agent agent process was restarted because its profile changed.");
  }, 15_000);

  test("fails with that it was stopped when the host stops the agent during the turn without a reason, as at shutdown, on Windows too", async () => {
    const harness = crashingHarness();
    await harness.start();
    const { sessionId } = await harness.newSession({ cwd: tmpdir(), mcpServers: [] });
    const prompt = harness.prompt(sessionId, [{ type: "text", text: "hello" }]);
    void harness.stop();
    await expect(prompt).rejects.toThrow("The Crashing agent agent process was stopped.");
  }, 15_000);

  test("a stop while no agent process runs is not why the next one goes away", async () => {
    const harness = crashingHarness();
    await harness.stop();
    await harness.start();
    const { sessionId } = await harness.newSession({ cwd: tmpdir(), mcpServers: [] });
    await expect(harness.prompt(sessionId, [{ type: "text", text: "hello" }])).rejects.toThrow("The Crashing agent agent process exited with 3.");
  }, 15_000);

  test.if(process.platform === "win32")("on Windows stopping the agent ends what it started too, as no stop signal there lets the agent end it", async () => {
    const pidFile = join(mkdtempSync(join(tmpdir(), "mirador-harness-child-")), "child.pid");
    const harness = crashingHarness(crashingAgentWithAChildApart(pidFile));
    await harness.start();
    const child = Number(readFileSync(pidFile, "utf8"));
    expect(isRunning(child)).toBe(true);

    await harness.stop();
    const deadline = Date.now() + 3_000;
    while (isRunning(child) && Date.now() < deadline) await Bun.sleep(20);
    expect(isRunning(child)).toBe(false);
  }, 15_000);
});
