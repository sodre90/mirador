import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessProcess, type HarnessSpec } from "../host/acp/harness.ts";

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

function harnessRunning(agentSource: string, { initializeTimeoutMs = 10_000, ...spec }: Partial<HarnessSpec> & { initializeTimeoutMs?: number } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "mirador-harness-stop-while-starting-"));
  const script = join(directory, "agent.js");
  writeFileSync(script, agentSource);
  return new HarnessProcess(
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
    { onSessionUpdate: () => {}, onPermissionRequest: async () => ({ outcome: { outcome: "cancelled" } }) as never, onElicitationRequest: async () => ({ action: "cancel" }), onExit: () => {} },
    directory,
    initializeTimeoutMs,
  );
}

async function until(condition: () => boolean, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("timed out waiting");
    await Bun.sleep(20);
  }
}

const markers = () => {
  const directory = mkdtempSync(join(tmpdir(), "mirador-harness-markers-"));
  return { prelaunched: join(directory, "prelaunched"), spawned: join(directory, "spawned") };
};

describe.skipIf(process.platform === "win32")("HarnessProcess.stop while the agent starts", () => {
  test("a stop during the pre-launch command ends the start there, and no agent process starts after it", async () => {
    const { prelaunched, spawned } = markers();
    const harness = harnessRunning(answeringAgent(spawned), { prelaunch: `touch '${prelaunched}'; sleep 1` });
    const starting = harness.start();
    await until(() => existsSync(prelaunched));
    await harness.stop();
    await expect(starting).rejects.toThrow("The Test agent process was stopped.");
    await Bun.sleep(300);
    expect(existsSync(spawned)).toBe(false);
  }, 15_000);

  test("a stop while the start waits behind another of its kind that starts one at a time ends it before its pre-launch command runs", async () => {
    const { prelaunched, spawned } = markers();
    const stalled = harnessRunning(silentAgent, { startsOneAtATime: true, initializeTimeoutMs: 500 });
    const queued = harnessRunning(answeringAgent(spawned), { startsOneAtATime: true, prelaunch: `touch '${prelaunched}'` });
    const stalledStart = expect(stalled.start()).rejects.toThrow("did not answer");
    const queuedStart = queued.start();
    await queued.stop();
    await expect(queuedStart).rejects.toThrow("The Test agent process was stopped.");
    await stalledStart;
    await Bun.sleep(300);
    expect(existsSync(prelaunched)).toBe(false);
    expect(existsSync(spawned)).toBe(false);
  }, 15_000);
});
