import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { authorityFingerprint, ownServingCertificate } from "../host/certificates.ts";
import { DeviceService, inviteKey } from "../host/devices.ts";
import { JoinRequestService } from "../host/join-requests.ts";
import { allowedCanvasOrigin, fetchAnswered, forwardedCanvasHeaders, forwardedHeaders, joinRefusalIn, machineClosedSocket, MachineRelays, pageSocketOpened, pathPastKey, relayedHeaders } from "../host/machine-relays.ts";
import type { MachineReach } from "../host/machine-tunnels.ts";
import { atAddress, DIALS_THROUGH_SOCKETS, tunnelOriginsOf, type Forward } from "../host/p2p/dial.ts";
import type { Machine } from "../shared/model.ts";
import type { RelayedSocket } from "../host/machine-relays.ts";
import { newChallenge, NO_AUTHORITY, ownerKey, signedRoomJoin, type OwnerKey } from "../host/person-keys.ts";
import { HostProblemError, type HostProblem } from "../shared/host-problems.ts";
import { problemResponse } from "../host/problem-response.ts";
import { Store } from "../host/store.ts";

const machine = "https://home-server.example.ts.net";
/** For machines that ask no one to join a room. */
const unusedOwnerKey: OwnerKey = { publicKey: "", sign: () => "" };
const THIS_HOSTS_PAGES = ["http://127.0.0.1:4600", "http://localhost:4600"];

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

  describe("for a request of the owner's own device that has no Origin", () => {
    const originOf = (headers: Record<string, string>, method: string) =>
      forwardedHeaders(new Headers(headers), machine, "device-token", "http://127.0.0.1:4601", { method, fillsInMissingOrigin: true }).get("origin");

    test("sets the machine's origin on a same-origin POST, which WebView2 sends without one", () => {
      expect(originOf({ "sec-fetch-site": "same-origin" }, "POST")).toBe(machine);
    });

    test("adds none to a GET", () => {
      expect(originOf({ "sec-fetch-site": "same-origin" }, "GET")).toBeNull();
    });

    test("adds none to a POST that says nothing of where it came from", () => {
      expect(originOf({}, "POST")).toBeNull();
    });

    test("adds none to a POST from another site", () => {
      expect(originOf({ "sec-fetch-site": "cross-site" }, "POST")).toBeNull();
    });

    test("adds none where the caller does not ask for it", () => {
      expect(forwardedHeaders(new Headers({ "sec-fetch-site": "same-origin" }), machine, null, "http://127.0.0.1:4601", { method: "POST" }).has("origin")).toBe(false);
    });
  });
});

const freePorts = (count: number) =>
  Array.from({ length: count }, () => Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() })).map((server) => {
    const { port } = server;
    server.stop(true);
    return port!;
  });

describe("forwardedCanvasHeaders", () => {
  test("leave this host's sign-in behind, which the browser sends to every port of 127.0.0.1, and name the relay the page loads from", () => {
    const incoming = new Headers({ host: "127.0.0.1:4621", cookie: "mirador_token=this-hosts-own", origin: "null", range: "bytes=0-99" });
    expect(Object.fromEntries(forwardedCanvasHeaders(incoming, "http://127.0.0.1:4621"))).toEqual({
      range: "bytes=0-99",
      "mirador-canvas-assets-origin": "http://127.0.0.1:4621",
    });
  });
});

describe("a machine's canvas assets", () => {
  const servers: { stop: (closeActiveConnections?: boolean) => void }[] = [];
  let relays: MachineRelays | null = null;
  afterEach(() => {
    relays?.stopAll();
    servers.splice(0).forEach((server) => server.stop(true));
  });

  /** A machine whose web server says where its canvas server is, when it is new enough to; each says what it was asked. */
  function machineThatSays(says: "its canvas origin" | "nothing about it") {
    const canvas = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request) =>
        Response.json({ path: new URL(request.url).pathname, cookie: request.headers.get("cookie"), relay: request.headers.get("mirador-canvas-assets-origin") }),
    });
    const web = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request) =>
        new URL(request.url).pathname === "/mirador-here"
          ? Response.json(says === "its canvas origin" ? { mirador: true, canvasOrigin: canvas.url.origin } : { mirador: true })
          : Response.json({ canvasAssetsOrigin: request.headers.get("mirador-canvas-assets-origin") }),
    });
    servers.push(canvas, web);
    return web.url.origin;
  }

  function relaysFor(origin: string, signedInAsOwner: (request: Request, fromThisComputer: boolean) => boolean = () => true) {
    const store = new Store(":memory:");
    store.insertMachine({ id: "home", name: "Home server", origin, createdAt: 1 });
    relays = new MachineRelays(store, freePorts(3), "http://127.0.0.1:4601", THIS_HOSTS_PAGES, signedInAsOwner, () => {}, () => {}, unusedOwnerKey);
    relays.startAll();
    return `http://127.0.0.1:${store.findMachine("home")!.relayPort}`;
  }

  const canvasAssetsOriginTold = async (pageRelay: string) => ((await (await fetch(`${pageRelay}/`)).json()) as { canvasAssetsOrigin: string }).canvasAssetsOrigin;

  test("come through a relay of their own on this computer, which the machine's shell is told it loads from", async () => {
    const pageRelay = relaysFor(machineThatSays("its canvas origin"));
    const canvasRelay = await canvasAssetsOriginTold(pageRelay);
    expect(canvasRelay).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect([pageRelay, "http://127.0.0.1:4601"]).not.toContain(canvasRelay);
    const answer = await fetch(`${canvasRelay}/apps/media/6af5ae1363fad878/view.js`, { headers: { cookie: "mirador_token=this-hosts-own" } });
    expect(await answer.json()).toEqual({ path: "/apps/media/6af5ae1363fad878/view.js", cookie: null, relay: canvasRelay });
  });

  test("of a machine of this computer's owner, take this host's own sign-in only from this computer itself, not passed on by a proxy", async () => {
    const pageRelay = relaysFor(machineThatSays("its canvas origin"), (_, fromThisComputer) => fromThisComputer);
    const statusWith = (headers: Record<string, string>) => fetch(`${pageRelay}/`, { headers }).then(({ status }) => status);
    expect(await statusWith({})).toBe(200);
    expect(await statusWith({ "x-forwarded-for": "100.101.5.7", "x-forwarded-proto": "https" })).toBe(401);
    expect(await statusWith({ "tailscale-user-login": "someone@github" })).toBe(401);
  });

  test("register no service worker of the machine", async () => {
    const canvasRelay = await canvasAssetsOriginTold(relaysFor(machineThatSays("its canvas origin")));
    const response = await fetch(`${canvasRelay}/worker.js`, { headers: { "service-worker": "script" } });
    expect(response.status).toBe(403);
  });

  test("answer only at the relay's own address", async () => {
    const pageRelay = relaysFor(machineThatSays("its canvas origin"));
    const canvasRelay = new URL(await canvasAssetsOriginTold(pageRelay));
    const response = await fetch(`http://localhost:${canvasRelay.port}/d3.min.js`);
    expect([response.status, await response.text()]).toEqual([403, "forbidden host"]);
  });

  test("of a machine of this computer's owner, are asked for only by its own frame, never by another site's page, someone else's machine's, or another port's but for loading the frame", async () => {
    const pageRelay = relaysFor(machineThatSays("its canvas origin"));
    const statusWith = (headers: Record<string, string>, method = "GET") => fetch(`${pageRelay}/`, { method, headers }).then(({ status }) => status);
    expect(await statusWith({ "sec-fetch-site": "cross-site", "sec-fetch-mode": "no-cors", "sec-fetch-dest": "script" })).toBe(403);
    expect(await statusWith({ "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "iframe" })).toBe(403);
    expect(await statusWith({ "sec-fetch-site": "same-site", "sec-fetch-mode": "no-cors", "sec-fetch-dest": "image" })).toBe(403);
    expect(await statusWith({ "sec-fetch-site": "same-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "iframe" }, "POST")).toBe(403);
    expect(await statusWith({ "sec-fetch-site": "same-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "iframe" })).toBe(200);
    expect(await statusWith({ "sec-fetch-site": "same-origin", "sec-fetch-mode": "cors", "sec-fetch-dest": "empty" })).toBe(200);
    expect(await statusWith({ "sec-fetch-site": "none", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" })).toBe(200);
    expect(await statusWith({})).toBe(200);
  });

  test("of a machine of this computer's owner, may be framed only by this host's own page, and in frames of that machine's own page", async () => {
    const pageRelay = relaysFor(machineThatSays("its canvas origin"));
    const response = await fetch(`${pageRelay}/`, { headers: { "sec-fetch-site": "same-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "iframe" } });
    expect(response.headers.get("content-security-policy")).toBe("frame-ancestors 'self' http://127.0.0.1:4600 http://localhost:4600");
  });

  test("come from this computer's own canvas server for a machine too old to say where its are", async () => {
    expect(await canvasAssetsOriginTold(relaysFor(machineThatSays("nothing about it")))).toBe("http://127.0.0.1:4601");
  });

  test("only relay GET, HEAD, and OPTIONS requests on the canvas relay", async () => {
    const canvasRelay = await canvasAssetsOriginTold(relaysFor(machineThatSays("its canvas origin")));
    expect((await fetch(`${canvasRelay}/d3.min.js`, { method: "POST", body: "x" })).status).toBe(405);
    expect((await fetch(`${canvasRelay}/d3.min.js`, { method: "DELETE" })).status).toBe(405);
    expect((await fetch(`${canvasRelay}/d3.min.js`, { method: "HEAD" })).status).toBe(200);
  });

  test("never let an address-joined machine steer the canvas relay to another host, loopback, or metadata IP", () => {
    const personMachine = { origin: "https://theirs.example:4610", asPerson: true };
    expect(allowedCanvasOrigin(personMachine, "https://theirs.example:4611")).toBe("https://theirs.example:4611");
    expect(allowedCanvasOrigin(personMachine, "http://theirs.example:4611")).toBeNull();
    expect(allowedCanvasOrigin(personMachine, "http://127.0.0.1:4600")).toBeNull();
    expect(allowedCanvasOrigin(personMachine, "http://169.254.169.254")).toBeNull();
    expect(allowedCanvasOrigin(personMachine, "https://canvas.theirs.example")).toBeNull();

    const ownMachine = { origin: "https://mirador.example.com", asPerson: false };
    expect(allowedCanvasOrigin(ownMachine, "https://canvas.example.com")).toBe("https://canvas.example.com");
    expect(allowedCanvasOrigin(ownMachine, "https://127.0.0.1:4601")).toBeNull();
    expect(allowedCanvasOrigin(ownMachine, "https://169.254.169.254")).toBeNull();
    expect(allowedCanvasOrigin(ownMachine, "http://canvas.example.com")).toBeNull();
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

  test("never lets the machine clear what the browser keeps for 127.0.0.1, this host's sign-in with it", () => {
    const upstream = new Headers({ "clear-site-data": '"cookies", "storage", "cache"', "content-type": "text/html" });
    expect(Object.fromEntries(relayedHeaders(upstream, machine, "http://127.0.0.1:4620"))).toEqual({ "content-type": "text/html" });
  });

  test("keeps the redirects of a machine joined as a person under the relay's key, whether they name its address or only a path", () => {
    const keyPath = "/the-relay-key";
    expect(relayedHeaders(new Headers({ location: `${machine}/` }), machine, "http://127.0.0.1:4620", keyPath).get("location")).toBe("http://127.0.0.1:4620/the-relay-key/");
    expect(relayedHeaders(new Headers({ location: "/#/r/1" }), machine, "http://127.0.0.1:4620", keyPath).get("location")).toBe("/the-relay-key/#/r/1");
    expect(relayedHeaders(new Headers({ location: "//elsewhere.example/" }), machine, "http://127.0.0.1:4620", keyPath).get("location")).toBe("//elsewhere.example/");
  });
});

describe("pathPastKey", () => {
  test("is the rest of a path that starts with the relay's key, and null for any other path or no key", () => {
    expect(pathPastKey("/the-key/ws", "the-key")).toBe("/ws");
    expect(pathPastKey("/the-key/", "the-key")).toBe("/");
    expect(pathPastKey("/the-key", "the-key")).toBe("/");
    expect(pathPastKey("/the-kez/ws", "the-key")).toBeNull();
    expect(pathPastKey("/ws", "the-key")).toBeNull();
    expect(pathPastKey("/the-key/ws", null)).toBeNull();
  });
});

describe("a machine this computer joined as a person", () => {
  const pageWithItsPolicy = `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; connect-src 'self' blob:; script-src 'self'">`;
  const cleanUps: (() => void)[] = [];
  afterEach(() => cleanUps.splice(0).forEach((cleanUp) => cleanUp()));
  const relayKey = "k".repeat(43);

  /** Someone else's machine, which says what it was asked; its socket says the cookie it opened with. */
  function someoneElsesMachine({ joinedAs = "person" as "person" | "device" } = {}) {
    const asked: { path: string; cookie: string | null; method: string }[] = [];
    const server = Bun.serve<string | null>({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request, server) => {
        const url = new URL(request.url);
        if (url.pathname === "/mirador-here") return Response.json({ mirador: true });
        if (request.headers.get("upgrade") && server.upgrade(request, { data: request.headers.get("cookie") })) return undefined;
        asked.push({ path: `${url.pathname}${url.search}`, cookie: request.headers.get("cookie"), method: request.method });
        if (url.pathname === "/gone") return new Response("unauthorized", { status: 401 });
        if (url.pathname === "/moved") return new Response(null, { status: 302, headers: { location: "/#/r/1" } });
        if (url.pathname === "/page") return new Response(pageWithItsPolicy, { headers: { "content-type": "text/html;charset=utf-8" } });
        return new Response("from the machine", { headers: { "clear-site-data": '"*"', "set-cookie": "mirador_token=theirs" } });
      },
      websocket: { open: (socket) => void socket.send(`cookie ${socket.data}`), message: () => {} },
    });
    const [relayPort, canvasPort] = freePorts(2) as [number, number];
    const store = new Store(":memory:");
    store.insertMachine({ id: "theirs", name: "Theirs", origin: `http://127.0.0.1:${server.port}`, createdAt: 1 });
    store.setMachineDeviceToken("theirs", "person-device-token");
    store.setMachineJoinedAs("theirs", joinedAs === "person" ? { asPerson: true, relayKey } : { asPerson: false });
    const signedOut: string[] = [];
    const relays = new MachineRelays(store, [relayPort, canvasPort], "http://127.0.0.1:4601", THIS_HOSTS_PAGES, () => false, () => {}, (machineId) => signedOut.push(machineId), unusedOwnerKey);
    relays.startAll();
    cleanUps.push(() => relays.stopAll(), () => server.stop(true));
    return { asked, signedOut, relay: `http://127.0.0.1:${relayPort}`, store };
  }

  test("signs in only what asks under the relay's key, without this host's cookie, from the opaque origin its frame runs in", async () => {
    const { asked, relay } = someoneElsesMachine();
    const response = await fetch(`${relay}/${relayKey}/?x=1`, { headers: { origin: "null" } });
    expect([response.status, response.headers.get("access-control-allow-origin"), await response.text()]).toEqual([200, "*", "from the machine"]);
    expect(response.headers.has("clear-site-data") || response.headers.has("set-cookie")).toBe(false);
    expect(asked).toEqual([{ path: "/?x=1", cookie: "mirador_token=person-device-token", method: "GET" }]);
  });

  test("lets the machine's page fetch from the relay it came from, which WebKit does not count as 'self' in an opaque origin, and nothing more", async () => {
    const { relay } = someoneElsesMachine();
    const page = await (await fetch(`${relay}/${relayKey}/page`, { headers: { origin: "null" } })).text();
    expect(page).toBe(pageWithItsPolicy.replace("connect-src 'self' blob:", `connect-src 'self' ${relay} blob:`));
    expect(await (await fetch(`${relay}/page`)).text()).toBe(pageWithItsPolicy);
  });

  test("serves the machine's pages sandboxed in an opaque origin wherever they open, as in their frame, under the key and at bare paths alike", async () => {
    const { relay } = someoneElsesMachine();
    for (const path of [`/${relayKey}/page`, "/page", "/chunk-abc.js"]) {
      const response = await fetch(`${relay}${path}`, { headers: { origin: "null" } });
      expect({ path, policy: response.headers.get("content-security-policy") }).toEqual({ path, policy: "sandbox allow-scripts allow-forms" });
    }
  });

  test("serves the page's bundle at bare paths signed in as nobody, and nothing else there", async () => {
    const { asked, relay } = someoneElsesMachine();
    const bundle = await fetch(`${relay}/chunk-abc.js`, { headers: { origin: "null", cookie: "mirador_token=this-hosts-own" } });
    expect([bundle.status, bundle.headers.get("access-control-allow-origin")]).toEqual([200, "*"]);
    expect(asked).toEqual([{ path: "/chunk-abc.js", cookie: null, method: "GET" }]);
    expect((await fetch(`${relay}/${"j".repeat(43)}/`)).status).toBe(200);
    expect(asked.at(-1)).toEqual({ path: `/${"j".repeat(43)}/`, cookie: null, method: "GET" });
    expect((await fetch(`${relay}/anything`, { method: "POST", body: "{}" })).status).toBe(401);
    expect(asked).toHaveLength(2);
  });

  test("opens the machine's socket signed in only under the key", async () => {
    const { relay } = someoneElsesMachine();
    const socketAt = (path: string) =>
      new Promise<string>((resolve) => {
        const socket = new WebSocket(`${relay.replace("http", "ws")}${path}`, { headers: { origin: "null" } } as unknown as string[]);
        socket.onmessage = (event) => resolve(String(event.data));
        socket.onerror = () => resolve("refused");
      });
    expect(await socketAt(`/${relayKey}/ws`)).toBe("cookie mirador_token=person-device-token");
    expect(await socketAt("/ws")).toBe("refused");
  });

  test("turns away pages of any other origin, this computer's own included", async () => {
    const { asked, relay } = someoneElsesMachine();
    for (const origin of ["http://127.0.0.1:4600", `${relay}`, "https://elsewhere.example"]) {
      expect((await fetch(`${relay}/${relayKey}/`, { headers: { origin } })).status).toBe(403);
    }
    expect(asked).toEqual([]);
  });

  test("never joins for the machine's page, which could join this computer to anything", async () => {
    const { asked, relay } = someoneElsesMachine();
    const join = await fetch(`${relay}/${relayKey}/join`, { method: "POST", headers: { origin: "null", "content-type": "application/json" }, body: JSON.stringify({ code: "ABCD-EFGH-JKLM" }) });
    expect(join.status).toBe(403);
    expect((await fetch(`${relay}/${relayKey}/join-requests`, { method: "POST", headers: { origin: "null" } })).status).toBe(403);
    expect(asked).toEqual([]);
  });

  test("keeps the machine's redirects under the key", async () => {
    const { relay } = someoneElsesMachine();
    const moved = await fetch(`${relay}/${relayKey}/moved`, { redirect: "manual" });
    expect(moved.headers.get("location")).toBe(`/${relayKey}/#/r/1`);
  });

  test("checks whether this computer was signed out there only when what the machine turned away was signed in", async () => {
    const { asked, relay } = someoneElsesMachine();
    await fetch(`${relay}/gone`);
    await Bun.sleep(100);
    expect(asked.map(({ path }) => path)).toEqual(["/gone"]);
    await fetch(`${relay}/${relayKey}/gone`);
    await Bun.sleep(100);
    expect(asked.map(({ path }) => path)).toEqual(["/gone", "/gone", "/ws"]);
  });

  test("a machine joined as a device still needs this host's own cookie", async () => {
    const { asked, relay } = someoneElsesMachine({ joinedAs: "device" });
    expect((await fetch(`${relay}/`)).status).toBe(401);
    expect((await fetch(`${relay}/${relayKey}/`, { headers: { origin: "null" } })).status).toBe(401);
    expect(asked).toEqual([]);
  });

  test("registers no service worker of any machine, whose worker would outlive it at the relay's port", async () => {
    for (const joinedAs of ["person", "device"] as const) {
      const { asked, relay } = someoneElsesMachine({ joinedAs });
      const keyed = await fetch(`${relay}/${relayKey}/worker.js`, { headers: { "service-worker": "script", origin: "null" } });
      const bare = await fetch(`${relay}/worker.js`, { headers: { "service-worker": "script" } });
      expect([joinedAs, keyed.status, bare.status]).toEqual([joinedAs, 403, 403]);
      expect(asked).toEqual([]);
    }
  });
});

describe("a machine reached through a dial's forward", () => {
  const cleanUps: (() => void)[] = [];
  afterEach(() => cleanUps.splice(0).forEach((cleanUp) => cleanUp()));
  const relayKey = "k".repeat(43);
  const places = { hostKey: "TfdU+RVSAYU/VwqNJh5dDtXFyyZCkHgiPG8knt29NU0=", hostAddress: "fd12:3456:789a:1::1", port: 4600, broker: { address: "p2p.example.com:47800", key: "TfdU+RVSAYU/VwqNJh5dDtXFyyZCkHgiPG8knt29NU0=" } };

  const origins = tunnelOriginsOf(places);

  /**
   * Stands in for a dial's sockets, or on Windows its ports on IPv6's loopback, and the machine beyond them, which takes
   * an Origin only of its Host's, as it does through the tunnel, and says what it was asked.
   */
  function forwardToMachine(says: string): { forward: Pick<Forward, "web" | "canvas">; asked: string[] } {
    const folder = mkdtempSync(join(tmpdir(), "mirador-forward-"));
    const asked: string[] = [];
    const refused = (where: string, request: Request) => {
      const origin = request.headers.get("origin");
      if (origin !== null && origin !== `http://${request.headers.get("host")}`) return new Response("forbidden origin", { status: 403 });
      asked.push(`${where} ${new URL(request.url).pathname} ${request.headers.get("cookie")}`);
      return null;
    };
    const sockets = { web: join(folder, "w"), canvas: join(folder, "c") };
    const listeningAt = (socket: string) => (DIALS_THROUGH_SOCKETS ? { unix: socket } : { hostname: "::1", port: 0 });
    const web = Bun.serve({
      ...listeningAt(sockets.web),
      fetch: (request, server) => refused("page", request) ?? (server.upgrade(request) ? undefined : new Response(`${says}'s page`)),
      websocket: { open: (socket) => void socket.send(`${says}'s socket`), message() {} },
    });
    const canvas = Bun.serve({ ...listeningAt(sockets.canvas), fetch: (request) => refused("canvas", request) ?? new Response(`${says}'s canvas`) });
    const wayThrough = (origin: string, socket: string, port?: number) => (DIALS_THROUGH_SOCKETS ? { origin, socket } : atAddress(`http://[::1]:${port}`));
    cleanUps.push(() => {
      [web, canvas].forEach((server) => server.stop(true));
      rmSync(folder, { recursive: true, force: true });
    });
    return { forward: { web: wayThrough(origins.web, sockets.web, web.port), canvas: wayThrough(origins.canvas, sockets.canvas, canvas.port) }, asked };
  }

  function machineThrough(firstForward: Pick<Forward, "web" | "canvas">) {
    const store = new Store(":memory:");
    store.insertMachine({ id: "theirs", name: "Theirs", origin: `http://[${places.hostAddress}]:4600`, createdAt: 1 });
    store.setMachineTunnelPlaces("theirs", places);
    store.setMachineDeviceToken("theirs", "person-device-token");
    store.setMachineJoinedAs("theirs", { asPerson: true, relayKey });
    const dial = { forward: firstForward, running: true };
    const reach: MachineReach = {
      reached: async (machine: Machine) => ({ ...machine, origin: dial.forward.web.origin }),
      stillReaches: () => dial.running,
      wayTo: () => (dial.running ? dial.forward.web : null),
      canvasWayTo: () => (dial.running ? dial.forward.canvas : null),
      dialToJoin: () => Promise.reject(new Error("not joining here")),
      start: () => {},
    };
    const [relayPort, canvasPort] = freePorts(2) as [number, number];
    const signedOut: string[] = [];
    const relays = new MachineRelays(store, [relayPort, canvasPort], "http://127.0.0.1:4601", THIS_HOSTS_PAGES, () => false, () => {}, (machineId) => signedOut.push(machineId), unusedOwnerKey, reach);
    relays.startAll();
    cleanUps.push(() => relays.stopAll());
    return { dial, signedOut, relayPort, relay: `http://127.0.0.1:${relayPort}`, canvasRelay: `http://127.0.0.1:${canvasPort}` };
  }

  test("relays the page's requests and sockets through the dial's socket, signed in and asking for the machine's address in the tunnel", async () => {
    const { forward, asked } = forwardToMachine("Theirs");
    const { relayPort, relay } = machineThrough(forward);
    const page = await fetch(`${relay}/${relayKey}/rooms`, { headers: { origin: "null" } });
    expect(await page.text()).toBe("Theirs's page");
    const BunWebSocket = WebSocket as unknown as new (url: string, options: { headers: Record<string, string> }) => WebSocket;
    const socket = new BunWebSocket(`ws://127.0.0.1:${relayPort}/${relayKey}/ws`, { headers: { Origin: "null" } });
    const first = await new Promise<string>((resolve, reject) => {
      socket.onmessage = ({ data }) => resolve(String(data));
      socket.onclose = () => reject(new Error("the relay closed the socket"));
    });
    socket.close();
    expect(first).toBe("Theirs's socket");
    expect(asked).toEqual(["page /rooms mirador_token=person-device-token", "page /ws mirador_token=person-device-token"]);
  });

  test("serves someone else's machine's canvas sandboxed in an opaque origin, as its pages, wherever it opens", async () => {
    const { forward } = forwardToMachine("Theirs");
    const { canvasRelay } = machineThrough(forward);
    const response = await fetch(`${canvasRelay}/canvas/shell`);
    expect([await response.text(), response.headers.get("content-security-policy")]).toEqual(["Theirs's canvas", "sandbox allow-scripts allow-forms"]);
  });

  test("sends nothing through a forward its dial's process no longer holds: no request, no token", async () => {
    const { forward, asked } = forwardToMachine("Theirs");
    const { dial, relay, canvasRelay, signedOut } = machineThrough(forward);
    dial.running = false;
    expect((await fetch(`${relay}/${relayKey}/gone`, { headers: { origin: "null" } })).status).toBe(502);
    expect((await fetch(`${relay}/app.js`)).status).toBe(502);
    expect((await fetch(`${canvasRelay}/d3.min.js`)).status).toBe(502);
    await Bun.sleep(100);
    expect(asked).toEqual([]);
    expect(signedOut).toEqual([]);
  });

  test("sends the invite's code through the joining dial's forward only while its process holds it", async () => {
    const posted: string[] = [];
    const machine = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request) => {
        if (request.method === "POST") posted.push(new URL(request.url).pathname);
        return Response.json({ mirador: true });
      },
    });
    cleanUps.push(() => machine.stop(true));
    const store = new Store(":memory:");
    store.insertMachine({ id: "theirs", name: "Theirs", origin: `http://[${places.hostAddress}]:4600`, createdAt: 1 });
    store.setMachineTunnelPlaces("theirs", places);
    let stopped = false;
    const exited: Forward = { web: atAddress(`http://127.0.0.1:${machine.port}`), canvas: atAddress("http://127.0.0.1:1"), running: false };
    const reach: MachineReach = {
      reached: async () => null,
      stillReaches: () => false,
      wayTo: () => null,
      canvasWayTo: () => null,
      dialToJoin: async () => ({ forward: Promise.resolve(exited), stop: () => (stopped = true) }),
      start: () => {},
    };
    const relays = new MachineRelays(store, [], "http://127.0.0.1:4601", THIS_HOSTS_PAGES, () => true, () => {}, () => {}, unusedOwnerKey, reach);
    const invite = { ...places, joinKey: places.hostKey, joinAddress: "fd12:3456:789a:1::9" };
    await expect(relays.join("theirs", "ROOM-ABCD-EFGH-JKLM", null, invite)).rejects.toThrow("Theirs can't be reached right now.");
    expect(posted).toEqual([]);
    expect(stopped).toBe(true);
  });

  test("takes no device invite's code through the tunnel of a machine its owner joined as a person, and says to add the machine again with it, dialing nothing", async () => {
    const store = new Store(":memory:");
    store.insertMachine({ id: "theirs", name: "Theirs", origin: `http://[${places.hostAddress}]:4600`, createdAt: 1 });
    store.setMachineTunnelPlaces("theirs", places);
    store.setMachineJoinedAs("theirs", { asPerson: true, relayKey: null });
    let dialed = 0;
    let stopped = 0;
    const reach: MachineReach = {
      reached: async () => null,
      stillReaches: () => false,
      wayTo: () => null,
      canvasWayTo: () => null,
      dialToJoin: async () => {
        dialed += 1;
        return { forward: Promise.reject(new HostProblemError({ code: "peer-to-peer-did-not-start-here", environmentBinary: "/opt/mirador-p2p" })), stop: () => (stopped += 1) };
      },
      start: () => {},
    };
    const relays = new MachineRelays(store, [], "http://127.0.0.1:4601", THIS_HOSTS_PAGES, () => true, () => {}, () => {}, unusedOwnerKey, reach);
    const invite = { ...places, joinKey: places.hostKey, joinAddress: "fd12:3456:789a:1::9" };
    expect(await relays.join("theirs", "ABCD-EFGH-JKLM", null, invite).catch((error) => (error as HostProblemError).problem)).toEqual({ code: "machine-joined-as-person", machine: "Theirs" });
    await expect(relays.join("theirs", "ABCD-EFGH-JKLM")).rejects.toThrow("remove Theirs under Machines, and add it again with the device invite");
    expect(dialed).toBe(0);
    expect(store.machineDeviceToken("theirs")).toBeNull();

    store.setMachineJoinedAs("theirs", { asPerson: false });
    expect(await relays.join("theirs", "ABCD-EFGH-JKLM", null, invite).catch((error) => (error as HostProblemError).problem)).toEqual({ code: "peer-to-peer-did-not-start-here", environmentBinary: "/opt/mirador-p2p" });
    expect({ dialed, stopped }).toEqual({ dialed: 1, stopped: 1 });
  });

  test("loads canvas pages through the canvas socket of the forward the machine is reached through now, which moves each time its dial starts again", async () => {
    const [before, after] = [forwardToMachine("Before"), forwardToMachine("After")];
    const { dial, canvasRelay } = machineThrough(before.forward);
    expect(await (await fetch(`${canvasRelay}/d3.min.js`)).text()).toBe("Before's canvas");
    dial.forward = after.forward;
    expect(await (await fetch(`${canvasRelay}/d3.min.js`)).text()).toBe("After's canvas");
    expect(before.asked).toEqual(["canvas /d3.min.js null"]);
  });
});

describe("a request to a machine through a forward", () => {
  test("fails once the machine has not started answering in time, as a forward takes it at once even with the machine gone", async () => {
    const silent = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
    try {
      const startedAt = Date.now();
      expect(await fetchAnswered(atAddress(`http://127.0.0.1:${silent.port}`), "/", {}, 200)).toBeNull();
      expect(Date.now() - startedAt).toBeLessThan(2000);
    } finally {
      silent.stop(true);
    }
  });

  test("takes as long as it takes to send the answer's body once the machine started answering", async () => {
    const slowBody = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () =>
        new Response(
          new ReadableStream({
            async start(controller) {
              controller.enqueue(new TextEncoder().encode("first "));
              await Bun.sleep(400);
              controller.enqueue(new TextEncoder().encode("last"));
              controller.close();
            },
          }),
        ),
    });
    try {
      const response = await fetchAnswered(atAddress(`http://127.0.0.1:${slowBody.port}`), "/", {}, 200);
      expect(await response?.text()).toBe("first last");
    } finally {
      slowBody.stop(true);
    }
  });
});

describe("relay ports", () => {

  test("keep a machine on its port from before, and move it into the range the desktop app lets its window load", () => {
    const [kept, inRange, outside] = freePorts(3) as [number, number, number];
    const store = new Store(":memory:");
    store.insertMachine({ id: "kept", name: "Kept", origin: "https://kept.example", createdAt: 1 });
    store.insertMachine({ id: "moved", name: "Moved", origin: "https://moved.example", createdAt: 2 });
    store.setMachineRelayPort("kept", kept);
    store.setMachineRelayPort("moved", outside);
    const relays = new MachineRelays(store, [inRange, kept], "http://127.0.0.1:4601", THIS_HOSTS_PAGES, () => true, () => {}, () => {}, unusedOwnerKey);
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
    const relays = new MachineRelays(store, [relayPort], "http://127.0.0.1:4601", THIS_HOSTS_PAGES, () => true, () => {}, () => {}, unusedOwnerKey);
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
    const relays = new MachineRelays(store, [], "http://127.0.0.1:4601", THIS_HOSTS_PAGES, () => true, () => {}, () => {}, unusedOwnerKey);
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

  test("from a link whose tunnel this computer can't dial, trusts the machine's own authority only by the link's fingerprint, never on first use", async () => {
    const machine = machineOnTheNetwork();
    await expect(machine.join("NO-FINGERPRINT", null, null, { trustsOnFirstUse: false })).rejects.toThrow(
      "This invite link reaches Box peer to peer, and doesn't say which certificate to expect at its address, so the code was not sent there.",
    );
    expect(machine.codesReceived).toEqual([]);
    await machine.join("WITH-FINGERPRINT", authorityFingerprint(machine.authority), null, { trustsOnFirstUse: false });
    expect(machine.codesReceived).toEqual(["WITH-FINGERPRINT"]);
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

    await new MachineRelays(store, [], "http://127.0.0.1:4601", THIS_HOSTS_PAGES, () => true, () => {}, () => {}, unusedOwnerKey).askToJoin("box", (number) => void requests.approve(requests.waiting()[0]!.id, number));
    expect(store.machineAuthority("box")).toBe(certificate.authority);
    expect(machineStore.listDevices().map(({ name }) => name)).toEqual([expect.stringMatching(/^Mirador on /)]);
  });

  /** A machine whose invite is a room invite: it challenges whoever has the code, and records what joining sends, and what else it is asked. */
  function roomInviteMachine(challenge: unknown, answers: Record<string, unknown>[] = []) {
    const joins: Record<string, unknown>[] = [];
    const otherRequests: string[] = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      routes: {
        "/join-challenges": { POST: () => Response.json({ challenge }) },
        "/join": {
          POST: async (request) => {
            joins.push((await request.json()) as Record<string, unknown>);
            return Response.json({ token: "person-device-token", ...answers.shift() });
          },
        },
      },
      fetch: (request) => {
        otherRequests.push(new URL(request.url).pathname);
        return new Response("join page", { status: 404 });
      },
    });
    cleanUps.push(() => server.stop(true));
    const dataDir = mkdtempSync(join(tmpdir(), "mirador-owner-key-"));
    cleanUps.push(() => rmSync(dataDir, { recursive: true, force: true }));
    const store = new Store(":memory:");
    store.insertMachine({ id: "box", name: "Box", origin: `http://127.0.0.1:${server.port}`, createdAt: 1 });
    const key = ownerKey(dataDir);
    return { joins, otherRequests, store, key, host: `127.0.0.1:${server.port}`, relays: new MachineRelays(store, [], "http://127.0.0.1:4601", THIS_HOSTS_PAGES, () => true, () => {}, () => {}, key) };
  }

  test("never joins as one of the owner's devices with a room invite's code, though the machine does not challenge it", async () => {
    const { joins, store, relays } = roomInviteMachine("not a challenge");

    for (const code of ["ROOM-ABCD-EFGH-JKLM", "room abcd efgh jklm"]) {
      expect(await relays.join("box", code).catch((error) => (error as HostProblemError).problem)).toEqual({ code: "machine-ignored-room-invite", machine: "Box" });
    }
    expect(joins).toEqual([]);
    expect(store.machineDeviceToken("box")).toBeNull();
    expect(store.findMachine("box")).toMatchObject({ asPerson: false });
  });

  test("joins a room invite's room as this computer's owner, by the owner's key signed over the machine's challenge, the invite, the machine's address and the authority it trusts there", async () => {
    const challenge = newChallenge();
    const { joins, store, key, host, relays } = roomInviteMachine(challenge);
    store.setPersonProfile(store.ownerId(), { name: "Dora", color: "mint" });
    store.setMachineOutOfRooms("box", true);
    store.setMachineHostId("box", "an-id-the-machine-said");

    await relays.join("box", "ABCD-EFGH-JKLM");
    const { person } = joins[0] as { person: { publicKey: string; name: string; color: string; challenge: string; signature: string } };
    expect(person).toMatchObject({ publicKey: key.publicKey, name: "Dora", color: "mint", challenge });
    const signed = { challenge: person.challenge, inviteKey: inviteKey("ABCD-EFGH-JKLM"), host, authorityFingerprint: NO_AUTHORITY, publicKey: key.publicKey };
    expect(signedRoomJoin(signed, person.signature)).toBe(true);
    expect(signedRoomJoin({ ...signed, host: host.replace("127.0.0.1", "localhost") }, person.signature)).toBe(false);
    expect(signedRoomJoin({ ...signed, authorityFingerprint: "someone-in-between" }, person.signature)).toBe(false);
    expect(store.machineDeviceToken("box")).toBe("person-device-token");
    expect(store.findMachine("box")).toMatchObject({ outOfRooms: false, asPerson: true, relayKey: expect.stringMatching(/^[\w-]{43}$/), hostId: null });
  });

  test("keeps the key its page is shown at as another room of the machine is joined, and takes a new one once the machine signed this computer out", async () => {
    const { relays, store } = roomInviteMachine(newChallenge());
    const keyAfterJoining = async () => {
      await relays.join("box", "ABCD-EFGH-JKLM");
      return store.findMachine("box")!.relayKey;
    };
    const first = await keyAfterJoining();
    expect(await keyAfterJoining()).toBe(first);
    store.forgetMachineDeviceToken("box");
    const afterSignOut = await keyAfterJoining();
    expect(afterSignOut).toMatch(/^[\w-]{43}$/);
    expect(afterSignOut).not.toBe(first);
  });

  test("waits at the door of a room whose invite asks its owner's OK, in place of where it stood there before, and stands at none of a room it went straight into", async () => {
    const { relays, store } = roomInviteMachine(newChallenge(), [
      { roomId: "r1", waiting: true },
      { roomId: "r2", waiting: true },
      { roomId: "r2", waiting: false },
      { roomId: "../x", waiting: true },
    ]);
    store.setMachineKnocks("box", [{ roomId: "r1", turnedAway: true }]);
    ["r1", "r2", "r3"].forEach((roomId) => store.setJoinedRoomLeft("box", roomId, true));

    expect(await relays.join("box", "ABCD-EFGH-JKLM")).toEqual({ roomId: "r1", waiting: true });
    expect(await relays.join("box", "ABCD-EFGH-JKLN")).toEqual({ roomId: "r2", waiting: true });
    expect(store.findMachine("box")?.knocks).toEqual([
      { roomId: "r1", turnedAway: false },
      { roomId: "r2", turnedAway: false },
    ]);
    expect(await relays.join("box", "ABCD-EFGH-JKLP")).toEqual({ roomId: "r2", waiting: false });
    expect(await relays.join("box", "ABCD-EFGH-JKLQ")).toEqual({ roomId: null, waiting: false });
    expect(store.findMachine("box")?.knocks).toEqual([{ roomId: "r1", turnedAway: false }]);
    expect(store.joinedRoomsLeft("box")).toEqual(["r3"]);
  });

  test("signs nothing for a machine whose challenge is not one a Mirador makes, such as text that runs over more lines, and joins it as a device", async () => {
    const { joins, relays, store } = roomInviteMachine(`${newChallenge()}\nother.example:4600`);
    await relays.join("box", "ABCD-EFGH-JKLM");
    expect(joins).toEqual([{ code: "ABCD-EFGH-JKLM", name: expect.stringMatching(/^Mirador on /) }]);
    expect(store.findMachine("box")).toMatchObject({ asPerson: false, relayKey: null });
  });

  test("once joined as a person, sends no code to the machine when it skips the challenge, which would make this computer its owner's device", async () => {
    const { joins, relays, store } = roomInviteMachine(undefined);
    store.setMachineJoinedAs("box", { asPerson: true, relayKey: null });
    await expect(relays.join("box", "ABCD-EFGH-JKLM")).rejects.toThrow("This computer joins Box as a person in its rooms, so only a room invite's code lets it in there");
    expect(joins).toEqual([]);
    expect(store.machineDeviceToken("box")).toBeNull();
  });

  test("with a link that carries the machine's tunnel, sends the code to the machine's address only where nothing on the way reads it, as pasting the link under Machines does", async () => {
    const { joins, relays, store } = roomInviteMachine(newChallenge());
    const key = "TfdU+RVSAYU/VwqNJh5dDtXFyyZCkHgiPG8knt29NU0=";
    const tunnel = { hostKey: key, hostAddress: "fd12:3456:789a:1::1", port: 4600, broker: { address: "p2p.example.com:47800", key }, joinKey: key, joinAddress: "fd12:3456:789a:1::9" };
    store.insertMachine({ id: "far", name: "Far", origin: "http://203.0.113.7:4600", createdAt: 2 });
    expect(await relays.join("far", "ROOM-ABCD-EFGH-JKLM", null, tunnel).catch((error) => (error as HostProblemError).problem)).toEqual({
      code: "invite-address-unprotected",
      address: "http://203.0.113.7:4600",
    });
    expect(store.machineDeviceToken("far")).toBeNull();
    await relays.join("box", "ROOM-ABCD-EFGH-JKLM", null, tunnel);
    expect(joins).toHaveLength(1);
  });

  test("never asks to join a machine it joins as a person, which would make this computer its owner's device", async () => {
    const { otherRequests, relays, store } = roomInviteMachine(newChallenge());
    store.setMachineJoinedAs("box", { asPerson: true, relayKey: null });
    await expect(relays.askToJoin("box", () => {})).rejects.toThrow("This computer joins Box as a person in its rooms");
    expect(otherRequests).toEqual([]);
    expect(store.machineDeviceToken("box")).toBeNull();
  });

  /** A machine that turns every join away, answering its challenge and its join with these. */
  function refusingMachine(refusal: () => Response) {
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, routes: { "/join-challenges": { POST: refusal }, "/join": { POST: refusal } }, fetch: () => new Response("join page") });
    cleanUps.push(() => server.stop(true));
    const store = new Store(":memory:");
    store.insertMachine({ id: "box", name: "Box", origin: `http://127.0.0.1:${server.port}`, createdAt: 1 });
    const relays = new MachineRelays(store, [], "http://127.0.0.1:4601", THIS_HOSTS_PAGES, () => true, () => {}, () => {}, unusedOwnerKey);
    const refusedWith = (code: string) => relays.join("box", code).then(() => null, (error: Error) => (error instanceof HostProblemError ? error.problem : error.message));
    return { store, refusedWith };
  }

  test("says why the machine turned a code away in this computer's own words, a used or expired invite's alike, whether it was a room invite's or not", async () => {
    const { store, refusedWith } = refusingMachine(() => problemResponse({ code: "invite-code-wrong" }, 404));
    expect(await refusedWith("ROOM-ABCD-EFGH-JKLM")).toEqual({ code: "invite-code-wrong" });
    expect(await refusedWith("ABCD-EFGH-JKLM")).toEqual({ code: "invite-code-wrong" });
    expect(store.machineDeviceToken("box")).toBeNull();
  });

  test("takes from the machine no problem but a join's refusal, nor anything it adds to one, keeping its own words for anything else", async () => {
    const naming = (problem: Record<string, unknown>) => () => problemResponse(problem as HostProblem, 403, "the machine's own words");
    expect(await refusingMachine(naming({ code: "workspace-gone" })).refusedWith("ROOM-ABCD-EFGH-JKLM")).toEqual({ code: "machine-ignored-room-invite", machine: "Box" });
    expect(await refusingMachine(naming({ code: "workspace-gone" })).refusedWith("ABCD-EFGH-JKLM")).toBe("the machine's own words");
    expect(await refusingMachine(naming({ code: "join-too-often", more: "a link to click" })).refusedWith("ABCD-EFGH-JKLM")).toEqual({ code: "join-too-often" });
    expect(joinRefusalIn(new Response("no problem named", { status: 403 }))).toBeNull();
  });
});
