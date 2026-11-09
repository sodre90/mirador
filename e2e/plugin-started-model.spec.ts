import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, callCanvasTool, createProfile, signIn, startConversation } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

const host = new TestHost({ fakePrograms: true });
const promptsFile = join(host.root, "prompts");
const agentSaw = () => readFileSync(promptsFile, "utf8");

test.beforeAll(async () => {
  // The board test plugin's hand_over tool starts the conversations, on an opencode stand-in that offers models and
  // efforts and answers CHOICES with the ones it is on.
  cpSync(join(import.meta.dirname, "..", "tests", "fixtures", "canvas-plugins", "board"), join(host.dataDir, "plugins", "board"), { recursive: true });
  writeBunProgram(host.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"), { FAKE_ACP_PROMPTS: promptsFile, FAKE_ACP_MODES: "1", FAKE_ACP_MODELS: "1" });
  writeFileSync(promptsFile, "");
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

async function callerOnLocalProfile(page: Page) {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, "Local", "", "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "Local · opencode" });
  return startConversation(page);
}

/** Hands CHOICES over, waiting until the caller heard how it ended, with what it ran on; returns the started conversation. */
async function handOverChoices(callerId: string, choices: { model?: string; effort?: string }, heard: string) {
  const handedOver = await callCanvasTool(host, callerId, "hand_over", { profile: "local", task: "CHOICES", ...choices });
  const startedId = handedOver.match(/^Handed over to ([0-9a-f-]+)\.$/)![1]!;
  await expect.poll(agentSaw).toContain(`The handed-over task finished: ${heard}\n`);
  return startedId;
}

async function show(page: Page, conversationId: string) {
  await page.evaluate((id) => (location.hash = `#/c/${id}`), conversationId);
  await expect(page.locator(".sidebar li.selected")).toHaveCount(1);
}

test("a conversation a plugin's tool starts runs on the model and effort the plugin chose from its first message, and the plugin hears what it ran on", async ({ page }) => {
  const callerId = await callerOnLocalProfile(page);

  const onOpus = await handOverChoices(callerId, { model: "opus", effort: "high" }, "On model opus, mode default, effort high. — ran on Opus (opus), effort high");
  await show(page, onOpus);
  await expect(page.locator(".chat-header:visible .settings-model")).toHaveText("Opus");
  await expect(page.locator(".timeline:visible")).not.toContainText("Could not set");

  await test.step("an effort is skipped on a model that has none", async () => {
    const onHaiku = await handOverChoices(callerId, { model: "haiku", effort: "high" }, "On model haiku, mode default. — ran on Haiku (haiku), effort none");
    await show(page, onHaiku);
    await expect(page.locator(".chat-header:visible .settings-model")).toHaveText("Haiku");
    await expect(page.locator(".timeline:visible")).not.toContainText("Could not set");
  });

  await test.step("a model the agent doesn't offer leaves the conversation on its default, and says so there", async () => {
    const onDefault = await handOverChoices(
      callerId,
      { model: "gpt-9", effort: "high" },
      "On model default, mode default, effort high. — ran on Default (recommended) (default), effort high",
    );
    await show(page, onDefault);
    await expect(page.locator(".timeline:visible")).toContainText("Could not set Model to gpt-9: gpt-9 is not one of the choices of Model.");
    await expect(page.locator(".chat-header:visible .settings-model")).toHaveText("Default (recommended)");
  });
});
