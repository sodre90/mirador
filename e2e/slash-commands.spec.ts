import { expect, test } from "@playwright/test";
import { addWorkspace, signIn, startConversation, waitForTurnToEnd } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();

test.beforeAll(() => host.start());
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

test("typing / suggests the agent's commands: arrows pick, Tab writes one out, Enter runs one or writes out one that takes arguments, Esc puts them away", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  await startConversation(page);
  const composer = page.locator(".composer textarea");
  const menu = page.getByRole("listbox", { name: "Slash commands" });
  const names = menu.locator(".slash-command-name");
  const picked = menu.locator('[aria-selected="true"] .slash-command-name');

  await test.step("the commands whose name holds what is typed, those starting with it first", async () => {
    await composer.fill("/");
    await expect(menu).toBeVisible({ timeout: 60_000 });
    await composer.fill("/cont");
    await expect(names.first()).toHaveText(/^\/cont/);
    await expect(names.filter({ hasText: /^\/context$/ })).toHaveCount(1);
    await composer.fill("/c");
    const first = await names.first().textContent();
    await expect(picked).toHaveText(first!);
    await composer.press("ArrowDown");
    await expect(picked).toHaveText((await names.nth(1).textContent())!);
    await composer.press("ArrowUp");
    await expect(picked).toHaveText(first!);
  });

  await test.step("Tab writes the command out, and so do Enter and a click for one that takes arguments", async () => {
    await composer.fill("/compa");
    await expect(picked).toHaveText("/compact");
    await composer.press("Tab");
    await expect(composer).toHaveValue("/compact ");
    await expect(menu).toBeHidden();
    await composer.fill("/compa");
    await composer.press("Enter");
    await expect(composer).toHaveValue("/compact ");
    await composer.fill("/conte");
    await menu.getByRole("option").filter({ has: page.locator(".slash-command-name", { hasText: /^\/context$/ }) }).click();
    await expect(composer).toHaveValue("/context ");
    await expect(page.locator(".message.user")).toHaveCount(0);
  });

  await test.step("Esc puts the suggestions away until the name changes", async () => {
    await composer.fill("/ini");
    await expect(menu).toBeVisible();
    await composer.press("Escape");
    await expect(menu).toBeHidden();
    await expect(composer).toHaveValue("/ini");
    await composer.press("t");
    await expect(picked).toHaveText("/init");
  });

  await test.step("Enter runs a command that takes no arguments", async () => {
    await composer.fill("/contex");
    await expect(picked).toHaveText("/context");
    await composer.press("Enter");
    await expect(page.locator(".message.user").last()).toContainText("/context");
    await expect(composer).toHaveValue("");
    await waitForTurnToEnd(page);
  });
});
