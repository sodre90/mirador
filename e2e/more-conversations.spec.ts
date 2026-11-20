import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, listConversationsPerWorkspace, openSettings, signIn, startConversation } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();

test.beforeAll(async () => {
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const expectOpen = (page: Page, conversationId: string) => expect(page).toHaveURL(new RegExp(`#/c/${conversationId}$`));

test("a workspace lists its most recently active conversations, folds the rest under More, keeps favourites in the list, and Settings choose how many", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const list = page.locator(".workspace > ul");
  const more = page.locator(".workspace .more-group");
  const moreToggle = more.getByRole("button", { name: /^More/ });
  const row = (conversationId: string) => page.locator(`.workspace li[data-reorder-id="${conversationId}"]`);

  await test.step("Settings list eight per workspace unless told otherwise", async () => {
    const settings = await openSettings(page, "Conversations");
    await expect(settings.locator("select.conversations-shown")).toHaveValue("8");
    await settings.getByRole("button", { name: "Close" }).click();
    await listConversationsPerWorkspace(page, "5");
  });

  const first = await startConversation(page);
  const second = await startConversation(page);
  for (let started = 0; started < 3; started++) await startConversation(page);
  const newest = await startConversation(page);

  await test.step("the least recently active goes under More, folded, with nothing there to delete it", async () => {
    await expect(list.locator("li")).toHaveCount(5);
    await expect(row(first)).toHaveCount(0);
    await expect(moreToggle).toHaveText("More · 1");
    await expect(moreToggle).toHaveAttribute("aria-expanded", "false");
    await expect(moreToggle).toHaveAttribute("data-hint", /holds the 5 most recently active/);
    await expect(more.getByRole("button", { name: "Delete all" })).toHaveCount(0);
  });

  await test.step("More opens to its conversations, and opens by itself when the open conversation is one of them", async () => {
    await moreToggle.click();
    await expect(more.locator(`li[data-reorder-id="${first}"]`)).toBeVisible();
    await moreToggle.click();
    await expect(row(first)).toHaveCount(0);
    await page.evaluate((id) => (location.hash = `#/c/${id}`), first);
    await expectOpen(page, first);
    await expect(moreToggle).toHaveAttribute("aria-expanded", "true");
    await expect(more.locator(`li[data-reorder-id="${first}"]`)).toBeVisible();
  });

  await test.step("a favourite goes back into the list and takes one of its places", async () => {
    await row(first).hover();
    await row(first).getByRole("button", { name: "Add to favourites" }).click();
    await expect(list.locator(`li[data-reorder-id="${first}"]`)).toBeVisible();
    await expect(list.locator("li")).toHaveCount(5);
    await expect(more.locator(`li[data-reorder-id="${second}"]`)).toBeVisible();
    await expect(moreToggle).toHaveText("More · 1");
  });

  await test.step("the keys step past what More holds", async () => {
    await row(newest).click();
    await moreToggle.click();
    await expect(row(second)).toHaveCount(0);
    for (let step = 0; step < 5; step++) {
      await page.keyboard.press("Alt+ArrowDown");
      await expect(page).not.toHaveURL(new RegExp(`#/c/${second}$`));
    }
  });

  await test.step("All lists every conversation, and the host keeps the choice", async () => {
    await listConversationsPerWorkspace(page, "All");
    await expect(more).toHaveCount(0);
    await expect(list.locator("li")).toHaveCount(6);
    await page.reload();
    const settings = await openSettings(page, "Conversations");
    await expect(settings.locator("select.conversations-shown")).toHaveValue("all");
  });
});
