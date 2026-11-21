import { createHash } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import type { PeerToPeerStatus } from "../../shared/protocol.ts";
import type { DeviceTunnel, InviteTunnel, TunnelPlaces } from "../../shared/tunnel.ts";
import { inviteKey } from "../devices.ts";
import { SenderLimit } from "../join-requests.ts";
import { problemResponse } from "../problem-response.ts";
import type { KeyOverKind, PublicTunnelKey, Store } from "../store.ts";
import { hostAddressIn, isTunnelKey, newDeviceAddress, newKeyPair, tunnelIdentity, type TunnelIdentity } from "./identity.ts";
import { Sidecar } from "./sidecar.ts";
import { installSidecar, type DownloadedSidecar, type SidecarDownload } from "./sidecar-download.ts";

/** Inside the tunnel, devices reach the host's web server at this port of its tunnel address. */
export const TUNNEL_PORT = 4600;
/** And its canvas server at this one, which serves every paired device alike, as it does on the network. */
export const CANVAS_TUNNEL_PORT = 4601;
/**
 * A used invite's one-time key is let in a little longer, so the reply to the join that used it gets back through the
 * tunnel; it reaches nothing but joining, with a code that no longer works.
 */
const JOIN_KEY_KEPT_AFTER_USE_MS = 10_000;
/**
 * How long a key that is over still hears so. A device's long enough for a Mirador that was off meanwhile to come back
 * and learn it; an invite's only while someone may still try a link they were sent, as links get passed around.
 */
const KEY_OVER_FOR_MS: Record<KeyOverKind, number> = { device: 30 * 24 * 60 * 60_000, invite: 24 * 60 * 60_000 };
/** At most this many of each kind at once, the newest kept, so invites never push out removed devices' keys: each is a pin of the sidecar and a row of the store. */
const MOST_KEYS_OVER_OF_A_KIND = 50;
/** How often the keys over whose time ran out are let go. */
const KEYS_OVER_LET_GO_EVERY_MS = 60 * 60_000;

/**
 * All a key that is over reaches, the same for every request, path and socket asked for: what its holder gets at this
 * host's address once it is over. A revoked device's token is unauthorized there, and a used, expired or withdrawn
 * invite's code wrong, which tells a person's Mirador it is out, or that its invite is, rather than nothing answering.
 */
const ANSWER_TO_KEY_OVER: Record<KeyOverKind, () => Response> = {
  device: () => new Response("unauthorized", { status: 401 }),
  invite: () => problemResponse({ code: "invite-code-wrong" }, 403),
};
/**
 * Answers a minute to the keys over of each kind together, as one socket can't tell them apart; a budget of their own,
 * so they can't use up joining's.
 */
export const MOST_ANSWERS_TO_KEYS_OVER_A_MINUTE = 120;
const ANSWER_TO_KEY_OVER_TOO_OFTEN: Record<KeyOverKind, () => Response> = {
  device: () => new Response("too many requests", { status: 429 }),
  invite: () => problemResponse({ code: "join-too-often" }, 429),
};
/** An invite waits this long for a sidecar that just started to hear from the broker, before it goes without the tunnel. */
export const INVITE_WAITS_FOR_BROKER_MS = 5_000;
/** A started sidecar the broker hasn't answered in this long can't be found through it: a firewall, or no network. */
const BROKER_UNREACHABLE_AFTER_MS = 15_000;
/** Longer paths don't fit in a Unix socket's address on macOS (104 bytes) and Linux (108). */
export const LONGEST_SOCKET_PATH = 100;

export interface PeerToPeerSettings {
  binary: string;
  /** Where to fetch the binary from the first time it is needed, when the environment does not name one. */
  download?: SidecarDownload;
  broker: { address: string; key: string };
  /** Where devices reach the broker, when it is not where this host does: a broker on this machine, say. */
  deviceBroker?: string;
  /** Addresses devices may reach the sidecar at besides this machine's own, such as a port forwarded on the router. */
  candidates?: string[];
  /** The canvas server on this machine's loopback, which devices reach through the tunnel at CANVAS_TUNNEL_PORT. */
  canvasAssetsPort?: number;
}

type Broker = PeerToPeerSettings["broker"];

/** The broker hosts use when the environment names none. Devices keep its name from their invites, so it moves with DNS, never by renaming. */
export const BUILT_IN_BROKER: Broker = { address: "p2p.sodre90.com:47800", key: "PsrAwnWrWi1LsRJnRUE8vcZNAAwXdgPu9Vfq60bipRA=" };

export interface BuiltInPeerToPeer {
  sidecar: DownloadedSidecar | null;
  broker: Broker | null;
}

/**
 * The environment's sidecar and broker win, and naming only some of them is a mistake worth saying. Without them, the
 * host connects peer to peer through the built-in broker, with a sidecar it downloads the first time it needs one,
 * unless MIRADOR_P2P=off keeps it from reaching out at all, as the hosts of tests are kept.
 */
export function peerToPeerSettings(environment: Record<string, string | undefined>, builtIn: BuiltInPeerToPeer): PeerToPeerSettings | null {
  const { MIRADOR_P2P_BINARY: binary, MIRADOR_P2P_BROKER: address, MIRADOR_P2P_BROKER_KEY: key } = environment;
  if (!binary && !address && !key) {
    const { sidecar, broker } = builtIn;
    return environment.MIRADOR_P2P !== "off" && sidecar && broker ? { binary: sidecar.path, download: sidecar.download, broker } : null;
  }
  if (!binary || !address || !key) throw new Error("Peer to peer needs MIRADOR_P2P_BINARY, MIRADOR_P2P_BROKER and MIRADOR_P2P_BROKER_KEY together.");
  if (!isTunnelKey(key)) throw new Error("MIRADOR_P2P_BROKER_KEY is not a key: it is 32 bytes in base64.");
  const deviceBroker = environment.MIRADOR_P2P_DEVICE_BROKER || undefined;
  const candidates = environment.MIRADOR_P2P_CANDIDATES?.split(",").map((candidate) => candidate.trim()).filter(Boolean);
  return { binary, broker: { address, key }, ...(deviceBroker && { deviceBroker }), ...(candidates?.length && { candidates }) };
}

/**
 * Peer to peer the environment names is a setting worth failing on; the built-in one nobody asked for never keeps the
 * host from starting, which goes without it and says why.
 */
export function peerToPeerUnlessBuiltInFails<Made>(environment: Record<string, string | undefined>, make: () => Made): Made | null {
  try {
    return make();
  } catch (error) {
    if (environment.MIRADOR_P2P_BINARY) throw error;
    console.error(`Peer to peer is off: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/**
 * Who a tunnel listener's connections come from: a paired device, or whoever holds the one-time key of the invite whose
 * code `inviteKey` keeps, as each invite's key reaches a socket of its own.
 */
export type TunnelEnd = { deviceId: string } | { inviteKey: string };

/** A server listening on a Unix socket for one end of the tunnel. */
export interface TunnelListener {
  stop(): void;
}

export type ServeTunnel = (socket: string, end: TunnelEnd) => TunnelListener;

/** Refused because of what the device sent, so the request answers with a 4xx status. */
export class TunnelRefused extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

interface JoinKey {
  pinned: PublicTunnelKey;
  listener: TunnelListener;
  expires: ReturnType<typeof setTimeout>;
}

/** Addresses on this machine's networks, where a device on the same network may reach the sidecar directly. */
function localCandidates(udpPort: number) {
  return Object.values(networkInterfaces())
    .flat()
    .filter((address) => address && !address.internal && address.family === "IPv4")
    .map((address) => `${address!.address}:${udpPort}`);
}

/**
 * Devices reach this host peer to peer through the sidecar: each paired device's tunnel connections arrive on a Unix
 * socket of its own, so the socket says which device it is, and an invite's one-time key reaches only a socket of that
 * invite's own, which serves joining with that invite alone. Every key, a one-time key too, also reaches the canvas
 * server, which serves no one's data.
 *
 * A key that is over, a revoked device's or an ended invite's, is let in a while longer, to one of two sockets that
 * answer nothing but that it is over, so the Mirador holding it learns so instead of hearing nothing; at most
 * MOST_KEYS_OVER of them, for KEY_OVER_FOR_MS each, kept in the store across restarts.
 */
export class PeerToPeer {
  private readonly identity: TunnelIdentity;
  private readonly socketFolder: string;
  private readonly sidecar: Sidecar;
  private readonly listeners = new Map<string, TunnelListener>();
  private readonly joinKeys = new Map<string, JoinKey>();
  private readonly keysOverListeners = new Map<KeyOverKind, TunnelListener>();
  private readonly answersToKeysOver: SenderLimit;
  private keysOverLettingGo: ReturnType<typeof setInterval> | null = null;
  private serve: ServeTunnel | null = null;
  private sidecarStarted: Promise<boolean> | null = null;
  private status: PeerToPeerStatus = "waiting";
  private statusChanged: () => void = () => {};
  private readonly brokerAnswered = new Set<() => void>();
  private unreachableTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly settings: PeerToPeerSettings,
    folder: string,
    private readonly store: Store,
    private readonly now: () => number = Date.now,
    private readonly joinKeyKeptAfterUseMs = JOIN_KEY_KEPT_AFTER_USE_MS,
  ) {
    this.identity = tunnelIdentity(folder);
    this.answersToKeysOver = new SenderLimit(now, MOST_ANSWERS_TO_KEYS_OVER_A_MINUTE);
    this.socketFolder = join(folder, "s");
    const longestSocket = this.socketFor("device", "any");
    if (Buffer.byteLength(longestSocket) > LONGEST_SOCKET_PATH) throw new Error(`Peer to peer needs a shorter data folder: ${longestSocket} is too long for a Unix socket.`);
    const { keyFile, prefix, udpPort } = this.identity;
    this.sidecar = new Sidecar(
      [
      settings.binary,
      "sidecar",
      `--udp=0.0.0.0:${udpPort}`,
      `--key-file=${keyFile}`,
      `--address=${hostAddressIn(prefix)}`,
      `--port=${TUNNEL_PORT}`,
      `--broker=${settings.broker.address}`,
      `--broker-key=${settings.broker.key}`,
      ...(settings.canvasAssetsPort ? [`--forward=${CANVAS_TUNNEL_PORT}=127.0.0.1:${settings.canvasAssetsPort}`] : []),
      ...[...localCandidates(udpPort), ...(settings.candidates ?? [])].map((candidate) => `--candidate=${candidate}`),
      ],
      undefined,
      (reached) => this.brokerContact(reached),
    );
  }

  /**
   * Opens a listener for every paired device and every waiting invite's one-time key, pins the keys that are over to
   * theirs, and starts the sidecar once there is a key to let in. An invite that expired while the host was off has its
   * key over from now.
   */
  start(serve: ServeTunnel, statusChanged: () => void = () => {}) {
    this.serve = serve;
    this.statusChanged = statusChanged;
    mkdirSync(this.socketFolder, { recursive: true, mode: 0o700 });
    this.letKeysOverGo();
    const tunnels = this.store.deviceTunnels();
    tunnels.forEach(({ deviceId, key, address }) => this.letIn(deviceId, key, address));
    const waitingJoinKeys = this.store.waitingInviteJoinKeys(this.now());
    waitingJoinKeys.forEach(({ codeKey, key, address, expiresAt }) => this.pinJoinKey(codeKey, { key, address }, expiresAt));
    this.store.takeExpiredInviteJoinKeys(this.now()).forEach((expired) => this.rememberKeyOver(expired, "invite"));
    const letIn = new Set([...tunnels, ...waitingJoinKeys].map(({ key }) => key));
    const keysOver = this.store.keysOver().filter(({ key }) => !letIn.has(key));
    keysOver.forEach(({ key, address, kind }) => this.sidecar.pin({ key, address, socket: this.keysOverSocket(kind), socket_only: true }));
    this.keysOverLettingGo = setInterval(() => this.letKeysOverGo(), KEYS_OVER_LET_GO_EVERY_MS);
    if (tunnels.length + waitingJoinKeys.length + keysOver.length > 0) void this.sidecarRunning();
  }

  /**
   * Starts the sidecar the first time something needs it, downloading it first when it comes from a release. A
   * download that failed is tried again by whatever needs the sidecar next.
   */
  sidecarRunning(): Promise<boolean> {
    this.sidecarStarted ??= this.startSidecar();
    return this.sidecarStarted;
  }

  private async startSidecar() {
    try {
      if (this.settings.download) await installSidecar(this.settings.binary, this.settings.download);
    } catch (error) {
      console.error(`p2p: ${error instanceof Error ? error.message : String(error)}`);
      this.sidecarStarted = null;
      this.setStatus("sidecar-unavailable");
      return false;
    }
    this.setStatus("connecting");
    this.waitForTheBroker();
    this.sidecar.start();
    return true;
  }

  peerToPeerStatus(): PeerToPeerStatus {
    return this.status;
  }

  private brokerContact(reached: boolean) {
    if (reached) {
      if (this.unreachableTimer) clearTimeout(this.unreachableTimer);
      this.unreachableTimer = null;
      this.setStatus("ready");
      this.brokerAnswered.forEach((answered) => answered());
      this.brokerAnswered.clear();
    } else if (this.status === "ready" || this.status === "connecting") {
      if (this.unreachableTimer) clearTimeout(this.unreachableTimer);
      this.unreachableTimer = null;
      this.setStatus("broker-unreachable");
    }
  }

  /** Until the broker first answers, the sidecar says nothing, so not hearing from it in a while is what tells. */
  private waitForTheBroker() {
    if (this.unreachableTimer) clearTimeout(this.unreachableTimer);
    this.unreachableTimer = setTimeout(() => {
      this.unreachableTimer = null;
      if (this.status === "connecting") this.setStatus("broker-unreachable");
    }, BROKER_UNREACHABLE_AFTER_MS);
  }

  private setStatus(status: PeerToPeerStatus) {
    if (status === this.status) return;
    this.status = status;
    this.statusChanged();
  }

  /** Whether the broker answers, waiting up to `withinMs` for a sidecar that is still connecting. */
  private async brokerReached(withinMs: number) {
    if (this.status === "ready") return true;
    if (this.status !== "connecting") return false;
    return new Promise<boolean>((resolve) => {
      const answered = () => {
        clearTimeout(timer);
        resolve(true);
      };
      const timer = setTimeout(() => {
        this.brokerAnswered.delete(answered);
        resolve(false);
      }, withinMs);
      this.brokerAnswered.add(answered);
    });
  }

  stop() {
    if (this.unreachableTimer) clearTimeout(this.unreachableTimer);
    if (this.keysOverLettingGo) clearInterval(this.keysOverLettingGo);
    this.sidecar.stop();
    this.listeners.forEach((listener) => listener.stop());
    this.listeners.clear();
    this.joinKeys.forEach(({ expires, listener }) => {
      clearTimeout(expires);
      listener.stop();
    });
    this.joinKeys.clear();
    this.keysOverListeners.forEach((listener) => listener.stop());
    this.keysOverListeners.clear();
  }

  /** This host's own key in the tunnel, which every device and joiner's handshake checks it holds. */
  get publicKey() {
    return this.identity.publicKey;
  }

  places(): TunnelPlaces {
    return {
      hostKey: this.identity.publicKey,
      hostAddress: hostAddressIn(this.identity.prefix),
      port: TUNNEL_PORT,
      ...(this.settings.canvasAssetsPort && { canvasPort: CANVAS_TUNNEL_PORT }),
      broker: { ...this.settings.broker, address: this.settings.deviceBroker ?? this.settings.broker.address },
    };
  }

  /** Why `key` can't be a device's tunnel key, or null when it can: a key that is over stays over. */
  refusedKey(key: unknown): TunnelRefused | null {
    if (!isTunnelKey(key)) return new TunnelRefused(400, "The tunnel key is not a key: it is 32 bytes in base64.");
    const takenByJoining = [...this.joinKeys.values()].some(({ pinned }) => pinned.key === key);
    if (takenByJoining || this.store.isKeyOver(key) || this.store.deviceTunnels().some((tunnel) => tunnel.key === key)) return new TunnelRefused(409, "Another device already uses this tunnel key.");
    return null;
  }

  /** Lets the device in with `key` from now on, in place of any key it had; it keeps its address. */
  register(deviceId: string, key: unknown): DeviceTunnel {
    if (!isTunnelKey(key)) throw new TunnelRefused(400, "The tunnel key is not a key: it is 32 bytes in base64.");
    const holder = this.store.deviceTunnels().find((tunnel) => tunnel.key === key);
    if ((holder && holder.deviceId !== deviceId) || this.store.isKeyOver(key)) throw new TunnelRefused(409, "Another device already uses this tunnel key.");
    const current = this.store.deviceTunnel(deviceId);
    if (!current) throw new TunnelRefused(404, "This device is not paired with this Mirador.");
    const address = current.address ?? newDeviceAddress(this.identity.prefix);
    if (current.key !== key) {
      if (current.key) this.sidecar.unpin(current.key);
      this.store.setDeviceTunnel(deviceId, { key, address });
      this.letIn(deviceId, key, address);
    }
    void this.sidecarRunning();
    return { ...this.places(), deviceAddress: address };
  }

  /** Lets a device in no more, and closes what it had open; its key is over from now. Call it before the device is deleted. */
  forget(deviceId: string) {
    const { key, address } = this.store.deviceTunnel(deviceId) ?? {};
    if (key && address) this.keyOver({ key, address }, "device");
    this.listeners.get(deviceId)?.stop();
    this.listeners.delete(deviceId);
  }

  /**
   * A one-time key for the invite with `code`, which reaches only a joining socket of the invite's own and the canvas
   * server, and only until the invite expires; null when the sidecar can't run or the broker doesn't answer, as devices
   * would then find no way in, so the invite offers no tunnel that goes nowhere.
   */
  async invite(code: string, expiresAt: number, waitForBrokerMs = INVITE_WAITS_FOR_BROKER_MS): Promise<InviteTunnel | null> {
    if (!this.serve || !(await this.sidecarRunning()) || !(await this.brokerReached(waitForBrokerMs))) return null;
    const { privateKey, publicKey } = newKeyPair();
    const joinKey = { key: publicKey, address: newDeviceAddress(this.identity.prefix) };
    const forInvite = inviteKey(code);
    this.store.setInviteJoinKey(forInvite, joinKey);
    this.pinJoinKey(forInvite, joinKey, expiresAt);
    return { ...this.places(), joinKey: privateKey, joinAddress: joinKey.address, name: this.store.machineName() };
  }

  /** The one-time key is over from now, also after a restart, though its joining socket keeps it a little longer for the reply. */
  inviteUsed(code: string) {
    const forInvite = inviteKey(code);
    const joinKey = this.joinKeys.get(forInvite);
    if (!joinKey) return;
    this.rememberKeyOver(joinKey.pinned, "invite");
    clearTimeout(joinKey.expires);
    joinKey.expires = setTimeout(() => this.letJoinKeyGo(forInvite), this.joinKeyKeptAfterUseMs);
  }

  /** At once, for an invite withdrawn or gone with its room: `forInvite` is its code as `inviteKey` keeps it. */
  inviteWithdrawn(forInvite: string) {
    this.letJoinKeyGo(forInvite);
  }

  private pinJoinKey(forInvite: string, pinned: PublicTunnelKey, expiresAt: number) {
    const socket = this.socketFor("invite", forInvite);
    const listener = this.listen(socket, { inviteKey: forInvite });
    const expires = setTimeout(() => this.letJoinKeyGo(forInvite), Math.max(0, expiresAt - this.now()));
    this.joinKeys.set(forInvite, { pinned, listener, expires });
    this.sidecar.pin({ ...pinned, socket });
  }

  /** Its joining socket closes, and the key is over. */
  private letJoinKeyGo(forInvite: string) {
    const joinKey = this.joinKeys.get(forInvite);
    if (!joinKey) return;
    this.joinKeys.delete(forInvite);
    clearTimeout(joinKey.expires);
    joinKey.listener.stop();
    this.keyOver(joinKey.pinned, "invite");
  }

  /**
   * Pinned again to the socket that tells it it is over, in place of where it led, which closes what it had open.
   * Unpinned first: a sidecar that doesn't know a pin to a socket alone ignores that pin, and must not keep the old one.
   */
  private keyOver(over: PublicTunnelKey, kind: KeyOverKind) {
    this.rememberKeyOver(over, kind);
    this.sidecar.unpin(over.key);
    this.sidecar.pin({ ...over, socket: this.keysOverSocket(kind), socket_only: true });
  }

  /** In the store, so it is over after a restart too; the oldest of its kind past MOST_KEYS_OVER_OF_A_KIND go at once. */
  private rememberKeyOver(over: PublicTunnelKey, kind: KeyOverKind) {
    this.store.addKeyOver({ ...over, kind, until: this.now() + KEY_OVER_FOR_MS[kind] }, MOST_KEYS_OVER_OF_A_KIND).forEach((key) => this.sidecar.unpin(key));
  }

  private letKeysOverGo() {
    this.store.takeKeysOverEndedBy(this.now()).forEach((key) => this.sidecar.unpin(key));
  }

  /** Where keys of the kind that are over reach, listened on from when the first needs it. */
  private keysOverSocket(kind: KeyOverKind) {
    const socket = this.socketFor("over", kind);
    if (!this.keysOverListeners.has(kind)) {
      rmSync(socket, { force: true });
      const server = Bun.serve({ unix: socket, fetch: () => this.answerToKeyOver(kind) });
      this.keysOverListeners.set(kind, { stop: () => void server.stop(true) });
    }
    return socket;
  }

  private answerToKeyOver(kind: KeyOverKind) {
    return (this.answersToKeysOver.allows(kind) ? ANSWER_TO_KEY_OVER : ANSWER_TO_KEY_OVER_TOO_OFTEN)[kind]();
  }

  private letIn(deviceId: string, key: string, address: string) {
    const socket = this.socketFor("device", deviceId);
    if (!this.listeners.has(deviceId) && this.serve) this.listeners.set(deviceId, this.listen(socket, { deviceId }));
    this.sidecar.pin({ key, address, socket });
  }

  /** A socket left by a host that did not stop cleanly would keep the new listener from starting. */
  private listen(socket: string, end: TunnelEnd) {
    rmSync(socket, { force: true });
    return this.serve!(socket, end);
  }

  /** Every socket's name is as long, a device's, an invite's and those of keys that are over alike, and none can be another's. */
  private socketFor(kind: "device" | "invite" | "over", id: string) {
    const name = kind === "device" ? id : `${kind} ${id}`;
    return join(this.socketFolder, `${createHash("sha256").update(name).digest("hex").slice(0, 12)}.sock`);
  }
}
