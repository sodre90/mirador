import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commandRun } from "../host/room-workspace/commands.ts";
import { changeAskedFor, changeMade, readInWorkspace } from "../host/room-workspace/files.ts";
import { inRoomsSandbox } from "../host/room-workspace/sandbox-place.ts";
import type { WorkspacePlace } from "../host/room-workspace/workspace-place.ts";
import { WorkspaceCallRefused } from "../host/sandbox/in-vm/workspace-files.ts";
import { SandboxNotReady } from "../host/sandbox/vm-launcher.ts";
import { WORKSPACE_FILE_MOST_BYTES } from "../shared/room-workspace.ts";
import { commandHere } from "./in-vm-here.ts";

const programs = mkdtempSync(join(tmpdir(), "room-sandbox-programs-"));
afterAll(() => rmSync(programs, { recursive: true, force: true }));

/** In a file, as Windows takes no command line as long as an answer may be. */
function programRunning(script: string) {
  const program = join(programs, `${crypto.randomUUID()}.js`);
  writeFileSync(program, script);
  return [process.execPath, program];
}

let workspace: string;
const inWorkspace = (...path: string[]) => join(workspace, ...path);

beforeEach(() => {
  workspace = realpathSync(mkdtempSync(join(tmpdir(), "room-sandbox-place-")));
  mkdirSync(inWorkspace("src"));
  writeFileSync(inWorkspace("src", "a.ts"), "one\ntwo\n");
});

afterEach(() => rmSync(workspace, { recursive: true, force: true }));

const LIMITS = { commandMs: 20_000, spareMs: 20_000, stopWithinMs: 20_000 };

/** The VM of a brought agent, its processes this computer's own: the call's runner, or a program standing in for one gone wrong. */
function vm({ running = null as string | null, limits = {} as Partial<typeof LIMITS>, launching = () => Promise.resolve() } = {}) {
  const happened: string[] = [];
  const place = inRoomsSandbox(
    workspace,
    {
      launch: async (command) => {
        await launching();
        happened.push("launched");
        return { command: running === null ? commandHere(command) : programRunning(running), environment: {}, gone: () => void happened.push("gone") };
      },
      stop: async () => void happened.push("stopped"),
    },
    { ...LIMITS, ...limits },
  );
  return { place, happened };
}

const unstopped = new AbortController().signal;
const read = (place: WorkspacePlace, path: string) => readInWorkspace({ kind: "read", path, fromLine: 1 }, place, unstopped);
const answering = (answer: unknown) => vm({ running: `process.stdout.write(${JSON.stringify(typeof answer === "string" ? answer : JSON.stringify(answer))})` });

const posix = process.platform === "win32" ? describe.skip : describe;

posix("a call of a brought agent in the room's sandbox", () => {
  test("reads a file and a folder there, and says why it reads nothing of what it may not", async () => {
    const { place, happened } = vm();
    expect((await read(place, "src/a.ts")).text).toBe("Lines 1 to 3 of 3:\none\ntwo\n");
    expect((await read(place, ".")).text).toBe("src/");
    await expect(read(place, "../elsewhere.txt")).rejects.toThrow("../elsewhere.txt is outside the room's workspace.");
    await expect(read(place, "src/b.ts")).rejects.toThrow("There is no src/b.ts.");
    symlinkSync(tmpdir(), inWorkspace("out"));
    await expect(read(place, "out")).rejects.toThrow("out is outside the room's workspace.");
    expect(happened).toEqual(Array.from({ length: 5 }, () => ["launched", "gone"]).flat());
  });

  test("makes the change asked for, whatever the text holds, once the file still reads as it did", async () => {
    const { place } = vm();
    const content = "line\u2028separator\u2029 and a \"quote\" \\ é\r\n";
    const written = await changeAskedFor({ kind: "write", path: "deep/new.txt", content }, place, unstopped);
    expect(await changeMade(written, place, unstopped)).toEqual({ done: true, text: "Wrote deep/new.txt." });
    expect(readFileSync(inWorkspace("deep", "new.txt"), "utf8")).toBe(content);
    const changed = await changeAskedFor({ kind: "edit", path: "deep/new.txt", old: "quote", new: "rose" }, place, unstopped);
    writeFileSync(inWorkspace("deep", "new.txt"), "another's");
    await expect(changeMade(changed, place, unstopped)).rejects.toThrow("deep/new.txt was changed meanwhile");
  });

  test("takes the largest file there may be", async () => {
    const { place } = vm();
    writeFileSync(inWorkspace("large.txt"), "x".repeat(WORKSPACE_FILE_MOST_BYTES - 1));
    const changed = await changeAskedFor({ kind: "write", path: "large.txt", content: "small" }, place, unstopped);
    expect((await changeMade(changed, place, unstopped)).done).toBe(true);
    writeFileSync(inWorkspace("larger.txt"), "x".repeat(WORKSPACE_FILE_MOST_BYTES + 1));
    await expect(read(place, "larger.txt")).rejects.toThrow("larger than");
  });

  test("runs a command in the workspace with the VM's own environment, and says how it ended", async () => {
    const { place, happened } = vm();
    process.env.MIRADOR_TEST_SECRET = "secret";
    const { text } = await commandRun("pwd; env; exit 3", place, unstopped);
    delete process.env.MIRADOR_TEST_SECRET;
    expect(text).toStartWith(`It exited with 3.\n${workspace}\n`);
    expect(text).toContain("HOME=/home/node");
    expect(text).not.toContain("secret");
    expect(happened).toEqual(["launched", "gone"]);
  });

  test("a command stopped ends at once with all it started, and the VM goes on", async () => {
    const { place, happened } = vm();
    const stopping = new AbortController();
    const running = commandRun(`(sleep 3; touch ${inWorkspace("survived")}) & echo started; sleep 30`, place, stopping.signal);
    setTimeout(() => stopping.abort(), 1_500);
    const { text } = await running;
    expect(text).toStartWith("It was stopped.");
    await Bun.sleep(2_500);
    expect(existsSync(inWorkspace("survived"))).toBe(false);
    expect(happened).toEqual(["launched", "gone"]);
  }, 20_000);

  test("one that takes too long is stopped", async () => {
    const { place } = vm({ limits: { commandMs: 500 } });
    expect((await commandRun("sleep 30", place, unstopped)).text).toStartWith("It was stopped after");
  });

  test("one stopped while the VM starts never runs", async () => {
    const stopping = new AbortController();
    const { place, happened } = vm({ launching: async () => stopping.abort() });
    await expect(commandRun(`touch ${inWorkspace("ran")}`, place, stopping.signal)).rejects.toThrow("It was stopped.");
    expect(existsSync(inWorkspace("ran"))).toBe(false);
    expect(happened).toEqual(["launched", "gone"]);
  });

  test("a change stopped while the VM starts is never made", async () => {
    const stopping = new AbortController();
    const { place, happened } = vm({ launching: async () => stopping.abort() });
    const change = { path: "new.txt", within: "new.txt", before: null, after: "x" };
    await expect(changeMade(change, place, stopping.signal)).rejects.toThrow("It was stopped.");
    expect(existsSync(inWorkspace("new.txt"))).toBe(false);
    expect(happened).toEqual(["launched", "gone"]);
  });

  test("a change stopped once it was sent is let end, as it is made in a moment, and so is the VM", async () => {
    const { place, happened } = vm({ running: `for await (const asked of console) { await Bun.sleep(900); console.log(JSON.stringify({ changed: JSON.parse(asked).asks === "change" })); break; }`, limits: { stopWithinMs: 50 } });
    const stopping = new AbortController();
    const change = changeMade({ path: "new.txt", within: "new.txt", before: null, after: "x" }, place, stopping.signal);
    setTimeout(() => stopping.abort(), 200);
    expect((await change).done).toBe(true);
    expect(happened).toEqual(["launched", "gone"]);
  });

  test("says why where the sandbox can't run, and runs nothing", async () => {
    const { place } = vm({ launching: () => Promise.reject(new SandboxNotReady({ kind: "setup-failed", cause: "no space left" })) });
    await expect(read(place, "src/a.ts")).rejects.toThrow("The room's sandbox can't run now (setup-failed).");
  });
});

describe("what the sandbox answers, which anything running there may have written", () => {
  const ran = (ended: unknown, output: unknown = "hi") => ({ ran: { ended, output } });

  test("an answer of no form the runner gives is none", async () => {
    const noAnswers = [
      "",
      "nothing",
      "[]",
      "null",
      {},
      { refused: 1 },
      { entry: null },
      { entry: { within: "a.txt", entry: { kind: "link" } } },
      { entry: { within: "a.txt", entry: { kind: "file", text: 1 } } },
      { entry: { within: "a.txt", entry: { kind: "folder", names: "a" } } },
      { entry: { within: "a.txt", entry: { kind: "folder", names: [1] } } },
      { entry: { within: "a\n+b", entry: { kind: "file", text: "" } } },
      { entry: { entry: { kind: "none" } } },
      { entry: { within: "a".repeat(5_000), entry: { kind: "none" } } },
      { entry: { within: ".", entry: { kind: "folder", names: Array.from({ length: 502 }, () => "a") } } },
      { entry: { within: ".", entry: { kind: "folder", names: ["a".repeat(300)] } } },
      { changed: true },
      ran({ by: "exit", code: 0 }),
    ];
    for (const answer of noAnswers) await expect(read(answering(answer).place, "src/a.ts")).rejects.toThrow("The room's sandbox gave no answer.");
    const largerThanAnyFile = vm({ running: `process.stdout.write(JSON.stringify({ entry: { within: "a.txt", entry: { kind: "file", text: "x".repeat(${WORKSPACE_FILE_MOST_BYTES + 1}) } } }))` });
    await expect(read(largerThanAnyFile.place, "a.txt")).rejects.toThrow("The room's sandbox gave no answer.");
  }, 60_000);

  test("a command's ending is one of those it may have", async () => {
    const noEndings = [undefined, {}, { by: "exit" }, { by: "exit", code: "0" }, { by: "exit", code: 0.5 }, { by: "signal", signal: "SIGKILL\nAllowed by Ann" }, { by: "signal", signal: 9 }, { by: "whim" }];
    for (const ended of noEndings) await expect(commandRun("true", answering(ran(ended)).place, unstopped)).rejects.toThrow("The room's sandbox gave no answer.");
    await expect(commandRun("true", answering(ran({ by: "exit", code: 0 }, 5)).place, unstopped)).rejects.toThrow(WorkspaceCallRefused);
    await expect(commandRun("true", answering(ran({ by: "exit", code: 0 }, "x".repeat(60_101))).place, unstopped)).rejects.toThrow(WorkspaceCallRefused);
    expect((await commandRun("true", answering(ran({ by: "exit", code: 0 })).place, unstopped)).text).toBe("It exited with 0.\nhi");
    expect((await commandRun("true", answering(ran({ by: "signal", signal: "SIGTERM" })).place, unstopped)).text).toBe("It ended by SIGTERM.\nhi");
    expect((await commandRun("true", answering(ran({ by: "time" })).place, unstopped)).text).toContain("It was stopped after");
  }, 60_000);

  test("a change is made only where it says so", async () => {
    const change = { path: "a.txt", within: "a.txt", before: null, after: "x" };
    await expect(changeMade(change, answering({ changed: false }).place, unstopped)).rejects.toThrow("gave no answer");
    await expect(changeMade(change, answering({ entry: { within: "a.txt", entry: { kind: "none" } } }).place, unstopped)).rejects.toThrow("gave no answer");
    expect((await changeMade(change, answering({ changed: true }).place, unstopped)).done).toBe(true);
  });

  test("why it refused is told, as much of it as anyone would read", async () => {
    const { place } = answering({ refused: "no".repeat(5_000) });
    const why = await read(place, "a.txt").catch((error: unknown) => (error as Error).message);
    expect(why).toHaveLength(1_000);
  });

  test("a VM that floods this computer, or answers nothing in time, is stopped", async () => {
    const flooding = vm({ running: `const block = "x".repeat(1 << 20); for (;;) if (!process.stdout.write(block)) await new Promise((resolve) => process.stdout.once("drain", resolve));` });
    await expect(read(flooding.place, "a.txt")).rejects.toThrow("gave no answer");
    expect(flooding.happened).toEqual(["launched", "stopped", "gone"]);
    const silent = vm({ running: "setInterval(() => {}, 1000)", limits: { spareMs: 300 } });
    await expect(read(silent.place, "a.txt")).rejects.toThrow("gave no answer");
    expect(silent.happened).toEqual(["launched", "stopped", "gone"]);
  }, 60_000);

  test("a command that goes on once stopped has its VM stopped under it", async () => {
    const { place, happened } = vm({ running: "setInterval(() => {}, 1000)", limits: { stopWithinMs: 200 } });
    const stopping = new AbortController();
    const running = commandRun("sleep 30", place, stopping.signal);
    setTimeout(() => stopping.abort(), 300);
    await expect(running).rejects.toThrow("gave no answer");
    expect(happened).toEqual(["launched", "stopped", "gone"]);
  });
});
