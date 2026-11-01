import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, signIn, startConversation } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();

test.beforeAll(() => host.start());
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const ROUNDS = 4;

/**
 * A split remounts the terminal beside it. Its old screen used to be fitted after React took it out of the page and
 * before its effect was cleaned up, which happens only when a frame falls in between; a slow CPU makes that every time.
 */
const slowTheCpu = async (page: Page) => (await page.context().newCDPSession(page)).send("Emulation.setCPUThrottlingRate", { rate: 6 });

test("splitting, closing and hiding terminals while other tabs are open throws no error in the page", async ({ page }) => {
  test.setTimeout(120_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  await startConversation(page);
  await slowTheCpu(page);
  const splits = page.locator(".terminal-pane .terminal-splits.shown .terminal-split");

  for (let round = 0; round < ROUNDS; round++) {
    await page.locator(".chat-header:visible").getByRole("button", { name: "Show terminal" }).click();
    await expect(splits).toHaveCount(1);
    await page.getByRole("button", { name: "Split right" }).click();
    await expect(splits).toHaveCount(2);
    await page.getByRole("button", { name: "Close terminal 2", exact: true }).click();
    await page.getByRole("button", { name: "Confirm: Close terminal 2", exact: true }).click();
    await expect(splits).toHaveCount(1);
    await page.getByRole("button", { name: "New terminal tab" }).click();
    await expect(page.getByRole("tab")).toHaveCount(round + 2);
    await page.getByRole("tab").first().click();
    await page.locator(".chat-header:visible").getByRole("button", { name: "Hide terminal" }).click();
    await expect(page.locator(".terminal-pane")).toHaveCount(0);
  }
  expect(pageErrors).toEqual([]);
});
