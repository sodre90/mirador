import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, openSettings, signIn, startConversation } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();

test.beforeAll(async () => {
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const DAY_MS = 24 * 60 * 60 * 1000;

const expectOpen = (page: Page, conversationId: string) => expect(page).toHaveURL(new RegExp(`#/c/${conversationId}$`));

test("a workspace folds the conversations nobody touched for a week under Older, keeps favourites in the list, and Settings choose how long or turn the fold off", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const resting = await startConversation(page);
  const starred = await startConversation(page);
  const list = page.locator(".workspace > ul");
  const older = page.locator(".workspace .older-group");
  const olderToggle = older.getByRole("button", { name: /^. Older/ });
  const row = (conversationId: string) => page.locator(`.workspace li[data-reorder-id="${conversationId}"]`);

  await test.step("conversations of this week are all in the list", async () => {
    await expect(list.locator("li")).toHaveCount(2);
    await expect(older).toHaveCount(0);
  });

  await test.step("eight days on, they are under Older, which is open as it holds the open conversation", async () => {
    await page.clock.setFixedTime(Date.now() + 8 * DAY_MS);
    await row(resting).click();
    await expect(olderToggle).toHaveText("▾ Older (2)");
    await expect(olderToggle).toHaveAttribute("data-hint", /nobody wrote in for 1 week/);
    await expect(older.locator("li")).toHaveCount(2);
    await expect(list).toHaveCount(0);
  });

  await test.step("a favourite goes back into the list", async () => {
    await row(starred).hover();
    await row(starred).getByRole("button", { name: "Add to favourites" }).click();
    await expect(list.locator("li")).toHaveCount(1);
    await expect(list.locator(`li[data-reorder-id="${starred}"]`)).toBeVisible();
    await expect(olderToggle).toHaveText("▾ Older (1)");
  });

  await test.step("Older folds to its line and opens again, and the keys step past what it holds", async () => {
    await row(starred).click();
    await olderToggle.click();
    await expect(olderToggle).toHaveText("▸ Older (1)");
    await expect(row(resting)).toHaveCount(0);
    await page.keyboard.press("Alt+ArrowDown");
    await expectOpen(page, starred);
    await olderToggle.click();
    await expect(row(resting)).toBeVisible();
    await row(resting).click();
    await expectOpen(page, resting);
  });

  await test.step("back in the week they were made, nothing is folded", async () => {
    await page.clock.setFixedTime(Date.now());
    await row(starred).click();
    await expect(older).toHaveCount(0);
    await expect(list.locator("li")).toHaveCount(2);
  });

  const foldAfter = async (choice: string) => {
    const settings = await openSettings(page, "Conversations");
    await settings.locator("select.older-after").selectOption({ label: choice });
    await settings.getByRole("button", { name: "Close" }).click();
  };

  await test.step("two days on, a day is long enough once Settings say so", async () => {
    await page.clock.setFixedTime(Date.now() + 2 * DAY_MS);
    await row(starred).click();
    await expect(older).toHaveCount(0);
    await foldAfter("1 day");
    await expect(olderToggle).toHaveText(/Older \(1\)$/);
    await expect(olderToggle).toHaveAttribute("data-hint", /nobody wrote in for 1 day/);
  });

  await test.step("Never folds none, and the host keeps the choice", async () => {
    await foldAfter("Never");
    await expect(older).toHaveCount(0);
    await expect(list.locator("li")).toHaveCount(2);
    await page.reload();
    const settings = await openSettings(page, "Conversations");
    await expect(settings.locator("select.older-after")).toHaveValue("off");
  });
});
