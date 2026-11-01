import { expect, test } from "@playwright/test";
import { MIRADOR_VERSION } from "../shared/version.ts";
import { openSettings, signIn } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();

test.beforeAll(() => host.start());
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

test("Settings shows one page at a time, chosen from the list on the left by click or with Up and Down", async ({ page }) => {
  await signIn(page, host);
  const settings = await openSettings(page);
  const pages = settings.getByRole("tablist", { name: "Settings pages" });
  const tab = (name: string) => pages.getByRole("tab", { name });

  await expect(pages.getByRole("tab")).toHaveText(["Appearance", "Conversations", "Agents", "Voice", "Terminal", "Canvas", "Plugins", "Layout", "Devices", "Notifications", "About"]);
  await expect(tab("Appearance")).toHaveAttribute("aria-selected", "true");
  await expect(settings.getByRole("radiogroup", { name: "Theme" })).toBeVisible();

  await tab("Devices").click();
  await expect(settings.getByRole("button", { name: "Invite a device" })).toBeVisible();
  await expect(settings.getByRole("radiogroup", { name: "Theme" })).toHaveCount(0);

  await page.keyboard.press("ArrowDown");
  await expect(tab("Notifications")).toBeFocused();
  await expect(tab("Notifications")).toHaveAttribute("aria-selected", "true");
  await expect(settings.getByRole("heading", { name: "Notifications" })).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(tab("About")).toBeFocused();
  await expect(settings.getByText(`Mirador ${MIRADOR_VERSION}`)).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(tab("Appearance")).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect(tab("Devices")).toBeFocused();
  await expect(settings.getByRole("button", { name: "Invite a device" })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(settings).toHaveCount(0);
  await openSettings(page, "Layout");
  await expect(settings.getByRole("heading", { name: "Default layout" })).toBeVisible();
});

test("a chosen option in the left column keeps its whole ring, not cut by the edge of the page", async ({ page }) => {
  await signIn(page, host);
  const settings = await openSettings(page);
  const light = settings.getByRole("radiogroup", { name: "Theme" }).getByRole("radio", { name: "Light" });
  await light.click();
  await expect(light).toHaveClass(/chosen/);
  const ringWidth = await light.evaluate((option) => Number.parseFloat(getComputedStyle(option).boxShadow.match(/(\d+(?:\.\d+)?)px\s*$/)?.[1] ?? "0"));
  const roomOnTheLeft = await light.evaluate((option) => option.getBoundingClientRect().left - option.closest(".settings-page")!.getBoundingClientRect().left);
  expect(ringWidth).toBeGreaterThan(0);
  expect(roomOnTheLeft).toBeGreaterThanOrEqual(ringWidth);
});

test("Settings is resized by dragging its corner, and opens at that size again", async ({ page }) => {
  await signIn(page, host);
  const settings = await openSettings(page);
  const before = (await settings.boundingBox())!;

  await page.mouse.move(before.x + before.width - 3, before.y + before.height - 3);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width + 150, before.y + before.height + 100, { steps: 5 });
  await page.mouse.up();
  const dragged = (await settings.boundingBox())!;
  expect(dragged.width).toBeGreaterThan(before.width + 50);
  expect(dragged.height).toBeGreaterThan(before.height + 30);

  await settings.getByRole("button", { name: "Close" }).click();
  await page.reload();
  const reopened = (await (await openSettings(page)).boundingBox())!;
  expect(Math.round(reopened.width)).toBe(Math.round(dragged.width));
  expect(Math.round(reopened.height)).toBe(Math.round(dragged.height));
});
