import { cpSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, callCanvasTool, createProfile, sendMessage, signIn } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";
import type { DesktopMenuMessage } from "../shared/desktop-menu.ts";

const host = new TestHost({ fakePrograms: true });
const promptsFile = join(host.root, "prompts");
const profileName = "board";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  cpSync(join(import.meta.dirname, "..", "tests", "fixtures", "canvas-plugins", "board"), join(host.dataDir, "plugins", "board"), { recursive: true });
  writeBunProgram(host.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"), { FAKE_ACP_PROMPTS: promptsFile });
  writeFileSync(promptsFile, "");
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const popOutButton = (page: Page) => page.locator(".canvas-header:visible").getByRole("button", { name: "Open in its own window" });
const windowView = (page: Page) => page.frameLocator(".item-window .canvas-frame.plugin iframe");
const canvasView = (page: Page) => page.frameLocator(".canvas-panel:visible .canvas-body > .canvas-frame.plugin iframe");

let conversationId = "";

async function startConversation(page: Page) {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, profileName, "", "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${profileName} · opencode` });
  const previousUrl = page.url();
  await page.getByRole("button", { name: "+ New conversation" }).click();
  await expect(page).not.toHaveURL(previousUrl);
  conversationId = page.url().match(/#\/c\/(.+)$/)![1]!;
  await sendMessage(page, "Start");
  await expect(page.locator(".chat-header:visible .badge")).toHaveText("idle", { timeout: 60_000 });
}

async function popOut(page: Page) {
  const opened = page.context().waitForEvent("page");
  await popOutButton(page).click();
  const itemWindow = await opened;
  await itemWindow.waitForLoadState();
  return itemWindow;
}

test("a plugin's item opens in a window of its own, which stays live and is titled after the item", async ({ page }) => {
  await startConversation(page);
  await callCanvasTool(host, conversationId, "show_card", { title: "Hello", text: "First" });
  await expect(canvasView(page).locator("#title")).toHaveText("Hello");

  const cardWindow = await popOut(page);

  await test.step("the window shows only the item, titled after it", async () => {
    await expect(cardWindow).toHaveTitle("Mirador: Hello");
    await expect(windowView(cardWindow).locator("#text")).toHaveText("First (pressed 0 times)");
    await expect(cardWindow.locator(".chat-column, .sidebar")).toHaveCount(0);
  });

  await test.step("the user's action in the window reaches the plugin, and the canvas sees it too", async () => {
    await windowView(cardWindow).getByRole("button", { name: "Press" }).click();
    await expect(windowView(cardWindow).locator("#reply")).toHaveText("Pressed 1 times");
    await expect(canvasView(page).locator("#text")).toHaveText("First (pressed 1 times)");
  });

  await test.step("the item's changes reach the window, and its title follows the item's", async () => {
    await callCanvasTool(host, conversationId, "change_card", { text: "Second", title: "Renamed" });
    await expect(windowView(cardWindow).locator("#text")).toHaveText("Second (pressed 1 times)");
    await expect(cardWindow).toHaveTitle("Mirador: Renamed");
  });

  await test.step("opening it again brings back the same window", async () => {
    const pagesBefore = page.context().pages().length;
    await popOutButton(page).click();
    await expect(windowView(cardWindow).locator("#title")).toHaveText("Renamed");
    expect(page.context().pages()).toHaveLength(pagesBefore);
  });

  await test.step("the window keeps up after its host restarts", async () => {
    await host.restart();
    await expect(windowView(cardWindow).locator("#text")).toHaveText("Second (pressed 1 times)", { timeout: 30_000 });
    await callCanvasTool(host, conversationId, "change_card", { text: "Third" });
    await expect(windowView(cardWindow).locator("#text")).toHaveText("Third (pressed 1 times)");
    await cardWindow.close();
  });
});

test("the tab's item opens in its own window too, from More where the bar is narrow, and says when the item is dismissed", async ({ page }) => {
  await signIn(page, host);
  await page.goto(`${host.origin}/#/c/${conversationId}`);
  await callCanvasTool(host, conversationId, "track_steps", { title: "Release", steps: ["Build", "Ship"] });
  await expect(page.locator(".checklist:visible .canvas-frame.plugin")).toHaveCount(1);

  await page.setViewportSize({ width: 820, height: 800 });
  await expect(popOutButton(page)).toBeHidden();
  const opened = page.context().waitForEvent("page");
  await page.locator(".canvas-header:visible").getByRole("button", { name: "More" }).click();
  await page.getByRole("menu", { name: "More of the canvas bar" }).getByRole("menuitem", { name: "Open in its own window" }).click();
  const stepsWindow = await opened;
  await expect(stepsWindow).toHaveTitle("Mirador: Release");
  await expect(windowView(stepsWindow).locator("#text")).toHaveText("0 of 2 steps done");
  await callCanvasTool(host, conversationId, "finish_step", {});
  await expect(windowView(stepsWindow).locator("#text")).toHaveText("1 of 2 steps done");

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole("button", { name: "Dismiss the checklist" }).click();
  await expect(stepsWindow.locator(".item-gone")).toHaveText("This item is no longer on the canvas: it was dismissed, or its conversation was deleted.");
  await stepsWindow.close();
});

/** Stands in for the desktop app's bridge: it hands over the nonce and keeps what the page sent it. */
async function asInDesktopApp(page: Page) {
  await page.addInitScript(() => {
    const sent: DesktopMenuMessage[] = [];
    Object.assign(window, { sentToDesktopApp: sent });
    window.__electrobunSendToHost = (message) => {
      sent.push(message);
      if (message.type === "desktop-nonce-request") setTimeout(() => window.dispatchEvent(new CustomEvent("mirador:desktop-nonce", { detail: "nonce-1" })));
    };
  });
  return (type: DesktopMenuMessage["type"]) =>
    page.evaluate((type) => (window as unknown as { sentToDesktopApp: DesktopMenuMessage[] }).sentToDesktopApp.filter((message) => message.type === type), type);
}

test("inside the desktop app, the app opens the item's window, which tells the app its title", async ({ page }) => {
  const sentToApp = await asInDesktopApp(page);
  await signIn(page, host);
  await page.goto(`${host.origin}/#/c/${conversationId}`);
  await expect(canvasView(page).locator("#title")).toHaveText("Renamed");
  const pagesBefore = page.context().pages().length;
  await popOutButton(page).click();
  await expect.poll(() => sentToApp("desktop-open-item-window")).toEqual([
    { type: "desktop-open-item-window", nonce: "nonce-1", conversationId, itemId: expect.any(String), title: "Renamed" },
  ]);
  expect(page.context().pages()).toHaveLength(pagesBefore);

  const [{ itemId }] = (await sentToApp("desktop-open-item-window")) as Extract<DesktopMenuMessage, { type: "desktop-open-item-window" }>[];
  const itemWindow = await page.context().newPage();
  const sentByWindow = await asInDesktopApp(itemWindow);
  await itemWindow.goto(`${host.origin}/#/item/${conversationId}/${itemId}`);
  await expect(windowView(itemWindow).locator("#title")).toHaveText("Renamed");
  await expect.poll(() => sentByWindow("desktop-window-title")).toContainEqual({ type: "desktop-window-title", nonce: "nonce-1", title: "Mirador: Renamed" });
});
