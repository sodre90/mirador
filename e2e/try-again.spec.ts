import { expect, test } from "@playwright/test";
import { FakeClaudeApi, subscriptionEnvironment } from "./fake-claude-api.ts";
import { addWorkspace, createProfile, lastAgentMessage, reloadFromRestartedHost, sendMessage, signIn, startConversation, waitForTurnToEnd } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();
const api = new FakeClaudeApi();
const PROFILE = "flaky gateway";
const CONTINUE = "Continue where you left off.";

test.beforeAll(async () => {
  await api.start();
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
  api.stop();
});

test("a turn an API error ended is tried again from the error, and the agent still has the message it failed on", async ({ page }) => {
  test.setTimeout(300_000);
  api.limited = false;
  api.failing = true;
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, PROFILE, subscriptionEnvironment(api));
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${PROFILE} · Claude Code` });
  await startConversation(page);
  const failedTurn = page.locator(".try-again-line");
  const tryAgain = failedTurn.getByRole("button", { name: "Try again" });

  await test.step("the error that ended the turn offers Try again", async () => {
    await sendMessage(page, "first task");
    await expect(failedTurn).toContainText("502", { timeout: 120_000 });
    await expect(failedTurn, "the kind Claude Code tags the error with is for the host, not shown").not.toContainText("errorKind");
    await waitForTurnToEnd(page);
    await expect(tryAgain).toBeVisible();
    await expect(tryAgain).toHaveAttribute("data-hint", /continue where it left off/);
  });

  await test.step("and still does after a host restart", async () => {
    await host.restart();
    await reloadFromRestartedHost(page);
    await expect(tryAgain).toBeVisible({ timeout: 60_000 });
  });

  await test.step("Try again asks the agent to continue, with the failed message still in its history", async () => {
    api.failing = false;
    await tryAgain.click();
    await expect(page.locator(".message.user")).toHaveText(["first task", CONTINUE], { timeout: 120_000 });
    const reply = lastAgentMessage(page);
    await expect(reply, "Claude Code sends the failed message and the continue line as one, which the fake API quotes").toContainText("first task", { timeout: 120_000 });
    await expect(reply).toContainText(CONTINUE);
    await waitForTurnToEnd(page);
    const continued = api.history.findLast((messages) => messages.some((message) => message.includes(CONTINUE)));
    expect(continued?.join("\n")).toMatch(/first task[\s\S]*Continue where you left off\./);
  });

  await test.step("the error it came from stays, without the button", async () => {
    await expect(failedTurn).toHaveCount(0);
    await expect(page.locator(".error-line")).toContainText("502");
  });
});
