import { join } from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { openSettings, signIn } from "./helpers.ts";
import { spawnProgramSync, TestHost } from "./test-host.ts";

const host = new TestHost();

test.beforeAll(() => host.start());
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

/** What `tailscale serve` adds to each request it passes on to the host. */
const viaTailscale = { "x-forwarded-for": "100.101.5.7", "tailscale-user-login": "someone@github" };

/** Windows runs no script without an extension, so there Mirador's command line is mirador.cmd. */
const mirador = join(import.meta.dirname, "..", "bin", process.platform === "win32" ? "mirador.cmd" : "mirador");

function miradorDevices() {
  const run = spawnProgramSync(mirador, ["devices"], {
    env: { ...process.env, MIRADOR_DATA_DIR: host.dataDir, MIRADOR_PORT: String(host.port) },
    encoding: "utf8",
  });
  expect(run.stderr).toBe("");
  return run.stdout;
}

async function joinAsPhone(browser: Browser, code: string) {
  const phone = await browser.newContext({ extraHTTPHeaders: viaTailscale });
  const page = await phone.newPage();
  await page.goto(host.origin);
  await page.getByLabel("Name this device").fill("Phone");
  await page.getByLabel("Invite code").fill(code);
  await page.getByRole("button", { name: "Join", exact: true }).click();
  await expect(page.getByRole("button", { name: "Settings…" })).toBeVisible();
  return { phone, page };
}

async function invite(page: Page) {
  const settings = await openSettings(page, "Devices");
  await settings.getByRole("button", { name: "Invite a device" }).click();
  const code = (await settings.locator(".invite-code").textContent())!;
  await settings.getByRole("button", { name: "Close" }).click();
  return code;
}

test("the devices connected now show in the sidebar, in Settings → Devices with where they connect from, and in mirador devices", async ({ page, browser }) => {
  await signIn(page, host);
  const inSidebar = page.locator(".sidebar .connected-devices");
  const phoneRow = (settings = page.getByRole("dialog", { name: "Settings" })) => settings.locator(".device-list li", { hasText: "Phone" });
  await expect(inSidebar).toHaveCount(0);
  expect(miradorDevices()).toContain("No device has joined this Mirador yet.");

  const { phone, page: phonePage } = await joinAsPhone(browser, await invite(page));

  await test.step("the sidebar counts it, and its hint names it", async () => {
    await expect(inSidebar).toHaveText("1 device connected");
    await expect(inSidebar).toHaveAttribute("data-hint", /^Connected now: Phone\./);
    await expect(phonePage.locator(".sidebar .connected-devices")).toHaveCount(0);
  });

  await test.step("Settings → Devices says it is connected, with how many pages, from its address and Tailscale login", async () => {
    await inSidebar.click();
    const settings = page.getByRole("dialog", { name: "Settings" });
    await expect(settings.getByRole("tab", { name: "Devices" })).toHaveAttribute("aria-selected", "true");
    await expect(phoneRow(settings)).toHaveClass(/connected/);
    await expect(phoneRow(settings).locator(".device-seen")).toHaveText(/^connected now, 1 page open · from 100\.101\.5\.7 \(someone@github\) · joined /);
    const secondPage = await phone.newPage();
    await secondPage.goto(host.origin);
    await expect(phoneRow(settings).locator(".device-seen")).toHaveText(/^connected now, 2 pages open/);
    await secondPage.close();
    await expect(phoneRow(settings).locator(".device-seen")).toHaveText(/^connected now, 1 page open/);
  });

  await test.step("mirador devices prints the same", async () => {
    expect(miradorDevices()).toMatch(/^Phone {3}connected now, 1 page open {3}from 100\.101\.5\.7 \(someone@github\) {3}joined .+\n$/);
  });

  await test.step("the sidebar line can be switched off, in this browser", async () => {
    const settings = page.getByRole("dialog", { name: "Settings" });
    await settings.getByLabel("Show the connected devices in the sidebar").uncheck();
    await settings.getByRole("button", { name: "Close" }).click();
    await expect(inSidebar).toHaveCount(0);
    await page.reload();
    await expect(page.getByText("No conversation selected")).toBeVisible();
    await expect(inSidebar).toHaveCount(0);
    await (await openSettings(page, "Devices")).getByLabel("Show the connected devices in the sidebar").check();
    await expect(inSidebar).toHaveText("1 device connected");
  });

  await test.step("once it leaves, it is last seen then, and the sidebar line goes", async () => {
    await phone.close();
    await expect(phoneRow().locator(".device-seen")).toHaveText(/^last seen (this minute|now|\d+ minutes? ago) · joined /);
    await expect(phoneRow()).not.toHaveClass(/connected/);
    await expect(inSidebar).toHaveCount(0);
    expect(miradorDevices()).toMatch(/^Phone {3}last seen .+ {3}joined .+\n$/);
  });

  await test.step("with Mirador stopped, mirador devices says so and still lists when each was last seen", async () => {
    await host.stop();
    const printed = miradorDevices();
    expect(printed).toContain(`Mirador is not running at ${host.origin}, so no device is connected to it.`);
    expect(printed).toMatch(/\nPhone {3}last seen .+ {3}joined .+\n$/);
    await host.start();
  });
});
