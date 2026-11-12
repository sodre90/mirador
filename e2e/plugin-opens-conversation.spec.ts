import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { addWorkspace, callCanvasTool, createProfile, signIn, startConversation, untilFramePainted } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

const host = new TestHost({ fakePrograms: true });
const promptsFile = join(host.root, "prompts");

test.beforeAll(async () => {
  cpSync(join(import.meta.dirname, "..", "tests", "fixtures", "canvas-plugins", "board"), join(host.dataDir, "plugins", "board"), { recursive: true });
  writeBunProgram(host.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"), { FAKE_ACP_PROMPTS: promptsFile });
  writeFileSync(promptsFile, "");
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

test("a plugin's view opens a conversation its plugin started from this one, and no other", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, "Local", "", "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "Local · opencode" });
  const callerId = await startConversation(page, { withModels: false });

  const handedOver = await callCanvasTool(host, callerId, "hand_over", { profile: "local", task: "Look around" });
  const startedId = handedOver.match(/^Handed over to ([0-9a-f-]+)\.$/)![1]!;
  await expect.poll(() => readFileSync(promptsFile, "utf8")).toContain("Look around");
  await callCanvasTool(host, callerId, "show_card", { title: "Racers", text: "Open one" });

  const frame = page.locator(".canvas-panel:visible .canvas-frame.plugin iframe");
  const view = frame.contentFrame();
  await expect(view.getByRole("button", { name: "Open the conversation" })).toBeVisible();
  await untilFramePainted(page, frame);
  await view.getByLabel("Conversation to open").fill(callerId);
  await view.getByRole("button", { name: "Open the conversation" }).click();
  await expect(view.locator("#opened")).toHaveText(`Conversation ${callerId} wasn't started by the board plugin from this conversation, so its view can't open it.`);
  await expect(page).toHaveURL(new RegExp(`#/c/${callerId}$`));

  await view.getByLabel("Conversation to open").fill(startedId);
  await view.getByRole("button", { name: "Open the conversation" }).click();
  await expect(page).toHaveURL(new RegExp(`#/c/${startedId}$`));
  await expect(page.locator(".sidebar li.selected")).toHaveCount(1);
});
