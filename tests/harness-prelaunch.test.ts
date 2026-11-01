import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessProcess } from "../host/acp/harness.ts";

describe("HarnessProcess.start", () => {
  test("reports a failing pre-launch command with what it wrote, which it adds to the agent's log after the earlier lines", async () => {
    const directory = mkdtempSync(join(tmpdir(), "mirador-prelaunch-"));
    const log = join(directory, "proxied.log");
    writeFileSync(log, "an earlier start\n");
    const harness = new HarnessProcess(
      {
        id: "claude",
        label: "Proxied agent",
        logName: "proxied",
        command: [process.execPath, "-e", ""],
        environment: { ...process.env } as Record<string, string>,
        prelaunch: "echo starting; echo 'proxy binary missing' >&2; exit 3",
        startsOneAtATime: false,
      },
      { onSessionUpdate: () => {}, onPermissionRequest: async () => ({ outcome: { outcome: "cancelled" } }) as never, onExit: () => {} },
      directory,
    );
    await expect(harness.start()).rejects.toThrow("The pre-launch command of Proxied agent exited with 3: starting\nproxy binary missing");
    expect(readFileSync(log, "utf8")).toStartWith("an earlier start\nstarting\nproxy binary missing\n");
  }, 15_000);

  test.skipIf(process.platform === "win32")("gives the login shell the pre-launch command as written, so fish or csh reads its own syntax", async () => {
    const directory = mkdtempSync(join(tmpdir(), "mirador-prelaunch-"));
    const shell = join(directory, "own-syntax-shell");
    writeFileSync(shell, `#!/bin/sh\nprintf '%s' "$2" > '${join(directory, "given")}'\nexec /bin/sh -c "$2"\n`);
    chmodSync(shell, 0o755);
    const prelaunch = "echo from the login shell; exit 3";
    const harness = new HarnessProcess(
      {
        id: "claude",
        label: "Fish user's agent",
        logName: "fish",
        command: [process.execPath, "-e", ""],
        environment: { ...process.env } as Record<string, string>,
        prelaunch,
        startsOneAtATime: false,
      },
      { onSessionUpdate: () => {}, onPermissionRequest: async () => ({ outcome: { outcome: "cancelled" } }) as never, onExit: () => {} },
      directory,
    );
    const loginShell = process.env.SHELL;
    process.env.SHELL = shell;
    try {
      await expect(harness.start()).rejects.toThrow("The pre-launch command of Fish user's agent exited with 3: from the login shell");
    } finally {
      process.env.SHELL = loginShell;
    }
    expect(readFileSync(join(directory, "given"), "utf8")).toBe(prelaunch);
  }, 15_000);
});
