import { generateKeyPairSync, randomBytes, randomInt } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** WireGuard's encoding: standard base64 of the 32 raw bytes. */
export interface TunnelKeyPair {
  privateKey: string;
  publicKey: string;
}

/** What this host is in the tunnel, the same across restarts so paired devices find it again. */
export interface TunnelIdentity {
  keyFile: string;
  publicKey: string;
  /** A random RFC 4193 /48, such as fd12:3456:789a. */
  prefix: string;
  /** The sidecar's UDP port, kept so the broker and devices find a restarted host where it was. */
  udpPort: number;
}

const UDP_PORTS = { from: 40_000, to: 60_000 };
const KEY_BYTES = 32;

const standardBase64 = (base64Url: string) => Buffer.from(base64Url, "base64url").toString("base64");

export function newKeyPair(): TunnelKeyPair {
  const jwk = generateKeyPairSync("x25519").privateKey.export({ format: "jwk" });
  return { privateKey: standardBase64(jwk.d!), publicKey: standardBase64(jwk.x!) };
}

export const isTunnelKey = (key: unknown): key is string =>
  typeof key === "string" && /^[A-Za-z0-9+/]{43}=$/.test(key) && Buffer.from(key, "base64").length === KEY_BYTES;

const groupsOf = (bytes: Buffer) => Array.from({ length: bytes.length / 2 }, (_, index) => bytes.readUInt16BE(index * 2).toString(16));

const randomPrefix = () => ["fd" + randomBytes(1).toString("hex"), ...groupsOf(randomBytes(4))].join(":");

export const hostAddressIn = (prefix: string) => `${prefix}:1::1`;

/** A random address in the host's /64 for a device, never the host's own. */
export function newDeviceAddress(prefix: string): string {
  const groups = groupsOf(randomBytes(8));
  const address = `${prefix}:1:${groups.join(":")}`;
  return groups.every((group, index) => (index === 3 ? group === "1" : group === "0")) ? newDeviceAddress(prefix) : address;
}

interface StoredIdentity {
  publicKey: string;
  prefix: string;
  udpPort: number;
}

/** Made once in `folder`, readable by this account alone: the private key stays in its own file, for the sidecar. */
export function tunnelIdentity(folder: string): TunnelIdentity {
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  chmodSync(folder, 0o700);
  const keyFile = join(folder, "key");
  const identityFile = join(folder, "identity.json");
  if (!existsSync(keyFile) || !existsSync(identityFile)) {
    const { privateKey, publicKey } = newKeyPair();
    const stored: StoredIdentity = { publicKey, prefix: randomPrefix(), udpPort: randomInt(UDP_PORTS.from, UDP_PORTS.to) };
    writeFileSync(keyFile, privateKey, { mode: 0o600 });
    writeFileSync(identityFile, JSON.stringify(stored), { mode: 0o600 });
  }
  const { publicKey, prefix, udpPort } = JSON.parse(readFileSync(identityFile, "utf8")) as StoredIdentity;
  return { keyFile, publicKey, prefix, udpPort };
}
