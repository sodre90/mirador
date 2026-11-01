import { expect, test } from "@playwright/test";
import { addWorkspace, createProfile, lastAgentMessage, sendMessage, signIn, startConversation, waitForTurnToEnd } from "./helpers.ts";
import { ScriptedModel, scriptedOpencodeEnvironment } from "./scripted-model.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();
const model = new ScriptedModel();
const PROFILE = "scripted opencode";
const CONTINUE = "Continue where you left off.";

test.beforeAll(async () => {
  await model.start();
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
  model.stop();
});

test("an opencode turn its provider ended with an error is tried again, and opencode still has the message it failed on", async ({ page }) => {
  test.setTimeout(300_000);
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const dialog = await createProfile(page, PROFILE, scriptedOpencodeEnvironment(model, host.root), "", "opencode");
  await dialog.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${PROFILE} · opencode` });
  await startConversation(page);
  const failedTurn = page.locator(".timeline:visible .try-again-line");
  const tryAgain = failedTurn.getByRole("button", { name: "Try again" });

  await test.step("the provider's error ends the turn and offers Try again", async () => {
    model.failure = { status: 400, body: { error: { message: "Scripted bad request", type: "invalid_request_error" } } };
    await sendMessage(page, "first task");
    await expect(failedTurn).toContainText("Scripted bad request", { timeout: 120_000 });
    await expect(failedTurn, "where opencode tags the error as failing is for the host, not shown").not.toContainText("errorName");
    await waitForTurnToEnd(page);
    await expect(tryAgain).toBeVisible();
  });

  await test.step("Try again asks opencode to continue, with the failed message still in its context", async () => {
    model.failure = null;
    await tryAgain.click();
    await expect(page.locator(".timeline:visible .message.user")).toHaveText(["first task", CONTINUE], { timeout: 120_000 });
    await expect(lastAgentMessage(page)).toHaveText(`Echo: ${CONTINUE}`, { timeout: 120_000 });
    await waitForTurnToEnd(page);
    expect(model.userMessagesInContext()).toEqual(["first task", CONTINUE]);
    await expect(failedTurn).toHaveCount(0);
    await expect(page.locator(".timeline:visible .error-line")).toContainText("Scripted bad request");
  });
});
