import { expect, test, type Page } from "@playwright/test";
import { FakeClaudeApi, subscriptionEnvironment } from "./fake-claude-api.ts";
import { addWorkspace, createProfile, lastAgentMessage, reloadFromRestartedHost, sendMessage, signIn, startConversation, waitForTurnToEnd } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();
const api = new FakeClaudeApi();
const PROFILE = "usage limited";
const CONTINUE = "Continue where you left off.";
const AUTO_COMPACT_WINDOW = 100_000;
/** Claude Code names the window it hit, such as "session limit" or "5-hour limit". */
const LIMIT_REACHED = /You've hit your .+ limit · resets/;

test.beforeAll(async () => {
  await api.start();
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
  api.stop();
});

const notice = (page: Page) => page.getByRole("region", { name: "Usage limit" });
const queued = (page: Page) => page.locator(".queue .queued-text");
const userMessages = (page: Page) => page.locator(".message.user");

test("at Claude's usage limit, queued messages wait for the reset instead of failing one after another, also across a host restart", async ({ page }) => {
  test.setTimeout(300_000);
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, PROFILE, `${subscriptionEnvironment(api)}\nCLAUDE_CODE_AUTO_COMPACT_WINDOW=${AUTO_COMPACT_WINDOW}`);
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${PROFILE} · Claude Code` });
  await startConversation(page);

  await test.step("the turn the limit stops shows Claude Code's words, and when the agent continues", async () => {
    await sendMessage(page, "first task");
    await expect(page.locator(".usage-limit-line")).toContainText(LIMIT_REACHED, { timeout: 120_000 });
    await expect(page.locator(".error-line")).toHaveCount(0);
    await expect(notice(page)).toContainText("the agent continues by itself at");
    await waitForTurnToEnd(page);
  });

  await test.step("messages sent meanwhile wait in the queue, and still do after a host restart", async () => {
    await sendMessage(page, "second task");
    await sendMessage(page, "third task");
    await expect(queued(page)).toHaveText(["second task", "third task"]);
    await host.restart();
    await reloadFromRestartedHost(page);
    await expect(notice(page)).toContainText("the agent continues by itself at", { timeout: 60_000 });
    await expect(queued(page)).toHaveText(["second task", "third task"]);
    expect(api.refused).toContain("first task");
    expect(api.refused.concat(api.answered).filter((text) => /second task|third task/.test(text))).toEqual([]);
  });

  await test.step("Continue now asks the agent to continue where it left off, and the queued messages follow", async () => {
    api.limited = false;
    await notice(page).getByRole("button", { name: "Continue now" }).click();
    await expect(notice(page)).toHaveCount(0);
    await expect(userMessages(page)).toHaveText(["first task", CONTINUE, "second task", "third task"], { timeout: 120_000 });
    await expect(queued(page)).toHaveCount(0);
    await expect(lastAgentMessage(page)).toHaveText("Answered: third task", { timeout: 120_000 });
    await waitForTurnToEnd(page);
  });

  await test.step("Stop waiting: the agent does not continue by itself, and a message queued meanwhile goes out with the one the limit stopped", async () => {
    api.limited = true;
    await sendMessage(page, "fourth task");
    await expect(notice(page)).toBeVisible({ timeout: 120_000 });
    await waitForTurnToEnd(page);
    await sendMessage(page, "fifth task");
    await expect(queued(page)).toHaveText(["fifth task"]);
    api.limited = false;
    await notice(page).getByRole("button", { name: "Stop waiting" }).click();
    await expect(page.locator(".notice-line", { hasText: "Stopped waiting for the usage limit to reset" })).toBeVisible();
    await expect(lastAgentMessage(page)).toHaveText(/^Answered: fourth task\s+fifth task$/, { timeout: 120_000 });
    await expect(userMessages(page).last()).toHaveText("fifth task");
    expect(api.answered.filter((text) => text.endsWith(CONTINUE))).toHaveLength(1);
  });
});

test("a reset further off than a timer can wait leaves continuing to you, rather than continuing at once", async ({ page }) => {
  test.setTimeout(300_000);
  api.limited = true;
  api.resetsAt = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
  await signIn(page, host);
  await page.getByRole("navigation").getByLabel("Agent", { exact: true }).selectOption({ label: `${PROFILE} · Claude Code` });
  await startConversation(page);

  await sendMessage(page, "far-off reset");
  await expect(page.locator(".timeline:visible .usage-limit-line")).toContainText(LIMIT_REACHED, { timeout: 120_000 });
  await waitForTurnToEnd(page);
  await expect(notice(page).filter({ visible: true })).toContainText("it resets at");
  await page.waitForTimeout(3_000);
  await expect(page.locator(".timeline:visible .message.user")).toHaveText(["far-off reset"]);
});

test("a limit the same turn's context compaction ran into waits for the reset too, though the compaction loses its rate_limit tag", async ({ page }) => {
  test.setTimeout(300_000);
  api.limited = false;
  api.resetsAt = Math.floor(Date.now() / 1000) + 3 * 60 * 60;
  api.contextTokens = AUTO_COMPACT_WINDOW - 1_000;
  await signIn(page, host);
  await page.getByRole("navigation").getByLabel("Agent", { exact: true }).selectOption({ label: `${PROFILE} · Claude Code` });
  await startConversation(page);

  await test.step("a turn whose answer reports the context past the auto-compact threshold ends normally", async () => {
    await sendMessage(page, "fill the context");
    await expect(lastAgentMessage(page)).toHaveText("Answered: fill the context", { timeout: 120_000 });
    await waitForTurnToEnd(page);
  });

  await test.step("the next turn compacts the context first, and the limit after it shows as a usage limit, not an error", async () => {
    api.refuseAfterCompaction = "task after the compaction";
    await sendMessage(page, "task after the compaction");
    await expect(page.locator(".timeline:visible")).toContainText("Compact conversation", { timeout: 180_000 });
    await expect(page.locator(".timeline:visible .usage-limit-line")).toContainText(LIMIT_REACHED, { timeout: 180_000 });
    await expect(page.locator(".timeline:visible .error-line")).toHaveCount(0);
    await expect(notice(page).filter({ visible: true })).toContainText("the agent continues by itself at");
    await waitForTurnToEnd(page);
  });
});
