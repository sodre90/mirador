import type { Subprocess } from "bun";
import { existsSync, readdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import type { TunnelPlaces } from "../../shared/tunnel.ts";
import { CANVAS_TUNNEL_PORT } from "./service.ts";
import type { DownloadedSidecar, SidecarDownload } from "./sidecar-download.ts";

/** The mirador-p2p binary this host dials other machines' tunnels with, and where to fetch it from the first time. */
export interface DialProgram {
  path: string;
  download?: SidecarDownload;
}

/**
 * The environment's binary, or the one this host downloads: dialing needs no broker of this host's own, as each
 * invite names the machine's, so it works whether or not this host takes devices in peer to peer itself.
 */
export function dialProgram(environment: Record<string, string | undefined>, downloaded: DownloadedSidecar | null): DialProgram | null {
  if (environment.MIRADOR_P2P_BINARY) return { path: environment.MIRADOR_P2P_BINARY };
  return downloaded && { path: downloaded.path, download: downloaded.download };
}

/** This end of a machine's tunnel: the file its private key is in, its address there, and the local port the machine's web server is reached at. */
export interface DialEnd {
  keyFile: string;
  address: string;
  places: TunnelPlaces;
  localPort: number;
}

/**
 * Where the forwards listen: IPv6's loopback, a host of its own to browsers, which send this host's sign-in cookie, set at
 * 127.0.0.1 where its sign-in links lead, to every port of 127.0.0.1 but never to [::1].
 */
export const DIAL_LOOPBACK = "::1";
export const dialOrigin = (port: number) => `http://[${DIAL_LOOPBACK}]:${port}`;

/**
 * `mirador-p2p dial`, forwarding the local port to the machine's web server and the port above it to its canvas
 * server, both on this computer's loopback alone. The canvas port is forwarded even when the machine names none, so it
 * never reaches whatever else listens there: the machine tells pages through the tunnel to load canvas pages from it.
 * Every value is one argument with its flag, never one of its own, and the private key stays in its file.
 */
export const dialCommand = (binary: string, { keyFile, address, places, localPort }: DialEnd) => [
  binary,
  "dial",
  "--udp=0.0.0.0:0",
  `--key-file=${keyFile}`,
  `--address=${address}`,
  `--peer=${places.hostKey}`,
  `--peer-address=${places.hostAddress}`,
  `--broker=${places.broker.address}`,
  `--broker-key=${places.broker.key}`,
  `--forward=[${DIAL_LOOPBACK}]:${localPort}=${places.port}`,
  `--forward=[${DIAL_LOOPBACK}]:${localPort + 1}=${places.canvasPort ?? CANVAS_TUNNEL_PORT}`,
];

const FIRST_RESTART_AFTER_MS = 1000;
const LAST_RESTART_AFTER_MS = 30_000;
const SETTLED_AFTER_MS = 60_000;
/** mirador-p2p binds its forwards before anything else, so one not seen listening by then never will be. */
const LISTENING_WAIT_MS = 10_000;
const LISTENING_CHECK_EVERY_MS = 100;

/** What a dial's pid file holds, to tell it apart from another process that took its pid since. */
interface DialRecord {
  pid: number;
  keyFile: string;
}

/**
 * A dial's forwards while one process of it runs: from when the system shows that process listening at both of them,
 * so no other account on this computer took a port first, until it exits.
 */
export interface Forward {
  origin: string;
  /** False from the moment its process is seen to exit, after which its ports may be anyone's. */
  running: boolean;
}

type DialProcess = Subprocess<"ignore", "ignore", "pipe">;

const hasExited = (process: DialProcess) => process.exitCode !== null || process.signalCode !== null;

/**
 * Runs one `mirador-p2p dial`, which keeps running when its stdin closes, unlike the sidecar: so its pid is written
 * down beside its key file while it runs, for a host that was killed to stop it at its next start. Each process forwards
 * from a fresh pair of ports, never one a process before it had, which anyone may have taken since. One that exits on
 * its own starts again, slower each time, unless it `restarts` not.
 */
export class Dial {
  private process: DialProcess | null = null;
  private forward: Forward | null = null;
  private starting: Promise<Forward | null> | null = null;
  private portBefore: number | null = null;
  private restartAfter = FIRST_RESTART_AFTER_MS;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(
    private readonly commandFor: (localPort: number) => string[],
    private readonly record: { pidFile: string; keyFile: string },
    private readonly log: (line: string) => void,
    private readonly options: { avoidedPorts?: number[]; restarts?: boolean } = {},
  ) {}

  start() {
    if (this.stopped) return;
    const starting = this.run();
    this.starting = starting;
    void starting.finally(() => {
      if (this.starting === starting) this.starting = null;
    });
  }

  /** The forwards of the process running now, once it is seen listening at them, waiting for one that is starting; null while none runs. */
  current(): Promise<Forward | null> {
    return this.starting ?? Promise.resolve(this.forward);
  }

  /** At once and without waiting, so it also works as the host exits. */
  stop() {
    this.stopped = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    if (this.forward) this.forward.running = false;
    this.forward = null;
    this.process?.kill();
    this.process = null;
    rmSync(this.record.pidFile, { force: true });
  }

  private async run(): Promise<Forward | null> {
    const startedAt = Date.now();
    let localPort: number;
    let process: DialProcess;
    try {
      const avoided = [...(this.options.avoidedPorts ?? []), ...(this.portBefore === null ? [] : [this.portBefore, this.portBefore + 1])];
      localPort = await freeLoopbackPortPair(avoided);
      this.portBefore = localPort;
      if (this.stopped) return null;
      process = Bun.spawn(this.commandFor(localPort), { stdin: "ignore", stdout: "ignore", stderr: "pipe", env: { ...Bun.env, RUST_LOG: "warn" } });
    } catch (error) {
      this.log(`did not start: ${error instanceof Error ? error.message : String(error)}`);
      this.startAgainLater();
      return null;
    }
    this.process = process;
    this.writeRecordOf(process.pid);
    void this.logLinesOf(process.stderr);
    const forward: Forward = { origin: dialOrigin(localPort), running: false };
    void process.exited.then((code) => {
      forward.running = false;
      if (this.forward === forward) this.forward = null;
      if (this.process !== process) return;
      this.process = null;
      if (this.stopped) return;
      if (Date.now() - startedAt > SETTLED_AFTER_MS) this.restartAfter = FIRST_RESTART_AFTER_MS;
      this.log(`exited with ${code}`);
      this.startAgainLater();
    });
    const isRunningNow = () => this.process === process && !this.stopped && !hasExited(process);
    if (!(await seenListening(process.pid, [localPort, localPort + 1], isRunningNow))) {
      if (isRunningNow()) {
        this.log(`was not seen listening at its forwards on [${DIAL_LOOPBACK}]:${localPort} and the port above, so it is stopped`);
        process.kill();
      }
      return null;
    }
    forward.running = true;
    this.forward = forward;
    return forward;
  }

  private writeRecordOf(pid: number) {
    const written: DialRecord = { pid, keyFile: this.record.keyFile };
    try {
      writeFileSync(this.record.pidFile, JSON.stringify(written), { mode: 0o600 });
    } catch (error) {
      this.log(`runs, but a host killed meanwhile won't find it to stop: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private startAgainLater() {
    if (this.stopped || this.options.restarts === false) return;
    this.restartTimer = setTimeout(() => this.start(), this.restartAfter);
    this.restartAfter = Math.min(this.restartAfter * 2, LAST_RESTART_AFTER_MS);
  }

  private async logLinesOf(stream: ReadableStream<Uint8Array>) {
    const decoder = new TextDecoder();
    let unfinished = "";
    for await (const bytes of stream) {
      const lines = (unfinished + decoder.decode(bytes, { stream: true })).split("\n");
      unfinished = lines.pop() ?? "";
      lines.filter(Boolean).forEach(this.log);
    }
    if (unfinished) this.log(unfinished);
  }
}

/** True once the system shows the process listening at every one of the ports, for as long as it runs and at most a while. */
async function seenListening(pid: number, ports: number[], isRunningNow: () => boolean) {
  for (const deadline = Date.now() + LISTENING_WAIT_MS; Date.now() < deadline && isRunningNow(); await Bun.sleep(LISTENING_CHECK_EVERY_MS)) {
    const listening = await loopbackPortsListenedAtBy(pid);
    if (ports.every((port) => listening.includes(port))) return isRunningNow();
  }
  return false;
}

/** ::1 as /proc/net/tcp6 writes it: four 32-bit words, each in the computer's own byte order. */
const LOOPBACK_IN_PROC_NET = ["00000000000000000000000001000000", "00000000000000000000000000000001"];
const LISTEN_IN_PROC_NET = "0A";

/** The ports on IPv6's loopback that the sockets with these inodes listen at, from the lines of /proc/net/tcp6. */
export function loopbackPortsInProcNet(tcp6: string, socketInodes: string[]) {
  return tcp6.split("\n").flatMap((line) => {
    const [, local = "", , state, , , , , , inode = ""] = line.trim().split(/\s+/);
    const [address, port] = local.split(":");
    const listensOnLoopback = state === LISTEN_IN_PROC_NET && LOOPBACK_IN_PROC_NET.includes(address ?? "") && socketInodes.includes(inode);
    return listensOnLoopback ? [parseInt(port ?? "", 16)] : [];
  });
}

/** The ports on IPv6's loopback in what `lsof -Fn` lists of a process's listening sockets. */
export const loopbackPortsInLsof = (listed: string) =>
  listed.split("\n").flatMap((line) => {
    const port = /^n\[::1\]:(\d+)$/.exec(line)?.[1];
    return port ? [Number(port)] : [];
  });

/** The ports on IPv6's loopback the process listens at, in what `netstat -ano -p TCPv6` lists; a listening socket's far end is [::]:0, whatever the state is called in the system's language. */
export const loopbackPortsInNetstat = (listed: string, pid: number) =>
  listed.split("\n").flatMap((line) => {
    const [, port, owner] = /^\s*TCP\s+\[::1\]:(\d+)\s+\[::\]:0\s+\S+\s+(\d+)\s*$/.exec(line) ?? [];
    return port && Number(owner) === pid ? [Number(port)] : [];
  });

async function outputOf(command: string[]) {
  try {
    const listing = Bun.spawn(command, { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
    const output = await new Response(listing.stdout).text();
    return (await listing.exited) === 0 ? output : "";
  } catch {
    return "";
  }
}

/** procfs files say they are empty, so they are read to their end rather than by their size. */
function procFile(path: string) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function socketInodesOf(pid: number) {
  const folder = `/proc/${pid}/fd`;
  try {
    return readdirSync(folder).flatMap((fd) => {
      try {
        return /^socket:\[(\d+)\]$/.exec(readlinkSync(join(folder, fd)))?.slice(1) ?? [];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

/** The ports on IPv6's loopback the process listens at, as the system tells: /proc on Linux, netstat on Windows, lsof elsewhere. */
export async function loopbackPortsListenedAtBy(pid: number): Promise<number[]> {
  if (process.platform === "linux") {
    return loopbackPortsInProcNet(procFile(`/proc/${pid}/net/tcp6`), socketInodesOf(pid));
  }
  if (process.platform === "win32") return loopbackPortsInNetstat(await outputOf(["netstat", "-ano", "-p", "TCPv6"]), pid);
  return loopbackPortsInLsof(await outputOf(["/usr/sbin/lsof", "-nP", "-a", "-p", String(pid), "-iTCP", "-sTCP:LISTEN", "-Fn"]));
}

function recordIn(pidFile: string): DialRecord | null {
  try {
    const { pid, keyFile } = JSON.parse(readFileSync(pidFile, "utf8")) as Partial<DialRecord>;
    return Number.isInteger(pid) && typeof keyFile === "string" ? { pid: pid!, keyFile } : null;
  } catch {
    return null;
  }
}

/** The process's whole command line, never cut to a terminal's width, or null where it is gone or the system won't say. */
function commandOf(pid: number) {
  if (process.platform === "win32") return null;
  const listed = Bun.spawnSync(["ps", "-ww", "-o", "command=", "-p", String(pid)], { stdout: "pipe", stderr: "ignore" });
  return listed.success ? listed.stdout.toString().trim() : null;
}

/** Only a dial of this host's, with the key file it was started with, never whatever process took its pid since. */
const isDialOf = (command: string | null, { keyFile }: DialRecord) => command !== null && / dial /.test(command) && command.includes(`--key-file=${keyFile}`);

function stopProcess(pid: number) {
  try {
    process.kill(pid);
  } catch {
    // It ended since it was looked at
  }
}

/**
 * Stops the dials a host that was killed left running, by the pid files in `folder`, and takes away the one-time keys
 * of joins it never finished. Windows has no ps to tell a dial from another process, so there a dial left behind runs on
 * until it is stopped by hand; it reaches nothing without this host's device token.
 */
export function stopLeftOverDials(folder: string, commandOfPid: (pid: number) => string | null = commandOf) {
  if (!existsSync(folder)) return;
  const files = readdirSync(folder);
  files
    .filter((file) => file.endsWith(".pid"))
    .forEach((file) => {
      const pidFile = join(folder, file);
      const record = recordIn(pidFile);
      if (record && isDialOf(commandOfPid(record.pid), record)) stopProcess(record.pid);
      rmSync(pidFile, { force: true });
    });
  files.filter((file) => file.startsWith("join-")).forEach((file) => rmSync(join(folder, file), { force: true }));
}

const freeLoopbackPort = (port = 0) =>
  new Promise<number | null>((resolve) => {
    const server = createServer()
      .once("error", () => resolve(null))
      .listen(port, DIAL_LOOPBACK, () => {
        const { port: taken } = server.address() as { port: number };
        server.close(() => resolve(taken));
      });
  });

/** A free port on the dials' loopback with a free one above it, for the canvas server's forward, and neither among `avoided`. */
export async function freeLoopbackPortPair(avoided: number[] = []) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const port = await freeLoopbackPort();
    if (port === null || port >= 65535 || avoided.includes(port) || avoided.includes(port + 1)) continue;
    if ((await freeLoopbackPort(port + 1)) !== null) return port;
  }
  throw new Error("There is no free pair of ports on this computer's loopback to reach the machine's tunnel at.");
}
