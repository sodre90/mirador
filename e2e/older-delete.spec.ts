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

test("the Older line's trash asks with a list of every conversation under it, then deletes them, the open one too", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const kept = await startConversation(page);
  const first = await startConversation(page);
  const second = await startConversation(page);
  const row = (conversationId: string) => page.locator(`.workspace li[data-reorder-id="${conversationId}"]`);
  const older = page.locator(".workspace .older-group");
  const deleteOlder = older.getByRole("button", { name: "Delete older conversations…" });
  const prompt = page.getByRole("alertdialog", { name: /^Delete the 2 older conversations in / });

  await test.step("a week on, all but a favourite fold under Older, and its trash shows while the pointer is on its line", async () => {
    await row(kept).hover();
    await row(kept).getByRole("button", { name: "Add to favourites" }).click();
    await page.clock.setFixedTime(Date.now() + 8 * DAY_MS);
    await row(first).click();
    await expect(older.getByRole("button", { name: /^Older/ })).toHaveText("Older · 2");
    await expect(deleteOlder).toBeHidden();
    await older.locator(".older-heading").hover();
    await expect(deleteOlder).toBeVisible();
    await expect(deleteOlder).toHaveText("");
    await expect(deleteOlder).not.toHaveClass(/danger|armed/);
  });

  await test.step("it asks listing them, and Escape deletes nothing and gives the focus back to the Older line", async () => {
    await deleteOlder.click();
    await expect(prompt).toBeVisible();
    await expect(prompt.locator("li")).toHaveCount(2);
    await expect(prompt.getByRole("button", { name: "Cancel" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(prompt).toHaveCount(0);
    await expect(older.getByRole("button", { name: /^Older/ })).toHaveText("Older · 2");
    await expect(older.getByRole("button", { name: /^Older/ })).toBeFocused();
  });

  await test.step("Tab reaches the trash, and confirming deletes them, on the host too", async () => {
    // Off the Older line, so only the focus keeps its trash shown.
    await page.mouse.move(0, 0);
    await page.keyboard.press("Tab");
    await expect(deleteOlder).toBeFocused();
    await page.keyboard.press("Enter");
    await prompt.getByRole("button", { name: "Delete 2 conversations" }).click();
    await expect(prompt).toHaveCount(0);
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
