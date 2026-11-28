import { randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { askToJoin as askToJoinThere } from "../shared/join-requests.ts";
import { isRoomId, SOMEONE_ELSES_MACHINE_SANDBOX } from "../shared/machines.ts";
import type { Machine } from "../shared/model.ts";
import { CANVAS_ASSETS_ORIGIN_HEADER, TOKEN_COOKIE, TOKEN_HEADER } from "../shared/protocol.ts";
import { namesThisComputer } from "../shared/this-computer.ts";
import { HERE_PATH } from "./addresses.ts";
import { authorityFingerprint } from "./certificates.ts";
import { inviteKey, isRoomInviteCode } from "./devices.ts";
import { isChallenge, NO_AUTHORITY, roomJoinStatement, type OwnerKey, type ReachedAt } from "./person-keys.ts";
import { signInRevoked } from "./machine-sign-in.ts";
import { ANSWER_WAIT_MS, answersWithin, DIRECT_REACH, type MachineReach } from "./machine-tunnels.ts";
import { offeredAuthority, refuseUnprotectedAddress, trusting } from "./machine-trust.ts";
import { atAddress, fetchThrough, webSocketTo, type Way } from "./p2p/dial.ts";
import { newKeyPair } from "./p2p/identity.ts";
import { errorResponse, problemResponse } from "./problem-response.ts";
import { sameSecret } from "./sign-in.ts";
import type { Store } from "./store.ts";
import { fromThisComputer } from "./from-this-computer.ts";
import { HostProblemError, PROBLEM_HEADER, problemInHeader, type HostProblem } from "../shared/host-problems.ts";
import { checkedDeviceTunnel, placesIn, type InviteTunnel } from "../shared/tunnel.ts";

const UPSTREAM_OPEN_TIMEOUT_MS = 10_000;
const CANVAS_ORIGIN_ASK_TIMEOUT_MS = 4000;
/**
 * A dial's forward takes a request at once even while the machine beyond it is gone, e.g. once its owner took this
 * computer's person out, so a request through it that the machine has not started answering by then fails, as one to a
 * machine that is off does at once. One that sends a body, such as a dropped file, has longer to send it.
 */
const FORWARD_ANSWER_TIMEOUT_MS = 15_000;
const FORWARD_UPLOAD_ANSWER_TIMEOUT_MS = 120_000;
/** About the hop to the relay, or this host's own sign-in, rather than what the page asks the machine for. */
const UNFORWARDED_REQUEST_HEADERS = new Set(["host", "cookie", TOKEN_HEADER, "origin", "referer", "connection", "upgrade", "keep-alive", "transfer-encoding", "content-length"]);
/**
 * Cookies and site data ignore ports, so a cookie the machine set would land on this host's own address and replace its
 * sign-in, and Clear-Site-Data would sign this computer out of it. fetch has already decoded the body, so its encoding
 * and length no longer apply.
 */
const UNRELAYED_RESPONSE_HEADERS = new Set(["set-cookie", "clear-site-data", "content-encoding", "content-length", "transfer-encoding", "connection", "keep-alive"]);
/** What a page in a sandboxed frame without allow-same-origin sends as its Origin. */
const OPAQUE_ORIGIN = "null";
const RELAY_KEY_BYTES = 32;

/** A machine's pages get no service worker at a relay's port, which would outlive the machine there and could control another machine's page given that port later. */
const asksForServiceWorker = (request: Request) => request.headers.get("service-worker") === "script";
const noServiceWorker = () => new Response("Machines shown here register no service workers.", { status: 403 });

export const newRelayKey = () => randomBytes(RELAY_KEY_BYTES).toString("base64url");

/** The path past the relay key, when the path starts with it; null for any other path. */
export function pathPastKey(pathname: string, relayKey: string | null) {
  if (!relayKey) return null;
  const [, first = "", ...rest] = pathname.split("/");
  return sameSecret(first, relayKey) ? `/${rest.join("/")}` : null;
}

/** Someone else's machine shows its rooms in an opaque origin, which loads the bundle's scripts and styles with CORS. */
const withOpenCors = (headers: Headers) => {
  headers.set("access-control-allow-origin", "*");
  return headers;
};

const isPage = (response: Response) => response.headers.get("content-type")?.startsWith("text/html") ?? false;

/** WebKit matches no address to 'self' in an opaque origin, so the page's own policy names the relay it came from as well, for its fetches. */
export const connectingToRelay = (page: string, relayOrigin: string) => page.replaceAll("connect-src 'self'", `connect-src 'self' ${relayOrigin}`);

export const thisHostAsDevice = (store: Store) => `Mirador on ${store.machineName()}`;

export interface RelayedSocket {
  upstream: WebSocket;
  page: Bun.ServerWebSocket<RelayedSocket> | null;
  /** What the machine sent before the page's end of the socket opened. */
  waiting: (string | ArrayBuffer)[];
  closedBeforeOpen: { code: number; reason: string } | null;
}

/**
 * Another site's page, or someone else's machine's page in its opaque origin, with which WebKit sends this host's
 * Strict cookie on the scripts and images it loads; and, from this computer's other ports, anything but a navigation.
 * Any page of this computer that loads the machine, into a frame or a window of its own, is a same-site navigation and
 * passes here: the frame-ancestors the relay answers with, `framedOnlyBy`, is what keeps any page but this host's own
 * from framing it.
 */
function askedFromAnotherPage(request: Request) {
  const site = request.headers.get("sec-fetch-site");
  const loadsTheFrame = request.method === "GET" && request.headers.get("sec-fetch-mode") === "navigate";
  return site === "cross-site" || (site === "same-site" && !loadsTheFrame);
}

/** This host's own pages frame a machine of this computer's owner, and that machine's page its own frames; no other page of this computer may. */
const framedOnlyBy = (thisHostsPages: string[]) => `frame-ancestors 'self' ${thisHostsPages.join(" ")}`;

/**
 * Someone else's machine's pages run sandboxed in an opaque origin wherever they open, as in their frame: opened in a
 * window of their own at this computer's address, they could otherwise set cookies that this computer's other ports,
 * this host's among them, are sent, and frame this host's page with its Strict cookie.
 */
const sandboxedAsInTheirFrame = (headers: Headers) => {
  headers.append("content-security-policy", `sandbox ${SOMEONE_ELSES_MACHINE_SANDBOX}`);
  return headers;
};

const refusedJoinFromPage = () => new Response("This computer asks to join its machines itself, from its own window.", { status: 403 });
const didNotAnswer = (machine: Machine) => new Response(`${machine.name} did not answer.`, { status: 502 });

/**
 * What a Mirador answers a join it turns away with, which this host says in the page's own language. The machine is
 * someone else's, so only these are taken from it, by their code alone, never any other problem it names.
 */
const JOIN_REFUSALS: HostProblem[] = [
  { code: "invite-code-missing" },
  { code: "invite-code-wrong" },
  { code: "join-too-often" },
  { code: "room-join-unproven" },
  { code: "room-invite-needs-mirador" },
  { code: "room-invite-not-through-tunnel" },
  { code: "room-invite-loopback-from-afar" },
];

/** The refusal of a join the machine named, as one of JOIN_REFUSALS; null when it named none of them. */
export function joinRefusalIn(response: Response): HostProblem | null {
  const named = problemInHeader(response.headers.get(PROBLEM_HEADER));
  return JOIN_REFUSALS.find(({ code }) => code === named?.code) ?? null;
}

/** A refusal the machine named, or else its own words, from a Mirador too old to name it. */
const refusedJoin = async (response: Response) => {
  const refusal = joinRefusalIn(response);
  return refusal ? new HostProblemError(refusal) : new Error(await response.text());
};

/** The room a room invite let this computer's owner into, as the machine names it; taken only in the form a room's id has. */
const roomIdIn = (answer: { roomId?: unknown }) => (isRoomId(answer.roomId) ? answer.roomId : null);

/** Where a room invite took this computer's owner: into a room, or to its door, to wait for its owner to let them in. */
export interface RoomJoined {
  roomId: string | null;
  waiting: boolean;
}

const NO_ROOM: RoomJoined = { roomId: null, waiting: false };

const roomJoinedIn = (answer: { roomId?: unknown; waiting?: unknown }): RoomJoined => {
  const roomId = roomIdIn(answer);
  return { roomId, waiting: roomId !== null && answer.waiting === true };
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

/** How long the machine has to start answering: unlimited at its address, where a gone machine refuses at once. */
const answerTimeoutFor = (machine: Machine, method: string) =>
  !machine.peerToPeer ? null : sendsBody(method) ? FORWARD_UPLOAD_ANSWER_TIMEOUT_MS : FORWARD_ANSWER_TIMEOUT_MS;

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

const CANVAS_RELAY_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Whether a canvas origin reported by `machine` may be relayed: HTTP(S) only, never downgrading HTTPS to HTTP; for
 * someone else's machine, strictly its own host; for an owner's machine, another host never names this computer or a raw IP.
 */
export function allowedCanvasOrigin(machine: Pick<Machine, "origin" | "asPerson">, canvasOrigin: unknown): string | null {
  if (typeof canvasOrigin !== "string" || !URL.canParse(canvasOrigin) || !URL.canParse(machine.origin)) return null;
  const url = new URL(canvasOrigin);
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const machineUrl = new URL(machine.origin);
  if (machineUrl.protocol === "https:" && url.protocol !== "https:") return null;
  if (url.hostname === machineUrl.hostname) return url.origin;
  if (machine.asPerson) return null;
  const host = url.hostname.startsWith("[") && url.hostname.endsWith("]") ? url.hostname.slice(1, -1) : url.hostname;
  if (namesThisComputer(url.hostname) || isIP(host) !== 0) return null;
  return url.origin;
}

/** The machine's canvas origin, as it answers at its address; null from a machine too old to say or pointing elsewhere. */
async function canvasOriginOf(machine: Machine, authority: string | null) {
  const response = await fetch(`${machine.origin}${HERE_PATH}`, { signal: AbortSignal.timeout(CANVAS_ORIGIN_ASK_TIMEOUT_MS), ...trusting(authority) }).catch(() => null);
  const { canvasOrigin } = ((await response?.json().catch(() => null)) ?? {}) as { canvasOrigin?: unknown };
  return allowedCanvasOrigin(machine, canvasOrigin);
}

/** Redirects stay on the relay, under its key for a machine joined as a person: `keyPath` is "/" and the key, or empty. */
export function relayedHeaders(upstream: Headers, machineOrigin: string, relayOrigin: string, keyPath = "") {
  const headers = new Headers([...upstream].filter(([name]) => !UNRELAYED_RESPONSE_HEADERS.has(name)));
  const location = headers.get("location");
  if (location?.startsWith(machineOrigin)) headers.set("location", relayOrigin + keyPath + location.slice(machineOrigin.length));
  else if (keyPath && location?.startsWith("/") && !location.startsWith("//")) headers.set("location", keyPath + location);
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
 * ever holds that token. A machine joined as a person is someone else's: its frame runs in an opaque origin, which
 * no cookie reaches and which keeps nothing, and the relay signs in only what asks under the machine's relay key.
 */
export class MachineRelays {
  private readonly servers = new Map<string, Bun.Server<RelayedSocket>>();
  private readonly canvasServers = new Map<string, Bun.Server<undefined>>();
  private readonly machineCanvasOrigins = new Map<string, Promise<string | null>>();

  constructor(
    private readonly store: Store,
    private readonly ports: number[],
    private readonly canvasAssetsOrigin: string,
    /** Where this host's own page is served on this computer, which alone may frame a machine of its owner's. */
    private readonly thisHostsPages: string[],
    private readonly signedInAsOwner: (request: Request, fromThisComputer: boolean) => boolean,
    private readonly joined: (machineId: string) => void,
    private readonly signedOut: (machineId: string) => void,
    private readonly ownerKey: OwnerKey,
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
   * Joins the machine as this host's device with a code from one of its invites, and from then on trusts the
   * certificate authority it joined it by. The code is sent only once the machine's certificate checks out. For the
   * code of a room invite there, which the machine challenges, this computer's owner joins as a person in that room,
   * which it answers with. A machine reached peer to peer is joined through its tunnel, with the whole invite; one
   * reached at its address, with a link that carries its tunnel, only where nothing on the way reads the code, as when
   * the link is pasted under Machines. Without `trustsOnFirstUse`, a machine's own certificate authority is trusted only
   * by the fingerprint in the link.
   */
  async join(
    machineId: string,
    code: string,
    linkFingerprint: string | null = null,
    tunnel: InviteTunnel | null = null,
    { trustsOnFirstUse = true } = {},
  ): Promise<RoomJoined> {
    const machine = this.store.findMachine(machineId);
    if (!machine) throw new HostProblemError({ code: "machine-gone" });
    if (machine.peerToPeer) return this.joinThroughTunnel(machine, code, tunnel);
    if (tunnel) refuseUnprotectedAddress(machine.origin);
    const authority = await this.authorityToTrust(machine, linkFingerprint, trustsOnFirstUse);
    const post = (path: string, body: object) =>
      fetch(`${machine.origin}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        ...trusting(authority),
      }).catch(() => null);
    const challenged = await post("/join-challenges", { code });
    if (!challenged && authority) throw new HostProblemError({ code: "machine-certificate-not-its-own", machine: machine.name, hostname: new URL(machine.origin).hostname });
    if (!challenged) throw new HostProblemError({ code: "machine-did-not-answer", machine: machine.name });
    const reached: ReachedAt = { host: new URL(machine.origin).host, authorityFingerprint: authority ? authorityFingerprint(authority) : NO_AUTHORITY };
    const person = challenged.ok ? this.ownerAsPerson(code, reached, await challenged.json().catch(() => ({}))) : undefined;
    if (!person && isRoomInviteCode(code)) throw new HostProblemError(joinRefusalIn(challenged) ?? { code: "machine-ignored-room-invite", machine: machine.name });
    if (!person && machine.asPerson) throw new HostProblemError({ code: "machine-joined-as-person", machine: machine.name });
    const response = await post("/join", { code, name: thisHostAsDevice(this.store), person });
    if (!response) throw new HostProblemError({ code: "machine-did-not-answer", machine: machine.name });
    if (!response.ok) throw await refusedJoin(response);
    const answer = (await response.json()) as { token?: unknown; roomId?: unknown; waiting?: unknown };
    if (typeof answer.token !== "string") throw new HostProblemError({ code: "machine-gave-no-token", machine: machine.name });
    const joined = person ? this.roomJoined(machine.id, answer) : NO_ROOM;
    this.signInFromNowOn(machine, authority, answer.token, person ? { asPerson: true, relayKey: this.relayKeyFor(machine.id) } : { asPerson: false });
    return joined;
  }

  /** Before this host signs in with the new token, so the machine's watch starts out knowing of the room it waits at. */
  private roomJoined(machineId: string, answer: { roomId?: unknown; waiting?: unknown }) {
    const joined = roomJoinedIn(answer);
    if (joined.roomId === null) return joined;
    this.store.setJoinedRoomLeft(machineId, joined.roomId, false);
    const otherKnocks = (this.store.findMachine(machineId)?.knocks ?? []).filter(({ roomId }) => roomId !== joined.roomId);
    this.store.setMachineKnocks(machineId, joined.waiting ? [...otherKnocks, { roomId: joined.roomId, turnedAway: false }] : otherKnocks);
    return joined;
  }

  /**
   * Through the machine's tunnel, with the invite's one-time key, which reaches joining there alone: the owner's
   * signature names the machine's key in the tunnel, and this host sends a tunnel key of its own, which its dial reaches
   * the machine with from then on. The invite must be from the machine whose tunnel this host added it by, and a room
   * invite where its owner joined as a person, as at its address.
   */
  private async joinThroughTunnel(machine: Machine, code: string, invite: InviteTunnel | null) {
    if (machine.asPerson && !isRoomInviteCode(code)) throw new HostProblemError({ code: "machine-joined-as-person", machine: machine.name });
    if (!invite) throw new HostProblemError({ code: "machine-needs-whole-invite", machine: machine.name });
    const known = this.store.machineTunnel(machine.id)?.places;
    const isFromMachine = (places: { hostKey: string; hostAddress: string }) => places.hostKey === known?.hostKey && places.hostAddress === known.hostAddress;
    if (!isFromMachine(invite)) throw new HostProblemError({ code: "invite-from-another-machine", machine: machine.name });
    const unreachable = new HostProblemError({ code: "machine-unreachable-now", machine: machine.name });
    const joining = await this.tunnels.dialToJoin(invite);
    try {
      const forward = await joining.forward;
      if (!(await answersWithin(forward.web, ANSWER_WAIT_MS))) throw unreachable;
      const post = async (path: string, body: object) => {
        if (!forward.running) return null;
        const init = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
        const response = await fetchAnswered(forward.web, path, init, FORWARD_ANSWER_TIMEOUT_MS);
        return forward.running ? response : null;
      };
      const isRoom = isRoomInviteCode(code);
      let person: ReturnType<MachineRelays["ownerAsPerson"]>;
      if (isRoom) {
        const challenged = await post("/join-challenges", { code });
        if (!challenged) throw unreachable;
        person = challenged.ok ? this.ownerAsPerson(code, { tunnelKey: invite.hostKey }, await challenged.json().catch(() => ({}))) : undefined;
        if (!person) throw new HostProblemError(joinRefusalIn(challenged) ?? { code: "machine-ignored-room-invite", machine: machine.name });
      }
      const own = newKeyPair();
      const response = await post("/join", { code, name: thisHostAsDevice(this.store), ...(person && { person }), tunnelKey: own.publicKey });
      if (!response) throw unreachable;
      if (!response.ok) throw await refusedJoin(response);
      const answer = (await response.json().catch(() => ({}))) as { token?: unknown; roomId?: unknown; waiting?: unknown; tunnel?: unknown };
      const given = checkedDeviceTunnel(answer.tunnel);
      if (typeof answer.token !== "string" || !given || !isFromMachine(given)) throw new HostProblemError({ code: "machine-gave-no-token", machine: machine.name });
      this.store.setMachineTunnelDevice(machine.id, placesIn(given), { address: given.deviceAddress, privateKey: own.privateKey });
      this.tunnels.start(machine.id);
      const joined = person ? this.roomJoined(machine.id, answer) : NO_ROOM;
      this.signInFromNowOn(machine, null, answer.token, person ? { asPerson: true, relayKey: this.relayKeyFor(machine.id) } : { asPerson: false });
      return joined;
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
    if (machine.asPerson) throw new HostProblemError({ code: "machine-joined-as-person", machine: machine.name });
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
    this.signInFromNowOn(machine, authority, token, { asPerson: false });
  }

  /**
   * This computer's owner as they present themselves to the machine's room: by their key, which signs the machine's
   * challenge, the invite, and where this host reached the machine (its address and the certificate authority it trusts
   * there, or its key in the tunnel), and by the name and colour of their profile.
   */
  private ownerAsPerson(code: string, reached: ReachedAt, { challenge }: { challenge?: unknown }) {
    if (!isChallenge(challenge)) return undefined;
    const { publicKey } = this.ownerKey;
    const { name, color } = this.store.listPeople().find(({ id }) => id === this.store.ownerId())!;
    const signature = this.ownerKey.sign(roomJoinStatement({ ...reached, challenge, inviteKey: inviteKey(code), publicKey }));
    return { publicKey, name, color, challenge, signature };
  }

  /** Signed in there as a person already, it keeps its key: joining another room leaves the machine's page, whose address holds the key, as it is. */
  private relayKeyFor(machineId: string) {
    const machine = this.store.findMachine(machineId);
    return (machine?.joined && machine.relayKey) || newRelayKey();
  }

  /** How it joined is this host's own record, from what it sent: a machine joined as a person is shown with no trust from then on. */
  private signInFromNowOn(machine: Machine, authority: string | null, token: string, joinedAs: { asPerson: false } | { asPerson: true; relayKey: string }) {
    this.store.setMachineAuthority(machine.id, authority);
    this.store.setMachineDeviceToken(machine.id, token);
    this.store.setMachineOutOfRooms(machine.id, false);
    this.store.setMachineJoinedAs(machine.id, joinedAs);
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

  /**
   * `machine` as this host reaches it. A machine reached peer to peer is not asked where its canvas server is, so it
   * can't send this host's canvas relay anywhere else: its dial forwards to it, from the forward the machine is reached
   * through now, as each process of the dial forwards from places of its own.
   */
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
    if (!CANVAS_RELAY_METHODS.has(request.method)) return new Response("method not allowed", { status: 405 });
    if (asksForServiceWorker(request)) return noServiceWorker();
    const machine = await this.tunnels.reached(known);
    if (!machine) return didNotAnswer(known);
    if (!this.tunnels.stillReaches(machine)) return didNotAnswer(machine);
    const canvas = await this.machineCanvasWay(machine);
    if (!canvas) return new Response(`${machine.name} did not say where its canvas assets are.`, { status: 502 });
    const url = new URL(request.url);
    const init: RequestInit = { method: request.method, headers: forwardedCanvasHeaders(request.headers, relayOrigin), redirect: "manual", ...trusting(this.store.machineAuthority(machineId)) };
    const response = await fetchAnswered(canvas, `${url.pathname}${url.search}`, init, answerTimeoutFor(machine, request.method));
    if (!response) {
      this.machineCanvasOrigins.delete(machineId);
      return new Response(`${machine.name} did not answer.`, { status: 502 });
    }
    const relayed = relayedHeaders(response.headers, canvas.origin, relayOrigin);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers: known.asPerson ? sandboxedAsInTheirFrame(relayed) : relayed });
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
    if (asksForServiceWorker(request)) return noServiceWorker();
    if (machine.asPerson) return this.relayForPerson(machine, relayOrigin, request, server);
    if (askedFromAnotherPage(request)) return new Response("forbidden site", { status: 403 });
    if (!this.signedInAsOwner(request, fromThisComputer(request, server.requestIP(request)?.address, port))) return new Response("unauthorized", { status: 401 });
    const origin = request.headers.get("origin");
    if (origin !== null && !relayOrigins.includes(origin)) return new Response("forbidden origin", { status: 403 });

    const url = new URL(request.url);
    if (url.pathname === "/join" && request.method === "POST") return this.joinFromPage(machine, request);
    if (url.pathname.startsWith("/join-requests")) return refusedJoinFromPage();
    return this.relayAsOwnDevice(machine, relayOrigin, url, request, server);
  }

  private async relayAsOwnDevice(known: Machine, relayOrigin: string, url: URL, request: Request, server: Bun.Server<RelayedSocket>) {
    const machine = await this.tunnels.reached(known);
    if (!machine) return didNotAnswer(known);
    const opensSocket = request.headers.get("upgrade")?.toLowerCase() === "websocket";
    if (opensSocket) await this.machineCanvasWay(machine, true);
    const originFillIn = { method: request.method, fillsInMissingOrigin: true };
    const headers = forwardedHeaders(request.headers, machine.origin, this.store.machineDeviceToken(machine.id), await this.canvasAssetsOriginFor(machine), originFillIn);
    if (opensSocket) return this.relaySocket(machine, `${url.pathname}${url.search}`, headers, request, server);

    const response = await this.fetchFromMachine(machine, `${url.pathname}${url.search}`, request, headers);
    if (!response) return didNotAnswer(machine);
    if (response.status === 401) this.forgetRevokedSignIn(machine);
    const relayed = relayedHeaders(response.headers, machine.origin, relayOrigin);
    relayed.append("content-security-policy", framedOnlyBy(this.thisHostsPages));
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers: relayed });
  }

  /**
   * Someone else's machine, shown in an opaque origin, which sends no cookie and says its Origin is "null": what asks
   * under the relay key is signed in as this computer's person there, and nothing else is. The page's bundle, which the
   * machine serves anyone, loads from the bare path, signed in as nobody. This computer joins it from its own window only.
   */
  private async relayForPerson(known: Machine, relayOrigin: string, request: Request, server: Bun.Server<RelayedSocket>) {
    const origin = request.headers.get("origin");
    if (origin !== null && origin !== OPAQUE_ORIGIN) return new Response("forbidden origin", { status: 403 });
    const machine = await this.tunnels.reached(known);
    if (!machine) return didNotAnswer(known);
    const url = new URL(request.url);
    const path = pathPastKey(url.pathname, machine.relayKey);
    const opensSocket = request.headers.get("upgrade")?.toLowerCase() === "websocket";
    if (path === null) return this.relayPublicPart(machine, relayOrigin, url, request, opensSocket);
    if (path === "/join" || path.startsWith("/join-requests")) return refusedJoinFromPage();
    if (opensSocket) await this.machineCanvasWay(machine, true);
    const headers = forwardedHeaders(request.headers, machine.origin, this.store.machineDeviceToken(machine.id), await this.canvasAssetsOriginFor(machine));
    if (opensSocket) return this.relaySocket(machine, `${path}${url.search}`, headers, request, server);
    const response = await this.fetchFromMachine(machine, `${path}${url.search}`, request, headers);
    if (!response) return didNotAnswer(machine);
    if (response.status === 401) this.forgetRevokedSignIn(machine);
    const keyPath = `/${machine.relayKey}`;
    const body = request.method === "GET" && isPage(response) ? connectingToRelay(await response.text(), relayOrigin) : response.body;
    return new Response(body, { status: response.status, statusText: response.statusText, headers: sandboxedAsInTheirFrame(withOpenCors(relayedHeaders(response.headers, machine.origin, relayOrigin, keyPath))) });
  }

  private async relayPublicPart(machine: Machine, relayOrigin: string, url: URL, request: Request, opensSocket: boolean) {
    if (opensSocket || (request.method !== "GET" && request.method !== "HEAD")) return new Response("unauthorized", { status: 401 });
    const headers = forwardedHeaders(request.headers, machine.origin, null, await this.canvasAssetsOriginFor(machine));
    const response = await this.fetchFromMachine(machine, `${url.pathname}${url.search}`, request, headers);
    if (!response) return didNotAnswer(machine);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers: sandboxedAsInTheirFrame(withOpenCors(relayedHeaders(response.headers, machine.origin, relayOrigin))) });
  }

  /** `machine` as this host reaches it, through a forward only while that forward is still its dial's own. */
  private async fetchFromMachine(machine: Machine, path: string, request: Request, headers: Headers) {
    const way = this.tunnels.wayTo(machine);
    if (!way) return null;
    const init: RequestInit = {
      method: request.method,
      headers,
      body: sendsBody(request.method) ? request.body : undefined,
      redirect: "manual",
      ...trusting(this.store.machineAuthority(machine.id)),
    };
    return fetchAnswered(way, path, init, answerTimeoutFor(machine, request.method));
  }

  /** The machine, as this host reaches it, turns a request away when it revoked this computer; the rail then offers this computer's own way to join again. */
  private forgetRevokedSignIn(reached: Machine) {
    signInRevoked(this.store, reached, this.tunnels).then((revoked) => revoked && this.signedOut(reached.id));
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
