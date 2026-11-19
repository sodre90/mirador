import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, spyOn, test } from "bun:test";
import { sessionsOpenInTerminals, TerminalSessionWatcher } from "../host/terminal-sessions.ts";

async function exitedProcessId() {
  const finished = Bun.spawn([process.execPath, "-e", ""]);
  await finished.exited;
  return finished.pid;
}

test("finds sessions open in a running terminal Claude Code, busiest first, ignoring the app's own and stale ones", async () => {
  const configDir = mkdtempSync(join(tmpdir(), "mirador-registry-"));
  const sessions = join(configDir, "sessions");
  mkdirSync(sessions);
  const register = (name: string, registration: object) => writeFileSync(join(sessions, `${name}.json`), JSON.stringify(registration));
  const running = process.pid;
  register("1", { pid: running, sessionId: "in-two-terminals", entrypoint: "cli", status: "idle" });
  register("2", { pid: running, sessionId: "in-two-terminals", entrypoint: "cli", status: "busy" });
  register("3", { pid: running, sessionId: "waiting", entrypoint: "cli", status: "waiting" });
  register("4", { pid: running, sessionId: "the-apps-own", entrypoint: "sdk-ts", status: "busy" });
  register("5", { pid: await exitedProcessId(), sessionId: "terminal-closed", entrypoint: "cli", status: "busy" });
  writeFileSync(join(sessions, "6.json"), "{ half-written");

  expect(Object.fromEntries(await sessionsOpenInTerminals(configDir))).toEqual({ "in-two-terminals": "working", waiting: "waiting" });
  expect(await sessionsOpenInTerminals(join(configDir, "missing"))).toEqual(new Map());
});

test("a poll that keeps failing is logged once, and again once it fails after a poll that worked", async () => {
  const logged = spyOn(console, "error").mockImplementation(() => {});
  const until = async (condition: () => boolean) => {
    while (!condition()) await Bun.sleep(5);
  };
  let failing = true;
  let polls = 0;
  let pollsThatWorked = 0;
  const configDirs = () => {
    polls += 1;
    if (failing) throw new Error("the store is closed");
    return [];
  };
  const watcher = new TerminalSessionWatcher(configDirs, () => (pollsThatWorked += 1), 5);
  try {
    watcher.start();
    await until(() => polls >= 4);
    expect(logged).toHaveBeenCalledTimes(1);
    failing = false;
    await until(() => pollsThatWorked > 0);
    failing = true;
    await until(() => logged.mock.calls.length === 2);
    expect(String(logged.mock.calls[1]![1])).toContain("the store is closed");
  } finally {
    watcher.stop();
    logged.mockRestore();
  }
});
