import type { Subprocess } from "bun";
import type { CommandStream, ConversationEvent } from "../shared/model.ts";
import { loginShell } from "./acp/environment.ts";
import { commandLine, commandShell } from "./command-shell.ts";
import { killProcessTree } from "./windows-processes.ts";

const OUTPUT_BATCH_MS = 200;
const MAX_KEPT_CHARACTERS = 1_000_000;

type Recorder = (event: ConversationEvent) => void;

/** Collects a command's output into a few events rather than one per read, and stops keeping it past a limit. */
class OutputBatcher {
  private pending: { stream: CommandStream; text: string } | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private kept = 0;

  constructor(
    private readonly commandId: string,
    private readonly record: Recorder,
  ) {}

  add(stream: CommandStream, text: string) {
    if (!text || this.kept >= MAX_KEPT_CHARACTERS) return;
    const room = MAX_KEPT_CHARACTERS - this.kept;
    const kept = text.length > room ? `${text.slice(0, room)}\n… output past ${MAX_KEPT_CHARACTERS.toLocaleString("en")} characters was not kept\n` : text;
    this.kept += text.length;
    if (this.pending && this.pending.stream !== stream) this.flush();
    this.pending = { stream, text: (this.pending?.text ?? "") + kept };
    this.timer ??= setTimeout(() => this.flush(), OUTPUT_BATCH_MS);
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.pending) this.record({ type: "user-command-output", commandId: this.commandId, ...this.pending });
    this.pending = null;
  }
}

/**
 * The command runs in a process group of its own, so stopping it also stops whatever the shell started. Windows has no
 * process groups, so there the process tree is killed.
 */
function stopProcessGroup(child: Subprocess) {
  if (process.platform === "win32") return void killProcessTree(child.pid);
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}

async function readInto(stream: ReadableStream<Uint8Array>, onText: (text: string) => void) {
  const decoder = new TextDecoder();
  for await (const bytes of stream) onText(decoder.decode(bytes, { stream: true }));
  onText(decoder.decode());
}

/** Runs `!` commands from the message box with the user's login shell, without input, recording them as conversation events. */
export class UserCommandRunner {
  private readonly running = new Map<string, Subprocess>();
  private readonly stopped = new Set<string>();

  isRunning(commandId: string) {
    return this.running.has(commandId);
  }

  async run(command: string, directory: string, environment: Record<string, string>, record: Recorder) {
    const commandId = crypto.randomUUID();
    record({ type: "user-command", commandId, command });
    const output = new OutputBatcher(commandId, record);
    let exitCode: number | null = null;
    try {
      const child = Bun.spawn(commandLine(commandShell(loginShell, environment), command, { login: true }), {
        cwd: directory,
        env: environment,
        detached: true,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      this.running.set(commandId, child);
      await Promise.all([readInto(child.stdout, (text) => output.add("stdout", text)), readInto(child.stderr, (text) => output.add("stderr", text))]);
      await child.exited;
      exitCode = child.signalCode || this.stopped.has(commandId) ? null : child.exitCode;
    } catch (error) {
      output.add("stderr", `${error instanceof Error ? error.message : String(error)}\n`);
    } finally {
      this.running.delete(commandId);
      this.stopped.delete(commandId);
      output.flush();
      record({ type: "user-command-ended", commandId, exitCode });
    }
  }

  stop(commandId: string) {
    const child = this.running.get(commandId);
    if (!child) return;
    this.stopped.add(commandId);
    stopProcessGroup(child);
  }

  /** Waits for the commands to exit, as the terminals' shutdown does for its shells. */
  async shutdown() {
    const exits = [...this.running.values()].map(({ exited }) => exited);
    [...this.running.keys()].forEach((commandId) => this.stop(commandId));
    await Promise.all(exits);
  }
}
