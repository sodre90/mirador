import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { tunnelIn } from "../shared/machines.ts";
import type { DeviceTunnel, InviteTunnel } from "../shared/tunnel.ts";
import { TOKEN_COOKIE } from "../shared/protocol.ts";
import { openSettings, signIn } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

/** mirador-p2p is built from its own repository, which only the owner's machines have; elsewhere this spec is skipped. */
const binary = process.env.MIRADOR_P2P_BINARY ?? join(homedir(), "prj", "mirador-p2p", "target", "debug", "mirador-p2p");
const sidecarBuilt = existsSync(binary);

const host = new TestHost({ environment: () => ({ MIRADOR_P2P_BINARY: binary, MIRADOR_P2P_BROKER: `localhost:${brokerPort}`, MIRADOR_P2P_BROKER_KEY: brokerKey }) });
const ends: ChildProcess[] = [];
let brokerPort = 0;
let brokerKey = "";

test.describe.configure({ mode: "serial" });
test.skip(!sidecarBuilt, `needs mirador-p2p at ${binary}`);

/** A private key and its public key, as mirador-p2p keygen prints them. */
function keyPair(name: string) {
  const [privateKey, publicKey] = spawnSync(binary, ["keygen"], { encoding: "utf8" }).stdout.trim().split("\n");
  const keyFile = join(host.root, "p2p-test", `${name}.key`);
  writeFileSync(keyFile, privateKey, { mode: 0o600 });
  return { keyFile, publicKey };
}

const freePort = () =>
  new Promise<number>((resolve) => {
    const server = createServer().listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });

function run(args: string[]) {
  const child = spawn(binary, args, { stdio: ["ignore", "ignore", "inherit"], env: { ...process.env, RUST_LOG: "warn" } });
  ends.push(child);
  return child;
}

/** A device's side of the tunnel, as the phone runs it: local connections to the returned port reach the host's web server. */
async function dial(keyFile: string, address: string, tunnel: InviteTunnel | DeviceTunnel) {
  const proxyPort = await freePort();
  const device = run([
    "dial",
    "--udp=127.0.0.1:0",
    `--key-file=${keyFile}`,
    `--address=${address}`,
    `--peer=${tunnel.hostKey}`,
    `--peer-address=${tunnel.hostAddress}`,
    `--broker=${tunnel.broker.address}`,
    `--broker-key=${tunnel.broker.key}`,
    `--forward=127.0.0.1:${proxyPort}=${tunnel.port}`,
  ]);
  return { device, origin: `http://127.0.0.1:${proxyPort}` };
}

/** The tunnel takes a moment to find the host through the broker, so the first request is tried until it gets an answer. */
async function throughTunnel(url: string, init: RequestInit = {}) {
  let failure: unknown;
  for (const deadline = Date.now() + 20_000; Date.now() < deadline; ) {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(3000) });
    } catch (error) {
      failure = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw failure;
}

test.beforeAll(async () => {
  mkdirSync(join(host.root, "p2p-test"), { recursive: true });
  const broker = keyPair("broker");
  brokerKey = broker.publicKey;
  brokerPort = await freePort();
  run(["broker", `--udp=127.0.0.1:${brokerPort}`, `--key-file=${broker.keyFile}`]);
  await host.start();
});

test.afterAll(async () => {
  ends.forEach((end) => end.kill());
  await host.stop();
  await host.cleanUp();
});

test("a device joins through the tunnel with an invite's one-time key, then reaches Mirador through it as itself alone", async ({ page, browser }) => {
  await signIn(page, host);
  const settings = await openSettings(page, "Devices");
  await settings.getByRole("button", { name: "Invite a device" }).click();
  const code = (await settings.locator(".invite-code").textContent())!;
  const link = (await settings.locator(".invite-link").textContent())!;
  const invite = tunnelIn(new URL(link).hash)!;

  await test.step("with no public address, the invite link points at the host's own address in the tunnel", () => {
    expect(new URL(link).origin).toBe(`http://[${invite.hostAddress}]:4600`);
    expect(invite.broker).toEqual({ address: `localhost:${brokerPort}`, key: brokerKey });
  });

  const joinKeyFile = join(host.root, "p2p-test", "join.key");
  writeFileSync(joinKeyFile, invite.joinKey, { mode: 0o600 });
  const joining = await dial(joinKeyFile, invite.joinAddress, invite);
  const phone = keyPair("phone");

  await test.step("the one-time key reaches joining alone, and joining through the tunnel needs the device's own key", async () => {
    expect((await throughTunnel(`${joining.origin}/mirador-here`)).status).toBe(404);
    const withoutKey = await throughTunnel(`${joining.origin}/join`, { method: "POST", body: JSON.stringify({ code, name: "Phone" }) });
    expect(withoutKey.status).toBe(400);
  });

  const joined = await throughTunnel(`${joining.origin}/join`, { method: "POST", body: JSON.stringify({ code, name: "Phone", tunnelKey: phone.publicKey }) });
  expect(joined.status).toBe(200);
  const { token, tunnel } = (await joined.json()) as { token: string; tunnel: DeviceTunnel };
  expect(tunnel).toMatchObject({ hostKey: invite.hostKey, hostAddress: invite.hostAddress, port: 4600 });
  joining.device.kill();

  const device = await dial(phone.keyFile, tunnel.deviceAddress, tunnel);
  const asDevice = { headers: { cookie: `${TOKEN_COOKIE}=${token}` } };

  await test.step("the device's own token works through its tunnel, the host's own token and no token do not", async () => {
    const browserToken = readFileSync(join(host.dataDir, "browser-token"), "utf8").trim();
    const register = (cookie: string | null) =>
      throughTunnel(`${device.origin}/tunnel`, { method: "POST", headers: cookie ? { cookie } : {}, body: JSON.stringify({ tunnelKey: phone.publicKey }) });
    expect((await register(`${TOKEN_COOKIE}=${token}`)).status).toBe(200);
    expect((await register(`${TOKEN_COOKIE}=${browserToken}`)).status).toBe(401);
    expect((await register(null)).status).toBe(401);
    expect((await throughTunnel(`${device.origin}/mirador-here`, asDevice)).status).toBe(200);
  });

  await test.step("Mirador opens through the tunnel, and the host lists the device as connected through it", async () => {
    const context = await browser.newContext();
    await context.addCookies([{ name: TOKEN_COOKIE, value: token, url: device.origin }]);
    const phonePage = await context.newPage();
    await phonePage.goto(device.origin);
    await expect(phonePage.getByRole("button", { name: "Settings…" })).toBeVisible();
    const phoneRow = settings.locator(".device-list li", { hasText: "Phone" });
    await expect(phoneRow).toHaveClass(/connected/);
    await expect(phoneRow.locator(".device-seen")).toHaveText(/from the peer-to-peer tunnel/);
    await context.close();
  });

  await test.step("a device that joined over the network takes its place in the tunnel with its token, and no other device's token works through it", async () => {
    await settings.getByRole("button", { name: "Invite a device" }).click();
    await expect(settings.locator(".invite-code")).not.toHaveText(code);
    const laptopCode = (await settings.locator(".invite-code").textContent())!;
    const overNetwork = await fetch(`${host.origin}/join`, { method: "POST", body: JSON.stringify({ code: laptopCode, name: "Laptop" }) });
    const { token: laptopToken } = (await overNetwork.json()) as { token: string };
    const laptop = keyPair("laptop");
    const asLaptop = { cookie: `${TOKEN_COOKIE}=${laptopToken}` };
    const registered = await fetch(`${host.origin}/tunnel`, { method: "POST", headers: asLaptop, body: JSON.stringify({ tunnelKey: laptop.publicKey }) });
    expect(registered.status).toBe(200);
    const laptopTunnel = (await registered.json()) as DeviceTunnel;
    expect(laptopTunnel.deviceAddress).not.toBe(tunnel.deviceAddress);
    const laptopEnd = await dial(laptop.keyFile, laptopTunnel.deviceAddress, laptopTunnel);
    const registerThroughLaptop = (cookie: string) =>
      throughTunnel(`${laptopEnd.origin}/tunnel`, { method: "POST", headers: { cookie }, body: JSON.stringify({ tunnelKey: laptop.publicKey }) });
    expect((await registerThroughLaptop(asLaptop.cookie)).status).toBe(200);
    expect((await registerThroughLaptop(`${TOKEN_COOKIE}=${token}`)).status).toBe(401);
    const stolenKey = await throughTunnel(`${device.origin}/tunnel`, { method: "POST", ...asDevice, body: JSON.stringify({ tunnelKey: laptop.publicKey }) });
    expect(stolenKey.status).toBe(409);
  });

  await test.step("once revoked, the device reaches nothing through the tunnel", async () => {
    const phoneRow = settings.locator(".device-list li", { hasText: "Phone" });
    await phoneRow.getByRole("button", { name: "Revoke Phone" }).click();
    await phoneRow.getByRole("button", { name: "Revoke Phone" }).click();
    await expect(phoneRow).toHaveCount(0);
    const afterRevoking = await fetch(`${device.origin}/mirador-here`, { signal: AbortSignal.timeout(5000) }).then(
      (response) => response.status,
      () => "no answer",
    );
    expect(afterRevoking).toBe("no answer");
  });
});
