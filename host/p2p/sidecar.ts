import type { Subprocess } from "bun";

/** A device the sidecar lets in, and the Unix socket its tunnel connections go to. */
export interface SidecarPin {
  key: string;
  address: string;
  socket: string;
}

function parsedLine(line: string): { broker?: unknown } | null {
  try {
    const parsed: unknown = JSON.parse(line);
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

const FIRST_RESTART_AFTER_MS = 1000;
const LAST_RESTART_AFTER_MS = 30_000;
/** A sidecar that ran this long had settled, so its next crash restarts it quickly again. */
const SETTLED_AFTER_MS = 60_000;

/**
 * Runs `mirador-p2p sidecar` and tells it which devices to let in, one JSON line each on its stdin. It stops when its
 * stdin closes, so it never outlives the host. When it exits on its own, it starts again, slower each time, and is
 * told every pin again.
 */
export class Sidecar {
  private process: Subprocess<"pipe", "pipe", "pipe"> | null = null;
  private readonly pins = new Map<string, SidecarPin>();
  private restartAfter = FIRST_RESTART_AFTER_MS;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(
    private readonly command: string[],
    private readonly log: (line: string) => void = (line) => console.log(`p2p: ${line}`),
    /** Called each time the sidecar says the broker started or stopped answering, and with false when it exits. */
    private readonly brokerContact: (reached: boolean) => void = () => {},
  ) {}

  start() {
    const startedAt = Date.now();
    let process: Subprocess<"pipe", "pipe", "pipe">;
    try {
      process = Bun.spawn(this.command, { stdin: "pipe", stdout: "pipe", stderr: "pipe", env: { ...Bun.env, RUST_LOG: Bun.env.RUST_LOG ?? "info" } });
    } catch (error) {
      this.log(`the sidecar did not start: ${error instanceof Error ? error.message : String(error)}`);
      return this.startAgainLater();
    }
    this.process = process;
    void this.linesOf(process.stderr, this.log);
    void this.linesOf(process.stdout, (line) => this.heard(line));
    this.pins.forEach((pin) => this.send({ pin }));
    void process.exited.then((code) => {
      if (this.process !== process) return;
      this.process = null;
      this.brokerContact(false);
      if (this.stopped) return;
      if (Date.now() - startedAt > SETTLED_AFTER_MS) this.restartAfter = FIRST_RESTART_AFTER_MS;
      this.log(`the sidecar exited with ${code}`);
      this.startAgainLater();
    });
  }

  private startAgainLater() {
    this.log(`starting the sidecar again in ${this.restartAfter / 1000} s`);
    this.restartTimer = setTimeout(() => this.start(), this.restartAfter);
    this.restartAfter = Math.min(this.restartAfter * 2, LAST_RESTART_AFTER_MS);
  }

  pin(pin: SidecarPin) {
    this.pins.set(pin.key, pin);
    this.send({ pin });
  }

  unpin(key: string) {
    if (this.pins.delete(key)) this.send({ unpin: { key } });
  }

  stop() {
    this.stopped = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    if (!this.process) return;
    const { stdin } = this.process;
    this.process = null;
    void Promise.resolve()
      .then(() => stdin.end())
      .catch(() => {});
  }

  /** A sidecar that just died has a closed stdin until its exit is noticed; what it misses is sent again when it restarts. */
  private send(command: { pin: SidecarPin } | { unpin: { key: string } }) {
    const stdin = this.process?.stdin;
    if (!stdin) return;
    void Promise.resolve()
      .then(() => {
        stdin.write(`${JSON.stringify(command)}\n`);
        return stdin.flush();
      })
      .catch(() => {});
  }

  /** What the sidecar tells the host on stdout, one JSON line each; anything else there is only logged. */
  private heard(line: string) {
    const told = parsedLine(line);
    if (told?.broker === "reached" || told?.broker === "lost") this.brokerContact(told.broker === "reached");
    else this.log(line);
  }

  private async linesOf(stream: ReadableStream<Uint8Array>, take: (line: string) => void) {
    const decoder = new TextDecoder();
    let unfinished = "";
    for await (const bytes of stream) {
      const lines = (unfinished + decoder.decode(bytes, { stream: true })).split("\n");
      unfinished = lines.pop() ?? "";
      lines.filter(Boolean).forEach(take);
    }
    if (unfinished) take(unfinished);
  }
}
