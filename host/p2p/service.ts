import { createHash } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import type { PeerToPeerStatus } from "../../shared/protocol.ts";
import type { DeviceTunnel, InviteTunnel, TunnelPlaces } from "../../shared/tunnel.ts";
import { inviteKey } from "../devices.ts";
import type { Store } from "../store.ts";
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
/** An invite waits this long for a sidecar that just started to hear from the broker, before it goes without the tunnel. */
export const INVITE_WAITS_FOR_BROKER_MS = 5_000;
/** A started sidecar the broker hasn't answered in this long can't be found through it: a firewall, or no network. */
const BROKER_UNREACHABLE_AFTER_MS = 15_000;
/** Longer paths don't fit in a Unix socket's address on macOS (104 bytes) and Linux (108). */
const LONGEST_SOCKET_PATH = 100;

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

/** The broker hosts use when the environment names none. Null until p2p.sodre90.com is ready for everyone's Miradors. */
export const BUILT_IN_BROKER: Broker | null = null;

export interface BuiltInPeerToPeer {
  sidecar: DownloadedSidecar | null;
  broker: Broker | null;
}

/**
 * The environment's sidecar and broker win, and naming only some of them is a mistake worth saying. Without them, the
 * host connects peer to peer through the built-in broker, with a sidecar it downloads the first time it needs one.
 */
export function peerToPeerSettings(environment: Record<string, string | undefined>, builtIn: BuiltInPeerToPeer): PeerToPeerSettings | null {
  const { MIRADOR_P2P_BINARY: binary, MIRADOR_P2P_BROKER: address, MIRADOR_P2P_BROKER_KEY: key } = environment;
  if (!binary && !address && !key) return builtIn.sidecar && builtIn.broker && { binary: builtIn.sidecar.path, download: builtIn.sidecar.download, broker: builtIn.broker };
  if (!binary || !address || !key) throw new Error("Peer to peer needs MIRADOR_P2P_BINARY, MIRADOR_P2P_BROKER and MIRADOR_P2P_BROKER_KEY together.");
  if (!isTunnelKey(key)) throw new Error("MIRADOR_P2P_BROKER_KEY is not a key: it is 32 bytes in base64.");
  const deviceBroker = environment.MIRADOR_P2P_DEVICE_BROKER || undefined;
  const candidates = environment.MIRADOR_P2P_CANDIDATES?.split(",").map((candidate) => candidate.trim()).filter(Boolean);
  return { binary, broker: { address, key }, ...(deviceBroker && { deviceBroker }), ...(candidates?.length && { candidates }) };
}

/** Who a tunnel listener's connections come from: a paired device, or anyone holding an invite's one-time key. */
export type TunnelEnd = { deviceId: string } | { joining: true };

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
  publicKey: string;
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
 * socket of its own, so the socket says which device it is, and an invite's one-time key reaches only a socket that
 * serves joining. Every key, a one-time key too, also reaches the canvas server, which serves no one's data.
 */
export class PeerToPeer {
  private readonly identity: TunnelIdentity;
  private readonly socketFolder: string;
  private readonly sidecar: Sidecar;
  private readonly listeners = new Map<string, TunnelListener>();
  private readonly joinKeys = new Map<string, JoinKey>();
  private joinListener: TunnelListener | null = null;
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
    this.socketFolder = join(folder, "s");
    const joinSocket = this.joinSocket();
    if (Buffer.byteLength(joinSocket) > LONGEST_SOCKET_PATH) throw new Error(`Peer to peer needs a shorter data folder: ${joinSocket} is too long for a Unix socket.`);
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

  /** Opens a listener for every paired device, and starts the sidecar with them pinned once there is a device to reach. */
  start(serve: ServeTunnel, statusChanged: () => void = () => {}) {
    this.serve = serve;
    this.statusChanged = statusChanged;
    mkdirSync(this.socketFolder, { recursive: true, mode: 0o700 });
    this.joinListener = this.listen(this.joinSocket(), { joining: true });
    const tunnels = this.store.deviceTunnels();
    tunnels.forEach(({ deviceId, key, address }) => this.letIn(deviceId, key, address));
    if (tunnels.length > 0) void this.sidecarRunning();
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
    this.sidecar.stop();
    this.listeners.forEach((listener) => listener.stop());
    this.listeners.clear();
    this.joinListener?.stop();
    this.joinKeys.forEach(({ expires }) => clearTimeout(expires));
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

  /** Why `key` can't be a device's tunnel key, or null when it can. */
  refusedKey(key: unknown): TunnelRefused | null {
    if (!isTunnelKey(key)) return new TunnelRefused(400, "The tunnel key is not a key: it is 32 bytes in base64.");
    const takenByJoining = [...this.joinKeys.values()].some(({ publicKey }) => publicKey === key);
    if (takenByJoining || this.store.deviceTunnels().some((tunnel) => tunnel.key === key)) return new TunnelRefused(409, "Another device already uses this tunnel key.");
    return null;
  }

  /** Lets the device in with `key` from now on, in place of any key it had; it keeps its address. */
  register(deviceId: string, key: unknown): DeviceTunnel {
    if (!isTunnelKey(key)) throw new TunnelRefused(400, "The tunnel key is not a key: it is 32 bytes in base64.");
    const holder = this.store.deviceTunnels().find((tunnel) => tunnel.key === key);
    if (holder && holder.deviceId !== deviceId) throw new TunnelRefused(409, "Another device already uses this tunnel key.");
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

  /** Lets a device in no more, and closes what it had open; call it before the device is deleted. */
  forget(deviceId: string) {
    const key = this.store.deviceTunnel(deviceId)?.key;
    if (key) this.sidecar.unpin(key);
    this.listeners.get(deviceId)?.stop();
    this.listeners.delete(deviceId);
  }

  /**
   * A one-time key for the invite with `code`, which reaches only the joining socket and the canvas server, and only
   * until the invite expires; null when the sidecar can't run or the broker doesn't answer, as devices would then find
   * no way in, so the invite offers no tunnel that goes nowhere.
   */
  async invite(code: string, expiresAt: number, waitForBrokerMs = INVITE_WAITS_FOR_BROKER_MS): Promise<InviteTunnel | null> {
    if (!(await this.sidecarRunning()) || !(await this.brokerReached(waitForBrokerMs))) return null;
    const { privateKey, publicKey } = newKeyPair();
    const joinAddress = newDeviceAddress(this.identity.prefix);
    const forInvite = inviteKey(code);
    const expires = setTimeout(() => this.letJoinKeyGo(forInvite), Math.max(0, expiresAt - this.now()));
    this.joinKeys.set(forInvite, { publicKey, expires });
    this.sidecar.pin({ key: publicKey, address: joinAddress, socket: this.joinSocket() });
    return { ...this.places(), joinKey: privateKey, joinAddress, name: this.store.machineName() };
  }

  inviteUsed(code: string) {
    const joinKey = this.joinKeys.get(inviteKey(code));
    if (!joinKey) return;
    clearTimeout(joinKey.expires);
    joinKey.expires = setTimeout(() => this.letJoinKeyGo(inviteKey(code)), this.joinKeyKeptAfterUseMs);
  }

  private letJoinKeyGo(forInvite: string) {
    const joinKey = this.joinKeys.get(forInvite);
    if (!joinKey) return;
    this.joinKeys.delete(forInvite);
    this.sidecar.unpin(joinKey.publicKey);
  }

  private letIn(deviceId: string, key: string, address: string) {
    const socket = this.deviceSocket(deviceId);
    if (!this.listeners.has(deviceId) && this.serve) this.listeners.set(deviceId, this.listen(socket, { deviceId }));
    this.sidecar.pin({ key, address, socket });
  }

  /** A socket left by a host that did not stop cleanly would keep the new listener from starting. */
  private listen(socket: string, end: TunnelEnd) {
    rmSync(socket, { force: true });
    return this.serve!(socket, end);
  }

  private joinSocket() {
    return join(this.socketFolder, "join.sock");
  }

  private deviceSocket(deviceId: string) {
    return join(this.socketFolder, `${createHash("sha256").update(deviceId).digest("hex").slice(0, 12)}.sock`);
  }
}
