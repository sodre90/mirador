import { describe, expect, test } from "bun:test";
import { createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeviceService, inviteKey } from "../host/devices.ts";
import { isPublicKey, NO_AUTHORITY, ownerKey, roomJoinStatement } from "../host/person-keys.ts";
import { reachedAt, RoomInvites, type ReachedAt } from "../host/room-invites.ts";
import { Store } from "../host/store.ts";
import { HostProblemError } from "../shared/host-problems.ts";

const HOST = "127.0.0.1:4600";
const REACHED: ReachedAt = { host: HOST, authorityFingerprint: NO_AUTHORITY };
const MINUTE = 60_000;

function keyPair() {
  const { privateKey } = generateKeyPairSync("ed25519");
  const publicKey = createPublicKey(privateKey).export({ format: "jwk" }).x!;
  return { publicKey, sign: (statement: string) => sign(null, Buffer.from(statement), privateKey).toString("base64url") };
}

function machine(owners = keyPair()) {
  const clock = { now: 1_000_000 };
  const now = () => clock.now;
  const store = new Store(":memory:");
  store.insertWorkspace({ id: "w1", name: "project", path: "/tmp/project", defaultLaunch: { harness: "opencode", profileId: "p1" }, createdAt: 1 });
  store.insertRoom({ id: "r1", name: "Launch", workspaceId: "w1", agents: [], permissions: "read-freely", people: [], peoplesTasksWait: true, createdAt: 1 });
  const invites = new RoomInvites(store, new DeviceService(store, now), owners.publicKey, now);
  return { now, store, clock, invites };
}

const problemCode = (attempt: () => unknown) => {
  try {
    attempt();
  } catch (error) {
    if (error instanceof HostProblemError) return error.problem.code;
    throw error;
  }
  return null;
};

function presented(key: ReturnType<typeof keyPair>, code: string, challenge: string, reached = REACHED) {
  return { publicKey: key.publicKey, name: "Dora", color: "mint", challenge, signature: key.sign(roomJoinStatement({ challenge, inviteKey: inviteKey(code), ...reached, publicKey: key.publicKey })) };
}

describe("room invites", () => {
  test("stop admitting anyone once they expire, and are no longer listed", () => {
    const { clock, invites } = machine();
    const { code } = invites.invite("r1", "member");
    const challenge = invites.challenge(code, HOST)!;
    clock.now += 15 * MINUTE;
    expect(invites.challenge(code, HOST)).toBeNull();
    expect(problemCode(() => invites.redeem(code, "Dora's Mirador", presented(keyPair(), code, challenge), REACHED))).toBe("invite-code-wrong");
    expect(invites.waiting()).toEqual([]);
  });

  test("take a challenge only a little while, and only the newest for the invite", () => {
    const { clock, invites } = machine();
    const key = keyPair();
    const { code } = invites.invite("r1", "guest");
    const first = invites.challenge(code, HOST)!;
    const second = invites.challenge(code, HOST)!;
    expect(problemCode(() => invites.redeem(code, "Dora's Mirador", presented(key, code, first), REACHED))).toBe("room-join-unproven");
    clock.now += 2 * MINUTE;
    expect(problemCode(() => invites.redeem(code, "Dora's Mirador", presented(key, code, second), REACHED))).toBe("room-join-unproven");
    const third = invites.challenge(code, HOST)!;
    expect(invites.redeem(code, "Dora's Mirador", presented(key, code, third), REACHED).roomId).toBe("r1");
  });

  test("forget their challenges when withdrawn, and admit nobody after", () => {
    const { invites } = machine();
    const { code, invite } = invites.invite("r1", "member");
    const challenge = invites.challenge(code, HOST)!;
    invites.withdraw(invite.id);
    expect(invites.waitsFor(code)).toBe(false);
    expect(problemCode(() => invites.redeem(code, "Dora's Mirador", presented(keyPair(), code, challenge), REACHED))).toBe("invite-code-wrong");
  });

  test("go with their room", () => {
    const { store, invites } = machine();
    const { code } = invites.invite("r1", "member");
    store.deleteRoom("r1");
    expect(invites.waitsFor(code)).toBe(false);
    expect(problemCode(() => invites.invite("r1", "member"))).toBe("room-gone");
  });

  test("admit only a proof naming the certificate authority this machine answered with, or none where it served no certificate of its own", () => {
    const { invites } = machine();
    const key = keyPair();
    const { code } = invites.invite("r1", "member");
    const servedOwn: ReachedAt = { host: "home.example.ts.net:4602", authorityFingerprint: "own-authority" };
    const passedOn = invites.challenge(code, servedOwn.host)!;
    expect(problemCode(() => invites.redeem(code, "Dora's Mirador", presented(key, code, passedOn, { ...servedOwn, authorityFingerprint: NO_AUTHORITY }), servedOwn))).toBe("room-join-unproven");
    const pinnedAnother = invites.challenge(code, servedOwn.host)!;
    expect(problemCode(() => invites.redeem(code, "Dora's Mirador", presented(key, code, pinnedAnother, { ...servedOwn, authorityFingerprint: "someone-in-between" }), servedOwn))).toBe("room-join-unproven");
    const proven = invites.challenge(code, servedOwn.host)!;
    expect(invites.redeem(code, "Dora's Mirador", presented(key, code, proven, servedOwn), servedOwn).roomId).toBe("r1");
  });

  test("expect the certificate authority of this machine's own certificate only where that certificate answered: over its own HTTPS, never through a proxy's HTTP", () => {
    const asked = (url: string) => new Request(url, { headers: { host: new URL(url).host } });
    expect(reachedAt(asked("https://home.local:4602/join"), "own-authority")).toEqual({ host: "home.local:4602", authorityFingerprint: "own-authority" });
    expect(reachedAt(asked("https://home.example.ts.net/join"), null)).toEqual({ host: "home.example.ts.net", authorityFingerprint: NO_AUTHORITY });
    expect(reachedAt(asked("http://127.0.0.1:4600/join"), "own-authority")).toEqual({ host: "127.0.0.1:4600", authorityFingerprint: NO_AUTHORITY });
  });

  test("answer the owner's own key as they answer a proof that fails, and only once the proof holds", () => {
    const owners = keyPair();
    const { invites } = machine(owners);
    const { code } = invites.invite("r1", "member");
    const unproven = invites.challenge(code, HOST)!;
    const forged = { ...presented(keyPair(), code, unproven), publicKey: owners.publicKey };
    expect(problemCode(() => invites.redeem(code, "Me?", forged, REACHED))).toBe("room-join-unproven");
    const proven = invites.challenge(code, HOST)!;
    expect(problemCode(() => invites.redeem(code, "Me", presented(owners, code, proven), REACHED))).toBe("room-join-unproven");
    expect(invites.waitsFor(code)).toBe(true);
  });

  test("leave nothing behind when the device can't be made: no person, key or place in the room", () => {
    const { now, store, invites } = machine();
    const key = keyPair();
    const { code } = invites.invite("r1", "member");
    const failing = new RoomInvites(store, { admit: () => { throw new Error("disk full"); } } as unknown as DeviceService, keyPair().publicKey, now);
    const challenge = failing.challenge(code, HOST)!;
    expect(() => failing.redeem(code, "Dora's Mirador", presented(key, code, challenge), REACHED)).toThrow("disk full");
    expect(store.listPeople()).toHaveLength(1);
    expect(store.personWithKey(key.publicKey)).toBeUndefined();
    expect(store.findRoom("r1")?.people).toEqual([]);
    expect(invites.waitsFor(code)).toBe(true);
  });
});

/** The eight points of order 1, 2, 4 and 8, in their canonical encodings: anyone can sign for them, with any message. */
const SMALL_ORDER_POINTS = [
  "0100000000000000000000000000000000000000000000000000000000000000",
  "ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
  "0000000000000000000000000000000000000000000000000000000000000000",
  "0000000000000000000000000000000000000000000000000000000000000080",
  "26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05",
  "26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc85",
  "c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a",
  "c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac03fa",
];

const encoded = (hex: string) => Buffer.from(hex, "hex").toString("base64url");

/** y as 32 little-endian bytes, with x's sign in the top bit. */
function pointEncoding(y: bigint, xIsOdd: boolean) {
  const bytes = Buffer.from(y.toString(16).padStart(64, "0"), "hex").reverse();
  bytes[31] = (bytes[31]! & 0x7f) | (xIsOdd ? 0x80 : 0);
  return bytes.toString("base64url");
}

const FIELD = 2n ** 255n - 19n;
const yOf = (publicKey: string) => BigInt(`0x${Buffer.from(publicKey, "base64url").reverse().toString("hex")}`) & ((1n << 255n) - 1n);
const xIsOddIn = (publicKey: string) => (Buffer.from(publicKey, "base64url")[31]! & 0x80) !== 0;

describe("a person's public key", () => {
  test("is a real Ed25519 key", () => {
    Array.from({ length: 5 }, () => keyPair().publicKey).forEach((publicKey) => expect(isPublicKey(publicKey)).toBe(true));
  });

  test("is none of the eight points of small order", () => {
    SMALL_ORDER_POINTS.forEach((point) => expect([point, isPublicKey(encoded(point))]).toEqual([point, false]));
  });

  test("is none of them encoded another way: y past the field's prime, or x of 0 with its sign set", () => {
    expect(isPublicKey(pointEncoding(FIELD, false))).toBe(false);
    expect(isPublicKey(pointEncoding(FIELD, true))).toBe(false);
    expect(isPublicKey(pointEncoding(FIELD + 1n, false))).toBe(false);
    expect(isPublicKey(encoded("0100000000000000000000000000000000000000000000000000000000000080"))).toBe(false);
    expect(isPublicKey(encoded("ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"))).toBe(false);
  });

  test("is no real key with the point of order two added, (x, y) made (−x, −y)", () => {
    Array.from({ length: 5 }, () => keyPair().publicKey).forEach((publicKey) =>
      expect(isPublicKey(pointEncoding(FIELD - yOf(publicKey), !xIsOddIn(publicKey)))).toBe(false),
    );
  });

  test("is not a point off the curve", () => {
    expect(isPublicKey(encoded("0200000000000000000000000000000000000000000000000000000000000000"))).toBe(false);
  });
});

describe("the owner's key", () => {
  test("is made once, readable by this account alone, and signs what it is asked", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "mirador-owner-key-"));
    try {
      const first = ownerKey(dataDir);
      expect(ownerKey(dataDir).publicKey).toBe(first.publicKey);
      expect(statSync(join(dataDir, "owner-key.pem")).mode & 0o777).toBe(0o600);
      expect(Buffer.from(first.publicKey, "base64url")).toHaveLength(32);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
