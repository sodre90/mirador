import { expect, test, type Locator, type Page } from "@playwright/test";
import { openSettings, signIn } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const serverA = new TestHost();
const serverB = new TestHost();
const laptop = new TestHost();

test.beforeAll(async () => {
  await Promise.all([serverA.start(), serverB.start(), laptop.start()]);
});
test.afterAll(async () => {
  await Promise.all([serverA.stop(), serverB.stop(), laptop.stop()]);
  await Promise.all([serverA.cleanUp(), serverB.cleanUp(), laptop.cleanUp()]);
});

async function inviteCode(page: Page, host: TestHost) {
  await signIn(page, host);
  const invite = await openSettings(page, "Devices");
  await invite.getByRole("button", { name: "Invite a device" }).click();
  return (await invite.locator(".invite-code").textContent())!;
}

async function addMachine(machines: Locator, name: string, origin: string) {
  await machines.getByLabel("Name").fill(name);
  await machines.getByLabel("Address or invite link").fill(origin);
  await machines.getByRole("button", { name: "Add", exact: true }).click();
  await expect(machines.locator(".machine-list li", { hasText: name })).toBeVisible();
}

test("a rename that reorders the rail leaves an open machine's page on what it showed", async ({ page, browser }) => {
  const serverAPage = await (await browser.newContext()).newPage();
  const serverBPage = await (await browser.newContext()).newPage();
  const codeA = await inviteCode(serverAPage, serverA);
  const codeB = await inviteCode(serverBPage, serverB);
  await signIn(page, laptop);
  const machines = page.getByRole("dialog", { name: "Machines" });
  const rail = page.getByRole("navigation", { name: "Machines" });

  const join = async (name: string, code: string) => {
    await page.locator(".sidebar").getByRole("button", { name: "Machines…" }).click();
    await machines.locator(".machine-list li", { hasText: name }).getByRole("button", { name: "Open", exact: true }).click();
    const panel = page.getByRole("region", { name: `Join ${name}` });
    await panel.getByLabel("Invite code or link").fill(code);
    await panel.getByRole("button", { name: "Join", exact: true }).click();
    await expect(page.frameLocator(`iframe[title="${name}"]`).getByRole("button", { name: "Settings…" })).toBeVisible();
    await rail.getByRole("button", { name: "This computer" }).click();
  };

  await page.locator(".sidebar").getByRole("button", { name: "Machines…" }).click();
  await addMachine(machines, "Able", serverA.origin);
  await addMachine(machines, "Beta", serverB.origin);
  await machines.getByRole("button", { name: "Close" }).click();
  await join("Able", codeA);
  await join("Beta", codeB);

  const ableFrame = page.frameLocator('iframe[title="Able"]');
  await rail.getByRole("button", { name: "Able" }).click();
  await ableFrame.getByRole("button", { name: "Settings…" }).click();
  await expect(ableFrame.getByRole("dialog", { name: "Settings" })).toBeVisible();

  await test.step("Beta renamed to Aaa moves both frames, and Able keeps its open Settings", async () => {
    await rail.getByRole("button", { name: "Beta" }).click({ button: "right" });
    await page.getByRole("menu", { name: "Beta" }).getByRole("menuitem", { name: "Rename…" }).click();
    const dialog = page.getByRole("dialog", { name: "Rename Beta" });
    await dialog.getByLabel("Name").fill("Aaa");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('iframe[title="Aaa"]')).toHaveCount(1);
    await expect(ableFrame.getByRole("dialog", { name: "Settings" })).toBeVisible();
  });

  await serverAPage.context().close();
  await serverBPage.context().close();
});
