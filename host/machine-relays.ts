import { askToJoin as askToJoinThere } from "../shared/join-requests.ts";
import { HostProblemError, PROBLEM_HEADER, problemInHeader, type HostProblem } from "../shared/host-problems.ts";
import type { Machine } from "../shared/model.ts";
import { CANVAS_ASSETS_ORIGIN_HEADER, TOKEN_COOKIE } from "../shared/protocol.ts";
import { checkedDeviceTunnel, placesIn, type InviteTunnel } from "../shared/tunnel.ts";
import { HERE_PATH } from "./addresses.ts";
import { authorityFingerprint } from "./certificates.ts";
import { signInRevoked } from "./machine-sign-in.ts";
import { offeredAuthority, trusting } from "./machine-trust.ts";
import { ANSWER_WAIT_MS, answersWithin, DIRECT_REACH, type MachineReach } from "./machine-tunnels.ts";
import { atAddress, fetchThrough, webSocketTo, type Way } from "./p2p/dial.ts";
import { newKeyPair } from "./p2p/identity.ts";
import { errorResponse, problemResponse } from "./problem-response.ts";
import type { Store } from "./store.ts";

const UPSTREAM_OPEN_TIMEOUT_MS = 10_000;
const CANVAS_ORIGIN_ASK_TIMEOUT_MS = 4000;
/**
 * A dial's forward takes a request at once even while the machine is off, so a request through a tunnel gives up once
 * the machine has not started answering in this long.
 */
const FORWARD_ANSWER_TIMEOUT_MS = 15_000;
const UNFORWARDED_REQUEST_HEADERS = new Set(["host", "cookie", "origin", "referer", "connection", "upgrade", "keep-alive", "proxy-connection", "transfer-encoding", "content-length"]);
const UNRELAYED_RESPONSE_HEADERS = new Set(["set-cookie", "transfer-encoding", "connection", "keep-alive", "content-encoding", "content-length"]);

const thisHostAsDevice = (store: Store) => `Mirador on ${store.machineName()}`;

const JOIN_REFUSALS: HostProblem[] = [
  { code: "invite-code-missing" },
  { code: "invite-code-wrong" },
  { code: "join-too-often" },
];

/** The refusal of a join the machine named, as one of JOIN_REFUSALS; null when it named none of them. */
export function joinRefusalIn(response: Response): HostProblem | null {
  const named = problemInHeader(response.headers.get(PROBLEM_HEADER));
  return JOIN_REFUSALS.find(({ code }) => code === named?.code) ?? null;
}

const refusedJoin = async (response: Response) => {
  const refusal = joinRefusalIn(response);
  return refusal ? new HostProblemError(refusal) : new Error(await response.text());
};

/** Null when nothing answers; through a dial's forward, also when the machine has not started answering within `answerTimeoutMs`, while its answer's body takes as long as it takes. */
export async function fetchAnswered(way: Way, path: string, init: RequestInit, answerTimeoutMs: number | null) {
  const givenUp = new AbortController();
  const timer = answerTimeoutMs === null ? undefined : setTimeout(() => givenUp.abort(), answerTimeoutMs);
  try {
    return await fetchThrough(way, path, { ...init, signal: givenUp.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const sendsBody = (method: string) => method !== "GET" && method !== "HEAD";
const answerTimeoutFor = ({ peerToPeer }: Machine, method: string) => (peerToPeer && !sendsBody(method) ? FORWARD_ANSWER_TIMEOUT_MS : null);

export interface RelayedSocket {
  upstream: WebSocket;
  page: Bun.ServerWebSocket<RelayedSocket> | null;
  /** What the machine sent before the page's end of the socket opened. */
  waiting: (string | ArrayBuffer)[];
  closedBeforeOpen: { code: number; reason: string } | null;
}

/** Only 1000 and 3000–4999 may be sent when closing; others describe how a socket broke. */
const sendableCloseCode = (code: number) => (code === 1000 || (code >= 3000 && code <= 4999) ? code : 1000);

/** The machine closed the socket: pass the close to the page now, or hold it until the page's end opens. */
export function machineClosedSocket(data: RelayedSocket, code: number, reason: string) {
  const close = { code: sendableCloseCode(code), reason };
  if (data.page) data.page.close(close.code, close.reason);
  else data.closedBeforeOpen = close;
}

/** The page's end just opened: hand over what the machine sent first, then a close that came before it opened. */
export function pageSocketOpened(socket: Bun.ServerWebSocket<RelayedSocket>) {
  socket.data.page = socket;
  socket.data.waiting.splice(0).forEach((message) => socket.send(message));
  if (socket.data.closedBeforeOpen) socket.close(socket.data.closedBeforeOpen.code, socket.data.closedBeforeOpen.reason);
}

interface OriginFillIn {
  method?: string;
  /** WebView2 on Windows can send a page's same-origin upload without an Origin, which a machine on an older Mirador refuses. */
  fillsInMissingOrigin?: boolean;
}

export function forwardedHeaders(incoming: Headers, machineOrigin: string, token: string | null, canvasAssetsOrigin: string, { method = "GET", fillsInMissingOrigin = false }: OriginFillIn = {}) {
  const headers = new Headers([...incoming].filter(([name]) => !UNFORWARDED_REQUEST_HEADERS.has(name) && !name.startsWith("sec-websocket-")));
  const sameOriginWithoutOrigin = fillsInMissingOrigin && sendsBody(method) && incoming.get("sec-fetch-site") === "same-origin";
  if (incoming.has("origin") || sameOriginWithoutOrigin) headers.set("origin", machineOrigin);
  if (token) headers.set("cookie", `${TOKEN_COOKIE}=${token}`);
  headers.set(CANVAS_ASSETS_ORIGIN_HEADER, canvasAssetsOrigin);
  return headers;
}

/** What a canvas page asks the machine's canvas server for, without this host's sign-in, which browsers send to every port of 127.0.0.1. */
export function forwardedCanvasHeaders(incoming: Headers, relayOrigin: string) {
  const headers = new Headers([...incoming].filter(([name]) => !UNFORWARDED_REQUEST_HEADERS.has(name)));
  headers.set(CANVAS_ASSETS_ORIGIN_HEADER, relayOrigin);
  return headers;
}

/** The machine's canvas origin, as it answers at its address; null from a machine too old to say. */
async function canvasOriginOf(machine: Machine, authority: string | null) {
  const response = await fetch(`${machine.origin}${HERE_PATH}`, { signal: AbortSignal.timeout(CANVAS_ORIGIN_ASK_TIMEOUT_MS), ...trusting(authority) }).catch(() => null);
  const { canvasOrigin } = ((await response?.json().catch(() => null)) ?? {}) as { canvasOrigin?: unknown };
  if (typeof canvasOrigin !== "string" || !URL.canParse(canvasOrigin)) return null;
  const url = new URL(canvasOrigin);
  return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
}

export function relayedHeaders(upstream: Headers, machineOrigin: string, relayOrigin: string) {
  const headers = new Headers([...upstream].filter(([name]) => !UNRELAYED_RESPONSE_HEADERS.has(name)));
  const location = headers.get("location");
  if (location?.startsWith(machineOrigin)) headers.set("location", relayOrigin + location.slice(machineOrigin.length));
  return headers;
}

function openUpstream(way: Way, path: string, headers: Headers, authority: string | null) {
  const opened = webSocketTo(way, path, headers);
  const upstream = new WebSocket(opened.url, { headers: opened.headers, ...trusting(authority) } as unknown as string[]);
  upstream.binaryType = "arraybuffer";
  return new Promise<WebSocket | null>((resolve) => {
    const timer = setTimeout(() => {
      upstream.close();
      resolve(null);
    }, UPSTREAM_OPEN_TIMEOUT_MS);
    upstream.onopen = () => {
      clearTimeout(timer);
      resolve(upstream);
    };
    upstream.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
  });
}

/**
 * Shows another machine's Mirador at a port of this host, signed in there as this host's device. Pages on this
 * computer open it in a frame with this host's own cookie, which the relay swaps for the device token, so no page
 * ever holds that token.
 */
export class MachineRelays {
  private readonly servers = new Map<string, Bun.Server<RelayedSocket>>();
  private readonly canvasServers = new Map<string, Bun.Server<undefined>>();
  private readonly machineCanvasOrigins = new Map<string, Promise<string | null>>();

  constructor(
    private readonly store: Store,
    private readonly ports: number[],
    private readonly canvasAssetsOrigin: string,
    private readonly isSignedIn: (request: Request) => boolean,
    private readonly joined: (machineId: string) => void,
    private readonly signedOut: (machineId: string) => void,
    private readonly tunnels: MachineReach = DIRECT_REACH,
  ) {}

  /** Each machine's page relay first, so no canvas relay takes a port a machine had before. */
  startAll() {
    const machines = this.store.listMachines();
    machines.forEach((machine) => this.startPageRelay(machine));
    machines.forEach((machine) => this.startCanvasRelay(machine.id));
  }

  start(machine: Machine) {
    this.startPageRelay(machine);
    this.startCanvasRelay(machine.id);
  }

  /** On the machine's port from before when it is free, so its pages keep what they stored for their origin. */
  private startPageRelay(machine: Machine) {
    const portBefore = machine.relayPort !== null && this.ports.includes(machine.relayPort) ? machine.relayPort : null;
    const server = (portBefore && this.listen(machine.id, portBefore)) || this.listenOnFreePort(machine.id);
    if (!server) return console.error(`no free port to show the machine ${machine.name} on`);
    this.servers.set(machine.id, server);
    if (server.port !== machine.relayPort) this.store.setMachineRelayPort(machine.id, server.port!);
  }

  /** Canvas pages keep nothing for their origin, so this relay takes any free port. */
  private startCanvasRelay(machineId: string) {
    const server = this.freePortsInRange().reduce<Bun.Server<undefined> | null>((found, port) => found ?? this.listenForCanvas(machineId, port), null);
    if (!server) return console.error(`no free port to relay the canvas assets of the machine ${this.store.findMachine(machineId)?.name} on`);
    this.canvasServers.set(machineId, server);
  }

  stop(machineId: string) {
    this.servers.get(machineId)?.stop(true);
    this.servers.delete(machineId);
    this.canvasServers.get(machineId)?.stop(true);
    this.canvasServers.delete(machineId);
    this.machineCanvasOrigins.delete(machineId);
  }

  stopAll() {
    [...new Set([...this.servers.keys(), ...this.canvasServers.keys()])].forEach((machineId) => this.stop(machineId));
  }

  /**
   * Joins the machine as this host's device with a code from one of its invites, either through its peer-to-peer tunnel
   * or at its address. At its address, the code is sent only once the machine's certificate checks out.
   */
  async join(
    machineId: string,
    code: string,
    linkFingerprint: string | null = null,
    invite: InviteTunnel | null = null,
    { trustsOnFirstUse = true } = {},
  ) {
    const machine = this.store.findMachine(machineId);
    if (!machine) throw new HostProblemError({ code: "machine-gone" });
    if (machine.peerToPeer) return this.joinThroughTunnel(machine, code, invite);
    const authority = await this.authorityToTrust(machine, linkFingerprint, trustsOnFirstUse);
    const response = await fetch(`${machine.origin}/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, name: thisHostAsDevice(this.store) }),
      ...trusting(authority),
    }).catch(() => null);
    if (!response && authority) throw new HostProblemError({ code: "machine-certificate-not-its-own", machine: machine.name, hostname: new URL(machine.origin).hostname });
    if (!response) throw new HostProblemError({ code: "machine-did-not-answer", machine: machine.name });
    if (!response.ok) throw await refusedJoin(response);
    const { token } = (await response.json()) as { token?: unknown };
    if (typeof token !== "string") throw new HostProblemError({ code: "machine-gave-no-token", machine: machine.name });
    this.signInFromNowOn(machine, authority, token);
  }

  /**
   * Through the machine's tunnel, with the invite's one-time key, which reaches joining there alone: this host sends a
   * tunnel key of its own, which its dial reaches the machine with from then on.
   */
  private async joinThroughTunnel(machine: Machine, code: string, invite: InviteTunnel | null) {
    if (!invite) throw new HostProblemError({ code: "machine-needs-whole-invite", machine: machine.name });
    const known = this.store.machineTunnel(machine.id)?.places;
    const isFromMachine = (places: { hostKey: string; hostAddress: string }) => places.hostKey === known?.hostKey && places.hostAddress === known.hostAddress;
    if (!isFromMachine(invite)) throw new HostProblemError({ code: "invite-from-another-machine", machine: machine.name });
    const unreachable = new HostProblemError({ code: "machine-unreachable-now", machine: machine.name });
    const joining = await this.tunnels.dialToJoin(invite);
    try {
      const forward = await joining.forward;
      if (!(await answersWithin(forward.web, ANSWER_WAIT_MS))) throw unreachable;
      const own = newKeyPair();
      if (!forward.running) throw unreachable;
      const response = await fetchAnswered(
        forward.web,
        "/join",
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, name: thisHostAsDevice(this.store), tunnelKey: own.publicKey }) },
        FORWARD_ANSWER_TIMEOUT_MS,
      );
      if (!response || !forward.running) throw unreachable;
      if (!response.ok) throw await refusedJoin(response);
      const answer = (await response.json().catch(() => ({}))) as { token?: unknown; tunnel?: unknown };
      const given = checkedDeviceTunnel(answer.tunnel);
      if (typeof answer.token !== "string" || !given || !isFromMachine(given)) throw new HostProblemError({ code: "machine-gave-no-token", machine: machine.name });
      this.store.setMachineTunnelDevice(machine.id, placesIn(given), { address: given.deviceAddress, privateKey: own.privateKey });
      this.tunnels.start(machine.id);
      this.signInFromNowOn(machine, null, answer.token);
    } finally {
      joining.stop();
    }
  }

  /**
   * Asks the machine to let this host in, and waits until someone there approves it by typing the number this host
   * shows, which asked hands over. The number comes from the certificate authority this host checked the machine's
   * certificate against, so approving it there proves that authority is the machine's own, even a new one.
   */
  async askToJoin(machineId: string, asked: (number: string) => void) {
    const machine = this.store.findMachine(machineId);
    if (!machine) throw new HostProblemError({ code: "machine-gone" });
    const offered = await offeredAuthority(machine);
    const authority = offered?.authority ?? null;
    const send = (path: string, body: object) =>
      fetch(`${machine.origin}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        ...trusting(authority),
      }).catch(() => null);
    const token = await askToJoinThere(send, { name: thisHostAsDevice(this.store), authorityFingerprint: offered?.fingerprint ?? null, machineName: machine.name }, asked);
    this.signInFromNowOn(machine, authority, token);
  }

  private signInFromNowOn(machine: Machine, authority: string | null, token: string) {
    this.store.setMachineAuthority(machine.id, authority);
    this.store.setMachineDeviceToken(machine.id, token);
    this.joined(machine.id);
  }

  /**
   * The machine's own certificate authority, when the computer's ones don't vouch for it. It must be the one the
   * invite link names, else the one trusted when this host joined before; with neither, it is trusted on first use, when
   * that `trustsOnFirstUse`.
   */
  private async authorityToTrust(machine: Machine, linkFingerprint: string | null, trustsOnFirstUse: boolean) {
    const offered = await offeredAuthority(machine);
    if (!offered) return null;
    const trustedBefore = this.store.machineAuthority(machine.id);
    const expected = linkFingerprint ?? (trustedBefore && authorityFingerprint(trustedBefore));
    if (!expected && !trustsOnFirstUse) throw new HostProblemError({ code: "machine-authority-not-in-tunnel-link", machine: machine.name });
    if (expected && offered.fingerprint !== expected) {
      throw new HostProblemError({ code: linkFingerprint ? "machine-authority-not-in-link" : "machine-authority-changed", machine: machine.name });
    }
    return offered.authority;
  }

  private freePortsInRange() {
    const taken = new Set(this.store.listMachines().map(({ relayPort }) => relayPort));
    return this.ports.filter((port) => !taken.has(port));
  }

  private listenOnFreePort(machineId: string) {
    for (const port of this.freePortsInRange()) {
      const server = this.listen(machineId, port);
      if (server) return server;
    }
    return null;
  }

  private listenForCanvas(machineId: string, port: number) {
    try {
      return Bun.serve({ hostname: "127.0.0.1", port, fetch: (request) => this.relayCanvas(machineId, port, request) });
    } catch {
      return null;
    }
  }

  /** Where the machine's pages in the frame load canvas assets from: its relay here, or this host's own for a machine too old to say where its are. */
  private async canvasAssetsOriginFor(machine: Machine) {
    const canvasServer = this.canvasServers.get(machine.id);
    if (!canvasServer || !(await this.machineCanvasWay(machine))) return this.canvasAssetsOrigin;
    return `http://127.0.0.1:${canvasServer.port}`;
  }

  private async machineCanvasWay(machine: Machine, askAgain = false) {
    if (machine.peerToPeer) return this.tunnels.canvasWayTo(machine);
    const origin = await this.machineCanvasOrigin(machine, askAgain);
    return origin === null ? null : atAddress(origin);
  }

  /** Asked again each time a page's socket opens, so an updated or moved machine is followed. */
  private machineCanvasOrigin(machine: Machine, askAgain: boolean) {
    const known = this.machineCanvasOrigins.get(machine.id);
    if (known && !askAgain) return known;
    const asked = canvasOriginOf(machine, this.store.machineAuthority(machine.id));
    this.machineCanvasOrigins.set(machine.id, asked);
    return asked;
  }

  /** No sign-in, as the machine's canvas server asks none: it serves only libraries, views under a hash of their code, and media under tokens. */
  private async relayCanvas(machineId: string, port: number, request: Request) {
    const known = this.store.findMachine(machineId);
    if (!known) return new Response("unknown machine", { status: 404 });
    const relayOrigin = `http://127.0.0.1:${port}`;
    if (request.headers.get("host") !== new URL(relayOrigin).host) return new Response("forbidden host", { status: 403 });
    const machine = await this.tunnels.reached(known);
    if (!machine || !this.tunnels.stillReaches(machine)) return new Response(`${known.name} did not answer.`, { status: 502 });
    const canvas = await this.machineCanvasWay(machine);
    if (!canvas) return new Response(`${machine.name} did not say where its canvas assets are.`, { status: 502 });
    const url = new URL(request.url);
    const response = await fetchAnswered(
      canvas,
      `${url.pathname}${url.search}`,
      {
        method: request.method,
        headers: forwardedCanvasHeaders(request.headers, relayOrigin),
        redirect: "manual",
        ...trusting(this.store.machineAuthority(machineId)),
      },
      answerTimeoutFor(machine, request.method),
    );
    if (!response) {
      this.machineCanvasOrigins.delete(machineId);
      return new Response(`${machine.name} did not answer.`, { status: 502 });
    }
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers: relayedHeaders(response.headers, canvas.origin, relayOrigin) });
  }

  private listen(machineId: string, port: number) {
    try {
      return Bun.serve<RelayedSocket>({
        hostname: "127.0.0.1",
        port,
        idleTimeout: 0,
        fetch: (request, server) => this.relay(machineId, port, request, server),
        websocket: {
          open: pageSocketOpened,
          message(socket, message) {
            socket.data.upstream.send(message);
          },
          close(socket, code, reason) {
            socket.data.upstream.close(sendableCloseCode(code), reason);
          },
        },
      });
    } catch {
      return null;
    }
  }

  private async relay(machineId: string, port: number, request: Request, server: Bun.Server<RelayedSocket>) {
    const known = this.store.findMachine(machineId);
    if (!known) return new Response("unknown machine", { status: 404 });
    const relayOrigins = [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
    const relayOrigin = relayOrigins.find((origin) => new URL(origin).host === request.headers.get("host"));
    if (!relayOrigin) return new Response("forbidden host", { status: 403 });
    if (!this.isSignedIn(request)) return new Response("unauthorized", { status: 401 });
    const origin = request.headers.get("origin");
    if (origin !== null && !relayOrigins.includes(origin)) return new Response("forbidden origin", { status: 403 });

    const url = new URL(request.url);
    if (url.pathname === "/join" && request.method === "POST") return this.joinFromPage(known, request);
    if (url.pathname.startsWith("/join-requests")) return new Response("This computer asks to join its machines itself, from its own window.", { status: 403 });
    const machine = await this.tunnels.reached(known);
    if (!machine) return new Response(`${known.name} did not answer.`, { status: 502 });
    const opensSocket = request.headers.get("upgrade")?.toLowerCase() === "websocket";
    if (opensSocket) await this.machineCanvasWay(machine, true);
    const originFillIn = { method: request.method, fillsInMissingOrigin: true };
    const headers = forwardedHeaders(request.headers, machine.origin, this.store.machineDeviceToken(machineId), await this.canvasAssetsOriginFor(machine), originFillIn);
    if (opensSocket) return this.relaySocket(machine, `${url.pathname}${url.search}`, headers, request, server);

    const way = this.tunnels.wayTo(machine);
    if (!way) return new Response(`${machine.name} did not answer.`, { status: 502 });
    const response = await fetchAnswered(
      way,
      `${url.pathname}${url.search}`,
      {
        method: request.method,
        headers,
        body: sendsBody(request.method) ? request.body : undefined,
        redirect: "manual",
        ...trusting(this.store.machineAuthority(machineId)),
      },
      answerTimeoutFor(machine, request.method),
    );
    if (!response || !this.tunnels.stillReaches(machine)) return new Response(`${machine.name} did not answer.`, { status: 502 });
    if (response.status === 401) this.forgetRevokedSignIn(machine);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers: relayedHeaders(response.headers, machine.origin, relayOrigin) });
  }

  /** The machine turns a request away when it revoked this computer; the rail then offers this computer's own way to join again. */
  private forgetRevokedSignIn(machine: Machine) {
    signInRevoked(this.store, machine, this.tunnels).then((revoked) => revoked && this.signedOut(machine.id));
  }

  /** The machine's end opens first, so a page the machine turns away sees its socket fail, as it would there. */
  private async relaySocket(machine: Machine, path: string, headers: Headers, request: Request, server: Bun.Server<RelayedSocket>) {
    const way = this.tunnels.wayTo(machine);
    if (!way) return new Response(`${machine.name} did not open the socket.`, { status: 502 });
    const upstream = await openUpstream(way, path, headers, this.store.machineAuthority(machine.id));
    if (!upstream) return new Response(`${machine.name} did not open the socket.`, { status: 502 });
    const data: RelayedSocket = { upstream, page: null, waiting: [], closedBeforeOpen: null };
    upstream.onmessage = (event) => (data.page ? data.page.send(event.data) : data.waiting.push(event.data));
    upstream.onclose = (event) => machineClosedSocket(data, event.code, event.reason);
    if (server.upgrade(request, { data })) return undefined;
    upstream.close();
    return new Response("upgrade failed", { status: 400 });
  }

  /** The machine's join page, shown in the frame when this host has no token there yet, joins this host instead of the page. */
  private async joinFromPage(machine: Machine, request: Request) {
    const { code } = (await request.json().catch(() => ({}))) as { code?: unknown };
    if (typeof code !== "string") return problemResponse({ code: "invite-code-missing" }, 400);
    try {
      await this.join(machine.id, code);
      return Response.json({ joined: true });
    } catch (error) {
      return errorResponse(error, 403);
    }
  }
}
