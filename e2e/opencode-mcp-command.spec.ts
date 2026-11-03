import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { addWorkspace, createProfile, signIn, startConversation } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

const host = new TestHost({ fakePrograms: true });
const promptsFile = join(host.root, "prompts");

test.beforeAll(async () => {
  writeBunProgram(host.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"), { FAKE_ACP_PROMPTS: promptsFile });
  writeFileSync(promptsFile, "");
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

test("/mcp in an opencode conversation lists its MCP servers in the conversation, without a message to the agent", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, "local", "", "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "local · opencode" });
  await startConversation(page, { withModels: false });

  const composer = page.locator(".composer:visible textarea");
  await composer.fill("/mc");
  await expect(page.getByRole("listbox", { name: "Slash commands" }).locator('[aria-selected="true"] .slash-command-name')).toHaveText("/mcp");
  await composer.press("Enter");

  await expect(page.locator(".timeline:visible")).toContainText("fake-server  connected");
  await expect(composer).toHaveValue("");
  await expect(page.locator(".timeline:visible .message.user")).toHaveCount(0);
  expect(readFileSync(promptsFile, "utf8")).toBe("");
});
