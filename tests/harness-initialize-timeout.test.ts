import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessProcess, type HarnessSpec } from "../host/acp/harness.ts";
import { englishAgentGone } from "../shared/host-problems.ts";

const silentAgent = `process.stdin.resume();`;

const refusingAgent = `
process.stdin.on("data", (chunk) => {
  for (const line of chunk.toString().split("\\n")) {
    if (!line.trim()) continue;
    const request = JSON.parse(line);
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -32603, message: "no thanks" } }) + "\\n");
  }
});
process.stdin.resume();
`;

function harnessRunning(agentSource: string, { initializeTimeoutMs = 10_000, ...spec }: Partial<HarnessSpec> & { initializeTimeoutMs?: number } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "mirador-harness-initialize-"));
  const script = join(directory, "agent.js");
  writeFileSync(script, agentSource);
  const exits: string[] = [];
  const harness = new HarnessProcess(
    { id: "opencode", label: "Test", logName: "test", command: [process.execPath, script], environment: {}, prelaunch: "", startsOneAtATime: false, ...spec },
    { onSessionUpdate: () => {}, onPermissionRequest: async () => ({ outcome: { outcome: "cancelled" } } as never), onExit: (_harness, reason) => void exits.push(englishAgentGone(reason)) },
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

describe("HarnessProcess.start", () => {
  test("gives up on an agent that never answers initialize, and stops its process", async () => {
    const { harness, exits } = harnessRunning(silentAgent, { initializeTimeoutMs: 300 });
    await expect(harness.start()).rejects.toThrow("The Test agent process did not answer within 0.3 s of starting.");
    expect(exits).toEqual(["did not answer within 0.3 s of starting"]);
  }, 15_000);

  test("lets the next agent of a kind that starts one at a time start once a stalled one gives up", async () => {
    const stalled = harnessRunning(silentAgent, { startsOneAtATime: true, initializeTimeoutMs: 300 });
    const next = harnessRunning(`
      process.stdin.on("data", (chunk) => {
        for (const line of chunk.toString().split("\\n")) {
          if (!line.trim()) continue;
          const request = JSON.parse(line);
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { protocolVersion: request.params.protocolVersion, agentCapabilities: {} } }) + "\\n");
        }
      });
      process.stdin.resume();
    `, { startsOneAtATime: true });
    const stalledStart = expect(stalled.harness.start()).rejects.toThrow("did not answer");
    await expect(next.harness.start()).resolves.toMatchObject({ agentCapabilities: {} });
    await stalledStart;
    await next.harness.stop();
  }, 15_000);

  test("stops the agent's process when it refuses initialize", async () => {
    const { harness, exits } = harnessRunning(refusingAgent);
    await expect(harness.start()).rejects.toThrow("no thanks");
    await until(() => exits.length > 0);
    expect(exits).toEqual(["was stopped"]);
  }, 15_000);
});
