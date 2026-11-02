import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessProcess } from "../host/acp/harness.ts";

/** Answers initialize, advertising steering or not, and every steer with `outcome`. */
const agentSteeringWith = (steering: boolean, outcome: string) => `
process.stdin.on("data", (chunk) => {
  for (const line of chunk.toString().split("\\n")) {
    if (!line.trim()) continue;
    const request = JSON.parse(line);
    const result =
      request.method === "initialize"
        ? { protocolVersion: 1, agentCapabilities: {}, authMethods: [], _meta: { steering: { supported: ${steering} } } }
        : { outcome: ${JSON.stringify(outcome)} };
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\\n");
  }
});
process.stdin.resume();
`;

function harnessRunning(agentSource: string) {
  const directory = mkdtempSync(join(tmpdir(), "mirador-harness-steer-"));
  const script = join(directory, "agent.js");
  writeFileSync(script, agentSource);
  return new HarnessProcess(
    { id: "claude", label: "Test", logName: "test", command: [process.execPath, script], environment: {}, prelaunch: "", startsOneAtATime: false },
    { onSessionUpdate: () => {}, onPermissionRequest: async () => ({ outcome: { outcome: "cancelled" } } as never), onElicitationRequest: async () => ({ action: "cancel" }), onExit: () => {} },
    directory,
  );
}

describe("HarnessProcess.steer", () => {
  test("returns the agent's outcome, so a steer it refused can be told from one it took", async () => {
    const harness = harnessRunning(agentSteeringWith(true, "promptRequired"));
    await harness.start();
    expect(await harness.steer("session", [{ type: "text", text: "also this" }])).toBe("promptRequired");
    await harness.stop();
  }, 15_000);

  test("says the agent cannot steer when it does not advertise steering", async () => {
    const harness = harnessRunning(agentSteeringWith(false, "injected"));
    await harness.start();
    expect(await harness.steer("session", [{ type: "text", text: "also this" }])).toBe("unsupported");
    await harness.stop();
  }, 15_000);
});
