import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { addWorkspace, createProfile, sendMessage, signIn, startConversation, waitForTurnToEnd, conversationSettings } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

const host = new TestHost({ fakePrograms: true });
test.describe.configure({ mode: "serial" });
const copilotHome = () => join(host.root, "copilot-home");
const header = (page: import("@playwright/test").Page) => page.locator(".chat-header:visible");
const statusline = (page: import("@playwright/test").Page) => page.locator(".statusline:visible");

test.beforeAll(async () => {
  mkdirSync(copilotHome(), { recursive: true });
  writeBunProgram(host.fakeProgramsDir, "copilot", join(import.meta.dirname, "fake-copilot.ts"));
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

test("Copilot's model multipliers show in the picker, and its credits grow in the status bar turn by turn", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const dialog = await createProfile(page, "priced Copilot", `COPILOT_HOME=${copilotHome()}\nCOPILOT_PATH=${join(host.fakeProgramsDir, "copilot")}`, "", "Copilot");
  await dialog.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "priced Copilot · Copilot" });
  await startConversation(page);

  const picker = async () => (await conversationSettings(page)).getByLabel("Model", { exact: true });
  await expect((await picker()).locator("option", { hasText: "Claude Opus 5.5" })).toHaveText("Claude Opus 5.5 · 15x");
  await expect((await picker()).locator("option", { hasText: "Claude Sonnet 5.5" })).toHaveText("Claude Sonnet 5.5 · 1x");
  await expect((await picker()).locator("option", { hasText: "Auto" })).toHaveText("Auto");

  await (await picker()).selectOption({ label: "Claude Opus 5.5 · 15x" });
  await expect(statusline(page).locator(".chip", { hasText: "Claude Opus 5.5" })).toHaveText("Claude Opus 5.5 · 15x");

  await sendMessage(page, "first");
  await waitForTurnToEnd(page);
  await expect(statusline(page).locator(".chip", { hasText: "credits" })).toHaveText("2.04 credits");
  await expect(statusline(page).locator('.chip[data-hint*="has cost"]')).toHaveCount(0);

  await sendMessage(page, "second");
  await waitForTurnToEnd(page);
  await expect(statusline(page).locator(".chip", { hasText: "credits" })).toHaveText("5.60 credits");
});

test("a free model's conversation shows 0.00 credits once Copilot has a checkpoint", async ({ page }) => {
  await signIn(page, host);
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "priced Copilot · Copilot" });
  await startConversation(page);
  await (await conversationSettings(page)).getByLabel("Model", { exact: true }).selectOption({ label: "Free Model · 0x" });
  await sendMessage(page, "free");
  await waitForTurnToEnd(page);
  await expect(statusline(page).locator(".chip", { hasText: "credits" })).toHaveText("0.00 credits");
});

test("a session whose events file already holds earlier turns' credits shows this turn's total, not the earlier one", async ({ page }) => {
  await signIn(page, host);
  const environment = `COPILOT_HOME=${copilotHome()}\nCOPILOT_PATH=${join(host.fakeProgramsDir, "copilot")}\nFAKE_COPILOT_EARLIER_NANO_AIU=1000000000`;
  const dialog = await createProfile(page, "carried-over Copilot", environment, "", "Copilot");
  await dialog.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "carried-over Copilot · Copilot" });
  await startConversation(page);
  await sendMessage(page, "first");
  await waitForTurnToEnd(page);
  await expect(statusline(page).locator(".chip", { hasText: "credits" })).toHaveText("2.04 credits");
});
