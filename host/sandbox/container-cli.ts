/** What a run of Apple's `container` command gave: its exit code, its output, stdout and stderr together, and stdout alone. */
export interface ContainerRun {
  exitCode: number;
  output: string;
  stdout: string;
}

export interface ContainerRunOptions {
  /** Each line it prints, as it prints it, for progress. */
  onLine?: (line: string) => void;
  timeoutMs?: number;
  /** What it reads on stdin. */
  input?: string;
  /** The most of stdout kept, from its start; more fails the run. */
  stdoutMostBytes?: number;
}

/** Apple's `container` command line, which runs Linux VMs on this Mac; a test gives a fake of it. */
export interface ContainerCli {
  readonly program: string;
  run(args: string[], options?: ContainerRunOptions): Promise<ContainerRun>;
}

const OUTPUT_KEPT_CHARACTERS = 20_000;
const STDOUT_MOST_BYTES = 1024 * 1024;

/** Each line of the stream, as it comes, a long one by its end; and its text, up to `most` bytes, or null once it said more. */
async function readLines(stream: ReadableStream<Uint8Array>, onLine: (line: string) => void, most = 0) {
  const decoder = new TextDecoder();
  const kept: Uint8Array[] = [];
  let size = 0;
  let pending = "";
  for await (const chunk of stream) {
    size += chunk.byteLength;
    if (size <= most) kept.push(chunk);
    pending += decoder.decode(chunk, { stream: true });
    const lines = pending.split(/\r?\n|\r/);
    pending = (lines.pop() ?? "").slice(-OUTPUT_KEPT_CHARACTERS);
    lines.forEach(onLine);
  }
  if (pending) onLine(pending);
  return size <= most ? new TextDecoder().decode(Buffer.concat(kept)) : null;
}

/** The `container` program at `program`, run with the host's own environment, which carries nothing into a VM by itself. */
export function containerCli(program: string): ContainerCli {
  return {
    program,
    async run(args, { onLine, timeoutMs = 120_000, input, stdoutMostBytes = STDOUT_MOST_BYTES } = {}) {
      const child = Bun.spawn([program, ...args], { stdin: input === undefined ? "ignore" : new Blob([input]), stdout: "pipe", stderr: "pipe", timeout: timeoutMs });
      let output = "";
      const keep = (line: string) => {
        output = `${output}${line}\n`.slice(-OUTPUT_KEPT_CHARACTERS);
        onLine?.(line);
      };
      const [stdout] = await Promise.all([readLines(child.stdout, keep, stdoutMostBytes), readLines(child.stderr, keep)]);
      const exitCode = await child.exited;
      return { exitCode: stdout === null && exitCode === 0 ? 1 : exitCode, output: output.trim(), stdout: stdout ?? "" };
    },
  };
}

/** The last line of what `container` said, for one plain message. */
export const lastLineOf = (output: string) => output.trim().split("\n").at(-1)?.trim().slice(0, 300) ?? "";
