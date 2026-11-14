import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { FakeClaudeApi, subscriptionEnvironment } from "./fake-claude-api.ts";
import { addWorkspace, createProfile, sendMessage, signIn, startConversation, waitForTurnToEnd } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

const host = new TestHost({ fakePrograms: true, runsUserStatusLine: true });
const api = new FakeClaudeApi();
const PROFILE = "advised";
const promptsFile = join(host.root, "prompts");
const releaseFile = join(host.root, "release");

/** Claude settings of the test's own, whose statusline command prints a line of its own. */
function claudeSettingsWithStatusline() {
  const configDir = join(host.root, "claude-config");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, "settings.json"), JSON.stringify({ statusLine: { type: "command", command: "echo my own statusline" } }));
  return configDir;
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  // The advice test plugin reads the conversation's last turn as Mirador recorded it, and past half the context window offers to compact.
  cpSync(join(import.meta.dirname, "..", "tests", "fixtures", "context-hint-plugins", "advice"), join(host.dataDir, "plugins", "advice"), { recursive: true });
  writeBunProgram(host.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"), {
    FAKE_ACP_PROMPTS: promptsFile,
    FAKE_ACP_COMMANDS: JSON.stringify([{ name: "compact", description: "Sum up the conversation to free context" }]),
  });
  writeFileSync(promptsFile, "");
  api.limited = false;
  await api.start();
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
  api.stop();
});

test("a plugin's advice on the context shows on the context meter, whose Compact now sends /compact once the running turn ends", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, PROFILE, "", "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${PROFILE} · opencode` });
  await startConversation(page, { withModels: false });
  const statusline = page.getByRole("region", { name: "Statusline" });
  const badge = page.locator(".chat-header:visible .badge");

  await sendMessage(page, `WRITE ${JSON.stringify([{ read: "{{folder}}/a.txt" }, { read: "{{folder}}/b.txt" }, { usage: "150000 200000 0.5" }])}`);
  await waitForTurnToEnd(page);
  const meter = statusline.getByRole("button", { name: "Context 75% used" });
  await expect(meter, "the plugin read the turn's tool calls and context as Mirador recorded them").toHaveAttribute(
    "data-hint",
    /^Context window: 150,000 of 200,000 tokens in use \(75%\)\.\n\nThe last turn made 2 tool calls and left 150000 tokens in context\. The conversation cost 0\.5 USD so far\.\n\n/,
  );

  await test.step("Compact now, chosen while a turn runs, waits for the turn to end", async () => {
    await sendMessage(page, `WRITE ${JSON.stringify([{ waitFor: releaseFile }])}`);
    await expect(badge).toHaveText("running");
    await meter.click();
    const advice = page.getByRole("dialog", { name: "Context advice" });
    await expect(advice.locator("p")).toHaveText(["Advice The last turn made 2 tool calls and left 150000 tokens in context. The conversation cost 0.5 USD so far."]);
    await advice.getByRole("button", { name: "Compact now" }).click();
    await expect(advice).toHaveCount(0);
    await expect(page.locator(".queue:visible .queued-text")).toHaveText(["/compact"]);
    await expect(badge, "the turn runs on while /compact waits in the queue").toHaveText("running");
    writeFileSync(releaseFile, "");
  });

  await test.step("the agent compacts, and with the context down to a tenth the plugin no longer offers to", async () => {
    await expect(page.locator(".timeline:visible .message.user").last()).toHaveText("/compact");
    await waitForTurnToEnd(page);
    const smallerMeter = statusline.getByLabel("Context 10% used");
    await expect(smallerMeter).toHaveAttribute("data-hint", /The last turn made 0 tool calls and left 20000 tokens in context\./);
    await expect(statusline.getByRole("button", { name: /^Context/ })).toHaveCount(0);
    expect(readFileSync(promptsFile, "utf8").split("\n")).toContain("/compact");
  });
});

test("with the user's own statusline command showing, the context meter shows after it only while a plugin has advice", async ({ page }) => {
  await signIn(page, host);
  await page.goto(host.origin);
  const profiles = await createProfile(page, "own statusline", `${subscriptionEnvironment(api)}\nCLAUDE_CONFIG_DIR=${claudeSettingsWithStatusline()}`);
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "own statusline · Claude Code" });
  await startConversation(page);
  const statusline = page.getByRole("region", { name: "Statusline" });
  const meter = statusline.locator(".statusline-plugins .context-meter");
  await expect(statusline.locator(".statusline-terminal")).toHaveAttribute("aria-label", "my own statusline");
  await expect(meter, "no turn yet, so no advice").toHaveCount(0);

  await sendMessage(page, "hello");
  await waitForTurnToEnd(page);
  await expect(meter).toHaveAttribute("data-hint", /\n\nThe last turn made 0 tool calls and left \d+ tokens in context\. /);
  await expect(statusline.locator(".statusline-terminal")).toHaveAttribute("aria-label", "my own statusline");
});
