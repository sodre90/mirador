import { expect, test, type Page } from "@playwright/test";
import { FakeClaudeApi, subscriptionEnvironment } from "./fake-claude-api.ts";
import { addWorkspace, conversationSettings, createProfile, signIn, startConversation, openProfileTab } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();
const api = new FakeClaudeApi();

test.beforeAll(async () => {
  api.limited = false;
  await api.start();
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
  api.stop();
});

async function modeOfNewConversationOn(page: Page, profile: string) {
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${profile} · Claude Code` });
  await startConversation(page);
  return (await conversationSettings(page)).getByLabel("Mode", { exact: true });
}

test("Claude Code starts conversations in Auto, and a profile set to Manual starts them in Manual", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, "own", subscriptionEnvironment(api));
  await openProfileTab(profiles, "Defaults");
  await expect(profiles.getByLabel("Profile mode", { exact: true }).locator("option")).toContainText(["Agent's default", "Manual", "Auto"], { timeout: 60_000 });
  await profiles.getByRole("button", { name: "Close" }).click();
  await expect(await modeOfNewConversationOn(page, "own")).toHaveValue("auto");

  const manual = await createProfile(page, "manual", subscriptionEnvironment(api));
  await openProfileTab(manual, "Defaults");
  await expect(manual.getByLabel("Profile mode", { exact: true }).locator("option")).toContainText(["Manual"], { timeout: 60_000 });
  await manual.getByLabel("Profile mode", { exact: true }).selectOption("default");
  await manual.getByRole("button", { name: "Save" }).click();
  await expect(manual.locator(".saved")).toHaveText("Saved");
  await manual.getByRole("button", { name: "Close" }).click();
  await expect(await modeOfNewConversationOn(page, "manual")).toHaveValue("default");
});
