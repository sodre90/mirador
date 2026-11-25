import { expect, test, type Page } from "@playwright/test";
import { openSettings, reachedAtOwnPort, signIn } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost({ environment: reachedAtOwnPort });
const reachedNowhere = new TestHost();

test.beforeAll(async () => {
  await Promise.all([host.start(), reachedNowhere.start()]);
});
test.afterAll(async () => {
  await Promise.all([host.stop(), reachedNowhere.stop()]);
  await Promise.all([host.cleanUp(), reachedNowhere.cleanUp()]);
});

async function openInvite(page: Page) {
  const settings = await openSettings(page, "Devices");
  await settings.getByRole("button", { name: "Invite a device" }).click();
  const card = settings.getByRole("region", { name: "Invite" });
  await expect(card.getByRole("radio", { name: "Phone" })).toBeChecked();
  return { settings, card };
}

test("an invite opens as a card above the devices, for a phone, another computer or a browser, and hides again", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await signIn(page, host);
  const { settings, card } = await openInvite(page);
  const link = card.locator(".invite-link");

  await test.step("it is right above the devices it adds to", async () => {
    const [cardBox, listBox] = await Promise.all([card.boundingBox(), settings.locator(".device-list").boundingBox()]);
    expect(cardBox!.y + cardBox!.height).toBeLessThanOrEqual(listBox!.y);
  });

  await test.step("a phone scans it, and the link is there to copy, or to show", async () => {
    await expect(card.getByRole("img", { name: "Link as a QR code" })).toBeVisible();
    await expect(card).toContainText("Scan with the Mirador app");
    await expect(card).toContainText(/The invite works once and expires in 1[45] minutes\./);
    await expect(link).toBeHidden();
    await card.getByRole("button", { name: "Copy link" }).click();
    await expect(card.getByRole("button", { name: "Copied" })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await link.textContent());
    await card.getByText("Show the link").click();
    await expect(link).toBeVisible();
  });

  await test.step("another computer pastes the link under Machines", async () => {
    await card.getByRole("radio", { name: "Another computer" }).check();
    await expect(link).toBeVisible();
    await expect(card).toContainText("Open Machines… in the other computer's Mirador and paste this link.");
    await expect(card).toContainText(`The computer has to reach 127.0.0.1:${host.port}`);
  });

  await test.step("a browser opens the link, which says where it goes", async () => {
    await card.getByRole("radio", { name: "Browser" }).check();
    await expect(link).toBeVisible();
    await expect(card).toContainText("Open the link in a browser");
    await expect(card).toContainText(`The browser has to reach 127.0.0.1:${host.port}`);
  });

  await test.step("Invite a device makes another, for what was chosen last", async () => {
    const before = await card.locator(".invite-code").textContent();
    await settings.getByRole("button", { name: "Invite a device" }).click();
    await expect(card.locator(".invite-code")).not.toHaveText(before!);
    await expect(card.getByRole("radio", { name: "Browser" })).toBeChecked();
  });

  await test.step("it hides, and Settings stays", async () => {
    await card.getByRole("button", { name: "Hide invite" }).click();
    await expect(card).toHaveCount(0);
    await expect(settings.getByRole("button", { name: "Invite a device" })).toBeVisible();
  });
});

test("once a device joined, the invite says which, and the devices connected come first", async ({ page, browser }) => {
  await signIn(page, host);
  const { settings, card } = await openInvite(page);
  const joinsAndLeaves = async () => {
    const visitor = await browser.newContext();
    await (await visitor.newPage()).goto((await card.locator(".invite-link").textContent())!);
    await expect(card).toContainText(/^Chrome on \S+ joined/);
    return visitor;
  };

  const first = await joinsAndLeaves();
  await expect(card.getByRole("img", { name: "Link as a QR code" }), "its code is used up").toHaveCount(0);
  const firstName = settings.locator(".device-list li").first();
  await firstName.getByRole("button", { name: /^Revoke / }).waitFor();
  await first.close();
  await expect(firstName).not.toHaveClass(/connected/);

  await card.getByRole("button", { name: "Done" }).click();
  await expect(card).toHaveCount(0);

  await settings.getByRole("button", { name: "Invite a device" }).click();
  const second = await joinsAndLeaves();
  await expect(settings.locator(".device-list li")).toHaveCount(2);
  await expect(settings.locator(".device-list li").first(), "the one connected, though it joined last").toHaveClass(/connected/);

  await test.step("revoking what joined leaves the used invite over", async () => {
    await settings.locator(".device-list li").first().getByRole("button", { name: /^Revoke / }).click();
    await settings.getByRole("button", { name: /^Confirm: Revoke / }).click();
    await expect(settings.locator(".device-list li")).toHaveCount(1);
    await expect(card).toContainText("joined");
  });
  await second.close();
});

test("an invite that ran out says so, and a new one takes its place", async ({ page }) => {
  await page.clock.install();
  await signIn(page, host);
  const { card } = await openInvite(page);
  const code = (await card.locator(".invite-code").textContent())!;

  await page.clock.fastForward("16:00");
  await expect(card).toContainText("This invite has expired.");
  await expect(card.getByRole("img", { name: "Link as a QR code" })).toHaveCount(0);
  await expect(card.locator(".invite-code")).toHaveCount(0);

  await page.clock.setSystemTime(Date.now());
  await card.getByRole("button", { name: "Make a new one" }).click();
  await expect(card.locator(".invite-code")).toHaveText(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  await expect(card.locator(".invite-code")).not.toHaveText(code);
  await expect(card.getByRole("img", { name: "Link as a QR code" })).toBeVisible();
});

test("an invite that reaches nothing leads to the ways to an address", async ({ page }) => {
  await signIn(page, reachedNowhere);
  const { settings, card } = await openInvite(page);
  const alert = card.getByRole("alert");
  await expect(alert).toContainText("No other device can reach this Mirador");
  await card.getByRole("radio", { name: "Browser" }).check();
  await expect(alert).toContainText("No other device can reach this Mirador");
  await alert.getByRole("button", { name: "Choose another way…" }).click();
  const ways = settings.getByRole("form", { name: "How browsers and other computers reach this Mirador" });
  await expect(ways.getByRole("button", { name: "Save" })).toBeInViewport();
});

test("in a narrow window the card and the connection rows stay within Settings", async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 800 });
  await signIn(page, host);
  const { settings } = await openInvite(page);
  const pageArea = settings.locator(".settings-page");
  expect(await pageArea.evaluate((area) => area.scrollWidth - area.clientWidth)).toBe(0);
  await settings.getByRole("radio", { name: "Another computer" }).check();
  expect(await pageArea.evaluate((area) => area.scrollWidth - area.clientWidth)).toBe(0);
  await settings.getByRole("radio", { name: "Browser" }).check();
  expect(await pageArea.evaluate((area) => area.scrollWidth - area.clientWidth)).toBe(0);
});
