import { expect, test, type Page } from "@playwright/test";
import { FakeClaudeApi, subscriptionEnvironment } from "./fake-claude-api.ts";
import { addWorkspace, createProfile, lastAgentMessage, sendMessage, signIn, startConversation, waitForTurnToEnd } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();
const api = new FakeClaudeApi();
const PROFILE = "steered";
const STEERED = "Also say which day it is";

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

const composer = (page: Page) => page.locator(".composer:visible textarea");
const userMessages = (page: Page) => page.locator(".timeline:visible .message.user");

test("a message that joined the turn goes out again after Stop if the agent had not answered it yet", async ({ page }) => {
  test.setTimeout(300_000);
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, PROFILE, subscriptionEnvironment(api));
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${PROFILE} · Claude Code` });
  await startConversation(page);

  api.hold();
  await sendMessage(page, "First task");
  await expect(page.locator(".composer:visible .stop")).toBeVisible();
  await expect.poll(() => api.held.includes("First task"), { timeout: 60_000 }).toBe(true);
  await composer(page).fill(STEERED);
  await composer(page).press("Enter");
  await expect(userMessages(page)).toHaveText(["First task", STEERED]);
  await composer(page).press("Escape");
  await expect(page.locator(".timeline:visible").getByText("Turn ended: cancelled")).toBeVisible();

  api.answerHeld();
  await expect(lastAgentMessage(page)).toContainText(STEERED, { timeout: 120_000 });
  await waitForTurnToEnd(page);
  await expect(userMessages(page)).toHaveText(["First task", STEERED]);
  await expect(page.locator(".timeline:visible .message.agent").filter({ hasText: STEERED })).toHaveCount(1);
});
