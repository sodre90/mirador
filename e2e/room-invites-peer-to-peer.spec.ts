import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { machineAddress } from "../shared/machines.ts";
import { addWorkspace, createProfile, openSettings, signIn } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

/** mirador-p2p is built from its own repository, which only the owner's machines have; elsewhere this spec is skipped. */
const binary = process.env.MIRADOR_P2P_BINARY ?? join(homedir(), "prj", "mirador-p2p", "target", "debug", "mirador-p2p");
const sidecarBuilt = existsSync(binary);

let brokerPort = 0;
let brokerKey = "";
const peerToPeer = () => ({ MIRADOR_P2P_BINARY: binary, MIRADOR_P2P_BROKER: `localhost:${brokerPort}`, MIRADOR_P2P_BROKER_KEY: brokerKey });
/** The owner's machine, which other machines reach at no address: only through its peer-to-peer tunnel. */
const owners = new TestHost({ fakePrograms: true, environment: peerToPeer });
/** The invited person's own Mirador, which dials the owner's tunnel itself. */
const visitors = new TestHost({ environment: peerToPeer });
let broker: ChildProcess | undefined;

test.describe.configure({ mode: "serial" });
test.skip(!sidecarBuilt, `needs mirador-p2p at ${binary}`);

const freePort = () =>
  new Promise<number>((resolve) => {
    const server = createServer().listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });

test.beforeAll(async () => {
  const folder = join(owners.root, "p2p-test");
  mkdirSync(folder, { recursive: true });
  const [privateKey, publicKey] = spawnSync(binary, ["keygen"], { encoding: "utf8" }).stdout.trim().split("\n");
  writeFileSync(join(folder, "broker.key"), privateKey!, { mode: 0o600 });
  brokerKey = publicKey!;
  brokerPort = await freePort();
  broker = spawn(binary, ["broker", `--udp=127.0.0.1:${brokerPort}`, `--key-file=${join(folder, "broker.key")}`], { stdio: ["ignore", "ignore", "inherit"], env: { ...process.env, RUST_LOG: "warn" } });
  writeBunProgram(owners.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"));
  await Promise.all([owners.start(), visitors.start()]);
});

test.afterAll(async () => {
  await Promise.all([owners.stop(), visitors.stop()]);
  broker?.kill();
  await Promise.all([owners.cleanUp(), visitors.cleanUp()]);
});

async function nameOwnProfile(page: Page, name: string) {
  const settings = await openSettings(page);
  await settings.getByLabel("Name", { exact: true }).fill(name);
  await settings.getByLabel("Name", { exact: true }).press("Enter");
  await settings.getByRole("button", { name: "Close" }).click();
}

/** The pids of the visitor's dials into machines' tunnels, by the files its host writes beside their keys. */
function visitorsDials() {
  const folder = join(visitors.dataDir, "machine-tunnels");
  return readdirSync(folder)
    .filter((file) => file.endsWith(".pid") && !file.startsWith("join-"))
    .map((file) => (JSON.parse(readFileSync(join(folder, file), "utf8")) as { pid: number }).pid);
}

/** The dial's whole command line, as ps shows it. */
const commandOf = (pid: number) => spawnSync("ps", ["-ww", "-o", "command=", "-p", String(pid)], { encoding: "utf8" }).stdout;

const isRunning = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test("a room invite's one link, pasted under Machines, joins the owner's machine through its tunnel and opens the room, which comes back after a restart", async ({ page, browser }) => {
  test.setTimeout(180_000);
  const roomMessages = page.locator(".room-timeline .room-entry .message");
  await signIn(page, owners);
  await nameOwnProfile(page, "Ann");
  const machineName = await openSettings(page, "Devices");
  await machineName.locator("input.machine-name").fill("Ann's Mac");
  await machineName.locator("input.machine-name").press("Enter");
  await machineName.getByRole("button", { name: "Close" }).click();
  const profiles = await createProfile(page, "Builder", "", "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await addWorkspace(page, owners.projectDir, "Builder · opencode");

  const link = await test.step("the owner makes a room and an invite, whose one link reaches the machine through its tunnel", async () => {
    await page.getByRole("button", { name: "New room" }).click();
    const create = page.getByRole("dialog", { name: "New room" });
    await create.getByLabel("Room name").fill("Garden");
    await create.getByLabel("Builder").check();
    await create.getByRole("button", { name: "Create room" }).click();
    await expect(page.getByRole("heading", { name: "# Garden" })).toBeVisible();
    await page.getByRole("button", { name: "Settings of Garden" }).click();
    const dialog = page.getByRole("dialog", { name: "Room settings" });
    await dialog.getByRole("button", { name: "Make an invite" }).click();
    const invite = dialog.getByRole("group", { name: "Invite code" });
    await expect(invite).toContainText("Send them this link. They paste it under Machines in their own Mirador, which joins this machine peer to peer:");
    await expect(invite.getByRole("button", { name: "Copy link" })).toBeVisible();
    const shown = (await invite.locator(".invite-link").textContent())!;
    const parsed = machineAddress(shown)!;
    expect(parsed.forRoom).toBe(true);
    expect(parsed.tunnel).toMatchObject({ name: "Ann's Mac", port: 4600, broker: { address: `localhost:${brokerPort}`, key: brokerKey } });
    expect(parsed.origin).toBe(`http://[${parsed.tunnel!.hostAddress}]:4600`);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    return shown;
  });

  const visitor = await browser.newPage();
  await signIn(visitor, visitors);
  await nameOwnProfile(visitor, "Dora");
  const frame = visitor.frameLocator('iframe[title="Ann\'s Mac"]');
  const composer = frame.getByRole("textbox", { name: "Write in Garden, @ tags an agent…" });
  const railButton = visitor.getByRole("navigation", { name: "Machines" }).getByRole("button", { name: "Ann's Mac" });

  await test.step("a link whose join through the tunnel fails adds nothing, so the person can paste the right one after it", async () => {
    await visitor.getByRole("button", { name: "Machines…" }).click();
    const machines = visitor.getByRole("dialog", { name: "Machines" });
    const code = machineAddress(link)!.joinCode!;
    const wrongLink = link.replace(code, `${code.slice(0, -1)}${code.endsWith("A") ? "B" : "A"}`);
    await machines.getByLabel("Address or invite link").fill(wrongLink);
    await machines.getByRole("button", { name: "Add and join" }).click();
    await expect(visitor.locator(".notice", { hasText: "Ann's Mac did not take it as one" })).toBeVisible({ timeout: 60_000 });
    await expect(machines.locator(".machine-list li", { hasText: "Ann's Mac" })).toHaveCount(0);
    await expect(machines.getByLabel("Address or invite link")).toHaveValue(wrongLink);
    await expect(machines.getByText("This machine is already in the list.")).toHaveCount(0);
    await machines.getByRole("button", { name: "Close" }).click();
  });

  await test.step("the person pastes the link under Machines, with no name or address to give, and is in the room", async () => {
    await visitor.getByRole("button", { name: "Machines…" }).click();
    const machines = visitor.getByRole("dialog", { name: "Machines" });
    await machines.getByLabel("Address or invite link").fill(link);
    await expect(machines.getByLabel("Name")).toHaveAttribute("placeholder", "Ann's Mac");
    await machines.getByRole("button", { name: "Add and join" }).click();
    await expect(machines).toHaveCount(0, { timeout: 60_000 });
    await expect(railButton).toHaveAttribute("aria-current", "true");
    await expect(railButton).toHaveClass(/someone-elses/);
    await expect(railButton).toHaveAttribute("data-hint", /peer to peer/);
    await expect(visitor.locator('iframe[title="Ann\'s Mac"]')).toHaveAttribute("sandbox", "allow-scripts allow-forms");
    await expect(frame.getByRole("heading", { name: "# Garden" })).toBeVisible();
  });

  await test.step("a message the person writes, the owner reads with their name", async () => {
    await composer.fill("Hello through the tunnel");
    await composer.press("Enter");
    await expect(roomMessages).toHaveText(["Hello through the tunnel"]);
    await expect(page.locator(".room-timeline .room-entry .author")).toContainText(["Dora"]);
    await expect(frame.locator(".room-timeline .room-entry .message")).toHaveText(["Hello through the tunnel"]);
  });

  await test.step("the owner sees the person's Mirador among the devices, in rooms only", async () => {
    const settings = await openSettings(page, "Devices");
    await expect(settings.locator(".device-list li", { hasText: "Mirador on " }).locator(".device-person")).toHaveText("Dora, in rooms only");
    await settings.getByRole("button", { name: "Close" }).click();
  });

  const [dialBefore] = visitorsDials();
  expect(dialBefore).toBeDefined();

  const dialsFromSockets = process.platform !== "win32";
  await test.step("the person's Mirador reaches the machine through sockets in a folder only its account can enter, at no port of the loopback", async () => {
    if (!dialsFromSockets) return;
    const forwards = commandOf(dialBefore!).match(/--forward=\S+/g) ?? [];
    const socketFolder = join(visitors.dataDir, "machine-tunnels");
    expect(forwards).toHaveLength(2);
    forwards.forEach((forward) => expect(forward.startsWith(`--forward=unix:${socketFolder}/d`)).toBe(true));
    const [socketsOfDial] = readdirSync(socketFolder, { withFileTypes: true }).filter((entry) => entry.isDirectory());
    expect(statSync(join(socketFolder, socketsOfDial!.name)).mode & 0o777).toBe(0o700);
    expect(readdirSync(join(socketFolder, socketsOfDial!.name)).sort()).toEqual(["c", "w"]);
  });

  await test.step("killed and started again, the person's Mirador stops the dial it left behind and reaches the room through a new one", async () => {
    await visitors.kill();
    await visitors.start();
    await expect.poll(() => isRunning(dialBefore!), { timeout: 15_000 }).toBe(false);
    await expect.poll(visitorsDials).toHaveLength(1);
    expect(visitorsDials()).not.toContain(dialBefore);
    await visitor.reload();
    await railButton.click();
    await frame.locator(".sidebar .rooms li").filter({ hasText: "# Garden" }).click({ timeout: 60_000 });
    await expect(frame.locator(".room-timeline .room-entry .message")).toHaveText(["Hello through the tunnel"]);
    await composer.fill("Back after a restart");
    await composer.press("Enter");
    await expect(roomMessages).toHaveText(["Hello through the tunnel", "Back after a restart"]);
  });

  await test.step("with the owner's machine restarted, the person's Mirador reaches the room through the same tunnel again", async () => {
    await owners.restart();
    await page.reload();
    await visitor.reload();
    await railButton.click();
    await frame.locator(".sidebar .rooms li").filter({ hasText: "# Garden" }).click({ timeout: 60_000 });
    await expect(frame.locator(".room-timeline .room-entry .message")).toHaveText(["Hello through the tunnel", "Back after a restart"]);
    await composer.fill("And after the owner's restart");
    await composer.press("Enter");
    await page.getByRole("button", { name: "# Garden" }).or(page.locator(".sidebar .rooms li", { hasText: "# Garden" })).first().click();
    await expect(roomMessages).toHaveText(["Hello through the tunnel", "Back after a restart", "And after the owner's restart"]);
  });

  await test.step("removed from the person's Mirador, the machine's dial and key go with it", async () => {
    await visitor.getByRole("button", { name: "Machines…" }).click();
    const machines = visitor.getByRole("dialog", { name: "Machines" });
    const row = machines.locator(".machine-list li", { hasText: "Ann's Mac" });
    await expect(row.locator(".machine-origin")).toHaveText("peer to peer");
    const [dial] = visitorsDials();
    await row.getByRole("button", { name: "Remove Ann's Mac" }).click();
    await row.getByRole("button", { name: "Confirm: Remove Ann's Mac" }).click();
    await expect(row).toHaveCount(0);
    await expect.poll(() => isRunning(dial!)).toBe(false);
    expect(readdirSync(join(visitors.dataDir, "machine-tunnels"))).toEqual([]);
  });
  await visitor.close();
});
