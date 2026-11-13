import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { MachineWatch } from "../host/machine-watch.ts";
import { Store } from "../host/store.ts";
import type { MachineStatus } from "../shared/model.ts";
import type { ServerMessage } from "../shared/protocol.ts";
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

function watching(origin: string, joined = true) {
  const store = new Store(":memory:");
  store.insertMachine({ id: "m1", name: "Home server", origin, createdAt: 1 });
  if (joined) store.setMachineDeviceToken("m1", "device-token");
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
    expect(watch.statuses()).toEqual([{ machineId: "m1", reachable: true, waiting: [], joinedThere: [] }]);

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
      expect(logged).toHaveBeenCalledWith(expect.stringContaining(`skipped a message from ${machine.origin.replace(/^http/, "ws")}/ws`), expect.any(Error));
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
    const { watch } = watching(machine.origin, false);
    await Bun.sleep(100);
    expect(machine.signIns).toEqual([]);
    expect(watch.statuses()).toEqual([]);
  });
});
