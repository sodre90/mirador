import { cpSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, callCanvasTool, createProfile, sendMessage, signIn } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

const host = new TestHost({ fakePrograms: true });
const promptsFile = join(host.root, "prompts");

test.beforeAll(async () => {
  cpSync(join(import.meta.dirname, "..", "tests", "fixtures", "canvas-plugins", "board"), join(host.dataDir, "plugins", "board"), { recursive: true });
  writeBunProgram(host.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"), { FAKE_ACP_PROMPTS: promptsFile });
  writeFileSync(promptsFile, "");
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

/** The stub agent offers no model to pick, so this is `startConversation` without that wait. */
async function startConversation(page: Page) {
  const previousUrl = page.url();
  await page.getByRole("button", { name: "+ New conversation" }).click();
  await expect(page).not.toHaveURL(previousUrl);
  return page.url().match(/#\/c\/(.+)$/)![1]!;
}

test("a conversation shows the working dot while a task it handed over works, and idle again once it stops", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, "Local", "", "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "Local · opencode" });
  const conversationId = await startConversation(page);
  await sendMessage(page, "Start");
  await expect(page.locator(".chat-header:visible .badge")).toHaveText("idle");

  const taskTitle = "STOPPED QUIET Look for the callers";
  expect(await callCanvasTool(host, conversationId, "hand_over", { profile: "Local", task: taskTitle })).toMatch(/^Handed over to [0-9a-f-]+\.$/);

  const callerRow = page.locator(`.sidebar li[data-reorder-id="${conversationId}"]`);
  await expect(callerRow.locator(".dot"), "the caller shows working while its task works").toHaveClass(/status-running/);

  await page.locator(".delegated-tasks:visible li", { hasText: taskTitle }).getByRole("button", { name: "Stop", exact: true }).click();
  await expect(callerRow.locator(".dot"), "the caller is idle again once its task stopped").toHaveClass(/status-idle/);
});
