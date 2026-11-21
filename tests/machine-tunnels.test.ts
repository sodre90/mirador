import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { DIRECT_REACH, MachineTunnels } from "../host/machine-tunnels.ts";
import {
  Dial,
  dialCommand,
  dialProgram,
  fetchThrough,
  freeLoopbackPortPair,
  loopbackPortsInNetstat,
  socketFolderProblem,
  stopLeftOverDials,
  tunnelOriginsOf,
  webSocketTo,
  type ForwardsFrom,
} from "../host/p2p/dial.ts";
import { Store } from "../host/store.ts";
import type { TunnelPlaces } from "../shared/tunnel.ts";

const places: TunnelPlaces = {
  hostKey: "TfdU+RVSAYU/VwqNJh5dDtXFyyZCkHgiPG8knt29NU0=",
  hostAddress: "fd12:3456:789a:1::1",
  port: 4600,
  canvasPort: 4601,
  broker: { address: "p2p.example.com:47800", key: "HoWT5mQ7kKjL3KZ3vX2bq1c7m6y9c0iY1Zr0sK2xS0o=" },
};
const PRIVATE_KEY = "kHbGJ6r8Pz2oA0y7m2n0XyY3l4uJmJmJ9mQe8k1n2Xo=";

const cleanUp: (() => void)[] = [];
afterEach(() => cleanUp.splice(0).reverse().forEach((step) => step()));

function folder() {
  const made = mkdtempSync(join(tmpdir(), "mirador-dials-"));
  cleanUp.push(() => rmSync(made, { recursive: true, force: true }));
  return made;
}

/**
 * Stands in for mirador-p2p: it listens at every forward it is given, as the real one does, a Unix socket with
 * `socketMode`, and answers there as the machine would through the tunnel, saying the Host it was asked with. Like the
 * real one, it takes its sockets away when it is stopped.
 */
function fakeDialBinary(at: string, { socketMode = 0o600 } = {}) {
  const path = join(at, `fake-mirador-p2p-${socketMode.toString(8)}`);
  writeFileSync(
    path,
    `#!/usr/bin/env bun
import { chmodSync, rmSync } from "node:fs";
const answer = (request) => Response.json({ mirador: true, host: request.headers.get("host") });
const forwards = process.argv.flatMap((argument) => /^--forward=(.+)=\\d+$/.exec(argument)?.slice(1) ?? []);
const sockets = forwards.flatMap((from) => /^unix:(.+)$/.exec(from)?.slice(1) ?? []);
process.on("SIGTERM", () => {
  sockets.forEach((socket) => rmSync(socket, { force: true }));
  process.exit(0);
});
forwards.forEach((from) => {
  const socket = /^unix:(.+)$/.exec(from)?.[1];
  if (socket) {
    Bun.serve({ unix: socket, fetch: answer });
    chmodSync(socket, ${socketMode});
  } else {
    const [, hostname, port] = /^\\[(.+)\\]:(\\d+)$/.exec(from);
    Bun.serve({ hostname, port: Number(port), fetch: answer });
  }
});
`,
  );
  chmodSync(path, 0o755);
  return path;
}

/** A listener of someone else's at a forward's socket or port, which says what it was asked and turns everyone away. */
function listenerAt(where: { unix: string } | { hostname: string; port: number }, asked: string[]) {
  const server = Bun.serve({
    ...where,
    fetch: (request) => {
      asked.push(`${new URL(request.url).pathname} ${request.headers.get("cookie")}`);
      return new Response("unauthorized", { status: 401 });
    },
  });
  cleanUp.push(() => server.stop(true));
  return server;
}

const ORIGINS = tunnelOriginsOf(places);

const pidIn = (pidFile: string) => (JSON.parse(readFileSync(pidFile, "utf8")) as { pid: number }).pid;

const isRunning = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function eventually(check: () => void | Promise<void>, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await check();
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await Bun.sleep(50);
    }
  }
}

const socketFolderOf = (from: ForwardsFrom | undefined) => (from && "sockets" in from ? dirname(from.sockets.web) : null);

describe("dialCommand", () => {
  test("gives each value with its own flag in one argument, never the private key, and forwards from the dial's own Unix sockets", () => {
    const from = { sockets: { web: "/data/dials/dAbc123/w", canvas: "/data/dials/dAbc123/c" } };
    expect(dialCommand("/bin/mirador-p2p", { keyFile: "/data/dials/a.key", address: "fd12:3456:789a:1:2:3:4:5", places, from })).toEqual([
      "/bin/mirador-p2p",
      "dial",
      "--udp=0.0.0.0:0",
      "--key-file=/data/dials/a.key",
      "--address=fd12:3456:789a:1:2:3:4:5",
      `--peer=${places.hostKey}`,
      "--peer-address=fd12:3456:789a:1::1",
      "--broker=p2p.example.com:47800",
      `--broker-key=${places.broker.key}`,
      "--forward=unix:/data/dials/dAbc123/w=4600",
      "--forward=unix:/data/dials/dAbc123/c=4601",
    ]);
  });

  test("on Windows forwards from a port on IPv6's loopback and the one above it", () => {
    expect(dialCommand("p2p", { keyFile: "k", address: "fd12::5", places, from: { port: 41000 } }).slice(-2)).toEqual(["--forward=[::1]:41000=4600", "--forward=[::1]:41001=4601"]);
  });

  test("forwards to the canvas port even when the machine names none, so it never reaches whatever else listens there", () => {
    const { canvasPort: _canvasPort, ...withoutCanvas } = places;
    expect(dialCommand("p2p", { keyFile: "k", address: "fd12::5", places: withoutCanvas, from: { port: 41000 } }).at(-1)).toBe("--forward=[::1]:41001=4601");
    expect(tunnelOriginsOf(withoutCanvas).canvas).toBe("http://[fd12:3456:789a:1::1]:4601");
  });
});

test("dials with the environment's binary, else the downloaded one, and with none where neither is", () => {
  const download = { url: "https://example.com/p2p", sha256: "abc" };
  expect(dialProgram({ MIRADOR_P2P_BINARY: "/opt/p2p" }, { path: "/data/p2p/bin/p2p", download })).toEqual({ path: "/opt/p2p" });
  expect(dialProgram({}, { path: "/data/p2p/bin/p2p", download })).toEqual({ path: "/data/p2p/bin/p2p", download });
  expect(dialProgram({}, null)).toBeNull();
});

describe("the ways to a machine", () => {
  const way = { origin: "http://[fd12:3456:789a:1::1]:4600", socket: "/data/dials/dAbc123/w" };

  test("a WebSocket through a socket names the machine's address as its Host, as the machine wants an Origin of its Host's", () => {
    const { url, headers } = webSocketTo(way, "/ws?x=1", { Origin: way.origin, Cookie: "mirador_token=t" });
    expect(url).toBe("ws+unix:///data/dials/dAbc123/w:/ws?x=1");
    expect(Object.fromEntries(headers)).toEqual({ host: "[fd12:3456:789a:1::1]:4600", origin: way.origin, cookie: "mirador_token=t" });
  });

  test("a WebSocket's path that would lead off the machine's socket is never asked for", () => {
    expect(() => webSocketTo(way, "/../c:/x", {})).toThrow(/off the machine's socket/);
    expect(() => webSocketTo(way, "/%2e%2e/%2e%2e/elsewhere:/x", {})).toThrow(/off the machine's socket/);
  });

  test.skipIf(process.platform === "win32")("a redirect through a socket is handed back, not followed off the socket with the cookie", async () => {
    const folder = mkdtempSync("/tmp/md-");
    cleanUp.push(() => rmSync(folder, { recursive: true, force: true }));
    const asked: string[] = [];
    const server = Bun.serve({ unix: join(folder, "w"), fetch: (request) => (asked.push(new URL(request.url).pathname), new Response(null, { status: 307, headers: { location: "/elsewhere" } })) });
    cleanUp.push(() => server.stop(true));
    const response = await fetchThrough({ origin: "http://127.0.0.1:9", socket: join(folder, "w") }, "/ws", { headers: { cookie: "mirador_token=t" } });
    expect(response.status).toBe(307);
    expect(asked).toEqual(["/ws"]);
  });

  test("a WebSocket at an address goes there, with only the headers it was given", () => {
    const { url, headers } = webSocketTo({ origin: "https://home.example", socket: null }, "/ws", { Origin: "https://home.example" });
    expect(url).toBe("wss://home.example/ws");
    expect(Object.fromEntries(headers)).toEqual({ origin: "https://home.example" });
  });

  test.skipIf(process.platform === "win32")("Bun's WebSocket reaches a socket in a folder that dials may use, and not one in a folder they may not", async () => {
    const shortBase = mkdtempSync("/tmp/md-");
    cleanUp.push(() => rmSync(shortBase, { recursive: true, force: true }));
    const opensThrough = async (name: string) => {
      const dir = join(shortBase, name);
      mkdirSync(dir);
      const socket = join(dir, "w");
      const server = Bun.serve({ unix: socket, fetch: (request, at) => (at.upgrade(request) ? undefined : new Response("no")), websocket: { message() {} } });
      cleanUp.push(() => server.stop(true));
      const opened = await new Promise<boolean>((resolve) => {
        const { url, headers } = webSocketTo({ ...way, socket }, "/ws", {});
        const client = new WebSocket(url, { headers } as unknown as string[]);
        client.onopen = () => (client.close(), resolve(true));
        client.onerror = () => resolve(false);
      }).catch(() => false);
      return { allowed: socketFolderProblem(dir) === null, opened };
    };
    expect(await opensThrough("m&m's[old]+%41|~!$;=@")).toEqual({ allowed: true, opened: true });
    expect(await opensThrough("a b")).toEqual({ allowed: false, opened: false });
    expect(await opensThrough("józsef")).toEqual({ allowed: false, opened: false });
  });

  test("dials need a folder whose sockets' paths fit a Unix socket's address and a ws+unix URL carries as they are", () => {
    ["/Users/ann/.mirador/machine-tunnels", "/home/ann/m&m's[old]+%41|~!$;=@/machine-tunnels"].forEach((folder) => expect(socketFolderProblem(folder)).toBeNull());
    expect(socketFolderProblem(`/Users/ann/${"x".repeat(80)}/machine-tunnels`)).toContain("too long for a Unix socket");
    ["a:b", "a b", "józsef", "a#b", "a?b", 'a"b', "a<b", "a>b", "a`b", "a{b", "a}b", "a^b", "a\tb", "a\x7fb"].forEach((name) =>
      expect(socketFolderProblem(`/home/${name}/.mirador/machine-tunnels`)).toContain("can't name a Unix socket's path with"),
    );
    ["data/machine-tunnels", "my data/machine-tunnels"].forEach((relative) => expect(socketFolderProblem(relative)).toContain("can't name a Unix socket's path with"));
  });
});

/** These run real processes through POSIX shells and check POSIX file modes; Windows has no ps either, to find a dial left over. */
const onWindows = process.platform === "win32";

describe.skipIf(onWindows)("dials left over", () => {
  test("a dial a killed host left running is stopped at the next start, by its pid file, and its sockets' folder goes; another process that took a pid is not", async () => {
    const dir = folder();
    const keyFile = join(dir, "machine.key");
    writeFileSync(keyFile, PRIVATE_KEY, { mode: 0o600 });
    const dial = new Dial(() => ["/bin/sh", "-c", "sleep 30", "sh", "dial", `--key-file=${keyFile}`], { folder: dir, pidFile: join(dir, "machine.pid"), keyFile }, ORIGINS, () => {});
    cleanUp.push(() => dial.stop());
    dial.start();
    await eventually(() => expect(existsSync(join(dir, "machine.pid"))).toBe(true));
    const pid = pidIn(join(dir, "machine.pid"));
    expect(isRunning(pid)).toBe(true);
    writeFileSync(join(dir, "other.pid"), JSON.stringify({ pid: process.pid, keyFile: join(dir, "other.key") }));
    writeFileSync(join(dir, "join-0123.key"), PRIVATE_KEY);
    mkdirSync(join(dir, "dLeft01"), { mode: 0o700 });
    const asked: string[] = [];
    listenerAt({ unix: join(dir, "dLeft01", "w") }, asked);

    stopLeftOverDials(dir, (askedPid) => (askedPid === pid ? `/bin/sh -c sleep 30 sh dial --key-file=${keyFile}` : "bun test"));

    await eventually(() => expect(isRunning(pid)).toBe(false));
    expect(isRunning(process.pid)).toBe(true);
    expect(readdirSync(dir).sort()).toEqual(["machine.key"]);
    expect(asked).toEqual([]);
  });

  test("starts again when it exits on its own, from sockets in a folder made fresh each time, which goes as its process does, and stop takes its pid file", async () => {
    const dir = folder();
    const pidFile = join(dir, "machine.pid");
    const started: ForwardsFrom[] = [];
    const dial = new Dial(
      (from) => {
        started.push(from);
        return ["/bin/sh", "-c", "exit 3"];
      },
      { folder: dir, pidFile, keyFile: join(dir, "machine.key") },
      ORIGINS,
      () => {},
    );
    cleanUp.push(() => dial.stop());
    dial.start();
    await eventually(() => expect(started).toHaveLength(2));
    const [first, second] = started.map(socketFolderOf);
    expect(first).not.toBe(second);
    await eventually(() => expect(existsSync(first!)).toBe(false));
    expect(await dial.current()).toBeNull();
    dial.stop();
    expect(existsSync(pidFile)).toBe(false);
    expect(readdirSync(dir)).toEqual([]);
  });

  test("a dial for joining is tried once, never started again", async () => {
    const dir = folder();
    let starts = 0;
    const dial = new Dial(() => (starts++, ["/bin/sh", "-c", "exit 3"]), { folder: dir, pidFile: join(dir, "join.pid"), keyFile: join(dir, "join.key") }, ORIGINS, () => {}, {
      restarts: false,
    });
    cleanUp.push(() => dial.stop());
    dial.start();
    expect(await dial.current()).toBeNull();
    await Bun.sleep(1500);
    expect(starts).toBe(1);
  });

  test("hands out no forward while its process makes no sockets, though sockets of this account's listen in the folder from before; its own folder, which only this account can enter, is made for that process", async () => {
    const dir = folder();
    const asked: string[] = [];
    mkdirSync(join(dir, "dBefore"), { mode: 0o700 });
    ["w", "c"].forEach((socket) => {
      listenerAt({ unix: join(dir, "dBefore", socket) }, asked);
      chmodSync(join(dir, "dBefore", socket), 0o600);
    });
    const started: ForwardsFrom[] = [];
    const dial = new Dial(
      (from) => (started.push(from), ["/bin/sh", "-c", "sleep 30"]),
      { folder: dir, pidFile: join(dir, "machine.pid"), keyFile: join(dir, "machine.key") },
      ORIGINS,
      () => {},
    );
    cleanUp.push(() => dial.stop());
    dial.start();
    expect(await Promise.race([dial.current(), Bun.sleep(1500).then(() => "still not listening")])).toBe("still not listening");
    expect(await statMode(socketFolderOf(started[0])!)).toBe(0o700);
    expect(socketFolderOf(started[0])).not.toBe(join(dir, "dBefore"));
    expect(asked).toEqual([]);
  });

  test("takes no socket that other accounts could connect to, had they a way into its folder", async () => {
    const dir = folder();
    const binary = fakeDialBinary(dir, { socketMode: 0o666 });
    const dial = new Dial(
      (from) => dialCommand(binary, { keyFile: join(dir, "machine.key"), address: "fd12::5", places, from }),
      { folder: dir, pidFile: join(dir, "machine.pid"), keyFile: join(dir, "machine.key") },
      ORIGINS,
      () => {},
    );
    cleanUp.push(() => dial.stop());
    dial.start();
    expect(await Promise.race([dial.current(), Bun.sleep(1500).then(() => "still not listening")])).toBe("still not listening");
  });
});

/** Windows dials forward from ports; these run Bun itself as the process, as Windows runs no shebang scripts. */
describe.skipIf(!onWindows)("dials on Windows", () => {
  const sleeper = [process.execPath, "-e", "setTimeout(() => {}, 30_000)"];

  test("one whose ports another account took before it could listen there exits, sends that account nothing, and starts again on ports of its own", async () => {
    const dir = folder();
    const script = fakeDialBinary(dir);
    const asked: string[] = [];
    const ports: number[] = [];
    const dial = new Dial(
      (from) => {
        if (!("port" in from)) throw new Error("Windows dials forward from ports");
        if (ports.length === 0) [from.port, from.port + 1].forEach((port) => listenerAt({ hostname: "::1", port }, asked));
        ports.push(from.port);
        return [process.execPath, script, "dial", `--forward=[::1]:${from.port}=4600`, `--forward=[::1]:${from.port + 1}=4601`];
      },
      { folder: dir, pidFile: join(dir, "machine.pid"), keyFile: join(dir, "machine.key") },
      ORIGINS,
      () => {},
    );
    cleanUp.push(() => dial.stop());
    dial.start();
    expect(await dial.current()).toBeNull();
    await eventually(async () => expect((await dial.current())?.web.origin).toBe(`http://[::1]:${ports[1]}`));
    expect(ports[1]).not.toBe(ports[0]);
    expect(asked).toEqual([]);
  });

  test("hands out no forward while its process does not listen there, though something else does: another account took the ports first", async () => {
    const dir = folder();
    const asked: string[] = [];
    const port = await freeLoopbackPortPair();
    [port, port + 1].forEach((taken) => listenerAt({ hostname: "::1", port: taken }, asked));
    const dial = new Dial(() => sleeper, { folder: dir, pidFile: join(dir, "machine.pid"), keyFile: join(dir, "machine.key") }, ORIGINS, () => {});
    cleanUp.push(() => dial.stop());
    dial.start();
    expect(await Promise.race([dial.current(), Bun.sleep(1500).then(() => "still not listening")])).toBe("still not listening");
    expect(asked).toEqual([]);
  });
});

test("reads the ports on IPv6's loopback a process listens at from what netstat lists, in any language", () => {
  const listed = [
    "  Proto  Local Address          Foreign Address        State           PID",
    "  TCP    [::1]:41000            [::]:0                 LISTENING       4242",
    "  TCP    [::1]:41001            [::]:0                 ABHÖREN         4242",
    "  TCP    [::1]:41002            [::]:0                 LISTENING       5151",
    "  TCP    [::1]:41000            [::1]:50000            ESTABLISHED     4242",
    "  TCP    [::]:41003             [::]:0                 LISTENING       4242",
  ].join("\r\n");
  expect(loopbackPortsInNetstat(listed, 4242)).toEqual([41000, 41001]);
});

describe.skipIf(onWindows)("MachineTunnels", () => {
  function machineJoinedThroughTunnel({ dials = join(folder(), "dials") } = {}) {
    const store = new Store(":memory:");
    store.insertMachine({ id: "m1", name: "Ann's machine", origin: `http://[${places.hostAddress}]:4600`, createdAt: 1 });
    store.setMachineJoinedAs("m1", { asPerson: true, relayKey: "relay-key" });
    store.setMachineDeviceToken("m1", "device-token");
    store.setMachineTunnelDevice("m1", places, { address: "fd12:3456:789a:1:2:3:4:5", privateKey: PRIVATE_KEY });
    const binary = fakeDialBinary(folder());
    const tunnels = new MachineTunnels(store, dials, { path: binary }, []);
    cleanUp.push(() => tunnels.stopAll());
    return { store, tunnels, dials, binary };
  }

  test("reaches a machine joined peer to peer through its dial's socket, asking for its address in the tunnel, never at that address", async () => {
    const { store, tunnels, dials } = machineJoinedThroughTunnel();
    tunnels.startAll();
    const reached = (await tunnels.reached(store.findMachine("m1")!))!;
    expect(reached.origin).toBe("http://[fd12:3456:789a:1::1]:4600");
    const web = tunnels.wayTo(reached)!;
    expect(dirname(dirname(web.socket!))).toBe(dials);
    expect(await (await fetchThrough(web, "/mirador-here")).json()).toEqual({ mirador: true, host: "[fd12:3456:789a:1::1]:4600" });
    const canvas = tunnels.canvasWayTo(reached)!;
    expect(canvas.origin).toBe("http://[fd12:3456:789a:1::1]:4601");
    expect(await (await fetchThrough(canvas, "/d3.min.js")).json()).toEqual({ mirador: true, host: "[fd12:3456:789a:1::1]:4601" });
  });

  test("dials from a relative data folder through sockets at their absolute paths", async () => {
    const absolute = join(folder(), "dials");
    const { store, tunnels } = machineJoinedThroughTunnel({ dials: relative(process.cwd(), absolute) });
    tunnels.startAll();
    const reached = (await tunnels.reached(store.findMachine("m1")!))!;
    expect(dirname(dirname(tunnels.wayTo(reached)!.socket!))).toBe(absolute);
  });

  test("keeps the key in a file only this account reads and the sockets in folders only it can enter, and lets them and the dial go once the machine is forgotten", async () => {
    const { store, tunnels, dials } = machineJoinedThroughTunnel();
    tunnels.startAll();
    const reached = (await tunnels.reached(store.findMachine("m1")!))!;
    const keyFile = readdirSync(dials).find((file) => file.endsWith(".key"))!;
    expect(readFileSync(join(dials, keyFile), "utf8")).toBe(PRIVATE_KEY);
    expect(await statMode(join(dials, keyFile))).toBe(0o600);
    expect(await statMode(dials)).toBe(0o700);
    const { socket } = tunnels.wayTo(reached)!;
    expect(await statMode(dirname(socket!))).toBe(0o700);
    expect(await statMode(socket!)).toBe(0o600);
    const { pid } = JSON.parse(readFileSync(join(dials, keyFile.replace(/\.key$/, ".pid")), "utf8")) as { pid: number };

    tunnels.forget("m1");

    await eventually(() => expect(isRunning(pid)).toBe(false));
    expect(readdirSync(dials)).toEqual([]);
    expect(tunnels.wayTo(reached)).toBeNull();
    expect(store.machineTunnel("m1")?.device).toBeNull();
    expect(store.findMachine("m1")?.peerToPeer).toBe(true);
    expect(await tunnels.reached(store.findMachine("m1")!)).toBeNull();
  });

  test("reaches the machine through no forward the moment the dial's process exits, and through fresh sockets once it started again", async () => {
    const { store, tunnels, dials } = machineJoinedThroughTunnel();
    tunnels.startAll();
    const first = (await tunnels.reached(store.findMachine("m1")!))!;
    const firstSocket = tunnels.wayTo(first)!.socket!;
    const pidFile = join(dials, readdirSync(dials).find((file) => file.endsWith(".pid"))!);
    const firstPid = pidIn(pidFile);

    process.kill(firstPid);

    await eventually(() => expect(tunnels.stillReaches(first)).toBe(false));
    expect(tunnels.wayTo(first)).toBeNull();
    expect(tunnels.canvasWayTo(first)).toBeNull();
    expect(existsSync(dirname(firstSocket))).toBe(false);
    expect(await tunnels.reached(store.findMachine("m1")!)).toBeNull();
    await eventually(() => expect(pidIn(pidFile)).not.toBe(firstPid));
    const again = (await tunnels.reached(store.findMachine("m1")!))!;
    expect(tunnels.wayTo(again)?.socket).not.toBe(firstSocket);
    expect(tunnels.stillReaches(first)).toBe(false);
  });

  test("a host that was killed left its dials running, which the next one stops by their pid files before it dials again, never asking what listens in their folders", async () => {
    const { store, tunnels, dials, binary } = machineJoinedThroughTunnel();
    mkdirSync(join(dials, "dLeft01"), { recursive: true, mode: 0o700 });
    const keyFile = join(dials, "left-over.key");
    const leftOver = Bun.spawn([binary, "dial", `--key-file=${keyFile}`, `--forward=unix:${join(dials, "dLeft01", "w")}=4600`], { stdout: "ignore", stderr: "ignore" });
    cleanUp.push(() => leftOver.kill());
    writeFileSync(join(dials, "left-over.pid"), JSON.stringify({ pid: leftOver.pid, keyFile }));
    const asked: string[] = [];
    mkdirSync(join(dials, "dLeft02"), { mode: 0o700 });
    listenerAt({ unix: join(dials, "dLeft02", "w") }, asked);

    tunnels.startAll();

    expect(await Promise.race([leftOver.exited.then(() => "stopped"), Bun.sleep(5000).then(() => "still running")])).toBe("stopped");
    expect(await tunnels.reached(store.findMachine("m1")!)).not.toBeNull();
    expect(readdirSync(dials).filter((file) => file.startsWith("left-over") || file.startsWith("dLeft"))).toEqual([]);
    expect(asked).toEqual([]);
  });

  test("a data folder whose sockets' paths would be too long leaves peer to peer unavailable here, with no dial started and no port taken instead", async () => {
    const { store, tunnels } = machineJoinedThroughTunnel({ dials: join(folder(), "x".repeat(100), "dials") });
    tunnels.startAll();
    expect(await tunnels.canDial()).toBe(false);
    expect(tunnels.dialToJoin({ ...places, joinKey: PRIVATE_KEY, joinAddress: "fd12::9" })).rejects.toThrow("Peer to peer isn't available on this computer");
    expect(await tunnels.reached(store.findMachine("m1")!)).toBeNull();
  });

  test("an address is reached as it is, and a host without tunnels reaches no machine joined peer to peer", async () => {
    const { store } = machineJoinedThroughTunnel();
    store.insertMachine({ id: "m2", name: "Home server", origin: "https://home.example", createdAt: 2 });
    const atAddress = store.findMachine("m2")!;
    expect(await DIRECT_REACH.reached(atAddress)).toEqual(atAddress);
    expect(DIRECT_REACH.stillReaches(atAddress)).toBe(true);
    expect(DIRECT_REACH.wayTo(atAddress)).toEqual({ origin: "https://home.example", socket: null });
    expect(DIRECT_REACH.canvasWayTo(atAddress)).toBeNull();
    expect(await DIRECT_REACH.reached(store.findMachine("m1")!)).toBeNull();
    expect(DIRECT_REACH.wayTo(store.findMachine("m1")!)).toBeNull();
    expect(DIRECT_REACH.dialToJoin({ ...places, joinKey: PRIVATE_KEY, joinAddress: "fd12::9" })).rejects.toThrow("Peer to peer isn't available on this computer");
  });
});

const statMode = (path: string) => Bun.file(path).stat().then(({ mode }) => mode & 0o777);
