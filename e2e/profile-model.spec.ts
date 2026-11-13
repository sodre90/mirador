import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, conversationSettings, createProfile, openProfileTab, openProfiles, sendMessage, signIn, startConversation, waitForTurnToEnd } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";
import type { ProfileDraft } from "../shared/protocol.ts";

const host = new TestHost({ fakePrograms: true });
const agentLogFile = join(host.root, "agent-log");
const promptsFile = join(host.root, "prompts");

test.beforeAll(async () => {
  writeBunProgram(host.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"), { FAKE_ACP_LOG: agentLogFile, FAKE_ACP_PROMPTS: promptsFile });
  writeFileSync(agentLogFile, "");
  writeFileSync(promptsFile, "");
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

/** The option changes the agents with a FAKE_ACP_NAME were asked for. */
const optionChanges = () =>
  readFileSync(agentLogFile, "utf8")
    .split("\n")
    .filter((line) => line.includes(" set "));

/** The stub agent of every profile here lists models, modes and effort levels. */
const agentEnvironment = (name: string) => `FAKE_ACP_MODELS=1\nFAKE_ACP_MODES=1\nFAKE_ACP_NAME=${name}`;

const modelShown = (page: Page) => page.locator(".chat-header:visible .settings-model");

/** Saved as a page could save it, with a model the editor only offers once the agent has listed it. */
async function saveProfileWithModel(page: Page, name: string, environment: string, model: string) {
  await page.evaluate(
    (profile) =>
      new Promise((resolve) => {
        const socket = new WebSocket(`${location.origin.replace(/^http/, "ws")}/ws`);
        socket.onopen = () => socket.send(JSON.stringify({ type: "profile.save", requestId: "save-model", profile }));
        socket.onmessage = ({ data }) => JSON.parse(String(data)).type === "profile.saved" && resolve(socket.close());
      }),
    { name, harness: "opencode", environment, prelaunch: "", model, mode: null, effort: null, bypassPermissions: false, askMode: "wait", color: null, pluginsOff: [] } satisfies ProfileDraft,
  );
}

test("a profile sets the model of the conversations that start with it or move to it, and reads their effort after it", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  for (const name of ["plain", "thorough", "quick"]) {
    const profiles = await createProfile(page, name, agentEnvironment(name), "", "opencode");
    await openProfileTab(profiles, "Defaults");
    await expect(profiles.getByLabel("Profile model").locator("option")).toHaveText(["Agent's default", "Default (recommended)", "Opus", "Haiku"], { timeout: 60_000 });
    await profiles.getByRole("button", { name: "Close" }).click();
  }
  const profilePicker = async () => (await conversationSettings(page)).getByLabel("Profile", { exact: true });
  const timeline = page.locator(".timeline:visible");
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "plain · opencode" });
  const plain = await startConversation(page);
  await expect(modelShown(page)).toHaveText("Default (recommended)");

  await test.step("a profile that names a model keeps it, and offers what the agent listed", async () => {
    const editor = await openProfiles(page);
    await editor.locator(".profile-list li", { hasText: "thorough" }).click();
    await openProfileTab(editor, "Defaults");
    await editor.getByLabel("Profile model").selectOption("opus");
    await editor.getByRole("button", { name: "Save" }).click();
    await expect(editor.locator(".saved")).toHaveText("Saved");
    await editor.getByRole("button", { name: "Close" }).click();
  });

  await test.step("a conversation that starts with the profile takes its model, and its first message goes out on it", async () => {
    await page.getByLabel("Agent", { exact: true }).selectOption({ label: "thorough · opencode" });
    await startConversation(page);
    await expect(modelShown(page)).toHaveText("Opus");
    expect(optionChanges()).toContain("thorough set model to opus");
    await sendMessage(page, "CHOICES");
    await waitForTurnToEnd(page);
    await expect(page.locator(".timeline:visible .message.agent").last()).toContainText("On model opus, mode default, effort low.");
  });

  await test.step("a conversation moved to the profile takes its model too", async () => {
    await page.locator(`li[data-reorder-id="${plain}"]`).click();
    await expect(modelShown(page)).toHaveText("Default (recommended)");
    await (await profilePicker()).selectOption({ label: "thorough" });
    await expect(timeline).toContainText("Now using the profile “thorough”");
    await expect(modelShown(page)).toHaveText("Opus");
  });

  await test.step("a model with no effort levels takes none of the profile's", async () => {
    const editor = await openProfiles(page);
    await editor.locator(".profile-list li", { hasText: "quick" }).click();
    await openProfileTab(editor, "Defaults");
    await editor.getByLabel("Profile model").selectOption("haiku");
    await editor.getByLabel("Profile effort").selectOption("high");
    await editor.getByRole("button", { name: "Save" }).click();
    await expect(editor.locator(".saved")).toHaveText("Saved");
    await editor.getByRole("button", { name: "Close" }).click();

    await page.getByLabel("Agent", { exact: true }).selectOption({ label: "quick · opencode" });
    await startConversation(page);
    await expect(modelShown(page)).toHaveText("Haiku");
    expect(optionChanges()).toContain("quick set model to haiku");
    expect(optionChanges()).not.toContain("quick set effort to high");
  });

  await test.step("a model the agent does not offer leaves the conversation on its own and says why", async () => {
    await saveProfileWithModel(page, "unlisted", agentEnvironment("unlisted"), "gpt-9");
    await (await profilePicker()).selectOption({ label: "unlisted" });
    await expect(timeline).toContainText("Now using the profile “unlisted”");
    await expect(modelShown(page)).toHaveText("Default (recommended)");
    expect(optionChanges()).not.toContain("unlisted set model to gpt-9");
    await expect(timeline.locator(".error-line")).not.toHaveCount(0);
  });
});
