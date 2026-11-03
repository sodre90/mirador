import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, createProfile, signIn } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

const host = new TestHost({ fakePrograms: true });
const promptsFile = join(host.root, "prompts");
const agentSaw = () => readFileSync(promptsFile, "utf8");
const profileName = "tally";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  cpSync(join(import.meta.dirname, "..", "tests", "fixtures", "workspace-tab-plugins", "tally"), join(host.dataDir, "plugins", "tally"), { recursive: true });
  writeBunProgram(host.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"), { FAKE_ACP_PROMPTS: promptsFile });
  writeFileSync(promptsFile, "");
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const tabView = (page: Page) => page.frameLocator(".canvas-panel:visible .canvas-frame.workspace-tab iframe");
const tabToggle = (page: Page) => page.locator(".canvas-panel:visible .workspace-tab-toggle", { hasText: "Tally" });

async function startConversation(page: Page) {
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, profileName, "", "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${profileName} · opencode` });
  const previousUrl = page.url();
  await page.getByRole("button", { name: "+ New conversation" }).click();
  await expect(page).not.toHaveURL(previousUrl);
}

test("a plugin's workspace tab shows its state, takes the user's actions, and hands work to the agent", async ({ page }) => {
  await signIn(page, host);
  await startConversation(page);

  await test.step("the tab opens from the canvas bar, drawn by the plugin's view for this workspace", async () => {
    await tabToggle(page).click();
    await expect(tabToggle(page)).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".canvas-panel:visible .canvas-title")).toHaveText("Tally");
    await expect(tabView(page).locator("#place")).toHaveText("Drawn in the tab");
    await expect(tabView(page).locator("#workspace")).toHaveText(/^Workspace: \S+/);
    await expect(tabView(page).locator("#count")).toHaveText("Counted 0 here, 0 everywhere");
  });

  await test.step("the user's action reaches the plugin, whose reply and new state come back", async () => {
    await tabView(page).getByRole("button", { name: "Count" }).click();
    await expect(tabView(page).locator("#reply")).toHaveText("Counted to 1");
    await expect(tabView(page).locator("#count")).toHaveText("Counted 1 here, 1 everywhere");
    await tabView(page).getByRole("button", { name: "Do what tallies don't" }).click();
    await expect(tabView(page).locator("#reply")).toHaveText("The tally can only count.");
  });

  await test.step("a link the tab opens goes to a new tab of the browser", async () => {
    await page.context().route("https://example.invalid/tally", (route) => route.fulfill({ body: "The tally's site" }));
    const opened = page.context().waitForEvent("page");
    await tabView(page).getByRole("link", { name: "Open the tally's site" }).click();
    const site = await opened;
    expect(site.url()).toBe("https://example.invalid/tally");
    await site.close();
  });

  await test.step("the tab adds words to the composer, for the user to finish", async () => {
    await tabView(page).getByRole("button", { name: "Add to the composer" }).click();
    await expect(tabView(page).locator("#handed")).toHaveText("Added");
    await expect(page.locator(".composer:visible textarea")).toHaveValue("Tally adds this");
    await page.locator(".composer:visible textarea").fill("");
  });

  await test.step("the tab sends the conversation's agent a message", async () => {
    await tabView(page).getByRole("button", { name: "Ask the agent" }).click();
    await expect(tabView(page).locator("#handed")).toHaveText("Asked");
    await expect.poll(agentSaw).toContain("Tally says hello\n");
    await expect(page.locator(".chat-header:visible .badge")).toHaveText("idle", { timeout: 60_000 });
  });

  await test.step("the tab starts a conversation in the workspace, which shows and works on its message at once", async () => {
    const before = page.url();
    await tabView(page).getByRole("button", { name: "Start a conversation" }).click();
    await expect(page).not.toHaveURL(before);
    await expect.poll(agentSaw).toContain("Tally starts this\n");
    await expect(page.locator(".timeline:visible .message.user", { hasText: "Tally starts this" })).toBeVisible();
  });

  await test.step("the new conversation's canvas has the same tab, with the workspace's state", async () => {
    await tabToggle(page).click();
    await expect(tabView(page).locator("#count")).toHaveText("Counted 1 here, 1 everywhere");
  });
});
