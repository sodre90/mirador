import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { forgetSignInAt, signInRevoked } from "../host/machine-sign-in.ts";
import type { MachineReach } from "../host/machine-tunnels.ts";
import { MachineWatch } from "../host/machine-watch.ts";
import type { Way } from "../host/p2p/dial.ts";
import { Store } from "../host/store.ts";
import type { Machine, MachineStatus } from "../shared/model.ts";
import { OUT_OF_ROOMS_CLOSE_CODE, type ServerMessage } from "../shared/protocol.ts";
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
      message() {},
    },
  });
  const origin = `http://127.0.0.1:${server.port}`;
  const send = (path: string, message: unknown) => sockets.filter(({ data }) => data.path === path).forEach((socket) => socket.send(JSON.stringify(message)));
  const revokeDevice = () => {
    acceptedCookie = "";
    sockets.splice(0).forEach((socket) => socket.close(1000, "device revoked"));
  };
  return { server, origin, sockets, signIns, send, revokeDevice };
}

const conversation = (id: string, waitingFor: string | null) => ({ id, waitingFor });

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
  const signedOut: string[] = [];
  const machineChanges: string[] = [];
  const watch = new MachineWatch(
    store,
    THIS_HOST,
    (status) => statuses.push(status),
    () => machineChanges.push(store.listMachines().map(({ hostId }) => hostId).join()),
    (notification) => notifications.push(notification),
    (machineId) => {
      signedOut.push(machineId);
      watch.stop(machineId);
    },
  );
  cleanUp.push(() => watch.stopAll());
  watch.startAll();
  return { watch, store, statuses, notifications, signedOut, machineChanges };
}

describe("MachineWatch", () => {
  test("follows what the machine's conversations wait for, signed in with the device token as the machine's own page", async () => {
    const machine = fakeMachine();
    cleanUp.push(() => machine.server.stop(true));
    const { watch } = watching(machine.origin);
    await eventually(() => expect(machine.sockets).toHaveLength(2));
    expect(machine.signIns.toSorted()).toEqual([`/notifications ${machine.origin} mirador_token=device-token`, `/ws ${machine.origin} mirador_token=device-token`]);
    expect(watch.statuses()).toEqual([{ machineId: "m1", reachable: true, waiting: [], joinedThere: [], rooms: [] }]);

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

  test("passes the machine's notifications on as this host's, saying which machine they come from", async () => {
    const machine = fakeMachine();
    cleanUp.push(() => machine.server.stop(true));
    const { notifications } = watching(machine.origin);
    await eventually(() => expect(machine.sockets).toHaveLength(2));
    const notification: SystemNotification = { kind: "question", conversationId: "a", title: "Deploy", workspace: "infra", body: "Asks: Ship it?" };
    machine.send("/notifications", { type: "system-notification", notification });
    machine.send("/ws", { type: "system-notification", notification });
    await eventually(() => expect(notifications).toEqual([{ ...notification, machineId: "m1", workspace: "Home server · infra" }]));
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
    expect(watch.statuses()).toEqual([{ machineId: "m1", reachable: true, waiting: [], joinedThere: [], rooms: [] }]);
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
    await eventually(() => expect(watch.statuses()[0]!.rooms).toEqual([{ id: "r1", name: "Launch plan" }]));
    machine.send("/ws", { type: "room.upserted", room: room("r2", "Ops") } as never);
    machine.send("/ws", { type: "room.deleted", roomId: "r1" } as never);
    await eventually(() => expect(watch.statuses()[0]!.rooms).toEqual([{ id: "r2", name: "Ops" }]));
    expect(store.machineRooms("m1")).toEqual([{ id: "r2", name: "Ops" }]);

    watch.stopAll();
    machine.server.stop(true);
    watch.start("m1");
    expect(watch.statuses()).toEqual([{ machineId: "m1", reachable: false, waiting: [], joinedThere: [], rooms: [{ id: "r2", name: "Ops" }] }]);
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

  test("a machine that signed this computer out takes its token and its place in the tunnel, and says it is out of their rooms when it was joined as a person", () => {
    const store = new Store(":memory:");
    store.insertMachine({ id: "person", name: "Ann's Mac", origin: "https://ann.example:4600", createdAt: 1 });
    store.insertMachine({ id: "device", name: "Home server", origin: "https://home.example:4600", createdAt: 1 });
    store.setMachineJoinedAs("person", { asPerson: true, relayKey: "relay-key" });
    ["person", "device"].forEach((machineId) => store.setMachineDeviceToken(machineId, "device-token"));
    store.setMachineRooms("person", [{ id: "r1", name: "Launch" }]);
    const forgotten: string[] = [];
    const tunnels = { forget: (machineId: string) => forgotten.push(machineId) };

    forgetSignInAt(store, tunnels, "person");
    forgetSignInAt(store, tunnels, "device");

    expect(forgotten).toEqual(["person", "device"]);
    expect(["person", "device"].map((machineId) => store.machineDeviceToken(machineId))).toEqual([null, null]);
    expect(store.findMachine("person")?.outOfRooms).toBe(true);
    expect(store.findMachine("device")?.outOfRooms).toBe(false);
    expect(store.machineRooms("person")).toEqual([]);
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

  /** A dial's socket, in a folder of its own, with `fetch` answering there as the machine through the tunnel, which takes an Origin only of its Host's. */
  function socketTo(fetch: (request: Request, server: Bun.Server<{ path: string }>) => Response | Promise<Response> | undefined, websocket?: Bun.WebSocketHandler<{ path: string }>) {
    const folder = mkdtempSync(join(tmpdir(), "mirador-forward-"));
    const socket = join(folder, "w");
    const server = Bun.serve<{ path: string }>({
      unix: socket,
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
    return { origin: tunnelOrigin, socket };
  }

  /** The forward and the machine beyond it: it answers pings until it goes quiet, as when its owner unpinned this computer, after which nothing answers at all. */
  function machineBeyondForward() {
    const sockets: Socket[] = [];
    const state = { quiet: false };
    const way = socketTo(
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
    const watch = new MachineWatch(store, THIS_HOST, (status) => statuses.push(status), () => {}, () => {}, (machineId) => signedOut.push(machineId), reach, HEARTBEAT_MS);
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
    const turnsAway = socketTo(async (request) => {
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
