import { expect, test } from "@playwright/test";
import { openSettings, signIn } from "./helpers.ts";
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

test("a machine is renamed from its rail menu and from Machines, on this computer alone", async ({ page, browser }) => {
  const serverPage = await browser.newPage();
  await signIn(serverPage, server);
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

  await test.step("the rail's menu renames it, and the button's initials and hint follow", async () => {
    const dialog = await renameFromRail("Home server");
    await dialog.getByLabel("Name").fill("Studio server");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(railButton("Studio server")).toContainText("SS");
    await expect(railButton("Studio server")).toHaveAttribute("data-hint", /^Studio server · /);
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

  await test.step("Esc leaves the name as it was, and an emptied name cannot be saved", async () => {
    const dialog = await renameFromRail("Workstation");
    await dialog.getByLabel("Name").fill("Discarded");
    await dialog.getByLabel("Name").press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(railButton("Workstation")).toBeVisible();
    const reopened = await renameFromRail("Workstation");
    await reopened.getByLabel("Name").fill("  ");
    await expect(reopened.getByRole("button", { name: "Save" })).toBeDisabled();
    await reopened.getByRole("button", { name: "Cancel" }).click();
    await expect(railButton("Workstation")).toBeVisible();
  });

  await test.step("the machine's own Settings keep its own name", async () => {
    const ownName = (await openSettings(serverPage, "Devices")).getByLabel("Name", { exact: true });
    await expect(ownName).toHaveValue("");
    await serverPage.close();
  });
});
