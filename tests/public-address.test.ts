import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { configFilePath, loadConfig, localNetworkName, reachability, savedNetwork, saveNetwork, savedPublicAddress, savePublicAddress } from "../host/config.ts";
import { Store } from "../host/store.ts";

const box = { origin: "https://box.example.ts.net", canvasOrigin: "https://box.example.ts.net:8443" };
const environmentAddress = { MIRADOR_PUBLIC_ORIGIN: "https://env.example.com", MIRADOR_PUBLIC_CANVAS_ORIGIN: "https://env.example.com:8443" };
const launcher = join(import.meta.dir, "..", "bin", "mirador");

let dataDir: string;
beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "mirador-address-"));
});
afterEach(() => rmSync(dataDir, { recursive: true, force: true }));

const writeConfigFile = (settings: unknown) => writeFileSync(configFilePath(dataDir), JSON.stringify(settings));

function mirador(args: string[], environment: Record<string, string> = {}) {
  const { MIRADOR_PUBLIC_ORIGIN: _origin, MIRADOR_PUBLIC_CANVAS_ORIGIN: _canvasOrigin, ...inherited } = process.env;
  const result = Bun.spawnSync([launcher, ...args], { env: { ...inherited, MIRADOR_DATA_DIR: dataDir, ...environment } });
  return { exitCode: result.exitCode, output: `${result.stdout}${result.stderr}` };
}

test("the host takes its public address from config.json, unless the environment sets one", () => {
  writeConfigFile({ publicOrigin: `${box.origin}/`, publicCanvasOrigin: box.canvasOrigin });
  expect(loadConfig({ MIRADOR_DATA_DIR: dataDir })).toMatchObject({
    publicOrigin: box.origin,
    canvasAssetsOrigin: box.canvasOrigin,
    reachability: { publicAddressSetByEnvironment: false },
  });
  expect(loadConfig({ MIRADOR_DATA_DIR: dataDir, ...environmentAddress })).toMatchObject({
    publicOrigin: "https://env.example.com",
    canvasAssetsOrigin: "https://env.example.com:8443",
    reachability: { publicAddressSetByEnvironment: true },
  });
});

test("config.json needs both addresses, each a web address, and must be a JSON object", () => {
  writeConfigFile({ publicOrigin: box.origin });
  expect(() => loadConfig({ MIRADOR_DATA_DIR: dataDir })).toThrow(`${configFilePath(dataDir)}: Set both publicOrigin and publicCanvasOrigin, or neither.`);
  writeConfigFile({ publicOrigin: "ftp://box", publicCanvasOrigin: box.canvasOrigin });
  expect(() => loadConfig({ MIRADOR_DATA_DIR: dataDir })).toThrow(`${configFilePath(dataDir)}: publicOrigin must be a web address`);
  writeFileSync(configFilePath(dataDir), "{ not json");
  expect(() => loadConfig({ MIRADOR_DATA_DIR: dataDir })).toThrow(/must hold a JSON object/);
});

test("saving the address keeps the rest of config.json, and saving none takes it out", () => {
  writeConfigFile({ somethingElse: 1 });
  savePublicAddress(dataDir, box);
  expect(savedPublicAddress(dataDir)).toEqual(box);
  savePublicAddress(dataDir, null);
  expect(savedPublicAddress(dataDir)).toBeNull();
  expect(JSON.parse(readFileSync(configFilePath(dataDir), "utf8"))).toEqual({ somethingElse: 1 });
});

test("the store remembers the address the host runs with, and forgets it when there is none", () => {
  const store = new Store(":memory:");
  expect(store.rememberedPublicAddress()).toBeNull();
  store.rememberPublicAddress(box);
  expect(store.rememberedPublicAddress()).toEqual(box);
  store.rememberPublicAddress(null);
  expect(store.rememberedPublicAddress()).toBeNull();
});

test("mirador invite prints a link to the address from the environment, config.json, or the one the running host remembered", () => {
  const linkTo = (origin: string) => new RegExp(`Open it on the device that joins: ${origin}/#/join/[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}`);

  const withoutAddress = mirador(["invite"]);
  expect(withoutAddress.exitCode).toBe(0);
  expect(withoutAddress.output).toMatch(/Invite code: [A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4} \(works once, for 15 minutes\)/);
  expect(withoutAddress.output).toContain("give this machine its address in Settings → Devices");

  const store = new Store(join(dataDir, "state.sqlite"));
  store.rememberPublicAddress({ origin: "https://remembered.example.com", canvasOrigin: "https://remembered.example.com:8443" });
  store.close();
  expect(mirador(["invite"]).output).toMatch(linkTo("https://remembered.example.com"));

  savePublicAddress(dataDir, box);
  expect(mirador(["invite"]).output).toMatch(linkTo(box.origin));
  expect(mirador(["invite"], environmentAddress).output).toMatch(linkTo("https://env.example.com"));
});

test("mirador without a known command shows its usage", () => {
  expect(mirador([])).toMatchObject({ exitCode: 0, output: expect.stringContaining("usage: mirador <command>") });
  const unknown = mirador(["frobnicate"]);
  expect(unknown.exitCode).toBe(2);
  expect(unknown.output).toContain('mirador: unknown command "frobnicate"');
});

test("on the network, the host listens on its port plus 2 and 3 and is reached at its local network name, unless an address is set", () => {
  expect(reachability({}, dataDir, 4600).network).toBeNull();
  saveNetwork(dataDir, true);
  expect(savedNetwork(dataDir)).toBe(true);
  const onTheNetwork = reachability({}, dataDir, 4600);
  expect(onTheNetwork).toMatchObject({ network: { port: 4602, canvasPort: 4603, ownCertificate: null }, networkSetByEnvironment: false });
  expect(onTheNetwork.publicAddress).toEqual({ origin: `https://${localNetworkName()}:4602`, canvasOrigin: `https://${localNetworkName()}:4603` });

  savePublicAddress(dataDir, box);
  expect(reachability({}, dataDir, 4600).publicAddress).toEqual(box);
  expect(reachability({ MIRADOR_NETWORK: "off" }, dataDir, 4600)).toMatchObject({ network: null, networkSetByEnvironment: true });
  expect(reachability({ MIRADOR_NETWORK: "on", MIRADOR_NETWORK_PORT: "7000" }, dataDir, 4600).network).toMatchObject({ port: 7000, canvasPort: 7001 });

  saveNetwork(dataDir, false);
  expect(JSON.parse(readFileSync(configFilePath(dataDir), "utf8"))).toEqual({ publicOrigin: box.origin, publicCanvasOrigin: box.canvasOrigin });
});

test("the owner's certificate needs both files, found from the data directory when the paths are relative", () => {
  const keyPath = resolve(sep, "etc", "mirador", "mine-key.pem");
  writeConfigFile({ network: true, tlsCertificate: "tls/mine.pem", tlsKey: keyPath });
  expect(reachability({}, dataDir, 4600).network?.ownCertificate).toEqual({ certificatePath: join(dataDir, "tls/mine.pem"), keyPath });
  writeConfigFile({ network: true, tlsCertificate: "tls/mine.pem" });
  expect(() => reachability({}, dataDir, 4600)).toThrow(`Set both tlsCertificate and tlsKey in ${configFilePath(dataDir)}, or neither.`);
  expect(() => reachability({ MIRADOR_NETWORK: "maybe" }, dataDir, 4600)).toThrow("MIRADOR_NETWORK must be on or off.");
});

test("a machine without a domain is reached at its name with .local on the local network", () => {
  expect(localNetworkName("home-server")).toBe("home-server.local");
  expect(localNetworkName("perdos-mac.local")).toBe("perdos-mac.local");
  expect(localNetworkName("devbox.corp.example.com")).toBe("devbox.corp.example.com");
});
