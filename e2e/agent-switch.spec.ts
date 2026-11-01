import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { addWorkspace, createProfile, sendMessage, signIn, startConversation, waitForTurnToEnd } from "./helpers.ts";
import { ScriptedModel, scriptedOpencodeEnvironment } from "./scripted-model.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();
const model = new ScriptedModel();

test.beforeAll(async () => {
  mkdirSync(host.projectDir, { recursive: true });
  await model.start();
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
  model.stop();
});

test("an empty conversation moves to another agent's profile, and once it has begun offers those only greyed out", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, "Radiance", scriptedOpencodeEnvironment(model, host.root), "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await startConversation(page);
  const agent = page.locator(".chat-header:visible .harness");
  const profile = page.getByLabel("Profile", { exact: true }).filter({ visible: true });
  await expect(agent).toHaveText("Claude Code");

  await test.step("before the first message, an opencode profile can be picked, and the conversation runs on opencode from then on", async () => {
    await expect(profile.locator("optgroup")).toHaveAttribute("label", "Other agents");
    await expect(profile.locator("option", { hasText: "Radiance · opencode" })).toHaveJSProperty("disabled", false);
    await profile.selectOption({ label: "Radiance · opencode" });
    await expect(agent).toHaveText("opencode");
    await expect(page.locator(".timeline:visible")).toContainText("Now using opencode, with the profile “Radiance”");
    await sendMessage(page, "hello from opencode");
    await expect(page.locator(".message.agent:visible").last()).toContainText("hello from opencode");
    await waitForTurnToEnd(page);
  });

  await test.step("after a reload it still runs on opencode, and the Claude Code profile shows greyed out, for a new conversation", async () => {
    await page.reload();
    await expect(agent).toHaveText("opencode");
    await expect(profile.locator("option:checked")).toHaveText("Radiance");
    await expect(profile.locator("optgroup")).toHaveAttribute("label", "Other agents: start a new conversation");
    await expect(profile.locator("option", { hasText: "Claude Code · Claude Code" })).toHaveJSProperty("disabled", true);
  });
});
