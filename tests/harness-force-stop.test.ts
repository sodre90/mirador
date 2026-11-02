import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessProcess } from "../host/acp/harness.ts";
import type { AgentGone } from "../shared/host-problems.ts";

/** Traps SIGTERM and stays alive, as claude-agent-acp does while its cleanup waits on a wedged turn. */
const stubbornAgent = `
process.on("SIGTERM", () => {});
process.stdin.on("data", (chunk) => {
  for (const line of chunk.toString().split("\\n")) {
    if (!line.trim()) continue;
    const request = JSON.parse(line);
    if (request.id !== undefined) {
      const result = { protocolVersion: request.params.protocolVersion, agentCapabilities: {} };
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\\n");
    }
  }
});
process.stdin.resume();
`;

describe("HarnessProcess.stop", () => {
  test("settles only once the agent process has really died, killing even one that traps its stop signal", async () => {
    const directory = mkdtempSync(join(tmpdir(), "mirador-harness-stop-"));
    const script = join(directory, "stubborn-agent.js");
    writeFileSync(script, stubbornAgent);
    let exitedReason: AgentGone | null = null;
    const harness = new HarnessProcess(
      { id: "claude", label: "Stubborn agent", logName: "stubborn", command: [process.execPath, script], environment: {}, prelaunch: "", startsOneAtATime: false },
      { onSessionUpdate: () => {}, onPermissionRequest: async () => ({ outcome: { outcome: "cancelled" } } as never), onElicitationRequest: async () => ({ action: "cancel" }), onExit: (_harness, reason) => void (exitedReason = reason) },
      directory,
    );
    await harness.start();
    await harness.stop({ kind: "force-stopped" });
    expect(exitedReason as AgentGone | null).toEqual({ kind: "force-stopped" });
  }, 15_000);
});
