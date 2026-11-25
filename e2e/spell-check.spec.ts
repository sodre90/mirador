import { join } from "node:path";
import { expect, test } from "@playwright/test";
import type { DesktopMenu } from "../shared/desktop-menu.ts";
import { actAsDesktopApp, addWorkspace, createProfile, createRoom, openSettings, roomCard, signIn, startConversation } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

const host = new TestHost({ fakePrograms: true });

test.beforeAll(async () => {
  writeBunProgram(host.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"));
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const menu: DesktopMenu = { nonce: "nonce-1", items: [{ type: "normal", label: "Quit", action: "quit" }] };

test("in a browser, Check spelling sets spellcheck on the message boxes and no language list shows", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, "Fresh", "", "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await createRoom(page, "Launch", ["Fresh"]);
  const roomComposer = page.locator(".room-composer textarea");
  await expect(roomComposer).toHaveAttribute("spellcheck", "true");
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "Fresh · opencode" });
  await startConversation(page, { withModels: false });
  const composer = page.locator(".main-chat .composer textarea");
  await expect(composer).toHaveAttribute("spellcheck", "true");
  await composer.press("Alt+KeyB");
  const sideChatQuestion = page.locator(".side-chat:visible").getByLabel("Ask about this conversation…");
  await expect(sideChatQuestion).toHaveAttribute("spellcheck", "true");

  const settings = await openSettings(page, "Conversations");
  await expect(settings.getByText("Spelling languages")).toHaveCount(0);
  await settings.getByRole("checkbox", { name: "Check spelling" }).uncheck();
  await settings.getByLabel("Box").selectOption({ label: "Formats as you type" });
  await settings.getByRole("button", { name: "Close" }).click();
  await expect(page.locator(".main-chat .composer .formatted-box")).toHaveAttribute("spellcheck", "false");

  await openSettings(page, "Conversations");
  await settings.getByLabel("Box").selectOption({ label: "Plain text" });
  await settings.getByRole("button", { name: "Close" }).click();
  await expect(composer).toHaveAttribute("spellcheck", "false");
  await expect(sideChatQuestion).toHaveAttribute("spellcheck", "false");
  await roomCard(page, "Launch").click();
  await expect(roomComposer).toHaveAttribute("spellcheck", "false");
  await openSettings(page, "Conversations");
  await settings.getByLabel("Box").selectOption({ label: "Formats as you type" });
  await settings.getByRole("button", { name: "Close" }).click();
  await expect(page.locator(".room-composer .formatted-box")).toHaveAttribute("spellcheck", "false");
  await openSettings(page, "Conversations");
  await settings.getByLabel("Box").selectOption({ label: "Plain text" });
  await settings.getByRole("button", { name: "Close" }).click();

  await page.reload();
  await expect(composer).toHaveAttribute("spellcheck", "false");
});

test("in the desktop app, the chosen spelling languages and the switch go to the app", async ({ page }) => {
  const sentToDesktopApp = await actAsDesktopApp(page, menu);
  await signIn(page, host);
  const lastSpellCheck = async () => (await sentToDesktopApp()).filter((message) => message.type === "desktop-spell-check").at(-1);
  await expect.poll(lastSpellCheck).toMatchObject({ nonce: "nonce-1", enabled: true, languages: [] });

  const settings = await openSettings(page, "Conversations");
  await expect(settings.locator(".spell-check-languages")).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("mirador:desktop-spell-check-languages", { detail: ["en_US", "en_GB", "hu_HU"] })));
  const add = settings.getByLabel("Add a language…");
  await expect(add.locator("option")).toHaveText(["Add a language…", "United Kingdom", "United States", "Hungarian"]);
  await expect(add.locator("optgroup")).toHaveAttribute("label", "English");
  const addButton = settings.getByRole("button", { name: "Add", exact: true });
  const chips = settings.locator(".spell-check-language");
  await expect(addButton).toBeDisabled();

  await add.selectOption({ label: "Hungarian" });
  await expect(chips).toHaveCount(0);
  await addButton.click();
  await expect(chips).toHaveText(["Hungarian×"]);
  await expect(add).toHaveValue("");
  await expect.poll(lastSpellCheck).toMatchObject({ enabled: true, languages: ["hu_HU"] });

  await add.selectOption({ label: "United States" });
  await addButton.click();
  await expect(chips).toHaveText(["Hungarian×", "English (United States)×"]);
  await expect(add).toHaveValue("");
  await expect.poll(lastSpellCheck).toMatchObject({ languages: ["hu_HU", "en_US"] });

  await settings.getByRole("button", { name: "Remove Hungarian" }).click();
  await expect(chips).toHaveText(["English (United States)×"]);
  await expect.poll(lastSpellCheck).toMatchObject({ languages: ["en_US"] });

  await expect(addButton).toBeDisabled();
  await add.selectOption({ label: "United Kingdom" });
  await expect(chips).toHaveCount(1);
  await expect.poll(lastSpellCheck).toMatchObject({ languages: ["en_US"] });
  await addButton.focus();
  await page.keyboard.press("Enter");
  await expect(chips).toHaveText(["English (United States)×", "English (United Kingdom)×"]);
  await expect(add).toBeFocused();
  await expect(add).toHaveValue("");
  await expect(addButton).toBeDisabled();
  await expect.poll(lastSpellCheck).toMatchObject({ languages: ["en_US", "en_GB"] });

  await add.selectOption({ label: "Hungarian" });
  await addButton.click();
  await expect(add).toHaveCount(0);
  await expect(settings.getByRole("button", { name: "Remove Hungarian" })).toBeFocused();
  await expect.poll(lastSpellCheck).toMatchObject({ languages: ["en_US", "en_GB", "hu_HU"] });

  const search = settings.getByRole("searchbox", { name: "Search settings" });
  const found = settings.getByRole("region", { name: "Settings found" });
  await search.fill("Spelling languages");
  await expect(found.locator(".spell-check-languages")).toBeVisible();
  await search.fill("Hungarian");
  await expect(found.locator(".spell-check-languages")).toBeVisible();
  await search.fill("");
  await expect(found).toHaveCount(0);

  await settings.getByRole("checkbox", { name: "Check spelling" }).uncheck();
  await expect.poll(lastSpellCheck).toMatchObject({ enabled: false });
  await expect(settings.locator(".spell-check-languages")).toHaveCount(0);
});
