import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { FakeClaudeApi, subscriptionEnvironment } from "./fake-claude-api.ts";
import { addWorkspace, createProfile, lastAgentMessage, sendMessage, signIn, startConversation, waitForTurnToEnd } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();
const api = new FakeClaudeApi();
const PROFILE = "background work";

test.beforeAll(async () => {
  api.limited = false;
  await api.start();
  await host.start();
  mkdirSync(join(host.projectDir, ".claude"), { recursive: true });
  writeFileSync(join(host.projectDir, ".claude", "settings.json"), JSON.stringify({ permissions: { allow: ["Bash"] } }));
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
  api.stop();
});

test("a message Claude Code folds into the turn it started on its own, after a background command ended, ends when that turn does", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, PROFILE, subscriptionEnvironment(api));
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${PROFILE} · Claude Code` });
  await startConversation(page);
  await sendMessage(page, "BACKGROUND sleep 1");
  await waitForTurnToEnd(page);
  await expect.poll(() => api.endedCommandsWaiting, { timeout: 30_000 }).toBe(1);

  await sendMessage(page, "Second task");
  await page.waitForTimeout(2_000);
  api.answerEndedCommands();

  await waitForTurnToEnd(page);
  await expect(lastAgentMessage(page)).toContainText("Second task");
  expect(api.answered, "Claude Code answered the message in a turn of its own instead of folding it in").not.toContain("Second task");
});
