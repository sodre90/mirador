import { expect, test } from "@playwright/test";
import { addWorkspace, openProfiles, signIn, startConversation, workspaceCard } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost({ withoutProfiles: true });

test.beforeAll(async () => {
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

test("with no profile yet, Mirador offers the first one filled in; workspaces start on it, and the last profile stays", async ({ page }) => {
  await signIn(page, host);
  const setUp = page.locator(".first-profile");
  await expect(setUp.getByRole("heading", { name: "Set up a profile to start" })).toBeVisible();
  await expect(setUp.getByLabel("Profile name")).toHaveValue("Claude Code");
  await expect(setUp.getByLabel("Profile agent")).toHaveValue("claude");

  await addWorkspace(page, host.projectDir);
  const card = workspaceCard(page, host.projectDir);

  await test.step("a workspace offers to set a profile up, and + New leads there too", async () => {
    await expect(card.getByLabel("Agent")).toHaveCount(0);
    await expect(card.getByRole("button", { name: "Set up a profile" })).toBeVisible();
    await card.getByRole("button", { name: "+ New conversation" }).click();
    await expect(card.locator("li")).toHaveCount(0);
    await expect(setUp).toBeVisible();
  });

  await test.step("creating it gives the workspace its profile, and a conversation starts on it", async () => {
    await setUp.getByRole("button", { name: "Create profile" }).click();
    await expect(card.locator(".agent-chip-label")).toHaveText("Claude Code");
    await startConversation(page);
    await expect(page.getByLabel("Profile", { exact: true }).filter({ visible: true }).locator("option:checked")).toHaveText("Claude Code");
  });

  await test.step("the only profile cannot be deleted; with another, deleting it moves the workspace to that one", async () => {
    const dialog = await openProfiles(page);
    const firstProfile = dialog.locator(".profile-list li").filter({ hasText: /^Claude CodeClaude Code$/ });
    await expect(dialog.getByRole("button", { name: "Delete profile" })).toHaveCount(0);
    await expect(dialog).toContainText("This is your only profile");
    await dialog.locator(".profile-list li", { hasText: "+ New profile" }).click();
    await dialog.getByLabel("Profile name").fill("second");
    await dialog.getByRole("button", { name: "Create profile" }).click();
    await firstProfile.click();
    await dialog.getByRole("button", { name: "Delete profile" }).click();
    await dialog.getByRole("button", { name: "Confirm: Delete profile" }).click();
    await expect(firstProfile).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Delete profile" })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(card.locator(".agent-chip-label")).toHaveText("second · Claude Code");
  });
});
