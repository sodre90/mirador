import { expect, test } from "@playwright/test";
import { addWorkspace, clickWorkspaceButton, signIn } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();

test.describe.configure({ mode: "serial" });

test.beforeAll(() => host.start());
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

test("clicking a hinted dropdown hides its hint, which stays away until the pointer leaves", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const picker = page.getByLabel("Agent", { exact: true });
  const hint = page.getByRole("tooltip");

  await picker.hover();
  await expect(hint).toBeVisible();
  await picker.click();
  await page.waitForTimeout(1_000);
  await expect(hint).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1_000);
  await expect(hint).toHaveCount(0);

  await page.getByRole("button", { name: "+ New conversation" }).hover();
  await picker.hover();
  await expect(hint).toBeVisible();
});

test("a hint waits a moment, so the pointer passing over something does not flash its hint", async ({ page }) => {
  await signIn(page, host);
  const hint = page.getByRole("tooltip");

  await page.getByRole("button", { name: "Add workspace" }).hover();
  await page.waitForTimeout(400);
  await expect(hint).toHaveCount(0);
  await expect(hint).toContainText("Add a project directory.");
});

test("the hint of a button that has a shortcut shows its key", async ({ page }) => {
  await signIn(page, host);
  const hint = page.getByRole("tooltip");

  await page.getByRole("button", { name: "Add workspace" }).hover();
  await expect(hint).toContainText("Add a project directory.");
  await expect(hint.locator("kbd")).toHaveText(/^(⌥⇧T|Alt\+Shift\+T)$/);

  await page.getByRole("button", { name: "+ New conversation" }).hover();
  await expect(hint).toContainText("Start a conversation in this workspace");
  await expect(hint.locator("kbd")).toHaveText(/^(⌥T|Alt\+T)$/);
});

test("the message box names its keys on one line, and the Send button's hint says them in full", async ({ page }) => {
  await signIn(page, host);
  await page.getByRole("button", { name: "+ New conversation" }).click();
  await expect(page.locator(".composer:visible textarea")).toHaveAttribute("placeholder", "Message Claude Code · / commands · @ files · ! shell");
  await expect(page.locator(".composer:visible button.send")).toHaveAttribute("data-hint", /^Sends the message\. Shift\+Enter starts a new line/);
});

test("help text in the app stays where it is written, unlike the hint bubble", async ({ page }) => {
  await signIn(page, host);
  await clickWorkspaceButton(page.locator(".workspace"), "Continue a session…");
  const help = page.locator(".modal.sessions p.hint");
  await expect(help).toBeVisible();
  await expect(help).toHaveCSS("position", "static");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
});

test("a short hint opens on a touch tap without blocking clicks beneath it, and links via aria-describedby for screen readers", async ({ page }) => {
  await signIn(page, host);
  const addWorkspaceButton = page.getByRole("button", { name: "Add workspace" });
  const hint = page.getByRole("tooltip");

  // Touch tap opens a short hint and lets taps pass through it; tapping again or elsewhere dismisses it.
  await addWorkspaceButton.dispatchEvent("pointerover", { pointerType: "touch", bubbles: true });
  await addWorkspaceButton.dispatchEvent("pointerdown", { pointerType: "touch", bubbles: true });
  await expect(hint).toBeVisible();
  await expect(hint).toContainText("Add a project directory.");
  await expect(hint).toHaveCSS("pointer-events", "none");
  const tooltipId = await hint.getAttribute("id");
  expect(tooltipId).toBeTruthy();
  await expect(addWorkspaceButton).toHaveAttribute("aria-describedby", tooltipId!);

  await addWorkspaceButton.dispatchEvent("pointerdown", { pointerType: "touch", bubbles: true });
  await expect(hint).toHaveCount(0);
  await expect(addWorkspaceButton).not.toHaveAttribute("aria-describedby");

  // Keyboard focus links the focused control to the tooltip so screen readers hear its description.
  while (!(await addWorkspaceButton.evaluate((node) => node === document.activeElement))) {
    await page.keyboard.press("Tab");
  }
  await expect(hint).toBeVisible();
  await expect(addWorkspaceButton).toHaveAccessibleDescription(/Add a project directory\./);
  await page.keyboard.press("Escape");
  await expect(hint).toHaveCount(0);
  await expect(addWorkspaceButton).not.toHaveAttribute("aria-describedby");
});
