import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Locator } from "@playwright/test";
import { addWorkspace, openProfiles, openSettings, signIn, startConversation, workspaceCard } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();

test.beforeAll(() => host.start());
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

test("a profile's colour marks it wherever it is named, and a workspace added once there are two profiles asks which one", async ({ page }) => {
  await signIn(page, host);
  const card = workspaceCard(page, host.projectDir);
  const dotIn = (scope: Locator) => scope.locator(".profile-dot");
  const folder = page.getByLabel("Workspace directory");
  const profileChoices = page.getByRole("listbox", { name: "Profile of the new workspace" });

  await test.step("with one profile, adding a workspace takes it without asking, and a profile has no colour until one is picked", async () => {
    await page.getByRole("button", { name: "+ Add a project directory" }).click();
    await folder.fill(host.projectDir);
    await folder.press("Enter");
    await expect(card).toBeVisible();
    await expect(profileChoices).toHaveCount(0);
    await expect(dotIn(card)).toHaveCount(0);
  });

  await test.step("the colour picked in the Profiles dialog goes on the profile there and on the workspace's chip", async () => {
    const dialog = await openProfiles(page);
    await expect(dialog.getByRole("radio", { name: "No colour" })).toBeChecked();
    await expect(dialog.getByRole("radio", { name: "No colour" })).not.toBeFocused();
    await dialog.getByRole("radio", { name: "Rose" }).click();
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog.locator(".saved")).toHaveText("Saved");
    await expect(dialog.locator(".profile-list li.selected .profile-dot")).toHaveAttribute("data-color", "rose");

    await dialog.locator(".profile-list li", { hasText: "+ New profile" }).click();
    await dialog.getByLabel("Profile name").fill("Work");
    await dialog.getByRole("radio", { name: "Mint" }).click();
    await dialog.getByRole("button", { name: "Create profile" }).click();
    await expect(dialog.locator(".profile-list li.selected")).toHaveText("WorkClaude Code");
    await expect(dialog.locator(".profile-list li.selected .profile-dot")).toHaveAttribute("data-color", "mint");
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(card.locator(".agent-chip .profile-dot")).toHaveAttribute("data-color", "rose");
  });

  await test.step("a conversation shows its profile's colour in the header, the statusline and on its row's edge, in the waiting list too", async () => {
    const conversationId = await startConversation(page);
    const row = card.locator(`li[data-reorder-id="${conversationId}"]`);
    const header = page.locator("label.config", { has: page.getByLabel("Profile", { exact: true }) });
    const statuslineProfile = page.locator(".statusline-chips .chip", { hasText: "Claude Code" });
    await expect(header.locator(".profile-dot")).toHaveAttribute("data-color", "rose");
    await expect(statuslineProfile.locator(".profile-dot")).toHaveAttribute("data-color", "rose");
    await expect(row.locator(".profile-edge")).toHaveAttribute("data-color", "rose");

    await page.getByLabel("Profile", { exact: true }).selectOption({ label: "Work" });
    await expect(row.locator(".profile-edge")).toHaveAttribute("data-color", "mint");
    await expect(header.locator(".profile-dot")).toHaveAttribute("data-color", "mint");

    await (await openSettings(page)).getByRole("radiogroup", { name: "Waiting for you" }).getByRole("radio", { name: "Pills and a list on top" }).click();
    await page.keyboard.press("Escape");
    await row.click({ button: "right" });
    await page.getByRole("menu").getByRole("menuitem", { name: "Mark as unread" }).click();
    await expect(page.getByRole("region", { name: "Waiting for you" }).locator("li .profile-edge")).toHaveAttribute("data-color", "mint");
  });

  await test.step("with two profiles, adding a workspace asks for one with none picked, so pressing Enter again adds nothing", async () => {
    const second = join(host.root, "second-project");
    mkdirSync(second, { recursive: true });
    await page.getByRole("button", { name: "Add workspace" }).click();
    await folder.fill(second);
    await folder.press("Enter");
    const options = profileChoices.getByRole("option");
    await expect(options).toHaveText(["Claude Code", "Work · Claude Code"]);
    await expect(profileChoices.getByRole("option", { selected: true })).toHaveCount(0);
    await folder.press("Enter");
    await expect(profileChoices).toBeVisible();
    await expect(workspaceCard(page, second)).toHaveCount(0);

    await folder.press("Escape");
    await expect(profileChoices).toHaveCount(0);
    await expect(folder).toHaveValue(second);
    await folder.press("Enter");
    await folder.press("ArrowDown");
    await folder.press("ArrowDown");
    await expect(profileChoices.getByRole("option", { selected: true })).toHaveText("Work · Claude Code");
    await folder.press("Enter");

    const added = workspaceCard(page, second);
    await expect(added.locator(".agent-chip-label")).toHaveText("Work · Claude Code");
    await expect(added.locator(".agent-chip .profile-dot")).toHaveAttribute("data-color", "mint");
    await page.reload();
    await expect(added.locator(".agent-chip .profile-dot")).toHaveAttribute("data-color", "mint");
  });

  await test.step("typing in the folder goes back to it, and No colour takes the colour away", async () => {
    const third = join(host.root, "third-project");
    mkdirSync(third, { recursive: true });
    await page.getByRole("button", { name: "Add workspace" }).click();
    await folder.fill(`${third}x`);
    await folder.press("Enter");
    await expect(profileChoices).toBeVisible();
    await folder.press("Backspace");
    await expect(profileChoices).toHaveCount(0);
    await folder.press("Escape");

    const dialog = await openProfiles(page);
    await dialog.locator(".profile-list li", { hasText: "Work" }).click();
    await dialog.getByRole("radio", { name: "No colour" }).click();
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog.locator(".saved")).toHaveText("Saved");
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dotIn(workspaceCard(page, join(host.root, "second-project")))).toHaveCount(0);
  });
});
