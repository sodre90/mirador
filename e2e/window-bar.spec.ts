import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, callCanvasTool, signIn, startConversation } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();

test.beforeAll(() => host.start());
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const windowBar = (page: Page) => page.locator(".window-bar");

async function expectStaysPutWhenClicked(page: Page, toggleClass: string) {
  const toggle = windowBar(page).locator(toggleClass);
  const before = await toggle.boundingBox();
  const pressedBefore = await toggle.getAttribute("aria-pressed");
  await toggle.click();
  await expect(toggle).not.toHaveAttribute("aria-pressed", pressedBefore!);
  expect(await toggle.boundingBox(), `${toggleClass} after a click`).toEqual(before);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", pressedBefore!);
  expect(await toggle.boundingBox(), `${toggleClass} after a second click`).toEqual(before);
}

test("the canvas and terminal toggles wait, disabled, in the window bar until a conversation is open", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  await expect(windowBar(page).getByRole("button", { name: "Show the sidebar" }).or(windowBar(page).getByRole("button", { name: "Hide the sidebar" }))).toBeEnabled();
  const paneToggles = windowBar(page).locator(".window-bar-panes button");
  await expect(paneToggles).toHaveCount(2);
  for (const toggle of await paneToggles.all()) await expect(toggle).toBeDisabled();
  await startConversation(page);
  for (const toggle of await paneToggles.all()) await expect(toggle).toBeEnabled();
});

for (const width of [1100, 1440]) {
  test(`at ${width}px wide, the sidebar, canvas and terminal toggles stay under the pointer as they hide and show their panes`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await signIn(page, host);
    const [newConversation, addProject] = [page.getByRole("button", { name: "+ New conversation" }), page.getByRole("button", { name: "+ Add a project directory" })];
    await expect(newConversation.or(addProject)).toBeVisible();
    if (await addProject.isVisible()) await addWorkspace(page, host.projectDir);
    const conversationId = await startConversation(page);
    await callCanvasTool(host, conversationId, "show", { title: "Open", html: "<p>canvas</p>" });
    await expect(windowBar(page).getByRole("button", { name: "Hide canvas" })).toBeVisible();

    await expectStaysPutWhenClicked(page, ".toggle-canvas");
    await expectStaysPutWhenClicked(page, ".toggle-terminal");
    await expectStaysPutWhenClicked(page, ".toggle-sidebar");
  });
}
