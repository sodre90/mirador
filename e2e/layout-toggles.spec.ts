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

for (const width of [1100, 1440]) {
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
