import { cpSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, createProfile, primaryModifier, sendMessage, signIn } from "./helpers.ts";
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

const windowView = (page: Page) => page.frameLocator(".item-window .canvas-frame.plugin iframe");

async function chooseInPalette(page: Page, entry: string) {
  await page.keyboard.press(`${await primaryModifier(page)}+KeyK`);
  const palette = page.getByLabel("Search conversations and actions");
  await palette.fill(entry);
  await palette.press("Enter");
}

async function startConversation(page: Page) {
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, profileName, "", "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${profileName} · opencode` });
  const previousUrl = page.url();
  await page.getByRole("button", { name: "+ New conversation" }).click();
  await expect(page).not.toHaveURL(previousUrl);
}

test("a plugin's own window hears every conversation's activity, takes the user's actions, and belongs to no conversation", async ({ page }) => {
  await signIn(page, host);
  await startConversation(page);

  const opened = page.context().waitForEvent("page");
  await chooseInPalette(page, "Open the Board window");
  const boardWindow = await opened;

  await test.step("the window is titled after the plugin's name and drawn by its canvas view, in the window", async () => {
    await expect(boardWindow).toHaveTitle("Mirador: board");
    await expect(windowView(boardWindow).locator("#place")).toHaveText("Drawn in the window");
    await expect(windowView(boardWindow).locator("#heard")).toHaveText("user-message: 0, turn-started: 0, turn-ended: 0, tool-started: 0, tool-ended: 0");
  });

  await test.step("the user's message, the turn and its tool calls reach the plugin, and its window follows", async () => {
    await sendMessage(page, 'RUN TOOLS [{"title":"Read a.ts","kind":"read","rawInput":{}},{"title":"Read b.ts","kind":"read","rawInput":{}}]');
    await expect(page.locator(".chat-header:visible .badge")).toHaveText("idle", { timeout: 60_000 });
    await expect(windowView(boardWindow).locator("#heard")).toHaveText("user-message: 1, turn-started: 1, turn-ended: 1, tool-started: 2, tool-ended: 2");
    await expect(windowView(boardWindow).locator("#last")).not.toHaveText("Last heard from: nobody");
    await expect(windowView(boardWindow).locator("#ended")).toHaveText("Last turn finished");
  });

  await test.step("the user's action in the window reaches the plugin, whose reply comes back", async () => {
    await windowView(boardWindow).getByRole("button", { name: "Forget" }).click();
    await expect(windowView(boardWindow).locator("#reply")).toHaveText("Forgot");
    await expect(windowView(boardWindow).locator("#heard")).toHaveText("user-message: 0, turn-started: 0, turn-ended: 0, tool-started: 0, tool-ended: 0");
  });

  await test.step("the window has no agent to send to", async () => {
    await windowView(boardWindow).getByRole("button", { name: "Ask the agent" }).click();
    await expect(windowView(boardWindow).locator("#asked")).toHaveText("The plugin's own window belongs to no conversation, so it has no agent to send to.");
  });

  await test.step("opening it again brings back the same window", async () => {
    const pagesBefore = page.context().pages().length;
    await chooseInPalette(page, "Open the Board window");
    await expect(windowView(boardWindow).locator("#place")).toHaveText("Drawn in the window");
    expect(page.context().pages()).toHaveLength(pagesBefore);
  });
});

test("a window for a plugin that has none says so", async ({ page }) => {
  await signIn(page, host);
  const missingWindow = await page.context().newPage();
  await missingWindow.goto(`${host.origin}/#/plugin/no-such-plugin`);
  await expect(missingWindow).toHaveTitle("Mirador: no-such-plugin");
  await expect(missingWindow.locator(".plugin-window-missing")).toHaveText("No plugin named no-such-plugin with a window of its own is installed.");
});

test("inside the desktop app, the app opens the plugin's window", async ({ page }) => {
  await page.addInitScript(() => {
    const sent: DesktopMenuMessage[] = [];
    Object.assign(window, { sentToDesktopApp: sent });
    window.__electrobunSendToHost = (message) => {
      sent.push(message);
      if (message.type === "desktop-nonce-request") setTimeout(() => window.dispatchEvent(new CustomEvent("mirador:desktop-nonce", { detail: "nonce-1" })));
    };
  });
  await signIn(page, host);
  const pagesBefore = page.context().pages().length;
  await chooseInPalette(page, "Open the Board window");
  const sentToApp = () =>
    page.evaluate(() => (window as unknown as { sentToDesktopApp: DesktopMenuMessage[] }).sentToDesktopApp.filter(({ type }) => type === "desktop-open-plugin-window"));
  await expect.poll(sentToApp).toEqual([{ type: "desktop-open-plugin-window", nonce: "nonce-1", plugin: "board" }]);
  expect(page.context().pages()).toHaveLength(pagesBefore);
});
