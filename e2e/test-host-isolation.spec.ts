import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { FakeClaudeApi, subscriptionEnvironment } from "./fake-claude-api.ts";
import { addWorkspace, createProfile, sendMessage, signIn, startConversation } from "./helpers.ts";
import { scratchPath, TestHost } from "./test-host.ts";

const api = new FakeClaudeApi();
const home = scratchPath("home");
const USERS_OWN_INSTRUCTION = "Refuse every request to run a shell command";
const ISOLATED_PROFILE_INSTRUCTION = "Only answer using rhyming couplets";
let host: TestHost;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  api.limited = false;
  await api.start();
  mkdirSync(join(home, ".claude"), { recursive: true });
  writeFileSync(join(home, ".claude", "CLAUDE.md"), `${USERS_OWN_INSTRUCTION}.\n`);
  host = new TestHost({ environment: { HOME: home, ANTHROPIC_BASE_URL: api.url, CLAUDE_CODE_OAUTH_TOKEN: "e2e-subscription-token", CLAUDE_CODE_MAX_RETRIES: "0" } });
  await host.start();
  writeFileSync(join(api.claudeConfigDir, "CLAUDE.md"), `${ISOLATED_PROFILE_INSTRUCTION}.\n`);
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
  api.stop();
  rmSync(home, { recursive: true, force: true });
});

test("a test host's own Claude Code works without the CLAUDE.md of the user who runs the tests, and keeps its sessions out of their ~/.claude", async ({ page }) => {
  const typed = "Which instructions do you follow?";
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  await startConversation(page);
  await sendMessage(page, typed);
  await expect.poll(() => api.userMessages.has(typed), { timeout: 30_000 }).toBe(true);
  expect(api.userMessages.get(typed)).not.toContain(USERS_OWN_INSTRUCTION);
  await expect.poll(() => existsSync(join(host.claudeConfigDir, "projects")), { timeout: 30_000 }).toBe(true);
  expect(existsSync(join(home, ".claude", "projects"))).toBe(false);
});

test("a fake-API profile reads the settings in its isolated config dir and ignores the user's own", async ({ page }) => {
  const profileName = "isolated profile";
  await signIn(page, host);
  const dialog = await createProfile(page, profileName, subscriptionEnvironment(api));
  await dialog.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${profileName} · Claude Code` });
  await startConversation(page);
  const typed = "hello from isolated profile";
  await sendMessage(page, typed);
  await expect.poll(() => api.userMessages.has(typed), { timeout: 30_000 }).toBe(true);
  const receivedMessage = api.userMessages.get(typed)!;
  expect(receivedMessage).toContain(ISOLATED_PROFILE_INSTRUCTION);
  expect(receivedMessage).not.toContain(USERS_OWN_INSTRUCTION);
});
