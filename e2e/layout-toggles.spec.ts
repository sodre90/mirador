import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, callCanvasTool, signIn, startConversation } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();

test.beforeAll(() => host.start());
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const toggles = (page: Page) => page.locator(".layout-toggles:visible");

async function expectStaysPutWhenClicked(page: Page, toggleClass: string) {
  const toggle = toggles(page).locator(toggleClass);
  const before = await toggle.boundingBox();
  const pressedBefore = await toggle.getAttribute("aria-pressed");
  await toggle.click();
  await expect(toggle).not.toHaveAttribute("aria-pressed", pressedBefore!);
  expect(await toggle.boundingBox(), `${toggleClass} after a click`).toEqual(before);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", pressedBefore!);
  expect(await toggle.boundingBox(), `${toggleClass} after a second click`).toEqual(before);
}

test("with no conversation open, the sidebar toggle still works and the canvas and terminal toggles wait, disabled", async ({ page }) => {
  await page.setViewportSize({ width: 1800, height: 900 });
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  await expect(page.getByText("No conversation selected")).toBeVisible();
  const paneToggles = toggles(page).locator(".toggle-canvas, .toggle-terminal");
  await expect(paneToggles, "each pane's toggle names it, the same whether it hides or shows").toHaveText(["Canvas", "Terminal"]);
  for (const toggle of await paneToggles.all()) await expect(toggle).toBeDisabled();
  await toggles(page).getByRole("button", { name: "Hide the sidebar" }).click();
  await expect(page.locator(".sidebar")).toHaveCount(0);
  await toggles(page).getByRole("button", { name: "Show the sidebar" }).click();
  await expect(page.locator(".sidebar")).toBeVisible();

  await startConversation(page);
  await expect(page.locator(".chat-header:visible .layout-toggles")).toBeVisible();
  for (const toggle of await paneToggles.all()) await expect(toggle).toBeEnabled();
});

test("in a window up to 1700px wide the canvas and terminal toggles show only their icons, leaving the conversation's title the room", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await signIn(page, host);
  const [newConversation, addProject] = [page.getByRole("button", { name: "+ New conversation" }), page.getByRole("button", { name: "+ Add a project directory" })];
  await expect(newConversation.or(addProject)).toBeVisible();
  if (await addProject.isVisible()) await addWorkspace(page, host.projectDir);
  await startConversation(page);
  const paneToggles = toggles(page).locator(".toggle-canvas, .toggle-terminal");
  await expect(paneToggles).toHaveCount(2);
  for (const toggle of await paneToggles.all()) await expect(toggle).toHaveText("", { useInnerText: true });
  await expect(toggles(page).getByRole("button", { name: "Show terminal" })).toBeVisible();
  await page.setViewportSize({ width: 1800, height: 900 });
  await expect(paneToggles).toHaveText(["Canvas", "Terminal"], { useInnerText: true });
});

for (const width of [1100, 1440, 1800]) {
  test(`at ${width}px wide, the canvas and terminal toggles at the start of the conversation's bar stay under the pointer as they hide and show their panes`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await signIn(page, host);
    const [newConversation, addProject] = [page.getByRole("button", { name: "+ New conversation" }), page.getByRole("button", { name: "+ Add a project directory" })];
    await expect(newConversation.or(addProject)).toBeVisible();
    if (await addProject.isVisible()) await addWorkspace(page, host.projectDir);
    const conversationId = await startConversation(page);
    await callCanvasTool(host, conversationId, "show", { title: "Open", html: "<p>canvas</p>" });
    await expect(toggles(page).getByRole("button", { name: "Hide canvas" })).toBeVisible();

    await expectStaysPutWhenClicked(page, ".toggle-canvas");
    await expectStaysPutWhenClicked(page, ".toggle-terminal");
  });
}

test.describe("under a banner", () => {
  const editedHost = new TestHost({ copiesSource: true });
  test.beforeAll(() => editedHost.start());
  test.afterAll(async () => {
    await editedHost.stop();
    await editedHost.cleanUp();
  });

  test("a banner keeps to one line in a narrow conversation column, so the toggles below it stay put as the canvas hides", async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 900 });
    await signIn(page, editedHost);
    await addWorkspace(page, editedHost.projectDir);
    appendFileSync(join(editedHost.sourceDir, "host/main.ts"), "\n// edited by the e2e test\n");
    const banner = page.locator(".banner.host-code-changed");
    await expect(banner).toBeVisible();
    await expect(banner.getByRole("button", { name: /Restart host/ })).toBeVisible();
    const conversationId = await startConversation(page);
    await callCanvasTool(editedHost, conversationId, "show", { title: "Open", html: "<p>canvas</p>" });
    await expect(toggles(page).getByRole("button", { name: "Hide canvas" })).toBeVisible();

    await expectStaysPutWhenClicked(page, ".toggle-canvas");
  });
});

test("however narrow the conversation's pane gets, every button of its bar stays inside it on one line, the settings turning into an icon where their names don't fit", async ({ page }) => {
  await page.setViewportSize({ width: 1800, height: 900 });
  await signIn(page, host);
  const [newConversation, addProject] = [page.getByRole("button", { name: "+ New conversation" }), page.getByRole("button", { name: "+ Add a project directory" })];
  await expect(newConversation.or(addProject)).toBeVisible();
  if (await addProject.isVisible()) await addWorkspace(page, host.projectDir);
  const conversationId = await startConversation(page);
  await callCanvasTool(host, conversationId, "show", { title: "Open", html: "<p>canvas</p>" });
  await expect(toggles(page).getByRole("button", { name: "Hide canvas" })).toBeVisible();
  const header = page.locator(".chat-header:visible");
  const heightAtFullWidth = (await header.boundingBox())!.height;
  for (const conversationWidth of [700, 560, 480, 440, 400, 377, 320]) {
    await page.locator(".workspace-area:visible").evaluate((area, width) => (area.style.gridTemplateColumns = `${width}px 7px minmax(0, 1fr)`), conversationWidth);
    await expect.poll(async () => Math.round((await header.boundingBox())!.width)).toBe(conversationWidth);
    const bar = (await header.boundingBox())!;
    for (const button of await header.locator(".title-line button:visible").all()) {
      const box = (await button.boundingBox())!;
      expect(box.x + box.width, `${await button.getAttribute("class")} at ${conversationWidth}px`).toBeLessThanOrEqual(bar.x + bar.width);
    }
    const settings = header.locator(".conversation-settings-toggle");
    if (conversationWidth > 440) expect((await settings.boundingBox())!.width, `settings at ${conversationWidth}px`).toBeGreaterThanOrEqual(70);
    else {
      await expect(settings.locator(".settings-icon"), `at ${conversationWidth}px the settings show as an icon`).toBeVisible();
      await expect(settings.locator(".settings-summary")).toBeHidden();
      await expect(settings).toHaveAttribute("data-hint", /^Claude Code · /);
    }
    if (conversationWidth >= 377) expect((await header.boundingBox())!.height, `one line at ${conversationWidth}px`).toBe(heightAtFullWidth);
  }
});
