import { expect, test, type Page } from "@playwright/test";
import { KEEP_WARM_PROMPT } from "../host/prompt-cache-keep-alive.ts";
import { FakeClaudeApi, subscriptionEnvironment } from "./fake-claude-api.ts";
import { addWorkspace, createProfile, openProfiles, openProfileTab, sendMessage, signIn, startConversation, waitForTurnToEnd } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const KEEP_WARM_EVERY_MS = 3_000;
const KEEP_WARM_FOR_MS = 30_000;
const host = new TestHost({ environment: { MIRADOR_KEEP_WARM_EVERY_MS: String(KEEP_WARM_EVERY_MS), MIRADOR_KEEP_WARM_FOR_MS: String(KEEP_WARM_FOR_MS) } });
const api = new FakeClaudeApi();

test.beforeAll(async () => {
  api.limited = false;
  api.cacheWritten = "ephemeral_5m_input_tokens";
  api.cacheRead = 100_000;
  await api.start();
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
  api.stop();
});

const keepAlivesSent = () => api.answered.filter((typed) => typed === KEEP_WARM_PROMPT).length;
const row = (page: Page, conversationId: string) => page.locator(`.workspace li[data-reorder-id="${conversationId}"]`);

async function chooseProfile(page: Page, profile: string) {
  await page.getByRole("navigation").getByLabel("Agent", { exact: true }).selectOption({ label: `${profile} · Claude Code` });
}

test("a Claude Code profile can keep the prompt cache warm while the user is away, unseen in the conversation, and compact it after a while", async ({ page }) => {
  test.setTimeout(300_000);
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);

  await test.step("a profile left as it was keeps Claude Code on its one-hour cache and sends no keep-alive", async () => {
    const profiles = await createProfile(page, "usual", subscriptionEnvironment(api));
    await openProfileTab(profiles, "Defaults");
    await expect(profiles.getByLabel("Profile keeps the prompt cache warm")).not.toBeChecked();
    await profiles.getByRole("button", { name: "Close" }).click();
    await chooseProfile(page, "usual");
    await startConversation(page);
    await sendMessage(page, "hello usual");
    await waitForTurnToEnd(page);
    await page.waitForTimeout(3 * KEEP_WARM_EVERY_MS);
    expect(keepAlivesSent()).toBe(0);
    expect(api.oneHourCacheAsked).toContain("hello usual");
  });

  await test.step("the profile keeps the setting", async () => {
    const profiles = await createProfile(page, "warm", `${subscriptionEnvironment(api)}\nCLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS=100000`);
    await openProfileTab(profiles, "Defaults");
    await profiles.getByLabel("Profile keeps the prompt cache warm").check();
    await profiles.getByRole("button", { name: "Save" }).click();
    await expect(profiles.locator(".saved")).toHaveText("Saved");
    await profiles.getByRole("button", { name: "Close" }).click();
    const reopened = await openProfiles(page);
    await reopened.locator(".profile-list li", { hasText: "warm" }).click();
    await openProfileTab(reopened, "Defaults");
    await expect(reopened.getByLabel("Profile keeps the prompt cache warm")).toBeChecked();
    await reopened.getByRole("button", { name: "Close" }).click();
  });

  await chooseProfile(page, "warm");
  const warm = await startConversation(page);

  await test.step("while the user is away, keep-alives on the five-minute cache leave the finished turn unseen and show nothing", async () => {
    api.hold();
    await sendMessage(page, "hello warm");
    await startConversation(page);
    api.answerHeld();
    await expect(row(page, warm).locator(".waiting-pill")).toHaveText("Done");
    await expect.poll(keepAlivesSent, { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
    await expect(row(page, warm).locator(".waiting-pill")).toHaveText("Done");
    expect(api.oneHourCacheAsked).not.toContain("hello warm");
    expect(api.oneHourCacheAsked).not.toContain(KEEP_WARM_PROMPT);

    await row(page, warm).click();
    await expect(page.locator(".timeline:visible .message.user")).toHaveText(["hello warm"]);
    await expect(page.locator(".timeline:visible .message.agent")).toHaveCount(1);
    await expect(page.locator(".timeline:visible")).not.toContainText(KEEP_WARM_PROMPT);
  });

  await test.step("the status line tells when the cache was last kept warm", async () => {
    const keptWarm = page.locator(".statusline:visible .chip.kept-warm");
    await expect(keptWarm).toHaveText(/^kept warm \dm ago$/);
    await expect(keptWarm).toHaveAttribute("data-hint", /Mirador kept the prompt cache warm while you were away, with \d+ short messages the conversation doesn't show/);
  });

  await test.step("a message sent while a keep-alive is being answered waits for it, then goes", async () => {
    api.hold();
    await expect.poll(() => api.held, { timeout: 30_000 }).toContain(KEEP_WARM_PROMPT);
    await sendMessage(page, "back again");
    await expect(page.locator(".queue:visible .queued-text")).toHaveText(["back again"]);
    api.answerHeld();
    await waitForTurnToEnd(page);
    await expect(page.locator(".timeline:visible .message.user")).toHaveText(["hello warm", "back again"]);
    await expect(page.locator(".timeline:visible .message.agent")).toHaveCount(2);
  });

  await test.step("after keeping the cache warm for as long as it may, Mirador compacts the long conversation, and sends no keep-alive after", async () => {
    await expect(page.locator(".timeline:visible")).toContainText("Compact conversation", { timeout: KEEP_WARM_FOR_MS + 60_000 });
    const sentByThen = keepAlivesSent();
    await page.waitForTimeout(3 * KEEP_WARM_EVERY_MS);
    expect(keepAlivesSent()).toBe(sentByThen);
    await expect(page.locator(".timeline:visible .message.user")).toHaveText(["hello warm", "back again"]);
  });
});
