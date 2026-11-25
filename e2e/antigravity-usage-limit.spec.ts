import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, createProfile, lastAgentMessage, reloadFromRestartedHost, sendMessage, signIn, startConversation, waitForTurnToEnd } from "./helpers.ts";
import { ScriptedModel, antigravityProgram, scriptedAntigravityEnvironment } from "./scripted-model.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();
const model = new ScriptedModel();
const PROFILE = "Antigravity at its quota";
const CONTINUE = "Continue where you left off.";
const RESET_MARGIN_MS = 60_000;

/** What Google's server answers an Antigravity plan at its quota, which agy says as a chunk of the agent's message before it ends the turn normally. */
const quotaReached = (resetsIn: string) => `Individual quota reached. Please upgrade your subscription to increase your limits. Resets in ${resetsIn}.`;
const quotaError = (resetsIn: string) => ({ status: 429, body: { error: { code: 429, message: quotaReached(resetsIn), status: "RESOURCE_EXHAUSTED" } } });

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

const notice = (page: Page) => page.getByRole("region", { name: "Usage limit" }).filter({ visible: true });
const queued = (page: Page) => page.locator(".queue:visible .queued-text");
const userMessages = (page: Page) => page.locator(".timeline:visible .message.user");
const limitLine = (page: Page) => page.locator(".timeline:visible .usage-limit-line");

async function startAntigravityConversation(page: Page) {
  await page.getByRole("navigation").getByLabel("Agent", { exact: true }).selectOption({ label: `${PROFILE} · Antigravity` });
  return startConversation(page);
}

test("at Antigravity's quota, the conversation shows as failed rather than done, and its queued messages wait for the reset, also across a host restart", async ({ page }) => {
  test.setTimeout(300_000);
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const dialog = await createProfile(page, PROFILE, scriptedAntigravityEnvironment(model, host.root), "", "Antigravity");
  await dialog.getByRole("button", { name: "Close" }).click();
  const limited = await startAntigravityConversation(page);
  const row = page.locator(`.workspace li[data-reorder-id="${limited}"]`);

  await test.step("a turn the quota stops while another conversation is open is marked Failed", async () => {
    model.hold();
    model.failure = quotaError("4h15m13s");
    await sendMessage(page, "first task");
    await startAntigravityConversation(page);
    model.answerHeld();
    await expect(row.locator(".waiting-pill")).toHaveText("Failed", { timeout: 60_000 });
    await expect(row.locator(".dot")).toHaveClass(/dot waiting tone-failed/);
  });

  await test.step("it shows agy's words once, as a usage limit, and when the agent continues", async () => {
    await row.click();
    await expect(limitLine(page)).toHaveText(`⚠ ${quotaReached("4h15m13s")}`);
    await expect(page.locator(".timeline:visible .error-line")).toHaveCount(0);
    await expect(page.locator(".timeline:visible .message.agent", { hasText: "Individual quota reached" })).toHaveCount(0);
    await expect(notice(page)).toContainText("Usage limit reached · the agent continues by itself at");
  });

  await test.step("messages sent meanwhile wait in the queue, and still do after a host restart", async () => {
    await sendMessage(page, "second task");
    await sendMessage(page, "third task");
    await expect(queued(page)).toHaveText(["second task", "third task"]);
    await host.restart();
    await reloadFromRestartedHost(page);
    await expect(notice(page)).toContainText("the agent continues by itself at", { timeout: 60_000 });
    await expect(queued(page)).toHaveText(["second task", "third task"]);
    expect(model.textsSent().filter((text) => /second task|third task/.test(text))).toEqual([]);
  });

  await test.step("Continue now asks the agent to continue where it left off, and the queued messages follow", async () => {
    model.failure = null;
    await notice(page).getByRole("button", { name: "Continue now" }).click();
    await expect(notice(page)).toHaveCount(0);
    await expect(userMessages(page)).toHaveText(["first task", CONTINUE, "second task", "third task"], { timeout: 120_000 });
    await expect(queued(page)).toHaveCount(0);
    await expect(lastAgentMessage(page)).toContainText("Echo: third task", { timeout: 120_000 });
    await waitForTurnToEnd(page);
  });
});

test("the agent continues by itself a minute after Antigravity's quota resets", async ({ page }) => {
  test.setTimeout(RESET_MARGIN_MS + 180_000);
  await signIn(page, host);
  await startAntigravityConversation(page);

  model.failure = { ...quotaError("2s"), times: 1 };
  await sendMessage(page, "task across the reset");
  await expect(limitLine(page)).toContainText("Resets in 2s", { timeout: 60_000 });
  await waitForTurnToEnd(page);
  await expect(userMessages(page)).toHaveText(["task across the reset"]);

  await expect(userMessages(page)).toHaveText(["task across the reset", CONTINUE], { timeout: RESET_MARGIN_MS + 30_000 });
  await expect(lastAgentMessage(page)).toContainText(`Echo: ${CONTINUE}`, { timeout: 60_000 });
  await waitForTurnToEnd(page);
  await expect(notice(page)).toHaveCount(0);
});
