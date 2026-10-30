import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { DeviceService } from "../host/devices.ts";
import { hostAddressIn, isTunnelKey, newDeviceAddress, newKeyPair, tunnelIdentity } from "../host/p2p/identity.ts";
import { PeerToPeer, peerToPeerSettings, type TunnelEnd } from "../host/p2p/service.ts";
import { Sidecar } from "../host/p2p/sidecar.ts";
import { Store } from "../host/store.ts";

const brokerKey = newKeyPair().publicKey;
let folder: string;
let commandsFile: string;
let p2p: PeerToPeer | null = null;

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "p2p-"));
  commandsFile = join(folder, "commands");
  writeFileSync(commandsFile, "");
});

afterEach(() => {
  p2p?.stop();
  p2p = null;
  rmSync(folder, { recursive: true, force: true });
});

/** Stands in for mirador-p2p: it writes down the commands it reads, as the real one acts on them. */
function fakeSidecar() {
  const binary = join(folder, "fake-sidecar");
  writeFileSync(binary, `#!/bin/sh\ncat >> '${commandsFile}'\n`);
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

function host() {
  const store = new Store(":memory:");
  const devices = new DeviceService(store);
  const listening = new Map<string, TunnelEnd>();
  const settings = { binary: fakeSidecar(), broker: { address: "203.0.113.7:47800", key: brokerKey } };
  p2p = new PeerToPeer(settings, join(folder, "p2p"), store, Date.now, 50);
  p2p.start((socket, end) => {
    listening.set(socket, end);
    return { stop: () => listening.delete(socket) };
  });
  return { p2p, store, devices, listening };
}

test("peer to peer is off unless the environment names the sidecar and the broker together", () => {
  expect(peerToPeerSettings({})).toBeNull();
  expect(() => peerToPeerSettings({ MIRADOR_P2P_BINARY: "/bin/mirador-p2p" })).toThrow(/together/);
  expect(() => peerToPeerSettings({ MIRADOR_P2P_BINARY: "/bin/mirador-p2p", MIRADOR_P2P_BROKER: "203.0.113.7:47800", MIRADOR_P2P_BROKER_KEY: "nope" })).toThrow(/not a key/);
  expect(peerToPeerSettings({ MIRADOR_P2P_BINARY: "/bin/mirador-p2p", MIRADOR_P2P_BROKER: "203.0.113.7:47800", MIRADOR_P2P_BROKER_KEY: brokerKey })).toEqual({
    binary: "/bin/mirador-p2p",
    broker: { address: "203.0.113.7:47800", key: brokerKey },
  });
});

test("the host's tunnel identity is made once, kept from other accounts, and the same after a restart", () => {
  const identity = tunnelIdentity(join(folder, "identity"));
  expect(statSync(join(folder, "identity")).mode & 0o777).toBe(0o700);
  expect(statSync(identity.keyFile).mode & 0o777).toBe(0o600);
  expect(isTunnelKey(readFileSync(identity.keyFile, "utf8"))).toBe(true);
  expect(isTunnelKey(identity.publicKey)).toBe(true);
  expect(identity.prefix).toMatch(/^fd[0-9a-f]{2}(:[0-9a-f]{1,4}){2}$/);
  expect(tunnelIdentity(join(folder, "identity"))).toEqual(identity);
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

test("a device that sends its key is let in on a socket of its own, and keeps its address when its key changes", async () => {
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

test("a revoked device is let in no more, and its listener closes", async () => {
  const { p2p, devices, listening } = host();
  const { device } = devices.admit("Phone");
  const key = newKeyPair().publicKey;
  p2p.register(device.id, key);
  p2p.forget(device.id);
  devices.revoke(device.id);
  expect([...listening.values()].some((end) => "deviceId" in end)).toBe(false);
  expect((await commandsRead(2)).at(-1)).toEqual({ unpin: { key } });
});

test("an invite's one-time key reaches only the joining socket, until shortly after the invite is used", async () => {
  const { p2p, devices, listening } = host();
  const { code, expiresAt } = devices.invite();
  const tunnel = p2p.invite(code, expiresAt);
  const joinSocket = [...listening].find(([, end]) => "joining" in end)?.[0];
  const [pinned] = await commandsRead(1);
  expect(pinned.pin).toMatchObject({ address: tunnel.joinAddress, socket: joinSocket });
  expect(isTunnelKey(tunnel.joinKey)).toBe(true);
  expect(tunnel.name).toBe(hostname().replace(/\.local$/, ""));
  expect(p2p.refusedKey(pinned.pin.key)).not.toBeNull();
  p2p.inviteUsed(code.toLowerCase());
  expect((await commandsRead(2))[1]).toEqual({ unpin: { key: pinned.pin.key } });
});

test("an invite's one-time key is let in no more once the invite expires", async () => {
  const { p2p, devices } = host();
  const { code } = devices.invite();
  p2p.invite(code, Date.now() + 50);
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

test("paired devices are let in again when the host starts", async () => {
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
