import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { addWorkspace, dragOnto, signIn, startConversation, workspaceCard } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();
const secondDir = join(host.root, "second");

test.beforeAll(async () => {
  mkdirSync(host.projectDir, { recursive: true });
  mkdirSync(secondDir, { recursive: true });
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const idsOf = (items: Locator) => items.evaluateAll((elements) => elements.map((element) => (element as HTMLElement).dataset.reorderId));
const workspaceIds = (page: Page) => idsOf(page.locator(".sidebar-scroll > section.workspace"));
const conversationIds = (page: Page, directory: string) => idsOf(workspaceCard(page, directory).locator("li[data-reorder-id]"));

test("workspaces, and conversations within theirs, are dragged into an order every window keeps", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const [first, second, third] = [await startConversation(page), await startConversation(page), await startConversation(page)];
  const row = (id: string) => page.locator(`li[data-reorder-id="${id}"]`);

  await test.step("a conversation dragged below another lands there, selecting no text on the way, and the drag opens nothing", async () => {
    expect(await conversationIds(page, host.projectDir)).toEqual([third, second, first]);
    await dragOnto(page, row(second), row(first), "bottom");
    await expect(row(first)).toHaveClass(/drop-after/);
    await expect(row(second)).toHaveClass(/dragged/);
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("");
    await page.mouse.up();
    await expect.poll(() => conversationIds(page, host.projectDir)).toEqual([third, first, second]);
    await expect(row(third)).toHaveClass(/selected/);
  });

  await test.step("another window shows the same order, and so does a reload", async () => {
    const otherWindow = await page.context().newPage();
    await otherWindow.goto(page.url());
    await expect.poll(() => conversationIds(otherWindow, host.projectDir)).toEqual([third, first, second]);
    await otherWindow.close();
    await page.reload();
    await expect.poll(() => conversationIds(page, host.projectDir)).toEqual([third, first, second]);
  });

  await test.step("a short drag that ends on its own row neither moves nor opens the conversation", async () => {
    const box = (await row(second).boundingBox())!;
    await page.mouse.move(box.x + 20, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 40, box.y + box.height / 2, { steps: 5 });
    await page.mouse.up();
    await expect(row(third)).toHaveClass(/selected/);
    await expect(row(second)).not.toHaveClass(/selected/);
    expect(await conversationIds(page, host.projectDir)).toEqual([third, first, second]);
  });

  await test.step("Esc cancels a drag", async () => {
    await dragOnto(page, row(second), row(first), "top");
    await expect(row(first)).toHaveClass(/drop-before/);
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await expect(row(first)).not.toHaveClass(/drop-before/);
    expect(await conversationIds(page, host.projectDir)).toEqual([third, first, second]);
  });

  await page.getByRole("button", { name: "Add workspace" }).click();
  await page.getByLabel("Workspace directory").fill(secondDir);
  await page.getByLabel("Workspace directory").press("Enter");
  await expect(workspaceCard(page, secondDir)).toBeVisible();
  await workspaceCard(page, secondDir).getByRole("button", { name: "+ New conversation" }).click();
  await expect(workspaceCard(page, secondDir).locator("li[data-reorder-id]")).toHaveCount(1);
  const [secondId, projectId] = await workspaceIds(page);
  const heading = (directory: string) => workspaceCard(page, directory).locator("header");

  await test.step("a conversation dragged over another workspace, which a new one is above, stays in its own, first", async () => {
    await dragOnto(page, row(first), workspaceCard(page, secondDir), "bottom");
    await page.mouse.up();
    await expect.poll(() => conversationIds(page, host.projectDir)).toEqual([first, third, second]);
    await expect(workspaceCard(page, secondDir).locator("li[data-reorder-id]")).toHaveCount(1);
  });

  await test.step("a workspace dragged by its heading above another moves there, and stays after a reload", async () => {
    await dragOnto(page, heading(host.projectDir), heading(secondDir), "top");
    await expect(workspaceCard(page, secondDir)).toHaveClass(/drop-before/);
    await page.mouse.up();
    await expect.poll(() => workspaceIds(page)).toEqual([projectId, secondId]);
    await page.reload();
    await expect.poll(() => workspaceIds(page)).toEqual([projectId, secondId]);
  });
});
