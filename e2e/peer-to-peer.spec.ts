import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { tunnelIn } from "../shared/machines.ts";
import type { DeviceTunnel, InviteTunnel } from "../shared/tunnel.ts";
import { TOKEN_COOKIE } from "../shared/protocol.ts";
import { addWorkspace, callCanvasTool, openSettings, signIn, startConversation } from "./helpers.ts";
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

const freePort = (port = 0) =>
  new Promise<number | null>((resolve) => {
    const server = createServer()
      .once("error", () => resolve(null))
      .listen(port, "127.0.0.1", () => {
        const { port } = server.address() as { port: number };
        server.close(() => resolve(port));
      });
  });

/** A free port with a free one above it, for the canvas server's proxy. */
async function freePortPair() {
  for (;;) {
    const port = (await freePort())!;
    if (port < 65535 && (await freePort(port + 1))) return port;
  }
}

function run(args: string[]) {
  const child = spawn(binary, args, { stdio: ["ignore", "ignore", "inherit"], env: { ...process.env, RUST_LOG: "warn" } });
  ends.push(child);
  return child;
}

/**
 * A device's side of the tunnel, as the phone runs it: local connections to the returned port reach the host's web
 * server, and to the port above it, the host's canvas server.
 */
async function dial(keyFile: string, address: string, tunnel: InviteTunnel | DeviceTunnel) {
  const proxyPort = await freePortPair();
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
    ...(tunnel.canvasPort ? [`--forward=127.0.0.1:${proxyPort + 1}=${tunnel.canvasPort}`] : []),
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
  cpSync(join(import.meta.dirname, "..", "tests", "fixtures", "canvas-plugins", "board"), join(host.dataDir, "plugins", "board"), { recursive: true });
  const broker = keyPair("broker");
  brokerKey = broker.publicKey;
  brokerPort = (await freePort())!;
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

  await test.step("with no public address, the invite link points at the host's own address in the tunnel", async () => {
    await expect(settings.getByRole("radiogroup", { name: "How the device joins" })).toHaveCount(0);
    await expect(settings.getByLabel("Invite")).toContainText("The app connects straight to this Mac from most networks");
    expect(new URL(link).origin).toBe(`http://[${invite.hostAddress}]:4600`);
    expect(invite.broker).toEqual({ address: `localhost:${brokerPort}`, key: brokerKey });
  });

  const joinKeyFile = join(host.root, "p2p-test", "join.key");
  writeFileSync(joinKeyFile, invite.joinKey, { mode: 0o600 });
  const joining = await dial(joinKeyFile, invite.joinAddress, invite);
  const phone = keyPair("phone");

  await test.step("the one-time key reaches joining and the canvas server alone, and joining through the tunnel needs the device's own key", async () => {
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

  await test.step("a canvas page and a plugin's view on the device load from the host's canvas server, through the tunnel", async () => {
    expect(tunnel.canvasPort).toBe(4601);
    const hostPage = await page.context().newPage();
    await hostPage.goto(host.origin);
    await addWorkspace(hostPage, host.projectDir);
    const conversationId = await startConversation(hostPage);
    const hostsCanvas = `http://127.0.0.1:${host.port + 1}`;
    const html = `<div id="out"></div><script src="${hostsCanvas}/d3.min.js"></script><script>document.getElementById("out").textContent = "d3 " + d3.version;</script>`;
    await callCanvasTool(host, conversationId, "show", { title: "Through the tunnel", html });
    const context = await browser.newContext();
    await context.addCookies([{ name: TOKEN_COOKIE, value: token, url: device.origin }]);
    const phonePage = await context.newPage();
    await phonePage.goto(`${device.origin}/#/c/${conversationId}`);
    const canvasFrame = phonePage.locator(".canvas-panel:visible .canvas-frame.show iframe");
    const devicesCanvas = `http://127.0.0.1:${Number(new URL(device.origin).port) + 1}`;
    await expect(canvasFrame.contentFrame().locator("#out")).toHaveText(/^d3 7/);
    expect(new URL((await canvasFrame.getAttribute("src"))!).origin).toBe(devicesCanvas);
    await callCanvasTool(host, conversationId, "show_card", { title: "Card", text: "Drawn by the plugin" });
    const pluginFrame = phonePage.locator(".canvas-panel:visible .canvas-body > .canvas-frame.plugin iframe");
    await expect(pluginFrame.contentFrame().locator("#text")).toHaveText("Drawn by the plugin (pressed 0 times)");
    expect(new URL((await pluginFrame.getAttribute("src"))!).origin).toBe(devicesCanvas);
    await context.close();
    await hostPage.close();
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

test("with an address of its own as well, an invite joins peer to peer unless the address is chosen", async ({ page }) => {
  const addressed = new TestHost({
    environment: () => ({
      MIRADOR_P2P_BINARY: binary,
      MIRADOR_P2P_BROKER: `localhost:${brokerPort}`,
      MIRADOR_P2P_BROKER_KEY: brokerKey,
      MIRADOR_PUBLIC_ORIGIN: "https://mirador.example.ts.net",
      MIRADOR_PUBLIC_CANVAS_ORIGIN: "https://mirador.example.ts.net:4601",
    }),
  });
  await addressed.start();
  try {
    await signIn(page, addressed);
    const settings = await openSettings(page, "Devices");
    await settings.getByRole("button", { name: "Invite a device" }).click();
    const invite = settings.getByLabel("Invite");
    const link = invite.locator(".invite-link");
    const routes = invite.getByRole("radiogroup", { name: "How the device joins" });

    await expect(routes.getByRole("radio", { name: "Peer to peer, with the Mirador app" })).toBeChecked();
    await expect(invite).toContainText("from most networks, over mobile data or another Wi-Fi, with no VPN");
    await expect(invite).toContainText("Scan this with the Mirador app on a phone.");
    await expect(link).toBeHidden();
    await invite.getByText("Show the link").click();
    await expect(link).toBeVisible();
    await expect(link).toHaveText(/^http:\/\/\[fd/);
    const tunnel = tunnelIn(new URL((await link.textContent())!).hash)!;
    expect(new URL((await link.textContent())!).origin).toBe(`http://[${tunnel.hostAddress}]:4600`);

    await routes.getByRole("radio", { name: "At mirador.example.ts.net" }).check();
    await expect(link).toHaveText(/^https:\/\/mirador\.example\.ts\.net\//);
    expect(tunnelIn(new URL((await link.textContent())!).hash)).toBeNull();
    await expect(invite).toContainText("A browser or the app joins at mirador.example.ts.net");
    await expect(invite).toContainText("or open");
  } finally {
    await addressed.stop();
    await addressed.cleanUp();
  }
});
