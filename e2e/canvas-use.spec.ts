import { cpSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { FakeClaudeApi, subscriptionEnvironment } from "./fake-claude-api.ts";
import { addWorkspace, createProfile, lastAgentMessage, openSettings, sendMessage, signIn, startConversation } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();
const api = new FakeClaudeApi();
const PROFILE = "fake subscription";
const GUIDANCE = "This conversation runs in Mirador, where the user reads a canvas panel";
const PLUGIN_LINE = "- show_card: show a card the user can press.";

/** Claude Code passes the MCP servers' instructions on in a system message of the conversation, not in the system prompt. */
const canvasServerInstructionsSent = () => api.history.flat().filter((message) => message.includes("so you can fix them."));

function expectPluginLinesInTheirOwnSection(systemPrompt = "") {
  expect(systemPrompt).toContain("# Canvas plugins\n");
  expect(systemPrompt.split(PLUGIN_LINE).length - 1, "the plugin's line comes once in the system prompt").toBe(1);
  expect(canvasServerInstructionsSent(), "the canvas server's instructions reached the agent").not.toEqual([]);
  expect(canvasServerInstructionsSent().filter((message) => message.includes(PLUGIN_LINE)), "and they leave the plugin's line out").toEqual([]);
}

test.beforeAll(async () => {
  api.limited = false;
  await api.start();
  cpSync(join(import.meta.dirname, "..", "tests", "fixtures", "canvas-plugins", "board"), join(host.dataDir, "plugins", "board"), { recursive: true });
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
  api.stop();
});

test("Settings choose how often Claude Code uses the canvas: Often puts guidance into the system prompt of the sessions started after", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, PROFILE, subscriptionEnvironment(api));
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${PROFILE} · Claude Code` });
  await startConversation(page);

  await test.step("by default Claude Code is told to use the canvas often", async () => {
    await sendMessage(page, "first conversation");
    await expect(lastAgentMessage(page)).toHaveText("Answered: first conversation", { timeout: 120_000 });
    expect(api.systemPrompts.get("first conversation")).toContain(GUIDANCE);
    expectPluginLinesInTheirOwnSection(api.systemPrompts.get("first conversation"));
  });

  await test.step("As needed shows in every window and leaves the guidance out of a session started after", async () => {
    const settings = await openSettings(page, "Canvas");
    const canvasUse = settings.getByLabel("Claude Code, pi, Codex, Copilot and Antigravity use the canvas");
    await expect(canvasUse).toHaveValue("often");
    await canvasUse.selectOption({ label: "As needed" });
    const otherWindow = await page.context().newPage();
    await otherWindow.goto(page.url());
    await expect((await openSettings(otherWindow, "Canvas")).getByLabel("Claude Code, pi, Codex, Copilot and Antigravity use the canvas")).toHaveValue("as-needed");
    await otherWindow.close();
    await settings.getByRole("button", { name: "Close" }).click();
    await startConversation(page);
    await sendMessage(page, "second conversation");
    await expect(lastAgentMessage(page)).toHaveText("Answered: second conversation", { timeout: 120_000 });
    expect(api.systemPrompts.get("second conversation")).toContain("You are");
    expect(api.systemPrompts.get("second conversation")).not.toContain(GUIDANCE);
    expect(api.systemPrompts.get("second conversation"), "the guidance for jobs left running stays").toContain("mirador when-done");
    expectPluginLinesInTheirOwnSection(api.systemPrompts.get("second conversation"));
  });
});
