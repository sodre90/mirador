import { join } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { addWorkspaceFromSidebar, createProfile, openProfileTab, openProfiles, sendMessage, signIn } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

const host = new TestHost({ fakePrograms: true });

/** An opencode that offers a model, modes and efforts to choose from. */
const offering = "FAKE_ACP_MODES=1\nFAKE_ACP_MODELS=1";

const testResult = (editor: Locator) => editor.getByLabel("Profile test result");
const testButton = (editor: Locator) => editor.getByRole("button", { name: "Test", exact: true });

async function openWithWorkspace(page: Page) {
  await signIn(page, host);
  await addWorkspaceFromSidebar(page, host.projectDir);
}

test.beforeAll(async () => {
  writeBunProgram(host.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"));
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

test("a profile's test lists the models and settings its agent offers", async ({ page }) => {
  await openWithWorkspace(page);
  const editor = await createProfile(page, "offered", offering, "", "opencode");

  await testButton(editor).click();

  const result = testResult(editor);
  await expect(result).toContainText("The agent answered in");
  await expect(result).toContainText("Opus");
  await expect(result).toContainText("Haiku");
  await expect(result).toContainText("Plan");
  await expect(result.getByLabel("Default (recommended) (current)")).toBeVisible();
});

test("a profile's test says why the agent could not start", async ({ page }) => {
  await openWithWorkspace(page);
  const editor = await createProfile(page, "broken", offering, "echo gateway down >&2; exit 3", "opencode");

  await testButton(editor).click();

  await expect(testResult(editor)).toContainText("The pre-launch command of opencode (broken)");
  await expect(testResult(editor)).toContainText("gateway down");
});

test("a pre-launch command that fails while a test of the profile runs it too names the log their output is mixed in", async ({ page }) => {
  await openWithWorkspace(page);
  const created = await createProfile(page, "busy gateway", "", "sleep 8; echo gateway down >&2; exit 3", "opencode");
  await created.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "busy gateway · opencode" });
  await page.getByRole("button", { name: "+ New conversation" }).click();
  await sendMessage(page, "hello");
  const editor = await openProfiles(page);
  await editor.locator(".profile-list li", { hasText: "busy gateway" }).click();
  await testButton(editor).click();

  const mixed = /The pre-launch command of opencode \(busy gateway\) exited with 3; another start ran it at the same time, so their output is mixed in .+\.log/;
  await expect(testResult(editor)).toContainText(mixed, { timeout: 30_000 });
  await editor.getByRole("button", { name: "Close" }).click();
  await expect(page.locator(".timeline:visible .error-line")).toContainText(mixed);
});

test("a test uses the profile as the editor has it, before it is saved", async ({ page }) => {
  await openWithWorkspace(page);
  const dialog = await openProfiles(page);
  await dialog.locator(".profile-list li", { hasText: "+ New profile" }).click();
  await openProfileTab(dialog, "Launch");
  await dialog.getByLabel("Profile name").fill("draft");
  await dialog.getByLabel("Profile agent").selectOption({ label: "opencode" });
  await dialog.getByLabel("Environment", { exact: true }).fill(offering);

  await testButton(dialog).click();

  await expect(testResult(dialog)).toContainText("Haiku");
  await expect(dialog.locator(".profile-list li.selected"), "the tested profile stays unsaved").toHaveText("+ New profile");
});
