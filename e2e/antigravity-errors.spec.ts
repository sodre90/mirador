import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, createProfile, lastAgentMessage, sendMessage, signIn, startConversation, waitForTurnToEnd } from "./helpers.ts";
import { ScriptedModel, antigravityProgram, scriptedAntigravityEnvironment } from "./scripted-model.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();
const model = new ScriptedModel();
const PROFILE = "Antigravity model errors";
const CONTINUE = "Continue where you left off.";

test.describe.configure({ mode: "serial" });
test.skip(antigravityProgram() === null, "Antigravity e2e runs only where the Antigravity CLI, agy, is installed");
test.beforeAll(async () => {
  await model.start();
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
  model.stop();
});

const failedTurn = (page: Page) => page.locator(".timeline:visible .try-again-line");
const signInLine = (page: Page) => page.locator(".timeline:visible .sign-in-line");
const userMessages = (page: Page) => page.locator(".timeline:visible .message.user");

async function startAntigravityConversation(page: Page) {
  await page.getByRole("navigation").getByLabel("Agent", { exact: true }).selectOption({ label: `${PROFILE} · Antigravity` });
  return startConversation(page);
}

test("an Antigravity turn ended by a 400 model error shows as Failed and offers Try again", async ({ page }) => {
  test.setTimeout(300_000);
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const dialog = await createProfile(page, PROFILE, scriptedAntigravityEnvironment(model, host.root), "", "Antigravity");
  await dialog.getByRole("button", { name: "Close" }).click();
  const failed = await startAntigravityConversation(page);
  const row = page.locator(`.workspace li[data-reorder-id="${failed}"]`);

  model.hold();
  model.failure = { status: 400, body: { error: { message: "Something is wrong with the request" } }, times: 1 };
  await sendMessage(page, "first task");
  await startAntigravityConversation(page);
  model.answerHeld();

  await expect(row.locator(".waiting-pill")).toHaveText("Failed", { timeout: 60_000 });
  await expect(row.locator(".dot")).toHaveClass(/dot waiting tone-failed/);

  await row.click();
  await expect(failedTurn(page)).toContainText("⚠ Something is wrong with the request");
  await expect(page.locator(".timeline:visible .message.agent", { hasText: "Something is wrong with the request" })).toHaveCount(0);
  const tryAgain = failedTurn(page).getByRole("button", { name: "Try again" });
  await expect(tryAgain).toBeVisible();

  await tryAgain.click();
  await expect(userMessages(page)).toHaveText(["first task", CONTINUE], { timeout: 60_000 });
  await expect(lastAgentMessage(page)).toContainText(`Echo: ${CONTINUE}`, { timeout: 60_000 });
  await waitForTurnToEnd(page);
  await expect(failedTurn(page)).toHaveCount(0);
});

test("an Antigravity turn ended by a 401 model error asks the user to Log in", async ({ page }) => {
  test.setTimeout(300_000);
  await signIn(page, host);
  await startAntigravityConversation(page);

  model.failure = { status: 401, body: { error: { message: "Incorrect API key provided.", code: "invalid_api_key" } }, times: 1 };
  await sendMessage(page, "needs login");
  await expect(signInLine(page)).toContainText("code 401", { timeout: 60_000 });
  await expect(signInLine(page).getByRole("button", { name: "Log in" })).toBeVisible();
  await expect(failedTurn(page)).toHaveCount(0);
  await expect(page.locator(".timeline:visible .message.agent", { hasText: "code 401" })).toHaveCount(0);
  await waitForTurnToEnd(page);
});
