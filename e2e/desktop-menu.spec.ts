import { expect, test, type Page } from "@playwright/test";
import type { DesktopMenu, DesktopMenuMessage } from "../shared/desktop-menu.ts";
import { addWorkspace, chooseInSettings, openSettings, signIn, startConversation } from "./helpers.ts";
import { keepShellBusy } from "./terminal-shell.ts";
import { jobControlShell, TestHost } from "./test-host.ts";

const host = new TestHost({ shell: jobControlShell });

test.beforeAll(() => host.start());
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const menuWith = (openAtLogin: boolean): DesktopMenu => ({
  nonce: "nonce-1",
  items: [
    { type: "normal", label: "Host: running, started by this app", enabled: false },
    { type: "separator" },
    { type: "normal", label: "Restart host", action: "restart-host", enabled: true },
    { type: "normal", label: "Run host in the background", action: "toggle-background", checked: false },
    { type: "normal", label: "Open at login", action: "toggle-open-at-login", checked: openAtLogin },
    { type: "separator" },
    { type: "normal", label: "Quit", action: "quit" },
  ],
});

/** Stands in for Electrobun's page-to-app bridge, answering a menu request as the Linux desktop app does. */
async function actAsDesktopApp(page: Page) {
  await page.addInitScript((menu) => {
    const sent: DesktopMenuMessage[] = [];
    Object.assign(window, { sentToDesktopApp: sent });
    window.__electrobunSendToHost = (message) => {
      sent.push(message);
      if (message.type === "desktop-menu-request") setTimeout(() => window.dispatchEvent(new CustomEvent("mirador:desktop-menu", { detail: menu })));
      if (message.type === "desktop-nonce-request") setTimeout(() => window.dispatchEvent(new CustomEvent("mirador:desktop-nonce", { detail: menu.nonce })));
    };
  }, menuWith(false));
  return () => page.evaluate(() => (window as unknown as { sentToDesktopApp: DesktopMenuMessage[] }).sentToDesktopApp);
}

test("in a browser there is no desktop app menu", async ({ page }) => {
  await signIn(page, host);
  await expect(page.getByRole("button", { name: "Profiles…" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Desktop app…" })).toHaveCount(0);
});

test("inside the Linux desktop app, the sidebar offers the tray's menu and sends the chosen action with the app's nonce", async ({ page }) => {
  const sentToDesktopApp = await actAsDesktopApp(page);
  await signIn(page, host);
  const button = page.getByRole("button", { name: "Desktop app…" });
  await button.click();
  const menu = page.getByRole("menu", { name: "Desktop app" });
  await expect(menu).toContainText("Host: running, started by this app");
  await expect(menu.getByRole("menuitem", { name: "Restart host" })).toBeEnabled();
  await expect(menu.getByRole("menuitemcheckbox", { name: "Open at login" })).toHaveAttribute("aria-checked", "false");

  await menu.getByRole("menuitemcheckbox", { name: "Open at login" }).click();
  await expect(menu).toHaveCount(0);
  expect(await sentToDesktopApp()).toContainEqual({ type: "desktop-action", nonce: "nonce-1", action: "toggle-open-at-login" });

  await page.evaluate((updated) => window.dispatchEvent(new CustomEvent("mirador:desktop-menu", { detail: updated })), menuWith(true));
  await button.click();
  await expect(menu.getByRole("menuitemcheckbox", { name: "Open at login" })).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
});

test("inside the desktop app, a link to another site opens in the browser when the page asks the app with its nonce, and no other frame can ask", async ({ page }) => {
  const sentToDesktopApp = await actAsDesktopApp(page);
  await signIn(page, host);
  await expect.poll(sentToDesktopApp).toContainEqual({ type: "desktop-nonce-request" });
  await page.evaluate(() => {
    const link = Object.assign(document.createElement("a"), { href: "https://example.com/docs", textContent: "the docs", target: "_blank" });
    document.querySelector(".sidebar")!.append(link);
    const frame = document.createElement("iframe");
    frame.sandbox.add("allow-scripts");
    frame.srcdoc = `<script>parent.postMessage({ type: "mirador:open-link", url: "https://evil.example/" }, "*")</script>`;
    document.body.append(frame);
  });
  const link = page.getByRole("link", { name: "the docs" });
  await link.click();
  await link.click({ modifiers: ["ControlOrMeta"] });
  await link.click({ button: "middle" });

  const openedLinks = async () => (await sentToDesktopApp()).filter(({ type }) => type === "desktop-open-link");
  await expect.poll(openedLinks).toHaveLength(3);
  expect(await openedLinks()).toEqual(Array(3).fill({ type: "desktop-open-link", nonce: "nonce-1", url: "https://example.com/docs" }));
  expect(page.context().pages()).toHaveLength(1);
  expect(new URL(page.url()).origin).toBe(host.origin);
});

test("inside a desktop app that hands over no nonce, as one built before it did, links are left to the window", async ({ page }) => {
  await page.addInitScript(() => {
    window.__electrobunSendToHost = () => {};
  });
  await signIn(page, host);
  await page.evaluate(() => {
    const link = Object.assign(document.createElement("a"), { href: "https://example.com/docs", textContent: "the docs", target: "_blank" });
    document.querySelector(".sidebar")!.append(link);
  });
  const popup = page.waitForEvent("popup");
  await page.getByRole("link", { name: "the docs" }).click();
  expect((await popup).url()).toContain("example.com");
});

test("inside the macOS desktop app, ⌘W closes the open dialog, else the focused terminal's shell or answers its question, and with nothing to close asks the app with its nonce", async ({ page }) => {
  const sentToDesktopApp = await actAsDesktopApp(page);
  await signIn(page, host);
  await expect.poll(sentToDesktopApp).toContainEqual({ type: "desktop-nonce-request" });
  const pressCommandWInTheApp = () => page.evaluate(() => window.dispatchEvent(new CustomEvent("mirador:desktop-close")));
  const askedToCloseWindow = async () => (await sentToDesktopApp()).filter(({ type }) => type === "desktop-close-window");

  await test.step("an open dialog closes", async () => {
    await page.getByRole("button", { name: "Settings…" }).click();
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
    await pressCommandWInTheApp();
    await expect(page.getByRole("dialog", { name: "Settings" })).toHaveCount(0);
  });

  await test.step("the shell of the focused terminal closes", async () => {
    await addWorkspace(page, host.projectDir);
    await startConversation(page);
    await page.getByRole("button", { name: "Show terminal" }).click();
    await page.getByRole("button", { name: "Split right" }).click();
    const splits = page.locator(".terminal-pane .terminal-split");
    await expect(splits).toHaveCount(2);
    await page.locator(".terminal-pane .xterm").nth(1).click();
    await pressCommandWInTheApp();
    await expect(splits).toHaveCount(1);
  });

  await test.step("a dialog opened while a terminal has focus closes first, and the shell behind it stays", async () => {
    await page.locator(".terminal-pane .xterm").click();
    await page.getByRole("button", { name: "Settings…" }).evaluate((button: HTMLButtonElement) => button.click());
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
    await pressCommandWInTheApp();
    await expect(page.getByRole("dialog", { name: "Settings" })).toHaveCount(0);
    await expect(page.locator(".terminal-pane .terminal-split")).toHaveCount(1);
  });

  await test.step("in a terminal's find bar, the bar closes and the shell stays", async () => {
    await page.locator(".terminal-pane .xterm").click();
    await page.keyboard.press((await page.evaluate(() => navigator.userAgent.includes("Mac"))) ? "Meta+F" : "Control+Shift+F");
    const findBar = page.locator(".terminal-pane .terminal-find");
    await expect(findBar.getByLabel("Find in this terminal")).toBeFocused();
    await pressCommandWInTheApp();
    await expect(findBar).toHaveCount(0);
    await expect(page.locator(".terminal-pane .terminal-split")).toHaveCount(1);
  });

  await test.step("with focus elsewhere and no dialog open, the page asks the app to close the window", async () => {
    expect(await askedToCloseWindow()).toEqual([]);
    await page.locator(".composer:visible textarea").focus();
    await pressCommandWInTheApp();
    await expect.poll(askedToCloseWindow).toEqual([{ type: "desktop-close-window", nonce: "nonce-1" }]);
    await expect(page.locator(".terminal-pane .terminal-split")).toHaveCount(1);
  });

  const splits = page.locator(".terminal-pane .terminal-split");
  const typingInto = (index: number) => page.locator(".terminal-pane .xterm-helper-textarea").nth(index);
  const question = page.getByRole("button", { name: "Confirm: Close terminal 2", exact: true });
  const runSleepInASecondSplit = async () => {
    await page.getByRole("button", { name: "Split right" }).click();
    await expect(splits).toHaveCount(2);
    await page.locator(".terminal-pane .xterm").nth(1).click();
    await keepShellBusy(page, page.locator(".terminal-pane .xterm-rows").nth(1));
  };

  await test.step("on a shell running a command, ⌘W asks; Esc, or waiting, keeps it and gives the shell back the keys", async () => {
    await runSleepInASecondSplit();
    await pressCommandWInTheApp();
    await expect(question).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(typingInto(1)).toBeFocused();
    await pressCommandWInTheApp();
    await expect(question).toBeFocused();
    await expect(typingInto(1)).toBeFocused({ timeout: 6_000 });
    await expect(page.getByRole("button", { name: "Close terminal 2", exact: true })).toHaveText("×");
    await expect(splits).toHaveCount(2);
  });

  await test.step("⌘W again while it asks closes that shell, and never asks the app to close the window", async () => {
    await pressCommandWInTheApp();
    await expect(question).toBeFocused();
    await pressCommandWInTheApp();
    await expect(splits).toHaveCount(1);
    expect(await askedToCloseWindow()).toHaveLength(1);
  });

  await test.step("a close armed by a click is no answer to ⌘W, which stays with it", async () => {
    await runSleepInASecondSplit();
    await page.getByRole("button", { name: "Close terminal 2", exact: true }).click();
    await expect(question).toBeFocused();
    await pressCommandWInTheApp();
    await expect(question).toBeVisible();
    await expect(splits).toHaveCount(2);
    expect(await askedToCloseWindow()).toHaveLength(1);
    await question.click();
    await expect(splits).toHaveCount(1);
  });
});

test("inside the desktop app, the page gives the app the chosen theme with its nonce, once handed the nonce and on every choice after", async ({ page }) => {
  const sentToDesktopApp = await actAsDesktopApp(page);
  await signIn(page, host);
  const appearances = async () => (await sentToDesktopApp()).filter(({ type }) => type === "desktop-appearance");
  const given = (...appearances: string[]) => appearances.map((appearance) => ({ type: "desktop-appearance", nonce: "nonce-1", appearance }));
  await expect.poll(appearances).toEqual(given("light"));

  await chooseInSettings(page, "Theme", "Dark");
  await chooseInSettings(page, "Theme", "Match system");
  await expect.poll(appearances).toEqual(given("light", "dark", "system"));
});

test("inside the desktop app, the page tells the app Mirador's language with its nonce, and again in the new language after a switch", async ({ page }) => {
  const sentToDesktopApp = await actAsDesktopApp(page);
  await signIn(page, host);
  const languages = async () => (await sentToDesktopApp()).filter(({ type }) => type === "desktop-language");
  await expect.poll(languages).toEqual([{ type: "desktop-language", nonce: "nonce-1", language: "en" }]);

  await Promise.all([page.waitForEvent("load"), (await openSettings(page)).getByLabel("Language").selectOption("hu")]);
  await expect.poll(languages).toEqual([{ type: "desktop-language", nonce: "nonce-1", language: "hu" }]);
});

test("the desktop app menu reaches past the sidebar's edge without being cut off", async ({ page }) => {
  await actAsDesktopApp(page);
  await signIn(page, host);
  await page.getByRole("button", { name: "Desktop app…" }).click();
  const menu = page.getByRole("menu", { name: "Desktop app" });
  const sidebar = (await page.locator(".sidebar").boundingBox())!;
  const shown = (await menu.boundingBox())!;
  expect(shown.x + shown.width).toBeGreaterThan(sidebar.x + sidebar.width);
  const farEdgeIsMenu = await menu.evaluate((element) => {
    const { right, top, bottom } = element.getBoundingClientRect();
    return element.contains(document.elementFromPoint(right - 2, (top + bottom) / 2));
  });
  expect(farEdgeIsMenu).toBe(true);
});
