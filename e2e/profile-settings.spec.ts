import { expect, test } from "@playwright/test";
import { addWorkspace, createProfile, openProfiles, reloadFromRestartedHost, sendMessage, signIn, startConversation, waitForTurnToEnd } from "./helpers.ts";
import { ScriptedModel, scriptedOpencodeEnvironment } from "./scripted-model.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();
const model = new ScriptedModel();
const PROFILE = "planner";

test.beforeAll(async () => {
  await model.start();
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
  model.stop();
});

test("a profile sets the mode, YOLO and Questions of the conversations that start with it or move to it", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const plainProfile = await createProfile(page, "plain", scriptedOpencodeEnvironment(model, host.root), "", "opencode");
  await plainProfile.getByRole("button", { name: "Close" }).click();
  const created = await createProfile(page, PROFILE, scriptedOpencodeEnvironment(model, host.root), "", "opencode");
  await expect(created.getByLabel("Profile mode").locator("option")).toHaveText(["Agent's default"]);
  await created.getByRole("button", { name: "Close" }).click();

  const sessionMode = page.getByLabel("Session Mode", { exact: true }).filter({ visible: true });
  const yolo = page.getByLabel("YOLO", { exact: true }).filter({ visible: true });
  const questions = page.getByLabel("Questions", { exact: true }).filter({ visible: true });
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "plain · opencode" });
  const plain = await startConversation(page);
  await expect(sessionMode).toHaveValue("build");

  await test.step("the profile offers the modes the agent listed, and keeps one with YOLO and Questions", async () => {
    const editor = await openProfiles(page);
    await editor.locator(".profile-list li", { hasText: PROFILE }).click();
    await expect(editor.getByLabel("Profile mode").locator("option")).toContainText(["Agent's default", "Build", "Plan"]);
    await editor.getByLabel("Profile mode").selectOption("plan");
    await editor.getByLabel("Profile YOLO").check();
    await editor.getByLabel("Profile questions").selectOption("next-message");
    await editor.getByRole("button", { name: "Save" }).click();
    await expect(editor.locator(".saved")).toHaveText("Saved");
    await editor.getByRole("button", { name: "Close" }).click();
  });

  let profiled = "";
  await test.step("a conversation that starts with the profile takes them", async () => {
    await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${PROFILE} · opencode` });
    profiled = await startConversation(page);
    await expect(sessionMode).toHaveValue("plan");
    await expect(yolo).toBeChecked();
    await expect(questions).toHaveValue("next-message");
  });

  await test.step("a conversation moved to the profile takes them too", async () => {
    await page.locator(`li[data-reorder-id="${plain}"]`).click();
    await expect(sessionMode).toHaveValue("build");
    await expect(yolo).not.toBeChecked();
    await page.getByLabel("Profile", { exact: true }).filter({ visible: true }).selectOption({ label: PROFILE });
    await expect(page.locator(".timeline:visible")).toContainText(`Now using the profile “${PROFILE}”`);
    await expect(sessionMode).toHaveValue("plan");
    await expect(yolo).toBeChecked();
    await expect(questions).toHaveValue("next-message");
  });

  await test.step("after a host restart before its first message, the conversation keeps the profile's mode", async () => {
    await host.stop();
    await host.start();
    await reloadFromRestartedHost(page);
    await page.locator(`li[data-reorder-id="${profiled}"]`).click();
    await sendMessage(page, "hello after the restart");
    await waitForTurnToEnd(page);
    await expect(page.locator(".timeline:visible .message.agent", { hasText: "hello after the restart" })).toBeVisible();
    await expect(sessionMode).toHaveValue("plan");
  });
});
