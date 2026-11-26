import { expect, test } from "@playwright/test";
import { basename } from "node:path";
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

test("A conversation's right-click menu deletes it, the conversations below it, or the others in its workspace, as a browser tab's menu closes tabs", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  for (let started = 0; started < 5; started++) await startConversation(page);
  const rows = page.locator(".workspace li[data-reorder-id]");
  const rowIds = () => rows.evaluateAll((listed) => listed.map((row) => row.getAttribute("data-reorder-id")!));
  const row = (conversationId: string) => page.locator(`.workspace li[data-reorder-id="${conversationId}"]`);
  const menu = page.getByRole("menu");
  const menuEntry = (name: string) => menu.getByRole("menuitem", { name, exact: true });
  const prompt = page.getByRole("alertdialog");
  const [top, second, ...below] = await rowIds();

  await test.step("the delete entries come last, not red and each with its own icon, and those for several open a prompt", async () => {
    await row(second!).click({ button: "right" });
    await expect(menu.getByRole("menuitem")).toHaveText([
      "Mark as unread",
      "Add to favourites",
      "Remind me…",
      "Fork conversation",
      "Delete conversation",
      "Delete other conversations…",
      "Delete conversations below…",
    ]);
    const deletes = ["Delete conversation", "Delete other conversations…", "Delete conversations below…"].map(menuEntry);
    for (const entry of deletes) await expect(entry).not.toHaveClass(/danger/);
    const icons = await Promise.all(deletes.map((entry) => entry.locator("svg").innerHTML()));
    expect(new Set(icons).size).toBe(3);
    await menuEntry("Delete conversations below…").click();
    await expect(menu).toHaveCount(0);
    await expect(prompt.getByRole("heading")).toHaveText(/^Delete the 3 conversations below “.+”\?$/);
    await expect(prompt.getByRole("listitem")).toHaveCount(3);
    await expect(prompt.getByRole("button", { name: "Cancel" })).toBeFocused();
    await expect(prompt.getByRole("button", { name: "Delete 3 conversations" })).toBeVisible();
  });

  await test.step("Esc deletes nothing", async () => {
    await page.keyboard.press("Escape");
    await expect(prompt).toHaveCount(0);
    await expect(rows).toHaveCount(5);
  });

  await test.step("confirming deletes every row under it and keeps those above, across a reload", async () => {
    await row(second!).click({ button: "right" });
    await menuEntry("Delete conversations below…").click();
    await prompt.getByRole("button", { name: "Delete 3 conversations" }).click();
    await expect(prompt).toHaveCount(0);
    for (const gone of below) await expect(row(gone)).toHaveCount(0);
    expect(await rowIds()).toEqual([top, second]);
    await page.reload();
    await expect(rows).toHaveCount(2);
  });

  await test.step("the last row has nothing below to delete, and Delete other conversations names the workspace", async () => {
    await row(second!).click({ button: "right" });
    await expect(menuEntry("Delete conversations below…")).toHaveCount(0);
    await menuEntry("Delete other conversations…").click();
    await expect(prompt.getByRole("heading")).toHaveText(`Delete the other conversation in ${basename(host.projectDir)}?`);
    await prompt.getByRole("button", { name: "Delete 1 conversation" }).click();
    await expect(row(top!)).toHaveCount(0);
    expect(await rowIds()).toEqual([second]);
  });

  await test.step("a lone conversation offers only Delete conversation, which asks again in place", async () => {
    await row(second!).click({ button: "right" });
    await expect(menuEntry("Delete other conversations…")).toHaveCount(0);
    await menuEntry("Delete conversation").click();
    await expect(menuEntry("Confirm: Delete conversation")).toHaveText("Delete?");
    await menuEntry("Confirm: Delete conversation").click();
    await expect(rows).toHaveCount(0);
  });

  await test.step("the prompt goes away once those it lists are deleted in another tab", async () => {
    const [kept, ...others] = [await startConversation(page), await startConversation(page), await startConversation(page)];
    await row(kept!).click({ button: "right" });
    await menuEntry("Delete other conversations…").click();
    await expect(prompt.getByRole("listitem")).toHaveCount(2);
    const otherTab = await page.context().newPage();
    await otherTab.goto(host.origin);
    for (const other of others) {
      const otherRow = otherTab.locator(`.workspace li[data-reorder-id="${other}"]`);
      await otherRow.hover();
      await otherRow.getByRole("button", { name: "Delete conversation" }).click();
      await otherRow.getByRole("button", { name: "Confirm: Delete conversation" }).click();
      await expect(otherRow).toHaveCount(0);
    }
    await otherTab.close();
    await expect(prompt).toHaveCount(0);
    await row(kept!).click({ button: "right" });
    await menuEntry("Delete conversation").click();
    await menuEntry("Confirm: Delete conversation").click();
    await expect(rows).toHaveCount(0);
  });

  await test.step("a favourite stays when the other conversations go, and the prompt doesn't count it as staying", async () => {
    const [asking, favourite, other] = [await startConversation(page), await startConversation(page), await startConversation(page)];
    await row(favourite!).hover();
    await row(favourite!).getByRole("button", { name: "Add to favourites" }).click();
    await expect(row(favourite!).getByRole("button", { name: "Remove from favourites" })).toHaveAttribute("aria-pressed", "true");
    await row(asking!).click({ button: "right" });
    await menuEntry("Delete other conversations…").click();
    await expect(prompt.getByRole("heading")).toHaveText(`Delete the other conversation in ${basename(host.projectDir)}?`);
    await expect(prompt).not.toContainText("still at work");
    await prompt.getByRole("button", { name: "Delete 1 conversation" }).click();
    await expect(row(other!)).toHaveCount(0);
    expect((await rowIds()).sort()).toEqual([asking!, favourite!].sort());
    for (const left of [favourite!, asking!]) {
      await row(left).click({ button: "right" });
      await menuEntry("Delete conversation").click();
      await menuEntry("Confirm: Delete conversation").click();
      await expect(row(left)).toHaveCount(0);
    }
  });

  await test.step("a week on, Delete conversations below reaches those folded under Older", async () => {
    const kept = await startConversation(page);
    const folding = [await startConversation(page), await startConversation(page)];
    await row(kept).hover();
    await row(kept).getByRole("button", { name: "Add to favourites" }).click();
    await page.clock.setFixedTime(Date.now() + 8 * DAY_MS);
    await row(folding[0]!).click();
    const older = page.locator(".workspace .older-group");
    await expect(older.getByRole("button", { name: /^Older/ })).toHaveText("Older · 2");
    await row(kept).click({ button: "right" });
    await menuEntry("Delete conversations below…").click();
    await prompt.getByRole("button", { name: "Delete 2 conversations" }).click();
    await expect(older).toHaveCount(0);
    expect(await rowIds()).toEqual([kept]);
  });
});
