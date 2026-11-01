import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessProcess } from "../host/acp/harness.ts";

describe("HarnessProcess.start", () => {
  test("fails only with the agent's exit when its log file can't be written, without an unhandled error", async () => {
    const directory = mkdtempSync(join(tmpdir(), "mirador-harness-log-"));
    mkdirSync(join(directory, "broken-log.log"));
    const harness = new HarnessProcess(
      { id: "claude", label: "Noisy agent", logName: "broken-log", command: [process.execPath, "-e", "console.error('noise'); process.exit(3)"], environment: {}, prelaunch: "", startsOneAtATime: false },
      { onSessionUpdate: () => {}, onPermissionRequest: async () => ({ outcome: { outcome: "cancelled" } } as never), onExit: () => {} },
      directory,
    );
    await expect(harness.start()).rejects.toThrow(/exited with 3/);
  }, 15_000);
});
