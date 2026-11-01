import { askToJoin as askToJoinThere } from "../shared/join-requests.ts";
import type { Machine } from "../shared/model.ts";
import { CANVAS_ASSETS_ORIGIN_HEADER, TOKEN_COOKIE } from "../shared/protocol.ts";
import { authorityFingerprint } from "./certificates.ts";
import { signInRevoked } from "./machine-sign-in.ts";
import { offeredAuthority, trusting } from "./machine-trust.ts";
import type { Store } from "./store.ts";
import { HostProblemError } from "../shared/host-problems.ts";

const UPSTREAM_OPEN_TIMEOUT_MS = 10_000;
/** About the hop to the relay, or this host's own sign-in, rather than what the page asks the machine for. */
const UNFORWARDED_REQUEST_HEADERS = new Set(["host", "cookie", "origin", "referer", "connection", "upgrade", "keep-alive", "transfer-encoding", "content-length"]);
/**
 * Cookies ignore ports, so a cookie the machine set would land on this host's own address and replace its sign-in.
 * fetch has already decoded the body, so its encoding and length no longer apply.
 */
const UNRELAYED_RESPONSE_HEADERS = new Set(["set-cookie", "content-encoding", "content-length", "transfer-encoding", "connection", "keep-alive"]);

export const thisHostAsDevice = (store: Store) => `Mirador on ${store.machineName()}`;

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

export function forwardedHeaders(incoming: Headers, machineOrigin: string, token: string | null, canvasAssetsOrigin: string) {
  const headers = new Headers([...incoming].filter(([name]) => !UNFORWARDED_REQUEST_HEADERS.has(name) && !name.startsWith("sec-websocket-")));
  if (incoming.has("origin")) headers.set("origin", machineOrigin);
  if (token) headers.set("cookie", `${TOKEN_COOKIE}=${token}`);
  headers.set(CANVAS_ASSETS_ORIGIN_HEADER, canvasAssetsOrigin);
  return headers;
}

export function relayedHeaders(upstream: Headers, machineOrigin: string, relayOrigin: string) {
  const headers = new Headers([...upstream].filter(([name]) => !UNRELAYED_RESPONSE_HEADERS.has(name)));
  const location = headers.get("location");
  if (location?.startsWith(machineOrigin)) headers.set("location", relayOrigin + location.slice(machineOrigin.length));
  return headers;
}

function openUpstream(url: string, headers: Headers, authority: string | null) {
  const upstream = new WebSocket(url, { headers, ...trusting(authority) } as unknown as string[]);
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

  constructor(
    private readonly store: Store,
    private readonly ports: number[],
    private readonly canvasAssetsOrigin: string,
    private readonly isSignedIn: (request: Request) => boolean,
    private readonly joined: (machineId: string) => void,
    private readonly signedOut: (machineId: string) => void,
  ) {}

  startAll() {
    this.store.listMachines().forEach((machine) => this.start(machine));
  }

  /** On the machine's port from before when it is free, so its pages keep what they stored for their origin. */
  start(machine: Machine) {
    const portBefore = machine.relayPort !== null && this.ports.includes(machine.relayPort) ? machine.relayPort : null;
    const server = (portBefore && this.listen(machine.id, portBefore)) || this.listenOnFreePort(machine.id);
    if (!server) return console.error(`no free port to show the machine ${machine.name} on`);
    this.servers.set(machine.id, server);
    if (server.port !== machine.relayPort) this.store.setMachineRelayPort(machine.id, server.port!);
  }

  stop(machineId: string) {
    this.servers.get(machineId)?.stop(true);
    this.servers.delete(machineId);
  }

  stopAll() {
    [...this.servers.keys()].forEach((machineId) => this.stop(machineId));
  }

  /**
   * Joins the machine as this host's device with a code from one of its invites, and from then on trusts the
   * certificate authority it joined it by. The code is sent only once the machine's certificate checks out.
   */
  async join(machineId: string, code: string, linkFingerprint: string | null = null) {
    const machine = this.store.findMachine(machineId);
    if (!machine) throw new HostProblemError({ code: "machine-gone" });
    const authority = await this.authorityToTrust(machine, linkFingerprint);
    const response = await fetch(`${machine.origin}/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, name: thisHostAsDevice(this.store) }),
      ...trusting(authority),
    }).catch(() => null);
    if (!response && authority) throw new Error(`${machine.name}'s certificate is not from its own certificate authority, or does not name ${new URL(machine.origin).hostname}.`);
    if (!response) throw new Error(`${machine.name} did not answer. Is its Mirador running?`);
    if (!response.ok) throw new Error(await response.text());
    const { token } = (await response.json()) as { token?: unknown };
    if (typeof token !== "string") throw new Error(`${machine.name} let this computer in without a token.`);
    this.signInFromNowOn(machine, authority, token);
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
   * invite link names, else the one trusted when this host joined before; with neither, it is trusted on first use.
   */
  private async authorityToTrust(machine: Machine, linkFingerprint: string | null) {
    const offered = await offeredAuthority(machine);
    if (!offered) return null;
    const trustedBefore = this.store.machineAuthority(machine.id);
    const expected = linkFingerprint ?? (trustedBefore && authorityFingerprint(trustedBefore));
    if (expected && offered.fingerprint !== expected) {
      throw new Error(
        linkFingerprint
          ? `${machine.name}'s certificate authority is not the one in the invite link, so the code was not sent. Something on the network may be posing as ${machine.name}.`
          : `${machine.name}'s certificate authority changed since this computer joined it, so the code was not sent. If its Mirador was set up again, join with an invite link from it.`,
      );
    }
    return offered.authority;
  }

  private listenOnFreePort(machineId: string) {
    const taken = new Set(this.store.listMachines().map(({ relayPort }) => relayPort));
    for (const port of this.ports.filter((port) => !taken.has(port))) {
      const server = this.listen(machineId, port);
      if (server) return server;
    }
    return null;
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
    const machine = this.store.findMachine(machineId);
    if (!machine) return new Response("unknown machine", { status: 404 });
    const relayOrigins = [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
    const relayOrigin = relayOrigins.find((origin) => new URL(origin).host === request.headers.get("host"));
    if (!relayOrigin) return new Response("forbidden host", { status: 403 });
    if (!this.isSignedIn(request)) return new Response("unauthorized", { status: 401 });
    const origin = request.headers.get("origin");
    if (origin !== null && !relayOrigins.includes(origin)) return new Response("forbidden origin", { status: 403 });

    const url = new URL(request.url);
    if (url.pathname === "/join" && request.method === "POST") return this.joinFromPage(machine, request);
    if (url.pathname.startsWith("/join-requests")) return new Response("This computer asks to join its machines itself, from its own window.", { status: 403 });
    const headers = forwardedHeaders(request.headers, machine.origin, this.store.machineDeviceToken(machineId), this.canvasAssetsOrigin);
    if (request.headers.get("upgrade")?.toLowerCase() === "websocket") return this.relaySocket(machine, url, headers, request, server);

    const response = await fetch(`${machine.origin}${url.pathname}${url.search}`, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
      redirect: "manual",
      ...trusting(this.store.machineAuthority(machineId)),
    }).catch(() => null);
    if (!response) return new Response(`${machine.name} did not answer.`, { status: 502 });
    if (response.status === 401) this.forgetRevokedSignIn(machineId);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers: relayedHeaders(response.headers, machine.origin, relayOrigin) });
  }

  /** The machine turns a request away when it revoked this computer; the rail then offers this computer's own way to join again. */
  private forgetRevokedSignIn(machineId: string) {
    signInRevoked(this.store, machineId).then((revoked) => revoked && this.signedOut(machineId));
  }

  /** The machine's end opens first, so a page the machine turns away sees its socket fail, as it would there. */
  private async relaySocket(machine: Machine, url: URL, headers: Headers, request: Request, server: Bun.Server<RelayedSocket>) {
    const upstream = await openUpstream(`${machine.origin.replace(/^http/, "ws")}${url.pathname}${url.search}`, headers, this.store.machineAuthority(machine.id));
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
    if (typeof code !== "string") return new Response("The invite code is missing.", { status: 400 });
    try {
      await this.join(machine.id, code);
      return Response.json({ joined: true });
    } catch (error) {
      return new Response(error instanceof Error ? error.message : String(error), { status: 403 });
    }
  }
}
