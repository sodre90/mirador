import type { Subprocess } from "bun";
import { existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import type { HostProblem } from "../../shared/host-problems.ts";
import { tunnelOrigin, type TunnelPlaces } from "../../shared/tunnel.ts";
import { CANVAS_TUNNEL_PORT, LONGEST_SOCKET_PATH } from "./service.ts";
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

/** How this host reaches one of a machine's servers: at `origin`, through the Unix socket `socket` where there is one. */
export interface Way {
  origin: string;
  socket: string | null;
}

export const atAddress = (origin: string): Way => ({ origin, socket: null });

/**
 * Through a Unix socket, the request still names the origin's host, as it does at the address. A redirect is handed
 * back, never followed: Bun follows one at the address the request names, off the socket, cookie and all.
 */
export const fetchThrough = (way: Way, path: string, init: RequestInit = {}) =>
  fetch(`${way.origin}${path}`, way.socket === null ? init : { ...init, unix: way.socket, redirect: "manual" });

/**
 * A WebSocket's URL on the way, and the headers it sends: Bun opens one through a Unix socket by a ws+unix URL, which
 * names no host, so it sends Host: localhost unless told, and a machine turns away an Origin of an address its Host isn't.
 */
export function webSocketTo(way: Way, path: string, headers: HeadersInit) {
  const sent = new Headers(headers);
  if (way.socket === null) return { url: `${way.origin.replace(/^http/, "ws")}${path}`, headers: sent };
  sent.set("host", new URL(way.origin).host);
  const url = `ws+unix://${way.socket}:${path}`;
  if (!new URL(url).pathname.startsWith(`${way.socket}:`)) throw new Error("A path that leads off the machine's socket is not asked for.");
  return { url, headers: sent };
}

/**
 * Dials forward from Unix sockets in a folder only this account can enter, where no other account on this computer can
 * connect, or put a socket of its own first, as any can at a port on the loopback. Windows dials forward from ports
 * still: Bun takes a WebSocket's Unix socket from a ws+unix URL, which ends the socket's path at its first colon, and a
 * Windows path has one after its drive letter.
 */
export const DIALS_THROUGH_SOCKETS = process.platform !== "win32";

/** Each process of a dial forwards from sockets in a folder made for it alone, named from this and six random characters. */
const SOCKET_FOLDER_PREFIX = "d";
/** The web server's socket and the canvas server's: single letters, as the whole path must fit a Unix socket's address. */
const WEB_SOCKET = "w";
const CANVAS_SOCKET = "c";

/**
 * Bun takes a WebSocket's Unix socket from a ws+unix URL, up to the first colon, as the URL parser writes its path: a
 * character it percent-encodes, such as a space or a letter outside ASCII, or one that starts a query or a fragment,
 * names another socket.
 */
function wsUnixUrlCarries(socket: string) {
  const parsed = URL.parse(`ws+unix://${socket}:/`);
  return parsed !== null && !socket.includes(":") && parsed.pathname === `${socket}:/` && parsed.search === "" && parsed.hash === "";
}

/** Why this host can't dial from sockets in `folder`, or null when it can. */
export function socketFolderProblem(folder: string): HostProblem | null {
  const longest = join(folder, `${SOCKET_FOLDER_PREFIX}XXXXXX`, WEB_SOCKET);
  if (Buffer.byteLength(longest) > LONGEST_SOCKET_PATH) return { code: "dial-folder-too-long", folder };
  if (!wsUnixUrlCarries(longest)) return { code: "dial-folder-unusable-character", folder };
  return null;
}

/** Where one process of a dial forwards from: two Unix sockets, or on Windows the port for the web server and the one above it. */
export type ForwardsFrom = { sockets: { web: string; canvas: string } } | { port: number };

/** This end of a machine's tunnel: the file its private key is in, its address there, and where the dial forwards from. */
export interface DialEnd {
  keyFile: string;
  /** The invite's private key file when joining with a key of this dial's own admitted through that invite. */
  admitKeyFile?: string;
  address: string;
  places: TunnelPlaces;
  from: ForwardsFrom;
}

/**
 * Where Windows dials' forwards listen: IPv6's loopback, a host of its own to browsers, which send this host's sign-in
 * cookie, set at 127.0.0.1 where its sign-in links lead, to every port of 127.0.0.1 but never to [::1].
 */
const DIAL_LOOPBACK = "::1";
const loopbackOrigin = (port: number) => `http://[${DIAL_LOOPBACK}]:${port}`;

const listenedAt = (from: ForwardsFrom) =>
  "sockets" in from ? [`unix:${from.sockets.web}`, `unix:${from.sockets.canvas}`] : [`[${DIAL_LOOPBACK}]:${from.port}`, `[${DIAL_LOOPBACK}]:${from.port + 1}`];

/**
 * `mirador-p2p dial`, forwarding to the machine's web server and to its canvas server. The canvas forward is there even
 * when the machine names no canvas server, so it never reaches whatever else listens there: the machine tells pages
 * through the tunnel to load canvas pages from it. Every value is one argument with its flag, never one of its own, and
 * the private key stays in its file.
 */
export function dialCommand(binary: string, { keyFile, admitKeyFile, address, places, from }: DialEnd) {
  const [web, canvas] = listenedAt(from);
  return [
    binary,
    "dial",
    "--udp=0.0.0.0:0",
    `--key-file=${keyFile}`,
    ...(admitKeyFile ? [`--admit-key-file=${admitKeyFile}`] : []),
    `--address=${address}`,
    `--peer=${places.hostKey}`,
    `--peer-address=${places.hostAddress}`,
    `--broker=${places.broker.address}`,
    `--broker-key=${places.broker.key}`,
    `--forward=${web}=${places.port}`,
    `--forward=${canvas}=${places.canvasPort ?? CANVAS_TUNNEL_PORT}`,
  ];
}

/** The machine's servers at their addresses in its tunnel, which requests through a dial's sockets name as their Host. */
export interface TunnelOrigins {
  web: string;
  canvas: string;
}

export const tunnelOriginsOf = (places: TunnelPlaces): TunnelOrigins => ({
  web: tunnelOrigin(places),
  canvas: tunnelOrigin({ ...places, port: places.canvasPort ?? CANVAS_TUNNEL_PORT }),
});

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

/** A dial's files: the folder only this account can enter, which its sockets go in too, and its pid and key files there. */
export interface DialFiles {
  folder: string;
  pidFile: string;
  keyFile: string;
}

/** A dial's ways to the machine while one process of it runs: from when that process is seen listening there, until it exits. */
export interface Forward {
  web: Way;
  canvas: Way;
  /** False from the moment its process is seen to exit, after which its sockets are gone, and on Windows its ports may be anyone's. */
  running: boolean;
}

const forwardFrom = (from: ForwardsFrom, origins: TunnelOrigins): Forward =>
  "sockets" in from
    ? { web: { origin: origins.web, socket: from.sockets.web }, canvas: { origin: origins.canvas, socket: from.sockets.canvas }, running: false }
    : { web: atAddress(loopbackOrigin(from.port)), canvas: atAddress(loopbackOrigin(from.port + 1)), running: false };

type DialProcess = Subprocess<"ignore", "ignore", "pipe">;

const hasExited = (process: DialProcess) => process.exitCode !== null || process.signalCode !== null;

/**
 * Runs one `mirador-p2p dial`, which keeps running when its stdin closes, unlike the sidecar: so its pid is written
 * down beside its key file while it runs, for a host that was killed to stop it at its next start. Each process forwards
 * from sockets in a folder made for it, which goes when it exits, or on Windows from a fresh pair of ports, never one a
 * process before it had, which anyone may have taken since. One that exits on its own starts again, slower each time,
 * unless it `restarts` not.
 */
export class Dial {
  private process: DialProcess | null = null;
  private forward: Forward | null = null;
  private starting: Promise<Forward | null> | null = null;
  private socketFolder: string | null = null;
  private portBefore: number | null = null;
  private restartAfter = FIRST_RESTART_AFTER_MS;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(
    private readonly commandFor: (from: ForwardsFrom) => string[],
    private readonly files: DialFiles,
    private readonly origins: TunnelOrigins,
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

  /** The forward of the process running now, once it is seen listening there, waiting for one that is starting; null while none runs. */
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
    this.removeSocketFolder();
    rmSync(this.files.pidFile, { force: true });
  }

  private async run(): Promise<Forward | null> {
    const startedAt = Date.now();
    let from: ForwardsFrom;
    let process: DialProcess;
    try {
      from = DIALS_THROUGH_SOCKETS ? this.freshSockets() : { port: await this.freshPorts() };
      if (this.stopped) return null;
      process = Bun.spawn(this.commandFor(from), { stdin: "ignore", stdout: "ignore", stderr: "pipe", env: { ...Bun.env, RUST_LOG: "warn" } });
    } catch (error) {
      this.removeSocketFolder();
      this.log(`did not start: ${error instanceof Error ? error.message : String(error)}`);
      this.startAgainLater();
      return null;
    }
    this.process = process;
    this.writeRecordOf(process.pid);
    void this.logLinesOf(process.stderr);
    const forward = forwardFrom(from, this.origins);
    void process.exited.then((code) => {
      forward.running = false;
      if (this.forward === forward) this.forward = null;
      if (this.process !== process) return;
      this.process = null;
      this.removeSocketFolder();
      if (this.stopped) return;
      if (Date.now() - startedAt > SETTLED_AFTER_MS) this.restartAfter = FIRST_RESTART_AFTER_MS;
      this.log(`exited with ${code}`);
      this.startAgainLater();
    });
    const isRunningNow = () => this.process === process && !this.stopped && !hasExited(process);
    if (!(await seenListening(process.pid, from, isRunningNow))) {
      if (isRunningNow()) {
        this.log(`was not seen listening at its forwards (${listenedAt(from).join(", ")}), so it is stopped`);
        process.kill();
      }
      return null;
    }
    forward.running = true;
    this.forward = forward;
    return forward;
  }

  /** In a folder made now, which nothing else was in before, inside this host's own that no other account can enter. */
  private freshSockets() {
    this.removeSocketFolder();
    const folder = mkdtempSync(join(this.files.folder, SOCKET_FOLDER_PREFIX));
    this.socketFolder = folder;
    return { sockets: { web: join(folder, WEB_SOCKET), canvas: join(folder, CANVAS_SOCKET) } };
  }

  private removeSocketFolder() {
    if (this.socketFolder) removeSocketFolder(this.socketFolder);
    this.socketFolder = null;
  }

  private async freshPorts() {
    const avoided = [...(this.options.avoidedPorts ?? []), ...(this.portBefore === null ? [] : [this.portBefore, this.portBefore + 1])];
    const port = await freeLoopbackPortPair(avoided);
    this.portBefore = port;
    return port;
  }

  private writeRecordOf(pid: number) {
    const written: DialRecord = { pid, keyFile: this.files.keyFile };
    try {
      writeFileSync(this.files.pidFile, JSON.stringify(written), { mode: 0o600 });
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

/**
 * Entry by entry, then the folder: a dial takes its own sockets away as it stops, and Bun's recursive rmSync leaves the
 * folder behind, without a word, when an entry in it goes meanwhile.
 */
function removeSocketFolder(folder: string) {
  const entries = existsSync(folder) ? readdirSync(folder) : [];
  entries.forEach((entry) => rmSync(join(folder, entry), { recursive: true, force: true }));
  rmSync(folder, { recursive: true, force: true });
}

/** True once the process is seen listening at both of its forwards, for as long as it runs and at most a while. */
async function seenListening(pid: number, from: ForwardsFrom, isRunningNow: () => boolean) {
  const listening = "sockets" in from ? () => [from.sockets.web, from.sockets.canvas].every(isSocketOfThisAccountAlone) : () => listensAtPortPair(pid, from.port);
  for (const deadline = Date.now() + LISTENING_WAIT_MS; Date.now() < deadline && isRunningNow(); await Bun.sleep(LISTENING_CHECK_EVERY_MS)) {
    if (await listening()) return isRunningNow();
  }
  return false;
}

/**
 * Only this account, or the system's administrator, can make anything in a dial's folder, so a socket there is its
 * process's. One that other accounts could connect to, were the folder open, is not taken either.
 */
export function isSocketOfThisAccountAlone(path: string) {
  const found = lstatSync(path, { throwIfNoEntry: false });
  return found !== undefined && found.isSocket() && found.uid === process.getuid?.() && (found.mode & 0o077) === 0;
}

async function listensAtPortPair(pid: number, port: number) {
  const listening = await loopbackPortsListenedAtOnWindowsBy(pid);
  return listening.includes(port) && listening.includes(port + 1);
}

/** The ports on IPv6's loopback the process listens at, in what `netstat -ano -p TCPv6` lists; a listening socket's far end is [::]:0, whatever the state is called in the system's language. */
export const loopbackPortsInNetstat = (listed: string, pid: number) =>
  listed.split("\n").flatMap((line) => {
    const [, port, owner] = /^\s*TCP\s+\[::1\]:(\d+)\s+\[::\]:0\s+\S+\s+(\d+)\s*$/.exec(line) ?? [];
    return port && Number(owner) === pid ? [Number(port)] : [];
  });

async function loopbackPortsListenedAtOnWindowsBy(pid: number) {
  try {
    const listing = Bun.spawn(["netstat", "-ano", "-p", "TCPv6"], { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
    const output = await new Response(listing.stdout).text();
    return (await listing.exited) === 0 ? loopbackPortsInNetstat(output, pid) : [];
  } catch {
    return [];
  }
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
 * Stops the dials a host that was killed left running, by the pid files in `folder`, and takes away their sockets'
 * folders and the one-time keys of joins it never finished. Windows has no ps to tell a dial from another process, so
 * there a dial left behind runs on until it is stopped by hand; it reaches nothing without this host's device token.
 */
export function stopLeftOverDials(folder: string, commandOfPid: (pid: number) => string | null = commandOf) {
  if (!existsSync(folder)) return;
  const entries = readdirSync(folder, { withFileTypes: true });
  entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".pid"))
    .forEach(({ name }) => {
      const pidFile = join(folder, name);
      const record = recordIn(pidFile);
      if (record && isDialOf(commandOfPid(record.pid), record)) stopProcess(record.pid);
      rmSync(pidFile, { force: true });
    });
  entries.filter((entry) => entry.isDirectory()).forEach(({ name }) => removeSocketFolder(join(folder, name)));
  entries.filter((entry) => entry.isFile() && entry.name.startsWith("join-")).forEach(({ name }) => rmSync(join(folder, name), { force: true }));
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

/** A free port on Windows dials' loopback with a free one above it, for the canvas server's forward, and neither among `avoided`. */
export async function freeLoopbackPortPair(avoided: number[] = []) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const port = await freeLoopbackPort();
    if (port === null || port >= 65535 || avoided.includes(port) || avoided.includes(port + 1)) continue;
    if ((await freeLoopbackPort(port + 1)) !== null) return port;
  }
  throw new Error("There is no free pair of ports on this computer's loopback to reach the machine's tunnel at.");
}
