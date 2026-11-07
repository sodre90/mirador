import { mkdirSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { addWorkspace, dragOnto, reloadFromRestartedHost, sendMessage, signIn, startConversation, waitForTurnToEnd, workspaceCard } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  mkdirSync(host.projectDir, { recursive: true });
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const listedIds = (page: Page) =>
  workspaceCard(page, host.projectDir)
    .locator("li[data-reorder-id]")
    .evaluateAll((rows) => rows.map((row) => (row as HTMLElement).dataset.reorderId));

const rowOf = (page: Page, id: string) => page.locator(`li[data-reorder-id="${id}"]`);

async function chooseInOrderMenu(page: Page, entry: string) {
  await page.getByRole("button", { name: "Conversation order" }).click();
  await page.getByRole("menu", { name: "Conversation order" }).getByRole("menuitemcheckbox", { name: entry, exact: true }).click();
}

async function star(row: Locator, label: "Add to favourites" | "Remove from favourites") {
  await row.hover();
  await row.getByRole("button", { name: label }).click();
}

async function rename(page: Page, id: string, title: string) {
  await rowOf(page, id).locator(".conversation-title").dblclick();
  await page.getByLabel("Conversation name").fill(title);
  await page.getByLabel("Conversation name").press("Enter");
  await expect(rowOf(page, id).locator(".conversation-title")).toHaveText(title);
}

test("conversations order themselves by what the menu says, with favourites on top", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const first = await startConversation(page);
  const second = await startConversation(page);
  const third = await startConversation(page);
  await expect.poll(() => listedIds(page)).toEqual([third, second, first]);

  await test.step("a star on a conversation lifts it to the top of the custom order, for every window and after a reload", async () => {
    await star(rowOf(page, first), "Add to favourites");
    await expect.poll(() => listedIds(page)).toEqual([first, third, second]);
    await expect(rowOf(page, first).getByRole("button", { name: "Remove from favourites" })).toHaveAttribute("aria-pressed", "true");
    const otherWindow = await page.context().newPage();
    await otherWindow.goto(page.url());
    await expect.poll(() => listedIds(otherWindow)).toEqual([first, third, second]);
    await otherWindow.close();
    await page.reload();
    await expect.poll(() => listedIds(page)).toEqual([first, third, second]);
  });

  await test.step("dragging in the custom order keeps other conversations below the favourites", async () => {
    await dragOnto(page, rowOf(page, second), rowOf(page, first), "top");
    await expect(rowOf(page, third)).toHaveClass(/drop-before/);
    await page.mouse.up();
    await expect.poll(() => listedIds(page)).toEqual([first, second, third]);
  });

  await test.step("the custom order has no direction to choose", async () => {
    await page.getByRole("button", { name: "Conversation order" }).click();
    const menu = page.getByRole("menu", { name: "Conversation order" });
    await expect(menu.getByRole("menuitemcheckbox", { name: "Custom order" })).toHaveAttribute("aria-checked", "true");
    await expect(menu.getByRole("menuitemcheckbox", { name: "Newest first" })).toHaveCount(0);
    await page.keyboard.press("Escape");
  });

  await test.step("date created starts newest first and turns round, the favourite staying on top, and every window follows", async () => {
    const otherWindow = await page.context().newPage();
    await otherWindow.goto(page.url());
    await chooseInOrderMenu(page, "Date created");
    await expect.poll(() => listedIds(page)).toEqual([first, third, second]);
    await expect.poll(() => listedIds(otherWindow)).toEqual([first, third, second]);
    await chooseInOrderMenu(page, "Oldest first");
    await expect.poll(() => listedIds(page)).toEqual([first, second, third]);
    await expect.poll(() => listedIds(otherWindow)).toEqual([first, second, third]);
    await otherWindow.close();
  });

  await test.step("a conversation can't be dragged while an automatic order decides where it goes", async () => {
    await dragOnto(page, rowOf(page, third), rowOf(page, second), "top");
    await expect(rowOf(page, third)).not.toHaveClass(/dragged/);
    await page.mouse.up();
    expect(await listedIds(page)).toEqual([first, second, third]);
  });

  await test.step("titles go A to Z, or Z to A", async () => {
    await rename(page, second, "Zebra");
    await rename(page, third, "Apple");
    await chooseInOrderMenu(page, "Title");
    await expect.poll(() => listedIds(page)).toEqual([first, third, second]);
    await chooseInOrderMenu(page, "Z to A");
    await expect.poll(() => listedIds(page)).toEqual([first, second, third]);
  });

  await test.step("a message and the end of its turn bring a conversation up in the orders that follow them", async () => {
    await chooseInOrderMenu(page, "Last activity");
    await expect.poll(() => listedIds(page)).toEqual([first, third, second]);
    await rowOf(page, second).click();
    await sendMessage(page, "Reply with the single word: ok");
    expect(await listedIds(page)).toEqual([first, third, second]);
    await page.locator(".composer:visible textarea").hover();
    await expect.poll(() => listedIds(page)).toEqual([first, second, third]);
    await page.locator(".composer:visible .stop").click({ timeout: 5_000 }).catch(() => "the turn already ended");
    await waitForTurnToEnd(page);
    await chooseInOrderMenu(page, "Your last message");
    await expect.poll(() => listedIds(page)).toEqual([first, second, third]);
    await chooseInOrderMenu(page, "Agent's last reply");
    await expect.poll(() => listedIds(page)).toEqual([first, second, third]);
    await chooseInOrderMenu(page, "Oldest first");
    await expect.poll(() => listedIds(page)).toEqual([first, third, second]);
  });

  await test.step("the chosen order outlasts a host restart", async () => {
    await host.stop();
    await host.start();
    await reloadFromRestartedHost(page);
    await expect.poll(() => listedIds(page)).toEqual([first, third, second]);
    await page.getByRole("button", { name: "Conversation order" }).click();
    await expect(page.getByRole("menuitemcheckbox", { name: "Agent's last reply" })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("menuitemcheckbox", { name: "Oldest first" })).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");
  });

  await test.step("the star next to the open conversation's title and the right-click menu do the same", async () => {
    await chooseInOrderMenu(page, "Custom order");
    await star(rowOf(page, first), "Remove from favourites");
    await expect.poll(() => listedIds(page)).toEqual([second, third, first]);
    await rowOf(page, third).click();
    await page.locator(".chat-header:visible").getByRole("button", { name: "Add to favourites" }).click();
    await expect.poll(async () => (await listedIds(page))[0]).toEqual(third);
    await rowOf(page, second).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Add to favourites" }).click();
    await expect(rowOf(page, second).getByRole("button", { name: "Remove from favourites" })).toBeVisible();
    await rowOf(page, second).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Remove from favourites" }).click();
    await page.locator(".chat-header:visible").getByRole("button", { name: "Remove from favourites" }).click();
    await expect(rowOf(page, third).getByRole("button", { name: /favourites/ })).toHaveAttribute("aria-pressed", "false");
  });

  await test.step("an untitled conversation comes last by title, either way round", async () => {
    await chooseInOrderMenu(page, "Title");
    await expect.poll(() => listedIds(page)).toEqual([third, second, first]);
    await chooseInOrderMenu(page, "Z to A");
    await expect.poll(() => listedIds(page)).toEqual([second, third, first]);
  });
});
