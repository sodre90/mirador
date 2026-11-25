// Runs a command for an agent someone brought, on this computer or inside a room's VM, which sees this folder alone:
// only node's and Bun's own here.

/** How much of an output is kept: so much of its start, and so much of its end. */
export interface OutputKeeping {
  ofTheStart: number;
  ofTheEnd: number;
}

/** A command, with the shell that runs it, the folder it runs in, all it has of an environment, and how long it may take. */
export interface CommandToRun {
  commandLine: string[];
  folder: string;
  environment: Record<string, string>;
  timeoutMs: number;
  keeping: OutputKeeping;
}

export type CommandEnded = { by: "time" | "stop" } | { by: "exit"; code: number } | { by: "signal"; signal: string };

export interface CommandRan {
  ended: CommandEnded;
  output: string;
}

/** How long what the shell left running may still write before it is killed. */
const LEFT_RUNNING_MS = 500;

/** The start and the end of an output, however long it gets. */
class OutputKept {
  private start = "";
  private end = "";
  private dropped = 0;

  constructor(private readonly keeping: OutputKeeping) {}

  add(text: string) {
    const toStart = text.slice(0, this.keeping.ofTheStart - this.start.length);
    this.start += toStart;
    const all = this.end + text.slice(toStart.length);
    this.end = all.slice(-this.keeping.ofTheEnd);
    this.dropped += all.length - this.end.length;
  }

  text() {
    return this.dropped === 0 ? this.start + this.end : `${this.start}\n… ${this.dropped} characters left out …\n${this.end}`;
  }
}

async function readInto(stream: ReadableStream<Uint8Array>, output: OutputKept) {
  const decoder = new TextDecoder();
  for await (const bytes of stream) output.add(decoder.decode(bytes, { stream: true }));
}

/** Kills the process and all it started that stayed in its group, all of it halted first: a shell whose command is killed before it is goes on to its next. */
export function killGroup(child: { pid: number; kill(signal: "SIGKILL"): void }) {
  try {
    process.kill(-child.pid, "SIGSTOP");
    process.kill(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}

const endedAs = (code: number, signal: NodeJS.Signals | number | null): CommandEnded => (signal === null ? { by: "exit", code } : { by: "signal", signal: `${signal}` });

/** Runs the command without input, in a process group of its own, and leaves nothing of that running. */
export async function runToItsEnd({ commandLine, folder, environment, timeoutMs, keeping }: CommandToRun, stopped: AbortSignal, killAll = killGroup): Promise<CommandRan> {
  if (stopped.aborted) return { ended: { by: "stop" }, output: "" };
  const child = Bun.spawn(commandLine, { cwd: folder, env: environment, detached: true, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const output = new OutputKept(keeping);
  const written = Promise.all([readInto(child.stdout, output), readInto(child.stderr, output)]).catch(() => {});
  let timedOut = false;
  const stop = () => killAll(child);
  const timer = setTimeout(() => {
    timedOut = true;
    stop();
  }, timeoutMs);
  stopped.addEventListener("abort", stop, { once: true });
  try {
    const code = await child.exited;
    await Promise.race([written, Bun.sleep(LEFT_RUNNING_MS)]);
    return { ended: timedOut ? { by: "time" } : stopped.aborted ? { by: "stop" } : endedAs(code, child.signalCode), output: output.text() };
  } finally {
    clearTimeout(timer);
    stopped.removeEventListener("abort", stop);
    killAll(child);
  }
}
