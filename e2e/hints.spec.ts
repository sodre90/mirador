import { expect, test } from "@playwright/test";
import { addWorkspace, signIn } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();

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

test("help text in the app stays where it is written, unlike the hint bubble", async ({ page }) => {
  await signIn(page, host);
  await page.getByRole("button", { name: "Continue a session…" }).click();
  const help = page.locator(".modal.sessions p.hint");
  await expect(help).toBeVisible();
  await expect(help).toHaveCSS("position", "static");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
});
