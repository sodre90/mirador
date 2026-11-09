import { expect, test, type Locator } from "@playwright/test";
import { openProfiles, openProfileTab, signIn } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();

test.beforeAll(() => host.start());
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const unsavedMarkOn = (element: Locator) => element.getByRole("img", { name: "Unsaved changes" });
const tabOf = (dialog: Locator, name: "Launch" | "Defaults") => dialog.getByRole("tab", { name });
const seededProfile = (dialog: Locator) => dialog.locator(".profile-list li", { hasText: "Claude Code" });
const newProfile = (dialog: Locator) => dialog.locator(".profile-list li", { hasText: "+ New profile" });

test("in a short window only the open tab scrolls: the header, the profile list and Save stay in reach", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 420 });
  await signIn(page, host);
  const dialog = await openProfiles(page);
  const panels = dialog.locator(".profile-panels");
  const alwaysInReach = [dialog.getByRole("button", { name: "Close" }), seededProfile(dialog), dialog.getByRole("button", { name: "Save" }), tabOf(dialog, "Launch")];

  await dialog.getByRole("button", { name: "Edit environment" }).click();
  expect(await panels.evaluate((element) => element.scrollHeight > element.clientHeight), "the tab's fields need more room than the window has").toBe(true);
  for (const control of alwaysInReach) await expect(control).toBeInViewport({ ratio: 1 });

  await dialog.getByLabel("Pre-launch command").scrollIntoViewIfNeeded();
  expect(await panels.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  expect(await dialog.evaluate((element) => element.scrollHeight <= element.clientHeight), "the dialog itself has nothing to scroll").toBe(true);
  for (const control of alwaysInReach) await expect(control).toBeInViewport({ ratio: 1 });

  await test.step("the note about restarting the agent shows only once the environment or pre-launch command changed", async () => {
    const restartNote = dialog.getByText("restarts this profile's agent");
    await expect(restartNote).toHaveCount(0);
    await openProfileTab(dialog, "Defaults");
    await dialog.getByLabel("Profile YOLO").check();
    await expect(restartNote).toHaveCount(0);
    await openProfileTab(dialog, "Launch");
    await dialog.getByLabel("Pre-launch command").fill("true");
    await expect(restartNote).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Save" })).toBeInViewport({ ratio: 1 });
    await dialog.getByLabel("Pre-launch command").fill("");
    await expect(restartNote).toHaveCount(0);
  });
});

test("a profile's fields sit on Launch and Defaults tabs, with their explanations on hover", async ({ page }) => {
  await signIn(page, host);
  const dialog = await openProfiles(page);

  await test.step("Launch opens first: the name, the colour, the environment and the pre-launch command, under the profile's name and agent", async () => {
    await expect(dialog.locator(".profile-heading")).toHaveText("Claude CodeClaude Code");
    await expect(tabOf(dialog, "Launch")).toHaveAttribute("aria-selected", "true");
    await expect(dialog.getByLabel("Profile name")).toBeVisible();
    await expect(dialog.getByRole("radiogroup", { name: "Profile colour" })).toBeVisible();
    await expect(dialog.getByLabel("Environment (secrets hidden)")).toBeVisible();
    await expect(dialog.getByLabel("Pre-launch command")).toBeVisible();
    await expect(dialog.getByLabel("Profile agent"), "a saved profile's agent is in the heading, not in a field").toHaveCount(0);
    await expect(dialog.getByLabel("Profile questions")).toBeHidden();
    await expect(dialog.locator("label", { hasText: "Pre-launch command" })).toHaveText("Pre-launch command");
    await expect(dialog.locator("label", { hasText: "Pre-launch command" })).toHaveAttribute("data-hint", /^Optional\. Runs with your shell/);
  });

  await test.step("the environment's format is behind Format", async () => {
    await expect(dialog.getByText("One per line")).toBeHidden();
    await dialog.getByText("Format", { exact: true }).click();
    await expect(dialog.getByText("One per line")).toBeVisible();
  });

  await test.step("Defaults holds what a conversation starts with, YOLO by its short name", async () => {
    await openProfileTab(dialog, "Defaults");
    await expect(tabOf(dialog, "Defaults")).toHaveAttribute("aria-selected", "true");
    await expect(dialog.getByText("What a new conversation on this profile starts with.")).toBeVisible();
    await expect(dialog.getByLabel("Profile questions")).toBeVisible();
    await expect(dialog.getByLabel("Profile idle compaction")).toBeVisible();
    await expect(dialog.getByLabel("Profile name")).toBeHidden();
    const yolo = dialog.locator("label.checkbox", { hasText: "YOLO" });
    await expect(yolo).toHaveText("YOLO");
    await expect(yolo).toHaveAttribute("data-hint", /^Approve whatever the agent asks permission for/);
    await yolo.hover();
    await expect(page.locator(".hint-bubble")).toContainText("Approve whatever the agent asks permission for");
  });

  await test.step("a new profile picks its agent on Launch, and the tab stays the one last opened", async () => {
    await newProfile(dialog).click();
    await expect(tabOf(dialog, "Defaults")).toHaveAttribute("aria-selected", "true");
    await expect(dialog.locator(".profile-heading")).toHaveText("New profileClaude Code");
    await openProfileTab(dialog, "Launch");
    await expect(dialog.getByLabel("Profile agent")).toBeVisible();
  });
});

test("unsaved edits mark their tab and their profile, stay while another profile is open, and closing asks before dropping them", async ({ page }) => {
  await signIn(page, host);
  const dialog = await openProfiles(page);
  const closeQuestion = dialog.getByRole("alertdialog", { name: "Unsaved changes" });

  await test.step("an edit marks the tab it is on", async () => {
    await expect(unsavedMarkOn(dialog)).toHaveCount(0);
    await dialog.getByLabel("Profile name").fill("Renamed");
    await expect(unsavedMarkOn(tabOf(dialog, "Launch"))).toHaveCount(1);
    await expect(unsavedMarkOn(tabOf(dialog, "Defaults"))).toHaveCount(0);
    await openProfileTab(dialog, "Defaults");
    await dialog.getByLabel("Profile YOLO").check();
    await expect(unsavedMarkOn(tabOf(dialog, "Defaults"))).toHaveCount(1);
  });

  await test.step("another profile opens with the edits kept and marked in the list", async () => {
    await newProfile(dialog).click();
    await expect(unsavedMarkOn(seededProfile(dialog))).toHaveCount(1);
    await expect(unsavedMarkOn(newProfile(dialog))).toHaveCount(0);
    await openProfileTab(dialog, "Launch");
    await dialog.getByLabel("Profile name").fill("Draft");
    await expect(unsavedMarkOn(newProfile(dialog))).toHaveCount(1);
    await seededProfile(dialog).click();
    await expect(dialog.getByLabel("Profile name")).toHaveValue("Renamed");
    await openProfileTab(dialog, "Defaults");
    await expect(dialog.getByLabel("Profile YOLO")).toBeChecked();
    await newProfile(dialog).click();
    await openProfileTab(dialog, "Launch");
    await expect(dialog.getByLabel("Profile name")).toHaveValue("Draft");
  });

  await test.step("closing asks first, and Keep editing goes back to the edits", async () => {
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(closeQuestion).toContainText("Unsaved changes in Claude Code, New profile.");
    await closeQuestion.getByRole("button", { name: "Keep editing" }).click();
    await expect(closeQuestion).toHaveCount(0);
    await expect(dialog.getByLabel("Profile name")).toHaveValue("Draft");
    await page.keyboard.press("Escape");
    await expect(closeQuestion).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(closeQuestion).toHaveCount(0);
    await expect(dialog).toBeVisible();
  });

  await test.step("saving a profile takes its marks away, and the other's edits still hold the dialog open", async () => {
    await dialog.getByLabel("Profile name").fill("");
    await expect(unsavedMarkOn(newProfile(dialog))).toHaveCount(0);
    await seededProfile(dialog).click();
    await dialog.getByLabel("Profile name").fill("Claude Code");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog.locator(".saved")).toHaveText("Saved");
    await expect(unsavedMarkOn(dialog)).toHaveCount(0);
    await openProfileTab(dialog, "Defaults");
    await expect(dialog.getByLabel("Profile YOLO")).toBeChecked();
    await dialog.getByLabel("Profile YOLO").uncheck();
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(unsavedMarkOn(dialog)).toHaveCount(0);
  });

  await test.step("Discard and close drops the edits", async () => {
    await openProfileTab(dialog, "Launch");
    await dialog.getByLabel("Profile name").fill("Thrown away");
    await dialog.getByRole("button", { name: "Close" }).click();
    await closeQuestion.getByRole("button", { name: "Discard and close" }).click();
    await expect(dialog).toHaveCount(0);
    const reopened = await openProfiles(page);
    await expect(reopened.getByLabel("Profile name")).toHaveValue("Claude Code");
    await expect(unsavedMarkOn(reopened)).toHaveCount(0);
    await reopened.getByRole("button", { name: "Close" }).click();
    await expect(reopened).toHaveCount(0);
  });
});
