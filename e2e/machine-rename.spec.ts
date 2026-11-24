import { expect, test } from "@playwright/test";
import { signIn } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const server = new TestHost();
const laptop = new TestHost();

test.beforeAll(async () => {
  await Promise.all([server.start(), laptop.start()]);
});
test.afterAll(async () => {
  await Promise.all([server.stop(), laptop.stop()]);
  await Promise.all([server.cleanUp(), laptop.cleanUp()]);
});

test("a machine is renamed from its rail menu and from Machines, for this computer, every page following", async ({ page, browser }) => {
  await signIn(page, laptop);
  await page.locator(".sidebar").getByRole("button", { name: "Machines…" }).click();
  const machines = page.getByRole("dialog", { name: "Machines" });
  await machines.getByLabel("Name").fill("Home server");
  await machines.getByLabel("Address or invite link").fill(server.origin);
  await machines.getByRole("button", { name: "Add", exact: true }).click();
  await expect(machines.locator(".machine-list li", { hasText: "Home server" })).toBeVisible();
  await machines.getByRole("button", { name: "Close" }).click();
  const rail = page.getByRole("navigation", { name: "Machines" });
  const railButton = (name: string) => rail.getByRole("button", { name });
  const renameFromRail = async (machine: string) => {
    await railButton(machine).click({ button: "right" });
    await page.getByRole("menu", { name: machine }).getByRole("menuitem", { name: "Rename…" }).click();
    return page.getByRole("dialog", { name: `Rename ${machine}` });
  };
  const otherPage = await (await browser.newContext()).newPage();
  await signIn(otherPage, laptop);
  const otherRail = otherPage.getByRole("navigation", { name: "Machines" });

  await test.step("the rail's menu renames it, the button's initials and hint follow, and another page of this host hears it", async () => {
    await expect(otherRail.getByRole("button", { name: "Home server" })).toBeVisible();
    const dialog = await renameFromRail("Home server");
    await dialog.getByLabel("Name").fill("Studio server");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(railButton("Studio server")).toContainText("SS");
    await expect(railButton("Studio server")).toHaveAttribute("data-hint", /^Studio server · /);
    await expect(otherRail.getByRole("button", { name: "Studio server" })).toBeVisible();
  });

  await test.step("the name stays after a reload", async () => {
    await page.reload();
    await expect(railButton("Studio server")).toBeVisible();
  });

  await test.step("Machines renames it too, its row and the rail following", async () => {
    await rail.getByRole("button", { name: "Machines…" }).click();
    const row = machines.locator(".machine-list li", { hasText: "Studio server" });
    await row.getByRole("button", { name: "Rename…" }).click();
    const dialog = page.getByRole("dialog", { name: "Rename Studio server" });
    await dialog.getByLabel("Name").fill("Workstation");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(machines.locator(".machine-list li", { hasText: "Workstation" })).toBeVisible();
    await expect(railButton("Workstation")).toBeVisible();
    await machines.getByRole("button", { name: "Close" }).click();
  });

  await test.step("Esc closes it from anywhere, an emptied name cannot be saved, and shortcuts stay out while it is open", async () => {
    const dialog = await renameFromRail("Workstation");
    await dialog.getByLabel("Name").fill("Discarded");
    await dialog.getByRole("heading", { name: "Rename Workstation" }).click();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(railButton("Workstation")).toBeVisible();
    const reopened = await renameFromRail("Workstation");
    await reopened.getByLabel("Name").fill("  ");
    await expect(reopened.getByRole("button", { name: "Save" })).toBeDisabled();
    await page.keyboard.press("Control+KeyK");
    await expect(page.getByRole("dialog", { name: "Palette" })).toHaveCount(0);
    await expect(reopened).toBeVisible();
    await reopened.getByRole("button", { name: "Cancel" }).click();
    await expect(railButton("Workstation")).toBeVisible();
  });

  await test.step("inside Machines…, Esc closes the rename dialog alone", async () => {
    await rail.getByRole("button", { name: "Machines…" }).click();
    const row = machines.locator(".machine-list li", { hasText: "Workstation" });
    await row.getByRole("button", { name: "Rename…" }).click();
    const dialog = page.getByRole("dialog", { name: "Rename Workstation" });
    await dialog.getByRole("heading", { name: "Rename Workstation" }).click();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(machines).toBeVisible();
    await machines.getByRole("button", { name: "Close" }).click();
  });

  await otherPage.context().close();
});

test("a name typed for a new machine is kept within what a machine's name may be", async ({ page }) => {
  const typed = "Far too long a machine name for the lists of devices";
  const kept = typed.slice(0, 40).trim();
  await signIn(page, laptop);
  await page.locator(".sidebar").getByRole("button", { name: "Machines…" }).click();
  const machines = page.getByRole("dialog", { name: "Machines" });
  /** Past what the field takes, as another Mirador's page or phone can send a longer name; the host keeps it short too. */
  await machines.getByLabel("Name").evaluate((element, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }, typed);
  await machines.getByLabel("Address or invite link").fill("http://127.0.0.1:9");
  await machines.getByRole("button", { name: "Add", exact: true }).click();
  await expect(machines.locator(".machine-name", { hasText: kept })).toHaveText(kept);
  await machines.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("navigation", { name: "Machines" }).getByRole("button", { name: kept })).toBeVisible();
});
