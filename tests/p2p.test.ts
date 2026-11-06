import { afterEach, beforeEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { DeviceService } from "../host/devices.ts";
import { hostAddressIn, isTunnelKey, newDeviceAddress, newKeyPair, tunnelIdentity } from "../host/p2p/identity.ts";
import { PeerToPeer, peerToPeerSettings, type PeerToPeerSettings, type TunnelEnd } from "../host/p2p/service.ts";
import { Sidecar } from "../host/p2p/sidecar.ts";
import { downloadedSidecar, installSidecar, SIDECAR_RELEASE } from "../host/p2p/sidecar-download.ts";
import { Store } from "../host/store.ts";
import { computerName } from "../host/machine-name.ts";

const brokerKey = newKeyPair().publicKey;
const noBuiltIn = { sidecar: null, broker: null };
/** The fake sidecar is a shell script, and the identity's files are kept by Unix permissions; peer to peer is Unix-only on the host anyway. */
const unixOnlyTest = test.skipIf(process.platform === "win32");
let folder: string;
let commandsFile: string;
let argumentsFile: string;
let p2p: PeerToPeer | null = null;

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "p2p-"));
  commandsFile = join(folder, "commands");
  argumentsFile = join(folder, "arguments");
  writeFileSync(commandsFile, "");
});

afterEach(() => {
  p2p?.stop();
  p2p = null;
  rmSync(folder, { recursive: true, force: true });
});

/**
 * Stands in for mirador-p2p: it writes down its arguments and the commands it reads, as the real one acts on them, and
 * prints `tells` on stdout as the real one tells the host about the broker, which by default answers at once.
 */
function fakeSidecar(tells = `{"broker":"reached"}`) {
  const binary = join(folder, "fake-sidecar");
  writeFileSync(binary, `#!/bin/sh\nprintf '%s\\n' "$@" > '${argumentsFile}'\nprintf '%s\\n' '${tells}'\ncat >> '${commandsFile}'\n`);
  chmodSync(binary, 0o755);
  return binary;
}

async function commandsRead(count: number) {
  const deadline = Date.now() + 5000;
  for (;;) {
    const lines = readFileSync(commandsFile, "utf8").split("\n").filter(Boolean);
    if (lines.length >= count || Date.now() > deadline) return lines.map((line) => JSON.parse(line) as Record<string, { key: string; socket?: string; address?: string }>);
    await Bun.sleep(20);
  }
}

function host(more: Partial<PeerToPeerSettings> = {}) {
  const store = new Store(":memory:");
  const devices = new DeviceService(store);
  const listening = new Map<string, TunnelEnd>();
  const settings = { binary: more.binary ?? fakeSidecar(), broker: { address: "203.0.113.7:47800", key: brokerKey }, ...more };
  const statuses: string[] = [];
  p2p = new PeerToPeer(settings, join(folder, "p2p"), store, Date.now, 50);
  const started = p2p;
  started.start(
    (socket, end) => {
      listening.set(socket, end);
      return { stop: () => listening.delete(socket) };
    },
    () => statuses.push(started.peerToPeerStatus()),
  );
  return { p2p: started, store, devices, listening, settings, statuses };
}

test("peer to peer is off unless the environment names the sidecar and the broker together", () => {
  expect(peerToPeerSettings({}, noBuiltIn)).toBeNull();
  expect(() => peerToPeerSettings({ MIRADOR_P2P_BINARY: "/bin/mirador-p2p" }, noBuiltIn)).toThrow(/together/);
  expect(() => peerToPeerSettings({ MIRADOR_P2P_BINARY: "/bin/mirador-p2p", MIRADOR_P2P_BROKER: "203.0.113.7:47800", MIRADOR_P2P_BROKER_KEY: "nope" }, noBuiltIn)).toThrow(/not a key/);
  expect(peerToPeerSettings({ MIRADOR_P2P_BINARY: "/bin/mirador-p2p", MIRADOR_P2P_BROKER: "203.0.113.7:47800", MIRADOR_P2P_BROKER_KEY: brokerKey }, noBuiltIn)).toEqual({
    binary: "/bin/mirador-p2p",
    broker: { address: "203.0.113.7:47800", key: brokerKey },
  });
});

test("the environment may hand devices another broker address and announce more places to reach the sidecar at", () => {
  const environment = { MIRADOR_P2P_BINARY: "/bin/mirador-p2p", MIRADOR_P2P_BROKER: "127.0.0.1:47800", MIRADOR_P2P_BROKER_KEY: brokerKey };
  expect(peerToPeerSettings({ ...environment, MIRADOR_P2P_DEVICE_BROKER: "", MIRADOR_P2P_CANDIDATES: " , " }, noBuiltIn)).toEqual({
    binary: "/bin/mirador-p2p",
    broker: { address: "127.0.0.1:47800", key: brokerKey },
  });
  expect(peerToPeerSettings({ ...environment, MIRADOR_P2P_DEVICE_BROKER: "10.0.2.2:47800", MIRADOR_P2P_CANDIDATES: "203.0.113.7:41641, 10.0.2.2:41641" }, noBuiltIn)).toEqual({
    binary: "/bin/mirador-p2p",
    broker: { address: "127.0.0.1:47800", key: brokerKey },
    deviceBroker: "10.0.2.2:47800",
    candidates: ["203.0.113.7:41641", "10.0.2.2:41641"],
  });
});

unixOnlyTest("the sidecar uses the host's broker and announces the extra places, while devices get the broker address meant for them", async () => {
  const { p2p, devices } = host({ broker: { address: "127.0.0.1:47800", key: brokerKey }, deviceBroker: "10.0.2.2:47800", candidates: ["10.0.2.2:41641"] });
  expect((await p2p.invite("ABCDEFGHJK", Date.now() + 60_000))!.broker).toEqual({ address: "10.0.2.2:47800", key: brokerKey });
  expect(p2p.register(devices.admit("Phone").device.id, newKeyPair().publicKey).broker).toEqual({ address: "10.0.2.2:47800", key: brokerKey });
  await commandsRead(2);
  const sidecarArguments = readFileSync(argumentsFile, "utf8").split("\n");
  expect(sidecarArguments).toContain("--broker=127.0.0.1:47800");
  expect(sidecarArguments.at(-2)).toBe("--candidate=10.0.2.2:41641");
});

unixOnlyTest("devices reach the canvas server through the tunnel at a port of its own, which their tunnel places name", async () => {
  const { p2p, devices } = host({ canvasAssetsPort: 24601 });
  expect((await p2p.invite("ABCDEFGHJK", Date.now() + 60_000))!.canvasPort).toBe(4601);
  expect(p2p.register(devices.admit("Phone").device.id, newKeyPair().publicKey).canvasPort).toBe(4601);
  await commandsRead(2);
  expect(readFileSync(argumentsFile, "utf8").split("\n")).toContain("--forward=4601=127.0.0.1:24601");
});

unixOnlyTest("the host's tunnel identity is made once, kept from other accounts, and the same after a restart", () => {
  const identity = tunnelIdentity(join(folder, "identity"));
  expect(statSync(join(folder, "identity")).mode & 0o777).toBe(0o700);
  expect(statSync(identity.keyFile).mode & 0o777).toBe(0o600);
  expect(isTunnelKey(readFileSync(identity.keyFile, "utf8"))).toBe(true);
  expect(isTunnelKey(identity.publicKey)).toBe(true);
  expect(identity.prefix).toMatch(/^fd[0-9a-f]{2}(:[0-9a-f]{1,4}){2}$/);
  expect(tunnelIdentity(join(folder, "identity"))).toEqual(identity);
});

unixOnlyTest("an invite names the machine as Settings name it, and by its computer's name before", async () => {
  const { p2p, store } = host();
  expect((await p2p.invite("ABCDEFGHJK", Date.now() + 60_000))!.name).toBe(computerName());
  store.setMachineNameSetting("Studio Mac");
  expect((await p2p.invite("BCDEFGHJKL", Date.now() + 60_000))!.name).toBe("Studio Mac");
  await commandsRead(2);
});

test("devices get addresses of their own in the host's tunnel network", () => {
  const prefix = "fd12:3456:789a";
  const addresses = Array.from({ length: 50 }, () => newDeviceAddress(prefix));
  expect(new Set(addresses).size).toBe(50);
  addresses.forEach((address) => {
    expect(address.startsWith(`${prefix}:1:`)).toBe(true);
    expect(address).not.toBe(hostAddressIn(prefix));
  });
});

unixOnlyTest("a device that sends its key is let in on a socket of its own, and keeps its address when its key changes", async () => {
  const { p2p, devices, listening } = host();
  const { device } = devices.admit("Phone");
  const firstKey = newKeyPair().publicKey;
  const tunnel = p2p.register(device.id, firstKey);
  expect(tunnel).toMatchObject({ hostKey: p2p.places().hostKey, port: 4600, broker: { address: "203.0.113.7:47800", key: brokerKey } });
  const socket = [...listening].find(([, end]) => "deviceId" in end && end.deviceId === device.id)?.[0];
  expect(socket).toBeDefined();
  expect((await commandsRead(1)).at(-1)).toEqual({ pin: { key: firstKey, address: tunnel.deviceAddress, socket: socket! } });

  const secondKey = newKeyPair().publicKey;
  expect(p2p.register(device.id, secondKey).deviceAddress).toBe(tunnel.deviceAddress);
  expect((await commandsRead(3)).slice(1)).toEqual([{ unpin: { key: firstKey } }, { pin: { key: secondKey, address: tunnel.deviceAddress, socket: socket! } }]);
});

test("a key is refused when it is not one, or when another device already uses it", () => {
  const { p2p, devices } = host();
  const key = newKeyPair().publicKey;
  p2p.register(devices.admit("Phone").device.id, key);
  expect(() => p2p.register(devices.admit("Laptop").device.id, key)).toThrow(/Another device/);
  expect(() => p2p.register(devices.admit("Tablet").device.id, "not a key")).toThrow(/not a key/);
  expect(p2p.refusedKey(newKeyPair().publicKey)).toBeNull();
});

unixOnlyTest("a revoked device is let in no more, and its listener closes", async () => {
  const { p2p, devices, listening } = host();
  const { device } = devices.admit("Phone");
  const key = newKeyPair().publicKey;
  p2p.register(device.id, key);
  p2p.forget(device.id);
  devices.revoke(device.id);
  expect([...listening.values()].some((end) => "deviceId" in end)).toBe(false);
  expect((await commandsRead(2)).at(-1)).toEqual({ unpin: { key } });
});

unixOnlyTest("an invite's one-time key reaches only the joining socket, until shortly after the invite is used", async () => {
  const { p2p, devices, listening } = host();
  const { code, expiresAt } = devices.invite();
  const tunnel = (await p2p.invite(code, expiresAt))!;
  const joinSocket = [...listening].find(([, end]) => "joining" in end)?.[0];
  const [pinned] = await commandsRead(1);
  expect(pinned.pin).toMatchObject({ address: tunnel.joinAddress, socket: joinSocket });
  expect(isTunnelKey(tunnel.joinKey)).toBe(true);
  expect(tunnel.name).toBe(hostname().replace(/\.local$/, ""));
  expect(p2p.refusedKey(pinned.pin.key)).not.toBeNull();
  p2p.inviteUsed(code.toLowerCase());
  expect((await commandsRead(2))[1]).toEqual({ unpin: { key: pinned.pin.key } });
});

unixOnlyTest("an invite's one-time key is let in no more once the invite expires", async () => {
  const { p2p, devices } = host();
  const { code } = devices.invite();
  await p2p.invite(code, Date.now() + 50);
  const [pinned] = await commandsRead(1);
  expect((await commandsRead(2))[1]).toEqual({ unpin: { key: pinned.pin.key } });
});

test("a sidecar that can't start is tried again later, and the host keeps running", async () => {
  const logged: string[] = [];
  const sidecar = new Sidecar([join(folder, "missing-sidecar")], (line) => logged.push(line));
  sidecar.start();
  sidecar.pin({ key: newKeyPair().publicKey, address: "fd12:3456:789a:1::2", socket: join(folder, "a.sock") });
  sidecar.stop();
  expect(logged[0]).toStartWith("the sidecar did not start");
  expect(logged[1]).toBe("starting the sidecar again in 1 s");
});

unixOnlyTest("paired devices are let in again when the host starts", async () => {
  const first = host();
  const { device } = first.devices.admit("Phone");
  const key = newKeyPair().publicKey;
  const { deviceAddress } = first.p2p.register(device.id, key);
  first.p2p.stop();
  writeFileSync(commandsFile, "");
  const listening = new Map<string, TunnelEnd>();
  p2p = new PeerToPeer({ binary: fakeSidecar(), broker: { address: "203.0.113.7:47800", key: brokerKey } }, join(folder, "p2p"), first.store);
  p2p.start((socket, end) => {
    listening.set(socket, end);
    return { stop: () => listening.delete(socket) };
  });
  expect((await commandsRead(1))[0]).toMatchObject({ pin: { key, address: deviceAddress } });
  expect([...listening.values()]).toContainEqual({ deviceId: device.id });
  expect(existsSync(join(folder, "p2p", "key"))).toBe(true);
});

unixOnlyTest("a host with no device to reach starts no sidecar, until something needs it", async () => {
  const { p2p, devices } = host();
  await Bun.sleep(100);
  expect(existsSync(argumentsFile), "nothing started the sidecar").toBe(false);
  const { code, expiresAt } = devices.invite();
  expect(await p2p.invite(code, expiresAt)).not.toBeNull();
  await commandsRead(1);
  expect(existsSync(argumentsFile)).toBe(true);
});

test("without the environment, the host uses the built-in broker and a sidecar it downloads, once both exist", () => {
  const broker = { address: "p2p.example.com:47800", key: brokerKey };
  const sidecar = downloadedSidecar(folder, "darwin-arm64", "ab".repeat(32))!;
  expect(sidecar.download.url).toBe(`https://github.com/sodre90/mirador/releases/download/${SIDECAR_RELEASE}/mirador-p2p-darwin-arm64`);
  expect(sidecar.path).toBe(join(folder, "p2p", "bin", `${"ab".repeat(6)}-mirador-p2p-darwin-arm64`));
  expect(peerToPeerSettings({}, { sidecar, broker })).toEqual({ binary: sidecar.path, download: sidecar.download, broker });
  expect(peerToPeerSettings({}, { sidecar, broker: null }), "no broker yet").toBeNull();
  expect(peerToPeerSettings({}, { sidecar: null, broker }), "none published for this machine").toBeNull();
  expect(downloadedSidecar(folder, "freebsd-x64", undefined)).toBeNull();
  const environment = { MIRADOR_P2P_BINARY: "/bin/mirador-p2p", MIRADOR_P2P_BROKER: "203.0.113.7:47800", MIRADOR_P2P_BROKER_KEY: brokerKey };
  expect(peerToPeerSettings(environment, { sidecar, broker })).toEqual({ binary: "/bin/mirador-p2p", broker: { address: "203.0.113.7:47800", key: brokerKey } });
});

/** Serves `body` at /sidecar, counting the requests, as the release's download does. */
function sidecarServer(body: string) {
  const served = { count: 0 };
  const server = Bun.serve({
    port: 0,
    fetch: (request) => (new URL(request.url).pathname === "/sidecar" ? (served.count++, new Response(body)) : new Response("Not Found", { status: 404 })),
  });
  return { url: `http://127.0.0.1:${server.port}/sidecar`, served, stop: () => server.stop(true) };
}
const sha256Of = (text: string) => createHash("sha256").update(text).digest("hex");

unixOnlyTest("the sidecar is downloaded once, checked against its SHA-256, and replaces the ones earlier versions downloaded", async () => {
  const script = "#!/bin/sh\necho downloaded\n";
  const server = sidecarServer(script);
  try {
    const bin = join(folder, "bin");
    const path = join(bin, "new-sidecar");
    await installSidecar(join(bin, "old-sidecar"), { url: server.url, sha256: sha256Of(script) });
    await installSidecar(path, { url: server.url, sha256: sha256Of(script) });
    await installSidecar(path, { url: server.url, sha256: sha256Of(script) });
    expect(server.served.count, "the one already there is kept").toBe(2);
    expect(readdirSync(bin)).toEqual(["new-sidecar"]);
    expect(statSync(path).mode & 0o777).toBe(0o755);
    expect(spawnSync(path, { encoding: "utf8" }).stdout).toBe("downloaded\n");
    await expect(installSidecar(join(bin, "other"), { url: server.url, sha256: "0".repeat(64) })).rejects.toThrow(/not the expected one/);
    expect(readdirSync(bin), "a file that isn't the expected one is never kept").toEqual(["new-sidecar"]);
  } finally {
    server.stop();
  }
});

unixOnlyTest("when the sidecar can't be downloaded, an invite offers no tunnel, and the next one tries again", async () => {
  const script = `#!/bin/sh\nprintf '%s\\n' "$@" > '${argumentsFile}'\necho '{"broker":"reached"}'\ncat >> '${commandsFile}'\n`;
  const server = sidecarServer(script);
  try {
    const sha256 = sha256Of(script);
    const { p2p, devices, settings } = host({ binary: join(folder, "bin", "sidecar"), download: { url: `${server.url}-missing`, sha256 } });
    const first = devices.invite();
    expect(await p2p.invite(first.code, first.expiresAt)).toBeNull();
    settings.download = { url: server.url, sha256 };
    const second = devices.invite();
    expect(await p2p.invite(second.code, second.expiresAt)).not.toBeNull();
    expect((await commandsRead(1))[0]).toHaveProperty("pin");
  } finally {
    server.stop();
  }
});

unixOnlyTest("an invite offers the tunnel once the broker answers the sidecar, and says where peer to peer stands", async () => {
  const { p2p, devices, statuses } = host();
  expect(p2p.peerToPeerStatus()).toBe("waiting");
  const { code, expiresAt } = devices.invite();
  expect(await p2p.invite(code, expiresAt)).not.toBeNull();
  expect(statuses).toEqual(["connecting", "ready"]);
});

unixOnlyTest("while the broker doesn't answer, an invite offers no tunnel, as devices would find no way in", async () => {
  const { p2p, devices } = host({ binary: fakeSidecar("starting") });
  const { code, expiresAt } = devices.invite();
  expect(await p2p.invite(code, expiresAt, 200)).toBeNull();
  expect(p2p.peerToPeerStatus()).toBe("connecting");
});

unixOnlyTest("a broker that stops answering makes peer to peer unreachable, and invites go without the tunnel", async () => {
  const { p2p, devices, statuses } = host({ binary: fakeSidecar(`{"broker":"reached"}\n{"broker":"lost"}`) });
  const first = devices.invite();
  await p2p.invite(first.code, first.expiresAt, 200);
  for (const _ of Array(50)) if (p2p.peerToPeerStatus() !== "broker-unreachable") await Bun.sleep(20);
  expect(statuses).toEqual(["connecting", "ready", "broker-unreachable"]);
  const second = devices.invite();
  expect(await p2p.invite(second.code, second.expiresAt, 200)).toBeNull();
});

unixOnlyTest("a sidecar that couldn't be downloaded says so", async () => {
  const { p2p, devices } = host({ binary: join(folder, "bin", "sidecar"), download: { url: "http://127.0.0.1:9/sidecar", sha256: "0".repeat(64) } });
  const { code, expiresAt } = devices.invite();
  expect(await p2p.invite(code, expiresAt)).toBeNull();
  expect(p2p.peerToPeerStatus()).toBe("sidecar-unavailable");
});
