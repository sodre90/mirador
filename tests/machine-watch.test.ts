import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { forgetSignInAt, leftEveryRoomAt, signInRevoked } from "../host/machine-sign-in.ts";
import type { MachineReach } from "../host/machine-tunnels.ts";
import { MachineWatch, MOST_ROOM_CALLS_A_MINUTE, roomAlertIn } from "../host/machine-watch.ts";
import { atAddress, DIALS_THROUGH_SOCKETS, type Way } from "../host/p2p/dial.ts";
import { Store } from "../host/store.ts";
import type { Machine, MachineStatus } from "../shared/model.ts";
import { LONGEST_PERSON_NAME } from "../shared/person-names.ts";
import { OUT_OF_ROOMS_CLOSE_CODE, type ServerMessage } from "../shared/protocol.ts";
import { broughtAgentName } from "../shared/rooms.ts";
import type { SystemNotification } from "../shared/system-notifications.ts";

async function eventually(check: () => void, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return check();
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await Bun.sleep(20);
    }
  }
}

type Socket = Bun.ServerWebSocket<{ path: string }>;

/** Stands in for another machine's host: it lets in the one device token and records who connected where. */
function fakeMachine(port = 0) {
  const sockets: Socket[] = [];
  const signIns: string[] = [];
  const heard: unknown[] = [];
  let acceptedCookie = "mirador_token=device-token";
  const server = Bun.serve<{ path: string }>({
    hostname: "127.0.0.1",
    port,
    fetch(request, server) {
      const { pathname } = new URL(request.url);
      signIns.push(`${pathname} ${request.headers.get("origin")} ${request.headers.get("cookie")}`);
      if (request.headers.get("cookie") !== acceptedCookie) return new Response("unauthorized", { status: 401 });
      return server.upgrade(request, { data: { path: pathname } }) ? undefined : new Response("no", { status: 400 });
    },
    websocket: {
      open: (socket) => void sockets.push(socket),
      message: (_, message) => void heard.push(JSON.parse(String(message))),
    },
  });
  const origin = `http://127.0.0.1:${server.port}`;
  const send = (path: string, message: unknown) => sockets.filter(({ data }) => data.path === path).forEach((socket) => socket.send(JSON.stringify(message)));
  const revokeDevice = () => {
    acceptedCookie = "";
    sockets.splice(0).forEach((socket) => socket.close(1000, "device revoked"));
  };
  return { server, origin, sockets, signIns, heard, send, revokeDevice };
}

const conversation = (id: string, waitingFor: string | null) => ({ id, waitingFor });

const joined = (id: string, name: string) => ({ id, name, unread: 0, mentions: 0, toConfirm: 0, toApprove: 0, muted: false });

let cleanUp: (() => void)[] = [];
afterEach(() => {
  cleanUp.forEach((step) => step());
  cleanUp = [];
});

const THIS_HOST = { id: "this-laptop-id", origins: ["https://this-laptop.example.ts.net:4700"] };

function watching(origin: string, { joined = true, asPerson = false } = {}) {
  const store = new Store(":memory:");
  store.insertMachine({ id: "m1", name: "Home server", origin, createdAt: 1 });
  if (joined) store.setMachineDeviceToken("m1", "device-token");
  if (asPerson) store.setMachineJoinedAs("m1", { asPerson: true, relayKey: "relay-key" });
  const statuses: MachineStatus[] = [];
  const notifications: SystemNotification[] = [];
  const roomCalls: SystemNotification[] = [];
  const signedOut: string[] = [];
  const machineChanges: string[] = [];
  const watch = new MachineWatch(
    store,
    THIS_HOST,
    (status) => statuses.push(status),
    () => machineChanges.push(store.listMachines().map(({ hostId }) => hostId).join()),
    (notification) => notifications.push(notification),
    (notification) => roomCalls.push(notification),
    (machineId) => {
      signedOut.push(machineId);
      watch.stop(machineId);
    },
  );
  cleanUp.push(() => watch.stopAll());
  watch.startAll();
  return { watch, store, statuses, notifications, roomCalls, signedOut, machineChanges };
}

describe("MachineWatch", () => {
  test("follows what the machine's conversations wait for, signed in with the device token as the machine's own page", async () => {
    const machine = fakeMachine();
    cleanUp.push(() => machine.server.stop(true));
    const { watch } = watching(machine.origin);
    await eventually(() => expect(machine.sockets).toHaveLength(2));
    expect(machine.signIns.toSorted()).toEqual([`/notifications ${machine.origin} mirador_token=device-token`, `/ws ${machine.origin} mirador_token=device-token`]);
    expect(watch.statuses()).toEqual([{ machineId: "m1", reachable: true, waiting: [], joinedThere: [], rooms: [], mutedHere: [] }]);

    machine.send("/ws", { type: "snapshot", conversations: [conversation("a", "question"), conversation("b", null)], machines: [], hostId: "home-server-id" });
    await eventually(() => expect(watch.statuses()[0]!.waiting).toEqual(["question"]));
    machine.send("/ws", { type: "conversation.upserted", conversation: conversation("b", "finished") } as ServerMessage);
    await eventually(() => expect(watch.statuses()[0]!.waiting).toEqual(["finished", "question"]));
    machine.send("/ws", { type: "conversation.deleted", conversationId: "a" });
    await eventually(() => expect(watch.statuses()[0]!.waiting).toEqual(["finished"]));
  });

  test("skips a message from the machine it cannot read, rather than falling over, and follows the ones after it", async () => {
    const machine = fakeMachine();
    cleanUp.push(() => machine.server.stop(true));
    const { watch } = watching(machine.origin);
    await eventually(() => expect(machine.sockets).toHaveLength(2));
    const logged = spyOn(console, "error").mockImplementation(() => {});
    try {
      machine.sockets.filter(({ data }) => data.path === "/ws").forEach((socket) => socket.send("not json"));
      machine.send("/ws", { type: "snapshot" });
      machine.send("/ws", { type: "snapshot", conversations: [conversation("a", "question")], machines: [], hostId: "home-server-id" });
      await eventually(() => expect(watch.statuses()[0]!.waiting).toEqual(["question"]));
      expect(logged).toHaveBeenCalledTimes(2);
      expect(logged).toHaveBeenCalledWith(expect.stringContaining("skipped a message on /ws of a machine"), expect.any(Error));
    } finally {
      logged.mockRestore();
    }
  });

  test("lists the machines the machine has joined and reached in turn, but none it only added or never reached, nor this host at any address", async () => {
    const machine = fakeMachine();
    cleanUp.push(() => machine.server.stop(true));
    const { watch, statuses } = watching(machine.origin);
    await eventually(() => expect(machine.sockets).toHaveLength(2));
    const there = (name: string, origin: string, joined: boolean, hostId: string | null = null) => ({ id: name, name, origin, createdAt: 1, relayPort: 4620, joined, color: null, hostId });
    const buildBox = there("Build box", "https://build-box.example.ts.net", true, "build-box-id");
    const seenBuildBox = { name: "Build box", origin: "https://build-box.example.ts.net", hostId: "build-box-id" };

    machine.send("/ws", {
      type: "snapshot",
      conversations: [],
      machines: [
        buildBox,
        there("Old NAS", "https://old-nas.example.ts.net", false, "old-nas-id"),
        there("Never reached", "https://unreached.example.ts.net", true),
        there("This laptop", THIS_HOST.origins[0]!, true, "this-laptop-at-its-address"),
        there("This laptop by its IP", "https://100.64.0.7:4700", true, THIS_HOST.id),
      ],
      hostId: "home-server-id",
    });
    await eventually(() => expect(watch.statuses()[0]!.joinedThere).toEqual([seenBuildBox]));

    const changesBefore = statuses.length;
    machine.send("/ws", { type: "machines.changed", machines: [buildBox, there("Old NAS", "https://old-nas.example.ts.net", false)] });
    machine.send("/ws", { type: "machines.changed", machines: [buildBox, there("Pi", "https://pi.example.ts.net", true, "pi-id")] });
    await eventually(() => expect(watch.statuses()[0]!.joinedThere).toEqual([seenBuildBox, { name: "Pi", origin: "https://pi.example.ts.net", hostId: "pi-id" }]));
    expect(statuses.length).toBe(changesBefore + 1);
  });

  test("keeps the id the machine goes by, and says the machines changed only when it is new", async () => {
    const machine = fakeMachine();
    cleanUp.push(() => machine.server.stop(true));
    const { store, machineChanges } = watching(machine.origin);
    await eventually(() => expect(machine.sockets).toHaveLength(2));
    machine.send("/ws", { type: "snapshot", conversations: [], machines: [], hostId: "home-server-id" });
    await eventually(() => expect(store.findMachine("m1")?.hostId).toBe("home-server-id"));
    machine.send("/ws", { type: "snapshot", conversations: [], machines: [], hostId: "home-server-id" });
    machine.send("/ws", { type: "snapshot", conversations: [], machines: [], hostId: "reinstalled-id" });
    await eventually(() => expect(machineChanges).toEqual(["home-server-id", "reinstalled-id"]));
  });

  test("passes the machine's notifications on as this host's, saying which machine they come from, by the name it goes by here now", async () => {
    const machine = fakeMachine();
    cleanUp.push(() => machine.server.stop(true));
    const { store, notifications } = watching(machine.origin);
    await eventually(() => expect(machine.sockets).toHaveLength(2));
    store.renameMachine("m1", "Studio");
    const notification: SystemNotification = { kind: "question", conversationId: "a", title: "Deploy", workspace: "infra", body: "Asks: Ship it?" };
    machine.send("/notifications", { type: "system-notification", notification });
    machine.send("/ws", { type: "system-notification", notification });
    await eventually(() => expect(notifications).toEqual([{ ...notification, machineId: "m1", workspace: "Studio · infra" }]));
  });

  test("says when the machine stops answering, and listens again once it is back", async () => {
    const machine = fakeMachine();
    const { port } = machine.server;
    const { watch, signedOut } = watching(machine.origin);
    await eventually(() => expect(watch.statuses()[0]!.reachable).toBe(true));
    machine.server.stop(true);
    await eventually(() => expect(watch.statuses()[0]!.reachable).toBe(false));

    const back = fakeMachine(port);
    cleanUp.push(() => back.server.stop(true));
    await eventually(() => expect(watch.statuses()[0]!.reachable).toBe(true), 5_000);
    expect(signedOut).toEqual([]);
  }, 10_000);

  test("signs out of a machine that revoked this host, and stops asking it", async () => {
    const machine = fakeMachine();
    cleanUp.push(() => machine.server.stop(true));
    const { watch, signedOut } = watching(machine.origin);
    await eventually(() => expect(watch.statuses()[0]!.reachable).toBe(true));
    machine.revokeDevice();
    await eventually(() => expect(signedOut).toEqual(["m1"]), 5_000);
    expect(watch.statuses()).toEqual([]);
  }, 10_000);

  test("joined as a person in the machine's rooms, takes nothing the machine says, whoever it says this host is: no notifications, id, machines or waiting", async () => {
    const machine = fakeMachine();
    cleanUp.push(() => machine.server.stop(true));
    const { watch, store, statuses, notifications, machineChanges } = watching(machine.origin, { asPerson: true });
    await eventually(() => expect(watch.statuses()[0]!.reachable).toBe(true));
    expect(machine.signIns).toEqual([`/ws ${machine.origin} mirador_token=device-token`]);

    const joinedThere = [{ id: "m9", name: "Office", origin: "https://office.example", joined: true, hostId: "this-laptop-id-forged" }];
    machine.send("/ws", { type: "snapshot", conversations: [conversation("a", "question")], machines: joinedThere, hostId: THIS_HOST.id, you: "ann", ownerId: "ann" } as never);
    machine.send("/ws", { type: "machines.changed", machines: joinedThere } as never);
    machine.send("/ws", { type: "conversation.upserted", conversation: conversation("b", "finished") } as ServerMessage);
    const notification: SystemNotification = { kind: "question", conversationId: "a", title: "Deploy", workspace: "infra", body: "Asks: Ship it?" };
    machine.send("/ws", { type: "system-notification", notification });
    await Bun.sleep(300);
    expect(watch.statuses()).toEqual([{ machineId: "m1", reachable: true, waiting: [], joinedThere: [], rooms: [], mutedHere: [] }]);
    expect(statuses.every(({ waiting, joinedThere }) => waiting.length === 0 && joinedThere.length === 0)).toBe(true);
    expect(store.findMachine("m1")?.hostId).toBeNull();
    expect(machineChanges).toEqual([]);
    expect(notifications).toEqual([]);
  });

  test("joined as a person, keeps the rooms the machine lists for its person, cleaned, as they change, and has them while the machine is away", async () => {
    const machine = fakeMachine();
    cleanUp.push(() => machine.server.stop(true));
    const { watch, store } = watching(machine.origin, { asPerson: true });
    await eventually(() => expect(machine.sockets).toHaveLength(1));

    const room = (id: string, name: string) => ({ id, name, workspaceId: "w1", people: [], agents: [] });
    machine.send("/ws", { type: "snapshot", conversations: [], machines: [], rooms: [room("r1", "Launch\nplan"), room("../x", "Escape")] } as never);
    await eventually(() => expect(watch.statuses()[0]!.rooms).toEqual([joined("r1", "Launch plan")]));
    machine.send("/ws", { type: "room.upserted", room: room("r2", "Ops") } as never);
    machine.send("/ws", { type: "room.deleted", roomId: "r1" } as never);
    await eventually(() => expect(watch.statuses()[0]!.rooms).toEqual([joined("r2", "Ops")]));
    expect(store.machineRooms("m1")).toEqual([joined("r2", "Ops")]);

    watch.stopAll();
    machine.server.stop(true);
    watch.start("m1");
    expect(watch.statuses()).toEqual([{ machineId: "m1", reachable: false, waiting: [], joinedThere: [], rooms: [joined("r2", "Ops")], mutedHere: [] }]);
  });

  test("stopping a watched machine emits no stale unreachable status from the closed socket", async () => {
    const machine = fakeMachine();
    cleanUp.push(() => machine.server.stop(true));
    const { watch, statuses } = watching(machine.origin, { asPerson: true });
    await eventually(() => expect(watch.statuses()[0]!.reachable).toBe(true));
    const beforeStop = statuses.length;
    watch.stop("m1");
    await Bun.sleep(150);
    expect(statuses.slice(beforeStop)).toEqual([]);
  });

  test("joined as a person, keeps what the machine counts in each of its rooms for the person, cleaned, and only for rooms it lists", async () => {
    const machine = fakeMachine();
    cleanUp.push(() => machine.server.stop(true));
    const { watch, store } = watching(machine.origin, { asPerson: true });
    await eventually(() => expect(machine.sockets).toHaveLength(1));

    machine.send("/ws", { type: "snapshot", conversations: [], machines: [], rooms: [{ id: "r1", name: "Launch" }] } as never);
    machine.send("/ws", { type: "rooms.reading", personId: "ann", readings: [{ roomId: "r1", unread: 3, mentions: 1, toConfirm: 1e6, toApprove: 2, muted: false }, { roomId: "r2", unread: 9 }] } as never);
    await eventually(() => expect(watch.statuses()[0]!.rooms).toEqual([{ ...joined("r1", "Launch"), unread: 3, mentions: 1, toConfirm: 999, toApprove: 2 }]));
    machine.send("/ws", { type: "room.upserted", room: { id: "r1", name: "Launch day" } } as never);
    await eventually(() => expect(store.machineRooms("m1")).toEqual([{ ...joined("r1", "Launch day"), unread: 3, mentions: 1, toConfirm: 999, toApprove: 2 }]));
  });

  test("joined as a person, words a room's call itself, from its own record of the room, and passes on only calls of a room it lists, not muted, cleaned, once until the room is opened here", async () => {
    const machine = fakeMachine();
    cleanUp.push(() => machine.server.stop(true));
    const { watch, store, roomCalls, notifications } = watching(machine.origin, { asPerson: true });
    await eventually(() => expect(machine.sockets).toHaveLength(1));
    machine.send("/ws", { type: "snapshot", conversations: [], machines: [], rooms: [{ id: "r1", name: "Launch" }, { id: "r2", name: "Quiet" }] } as never);
    machine.send("/ws", { type: "rooms.reading", personId: "ann", readings: [{ roomId: "r2", muted: true }] } as never);
    await Bun.sleep(100);
    store.renameMachine("m1", "Studio");

    const call = (roomId: string, alert: unknown) => machine.send("/ws", { type: "room.alert", roomId, personId: "ann", alert } as never);
    call("r2", { about: "confirm", question: "Muted room" });
    call("r9", { about: "confirm", question: "A room it doesn't list" });
    call("r1", { about: "run", command: "rm -rf /" });
    call("r1", { about: "mention", by: "", text: "Nobody" });
    call("r1", "not an alert");
    call("r1", { about: "mention", by: "Bob\n\u202E", text: `Look at this\n${"x".repeat(500)}`, conversationId: "c1", html: "<script>" });
    call("r1", { about: "confirm", question: "Which plan?" });
    await eventually(() => expect(roomCalls).toHaveLength(1));
    expect(roomCalls[0]).toMatchObject({ kind: "question", roomId: "r1", machineId: "m1", title: "Launch", workspace: "Studio", about: { kind: "room", alert: { about: "mention", by: "Bob" } } });
    expect(roomCalls[0]!.conversationId).toBeUndefined();
    expect((roomCalls[0]!.about as { alert: { text: string } }).alert.text).toBe(`Look at this ${"x".repeat(107)}…`);

    watch.roomOpened("m1", "r1");
    call("r1", { about: "confirm", question: "Which plan?" });
    call("r1", { about: "confirm", question: "Again" });
    await eventually(() => expect(roomCalls).toHaveLength(2));
    await Bun.sleep(100);
    expect(roomCalls).toHaveLength(2);
    expect(roomCalls[1]).toMatchObject({ kind: "question", roomId: "r1", body: "Waits for you to confirm the answer: Which plan?" });

    watch.roomOpened("m1", "r1");
    call("r1", { about: "approve", what: 7 });
    call("r1", { about: "approve", what: "Run ls\nin the project" });
    await eventually(() => expect(roomCalls).toHaveLength(3));
    expect(roomCalls[2]).toMatchObject({ kind: "question", roomId: "r1", body: "Waits for your approval: Run ls in the project", about: { kind: "room", alert: { about: "approve", what: "Run ls in the project" } } });
    expect(notifications).toEqual([]);
  });

  test("a call by an agent someone brought keeps the bringer's name in the agent's, however long the two are", () => {
    const by = broughtAgentName("M".repeat(LONGEST_PERSON_NAME), `${"C".repeat(LONGEST_PERSON_NAME)} 9`);
    expect(roomAlertIn({ about: "mention", by, text: "Look" })).toEqual({ about: "mention", by, text: "Look" });
    expect(roomAlertIn({ about: "mention", by: 7, text: "Look" })).toBeNull();
  });

  test("joined as a person, passes on calls of a few of the machine's rooms a minute at most, however many rooms it lists", async () => {
    const machine = fakeMachine();
    cleanUp.push(() => machine.server.stop(true));
    const { roomCalls } = watching(machine.origin, { asPerson: true });
    await eventually(() => expect(machine.sockets).toHaveLength(1));
    const rooms = Array.from({ length: MOST_ROOM_CALLS_A_MINUTE + 5 }, (_, index) => ({ id: `r${index}`, name: `Room ${index}` }));
    machine.send("/ws", { type: "snapshot", conversations: [], machines: [], rooms } as never);
    await Bun.sleep(100);
    rooms.forEach(({ id }) => machine.send("/ws", { type: "room.alert", roomId: id, personId: "ann", alert: { about: "confirm", question: "Which?" } } as never));
    await Bun.sleep(300);
    expect(roomCalls).toHaveLength(MOST_ROOM_CALLS_A_MINUTE);
  });

  test("joined as a person, keeps a room quiet that this computer muted, whatever the machine says of it, until it is unmuted here", async () => {
    const machine = fakeMachine();
    cleanUp.push(() => machine.server.stop(true));
    const { watch, store, roomCalls } = watching(machine.origin, { asPerson: true });
    await eventually(() => expect(machine.sockets).toHaveLength(1));
    machine.send("/ws", { type: "snapshot", conversations: [], machines: [], rooms: [{ id: "r1", name: "Launch" }] } as never);
    machine.send("/ws", { type: "rooms.reading", personId: "ann", readings: [{ roomId: "r1", muted: false }] } as never);
    watch.muteRoomHere("m1", "r1", true);
    expect(watch.statuses()[0]!.mutedHere).toEqual(["r1"]);
    expect(store.joinedRoomsMutedHere("m1")).toEqual(["r1"]);

    const call = () => machine.send("/ws", { type: "room.alert", roomId: "r1", personId: "ann", alert: { about: "confirm", question: "Which?" } } as never);
    call();
    await Bun.sleep(200);
    expect(roomCalls).toEqual([]);

    watch.stopAll();
    watch.start("m1");
    expect(watch.statuses()[0]!.mutedHere).toEqual(["r1"]);
    await eventually(() => expect(machine.sockets).toHaveLength(2));
    watch.muteRoomHere("m1", "r1", false);
    call();
    await eventually(() => expect(roomCalls).toHaveLength(1));
  });

  test("joined as a person, saves and tells of the machine's rooms at most once a second however often it sends them, and the last it sent lands", async () => {
    const machine = fakeMachine();
    cleanUp.push(() => machine.server.stop(true));
    const { watch, store, statuses } = watching(machine.origin, { asPerson: true });
    await eventually(() => expect(machine.sockets).toHaveLength(1));
    const saved = spyOn(store, "setMachineRooms");
    machine.send("/ws", { type: "snapshot", conversations: [], machines: [], rooms: [{ id: "r1", name: "Launch" }] } as never);
    await eventually(() => expect(saved).toHaveBeenCalledTimes(1));
    const told = statuses.length;
    Array.from({ length: 50 }, (_, index) =>
      machine.send("/ws", { type: "rooms.reading", personId: "ann", readings: [{ roomId: "r1", unread: index % 2 === 0 ? 1 : 2 }] } as never),
    );
    machine.send("/ws", { type: "rooms.reading", personId: "ann", readings: [{ roomId: "r1", unread: 7 }] } as never);
    await Bun.sleep(200);
    expect(saved).toHaveBeenCalledTimes(1);
    await eventually(() => expect(watch.statuses()[0]!.rooms).toEqual([{ ...joined("r1", "Launch"), unread: 7 }]));
    expect(saved).toHaveBeenCalledTimes(2);
    expect(statuses.length - told).toBe(1);
    expect(store.machineRooms("m1")).toEqual([{ ...joined("r1", "Launch"), unread: 7 }]);

    machine.send("/ws", { type: "rooms.reading", personId: "ann", readings: [{ roomId: "r1", unread: 7 }] } as never);
    await Bun.sleep(1_200);
    expect(saved).toHaveBeenCalledTimes(2);
  });

  const snapshotOf = (...rooms: { id: string; name: string }[]) => ({ type: "snapshot", conversations: [], machines: [], rooms }) as never;
  const [launch, garden] = [
    { id: "r1", name: "Launch" },
    { id: "r2", name: "Garden" },
  ];

  test("joined as a person, leaves a room at once and tells the machine, and shows it again only once the machine took them out and back in", async () => {
    const machine = fakeMachine();
    cleanUp.push(() => machine.server.stop(true));
    const { watch, store } = watching(machine.origin, { asPerson: true });
    const roomIds = () => watch.statuses()[0]!.rooms.map(({ id }) => id);
    await eventually(() => expect(machine.sockets).toHaveLength(1));
    machine.send("/ws", snapshotOf(launch, garden));
    await eventually(() => expect(roomIds()).toEqual(["r1", "r2"]));
    watch.muteRoomHere("m1", "r1", true);

    watch.leaveRoom("m1", "r1");
    expect(roomIds()).toEqual(["r2"]);
    expect(store.machineRooms("m1").map(({ id }) => id)).toEqual(["r2"]);
    expect(store.joinedRoomsMutedHere("m1")).toEqual([]);
    await eventually(() => expect(machine.heard).toEqual([{ type: "room.leave", roomId: "r1" }]));

    machine.send("/ws", { type: "room.upserted", room: { ...launch, name: "Launch, renamed before the machine heard" } } as never);
    await Bun.sleep(1_200);
    expect(roomIds()).toEqual(["r2"]);

    machine.send("/ws", { type: "room.deleted", roomId: "r1" });
    await eventually(() => expect(store.joinedRoomsLeft("m1")).toEqual([]));
    machine.send("/ws", { type: "room.upserted", room: launch } as never);
    await eventually(() => expect(roomIds()).toEqual(["r2", "r1"]));
  });

  test("joined as a person, leaves no room it is not in, nor any of a machine of this computer's owner", async () => {
    const machine = fakeMachine();
    cleanUp.push(() => machine.server.stop(true));
    const { watch, store } = watching(machine.origin, { asPerson: true });
    await eventually(() => expect(machine.sockets).toHaveLength(1));
    machine.send("/ws", snapshotOf(launch));
    await eventually(() => expect(watch.statuses()[0]!.rooms).toHaveLength(1));
    watch.leaveRoom("m1", "r2");
    watch.leaveRoom("gone", "r1");
    await Bun.sleep(100);
    expect(store.joinedRoomsLeft("m1")).toEqual([]);
    expect(machine.heard).toEqual([]);
  });

  test("joined as a person, tells a machine it left a room of while it was away once it answers, also when this host restarted meanwhile", async () => {
    const machine = fakeMachine();
    cleanUp.push(() => machine.server.stop(true));
    const { watch, store } = watching(machine.origin, { asPerson: true });
    await eventually(() => expect(machine.sockets).toHaveLength(1));
    machine.send("/ws", snapshotOf(launch, garden));
    await eventually(() => expect(store.machineRooms("m1")).toHaveLength(2));
    const restarted = () => {
      watch.stopAll();
      watch.start("m1");
    };
    restarted();
    watch.leaveRoom("m1", "r1");
    expect(machine.heard).toEqual([]);
    await eventually(() => expect(machine.sockets).toHaveLength(2));
    machine.send("/ws", snapshotOf(launch, garden));
    await eventually(() => expect(machine.heard).toEqual([{ type: "room.leave", roomId: "r1" }]));

    restarted();
    expect(watch.statuses()[0]!.rooms.map(({ id }) => id)).toEqual(["r2"]);
    await eventually(() => expect(machine.sockets).toHaveLength(3));
    machine.send("/ws", snapshotOf(launch, garden));
    await eventually(() => expect(machine.heard).toHaveLength(2));
    expect(watch.statuses()[0]!.rooms.map(({ id }) => id)).toEqual(["r2"]);
    expect(store.joinedRoomsLeft("m1")).toEqual(["r1"]);

    machine.send("/ws", snapshotOf(garden));
    await eventually(() => expect(store.joinedRoomsLeft("m1")).toEqual([]));
  });

  test("joined as a person, knows that leaving the last room is why the machine signs it out, but not while it waits at a door there", async () => {
    const machine = fakeMachine();
    cleanUp.push(() => machine.server.stop(true));
    const { watch, store, signedOut } = watching(machine.origin, { asPerson: true });
    await eventually(() => expect(machine.sockets).toHaveLength(1));
    machine.send("/ws", snapshotOf(launch));
    await eventually(() => expect(store.machineRooms("m1")).toHaveLength(1));
    expect(leftEveryRoomAt(store, "m1")).toBe(false);

    watch.leaveRoom("m1", "r1");
    expect(leftEveryRoomAt(store, "m1")).toBe(true);
    store.setMachineKnocks("m1", [{ roomId: "r3", turnedAway: false }]);
    expect(leftEveryRoomAt(store, "m1")).toBe(false);
    store.setMachineKnocks("m1", [{ roomId: "r3", turnedAway: true }]);

    machine.send("/ws", { type: "room.deleted", roomId: "r1" });
    machine.sockets.forEach((socket) => socket.close(OUT_OF_ROOMS_CLOSE_CODE, "out of every room"));
    await eventually(() => expect(signedOut).toEqual(["m1"]));
    expect(leftEveryRoomAt(store, "m1")).toBe(true);
  });

  test("takes no rooms from a machine joined as a device: its own rooms are not the person's", async () => {
    const machine = fakeMachine();
    cleanUp.push(() => machine.server.stop(true));
    const { watch } = watching(machine.origin);
    await eventually(() => expect(machine.sockets.length).toBeGreaterThan(0));
    machine.send("/ws", { type: "snapshot", conversations: [], machines: [], hostId: "home", rooms: [{ id: "r1", name: "Launch" }] } as never);
    await Bun.sleep(200);
    expect(watch.statuses()[0]!.rooms).toEqual([]);
  });

  test("joined as a person, signs out the moment the machine's owner takes this computer's person out of their last room", async () => {
    const machine = fakeMachine();
    cleanUp.push(() => machine.server.stop(true));
    const { watch, signedOut } = watching(machine.origin, { asPerson: true });
    await eventually(() => expect(machine.sockets).toHaveLength(1));

    machine.sockets.forEach((socket) => socket.close(OUT_OF_ROOMS_CLOSE_CODE, "out of every room"));
    await eventually(() => expect(signedOut).toEqual(["m1"]));
    expect(watch.statuses()).toEqual([]);
    await Bun.sleep(300);
    expect(machine.signIns).toHaveLength(1);
  });

  test("joined as a person, learns from the rooms it still waits at whether the machine's owner let this computer in, the room there first, or turned it away, and keeps what the owner goes by, cleaned", async () => {
    const machine = fakeMachine();
    cleanUp.push(() => machine.server.stop(true));
    const { watch, store, machineChanges } = watching(machine.origin, { asPerson: true });
    store.setMachineKnocks("m1", [
      { roomId: "r1", turnedAway: false },
      { roomId: "r2", turnedAway: false },
      { roomId: "r3", turnedAway: true },
    ]);
    await eventually(() => expect(machine.sockets).toHaveLength(1));
    const knocks = () => store.findMachine("m1")?.knocks;
    const room = (id: string, name: string) => ({ id, name, workspaceId: "w1", people: [], agents: [] });
    const people = (ownerName: string) => [
      { id: "ann", name: ownerName, color: null, number: 1 },
      { id: "me", name: "Gus", color: null, number: 2 },
    ];

    machine.send("/ws", { type: "snapshot", conversations: [], machines: [], rooms: [room("r0", "Lobby")], people: people("Ann\nLee"), ownerId: "ann" } as never);
    await eventually(() => expect(store.findMachine("m1")?.ownerName).toBe("Ann Lee"));
    const changesSoFar = machineChanges.length;
    machine.send("/ws", { type: "rooms.waiting-to-join", personId: "me", roomIds: ["r1", "r2", "../x"] } as never);
    await Bun.sleep(100);
    expect(knocks()).toEqual([
      { roomId: "r1", turnedAway: false },
      { roomId: "r2", turnedAway: false },
      { roomId: "r3", turnedAway: true },
    ]);
    expect(machineChanges).toHaveLength(changesSoFar);

    machine.send("/ws", { type: "room.upserted", room: room("r1", "Launch") } as never);
    machine.send("/ws", { type: "rooms.waiting-to-join", personId: "me", roomIds: ["r2"] } as never);
    await eventually(() => expect(knocks()).toEqual([{ roomId: "r2", turnedAway: false }, { roomId: "r3", turnedAway: true }]));
    expect(watch.statuses()[0]!.rooms.map(({ id }) => id)).toEqual(["r0", "r1"]);

    machine.send("/ws", { type: "rooms.waiting-to-join", personId: "me", roomIds: [] } as never);
    await eventually(() => expect(knocks()).toEqual([{ roomId: "r2", turnedAway: true }, { roomId: "r3", turnedAway: true }]));
    watch.dismissKnock("m1", "r2");
    expect(knocks()).toEqual([{ roomId: "r3", turnedAway: true }]);

    machine.send("/ws", { type: "people.listed", people: people("Ann Smith") } as never);
    await eventually(() => expect(store.findMachine("m1")?.ownerName).toBe("Ann Smith"));
    machine.send("/ws", { type: "people.listed", people: people("") } as never);
    await eventually(() => expect(store.findMachine("m1")?.ownerName).toBeNull());
  });

  test("forgets only a room that turned this computer's owner away, never one they still wait at", () => {
    const { watch, store, machineChanges } = watching("https://127.0.0.1:1", { asPerson: true });
    store.setMachineKnocks("m1", [{ roomId: "r1", turnedAway: false }]);

    watch.dismissKnock("m1", "r1");
    watch.dismissKnock("m1", "r9");

    expect(store.findMachine("m1")?.knocks).toEqual([{ roomId: "r1", turnedAway: false }]);
    expect(machineChanges).toEqual([]);
  });

  test("a machine that signed this computer out takes its token and its place in the tunnel, and says it is out of their rooms when it was joined as a person", () => {
    const store = new Store(":memory:");
    store.insertMachine({ id: "person", name: "Ann's Mac", origin: "https://ann.example:4600", createdAt: 1 });
    store.insertMachine({ id: "device", name: "Home server", origin: "https://home.example:4600", createdAt: 1 });
    store.setMachineJoinedAs("person", { asPerson: true, relayKey: "relay-key" });
    ["person", "device"].forEach((machineId) => store.setMachineDeviceToken(machineId, "device-token"));
    store.setMachineRooms("person", [joined("r1", "Launch")]);
    store.setMachineKnocks("person", [
      { roomId: "r2", turnedAway: false },
      { roomId: "r3", turnedAway: true },
    ]);
    const forgotten: string[] = [];
    const tunnels = { forget: (machineId: string) => forgotten.push(machineId) };

    forgetSignInAt(store, tunnels, "person");
    forgetSignInAt(store, tunnels, "device");

    expect(forgotten).toEqual(["person", "device"]);
    expect(["person", "device"].map((machineId) => store.machineDeviceToken(machineId))).toEqual([null, null]);
    expect(store.findMachine("person")?.outOfRooms).toBe(true);
    expect(store.findMachine("device")?.outOfRooms).toBe(false);
    expect(store.machineRooms("person")).toEqual([]);
    expect(store.findMachine("person")?.knocks).toEqual([
      { roomId: "r2", turnedAway: true },
      { roomId: "r3", turnedAway: true },
    ]);
  });

  test("does not ask a machine it stopped watching whether it still lets this host in, so a host stopping never reads the store it closed", async () => {
    const neverAnswers = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Promise<Response>(() => {}) });
    cleanUp.push(() => neverAnswers.stop(true));
    const { watch, store, statuses, signedOut } = watching(`http://127.0.0.1:${neverAnswers.port}`);
    await Bun.sleep(100);
    watch.stopAll();
    store.close();
    await Bun.sleep(200);
    expect(statuses).toEqual([]);
    expect(signedOut).toEqual([]);
  });

  test("leaves a machine this host has not joined alone", async () => {
    const machine = fakeMachine();
    cleanUp.push(() => machine.server.stop(true));
    const { watch } = watching(machine.origin, { joined: false });
    await Bun.sleep(100);
    expect(machine.signIns).toEqual([]);
    expect(watch.statuses()).toEqual([]);
  });
});

describe("a machine reached through a dial's forward", () => {
  const places = { hostKey: "TfdU+RVSAYU/VwqNJh5dDtXFyyZCkHgiPG8knt29NU0=", hostAddress: "fd12:3456:789a:1::1", port: 4600, broker: { address: "p2p.example.com:47800", key: "TfdU+RVSAYU/VwqNJh5dDtXFyyZCkHgiPG8knt29NU0=" } };
  const tunnelOrigin = `http://[${places.hostAddress}]:4600`;
  const HEARTBEAT_MS = 100;

  /**
   * A dial's socket, in a folder of its own, or on Windows its port on IPv6's loopback, with `fetch` answering there as
   * the machine through the tunnel, which takes an Origin only of its Host's.
   */
  function wayTo(fetch: (request: Request, server: Bun.Server<{ path: string }>) => Response | Promise<Response> | undefined, websocket?: Bun.WebSocketHandler<{ path: string }>) {
    const folder = mkdtempSync(join(tmpdir(), "mirador-forward-"));
    const socket = join(folder, "w");
    const server = Bun.serve<{ path: string }>({
      ...(DIALS_THROUGH_SOCKETS ? { unix: socket } : { hostname: "::1", port: 0 }),
      fetch: (request, server) => {
        const origin = request.headers.get("origin");
        if (origin !== null && origin !== `http://${request.headers.get("host")}`) return new Response("forbidden origin", { status: 403 });
        return fetch(request, server);
      },
      websocket: websocket ?? { message() {} },
    });
    cleanUp.push(() => {
      server.stop(true);
      rmSync(folder, { recursive: true, force: true });
    });
    return DIALS_THROUGH_SOCKETS ? { origin: tunnelOrigin, socket } : atAddress(`http://[::1]:${server.port}`);
  }

  /** The forward and the machine beyond it: it answers pings until it goes quiet, as when its owner unpinned this computer, after which nothing answers at all. */
  function machineBeyondForward() {
    const sockets: Socket[] = [];
    const state = { quiet: false };
    const way = wayTo(
      (request, server) => {
        if (state.quiet) return new Promise<Response>(() => {});
        return server.upgrade(request, { data: { path: new URL(request.url).pathname } }) ? undefined : new Response("no", { status: 400 });
      },
      {
        open: (socket) => void sockets.push(socket),
        message(socket, message) {
          if (!state.quiet && JSON.parse(String(message)).type === "ping") socket.send(JSON.stringify({ type: "pong" }));
        },
      },
    );
    return { way, sockets, state };
  }

  function machineInStore() {
    const store = new Store(":memory:");
    store.insertMachine({ id: "m1", name: "Ann's machine", origin: tunnelOrigin, createdAt: 1 });
    store.setMachineTunnelPlaces("m1", places);
    store.setMachineDeviceToken("m1", "device-token");
    store.setMachineJoinedAs("m1", { asPerson: true, relayKey: "relay-key" });
    return store;
  }

  /** A dial whose process holds its forward while `running`. */
  function dialTo(way: Way) {
    const dial = { running: true };
    const reach: Pick<MachineReach, "reached" | "stillReaches" | "wayTo"> = {
      reached: async (machine: Machine) => ({ ...machine, origin: way.origin }),
      stillReaches: () => dial.running,
      wayTo: () => (dial.running ? way : null),
    };
    return { dial, reach };
  }

  function watchingThrough(way: Way) {
    const store = machineInStore();
    const { dial, reach } = dialTo(way);
    const statuses: MachineStatus[] = [];
    const signedOut: string[] = [];
    const watch = new MachineWatch(store, THIS_HOST, (status) => statuses.push(status), () => {}, () => {}, () => {}, (machineId) => signedOut.push(machineId), reach, HEARTBEAT_MS);
    cleanUp.push(() => watch.stopAll());
    watch.startAll();
    return { watch, store, statuses, signedOut, dial };
  }

  test("opens the machine's socket through the dial's, signed in and naming the machine's address in the tunnel as its Host", async () => {
    const machine = machineBeyondForward();
    const { watch } = watchingThrough(machine.way);
    await eventually(() => expect(watch.statuses()[0]!.reachable).toBe(true));
    expect(machine.sockets.map(({ data }) => data.path)).toEqual(["/ws"]);
  });

  test("asks the machine to answer now and then, and says it stopped answering once it goes quiet, though the forward keeps the socket open", async () => {
    const machine = machineBeyondForward();
    const { watch, statuses } = watchingThrough(machine.way);
    await eventually(() => expect(watch.statuses()[0]!.reachable).toBe(true));
    await Bun.sleep(HEARTBEAT_MS * 5);
    expect(statuses.map(({ reachable }) => reachable)).toEqual([true]);

    machine.state.quiet = true;
    await eventually(() => expect(watch.statuses()[0]!.reachable).toBe(false));
    await Bun.sleep(HEARTBEAT_MS * 5);
    expect(watch.statuses()[0]!.reachable).toBe(false);
  });

  test("takes the person out of the machine's rooms only by a close that came while the dial's process held the forward", async () => {
    const machine = machineBeyondForward();
    const { store, signedOut, dial } = watchingThrough(machine.way);
    await eventually(() => expect(machine.sockets).toHaveLength(1));
    dial.running = false;
    machine.sockets.forEach((socket) => socket.close(OUT_OF_ROOMS_CLOSE_CODE, "out of every room"));
    await Bun.sleep(300);
    expect(signedOut).toEqual([]);
    expect(store.findMachine("m1")?.outOfRooms).toBe(false);
  });

  test("counts a 401 as this computer revoked only when it came while the dial's process held the forward the whole time, and sends no token through one it no longer holds", async () => {
    const asked: string[] = [];
    const turnsAway = wayTo(async (request) => {
      asked.push(request.headers.get("cookie") ?? "");
      await Bun.sleep(100);
      return new Response("unauthorized", { status: 401 });
    });
    const store = machineInStore();
    const { dial, reach } = dialTo(turnsAway);
    const reached = { ...store.findMachine("m1")!, origin: turnsAway.origin };
    expect(await signInRevoked(store, reached, reach)).toBe(true);

    const asking = signInRevoked(store, reached, reach);
    await Bun.sleep(30);
    dial.running = false;
    expect(await asking).toBe(false);

    expect(await signInRevoked(store, reached, reach)).toBe(false);
    expect(asked).toEqual(["mirador_token=device-token", "mirador_token=device-token"]);
  });
});
