import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { FakeClaudeApi, subscriptionEnvironment } from "./fake-claude-api.ts";
import { addWorkspace, createProfile, lastAgentMessage, sendMessage, signIn, startConversation, waitForTurnToEnd } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();
const api = new FakeClaudeApi();
const PROFILE = "advisor";

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

test("an advisor call Claude makes after another tool call in the same reply, which the API never runs, leaves the turn ending as usual", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, PROFILE, subscriptionEnvironment(api));
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${PROFILE} · Claude Code` });
  await startConversation(page);

  await sendMessage(page, "ADVISOR AFTER BASH echo ran-$((40+2))");

  await waitForTurnToEnd(page);
  const timeline = page.locator(".timeline:visible");
  await expect(timeline).toContainText("ran-42");
  await expect(lastAgentMessage(page)).toContainText("Answered:");
  await expect(timeline).toContainText("Claude stopped this tool call before it ran.");
  await expect(timeline).not.toContainText("without returning results");
});
