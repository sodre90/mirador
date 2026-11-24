import { expect, test, type Locator, type Page } from "@playwright/test";
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

  await expect(pages.getByRole("tab")).toHaveText(["Appearance", "Conversations", "Agents", "Voice", "Terminal", "Canvas", "Layout", "Devices", "Notifications", "Export and import", "About"]);
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
  await expect(tab("Export and import")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(tab("About")).toBeFocused();
  await expect(settings.getByText(`Mirador ${MIRADOR_VERSION}`)).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(tab("Appearance")).toBeFocused();
  await page.keyboard.press("ArrowUp");
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

test("searching Settings shows what it finds on every page under its headings, and Esc or a page clears the search", async ({ page }) => {
  await signIn(page, host);
  const settings = await openSettings(page);
  const search = settings.getByRole("searchbox", { name: "Search settings" });
  const found = settings.getByRole("region", { name: "Settings found" });
  const heading = (name: string) => found.getByRole("heading", { name, exact: true });
  const pageName = (name: string) => found.locator(".settings-search-page-name", { hasText: name });

  await search.pressSequentially("side chat");
  await expect(search).toBeFocused();
  await expect(search).toHaveValue("side chat");
  await expect(pageName("Conversations")).toBeVisible();
  await expect(heading("Side chats")).toBeVisible();
  await expect(found.getByRole("combobox", { name: "New side chats" })).toBeVisible();
  await expect(pageName("Appearance")).toBeHidden();
  await expect(found.getByRole("radiogroup", { name: "Theme" })).toBeHidden();
  await expect(settings.getByRole("tab", { selected: true })).toHaveCount(0);

  await search.fill("long lists");
  await expect(heading("Long lists")).toBeVisible();
  await expect(found.getByRole("combobox", { name: "Conversations per workspace" })).toBeVisible();

  await search.fill("THEME");
  await expect(pageName("Appearance")).toBeVisible();
  await expect(found.getByRole("radiogroup", { name: "Theme" })).toBeVisible();
  await expect(found.getByRole("heading", { name: "Appearance" })).toHaveCount(1);
  await expect(found.getByRole("radiogroup", { name: "Text size" })).toBeHidden();
  await expect(heading("Side chats")).toBeHidden();

  await search.fill("zqxwv");
  await expect(found.getByText("No setting matches that.")).toBeVisible();
  await expect(found.getByRole("heading")).toHaveCount(0);

  await search.press("Escape");
  await expect(search).toHaveValue("");
  await expect(found).toHaveCount(0);
  await expect(settings.getByRole("tab", { name: "Appearance" })).toHaveAttribute("aria-selected", "true");
  await expect(settings.getByRole("radiogroup", { name: "Text size" })).toBeVisible();
  await search.press("Escape");
  await expect(settings).toHaveCount(0);

  await openSettings(page);
  await search.fill("side chat");
  await settings.getByRole("tab", { name: "Devices" }).click();
  await expect(search).toHaveValue("");
  await expect(settings.getByRole("button", { name: "Invite a device" })).toBeVisible();
});

test("on a narrow window the search of Settings stays within it, and what it finds fits its width", async ({ page }) => {
  await signIn(page, host);
  await page.setViewportSize({ width: 560, height: 760 });
  const settings = await openSettings(page);
  const search = settings.getByRole("searchbox", { name: "Search settings" });
  await search.fill("side chat");
  await expect(settings.getByRole("combobox", { name: "New side chats" })).toBeVisible();

  const searchBox = (await search.boundingBox())!;
  const closeBox = (await settings.getByRole("button", { name: "Close" }).boundingBox())!;
  const dialogBox = (await settings.boundingBox())!;
  expect(searchBox.width).toBeGreaterThan(80);
  expect(searchBox.x).toBeGreaterThanOrEqual(dialogBox.x);
  expect(searchBox.x + searchBox.width).toBeLessThanOrEqual(closeBox.x);
  const found = settings.getByRole("region", { name: "Settings found" });
  expect(await found.evaluate((area) => area.scrollWidth - area.clientWidth)).toBeLessThanOrEqual(0);
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

test("Settings stays within a window too small for it, and its pages scroll", async ({ page }) => {
  await signIn(page, host);
  await page.setViewportSize({ width: 900, height: 420 });
  const settings = await openSettings(page);
  await expectWithinWindow(settings, page);

  await page.evaluate(() => localStorage.setItem("mirador-settings-size", JSON.stringify({ width: 3000, height: 3000 })));
  await page.reload();
  await expectWithinWindow(await openSettings(page), page);
});

async function expectWithinWindow(settings: Locator, page: Page) {
  const box = (await settings.boundingBox())!;
  const window = page.viewportSize()!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(window.height);
  expect(box.x + box.width).toBeLessThanOrEqual(window.width);

  const pageArea = settings.locator(".settings-page");
  await pageArea.hover();
  await page.mouse.wheel(0, 600);
  await expect.poll(() => pageArea.evaluate((area) => area.scrollTop)).toBeGreaterThan(0);
}
