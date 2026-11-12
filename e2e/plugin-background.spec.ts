import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, createProfile, signIn, untilFramePainted } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

const host = new TestHost({ fakePrograms: true });
const promptsFile = join(host.root, "prompts");
const agentSaw = () => readFileSync(promptsFile, "utf8");
const profileName = "night runs";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  cpSync(join(import.meta.dirname, "..", "tests", "fixtures", "background-plugins", "starter"), join(host.dataDir, "plugins", "starter"), { recursive: true });
  writeBunProgram(host.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"), { FAKE_ACP_PROMPTS: promptsFile });
  writeFileSync(promptsFile, "");
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const tabFrame = (page: Page) => page.locator(".canvas-panel:visible .canvas-frame.workspace-tab iframe");
const tabView = (page: Page) => page.frameLocator(".canvas-panel:visible .canvas-frame.workspace-tab iframe");
const tabToggle = (page: Page) => page.locator(".canvas-panel:visible .workspace-tab-toggle", { hasText: "Starter" });
const sidebarRow = (page: Page, title: string) => page.locator(".workspace li", { hasText: title });
const fromStarter = (page: Page) => page.locator(".timeline-entry:visible", { has: page.locator(".author", { hasText: "From Starter" }) }).locator(".message.user");

test("a plugin's background work starts a conversation of its own in a workspace, and its tab starts one on the profile the user picks", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, profileName, "", "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${profileName} · opencode` });
  const previousUrl = page.url();
  await page.getByRole("button", { name: "+ New conversation" }).click();
  await expect(page).not.toHaveURL(previousUrl);

  await test.step("the plugin's background work starts a conversation in the workspace by itself, which stands in the sidebar and is marked Done when its turn ends", async () => {
    writeFileSync(join(host.projectDir, "start-in-background"), profileName);
    await expect(sidebarRow(page, "Background start")).toBeVisible();
    await expect.poll(agentSaw).toContain("Started in the background\n");
    await expect(sidebarRow(page, "Background start").locator(".waiting-pill")).toHaveText("Done");
  });

  await test.step("its first message shows as the plugin's, and its header names the profile it runs on", async () => {
    await sidebarRow(page, "Background start").click();
    await expect(fromStarter(page)).toHaveText(/Started in the background/);
    await expect(page.locator(".chat-header:visible")).toContainText(profileName);
  });

  await test.step("the plugin's tab lists the profiles and starts a conversation on the one picked", async () => {
    await tabToggle(page).click();
    await untilFramePainted(page, tabFrame(page));
    await expect(tabView(page).locator("#profile option", { hasText: profileName })).toBeAttached();
    await tabView(page).locator("#profile").selectOption(profileName);
    await tabView(page).getByRole("button", { name: "Start on it" }).click();
    await expect(tabView(page).locator("#started")).toHaveText(`Started on ${profileName}`);
    await expect(sidebarRow(page, "Results")).toBeVisible();
    await expect.poll(agentSaw).toContain("Check the results\n");
  });
});
