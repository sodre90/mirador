import { expect, test, type Page } from "@playwright/test";
import { FakeClaudeApi, subscriptionEnvironment } from "./fake-claude-api.ts";
import { addWorkspace, createProfile, signIn, startConversation } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();
const api = new FakeClaudeApi();
const PROFILE = "fake subscription";

test.beforeAll(async () => {
  api.limited = false;
  await api.start();
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
  api.stop();
});

const messageBox = (page: Page) => page.locator(".composer:visible textarea");
const heightOf = (page: Page) => messageBox(page).evaluate((element) => element.getBoundingClientRect().height);
const paneHeight = (page: Page) => page.locator(".composer-area:visible").evaluate((element) => element.parentElement!.clientHeight);

async function dragGripUp(page: Page, by: number) {
  const grip = (await page.getByRole("separator", { name: "Message box height" }).boundingBox())!;
  const x = grip.x + grip.width / 2;
  const y = grip.y + grip.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - by, { steps: 5 });
  await page.mouse.up();
}

const expectNear = (actual: number, expected: number) => expect(Math.abs(actual - expected)).toBeLessThan(3);

test("the message box is dragged taller or smaller by its top edge, still grows with longer text, keeps its height in every conversation and after a reload, and fits its text again on double-click", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, PROFILE, subscriptionEnvironment(api));
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${PROFILE} · Claude Code` });
  await startConversation(page);
  const fitted = await heightOf(page);

  await dragGripUp(page, 80);
  expectNear(await heightOf(page), fitted + 80);
  await dragGripUp(page, -30);
  const dragged = await heightOf(page);
  expectNear(dragged, fitted + 50);

  await messageBox(page).fill(Array.from({ length: 30 }, (_, line) => `line ${line}`).join("\n"));
  expect(await heightOf(page)).toBeGreaterThan(dragged + 50);
  await messageBox(page).fill("");
  expectNear(await heightOf(page), dragged);

  await page.reload();
  await expect(messageBox(page)).toBeVisible();
  expectNear(await heightOf(page), dragged);
  await startConversation(page);
  expectNear(await heightOf(page), dragged);

  await dragGripUp(page, 2000);
  expectNear(await heightOf(page), Math.floor((await paneHeight(page)) * 0.7));

  await page.getByRole("separator", { name: "Message box height" }).dblclick();
  expectNear(await heightOf(page), fitted);
});
