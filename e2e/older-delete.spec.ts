import { expect, test } from "@playwright/test";
import { addWorkspace, signIn, startConversation } from "./helpers.ts";
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

test("Delete all on the Older line deletes every conversation under it, the open one too, and leaves the list", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const kept = await startConversation(page);
  const first = await startConversation(page);
  const second = await startConversation(page);
  const row = (conversationId: string) => page.locator(`.workspace li[data-reorder-id="${conversationId}"]`);
  const older = page.locator(".workspace .older-group");
  const deleteAll = older.getByRole("button", { name: "Delete older conversations" });

  await test.step("a week on, all but a favourite fold under Older, and Delete all shows while the pointer is on its line", async () => {
    await row(kept).hover();
    await row(kept).getByRole("button", { name: "Add to favourites" }).click();
    await page.clock.setFixedTime(Date.now() + 8 * DAY_MS);
    await row(first).click();
    await expect(older.getByRole("button", { name: /^. Older/ })).toHaveText("▾ Older (2)");
    await expect(deleteAll).toBeHidden();
    await older.locator(".older-heading").hover();
    await expect(deleteAll).toBeVisible();
    await expect(deleteAll).toHaveText("Delete all");
  });

  await test.step("the first click asks how many go, the second deletes them, and the host forgets them", async () => {
    await deleteAll.click();
    await expect(older.getByRole("button", { name: "Confirm: Delete older conversations" })).toHaveText("Delete 2?");
    await older.getByRole("button", { name: "Confirm: Delete older conversations" }).click();
    await expect(older).toHaveCount(0);
    await expect(row(first)).toHaveCount(0);
    await expect(row(second)).toHaveCount(0);
    await expect(page).not.toHaveURL(new RegExp(`#/c/${first}$`));
    await expect(row(kept)).toBeVisible();
    await page.reload();
    await expect(row(kept)).toBeVisible();
    await expect(page.locator(".workspace li")).toHaveCount(1);
  });
});
