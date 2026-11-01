import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { FakeClaudeApi, subscriptionEnvironment } from "./fake-claude-api.ts";
import { addWorkspace, createProfile, lastAgentMessage, sendMessage, signIn, startConversation, waitForTurnToEnd } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();
const api = new FakeClaudeApi();
const PROFILE = "slowrecord";
const configDir = join(host.root, "claude-config");

test.beforeAll(async () => {
  api.limited = false;
  mkdirSync(join(configDir, "hooks"), { recursive: true });
  writeFileSync(join(configDir, "hooks", "slow-prompt.sh"), "#!/bin/sh\nsleep 1\n");
  chmodSync(join(configDir, "hooks", "slow-prompt.sh"), 0o755);
  writeFileSync(join(configDir, "settings.json"), JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: `${configDir}/hooks/slow-prompt.sh`, timeout: 30 }] }] } }));
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

// The profile's UserPromptSubmit hook keeps Claude Code a full second behind the host's send, so a Stop pressed right
// after the message reliably arrives while Claude Code hasn't recorded the prompt yet: the state edit-stopped-message
// hits by luck. The host must not let that cancel drop the message from the agent's history.
test("a Stop sent while the agent has not recorded the message yet still leaves it to the next message", async ({ page }) => {
  test.setTimeout(300_000);
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, PROFILE, `${subscriptionEnvironment(api)}\nCLAUDE_CONFIG_DIR=${configDir}`);
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${PROFILE} · Claude Code` });
  await startConversation(page);
  await sendMessage(page, "First task");
  await expect(lastAgentMessage(page)).toHaveText("Answered: First task", { timeout: 120_000 });
  await waitForTurnToEnd(page);

  api.hold();
  await sendMessage(page, "Paint it green");
  await expect(page.locator(".composer:visible .stop")).toBeVisible();
  await expect(userMessages(page).last()).toHaveText("Paint it green");
  await composer(page).press("Escape");
  await waitForTurnToEnd(page);

  await sendMessage(page, "Paint it yellow");
  await expect.poll(() => api.heldRequests.some((messages) => messages.join("\n").includes("Paint it yellow")), { timeout: 120_000 }).toBe(true);
  const yellowRequest = api.heldRequests.findLast((messages) => messages.join("\n").includes("Paint it yellow"))!.join("\n");
  api.answerHeld();
  await expect(lastAgentMessage(page)).toContainText("Paint it yellow", { timeout: 120_000 });
  await waitForTurnToEnd(page);
  await expect(userMessages(page)).toHaveText(["First task", "Paint it green", "Paint it yellow"]);
  expect(yellowRequest).toContain("Paint it green");
});
