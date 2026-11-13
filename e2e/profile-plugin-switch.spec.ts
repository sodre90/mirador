import { cpSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { addWorkspace, canvasToolNames, createProfile, openPluginRow, openProfiles, openProfileTab, sendMessage, signIn, startConversation, waitForTurnToEnd } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

test.describe.configure({ mode: "serial" });

const host = new TestHost({ fakePrograms: true });
const PROFILE = "switched";

test.beforeAll(async () => {
  // Board gives the agent tools and the user slash commands; Meter types and toggles its settings and shows chips in the statusline.
  const fixtures = join(import.meta.dirname, "..", "tests", "fixtures");
  cpSync(join(fixtures, "canvas-plugins", "board"), join(host.dataDir, "plugins", "board"), { recursive: true });
  cpSync(join(fixtures, "statusline-plugins", "meter"), join(host.dataDir, "plugins", "meter"), { recursive: true });
  writeBunProgram(host.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"), { FAKE_ACP_PROMPTS: join(host.root, "prompts") });
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const pluginSwitch = (editor: Locator, title: string) => editor.getByRole("group", { name: title, exact: true }).getByRole("switch", { name: `Use ${title} in this profile` });
const summaryOf = (editor: Locator, title: string) => editor.getByRole("group", { name: title, exact: true }).locator(".plugin-summary");
const unsavedMarkOf = (editor: Locator, title: string) => editor.getByRole("group", { name: title, exact: true }).getByRole("img", { name: "Unsaved changes" });

async function editPlugins(page: Page) {
  const profiles = await openProfiles(page);
  await profiles.locator(".profile-list li", { hasText: PROFILE }).click();
  await openProfileTab(profiles, "Plugins");
  return profiles;
}

async function saveAndClose(profiles: Locator) {
  await profiles.getByRole("button", { name: "Save" }).click();
  await expect(profiles.locator(".saved")).toHaveText("Saved");
  await profiles.getByRole("button", { name: "Close" }).click();
}

async function expectSlashMenuOffers(page: Page, command: string, offered: boolean) {
  const composer = page.locator(".composer:visible textarea");
  await composer.fill(command.slice(0, -1));
  const named = page.getByRole("listbox", { name: "Slash commands" }).locator(".slash-command-name", { hasText: command });
  await (offered ? expect(named).toBeVisible() : expect(named).toHaveCount(0));
  await composer.fill("");
}

test("each plugin is a row of the Plugins tab: closed, it sums up what it holds; open, it shows its settings from plugin.json, where they read the Launch environment, and the tools it gives", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const editor = await createProfile(page, PROFILE, "METER_URL=https://meter.test\n-u METER_KEY", "", "opencode");
  await openProfileTab(editor, "Plugins");

  await test.step("the rows stand closed by title, each saying what it holds, and the tally counts those on", async () => {
    await expect(editor.locator(".plugin-row .plugin-name")).toHaveText(["Board", "Meter"]);
    await expect(editor.getByText("1 of 2 on"), "a plugin whose switch is its own toggle starts as that toggle does").toBeVisible();
    await expect(summaryOf(editor, "Board")).toHaveText("Hand over to: None · Hand over model: Agent's default");
    await expect(summaryOf(editor, "Meter")).toHaveText("Off for this profile");
    await expect(editor.getByLabel("Profile Meter tier")).toBeHidden();
  });

  await test.step("search keeps the rows whose title, settings or tools match, and Escape clears it without closing the dialog", async () => {
    const search = editor.getByRole("searchbox", { name: "Search plugins" });
    await search.fill("show_card");
    await expect(editor.locator(".plugin-row .plugin-name")).toHaveText(["Board"]);
    await search.fill("meter url");
    await expect(editor.locator(".plugin-row .plugin-name")).toHaveText(["Meter"]);
    await search.fill("nothing like it");
    await expect(editor.locator(".plugin-row")).toHaveCount(0);
    await expect(editor.getByText("No plugin matches “nothing like it”.")).toBeVisible();
    await search.press("Escape");
    await expect(search).toHaveValue("");
    await expect(editor).toBeVisible();
    await expect(editor.locator(".plugin-row")).toHaveCount(2);
  });

  await test.step("an open row is named by its plugin, says what it holds, and shows the tools the plugin gives the agent", async () => {
    const disclose = editor.getByRole("group", { name: "Board", exact: true }).getByRole("button", { name: "Board", exact: true });
    await expect(disclose).toHaveAccessibleDescription("Hand over to: None · Hand over model: Agent's default");
    const board = await openPluginRow(editor, "Board");
    await expect(board.getByText("Tools it gives the agent")).toBeVisible();
    await expect(board.locator(".plugin-tools code").first()).toHaveText("show_card");
  });

  const meter = await openPluginRow(editor, "Meter");
  await test.step("the row's switch is the toggle plugin.json makes the plugin's switch: on, the settings that wait for it show, without it", async () => {
    await pluginSwitch(editor, "Meter").check();
    await expect(editor.getByText("2 of 2 on")).toBeVisible();
    await expect(unsavedMarkOf(editor, "Meter")).toBeVisible();
    await expect(meter.getByLabel("Profile Uses the meter")).toHaveCount(0);
    await expect(summaryOf(editor, "Meter")).toHaveText("Meter URL: https://meter.test · Meter tier: Basic · Total on the statusline: on");
    await pluginSwitch(editor, "Meter").uncheck();
    await expect(unsavedMarkOf(editor, "Meter"), "a switch back where it was is nothing to save").toHaveCount(0);
    await pluginSwitch(editor, "Meter").check();
  });

  await test.step("an empty setting says it reads the Launch environment's variable, or that Launch doesn't give it", async () => {
    const url = meter.getByLabel("Profile Meter URL");
    await expect(url).toHaveAttribute("placeholder", "https://meter.test");
    await expect(meter.getByText("From Launch environment")).toBeVisible();
    await expect(meter.getByText("Empty, so it uses METER_URL from the Launch environment.")).toBeVisible();
    await expect(meter.getByText("Not in Launch")).toBeVisible();
    await expect(meter.getByText("This profile's Launch environment unsets METER_KEY, so the plugin gets nothing.")).toBeVisible();
    await expect(meter.getByText(/Mirador keeps it with this profile on this computer/)).toBeVisible();
  });

  await test.step("text typed over the Launch value goes back to it with Use Launch value", async () => {
    const url = meter.getByLabel("Profile Meter URL");
    await url.fill("https://typed.test");
    await expect(meter.getByText("From Launch environment")).toHaveCount(0);
    await expect(summaryOf(editor, "Meter")).toHaveText("Meter URL: https://typed.test · Meter tier: Basic · Total on the statusline: on");
    await meter.getByRole("button", { name: "Use the Launch value for Meter URL" }).click();
    await expect(url).toHaveValue("");
    await expect(meter.getByText("From Launch environment")).toBeVisible();
  });

  await test.step("$NAME reads another variable of the Launch environment", async () => {
    await meter.getByLabel("Profile Meter key").fill("$METER_URL");
    await expect(meter.getByText("Reads METER_URL from the Launch environment.")).toBeVisible();
    await meter.getByLabel("Profile Meter key").fill("");
  });

  await editor.getByRole("button", { name: "Save" }).click();
  await expect(editor.locator(".saved")).toHaveText("Saved");
  await expect(unsavedMarkOf(editor, "Meter")).toHaveCount(0);
});

test("a plugin turned off for a profile gives its conversations none of its tools, statusline or commands, and turned on again gives them back", async ({ page }) => {
  await signIn(page, host);
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${PROFILE} · opencode` });
  const conversationId = await startConversation(page, { withModels: false });
  await sendMessage(page, "USAGE 100 1000 3.5");
  await waitForTurnToEnd(page);
  const meterChips = page.getByRole("region", { name: "Statusline" }).getByRole("group", { name: "Meter" });

  await test.step("on, the agent has the plugin's tools, the statusline its chips and the slash menu its commands", async () => {
    await expect(meterChips.locator(".plugin-chip")).toHaveText(["⏱", "Total basic", "Session $1.25"]);
    expect(await canvasToolNames(host, conversationId)).toContain("show_card");
    await expectSlashMenuOffers(page, "/board:show_card", true);
  });

  await test.step("turned off, the row says so, the tally counts it out, and it waits to be saved", async () => {
    const profiles = await editPlugins(page);
    await pluginSwitch(profiles, "Board").uncheck();
    await pluginSwitch(profiles, "Meter").uncheck();
    await expect(summaryOf(profiles, "Board")).toHaveText("Off for this profile");
    await expect(unsavedMarkOf(profiles, "Board")).toBeVisible();
    await expect(profiles.getByText("0 of 2 on")).toBeVisible();
    const board = await openPluginRow(profiles, "Board");
    await expect(board.getByText("Turn on Board to use it in this profile's conversations.")).toBeVisible();
    await expect(board.getByText("Tools it would give the agent")).toBeVisible();
    await expect(board.getByLabel("Profile Hand over to")).toHaveCount(0);
    await saveAndClose(profiles);
  });

  await test.step("saved, the conversation already running loses them, and a command typed out is refused", async () => {
    await expect(meterChips).toHaveCount(0);
    await expect.poll(() => canvasToolNames(host, conversationId)).not.toContain("show_card");
    await expectSlashMenuOffers(page, "/board:show_card", false);
    const composer = page.locator(".composer:visible textarea");
    await composer.fill('/board:show_card title="Off" text=Off');
    await composer.press("Enter");
    await expect(page.locator(".composer-problem:visible")).toContainText(`Board is off for the profile ${PROFILE}. Turn it on in Profiles › Plugins.`);
    await page.locator(".composer-problem:visible").getByRole("button", { name: "Dismiss" }).click();
    await composer.fill("");
  });

  await test.step("turned on again and saved, they come back", async () => {
    const profiles = await editPlugins(page);
    await pluginSwitch(profiles, "Board").check();
    await expect(profiles.getByLabel("Profile Hand over to"), "a plugin turned on opens to its settings").toBeVisible();
    await pluginSwitch(profiles, "Meter").check();
    await expect(profiles.getByText("2 of 2 on")).toBeVisible();
    await saveAndClose(profiles);
    await expect(meterChips.locator(".plugin-chip")).toHaveText(["⏱", "Total basic", "Session $1.25"]);
    await expect.poll(() => canvasToolNames(host, conversationId)).toContain("show_card");
    await expectSlashMenuOffers(page, "/board:show_card", true);
  });
});
