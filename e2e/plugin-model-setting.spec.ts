import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, callCanvasTool, conversationSettings, createProfile, openPluginRow, signIn, startConversation, openProfileTab } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

const host = new TestHost({ fakePrograms: true });
const promptsFile = join(host.root, "prompts");
const agentSaw = () => readFileSync(promptsFile, "utf8");

test.beforeAll(async () => {
  // The board test plugin's hand_over tool starts the conversations, on the profile and model its profile settings name,
  // on an opencode stand-in that offers models and answers CHOICES with the ones it is on.
  cpSync(join(import.meta.dirname, "..", "tests", "fixtures", "canvas-plugins", "board"), join(host.dataDir, "plugins", "board"), { recursive: true });
  writeBunProgram(host.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"), { FAKE_ACP_PROMPTS: promptsFile, FAKE_ACP_MODES: "1", FAKE_ACP_MODELS: "1" });
  writeFileSync(promptsFile, "");
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

/** Hands CHOICES over with neither a profile nor a model named, waiting until the caller heard what it ran on. */
async function handOverChoices(callerId: string, heard: string) {
  expect(await callCanvasTool(host, callerId, "hand_over", { task: "CHOICES" })).toMatch(/^Handed over to [0-9a-f-]+\.$/);
  await expect.poll(agentSaw).toContain(`The handed-over task finished: ${heard}\n`);
}

const settingInHeader = async (page: Page, label: string) => (await conversationSettings(page)).getByLabel(label, { exact: true });

test("a plugin's profile setting lists the models of the profile another of its settings chose, in Profiles and in a conversation's header, and the plugin's tool starts conversations on the one chosen", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  await (await createProfile(page, "Helper", "", "", "opencode")).getByRole("button", { name: "Close" }).click();
  const profiles = await createProfile(page, "Local", "", "", "opencode");
  await openProfileTab(profiles, "Plugins");
  await openPluginRow(profiles, "Board");
  const profilesModel = profiles.getByLabel("Profile Hand over model");

  await test.step("without a profile to hand over to, the only model is the agent's own", async () => {
    await expect(profilesModel.locator("option")).toHaveText(["Agent's default"]);
  });

  await test.step("the profile chosen brings its agent's models, and a change of profile takes the model chosen back", async () => {
    await profiles.getByLabel("Profile Hand over to").selectOption({ label: "Helper" });
    await expect(profilesModel.locator("option")).toHaveText(["Agent's default", "Default (recommended)", "Opus", "Haiku"]);
    await profilesModel.selectOption({ label: "Haiku" });
    await profiles.getByLabel("Profile Hand over to").selectOption({ label: "None" });
    await expect(profilesModel).toHaveValue("");
    await profiles.getByLabel("Profile Hand over to").selectOption({ label: "Helper" });
    await profilesModel.selectOption({ label: "Opus" });
    await profiles.getByRole("button", { name: "Save" }).click();
    await expect(profiles.locator(".saved")).toHaveText("Saved");
    await profiles.getByRole("button", { name: "Close" }).click();
  });

  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "Local · opencode" });
  const callerId = await startConversation(page);

  await test.step("the tool's conversation runs on the profile's model", async () => {
    await handOverChoices(callerId, "On model opus, mode default, effort low. — ran on Opus (opus), effort low");
  });

  await test.step("a model chosen in the conversation's header holds for that conversation", async () => {
    const model = await settingInHeader(page, "Hand over model");
    await expect(model.locator("option:checked")).toHaveText("Profile's (Opus)");
    await model.selectOption({ label: "Haiku" });
    await handOverChoices(callerId, "On model haiku, mode default. — ran on Haiku (haiku), effort none");
  });

  await test.step("a profile chosen in the header takes the conversation's model back, and leaves the profile's model with the profile it set", async () => {
    await (await settingInHeader(page, "Hand over to")).selectOption({ label: "Helper" });
    await expect((await settingInHeader(page, "Hand over model")).locator("option:checked")).toHaveText("Profile's (Agent's default)");
    await handOverChoices(callerId, "On model default, mode default, effort low. — ran on Default (recommended) (default), effort low");
  });
});
