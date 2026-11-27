import { describe, expect, spyOn, test } from "bun:test";
import { createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeviceService, inviteKey } from "../host/devices.ts";
import { isPublicKey, NO_AUTHORITY, ownerKey, roomJoinStatement } from "../host/person-keys.ts";
import { reachedAt, RoomInvites, type ReachedAt } from "../host/room-invites.ts";
import { Store } from "../host/store.ts";
import { HostProblemError } from "../shared/host-problems.ts";
import { ALL_OF_CLAUDE_SETUP } from "../shared/room-agent-setup.ts";
import type { RoomInviteLifetime } from "../shared/rooms.ts";
import { NO_SANDBOX } from "../shared/sandbox.ts";

const HOST = "127.0.0.1:4600";
const CODE = "ROOM-ABCD-EFGH-JKLM";
const TUNNEL_KEY = "TfdU+RVSAYU/VwqNJh5dDtXFyyZCkHgiPG8knt29NU0=";
const REACHED: ReachedAt = { host: HOST, authorityFingerprint: NO_AUTHORITY };
/** Who asks for a challenge, as the limits on joining tell senders apart: an address, or an invite's end of the tunnel, where everyone with its link is one. */
const REQUESTER = "192.0.2.1";
const TUNNEL_REQUESTER = "tunnel invite one-time";
const MINUTE = 60_000;

function keyPair() {
  const { privateKey } = generateKeyPairSync("ed25519");
  const publicKey = createPublicKey(privateKey).export({ format: "jwk" }).x!;
  return { publicKey, sign: (statement: string) => sign(null, Buffer.from(statement), privateKey).toString("base64url") };
}

const addRoom = (store: Store, id: string) =>
  store.insertRoom({ id, name: "Launch", workspaceId: "w1", agents: [], permissions: "read-freely", people: [], peoplesTasksWait: true, claudeSetup: ALL_OF_CLAUDE_SETUP, agentsReadGuests: true, membersBringAgents: true, sandbox: NO_SANDBOX, createdAt: 1 });

function machine(owners = keyPair()) {
  const clock = { now: 1_000_000 };
  const now = () => clock.now;
  const store = new Store(":memory:");
  store.insertWorkspace({ id: "w1", name: "project", path: "/tmp/project", defaultLaunch: { harness: "opencode", profileId: "p1" }, createdAt: 1 });
  addRoom(store, "r1");
  const invites = new RoomInvites(store, new DeviceService(store, now), owners.publicKey, now);
  return { now, store, clock, invites };
}

const profileOf = (store: Store, personId: string) => store.listPeople().find(({ id }) => id === personId);

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
    const { code } = invites.invite("r1", "member", 1, "at-once", "15-minutes");
    const challenge = invites.challenge(code, REACHED, REQUESTER)!;
    clock.now += 15 * MINUTE;
    expect(invites.challenge(code, REACHED, REQUESTER)).toBeNull();
    expect(problemCode(() => invites.redeem(code, "Dora's Mirador", presented(keyPair(), code, challenge), REACHED))).toBe("invite-code-wrong");
    expect(invites.waiting()).toEqual([]);
  });

  test("work for as long as the owner chose, to the minute", () => {
    const { clock, invites } = machine();
    const lasting: [RoomInviteLifetime, number][] = [
      ["15-minutes", 15],
      ["1-hour", 60],
      ["1-day", 24 * 60],
      ["7-days", 7 * 24 * 60],
    ];
    const madeAt = clock.now;
    const made = lasting.map(([lifetime, minutes]) => ({ ...invites.invite("r1", "member", 1, "at-once", lifetime), minutes }));
    made.forEach(({ code, invite, minutes }) => {
      expect(invite.expiresAt).toBe(madeAt + minutes * MINUTE);
      clock.now = madeAt + minutes * MINUTE - 1;
      expect(invites.waitsFor(code)).toBe(true);
      clock.now += 1;
      expect(invites.waitsFor(code)).toBe(false);
    });
  });

  test("take a challenge only a little while, and only the newest for the invite", () => {
    const { clock, invites } = machine();
    const key = keyPair();
    const { code } = invites.invite("r1", "guest", 1, "at-once", "15-minutes");
    const first = invites.challenge(code, REACHED, REQUESTER)!;
    const second = invites.challenge(code, REACHED, REQUESTER)!;
    expect(problemCode(() => invites.redeem(code, "Dora's Mirador", presented(key, code, first), REACHED))).toBe("room-join-unproven");
    clock.now += 2 * MINUTE;
    expect(problemCode(() => invites.redeem(code, "Dora's Mirador", presented(key, code, second), REACHED))).toBe("room-join-unproven");
    const third = invites.challenge(code, REACHED, REQUESTER)!;
    expect(invites.redeem(code, "Dora's Mirador", presented(key, code, third), REACHED).roomId).toBe("r1");
  });

  test("forget their challenges when withdrawn, and admit nobody after", () => {
    const { invites } = machine();
    const { code, invite } = invites.invite("r1", "member", 1, "at-once", "15-minutes");
    const challenge = invites.challenge(code, REACHED, REQUESTER)!;
    invites.withdraw(invite.id);
    expect(invites.waitsFor(code)).toBe(false);
    expect(problemCode(() => invites.redeem(code, "Dora's Mirador", presented(keyPair(), code, challenge), REACHED))).toBe("invite-code-wrong");
  });

  test("go with their room", () => {
    const { store, invites } = machine();
    const { code } = invites.invite("r1", "member", 1, "at-once", "15-minutes");
    store.deleteRoom("r1");
    expect(invites.waitsFor(code)).toBe(false);
    expect(problemCode(() => invites.invite("r1", "member", 1, "at-once", "15-minutes"))).toBe("room-gone");
  });

  test("admit only a proof naming the certificate authority this machine answered with, or none where it served no certificate of its own", () => {
    const { invites } = machine();
    const key = keyPair();
    const { code } = invites.invite("r1", "member", 1, "at-once", "15-minutes");
    const servedOwn: ReachedAt = { host: "home.example.ts.net:4602", authorityFingerprint: "own-authority" };
    const passedOn = invites.challenge(code, servedOwn, REQUESTER)!;
    expect(problemCode(() => invites.redeem(code, "Dora's Mirador", presented(key, code, passedOn, { ...servedOwn, authorityFingerprint: NO_AUTHORITY }), servedOwn))).toBe("room-join-unproven");
    const pinnedAnother = invites.challenge(code, servedOwn, REQUESTER)!;
    expect(problemCode(() => invites.redeem(code, "Dora's Mirador", presented(key, code, pinnedAnother, { ...servedOwn, authorityFingerprint: "someone-in-between" }), servedOwn))).toBe("room-join-unproven");
    const proven = invites.challenge(code, servedOwn, REQUESTER)!;
    expect(invites.redeem(code, "Dora's Mirador", presented(key, code, proven, servedOwn), servedOwn).roomId).toBe("r1");
  });

  test("expect the certificate authority of this machine's own certificate only where that certificate answered: over its own HTTPS, never through a proxy's HTTP", () => {
    const asked = (url: string) => new Request(url, { headers: { host: new URL(url).host } });
    const own = (authorityFingerprint: string | null) => ({ authorityFingerprint, tunnelKey: TUNNEL_KEY });
    expect(reachedAt(asked("https://home.local:4602/join"), CODE, own("own-authority"), undefined)).toEqual({ host: "home.local:4602", authorityFingerprint: "own-authority" });
    expect(reachedAt(asked("https://home.example.ts.net/join"), CODE, own(null), undefined)).toEqual({ host: "home.example.ts.net", authorityFingerprint: NO_AUTHORITY });
    expect(reachedAt(asked("http://127.0.0.1:4600/join"), CODE, own("own-authority"), undefined)).toEqual({ host: "127.0.0.1:4600", authorityFingerprint: NO_AUTHORITY });
  });

  test("take a join through the tunnel by this machine's own key there, only on the socket of the invite's own one-time key, and never from what the request says", () => {
    const own = { authorityFingerprint: "own-authority", tunnelKey: TUNNEL_KEY };
    const throughTunnel = new Request("http://127.0.0.1:52000/join", { headers: { host: "127.0.0.1:52000" } });
    expect(reachedAt(throughTunnel, CODE, own, { inviteKey: inviteKey(CODE) })).toEqual({ tunnelKey: TUNNEL_KEY });
    expect(reachedAt(throughTunnel, CODE.toLowerCase(), own, { inviteKey: inviteKey(CODE) })).toEqual({ tunnelKey: TUNNEL_KEY });
    expect(reachedAt(throughTunnel, CODE, own, { inviteKey: inviteKey("ROOM-ZZZZ-ZZZZ-ZZZZ") })).toBeNull();
    expect(reachedAt(throughTunnel, CODE, own, { deviceId: "d1" })).toBeNull();
    expect(reachedAt(throughTunnel, CODE, { ...own, tunnelKey: null }, { inviteKey: inviteKey(CODE) })).toBeNull();
    const claimingTunnel = new Request("https://home.local:4602/join", { headers: { host: "home.local:4602", "x-tunnel-key": TUNNEL_KEY } });
    expect(reachedAt(claimingTunnel, CODE, own, undefined)).toEqual({ host: "home.local:4602", authorityFingerprint: "own-authority" });
  });

  test("admit a proof made through the tunnel only for this machine's own key there, and only as it was asked: never one asked or made at an address", () => {
    const { invites } = machine();
    const key = keyPair();
    const { code } = invites.invite("r1", "member", 1, "at-once", "15-minutes");
    const throughTunnel: ReachedAt = { tunnelKey: TUNNEL_KEY };
    const someoneElsesTunnel: ReachedAt = { tunnelKey: "3Q85Sl/Vr65bJz+OyEhIQtyAeBRDJQqqkVWJgryS2WE=" };
    const forAnotherMachine = invites.challenge(code, throughTunnel, TUNNEL_REQUESTER)!;
    expect(problemCode(() => invites.redeem(code, "Dora's Mirador", presented(key, code, forAnotherMachine, someoneElsesTunnel), throughTunnel))).toBe("room-join-unproven");
    const madeAtAnAddress = invites.challenge(code, throughTunnel, TUNNEL_REQUESTER)!;
    expect(problemCode(() => invites.redeem(code, "Dora's Mirador", presented(key, code, madeAtAnAddress, REACHED), throughTunnel))).toBe("room-join-unproven");
    const askedThroughTunnel = invites.challenge(code, throughTunnel, TUNNEL_REQUESTER)!;
    expect(problemCode(() => invites.redeem(code, "Dora's Mirador", presented(key, code, askedThroughTunnel, REACHED), REACHED))).toBe("room-join-unproven");
    const askedAtAnAddress = invites.challenge(code, REACHED, REQUESTER)!;
    expect(problemCode(() => invites.redeem(code, "Dora's Mirador", presented(key, code, askedAtAnAddress, throughTunnel), throughTunnel))).toBe("room-join-unproven");
    expect(invites.waitsFor(code)).toBe(true);
    const proven = invites.challenge(code, throughTunnel, TUNNEL_REQUESTER)!;
    expect(invites.redeem(code, "Dora's Mirador", presented(key, code, proven, throughTunnel), throughTunnel).roomId).toBe("r1");
    expect(invites.waitsFor(code)).toBe(false);
  });

  test("sign through the tunnel a statement of its own, which no proof made at an address reads as", () => {
    const join = { challenge: "c", inviteKey: "k", publicKey: "p" };
    expect(roomJoinStatement({ ...join, tunnelKey: TUNNEL_KEY })).not.toBe(roomJoinStatement({ ...join, host: TUNNEL_KEY, authorityFingerprint: NO_AUTHORITY }));
    expect(roomJoinStatement({ ...join, host: HOST, authorityFingerprint: NO_AUTHORITY })).toBe(["Mirador: join a room with this key", "c", "k", HOST, NO_AUTHORITY, "p"].join("\n"));
  });

  test("give back the code of a withdrawn invite, or of every one into a room that goes, for its one-time key in the tunnel to go too", () => {
    const { invites } = machine();
    const first = invites.invite("r1", "member", 1, "at-once", "15-minutes");
    const second = invites.invite("r1", "guest", 1, "at-once", "15-minutes");
    expect(invites.withdraw(first.invite.id)).toBe(inviteKey(first.code));
    expect(invites.withdraw(first.invite.id)).toBeNull();
    expect(invites.withdrawAllInto("r1")).toEqual([inviteKey(second.code)]);
    expect(invites.waiting()).toEqual([]);
  });

  test("go out without a way through the tunnel when making its one-time key fails, saying why in the log alone and letting go of what it made, and keep none for an invite withdrawn meanwhile", async () => {
    const { invites } = machine();
    const { code, invite } = invites.invite("r1", "member", 1, "at-once", "15-minutes");
    const withdrawn: string[] = [];
    const failing = { invite: () => Promise.reject(new Error("the sidecar stopped")), inviteWithdrawn: (key: string) => void withdrawn.push(key) };
    const logged = spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await invites.tunnelFor(code, invite.expiresAt, failing)).toBeNull();
      expect(logged.mock.calls.map((call) => call.join(" "))).toEqual(["a room invite goes out without a way through the tunnel: the sidecar stopped"]);
    } finally {
      logged.mockRestore();
    }
    expect(await invites.tunnelFor(code, invite.expiresAt, null)).toBeNull();

    const tunnel = { hostKey: TUNNEL_KEY, hostAddress: "fd12::1", port: 4600, broker: { address: "p2p.example.com:47800", key: TUNNEL_KEY }, joinKey: TUNNEL_KEY, joinAddress: "fd12::9" };
    const making = { invite: () => Promise.resolve(tunnel), inviteWithdrawn: (key: string) => void withdrawn.push(key) };
    expect(await invites.tunnelFor(code, invite.expiresAt, making)).toEqual(tunnel);
    invites.withdraw(invite.id);
    expect(await invites.tunnelFor(code, invite.expiresAt, making)).toBeNull();
    expect(withdrawn).toEqual([inviteKey(code), inviteKey(code)]);
  });

  test("answer the owner's own key as they answer a proof that fails, and only once the proof holds", () => {
    const owners = keyPair();
    const { invites } = machine(owners);
    const { code } = invites.invite("r1", "member", 1, "at-once", "15-minutes");
    const unproven = invites.challenge(code, REACHED, REQUESTER)!;
    const forged = { ...presented(keyPair(), code, unproven), publicKey: owners.publicKey };
    expect(problemCode(() => invites.redeem(code, "Me?", forged, REACHED))).toBe("room-join-unproven");
    const proven = invites.challenge(code, REACHED, REQUESTER)!;
    expect(problemCode(() => invites.redeem(code, "Me", presented(owners, code, proven), REACHED))).toBe("room-join-unproven");
    expect(invites.waitsFor(code)).toBe(true);
  });

  test("leave nothing behind when the device can't be made: no person, key or place in the room", () => {
    const { now, store, invites } = machine();
    const key = keyPair();
    const { code } = invites.invite("r1", "member", 1, "at-once", "15-minutes");
    const failing = new RoomInvites(store, { admit: () => { throw new Error("disk full"); } } as unknown as DeviceService, keyPair().publicKey, now);
    const challenge = failing.challenge(code, REACHED, REQUESTER)!;
    expect(() => failing.redeem(code, "Dora's Mirador", presented(key, code, challenge), REACHED)).toThrow("disk full");
    expect(store.listPeople()).toHaveLength(1);
    expect(store.personWithKey(key.publicKey)).toBeUndefined();
    expect(store.findRoom("r1")?.people).toEqual([]);
    expect(invites.waitsFor(code)).toBe(true);
    expect(invites.waiting().map(({ taken }) => taken)).toEqual([0]);
  });
});

describe("a room invite for several people", () => {
  /** Joins with a fresh challenge of its own, signed by the key. */
  const joining = (invites: RoomInvites, code: string, key = keyPair(), name = "Dora", p2p: { inviteUsed: (code: string) => void } | null = null) =>
    invites.redeem(code, `${name}'s Mirador`, { ...presented(key, code, invites.challenge(code, REACHED, REQUESTER)!), name }, REACHED, p2p);

  const takenOf = (invites: RoomInvites) => invites.waiting().map(({ taken, seats }) => `${taken} of ${seats}`);

  test("takes a seat for each person it lets in, and once they are taken admits nobody new, its one-time key in the tunnel kept until then and let go then", () => {
    const { invites, store } = machine();
    const { code } = invites.invite("r1", "member", 5, "at-once", "15-minutes");
    const keysOver: string[] = [];
    const p2p = { inviteUsed: (used: string) => void keysOver.push(used) };
    Array.from({ length: 4 }, (_, index) => joining(invites, code, keyPair(), `Person ${index}`, p2p));
    expect(takenOf(invites)).toEqual(["4 of 5"]);
    expect(keysOver).toEqual([]);
    expect(joining(invites, code, keyPair(), "Fifth", p2p)).toMatchObject({ roomId: "r1", waiting: false });
    expect(keysOver).toEqual([code]);
    expect(invites.waitsFor(code)).toBe(false);
    expect(invites.waiting()).toEqual([]);
    expect(invites.challenge(code, REACHED, REQUESTER)).toBeNull();
    expect(store.findRoom("r1")?.people.map(({ role }) => role)).toEqual(Array(5).fill("member"));
  });

  test("keeps a challenge for each seat left, so several join at once, each with its own, the newest replacing the oldest", () => {
    const { invites } = machine();
    const { code } = invites.invite("r1", "guest", 5, "at-once", "15-minutes");
    const [dora, ola] = [keyPair(), keyPair()];
    const challenges = Array.from({ length: 6 }, () => invites.challenge(code, REACHED, REQUESTER)!);
    expect(problemCode(() => invites.redeem(code, "Dora's Mirador", presented(dora, code, challenges[0]!), REACHED))).toBe("room-join-unproven");
    expect(invites.redeem(code, "Dora's Mirador", presented(dora, code, challenges[1]!), REACHED).roomId).toBe("r1");
    expect(invites.redeem(code, "Ola's Mirador", presented(ola, code, challenges[5]!), REACHED).roomId).toBe("r1");
    expect(problemCode(() => invites.redeem(code, "Ola's Mirador", presented(keyPair(), code, challenges[5]!), REACHED))).toBe("room-join-unproven");
    expect(takenOf(invites)).toEqual(["2 of 5"]);
  });

  test("tells by its code, as inviteKey keeps it, how many seats it has left, for the tries its link gets through the tunnel; any other code has one", () => {
    const { invites } = machine();
    const { code } = invites.invite("r1", "guest", 5, "at-once", "15-minutes");
    joining(invites, code);
    expect(invites.seatsLeftFor(inviteKey(code))).toBe(4);
    expect(invites.seatsLeftFor(inviteKey("ROOM-ZZZZ-ZZZZ-ZZZZ"))).toBe(1);
  });

  test("keeps each requester's challenges apart, so one asking again and again replaces only its own, never another joiner's", () => {
    const { invites } = machine();
    const { code } = invites.invite("r1", "guest", 5, "at-once", "15-minutes");
    const dorasChallenge = invites.challenge(code, REACHED, "192.0.2.7")!;
    const asksOften = Array.from({ length: 10 }, () => invites.challenge(code, REACHED, "203.0.113.9")!);
    expect(invites.redeem(code, "Dora's Mirador", presented(keyPair(), code, dorasChallenge), REACHED).roomId).toBe("r1");
    expect(problemCode(() => invites.redeem(code, "Ola's Mirador", presented(keyPair(), code, asksOften[4]!), REACHED))).toBe("room-join-unproven");
    expect(invites.redeem(code, "Ola's Mirador", presented(keyPair(), code, asksOften[5]!), REACHED).roomId).toBe("r1");
  });

  test("shows its owner who waits at the door by a name the room would let them take: none for Mirador's own words, and one the owner, a person, a writer or an agent of the room goes by marked as the room marks it, while the joiner learns nothing of it", () => {
    const { invites, store } = machine();
    store.setPersonProfile(store.ownerId(), { name: "Peter", color: null });
    store.insertPerson({ id: "alice", name: "Alice", color: null });
    store.setRoomPersonRole("r1", "alice", "member");
    store.insertPerson({ id: "wren", name: "Wren", color: null });
    store.appendRoomMessage({ id: "m1", roomId: "r1", at: 1, author: { personId: "wren" }, text: "Before I left", tags: [], threadId: null });
    store.saveProfile({ id: "p1", name: "Builder", harness: "opencode", environment: "", prelaunch: "", model: null, mode: null, effort: null, bypassPermissions: false, askMode: "wait", color: null, pluginsOff: [], createdAt: 1 });
    store.setRoomAgents("r1", ["p1"]);
    const { code } = invites.invite("r1", "member", 10, "after-ok", "15-minutes");
    const presentedNames = ["ALICE", "Peter", "wren", "Builder", "Owner", "Someone without a name 1234", "Ivy"];
    const knocked = presentedNames.map((name) => joining(invites, code, keyPair(), name));
    expect(invites.joiners().map(({ name, nameClash }) => [name, nameClash ?? null])).toEqual([
      ["", "ALICE"],
      ["", "Peter"],
      ["", "wren"],
      ["", "Builder"],
      ["", null],
      ["", null],
      ["Ivy", null],
    ]);
    expect(invites.joiner("r1", knocked[0]!.personId)).toMatchObject({ name: "", nameClash: "ALICE" });
    expect(new Set(knocked.map((each) => Object.keys(each).toSorted().join()))).toEqual(new Set([Object.keys(knocked[6]!).toSorted().join()]));
    expect(knocked.map(({ personId }) => profileOf(store, personId)?.name)).toEqual(presentedNames.map(() => ""));
  });

  test("changes nothing of a person who comes to the door until the owner lets them in, though they are someone already in another room", () => {
    const { invites, store } = machine();
    addRoom(store, "r2");
    const key = keyPair();
    const alice = joining(invites, invites.invite("r1", "member", 1, "at-once", "15-minutes").code, key, "Alice");
    const { code } = invites.invite("r2", "member", 5, "after-ok", "15-minutes");
    const asMallory = { ...presented(key, code, invites.challenge(code, REACHED, REQUESTER)!), name: "Mallory", color: "rose" };
    expect(invites.redeem(code, "Alice's Mirador", asMallory, REACHED)).toMatchObject({ personId: alice.personId, waiting: true });
    expect(profileOf(store, alice.personId)).toMatchObject({ name: "Alice", color: "mint" });
    invites.letIn("r2", alice.personId);
    expect(profileOf(store, alice.personId)).toMatchObject({ name: "Mallory", color: "rose" });
  });

  test("replaces the person's earlier device when the same key joins a second room, revoking its first sign-in", () => {
    const { invites, store } = machine();
    addRoom(store, "r2");
    const key = keyPair();
    const first = joining(invites, invites.invite("r1", "member", 1, "at-once", "15-minutes").code, key, "Alice");
    const forgotten: string[] = [];
    const second = joining(
      invites,
      invites.invite("r2", "member", 1, "at-once", "15-minutes").code,
      key,
      "Alice",
      { inviteUsed: () => {}, forget: (id: string) => void forgotten.push(id) } as unknown as { inviteUsed: (code: string) => void },
    );
    expect(second.replacedDeviceIds).toEqual([first.device.id]);
    expect(forgotten).toEqual([first.device.id]);
    expect(store.listDevices().filter(({ personId }) => personId === first.personId).map(({ id }) => id)).toEqual([second.device.id]);
  });

  test("marks a name clash on an at-once invite when renaming would collide one of the person's brought agents in another room", () => {
    const { invites, store } = machine();
    addRoom(store, "r2");
    const key = keyPair();
    const mia = joining(invites, invites.invite("r1", "member", 1, "at-once", "15-minutes").code, key, "Mia");
    store.insertPerson({ id: "z1", name: "Bot (Bob)", color: null });
    store.setRoomPersonRole("r1", "z1", "guest");
    store.addBroughtAgent("r1", "b1", { personId: mia.personId, name: "Bot", harness: "claude" }, true);
    const { code } = invites.invite("r2", "member", 1, "at-once", "15-minutes");
    const joined = joining(invites, code, key, "Bob");
    expect(profileOf(store, joined.personId)?.name).toBe("");
    expect(store.findRoom("r2")!.people.find(({ personId }) => personId === joined.personId)?.nameClash).toBe("Bob");
  });

  test("takes no second seat for the same key, whether it came in, waits or was turned away: a repeat is refused", () => {
    const { invites, store } = machine();
    const atOnce = invites.invite("r1", "member", 5, "at-once", "15-minutes");
    const key = keyPair();
    const first = joining(invites, atOnce.code, key);
    expect(problemCode(() => joining(invites, atOnce.code, key))).toBe("room-invite-used-already");
    expect(takenOf(invites)).toEqual(["1 of 5"]);
    expect(store.listDevices().filter(({ personId }) => personId === first.personId)).toHaveLength(1);

    invites.withdraw(atOnce.invite.id);
    const afterOk = invites.invite("r1", "member", 5, "after-ok", "15-minutes");
    const waiting = keyPair();
    const knocked = joining(invites, afterOk.code, waiting, "Ola");
    expect(problemCode(() => joining(invites, afterOk.code, waiting, "Ola"))).toBe("room-invite-used-already");
    invites.turnAway("r1", knocked.personId);
    expect(problemCode(() => joining(invites, afterOk.code, waiting, "Ola"))).toBe("room-invite-used-already");
    expect(invites.joiners()).toEqual([]);
    expect(takenOf(invites)).toEqual(["1 of 5"]);
  });

  test("with the owner's OK first, takes the person to the room's door alone, until the owner lets them in with the invite's role and the name they presented", () => {
    const { invites, store, clock } = machine();
    const { code } = invites.invite("r1", "guest", 10, "after-ok", "15-minutes");
    const knocked = joining(invites, code, keyPair(), "Dora");
    expect(knocked).toMatchObject({ roomId: "r1", waiting: true });
    expect(store.findRoom("r1")?.people).toEqual([]);
    expect(store.roomsOf(knocked.personId)).toEqual([]);
    expect(invites.roomsWaitedForBy(knocked.personId)).toEqual(["r1"]);
    expect(invites.joiners()).toEqual([{ roomId: "r1", personId: knocked.personId, role: "guest", name: "Dora", deviceName: "Dora's Mirador", since: clock.now }]);
    expect(takenOf(invites)).toEqual(["1 of 10"]);

    invites.letIn("r1", knocked.personId);
    expect(store.findRoom("r1")?.people).toEqual([{ personId: knocked.personId, role: "guest" }]);
    expect(store.listPeople().find(({ id }) => id === knocked.personId)).toMatchObject({ name: "Dora", color: "mint" });
    expect(invites.joiners()).toEqual([]);
    expect(invites.roomsWaitedForBy(knocked.personId)).toEqual([]);
    expect(problemCode(() => invites.letIn("r1", knocked.personId))).toBe("room-joiner-gone");
    expect(problemCode(() => invites.turnAway("r1", knocked.personId))).toBe("room-joiner-gone");
  });

  test("leaves whoever waits waiting after the invite expires or is withdrawn, for the owner to let in or turn away", () => {
    const { invites, store, clock } = machine();
    const expiring = invites.invite("r1", "member", 5, "after-ok", "15-minutes");
    const dora = joining(invites, expiring.code, keyPair(), "Dora");
    const withdrawn = invites.invite("r1", "member", 5, "after-ok", "15-minutes");
    const ola = joining(invites, withdrawn.code, keyPair(), "Ola");
    invites.withdraw(withdrawn.invite.id);
    clock.now += 15 * 60_000;
    expect(invites.waiting()).toEqual([]);
    expect(invites.joiners().map(({ name }) => name)).toEqual(["Dora", "Ola"]);
    invites.letIn("r1", dora.personId);
    invites.turnAway("r1", ola.personId);
    expect(store.findRoom("r1")?.people).toEqual([{ personId: dora.personId, role: "member" }]);
  });

  test("keeps the devices of those who wait while they are in no room, and of those turned away no more", () => {
    const { invites, store } = machine();
    const { code } = invites.invite("r1", "member", 5, "after-ok", "15-minutes");
    const dora = joining(invites, code, keyPair(), "Dora");
    expect(store.peopleInNoRoom([dora.personId])).toEqual([]);
    invites.turnAway("r1", dora.personId);
    expect(store.peopleInNoRoom([dora.personId])).toEqual([dora.personId]);
  });

  test("leaves someone already in the room as they are, name and all, with the owner's OK first, and lets the owner's adding them in end their wait", () => {
    const { invites, store } = machine();
    const key = keyPair();
    const atOnce = invites.invite("r1", "guest", 1, "at-once", "15-minutes");
    const dora = joining(invites, atOnce.code, key);
    const afterOk = invites.invite("r1", "member", 5, "after-ok", "15-minutes");
    expect(joining(invites, afterOk.code, key, "Dorothea")).toMatchObject({ personId: dora.personId, waiting: false });
    expect(store.findRoom("r1")?.people).toEqual([{ personId: dora.personId, role: "guest" }]);
    expect(profileOf(store, dora.personId)?.name).toBe("Dora");

    const ola = joining(invites, afterOk.code, keyPair(), "Ola");
    store.setRoomPersonRole("r1", ola.personId, "guest");
    expect(invites.joiners()).toEqual([]);
  });

  test("never takes the owner's own key to the door either", () => {
    const owners = keyPair();
    const { invites } = machine(owners);
    const { code } = invites.invite("r1", "member", 5, "after-ok", "15-minutes");
    expect(problemCode(() => joining(invites, code, owners, "Me"))).toBe("room-join-unproven");
    expect(invites.joiners()).toEqual([]);
    expect(takenOf(invites)).toEqual(["0 of 5"]);
  });

  test("is made only for as many people, to let them in only in a way, and only for as long, as the dialog offers", () => {
    const { invites } = machine();
    expect(() => invites.invite("r1", "member", 3 as 5, "at-once", "15-minutes")).toThrow("A room invite can't be for 3 people.");
    expect(() => invites.invite("r1", "member", 5, "whenever" as "at-once", "15-minutes")).toThrow(`A room invite can't let people in "whenever".`);
    expect(() => invites.invite("r1", "member", 5, "at-once", "forever" as "7-days")).toThrow(`A room invite can't work for "forever".`);
    expect(invites.waiting()).toEqual([]);
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
  test("is made once, and signs what it is asked", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "mirador-owner-key-"));
    try {
      const first = ownerKey(dataDir);
      expect(ownerKey(dataDir).publicKey).toBe(first.publicKey);
      expect(Buffer.from(first.publicKey, "base64url")).toHaveLength(32);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test.skipIf(process.platform === "win32")("is readable by this account alone", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "mirador-owner-key-"));
    try {
      ownerKey(dataDir);
      expect(statSync(join(dataDir, "owner-key.pem")).mode & 0o777).toBe(0o600);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
