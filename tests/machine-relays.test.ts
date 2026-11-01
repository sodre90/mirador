import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { authorityFingerprint, ownServingCertificate } from "../host/certificates.ts";
import { DeviceService } from "../host/devices.ts";
import { JoinRequestService } from "../host/join-requests.ts";
import { forwardedHeaders, machineClosedSocket, MachineRelays, pageSocketOpened, relayedHeaders } from "../host/machine-relays.ts";
import type { RelayedSocket } from "../host/machine-relays.ts";
import { Store } from "../host/store.ts";

const machine = "https://home-server.example.ts.net";

describe("forwardedHeaders", () => {
  test("signs in with the device token instead of this host's cookie, and says the page is the machine's own", () => {
    const incoming = new Headers({
      host: "127.0.0.1:4620",
      cookie: "mirador_token=this-hosts-own",
      origin: "http://127.0.0.1:4620",
      referer: "http://127.0.0.1:4620/",
      "sec-websocket-key": "abc",
      accept: "application/json",
    });
    expect(Object.fromEntries(forwardedHeaders(incoming, machine, "device-token", "http://127.0.0.1:4601"))).toEqual({
      accept: "application/json",
      cookie: "mirador_token=device-token",
      origin: machine,
      "mirador-canvas-assets-origin": "http://127.0.0.1:4601",
    });
  });

  test("adds no origin where the page sent none, and no cookie before this host has joined", () => {
    const forwarded = forwardedHeaders(new Headers({ cookie: "mirador_token=x", accept: "*/*" }), machine, null, "http://127.0.0.1:4601");
    expect(forwarded.has("cookie") || forwarded.has("origin")).toBe(false);
  });
});

describe("relayedHeaders", () => {
  test("keeps the machine's cookies off this host's address, and its redirects on the relay", () => {
    const upstream = new Headers({ "set-cookie": "mirador_token=machine; Path=/", "content-encoding": "gzip", location: `${machine}/#/c/1`, "content-type": "text/html" });
    expect(Object.fromEntries(relayedHeaders(upstream, machine, "http://127.0.0.1:4620"))).toEqual({
      "content-type": "text/html",
      location: "http://127.0.0.1:4620/#/c/1",
    });
  });
});

describe("relay ports", () => {
  const freePorts = (count: number) =>
    Array.from({ length: count }, () => Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() })).map((server) => {
      const { port } = server;
      server.stop(true);
      return port!;
    });

  test("keep a machine on its port from before, and move it into the range the desktop app lets its window load", () => {
    const [kept, inRange, outside] = freePorts(3) as [number, number, number];
    const store = new Store(":memory:");
    store.insertMachine({ id: "kept", name: "Kept", origin: "https://kept.example", createdAt: 1 });
    store.insertMachine({ id: "moved", name: "Moved", origin: "https://moved.example", createdAt: 2 });
    store.setMachineRelayPort("kept", kept);
    store.setMachineRelayPort("moved", outside);
    const relays = new MachineRelays(store, [inRange, kept], "http://127.0.0.1:4601", () => true, () => {}, () => {});
    relays.startAll();
    try {
      expect(store.listMachines().map(({ id, relayPort }) => [id, relayPort])).toEqual([
        ["kept", kept],
        ["moved", inRange],
      ]);
    } finally {
      relays.stopAll();
    }
  });
});

describe("a machine's close reaching the page", () => {
  const fakeUpstream = { send: () => {}, close: () => {} } as unknown as WebSocket;

  const fakePageSocket = (data: RelayedSocket, log: string[]) =>
    ({
      data,
      send: (message: string | ArrayBuffer) => log.push(`sent ${String(message)}`),
      close: (code?: number, reason?: string) => log.push(`closed ${code} ${reason}`),
    }) as unknown as Bun.ServerWebSocket<RelayedSocket>;

  test("one that arrives before the page's end opens is replayed once it does, after what the machine sent first", () => {
    const log: string[] = [];
    const data: RelayedSocket = { upstream: fakeUpstream, page: null, waiting: ["first"], closedBeforeOpen: null };
    machineClosedSocket(data, 1006, "the machine went away");
    expect(data.closedBeforeOpen).toEqual({ code: 1000, reason: "the machine went away" });
    expect(log).toEqual([]);
    pageSocketOpened(fakePageSocket(data, log));
    expect(log).toEqual(["sent first", "closed 1000 the machine went away"]);
  });

  test("once the page's end is open, the machine's close goes straight to it", () => {
    const log: string[] = [];
    const data: RelayedSocket = { upstream: fakeUpstream, page: null, waiting: [], closedBeforeOpen: null };
    pageSocketOpened(fakePageSocket(data, log));
    expect(log).toEqual([]);
    machineClosedSocket(data, 4001, "signed out");
    expect(log).toEqual(["closed 4001 signed out"]);
  });

  test("a real page gets the machine's message and then its close through the relay", async () => {
    const machineServer = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request, server) => (server.upgrade(request) ? undefined : new Response("not a socket")),
      websocket: {
        open: (socket) => {
          socket.send("hello from the machine");
          socket.close(1000, "the machine hung up");
        },
        message: () => {},
      },
    });
    const portFinder = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
    const relayPort = portFinder.port!;
    portFinder.stop(true);
    const store = new Store(":memory:");
    store.insertMachine({ id: "box", name: "Box", origin: `http://127.0.0.1:${machineServer.port}`, createdAt: 1 });
    const relays = new MachineRelays(store, [relayPort], "http://127.0.0.1:4601", () => true, () => {}, () => {});
    relays.startAll();
    try {
      const events: string[] = [];
      await new Promise<void>((resolve, reject) => {
        const page = new WebSocket(`ws://127.0.0.1:${relayPort}/ws`);
        page.onmessage = (event) => events.push(`message ${event.data}`);
        page.onclose = (event) => {
          events.push(`close ${event.code} ${event.reason}`);
          resolve();
        };
        page.onerror = () => reject(new Error("the page's socket failed"));
        setTimeout(() => reject(new Error(`the page's socket never closed, it only saw: ${events.join(", ")}`)), 5000).unref();
      });
      expect(events).toEqual(["message hello from the machine", "close 1000 the machine hung up"]);
    } finally {
      relays.stopAll();
      machineServer.stop(true);
    }
  }, 10_000);
});

describe("joining a machine that made its own certificate", () => {
  const cleanUps: (() => void)[] = [];
  afterEach(() => cleanUps.splice(0).forEach((cleanUp) => cleanUp()));

  function ownAuthority() {
    const dataDir = mkdtempSync(join(tmpdir(), "mirador-machine-"));
    cleanUps.push(() => rmSync(dataDir, { recursive: true, force: true }));
    return ownServingCertificate(dataDir, ["127.0.0.1"]);
  }

  /** A machine's Mirador on the network, which lets in every code it is sent. */
  function machineOnTheNetwork(certificate = ownAuthority(), offeredAuthority = certificate.authority) {
    const codesReceived: string[] = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      tls: { cert: certificate.chain, key: certificate.key },
      routes: {
        "/mirador-ca.pem": new Response(offeredAuthority),
        "/join": {
          POST: async (request) => {
            codesReceived.push(((await request.json()) as { code: string }).code);
            return Response.json({ token: "device-token" });
          },
        },
      },
      fetch: () => new Response("join page"),
    });
    cleanUps.push(() => server.stop(true));
    const store = new Store(":memory:");
    store.insertMachine({ id: "box", name: "Box", origin: `https://127.0.0.1:${server.port}`, createdAt: 1 });
    const relays = new MachineRelays(store, [], "http://127.0.0.1:4601", () => true, () => {}, () => {});
    return { authority: offeredAuthority!, codesReceived, store, join: relays.join.bind(relays, "box") };
  }

  test("trusts the certificate authority the invite link names, and sends no code to a machine with another one", async () => {
    const machine = machineOnTheNetwork();
    await expect(machine.join("WRONG-LINK", authorityFingerprint(ownAuthority().authority!))).rejects.toThrow(
      "Box's certificate authority is not the one in the invite link, so the code was not sent.",
    );
    expect(machine.codesReceived).toEqual([]);

    await machine.join("FROM-LINK", authorityFingerprint(machine.authority));
    expect(machine.codesReceived).toEqual(["FROM-LINK"]);
    expect(machine.store.machineAuthority("box")).toBe(machine.authority);
    expect(machine.store.machineDeviceToken("box")).toBe("device-token");
  });

  test("with a bare code, trusts the authority it first joined by, and an invite link's alone once it changed", async () => {
    const machine = machineOnTheNetwork();
    await machine.join("FIRST");
    expect(machine.store.machineAuthority("box")).toBe(machine.authority);

    machine.store.setMachineAuthority("box", ownAuthority().authority);
    await expect(machine.join("AFTER-CHANGE")).rejects.toThrow("Box's certificate authority changed since this computer joined it, so the code was not sent.");
    await machine.join("FROM-LINK", authorityFingerprint(machine.authority));
    expect(machine.codesReceived).toEqual(["FIRST", "FROM-LINK"]);
    expect(machine.store.machineAuthority("box")).toBe(machine.authority);
  });

  test("sends no code to a machine whose certificate is not from the authority it offers", async () => {
    const machine = machineOnTheNetwork(ownAuthority(), ownAuthority().authority);
    await expect(machine.join("CODE", authorityFingerprint(machine.authority))).rejects.toThrow(
      "Box's certificate is not from its own certificate authority, or does not name 127.0.0.1.",
    );
    expect(machine.codesReceived).toEqual([]);
    expect(machine.store.machineAuthority("box")).toBeNull();
  });

  test("asking to join trusts the machine's certificate authority, even a new one, once someone there types the number this host shows", async () => {
    const certificate = ownAuthority();
    const machineStore = new Store(":memory:");
    const requests = new JoinRequestService(machineStore, new DeviceService(machineStore), authorityFingerprint(certificate.authority!));
    const body = async (request: Request) => (await request.json()) as Record<string, unknown>;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      tls: { cert: certificate.chain, key: certificate.key },
      routes: {
        "/mirador-ca.pem": new Response(certificate.authority),
        "/join-requests": { POST: async (request) => Response.json(requests.open({ ...(await body(request)), fromAddress: "a", tailscaleUser: null } as never)) },
        "/join-requests/:id/reveal": {
          POST: async (request) => {
            const { secret, nonce } = await body(request);
            await requests.reveal(request.params.id, secret, nonce);
            return new Response(null, { status: 204 });
          },
        },
        "/join-requests/:id/poll": { POST: async (request) => Response.json(requests.poll(request.params.id, (await body(request)).secret)) },
      },
      fetch: () => new Response("join page"),
    });
    cleanUps.push(() => server.stop(true));
    const store = new Store(":memory:");
    store.insertMachine({ id: "box", name: "Box", origin: `https://127.0.0.1:${server.port}`, createdAt: 1 });
    store.setMachineAuthority("box", ownAuthority().authority);

    await new MachineRelays(store, [], "http://127.0.0.1:4601", () => true, () => {}, () => {}).askToJoin("box", (number) => void requests.approve(requests.waiting()[0]!.id, number));
    expect(store.machineAuthority("box")).toBe(certificate.authority);
    expect(machineStore.listDevices().map(({ name }) => name)).toEqual([expect.stringMatching(/^Mirador on /)]);
  });
});
