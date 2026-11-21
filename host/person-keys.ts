import { createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign, verify } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ED25519_PUBLIC_KEY_BYTES = 32;
const ED25519_SIGNATURE_BYTES = 64;
const CHALLENGE_BYTES = 32;
const ROOM_JOIN_PURPOSE = "Mirador: join a room with this key";
const ROOM_JOIN_THROUGH_TUNNEL_PURPOSE = "Mirador: join a room with this key, through the machine's peer-to-peer tunnel";

/** Who this Mirador's owner is to other machines: a key pair made once, whose public half other machines know them by. */
export interface OwnerKey {
  /** The raw Ed25519 public key, in base64url. */
  publicKey: string;
  sign(statement: string): string;
}

const isBase64UrlOf = (bytes: number, value: unknown): value is string =>
  typeof value === "string" && /^[\w-]+$/.test(value) && Buffer.from(value, "base64url").length === bytes && Buffer.from(value, "base64url").toString("base64url") === value;

/** A key presented as a person's: an Ed25519 point in its one canonical encoding, of the curve's prime order, so that only its owner can sign for it. */
export const isPublicKey = (value: unknown): value is string => isBase64UrlOf(ED25519_PUBLIC_KEY_BYTES, value) && isPrimeOrderPoint(Buffer.from(value, "base64url"));

const isSignature = (value: unknown): value is string => isBase64UrlOf(ED25519_SIGNATURE_BYTES, value);

export const newChallenge = () => randomBytes(CHALLENGE_BYTES).toString("base64url");

/** Only what `newChallenge` makes is signed or taken, so no text another machine sends can stretch a statement over more lines. */
export const isChallenge = (value: unknown): value is string => isBase64UrlOf(CHALLENGE_BYTES, value);

/** Made in the data directory the first time, readable by this account alone, as the host's tokens are. */
export function ownerKey(dataDir: string): OwnerKey {
  const keyFile = join(dataDir, "owner-key.pem");
  if (!existsSync(keyFile)) writeFileSync(keyFile, generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600, flag: "wx" });
  const privateKey = createPrivateKey(readFileSync(keyFile, "utf8"));
  return {
    publicKey: createPublicKey(privateKey).export({ format: "jwk" }).x!,
    sign: (statement) => sign(null, Buffer.from(statement), privateKey).toString("base64url"),
  };
}

/** What a joiner signs for the certificate authority of the machine it joins when it trusts none of that machine's own there. */
export const NO_AUTHORITY = "none";

/**
 * How the joiner reached the machine it joins: at an address of the machine, as host and port, with the fingerprint of
 * the machine's own certificate authority it pinned there or NO_AUTHORITY; or through the machine's peer-to-peer tunnel,
 * whose handshake proved the machine holds the key the invite named.
 */
export type ReachedAt = { host: string; authorityFingerprint: string } | { tunnelKey: string };

/**
 * What joining a room signs: the inviting machine's challenge, the invite, how the joiner reached that machine, and the
 * key that joins. Through the tunnel the statement has a purpose of its own, so no proof made for an address reads as one
 * made through a tunnel, or the other way round.
 */
export type RoomJoin = ReachedAt & {
  challenge: string;
  /** The invite's code as `inviteKey` keeps it. */
  inviteKey: string;
  publicKey: string;
};

export const roomJoinStatement = (join: RoomJoin) =>
  "tunnelKey" in join
    ? [ROOM_JOIN_THROUGH_TUNNEL_PURPOSE, join.challenge, join.inviteKey, join.tunnelKey, join.publicKey].join("\n")
    : [ROOM_JOIN_PURPOSE, join.challenge, join.inviteKey, join.host, join.authorityFingerprint, join.publicKey].join("\n");

export function signedRoomJoin(join: RoomJoin, signature: unknown) {
  if (!isPublicKey(join.publicKey) || !isSignature(signature)) return false;
  const key = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: join.publicKey }, format: "jwk" });
  return verify(null, Buffer.from(roomJoinStatement(join)), key, Buffer.from(signature, "base64url"));
}

const FIELD = 2n ** 255n - 19n;
const GROUP_ORDER = 2n ** 252n + 27742317777372353535851937790883648493n;

const modulo = (value: bigint) => ((value % FIELD) + FIELD) % FIELD;

function power(base: bigint, exponent: bigint) {
  let result = 1n;
  let square = modulo(base);
  for (let rest = exponent; rest > 0n; rest >>= 1n) {
    if (rest & 1n) result = modulo(result * square);
    square = modulo(square * square);
  }
  return result;
}

const inverse = (value: bigint) => power(value, FIELD - 2n);
const CURVE_D = modulo(-121665n * inverse(121666n));
const SQUARE_ROOT_OF_MINUS_ONE = power(2n, (FIELD - 1n) / 4n);

/** A point in extended coordinates: x = X/Z, y = Y/Z, x·y = T/Z. */
interface Point {
  x: bigint;
  y: bigint;
  z: bigint;
  t: bigint;
}

const IDENTITY: Point = { x: 0n, y: 1n, z: 1n, t: 0n };

/** RFC 8032's addition for the twisted Edwards curve with a = −1, which doubles a point too. */
function add(one: Point, other: Point): Point {
  const a = modulo((one.y - one.x) * (other.y - other.x));
  const b = modulo((one.y + one.x) * (other.y + other.x));
  const c = modulo(one.t * 2n * CURVE_D * other.t);
  const d = modulo(one.z * 2n * other.z);
  const [e, f, g, h] = [b - a, d - c, d + c, b + a];
  return { x: modulo(e * f), y: modulo(g * h), t: modulo(e * h), z: modulo(f * g) };
}

function times(point: Point, scalar: bigint) {
  let result = IDENTITY;
  let doubled = point;
  for (let rest = scalar; rest > 0n; rest >>= 1n) {
    if (rest & 1n) result = add(result, doubled);
    doubled = add(doubled, doubled);
  }
  return result;
}

const isIdentity = (point: Point) => point.x === 0n && point.y === point.z;

/** RFC 8032's decoding, which turns away y ≥ p, points off the curve and x = 0 with its sign bit set: each point has one encoding. */
function decodedPoint(encoded: Buffer): Point | null {
  const sign = encoded[31]! >> 7;
  const y = BigInt(`0x${Buffer.from(encoded).reverse().toString("hex")}`) & ((1n << 255n) - 1n);
  if (y >= FIELD) return null;
  const u = modulo(y * y - 1n);
  const v = modulo(CURVE_D * y * y + 1n);
  let x = modulo(u * power(v, 3n) * power(u * power(v, 7n), (FIELD - 5n) / 8n));
  if (modulo(v * x * x) !== u) {
    if (modulo(v * x * x) !== modulo(-u)) return null;
    x = modulo(x * SQUARE_ROOT_OF_MINUS_ONE);
  }
  if (x === 0n && sign === 1) return null;
  if (Number(x & 1n) !== sign) x = FIELD - x;
  return { x, y, z: 1n, t: modulo(x * y) };
}

/** Of order ℓ: neither one of the eight points of small order, which anyone can sign for, nor such a point added to another. */
function isPrimeOrderPoint(encoded: Buffer) {
  const point = decodedPoint(encoded);
  return point !== null && !isIdentity(point) && isIdentity(times(point, GROUP_ORDER));
}
