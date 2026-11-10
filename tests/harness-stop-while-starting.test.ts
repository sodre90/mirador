import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessProcess, type HarnessSpec } from "../host/acp/harness.ts";
import { englishAgentGone } from "../shared/host-problems.ts";

const answeringAgent = (spawnedMarker: string) => `
require("node:fs").writeFileSync(${JSON.stringify(spawnedMarker)}, "");
process.stdin.on("data", (chunk) => {
  for (const line of chunk.toString().split("\\n")) {
    if (!line.trim()) continue;
    const request = JSON.parse(line);
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { protocolVersion: request.params.protocolVersion, agentCapabilities: {} } }) + "\\n");
  }
});
process.stdin.resume();
`;

const silentAgent = `process.stdin.resume();`;

/** Its first process refuses initialize and takes a moment to go away once stopped; every later one answers. */
const agentRefusingItsFirstStart = (spawns: string, refused: string) => `
const fs = require("node:fs");
fs.appendFileSync(${JSON.stringify(spawns)}, process.pid + "\\n");
const refusing = !fs.existsSync(${JSON.stringify(refused)});
if (refusing) {
  fs.writeFileSync(${JSON.stringify(refused)}, "");
  setInterval(() => {}, 1000);
  process.on("SIGTERM", () => setTimeout(() => process.exit(0), 200));
}
process.stdin.on("data", (chunk) => {
  for (const line of chunk.toString().split("\\n")) {
    if (!line.trim()) continue;
    const request = JSON.parse(line);
    if (request.id === undefined) continue;
    const reply = refusing
      ? { error: { code: -32603, message: "no thanks" } }
      : { result: request.method === "initialize" ? { protocolVersion: request.params.protocolVersion, agentCapabilities: {} } : { sessionId: "answered" } };
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, ...reply }) + "\\n");
  }
});
process.stdin.resume();
`;

function harnessRunning(agentSource: string, { initializeTimeoutMs = 10_000, ...spec }: Partial<HarnessSpec> & { initializeTimeoutMs?: number } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "mirador-harness-stop-while-starting-"));
  const script = join(directory, "agent.js");
  writeFileSync(script, agentSource);
  const exits: string[] = [];
  const harness = new HarnessProcess(
    {
      id: "opencode",
      label: "Test",
      logName: "test",
      command: [process.execPath, script],
      environment: { ...process.env } as Record<string, string>,
      prelaunch: "",
      startsOneAtATime: false,
      ...spec,
    },
    {
      onSessionUpdate: () => {},
      onPermissionRequest: async () => ({ outcome: { outcome: "cancelled" } }) as never,
      onElicitationRequest: async () => ({ action: "cancel" }),
      onExit: (_harness, reason) => void exits.push(englishAgentGone(reason)),
    },
    directory,
    initializeTimeoutMs,
  );
  return { harness, exits };
}

async function until(condition: () => boolean, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("timed out waiting");
    await Bun.sleep(20);
  }
}

const isRunning = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const markers = () => {
  const directory = mkdtempSync(join(tmpdir(), "mirador-harness-markers-"));
  return { prelaunched: join(directory, "prelaunched"), spawned: join(directory, "spawned"), spawns: join(directory, "spawns"), refused: join(directory, "refused") };
};

const spawnedPids = (spawns: string) =>
  readFileSync(spawns, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map(Number);

describe.skipIf(process.platform === "win32")("HarnessProcess.stop while the agent starts", () => {
  test("a stop during the pre-launch command ends the start there, and no agent process starts after it", async () => {
    const { prelaunched, spawned } = markers();
    const { harness, exits } = harnessRunning(answeringAgent(spawned), { prelaunch: `touch '${prelaunched}'; sleep 1` });
    const starting = harness.start();
    await until(() => existsSync(prelaunched));
    await expect(harness.stop()).resolves.toEqual({ kind: "stopped" });
    expect(exits).toEqual(["was stopped"]);
    await expect(starting).rejects.toThrow("The Test agent process was stopped.");
    await Bun.sleep(300);
    expect(existsSync(spawned)).toBe(false);
  }, 15_000);

  test("a start right after a stop during the pre-launch command begins afresh rather than joining the stopped start", async () => {
    const { prelaunched, spawned } = markers();
    const { harness } = harnessRunning(answeringAgent(spawned), { prelaunch: `touch '${prelaunched}'; sleep 1` });
    const starting = harness.start();
    await until(() => existsSync(prelaunched));
    await harness.stop();
    const restarting = harness.start();
    await expect(starting).rejects.toThrow("The Test agent process was stopped.");
    await expect(restarting).resolves.toMatchObject({ agentCapabilities: {} });
    expect(existsSync(spawned)).toBe(true);
    await harness.stop();
  }, 20_000);

  test("a stop ends a pre-launch command that takes long, so the start ends without waiting it out", async () => {
    const { prelaunched, spawned } = markers();
    const { harness } = harnessRunning(answeringAgent(spawned), { prelaunch: `touch '${prelaunched}'; sleep 10` });
    const starting = harness.start();
    await until(() => existsSync(prelaunched));
    const stoppedAt = Date.now();
    await harness.stop();
    await expect(starting).rejects.toThrow("The Test agent process was stopped.");
    expect(Date.now() - stoppedAt).toBeLessThan(3000);
    expect(existsSync(spawned)).toBe(false);
  }, 20_000);

  test("a stop while the start waits behind another of its kind that starts one at a time ends it before its pre-launch command runs", async () => {
    const { prelaunched, spawned } = markers();
    const { harness: stalled } = harnessRunning(silentAgent, { startsOneAtATime: true, initializeTimeoutMs: 500 });
    const { harness: queued, exits } = harnessRunning(answeringAgent(spawned), { startsOneAtATime: true, prelaunch: `touch '${prelaunched}'` });
    const stalledStart = expect(stalled.start()).rejects.toThrow("did not answer");
    const queuedStart = queued.start();
    await expect(queued.stop()).resolves.toEqual({ kind: "stopped" });
    await expect(queuedStart).rejects.toThrow("The Test agent process was stopped.");
    expect(exits).toEqual(["was stopped"]);
    await stalledStart;
    await Bun.sleep(300);
    expect(existsSync(prelaunched)).toBe(false);
    expect(existsSync(spawned)).toBe(false);
  }, 15_000);
});

describe.skipIf(process.platform === "win32")("HarnessProcess.start again after a failed start", () => {
  test("the failed start's process going away during the next start's pre-launch command leaves that start be", async () => {
    const { spawns, refused } = markers();
    const { harness, exits } = harnessRunning(agentRefusingItsFirstStart(spawns, refused), { prelaunch: "sleep 1" });
    await expect(harness.start()).rejects.toThrow("no thanks");
    await expect(harness.start()).resolves.toMatchObject({ agentCapabilities: {} });
    const [failed, answering] = spawnedPids(spawns);
    await until(() => !isRunning(failed!));
    await Bun.sleep(100);

    expect(exits).toEqual([]);
    await expect(harness.newSession({ cwd: tmpdir(), mcpServers: [] })).resolves.toMatchObject({ sessionId: "answered" });
    await harness.start();
    expect(spawnedPids(spawns)).toHaveLength(2);

    await harness.stop();
    await until(() => !isRunning(answering!));
    expect(exits).toEqual(["was stopped"]);
  }, 20_000);
});
