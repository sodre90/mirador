import { expect, test, type Locator } from "@playwright/test";
import { chooseInSettings, openSettings, signIn } from "./helpers.ts";
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

const backgroundOf = (element: Locator) => element.evaluate((each) => getComputedStyle(each).backgroundColor);
const borderOf = (element: Locator) => element.evaluate((each) => getComputedStyle(each).borderTopColor);

test("a machine takes a pastel colour on its rail button, and a strip along the top of its view unless Settings keep it to the button", async ({ page, browser }) => {
  const serverPage = await browser.newPage();
  await signIn(serverPage, server);
  const invite = await openSettings(serverPage, "Devices");
  await invite.getByRole("button", { name: "Invite a device" }).click();
  const code = (await invite.locator(".invite-code").textContent())!;

  await signIn(page, laptop);
  await page.locator(".sidebar").getByRole("button", { name: "Machines…" }).click();
  const machines = page.getByRole("dialog", { name: "Machines" });
  await machines.getByLabel("Name").fill("Home server");
  await machines.getByLabel("Address or invite link").fill(server.origin);
  await machines.getByRole("button", { name: "Add", exact: true }).click();
  const row = machines.locator(".machine-list li", { hasText: "Home server" });
  const mark = row.getByRole("button", { name: "Machine colour" });
  const picker = row.getByRole("radiogroup", { name: "Colour of Home server" });
  const rail = page.getByRole("navigation", { name: "Machines" });
  const railButton = rail.getByRole("button", { name: "Home server" });
  const frame = page.locator('iframe[title="Home server"]');
  const uncoloured = await backgroundOf(railButton);
  let skyTint = "";
  let skyStripe = "";

  await test.step("the machine's initials in Machines open the colours, and the one picked colours its rail button", async () => {
    await mark.click();
    await expect(picker.getByRole("radio", { name: "No colour" })).toHaveAttribute("aria-checked", "true");
    const sky = picker.getByRole("radio", { name: "Sky" });
    [skyTint, skyStripe] = [await backgroundOf(sky), await borderOf(sky)];
    await sky.click();
    await expect(picker).toHaveCount(0);
    await expect(railButton).toHaveCSS("background-color", skyTint);
    await expect(railButton).toHaveCSS("border-top-color", skyStripe);
    await expect(mark).toHaveCSS("background-color", skyTint);
  });

  await test.step("its view has a strip of the colour along the top", async () => {
    await row.getByRole("button", { name: "Open", exact: true }).click();
    const join = page.getByRole("region", { name: "Join Home server" });
    await join.getByLabel("Invite code or link").fill(code);
    await join.getByRole("button", { name: "Join", exact: true }).click();
    await expect(page.frameLocator('iframe[title="Home server"]').getByRole("button", { name: "Settings…" })).toBeVisible();
    await expect(frame).toHaveCSS("border-top-width", "4px");
    await expect(frame).toHaveCSS("border-top-color", skyStripe);
  });

  await test.step("Settings can keep the colour to the rail button", async () => {
    await rail.getByRole("button", { name: "This computer" }).click();
    await chooseInSettings(page, "Machine colours", "Rail button only");
    await railButton.click();
    await expect(frame).toBeVisible();
    await expect(frame).toHaveCSS("border-top-width", "0px");
    await expect(railButton).toHaveCSS("border-top-color", skyStripe);
  });

  await test.step("the colour stays after a reload, and No colour takes it away", async () => {
    await page.reload();
    await expect(railButton).toHaveCSS("border-top-color", skyStripe);
    await expect(frame).toHaveCSS("border-top-width", "0px");
    await rail.getByRole("button", { name: "This computer" }).click();
    await rail.getByRole("button", { name: "Machines…" }).click();
    await mark.click();
    await expect(picker.getByRole("radio", { name: "Sky" })).toHaveAttribute("aria-checked", "true");
    await picker.getByRole("radio", { name: "No colour" }).click();
    await expect(railButton).toHaveCSS("background-color", uncoloured);
  });

  await test.step("a machine's mark reads as a workspace's: a letter from each of two words, or the first two of one", async () => {
    await expect(mark).toHaveText("HS");
    await machines.getByLabel("Name").fill("Mac");
    await machines.getByLabel("Address or invite link").fill("http://127.0.0.1:9");
    await machines.getByRole("button", { name: "Add", exact: true }).click();
    await expect(machines.locator(".machine-list li", { hasText: "Mac" }).getByRole("button", { name: "Machine colour" })).toHaveText("MA");
    await expect(rail.getByRole("button", { name: "Mac", exact: true })).toContainText("MA");
  });
  await serverPage.close();
});
