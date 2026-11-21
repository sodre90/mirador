import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DIRECT_REACH, MachineTunnels } from "../host/machine-tunnels.ts";
import {
  Dial,
  dialCommand,
  dialProgram,
  loopbackPortsInLsof,
  loopbackPortsInNetstat,
  loopbackPortsInProcNet,
  loopbackPortsListenedAtBy,
  stopLeftOverDials,
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

/** Stands in for mirador-p2p: it listens at every forward it is given, as the real one does, and answers there as the machine would through the tunnel. */
function fakeDialBinary(at: string) {
  const path = join(at, "fake-mirador-p2p");
  writeFileSync(
    path,
    `#!/usr/bin/env bun
const ports = process.argv.flatMap((argument) => /^--forward=\\[::1\\]:(\\d+)=/.exec(argument)?.slice(1) ?? []).map(Number);
ports.forEach((port) => Bun.serve({ hostname: "::1", port, fetch: () => Response.json({ mirador: true }) }));
`,
  );
  chmodSync(path, 0o755);
  return path;
}

/** Another account's server on this computer, which took a port before a dial could. */
function squatterAt(port: number, asked: string[]) {
  const server = Bun.serve({
    hostname: "::1",
    port,
    fetch: (request) => {
      asked.push(`${new URL(request.url).pathname} ${request.headers.get("cookie")}`);
      return new Response("unauthorized", { status: 401 });
    },
  });
  cleanUp.push(() => server.stop(true));
  return server;
}

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

describe("dialCommand", () => {
  test("gives each value with its own flag in one argument, never the private key, and forwards only on IPv6's loopback", () => {
    const command = dialCommand("/bin/mirador-p2p", { keyFile: "/data/dial/a.key", address: "fd12:3456:789a:1:2:3:4:5", places, localPort: 41000 });
    expect(command).toEqual([
      "/bin/mirador-p2p",
      "dial",
      "--udp=0.0.0.0:0",
      "--key-file=/data/dial/a.key",
      "--address=fd12:3456:789a:1:2:3:4:5",
      `--peer=${places.hostKey}`,
      "--peer-address=fd12:3456:789a:1::1",
      "--broker=p2p.example.com:47800",
      `--broker-key=${places.broker.key}`,
      "--forward=[::1]:41000=4600",
      "--forward=[::1]:41001=4601",
    ]);
  });

  test("forwards the canvas port even when the machine names none, so it never reaches whatever else listens above the web forward", () => {
    const { canvasPort: _canvasPort, ...withoutCanvas } = places;
    expect(dialCommand("p2p", { keyFile: "k", address: "fd12::5", places: withoutCanvas, localPort: 41000 }).at(-1)).toBe("--forward=[::1]:41001=4601");
  });
});

test("dials with the environment's binary, else the downloaded one, and with none where neither is", () => {
  const download = { url: "https://example.com/p2p", sha256: "abc" };
  expect(dialProgram({ MIRADOR_P2P_BINARY: "/opt/p2p" }, { path: "/data/p2p/bin/p2p", download })).toEqual({ path: "/opt/p2p" });
  expect(dialProgram({}, { path: "/data/p2p/bin/p2p", download })).toEqual({ path: "/data/p2p/bin/p2p", download });
  expect(dialProgram({}, null)).toBeNull();
});

/** These run real processes through POSIX shells and check POSIX file modes; Windows has no ps either, to find a dial left over. */
const onWindows = process.platform === "win32";

describe.skipIf(onWindows)("dials left over", () => {
  test("a dial a killed host left running is stopped at the next start, by its pid file; another process that took a pid is not", async () => {
    const dir = folder();
    const keyFile = join(dir, "machine.key");
    writeFileSync(keyFile, PRIVATE_KEY, { mode: 0o600 });
    const dial = new Dial(() => ["/bin/sh", "-c", "sleep 30", "sh", "dial", `--key-file=${keyFile}`], { pidFile: join(dir, "machine.pid"), keyFile }, () => {});
    cleanUp.push(() => dial.stop());
    dial.start();
    await eventually(() => expect(existsSync(join(dir, "machine.pid"))).toBe(true));
    const pid = pidIn(join(dir, "machine.pid"));
    expect(isRunning(pid)).toBe(true);
    writeFileSync(join(dir, "other.pid"), JSON.stringify({ pid: process.pid, keyFile: join(dir, "other.key") }));
    writeFileSync(join(dir, "join-0123.key"), PRIVATE_KEY);

    stopLeftOverDials(dir, (asked) => (asked === pid ? `/bin/sh -c sleep 30 sh dial --key-file=${keyFile}` : "bun test"));

    await eventually(() => expect(isRunning(pid)).toBe(false));
    expect(isRunning(process.pid)).toBe(true);
    expect(readdirSync(dir).sort()).toEqual(["machine.key"]);
  });

  test("starts again when it exits on its own, from a fresh pair of ports each time, never one a process before it had, and stop takes its pid file", async () => {
    const dir = folder();
    const pidFile = join(dir, "machine.pid");
    const ports: number[] = [];
    const dial = new Dial(
      (localPort) => {
        ports.push(localPort);
        return ["/bin/sh", "-c", "exit 3"];
      },
      { pidFile, keyFile: join(dir, "machine.key") },
      () => {},
    );
    cleanUp.push(() => dial.stop());
    dial.start();
    await eventually(() => expect(ports).toHaveLength(2));
    expect([ports[0]! - 1, ports[0], ports[0]! + 1]).not.toContain(ports[1]);
    expect(await dial.current()).toBeNull();
    dial.stop();
    expect(existsSync(pidFile)).toBe(false);
  });

  test("a dial for joining is tried once, never started again", async () => {
    const dir = folder();
    let starts = 0;
    const dial = new Dial(() => (starts++, ["/bin/sh", "-c", "exit 3"]), { pidFile: join(dir, "join.pid"), keyFile: join(dir, "join.key") }, () => {}, { restarts: false });
    cleanUp.push(() => dial.stop());
    dial.start();
    expect(await dial.current()).toBeNull();
    await Bun.sleep(1500);
    expect(starts).toBe(1);
  });

  test("one whose ports another account took before it could listen there exits, sends that account nothing, and starts again on ports of its own", async () => {
    const dir = folder();
    const binary = fakeDialBinary(dir);
    const asked: string[] = [];
    const ports: number[] = [];
    const dial = new Dial(
      (localPort) => {
        if (ports.length === 0) [localPort, localPort + 1].forEach((port) => squatterAt(port, asked));
        ports.push(localPort);
        return [binary, "dial", `--forward=[::1]:${localPort}=4600`, `--forward=[::1]:${localPort + 1}=4601`];
      },
      { pidFile: join(dir, "machine.pid"), keyFile: join(dir, "machine.key") },
      () => {},
    );
    cleanUp.push(() => dial.stop());
    dial.start();
    expect(await dial.current()).toBeNull();
    await eventually(async () => expect((await dial.current())?.origin).toBe(`http://[::1]:${ports[1]}`));
    expect(ports[1]).not.toBe(ports[0]);
    expect(asked).toEqual([]);
  });

  test("hands out no forward while its process does not listen there, though something else does: another account took the ports first", async () => {
    const dir = folder();
    const asked: string[] = [];
    const dial = new Dial(
      (localPort) => {
        squatterAt(localPort, asked);
        squatterAt(localPort + 1, asked);
        return ["/bin/sh", "-c", "sleep 30"];
      },
      { pidFile: join(dir, "machine.pid"), keyFile: join(dir, "machine.key") },
      () => {},
    );
    cleanUp.push(() => dial.stop());
    dial.start();
    expect(await Promise.race([dial.current(), Bun.sleep(1500).then(() => "still not listening")])).toBe("still not listening");
    expect(asked).toEqual([]);
  });
});

describe.skipIf(onWindows)("whose listener a forward is", () => {
  test("the system tells which process listens at a port, never counting another's at the same moment", async () => {
    const dir = folder();
    const binary = fakeDialBinary(dir);
    const own = Bun.serve({ hostname: "::1", port: 0, fetch: () => new Response("this test's own") });
    cleanUp.push(() => own.stop(true));
    const dial = Bun.spawn([binary, "dial", "--forward=[::1]:0=4600"], { stdout: "ignore", stderr: "ignore" });
    cleanUp.push(() => dial.kill());
    await eventually(async () => expect(await loopbackPortsListenedAtBy(dial.pid)).toHaveLength(1));
    expect(await loopbackPortsListenedAtBy(dial.pid)).not.toContain(own.port);
    expect(await loopbackPortsListenedAtBy(process.pid)).toContain(own.port!);
  });

  test("reads the ports on IPv6's loopback from what lsof lists of a process", () => {
    expect(loopbackPortsInLsof("p4242\nf9\nn[::1]:41000\nf10\nn[::1]:41001\nf11\nn127.0.0.1:41002\nf12\nn*:41003\n")).toEqual([41000, 41001]);
    expect(loopbackPortsInLsof("")).toEqual([]);
  });

  test("reads the ports on IPv6's loopback from /proc/net/tcp6, only the listening sockets the process holds", () => {
    const tcp6 = [
      "  sl  local_address                         remote_address                        st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode",
      "   0: 00000000000000000000000001000000:A028 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 31337 1 0000000000000000 100 0 0 10 0",
      "   1: 00000000000000000000000001000000:A029 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 31338 1 0000000000000000 100 0 0 10 0",
      "   2: 00000000000000000000000001000000:A02A 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000  1001        0 4444 1 0000000000000000 100 0 0 10 0",
      "   3: 00000000000000000000000001000000:A028 00000000000000000000000001000000:C350 01 00000000:00000000 00:00000000 00000000  1000        0 31339 1 0000000000000000 20 4 30 10 -1",
      "   4: 00000000000000000000000000000000:A02B 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 31340 1 0000000000000000 100 0 0 10 0",
    ].join("\n");
    expect(loopbackPortsInProcNet(tcp6, ["31337", "31338", "31339", "31340"])).toEqual([41000, 41001]);
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
});

describe.skipIf(onWindows)("MachineTunnels", () => {
  function machineJoinedThroughTunnel() {
    const store = new Store(":memory:");
    store.insertMachine({ id: "m1", name: "Ann's machine", origin: `http://[${places.hostAddress}]:4600`, createdAt: 1 });
    store.setMachineJoinedAs("m1", { asPerson: true, relayKey: "relay-key" });
    store.setMachineDeviceToken("m1", "device-token");
    store.setMachineTunnelDevice("m1", places, { address: "fd12:3456:789a:1:2:3:4:5", privateKey: PRIVATE_KEY });
    const dir = folder();
    const binary = fakeDialBinary(dir);
    const tunnels = new MachineTunnels(store, join(dir, "dials"), { path: binary }, []);
    cleanUp.push(() => tunnels.stopAll());
    return { store, tunnels, dials: join(dir, "dials"), binary };
  }

  test("reaches a machine joined peer to peer at its dial's forward on IPv6's loopback, never at its address in the tunnel", async () => {
    const { store, tunnels } = machineJoinedThroughTunnel();
    tunnels.startAll();
    const reached = await tunnels.reached(store.findMachine("m1")!);
    expect(reached?.origin).toMatch(/^http:\/\/\[::1\]:\d+$/);
    expect(await (await fetch(`${reached!.origin}/mirador-here`)).json()).toEqual({ mirador: true });
  });

  test("keeps the key in a file only this account reads, and lets the key and the dial go once the machine is forgotten", async () => {
    const { store, tunnels, dials } = machineJoinedThroughTunnel();
    tunnels.startAll();
    await tunnels.reached(store.findMachine("m1")!);
    const keyFile = readdirSync(dials).find((file) => file.endsWith(".key"))!;
    expect(readFileSync(join(dials, keyFile), "utf8")).toBe(PRIVATE_KEY);
    expect(await statMode(join(dials, keyFile))).toBe(0o600);
    expect(await statMode(dials)).toBe(0o700);
    const { pid } = JSON.parse(readFileSync(join(dials, keyFile.replace(/\.key$/, ".pid")), "utf8")) as { pid: number };

    tunnels.forget("m1");

    await eventually(() => expect(isRunning(pid)).toBe(false));
    expect(readdirSync(dials)).toEqual([]);
    expect(store.machineTunnel("m1")?.device).toBeNull();
    expect(store.findMachine("m1")?.peerToPeer).toBe(true);
    expect(await tunnels.reached(store.findMachine("m1")!)).toBeNull();
  });

  test("reaches the machine at no forward the moment the dial's process exits, and at a fresh one once it started again", async () => {
    const { store, tunnels, dials } = machineJoinedThroughTunnel();
    tunnels.startAll();
    const first = (await tunnels.reached(store.findMachine("m1")!))!;
    expect(tunnels.stillReaches(first)).toBe(true);
    const pidFile = join(dials, readdirSync(dials).find((file) => file.endsWith(".pid"))!);
    const firstPid = pidIn(pidFile);

    process.kill(firstPid);

    await eventually(() => expect(tunnels.stillReaches(first)).toBe(false));
    expect(await tunnels.reached(store.findMachine("m1")!)).toBeNull();
    await eventually(() => expect(pidIn(pidFile)).not.toBe(firstPid));
    const again = await tunnels.reached(store.findMachine("m1")!);
    expect(again?.origin).toMatch(/^http:\/\/\[::1\]:\d+$/);
    expect(again?.origin).not.toBe(first.origin);
    expect(tunnels.stillReaches(first)).toBe(false);
  });

  test("a host that was killed left its dials running, which the next one stops by their pid files before it dials again", async () => {
    const { store, tunnels, dials, binary } = machineJoinedThroughTunnel();
    mkdirSync(dials, { mode: 0o700 });
    const keyFile = join(dials, "left-over.key");
    const leftOver = Bun.spawn([binary, "dial", `--key-file=${keyFile}`, "--forward=[::1]:0=4600"], { stdout: "ignore", stderr: "ignore" });
    cleanUp.push(() => leftOver.kill());
    writeFileSync(join(dials, "left-over.pid"), JSON.stringify({ pid: leftOver.pid, keyFile }));

    tunnels.startAll();

    expect(await leftOver.exited).not.toBe(0);
    expect(await tunnels.reached(store.findMachine("m1")!)).not.toBeNull();
    expect(readdirSync(dials).filter((file) => file.startsWith("left-over"))).toEqual([]);
  });

  test("an address is reached as it is, and a host without tunnels reaches no machine joined peer to peer", async () => {
    const { store } = machineJoinedThroughTunnel();
    store.insertMachine({ id: "m2", name: "Home server", origin: "https://home.example", createdAt: 2 });
    expect(await DIRECT_REACH.reached(store.findMachine("m2")!)).toEqual(store.findMachine("m2")!);
    expect(DIRECT_REACH.stillReaches(store.findMachine("m2")!)).toBe(true);
    expect(await DIRECT_REACH.reached(store.findMachine("m1")!)).toBeNull();
    expect(DIRECT_REACH.dialToJoin({ ...places, joinKey: PRIVATE_KEY, joinAddress: "fd12::9" })).rejects.toThrow("Peer to peer isn't available on this computer");
  });
});

const statMode = (path: string) => Bun.file(path).stat().then(({ mode }) => mode & 0o777);
