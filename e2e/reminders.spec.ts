import { expect, test, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { addWorkspace, createProfile, openSettings, primaryModifier, sendMessage, signIn } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

const host = new TestHost({ fakePrograms: true });
const agentLog = () => join(host.root, "agent.log");
const agentLogLines = () => (existsSync(agentLog()) ? readFileSync(agentLog(), "utf8").split("\n").filter(Boolean) : []);

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  // An opencode that closes and resumes sessions, logging each, so putting a conversation away can free its session.
  writeBunProgram(host.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"), {
    FAKE_ACP_PROMPTS: join(host.root, "prompts"),
    FAKE_ACP_RESUMES: "1",
    FAKE_ACP_LOG: agentLog(),
  });
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

async function startFakeConversation(page: Page) {
  const previousUrl = page.url();
  await page.getByRole("button", { name: "+ New conversation" }).click();
  await expect(page).not.toHaveURL(previousUrl);
  await expect(page.locator(".chat-header:visible .badge")).toHaveText("idle", { timeout: 30_000 });
  return page.url().match(/#\/c\/(.+)$/)![1]!;
}

async function typeInComposer(page: Page, text: string) {
  const composer = page.locator(".composer:visible textarea");
  await composer.fill(text);
  return composer;
}

test("a conversation can be put away or kept with a reminder, and comes back at its time", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, "fake turns", "", "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "fake turns · opencode" });
  const first = await startFakeConversation(page);
  const second = await startFakeConversation(page);
  const third = await startFakeConversation(page);
  const listed = page.locator(".workspace > ul > li");
  const row = (conversationId: string) => page.locator(`.workspace > ul > li[data-reorder-id="${conversationId}"]`);
  const laterGroup = page.locator(".later-group");
  const picker = page.getByRole("dialog", { name: "Remind me about this conversation" });
  const toast = page.locator(".reminder-toast");
  const banner = page.locator(".reminder-banner:visible");
  const modifier = await primaryModifier(page);

  await test.step("⌘⇧L then Enter puts the open conversation away until tomorrow morning, and the toast takes it back", async () => {
    await page.keyboard.press(`${modifier}+Shift+KeyL`);
    await expect(picker).toBeVisible();
    await expect(picker.getByRole("option", { name: /Tomorrow morning/ })).toHaveAttribute("aria-selected", "true");
    await expect(picker.getByRole("radio", { name: "Put away" })).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Enter");
    await expect(picker).toHaveCount(0);
    await expect(toast).toContainText(/Put away until (tomorrow|today) 0?9:00/);
    await expect(row(third)).toHaveCount(0);
    await expect(laterGroup.getByRole("button", { name: /Later \(1\)/ })).toBeVisible();
    await expect(page).not.toHaveURL(new RegExp(`#/c/${third}$`));
    await toast.getByRole("button", { name: "Undo" }).click();
    await expect(row(third)).toBeVisible();
    await expect(laterGroup).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`#/c/${third}$`));
  });

  await test.step("a reminder kept in the list shows as a chip and a banner with its note, until removed", async () => {
    await page.locator(".chat-header:visible .remind-conversation").click();
    await picker.getByLabel("When").fill("in 2 hours check CI");
    await expect(picker.locator(".reminder-preview")).toContainText("→");
    await picker.getByRole("radio", { name: "Keep in list" }).click();
    await picker.getByRole("button", { name: "Set reminder" }).click();
    await expect(toast).toContainText("Reminder set for");
    await expect(row(third).locator(".reminder-chip")).toContainText("⏰");
    await expect(banner).toContainText("Reminder for");
    await expect(banner).toContainText("“check CI”");
    await banner.getByRole("button", { name: "Remove reminder" }).click();
    await expect(row(third).locator(".reminder-chip")).toHaveCount(0);
    await expect(banner).toHaveCount(0);
  });

  await test.step("/later with a time puts the conversation away from the message box, and it stays away after a reload", async () => {
    await row(first).click();
    await sendMessage(page, "first steps");
    await expect(page.locator(".chat-header:visible .badge")).toHaveText("idle");
    await typeInComposer(page, "/later 0.1m pick up the e2e");
    await expect(page.locator(".reminder-command-preview:visible")).toContainText("Put away →");
    await page.locator(".composer:visible textarea").press("Enter");
    await expect(row(first)).toHaveCount(0);
    await laterGroup.getByRole("button", { name: /Later \(1\)/ }).click();
    await expect(laterGroup.locator("li")).toHaveCount(1);
  });

  await test.step("at its time it comes back at the top, marked unread, with the note in a banner until dismissed", async () => {
    await expect(listed.first()).toHaveAttribute("data-reorder-id", first, { timeout: 20_000 });
    await expect(laterGroup).toHaveCount(0);
    await expect(row(first).locator(".waiting-pill")).toHaveText("Unread");
    await row(first).click();
    await expect(banner).toContainText("You asked to come back to this at");
    await expect(banner).toContainText("“pick up the e2e”");
    await banner.getByRole("button", { name: "Dismiss" }).click();
    await expect(banner).toHaveCount(0);
  });

  await test.step("its agent session was let go of while it waited, and the next message picks the same session up again", async () => {
    const closed = agentLogLines().find((line) => line.includes(" closed "))?.split(" ").at(-1);
    expect(closed, agentLogLines().join("\n")).toBeTruthy();
    await sendMessage(page, "picking it up");
    await expect.poll(agentLogLines).toContain(`agent resumed ${closed}`);
    await expect(page.locator(".timeline:visible .message.user")).toHaveCount(2);
  });

  await test.step("/later without a time opens the picker with what was typed, and the reminder goes once you write again", async () => {
    await row(second).click();
    await typeInComposer(page, "/remind soon");
    await page.locator(".composer:visible textarea").press("Enter");
    await expect(picker).toBeVisible();
    await expect(picker.getByLabel("When")).toHaveValue("soon");
    await expect(picker.locator(".reminder-preview")).toContainText("isn't a time ahead");
    await expect(picker.getByRole("radio", { name: "Keep in list" })).toHaveAttribute("aria-checked", "true");
    await picker.getByLabel("When").fill("3h");
    await page.keyboard.press("Enter");
    await expect(row(second).locator(".reminder-chip")).toBeVisible();
    await sendMessage(page, "back to work");
    await expect(row(second).locator(".reminder-chip")).toHaveCount(0);
  });

  await test.step("the palette lists pending reminders and sets one for the open conversation", async () => {
    await row(third).click();
    await page.keyboard.press(`${modifier}+KeyK`);
    const palette = page.getByLabel("Search conversations and actions");
    await palette.fill("remind me");
    await palette.press("Enter");
    await expect(picker.getByRole("radio", { name: "Keep in list" })).toHaveAttribute("aria-checked", "true");
    await picker.getByRole("radio", { name: "Put away" }).click();
    await picker.getByRole("option", { name: /Next week/ }).click();
    await expect(row(third)).toHaveCount(0);
    await page.keyboard.press(`${modifier}+KeyK`);
    await palette.fill("reminder:");
    await expect(page.getByRole("option", { name: /Reminder: New conversation/ })).toBeVisible();
    await page.keyboard.press("Escape");
  });

  await test.step("Settings move what morning means", async () => {
    const settings = await openSettings(page, "Conversations");
    await settings.getByLabel("Morning starts at").fill("07:30");
    await settings.getByRole("button", { name: "Close" }).click();
    await row(first).click();
    await page.keyboard.press(`${modifier}+Shift+KeyL`);
    await expect(picker.getByRole("option", { name: /Tomorrow morning/ })).toContainText(/0?7:30/);
    await page.keyboard.press("Escape");
    await expect(picker).toHaveCount(0);
  });
});
