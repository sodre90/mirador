import { lookup } from "node:dns/promises";
import { connect, isIP, type Socket } from "node:net";
import { reachesMoreThan, type SandboxNetwork } from "../../shared/sandbox.ts";
import { mayDial } from "./dialable-addresses.ts";
import { listenOnSocket, passBothWays, refuse, type RunningSocket } from "./vm-connections.ts";

/** How much of this computer a sandbox's VM may hold through its proxy, and how long it may take to ask. */
export interface NetworkProxyLimits {
  mostAtOnce: number;
  mostHeadBytes: number;
  headWithinMs: number;
  lookUpWithinMs: number;
  connectWithinMs: number;
  /** A connection nothing has come or gone over for this long ends. */
  idleMs: number;
}

export const NETWORK_PROXY_LIMITS: NetworkProxyLimits = { mostAtOnce: 128, mostHeadBytes: 16 * 1024, headWithinMs: 10_000, lookUpWithinMs: 10_000, connectWithinMs: 15_000, idleMs: 60 * 60_000 };

/** How the proxy finds its way: the addresses of a name, and whether a sandbox with this network may be connected with one. */
export interface NetworkProxyWays {
  addressesOf(host: string): Promise<string[]>;
  mayDial(network: SandboxNetwork, address: string): boolean;
}

const WAYS_OF_THIS_COMPUTER: NetworkProxyWays = {
  addressesOf: async (host) => (await lookup(host, { all: true, verbatim: true })).map(({ address }) => address),
  mayDial: (network, address) => mayDial(network, address),
};

export interface NetworkProxy extends RunningSocket {
  /** What the sandbox reaches changed: the connections it may have no longer end. */
  networkChanged(): void;
}

/** Where a request asks to be connected, and what goes there first: nothing for a tunnel, whose client speaks for itself once told. */
interface Asked {
  host: string;
  port: number;
  first: string;
  isTunnel: boolean;
}

const CLOSED = "This sandbox reaches only the agent's model and Mirador. Its owner decides what it reaches.";
const UNREADABLE = "This is a web proxy: it takes CONNECT, and requests of http:// addresses.";
const TOO_MANY = "This sandbox has as many connections as it may; let one of them end first.";
const NOT_REACHED = "It did not answer.";
/** Said of a name that isn't there too, so no answer tells which names the owner's networks have. */
const NOT_FOR_IT: Record<Exclude<SandboxNetwork, "closed">, string> = {
  internet: "There is no such place on the internet, which is all this sandbox reaches: not its owner's computer or networks.",
  everything: "There is no such place this sandbox reaches.",
};

const HEAD_ENDS = "\r\n\r\n";

/** The head of the client's request and what came after it; null where none comes in time, or it is too long. */
function headFrom(client: Socket, { mostHeadBytes, headWithinMs }: NetworkProxyLimits): Promise<{ head: string; rest: Buffer } | null> {
  return new Promise((resolve) => {
    let received = Buffer.alloc(0);
    const settle = (read: { head: string; rest: Buffer } | null) => {
      clearTimeout(timer);
      client.pause();
      client.off("data", more);
      client.off("close", gone);
      resolve(read);
    };
    const gone = () => settle(null);
    const more = (chunk: Buffer) => {
      received = Buffer.concat([received, chunk]);
      const end = received.indexOf(HEAD_ENDS);
      if (end > mostHeadBytes || (end === -1 && received.length > mostHeadBytes)) return settle(null);
      if (end !== -1) settle({ head: received.subarray(0, end).toString("latin1"), rest: received.subarray(end + HEAD_ENDS.length) });
    };
    const timer = setTimeout(gone, headWithinMs);
    client.on("data", more);
    client.on("close", gone);
  });
}

const REQUEST_LINE = /^([A-Z]+) (\S+) HTTP\/1\.[01]$/;
const AUTHORITY = /^(?:\[([0-9A-Fa-f:.]+)\]|([A-Za-z0-9._-]+))(?::(\d{1,5}))?$/;
const HTTP_ADDRESS = /^http:\/\/([^/?#]+)([^#]*)/i;
const HTTP_PORT = 80;

/** Headers between the client and a proxy alone, never passed on: the connection serves this request only. */
const BETWEEN_HOPS = /^(?:connection|keep-alive|proxy-[a-z-]+|upgrade)\s*:/i;

function placeNamed(authority: string, defaultPort: number | null) {
  const [, ipv6, name, given] = AUTHORITY.exec(authority) ?? [];
  const host = ipv6 ?? name;
  const port = given === undefined ? defaultPort : Number(given);
  return host && port && port <= 65_535 ? { host, port } : null;
}

/** What the request asks for; null where it is no proxy request that can be read. */
export function askedIn(head: string): Asked | null {
  const [requestLine = "", ...headers] = head.split("\r\n");
  const [, method, target] = REQUEST_LINE.exec(requestLine) ?? [];
  if (!method || !target) return null;
  if (method === "CONNECT") {
    const place = placeNamed(target, null);
    return place && { ...place, first: "", isTunnel: true };
  }
  const [, authority, path] = HTTP_ADDRESS.exec(target) ?? [];
  const place = authority ? placeNamed(authority, HTTP_PORT) : null;
  if (!place) return null;
  const line = `${method} ${path?.startsWith("/") ? path : `/${path ?? ""}`} HTTP/1.1`;
  const passedOn = headers.filter((header) => !BETWEEN_HOPS.test(header));
  return { ...place, first: [line, ...passedOn, "Connection: close"].join("\r\n") + HEAD_ENDS, isTunnel: false };
}

function within<T>(ms: number, work: Promise<T>): Promise<T | null> {
  const { promise, resolve } = Promise.withResolvers<null>();
  const timer = setTimeout(() => resolve(null), ms);
  return Promise.race([work.catch(() => null), promise]).finally(() => clearTimeout(timer));
}

function connected(address: string, port: number, withinMs: number): Promise<Socket | null> {
  return new Promise((resolve) => {
    const upstream = connect({ host: address, port });
    const missed = () => {
      clearTimeout(timer);
      upstream.destroy();
      resolve(null);
    };
    const timer = setTimeout(missed, withinMs);
    upstream.on("error", missed);
    upstream.once("connect", () => {
      clearTimeout(timer);
      resolve(upstream);
    });
  });
}

/** Each address in turn, until one answers or nobody waits for it any more. */
async function firstConnected([address, ...others]: string[], port: number, until: number, stillWanted: () => boolean): Promise<Socket | null> {
  const left = until - Date.now();
  if (address === undefined || left <= 0 || !stillWanted()) return null;
  const share = others.length > 0 ? Math.ceil(left / 2) : left;
  return (await connected(address, port, share)) ?? firstConnected(others, port, until, stillWanted);
}

/** A network whose IPv6 leads nowhere then costs no time. */
const ipv4First = (a: string, b: string) => isIP(a) - isIP(b);

/**
 * The way out of a sandbox whose VM has no network: a web proxy on a unix socket of this computer's, forwarded in. It looks
 * each name up here, connects with an address the sandbox may reach and no other, and passes bytes both ways, following
 * nothing. Where the sandbox's network is closed it reads a request, refuses it, and looks nothing up.
 */
export async function startNetworkProxy(socketPath: string, networkNow: () => SandboxNetwork, limits = NETWORK_PROXY_LIMITS, ways = WAYS_OF_THIS_COMPUTER): Promise<NetworkProxy> {
  /** Those let through or on their way, and what the sandbox reached then. */
  const letThrough = new Map<Socket, SandboxNetwork>();

  const refused = (client: Socket, status: string, why: string) => refuse(client, status, why, limits.headWithinMs);

  const answer = async (client: Socket) => {
    const request = await headFrom(client, limits);
    if (client.destroyed) return;
    if (!request) return void client.destroy();
    const network = networkNow();
    if (network === "closed") return refused(client, "403 Forbidden", CLOSED);
    const asked = askedIn(request.head);
    if (!asked) return refused(client, "400 Bad Request", UNREADABLE);
    letThrough.set(client, network);
    client.on("close", () => letThrough.delete(client));
    const { host, port } = asked;
    const addresses = isIP(host) ? [host] : ((await within(limits.lookUpWithinMs, ways.addressesOf(host))) ?? []);
    if (client.destroyed) return;
    const dialled = addresses.filter((address) => ways.mayDial(network, address)).toSorted(ipv4First);
    if (dialled.length === 0) return refused(client, "403 Forbidden", NOT_FOR_IT[network]);
    const upstream = await firstConnected(dialled, port, Date.now() + limits.connectWithinMs, () => !client.destroyed);
    if (client.destroyed || reachesMoreThan(network, networkNow())) {
      upstream?.destroy();
      return void client.destroy();
    }
    if (!upstream) return refused(client, "502 Bad Gateway", NOT_REACHED);
    if (asked.isTunnel) client.write("HTTP/1.1 200 Connection established\r\n\r\n");
    upstream.write(asked.first, "latin1");
    if (request.rest.length > 0) upstream.write(request.rest);
    passBothWays(client, upstream, limits.idleMs);
  };

  const { stop } = await listenOnSocket(socketPath, {
    mostAtOnce: limits.mostAtOnce,
    allowHalfOpen: false,
    take: (client) => void answer(client).catch(() => client.destroy()),
    turnAway: (client) => refused(client, "503 Service Unavailable", TOO_MANY),
  });
  return {
    networkChanged: () => [...letThrough].filter(([, network]) => reachesMoreThan(network, networkNow())).forEach(([client]) => client.destroy()),
    stop,
  };
}
