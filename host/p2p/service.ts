import { createHash } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { hostname, networkInterfaces } from "node:os";
import { join } from "node:path";
import type { DeviceTunnel, InviteTunnel, TunnelPlaces } from "../../shared/tunnel.ts";
import { inviteKey } from "../devices.ts";
import type { Store } from "../store.ts";
import { hostAddressIn, isTunnelKey, newDeviceAddress, newKeyPair, tunnelIdentity, type TunnelIdentity } from "./identity.ts";
import { Sidecar } from "./sidecar.ts";

/** Inside the tunnel, devices reach the host's web server at this port of its tunnel address. */
export const TUNNEL_PORT = 4600;
/**
 * A used invite's one-time key is let in a little longer, so the reply to the join that used it gets back through the
 * tunnel; it reaches nothing but joining, with a code that no longer works.
 */
const JOIN_KEY_KEPT_AFTER_USE_MS = 10_000;
/** Longer paths don't fit in a Unix socket's address on macOS (104 bytes) and Linux (108). */
const LONGEST_SOCKET_PATH = 100;

export interface PeerToPeerSettings {
  binary: string;
  broker: { address: string; key: string };
}

/** On only when the environment names the sidecar and the broker; anything else is a mistake worth saying. */
export function peerToPeerSettings(environment: Record<string, string | undefined>): PeerToPeerSettings | null {
  const { MIRADOR_P2P_BINARY: binary, MIRADOR_P2P_BROKER: address, MIRADOR_P2P_BROKER_KEY: key } = environment;
  if (!binary && !address && !key) return null;
  if (!binary || !address || !key) throw new Error("Peer to peer needs MIRADOR_P2P_BINARY, MIRADOR_P2P_BROKER and MIRADOR_P2P_BROKER_KEY together.");
  if (!isTunnelKey(key)) throw new Error("MIRADOR_P2P_BROKER_KEY is not a key: it is 32 bytes in base64.");
  return { binary, broker: { address, key } };
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
 * serves joining.
 */
export class PeerToPeer {
  private readonly identity: TunnelIdentity;
  private readonly socketFolder: string;
  private readonly sidecar: Sidecar;
  private readonly listeners = new Map<string, TunnelListener>();
  private readonly joinKeys = new Map<string, JoinKey>();
  private joinListener: TunnelListener | null = null;
  private serve: ServeTunnel | null = null;

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
    this.sidecar = new Sidecar([
      settings.binary,
      "sidecar",
      `--udp=0.0.0.0:${udpPort}`,
      `--key-file=${keyFile}`,
      `--address=${hostAddressIn(prefix)}`,
      `--port=${TUNNEL_PORT}`,
      `--broker=${settings.broker.address}`,
      `--broker-key=${settings.broker.key}`,
      ...localCandidates(udpPort).map((candidate) => `--candidate=${candidate}`),
    ]);
  }

  /** Opens a listener for every paired device and starts the sidecar with them pinned. */
  start(serve: ServeTunnel) {
    this.serve = serve;
    mkdirSync(this.socketFolder, { recursive: true, mode: 0o700 });
    this.joinListener = this.listen(this.joinSocket(), { joining: true });
    this.store.deviceTunnels().forEach(({ deviceId, key, address }) => this.letIn(deviceId, key, address));
    this.sidecar.start();
  }

  stop() {
    this.sidecar.stop();
    this.listeners.forEach((listener) => listener.stop());
    this.listeners.clear();
    this.joinListener?.stop();
    this.joinKeys.forEach(({ expires }) => clearTimeout(expires));
  }

  places(): TunnelPlaces {
    return { hostKey: this.identity.publicKey, hostAddress: hostAddressIn(this.identity.prefix), port: TUNNEL_PORT, broker: this.settings.broker };
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
    return { ...this.places(), deviceAddress: address };
  }

  /** Lets a device in no more, and closes what it had open; call it before the device is deleted. */
  forget(deviceId: string) {
    const key = this.store.deviceTunnel(deviceId)?.key;
    if (key) this.sidecar.unpin(key);
    this.listeners.get(deviceId)?.stop();
    this.listeners.delete(deviceId);
  }

  /** A one-time key for the invite with `code`, which reaches only the joining socket and only until the invite expires. */
  invite(code: string, expiresAt: number): InviteTunnel {
    const { privateKey, publicKey } = newKeyPair();
    const joinAddress = newDeviceAddress(this.identity.prefix);
    const forInvite = inviteKey(code);
    const expires = setTimeout(() => this.letJoinKeyGo(forInvite), Math.max(0, expiresAt - this.now()));
    this.joinKeys.set(forInvite, { publicKey, expires });
    this.sidecar.pin({ key: publicKey, address: joinAddress, socket: this.joinSocket() });
    return { ...this.places(), joinKey: privateKey, joinAddress, name: hostname().replace(/\.local$/, "") };
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
