import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { FakeClaudeApi, subscriptionEnvironment } from "./fake-claude-api.ts";
import { addWorkspace, createProfile, sendMessage, signIn, startConversation } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();
const api = new FakeClaudeApi();
const claudeConfigDir = join(host.root, "claude-config");
const SUBAGENT_MODEL = "claude-haiku-4-5";

test.beforeAll(async () => {
  api.limited = false;
  await api.start();
  mkdirSync(claudeConfigDir, { recursive: true });
  writeFileSync(join(claudeConfigDir, "settings.json"), JSON.stringify({ env: { CLAUDE_CODE_SUBAGENT_MODEL: SUBAGENT_MODEL } }));
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
  api.stop();
});

test("subagents run on the model the user's Claude Code settings choose for them", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const dialog = await createProfile(page, "settings only", `${subscriptionEnvironment(api)}\nCLAUDE_CONFIG_DIR=${claudeConfigDir}`);
  await dialog.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "settings only · Claude Code" });
  await startConversation(page);

  await sendMessage(page, "SUBAGENT read the notes");

  await expect(page.locator(".timeline .tool.subagent")).toHaveCount(1, { timeout: 60_000 });
  await expect.poll(() => api.models.get("read the notes"), { timeout: 60_000 }).toBe(SUBAGENT_MODEL);
  const conversationModel = api.models.get("SUBAGENT read the notes");
  expect(conversationModel).toBeDefined();
  expect(conversationModel, "the conversation itself stays on its own model").not.toBe(SUBAGENT_MODEL);
});
