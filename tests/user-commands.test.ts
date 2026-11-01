import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UserCommandRunner } from "../host/user-commands.ts";
import type { ConversationEvent, StoredEvent } from "../shared/model.ts";
import { awaitingDelivery, outputOf, userCommandsIn, withCommandOutputs } from "../shared/user-commands.ts";

const stored = (events: ConversationEvent[]): StoredEvent[] => events.map((event, index) => ({ seq: index + 1, at: index, event }));

const ranAndEnded = (commandId: string, command: string, stdout: string, stderr = ""): ConversationEvent[] => [
  { type: "user-command", commandId, command },
  { type: "user-command-output", commandId, stream: "stdout", text: stdout },
  ...(stderr ? [{ type: "user-command-output", commandId, stream: "stderr", text: stderr } as const] : []),
  { type: "user-command-ended", commandId, exitCode: 0 },
];

test("finished commands wait for the next message; sent, dropped and still-running ones do not", () => {
  const commands = userCommandsIn(
    stored([
      ...ranAndEnded("sent", "git log -1", "abc"),
      { type: "user-message", text: "look", attachedCommandIds: ["sent"] },
      ...ranAndEnded("dropped", "ls", "a b"),
      { type: "user-command-dropped", commandIds: ["dropped"] },
      ...ranAndEnded("waiting", "git status -s", " M web/Hint.tsx\n"),
      { type: "user-command", commandId: "running", command: "sleep 9" },
    ]),
  );
  expect(commands.map(({ commandId, delivery, ended }) => [commandId, delivery, ended])).toEqual([
    ["sent", "sent", true],
    ["dropped", "dropped", true],
    ["waiting", "pending", true],
    ["running", "pending", false],
  ]);
  expect(awaitingDelivery(commands).map(({ commandId }) => commandId)).toEqual(["waiting"]);
});

test("a command whose output went with a message the agent never answered waits for the next message again", () => {
  const commands = userCommandsIn(
    stored([
      ...ranAndEnded("c1", "git status", "clean"),
      { type: "user-message", text: "and this", attachedCommandIds: ["c1"] },
      { type: "steered-messages-returned", seqs: [4], commandIds: ["c1"] },
    ]),
  );
  expect(awaitingDelivery(commands).map(({ commandId }) => commandId)).toEqual(["c1"]);
});

test("the agent gets each command and its output in Claude Code's tags ahead of the message, long output cut in the middle", () => {
  const long = `${"a".repeat(10_000)}${"b".repeat(5_000)}${"c".repeat(20_000)}`;
  const commands = userCommandsIn(stored([...ranAndEnded("1", "git status -s", " M x\n", "warning\n"), ...ranAndEnded("2", "cat big", long)]));
  const prompt = withCommandOutputs(commands, "What changed?");
  expect(prompt).toStartWith("<bash-input>git status -s</bash-input>\n<bash-stdout> M x\n</bash-stdout><bash-stderr>warning\n</bash-stderr>\n\n<bash-input>cat big</bash-input>");
  expect(prompt).toContain(`<bash-stdout>${"a".repeat(10_000)}\n… 5000 characters cut …\n${"c".repeat(20_000)}</bash-stdout>`);
  expect(prompt).toEndWith("</bash-stderr>\n\nWhat changed?");
  expect(withCommandOutputs([], "Just this")).toBe("Just this");
});

/** Git Bash, which runs the commands on Windows, names folders its own way (/tmp, /c/Users), so a program prints it. */
const printWorkingDirectory = `"${process.execPath}" -e "console.log(process.cwd())"`;

const programWritingItsPid = `"${process.execPath}" -e "require('fs').writeFileSync('pid', String(process.pid)); setTimeout(() => {}, 30000)"`;

/** A stopped program ends at once, but a loaded CI runner can take seconds to get it there. */
const PROGRAM_ENDS_WITHIN_MS = 10_000;

const isRunning = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test("the runner records a command's output by stream, its exit code, and can stop it with whatever it started", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "mirador-commands-")));
  const runner = new UserCommandRunner();
  const events: ConversationEvent[] = [];
  try {
    await runner.run(`${printWorkingDirectory}; echo oops >&2; exit 3`, directory, { PATH: process.env.PATH!, HOME: directory }, (event) => events.push(event));
    const [finished] = userCommandsIn(stored(events));
    expect(outputOf(finished!, "stdout")).toBe(`${directory}\n`);
    expect(outputOf(finished!, "stderr")).toBe("oops\n");
    expect(finished).toMatchObject({ command: `${printWorkingDirectory}; echo oops >&2; exit 3`, ended: true, exitCode: 3 });

    events.length = 0;
    const running = runner.run(`${programWritingItsPid}; echo after`, directory, { PATH: process.env.PATH!, HOME: directory }, (event) => events.push(event));
    while (!existsSync(join(directory, "pid"))) await Bun.sleep(10);
    const program = Number(readFileSync(join(directory, "pid"), "utf8"));
    const commandId = (events[0] as { commandId: string }).commandId;
    expect(runner.isRunning(commandId)).toBe(true);
    const stoppedAt = Date.now();
    runner.stop(commandId);
    await running;
    expect(Date.now() - stoppedAt).toBeLessThan(2_000);
    expect(userCommandsIn(stored(events))[0]).toMatchObject({ ended: true, exitCode: null, chunks: [] });
    const deadline = Date.now() + PROGRAM_ENDS_WITHIN_MS;
    while (isRunning(program) && Date.now() < deadline) await Bun.sleep(20);
    expect(isRunning(program)).toBe(false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 15_000);
