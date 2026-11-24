import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commandRun } from "../host/room-workspace/commands.ts";
import { onThisComputer } from "../host/room-workspace/workspace-place.ts";

const folder = realpathSync(mkdtempSync(join(tmpdir(), "room-command-")));
afterAll(() => rmSync(folder, { recursive: true, force: true }));
const environment = { PATH: process.env.PATH ?? "", HOME: folder };
const run = (command: string, stopped = new AbortController().signal, timeoutMs?: number) => commandRun(command, onThisComputer(folder, join(folder, ".mirador"), () => environment, timeoutMs), stopped);

const posix = process.platform === "win32" ? describe.skip : describe;

posix("a command run in a room's workspace", () => {
  test("runs in the folder, without input, and says how it ended and what it wrote, errors too", async () => {
    expect(await run("pwd; echo oops >&2; cat; exit 3")).toEqual({ done: true, text: `It exited with 3.\n${folder}\noops` });
  });

  test("has only the environment it is given", async () => {
    process.env.MIRADOR_TEST_SECRET = "secret";
    const { text } = await run("env");
    delete process.env.MIRADOR_TEST_SECRET;
    expect(text).not.toContain("secret");
    expect(text).toContain(`HOME=${folder}`);
  });

  test("a long output keeps its start and its end", async () => {
    const { text } = await run("echo first; i=0; while [ $i -lt 20000 ]; do echo line-$i-xxxxxxxxxx; i=$((i+1)); done; echo last");
    expect(text).toContain("first");
    expect(text).toContain("characters left out");
    expect(text.endsWith("last")).toBe(true);
    expect(text.length).toBeLessThan(61_000);
  });

  test("one that takes too long is stopped, with all it started", async () => {
    const { text } = await run("sleep 30 & sleep 30; touch survived", undefined, 300);
    expect(text).toStartWith("It was stopped after");
    expect(existsSync(join(folder, "survived"))).toBe(false);
  });

  test("a stop ends it, and one stopped before it began never runs", async () => {
    const stopping = new AbortController();
    const running = run("sleep 30", stopping.signal);
    setTimeout(() => stopping.abort(), 100);
    expect((await running).text).toBe("It was stopped.");
    expect(await run("touch ran", stopping.signal)).toEqual({ done: true, text: "It was stopped." });
    expect(existsSync(join(folder, "ran"))).toBe(false);
  });

  test("what it left in the background holds nothing up and does not outlive it", async () => {
    const started = Date.now();
    const { text } = await run("(sleep 2; touch left-behind) & echo started");
    expect(text).toContain("started");
    expect(Date.now() - started).toBeLessThan(1_900);
    await Bun.sleep(2_300);
    expect(existsSync(join(folder, "left-behind"))).toBe(false);
  }, 15_000);

  test("a shell's own startup file is not read", async () => {
    await Bun.write(join(folder, ".zshenv"), "export FROM_ZSHENV=1\n");
    await Bun.write(join(folder, ".bashrc"), "export FROM_BASHRC=1\n");
    await Bun.write(join(folder, ".profile"), "export FROM_PROFILE=1\n");
    expect((await run("env")).text).not.toContain("FROM_");
  });
});
