import { cpSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, conversationSettings, createProfile, openProfiles, openProfileTab, sendMessage, signIn, startConversation, waitForTurnToEnd } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

const host = new TestHost({ fakePrograms: true });
const PROFILE = "metered";

test.beforeAll(async () => {
  // The meter test plugin types and toggles its profile settings, checks them, and shows chips in the statusline, one of which carries the conversation's cost.
  cpSync(join(import.meta.dirname, "..", "tests", "fixtures", "statusline-plugins", "meter"), join(host.dataDir, "plugins", "meter"), { recursive: true });
  writeBunProgram(host.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"), { FAKE_ACP_PROMPTS: join(host.root, "prompts") });
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const windowView = (page: Page) => page.frameLocator(".item-window .canvas-frame.plugin iframe");

test("a plugin's profile settings are typed, toggled and checked under its title, and its chips in the statusline take the place of the agent's cost and open its window", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const editor = await createProfile(page, PROFILE, "METER_URL=https://meter.test\nMETER_KEY=key-from-env-1234", "", "opencode");
  await openProfileTab(editor, "Plugins");
  const meter = editor.getByRole("group", { name: "Meter" });

  await test.step("only the toggle and the settings that don't wait for it show until it is on", async () => {
    await expect(meter.getByLabel("Profile Uses the meter")).not.toBeChecked();
    await expect(meter.getByLabel("Profile Meter tier")).toBeVisible();
    await expect(meter.getByLabel("Profile Meter URL")).toHaveCount(0);
    await expect(meter.getByRole("button", { name: "Test connection" })).toHaveCount(0);
    await meter.getByLabel("Profile Uses the meter").check();
    await expect(meter.getByLabel("Profile Meter URL")).toHaveAttribute("placeholder", "Empty: METER_URL from Launch");
    await expect(meter.getByLabel("Profile Total on the statusline")).toBeChecked();
  });

  await test.step("the key shows masked until revealed", async () => {
    const key = meter.getByLabel("Profile Meter key");
    await key.fill("$METER_KEY");
    await expect(key).toHaveAttribute("type", "password");
    await meter.getByRole("button", { name: "Show Meter key" }).click();
    await expect(key).toHaveAttribute("type", "text");
    await meter.getByRole("button", { name: "Hide Meter key" }).click();
    await expect(key).toHaveAttribute("type", "password");
  });

  await test.step("Test connection asks the plugin about the unsaved form, reading the environment's variables where the fields say so", async () => {
    await meter.getByRole("button", { name: "Test connection" }).click();
    await expect(meter.getByRole("status")).toHaveText("Reached https://meter.test with a key ending 1234");
    await meter.getByLabel("Profile Meter URL").fill("https://typed.test");
    await expect(meter.getByRole("status")).toHaveCount(0);
    await meter.getByRole("button", { name: "Test connection" }).click();
    await expect(meter.getByRole("status")).toHaveText("Reached https://typed.test with a key ending 1234");
    await meter.getByLabel("Profile Meter URL").fill("");
    await openProfileTab(editor, "Launch");
    await editor.getByRole("button", { name: "Edit environment" }).click();
    await editor.getByLabel("Environment", { exact: true }).fill("METER_KEY=key-from-env-1234");
    await openProfileTab(editor, "Plugins");
    await meter.getByRole("button", { name: "Test connection" }).click();
    await expect(meter.getByRole("alert")).toHaveText("Give the meter's URL.");
    await openProfileTab(editor, "Launch");
    await editor.getByLabel("Environment", { exact: true }).fill("METER_URL=https://meter.test\nMETER_KEY=key-from-env-1234");
    await editor.getByRole("button", { name: "Save" }).click();
    await expect(editor.locator(".saved")).toHaveText("Saved");
    await editor.getByRole("button", { name: "Close" }).click();
  });

  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${PROFILE} · opencode` });
  await startConversation(page, { withModels: false });
  const statusline = page.getByRole("region", { name: "Statusline" });
  const meterChips = statusline.getByRole("group", { name: "Meter" });

  await test.step("the conversation's header offers only the setting with choices for this conversation alone", async () => {
    const settings = await conversationSettings(page);
    await expect(settings.getByLabel("Meter tier", { exact: true })).toBeVisible();
    await expect(settings.getByLabel("Uses the meter", { exact: true })).toHaveCount(0);
    await expect(settings.getByLabel("Meter URL", { exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
  });

  await test.step("the plugin's chips stand together, and its cost takes the place of the one the agent reported", async () => {
    await sendMessage(page, "USAGE 100 1000 3.5");
    await waitForTurnToEnd(page);
    await expect(page.locator(".context-meter")).toHaveText(/10%/);
    await expect(meterChips.locator(".plugin-chip")).toHaveText(["⏱", "Total basic", "Session $1.25"]);
    await expect(meterChips.getByText("⏱")).toHaveAttribute("data-hint", "Meter at https://meter.test");
    await expect(meterChips.getByText("Total basic")).toHaveClass(/level-warn/);
    await expect(meterChips.getByText("Total basic")).toHaveClass(/stale/);
    await expect(statusline.getByText("$3.50")).toHaveCount(0);
  });

  await test.step("a chip that opens the plugin's window hands it what to show", async () => {
    const opened = page.context().waitForEvent("page");
    await meterChips.getByRole("button", { name: "Session $1.25" }).click();
    const meterWindow = await opened;
    await expect(windowView(meterWindow).locator("#showing")).not.toHaveText("Showing nothing");
    await expect(windowView(meterWindow).locator("#showing")).toHaveText(/^Showing .+/);
    await expect(windowView(meterWindow).locator("#metered")).toHaveText(`Metered profiles: ${PROFILE}`);
    await meterWindow.close();
  });

  await test.step("with the meter off, the plugin shows nothing and the agent's cost comes back", async () => {
    const profiles = await openProfiles(page);
    await profiles.locator(".profile-list li", { hasText: PROFILE }).click();
    await openProfileTab(profiles, "Plugins");
    await profiles.getByRole("group", { name: "Meter" }).getByLabel("Profile Uses the meter").uncheck();
    await profiles.getByRole("button", { name: "Save" }).click();
    await expect(profiles.locator(".saved")).toHaveText("Saved");
    await profiles.getByRole("button", { name: "Close" }).click();
    await sendMessage(page, "USAGE 200 1000 3.5");
    await waitForTurnToEnd(page);
    await expect(page.locator(".context-meter")).toHaveText(/20%/);
    await expect(meterChips).toHaveCount(0);
    await expect(statusline.getByText("$3.50")).toBeVisible();
  });
});
