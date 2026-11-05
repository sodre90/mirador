import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, callCanvasTool, conversationSettings, createProfile, signIn, startConversation, turnOnYolo } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();

test.beforeAll(() => host.start());
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const settingsToggle = (page: Page) => page.locator(".chat-header:visible .conversation-settings-toggle");

async function signInWithWorkspace(page: Page) {
  await signIn(page, host);
  const [newConversation, addProject] = [page.getByRole("button", { name: "+ New conversation" }), page.getByRole("button", { name: "+ Add a project directory" })];
  await expect(newConversation.or(addProject)).toBeVisible();
  if (await addProject.isVisible()) await addWorkspace(page, host.projectDir);
}

test("the bar names the profile and model, and opens the rest as this conversation's own settings", async ({ page }) => {
  await signInWithWorkspace(page);
  await startConversation(page);
  const toggle = settingsToggle(page);
  await expect(toggle.locator(".settings-profile")).toHaveText("Claude Code");
  await expect(toggle.locator(".settings-agent"), "a profile named after its agent doesn't name it twice").toHaveCount(0);
  const model = await toggle.locator(".settings-model").textContent();
  await expect(toggle).toHaveText(`Claude Code · ${model}▾`);
  await expect(page.locator(".chat-header:visible").getByLabel("Profile", { exact: true }), "the settings wait in their popover").toHaveCount(0);

  const settings = await conversationSettings(page);
  await expect(settings.getByRole("heading", { name: "This conversation's settings" })).toBeVisible();
  await expect(settings).toContainText("The profile only gives them their first values");
  for (const label of ["Profile", "Model", "YOLO", "Questions"]) await expect(settings.getByLabel(label, { exact: true })).toBeVisible();

  await settings.getByLabel("Questions", { exact: true }).selectOption("next-message");
  await expect(settings, "a change keeps the settings open").toBeVisible();
  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();
  await toggle.click();
  await expect(settings).toBeVisible();
  await page.locator(".composer:visible textarea").click();
  await expect(settings, "a press outside closes them").toBeHidden();
});

test("YOLO shows in the bar while it is on", async ({ page }) => {
  await signInWithWorkspace(page);
  await startConversation(page);
  const yoloBadge = page.locator(".chat-header:visible .yolo-on");
  await expect(yoloBadge).toHaveCount(0);
  await turnOnYolo(page);
  await expect(yoloBadge).toHaveText("YOLO");
  await (await conversationSettings(page)).getByLabel("YOLO", { exact: true }).click();
  await expect(yoloBadge).toHaveCount(0);
});

test("the agent shows beside a profile whose name doesn't say it, and beside a deleted profile", async ({ page }) => {
  await signInWithWorkspace(page);
  const profiles = await createProfile(page, "fat-llm", "");
  await profiles.getByRole("button", { name: "Close" }).click();
  await startConversation(page);
  const toggle = settingsToggle(page);
  await (await conversationSettings(page)).getByLabel("Profile", { exact: true }).selectOption({ label: "fat-llm" });
  await expect(toggle.locator(".settings-profile")).toHaveText("fat-llm");
  await expect(toggle.locator(".settings-agent")).toHaveText("Claude Code");
  await page.keyboard.press("Escape");

  const dialog = await createProfile(page, "spare", "");
  await dialog.locator(".profile-list li", { hasText: "fat-llm" }).click();
  await dialog.getByRole("button", { name: "Delete profile" }).click();
  await dialog.getByRole("button", { name: "Confirm: Delete profile" }).click();
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(toggle.locator(".settings-profile")).toHaveText("Deleted profile");
  await expect(toggle.locator(".settings-agent")).toHaveText("Claude Code");
});

for (const width of [1100, 1440]) {
  test(`at ${width}px wide, the conversation's bar keeps its height as the canvas hides and shows`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await signInWithWorkspace(page);
    const conversationId = await startConversation(page);
    await callCanvasTool(host, conversationId, "show", { title: "Open", html: "<p>canvas</p>" });
    const canvasToggle = page.locator(".window-bar").getByRole("button", { name: "Hide canvas" });
    await expect(canvasToggle).toBeVisible();
    const header = page.locator(".chat-header:visible");
    const heightWithCanvas = (await header.boundingBox())!.height;

    await canvasToggle.click();
    await expect(page.locator(".window-bar").getByRole("button", { name: "Show canvas" })).toBeVisible();
    expect((await header.boundingBox())!.height).toBe(heightWithCanvas);
  });
}
