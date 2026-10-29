import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, callCanvasTool, signIn, workspaceCard } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();
const secondProjectDir = join(host.root, "second-project");

test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  await host.start();
  mkdirSync(secondProjectDir);
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

/** The app picks Cmd or Ctrl from the user agent, which the Playwright device profile sets. */
const primaryModifier = async (page: Page) => ((await page.evaluate(() => navigator.userAgent.includes("Mac"))) ? "Meta" : "Control");

const selectedConversationId = (page: Page) => page.url().match(/#\/c\/(.+)$/)?.[1] ?? null;

async function pressAndAwaitNewConversation(page: Page, keys: () => Promise<void>) {
  const before = selectedConversationId(page);
  await keys();
  await expect.poll(() => selectedConversationId(page)).not.toBe(before);
  await expect(page.locator(".chat-header:visible h2")).toHaveText("New conversation");
  return selectedConversationId(page)!;
}

async function expectSelected(page: Page, conversationId: string) {
  await expect.poll(() => selectedConversationId(page)).toBe(conversationId);
}

const focusedTag = (page: Page) => page.evaluate(() => document.activeElement?.tagName);

test("conversations, workspaces, the canvas and the dialogs are all reachable from the keyboard", async ({ page }) => {
  await signIn(page, host);
  const primary = await primaryModifier(page);
  await addWorkspace(page, secondProjectDir);

  await page.keyboard.press(`${primary}+KeyK`);
  const palette = page.getByLabel("Search conversations and actions");
  await palette.fill("add workspace");
  await palette.press("Enter");
  const directory = page.getByLabel("Workspace directory");
  await directory.fill(host.projectDir);
  await directory.press("Enter");
  await expect(workspaceCard(page, host.projectDir)).toBeVisible();
  await page.keyboard.press("Alt+Shift+KeyT");
  await expect(directory).toBeFocused();
  await directory.press("Escape");
  await expect(directory).toHaveCount(0);

  const first = await pressAndAwaitNewConversation(page, () => page.keyboard.press("Alt+KeyT"));
  const second = await pressAndAwaitNewConversation(page, () => page.keyboard.press("Alt+KeyT"));
  const inSecondProject = await pressAndAwaitNewConversation(page, async () => {
    await page.keyboard.press(`${primary}+KeyK`);
    await palette.fill("new conversation second-project");
    await palette.press("Enter");
  });
  await expect(page.locator(".workspace").nth(1).locator("li")).toHaveCount(1);
  await expect(page.locator(".workspace").nth(0).locator("li")).toHaveCount(2);

  await page.keyboard.press("Alt+ArrowDown");
  await expectSelected(page, second);
  await page.keyboard.press("Alt+ArrowDown");
  await expectSelected(page, first);
  await page.keyboard.press("Alt+Shift+ArrowDown");
  await expectSelected(page, inSecondProject);
  await page.keyboard.press("Alt+Shift+ArrowUp");
  await expectSelected(page, second);
  await page.keyboard.press("Alt+Digit2");
  await expectSelected(page, first);

  await page.keyboard.press(`${primary}+KeyK`);
  await palette.fill("second-project");
  await expect(page.getByRole("dialog", { name: "Palette" }).getByRole("option").first()).toHaveText(/New conversation\s*second-project/);
  await palette.press("Enter");
  await expectSelected(page, inSecondProject);

  await callCanvasTool(host, inSecondProject, "show", { title: "Page", html: "<p>canvas page</p>" });
  await expect(page.locator(".canvas-panel:visible .canvas-frame.show iframe")).toBeVisible();
  await page.keyboard.press(`${primary}+Backslash`);
  await expect(page.locator(".canvas-panel:visible")).toHaveCount(0);
  await page.keyboard.press(`${primary}+Shift+ArrowRight`);
  await expect(page.locator(".canvas-panel:visible .canvas-frame.show iframe")).toBeVisible();
  await expect.poll(() => focusedTag(page)).toBe("IFRAME");
  await expect(page.frameLocator(".canvas-panel:visible .canvas-frame.show iframe").getByText("canvas page")).toBeVisible();
  await page.keyboard.press(`${primary}+Shift+ArrowLeft`);
  await expect.poll(() => focusedTag(page)).toBe("TEXTAREA");

  await page.keyboard.press("?");
  await expect(page.locator(".composer:visible textarea")).toHaveValue("?");
  await page.locator(".composer:visible textarea").fill("");
  await page.locator(".sidebar h1").click();
  await page.keyboard.press("?");
  const help = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(help).toBeVisible();
  await page.keyboard.press("Alt+ArrowDown");
  await page.keyboard.press("Escape");
  await expect(help).toHaveCount(0);
  await expectSelected(page, inSecondProject);

  await page.keyboard.press(`${primary}+KeyK`);
  await palette.fill("profiles");
  await palette.press("Enter");
  await expect(page.getByRole("dialog", { name: "Profiles" })).toBeVisible();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.keyboard.type("x");
  await expect(page.locator(".composer:visible textarea")).toHaveValue("");
  await page.keyboard.press("Escape");
  await expect.poll(() => focusedTag(page)).toBe("TEXTAREA");
});

test("keys pressed inside a focused canvas page navigate, but cannot create conversations or reload the page", async ({ page }) => {
  await signIn(page, host);
  const primary = await primaryModifier(page);
  await page.locator(".workspace").nth(1).locator("li").first().click();
  const conversationsBefore = await page.locator(".workspace li").count();
  const canvasPage = page.locator(".canvas-panel:visible .canvas-frame.show iframe");
  await expect(canvasPage).toBeVisible();

  await page.keyboard.press(`${primary}+Shift+ArrowRight`);
  await expect.poll(() => focusedTag(page)).toBe("IFRAME");
  await page.keyboard.press(`${primary}+KeyK`);
  await expect(page.getByRole("dialog", { name: "Palette" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Palette" })).toHaveCount(0);

  await page.evaluate(() => ((window as unknown as { stillThisPage: boolean }).stillThisPage = true));
  await canvasPage.focus();
  await expect.poll(() => focusedTag(page)).toBe("IFRAME");
  await page.keyboard.press(`${primary}+KeyR`);
  await page.waitForTimeout(1_000);
  expect(await page.evaluate(() => (window as unknown as { stillThisPage?: boolean }).stillThisPage)).toBe(true);

  await canvasPage.focus();
  await expect.poll(() => focusedTag(page)).toBe("IFRAME");
  await page.keyboard.press("Alt+KeyT");
  await page.keyboard.press("Alt+ArrowUp");
  await expect(page.locator(".workspace").nth(0).locator("li.selected")).toHaveCount(1);
  await page.waitForTimeout(1_000);
  await expect(page.locator(".workspace li")).toHaveCount(conversationsBefore);
});
