import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, callCanvasTool, createProfile, openProfiles, sendMessage, signIn } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

const host = new TestHost({ fakePrograms: true });
const promptsFile = join(host.root, "prompts");
const agentLogFile = join(host.root, "agent-log");
const profileName = "wedged";

/** An opencode that is an agent of its own, taking prompts and never finishing them. */
function fakeOpencode() {
  writeBunProgram(host.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"), { FAKE_ACP_PROMPTS: promptsFile, FAKE_ACP_LOG: agentLogFile });
}

/** The prompts the agent was given, in the order they arrived. */
const prompts = () =>
  readFileSync(promptsFile, "utf8")
    .split("\n")
    .filter((text) => text !== "");

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  fakeOpencode();
  writeFileSync(promptsFile, "");
  writeFileSync(agentLogFile, "");
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const status = (page: Page) => page.locator(".chat-header:visible .badge");
const selectInSidebar = (page: Page, conversationId: string) => page.locator(`[data-reorder-id="${conversationId}"]`).click();

/** The stub agent offers no model to pick, so this is `startConversation` without that wait. */
async function startConversationWithoutModel(page: Page) {
  const previousUrl = page.url();
  await page.getByRole("button", { name: "+ New conversation" }).click();
  await expect(page).not.toHaveURL(previousUrl);
  return page.url().match(/#\/c\/(.+)$/)![1]!;
}

async function wedgedConversation(page: Page, text: string) {
  const conversationId = await startConversationWithoutModel(page);
  await sendMessage(page, text);
  await expect(status(page)).toHaveText("running", { timeout: 30_000 });
  return conversationId;
}

test("Stop offers to kill the agent process, and killing it leaves the other conversations on that profile running", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, profileName, "", "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${profileName} · opencode` });

  const stopped = await wedgedConversation(page, "WEDGE one");
  const sibling = await wedgedConversation(page, "WEDGE two");

  await selectInSidebar(page, stopped);
  const stop = page.locator(".composer:visible .stop");
  await stop.click();
  await expect(stop).toHaveText("Stopping…");

  await test.step("Esc again asks only once more, rather than killing the agent", async () => {
    await page.locator(".composer:visible textarea").focus();
    await page.keyboard.press("Escape");
    await expect(status(page)).toHaveText("running");
    await expect.poll(prompts, "the agent got both wedged messages, and no other").toHaveLength(2);
  });

  await expect(stop).toHaveText("Force stop", { timeout: 10_000 });
  await expect(status(page)).toHaveText("running");

  await stop.click();
  await expect(status(page)).toHaveText("idle", { timeout: 30_000 });
  await expect(page.locator(".timeline:visible")).toContainText("Turn ended: cancelled");
  await expect(page.locator(".timeline:visible .message.user")).toHaveCount(1);

  await expect.poll(() => prompts().filter((text) => text === "WEDGE two").length, { timeout: 30_000 }).toBe(2);
  await selectInSidebar(page, sibling);
  await expect(status(page)).toHaveText("running", { timeout: 30_000 });
});

const profilePicker = (page: Page) => page.getByLabel("Profile", { exact: true }).filter({ visible: true });
const timeline = (page: Page) => page.locator(".timeline:visible");
const sentTimes = (text: string) => prompts().filter((prompt) => prompt === text).length;

async function signInToWorkspace(page: Page) {
  await signIn(page, host);
  await page.locator(".workspace li").first().click();
}

/** A turn that runs until the file it waits for exists. */
async function sendTurnWaitingFor(page: Page, file: string) {
  await sendMessage(page, `WRITE ${JSON.stringify([{ waitFor: file }])}`);
  await expect(status(page)).toHaveText("running", { timeout: 30_000 });
}

/** Stop turns into Force stop when the agent has not answered it 3 s on. */
const PAST_FORCE_STOP_GRACE_MS = 3_500;

test("A turn that ends soon after Stop leaves the next turn's button as Stop, not Force stop", async ({ page }) => {
  await signInToWorkspace(page);
  await startConversationWithoutModel(page);
  const stop = page.locator(".composer:visible .stop");
  const firstTurnDone = join(host.root, "first-turn-done");
  const secondTurnDone = join(host.root, "second-turn-done");

  await sendTurnWaitingFor(page, firstTurnDone);
  await stop.click();
  await expect(stop).toHaveText("Stopping…");
  writeFileSync(firstTurnDone, "");
  await expect(status(page)).toHaveText("idle", { timeout: 30_000 });
  await page.waitForTimeout(PAST_FORCE_STOP_GRACE_MS);

  await sendTurnWaitingFor(page, secondTurnDone);
  await expect(stop).toHaveText("Stop");
  writeFileSync(secondTurnDone, "");
  await expect(status(page)).toHaveText("idle", { timeout: 30_000 });
});

test("A profile switch that the agent ignores the cancel of kills the agent after a while and continues the turn on the new profile", async ({ page }) => {
  await signInToWorkspace(page);
  const profiles = await createProfile(page, "spare", "", "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await wedgedConversation(page, "WEDGE before the switch");

  await profilePicker(page).selectOption({ label: "spare" });
  await expect(timeline(page)).toContainText("Turn ended: cancelled", { timeout: 30_000 });
  await expect(timeline(page)).toContainText("Now using the profile “spare”");
  await expect.poll(() => sentTimes("WEDGE before the switch"), { timeout: 30_000 }).toBe(2);
  await expect(status(page)).toHaveText("running");
  await expect(timeline(page).locator(".error-line")).toHaveCount(0);
});

test("A message sent while a profile switch opens the session on the new profile waits behind the turn it continues", async ({ page }) => {
  await signInToWorkspace(page);
  const profiles = await createProfile(page, "slow spare", "", "sleep 5", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${profileName} · opencode` });
  await wedgedConversation(page, "WEDGE before the slow switch");

  await profilePicker(page).selectOption({ label: "slow spare" });
  await expect(status(page)).toHaveText("starting", { timeout: 30_000 });
  const composer = page.locator(".composer:visible textarea");
  await composer.fill("sent during the switch");
  await composer.press("Enter");
  await expect(page.locator(".queue:visible .queued-text")).toHaveText("sent during the switch");

  await expect.poll(() => sentTimes("WEDGE before the slow switch"), { timeout: 30_000 }).toBe(2);
  await expect(status(page)).toHaveText("running");
  expect(sentTimes("sent during the switch")).toBe(0);
});

test("An agent process that dies in the middle of a turn ends it with one error that says so", async ({ page }) => {
  await signInToWorkspace(page);
  await startConversationWithoutModel(page);
  await sendMessage(page, "CRASH now");

  await expect(timeline(page).locator(".error-line")).toHaveText(/agent process exited with 1/, { timeout: 30_000 });
  await expect(status(page)).toHaveText("idle");
  await expect(timeline(page).locator(".error-line")).toHaveCount(1);
});

test("An agent process that dies while a process it started holds its output open still ends the turn", async ({ page }) => {
  await signInToWorkspace(page);
  await startConversationWithoutModel(page);
  await sendMessage(page, "CRASH LEAVING A CHILD");

  await expect(timeline(page).locator(".error-line")).toHaveText(/agent process exited with 1/, { timeout: 15_000 });
  await expect(status(page)).toHaveText("idle");
});

test("Saving a changed profile stops the turns its agent runs, as Stop does, and continues them on the restarted agent", async ({ page }) => {
  await signInToWorkspace(page);
  await wedgedConversation(page, "WEDGE before the edit");

  const dialog = await openProfiles(page);
  await dialog.locator(".profile-list li", { hasText: profileName }).click();
  await dialog.getByRole("button", { name: "Edit environment" }).click();
  await dialog.getByLabel("Environment", { exact: true }).fill("EDITED=1");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog.getByText("Saved")).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).click();

  await expect(timeline(page)).toContainText("Turn ended: cancelled", { timeout: 30_000 });
  await expect.poll(() => sentTimes("WEDGE before the edit"), { timeout: 30_000 }).toBe(2);
  await expect(status(page)).toHaveText("running");
  await expect(timeline(page).locator(".error-line")).toHaveCount(0);
});

/** What the agents with a FAKE_ACP_NAME did: started, changed an option, closed a session. */
const agentLog = () =>
  readFileSync(agentLogFile, "utf8")
    .split("\n")
    .filter((line) => line !== "");
const SLOW_ANSWER_MS = 12_000;

test("A profile switch goes on without an agent that doesn't answer: its options land once it answers, and Force stop ends the wait", async ({ page }) => {
  await signInToWorkspace(page);
  for (const [name, environment] of [
    ["answering", "FAKE_ACP_MODES=1\nFAKE_ACP_NAME=answering"],
    ["slow", `FAKE_ACP_MODES=1\nFAKE_ACP_NAME=slow\nFAKE_ACP_ANSWERS_AFTER_MS=${SLOW_ANSWER_MS}`],
  ]) {
    const profiles = await createProfile(page, name!, environment!, "", "opencode");
    await profiles.getByRole("button", { name: "Close" }).click();
  }
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "answering · opencode" });
  await startConversationWithoutModel(page);
  const option = (name: string) => page.getByLabel(name, { exact: true }).filter({ visible: true });
  await option("Mode").selectOption({ label: "Plan" });
  await option("Effort").selectOption({ label: "High" });
  await expect.poll(agentLog).toEqual(expect.arrayContaining(["answering set mode to plan", "answering set effort to high"]));

  await test.step("on an agent slow to answer, the switch stops waiting for the first change, and the picker follows once the agent answers", async () => {
    await profilePicker(page).selectOption({ label: "slow" });
    await expect(timeline(page).locator(".error-line")).toHaveText(
      "Mode is still default: the agent has not answered the change to plan for 10 seconds. It changes once the agent answers.",
      { timeout: 15_000 },
    );
    await expect(status(page)).toHaveText("idle");
    await expect(option("Mode")).toHaveValue("default");
    await expect(option("Mode")).toHaveValue("plan", { timeout: SLOW_ANSWER_MS });
    await expect(timeline(page).locator(".error-line")).toHaveCount(1);
  });

  await test.step("switching away waits only a few seconds for the slow agent to let go of its session", async () => {
    await profilePicker(page).selectOption({ label: "answering" });
    await expect(timeline(page)).toContainText("Now using the profile “answering”");
    await expect(status(page)).toHaveText("idle", { timeout: 10_000 });
    expect(agentLog().filter((line) => line.startsWith("slow closed"))).toEqual([]);
    await expect(option("Mode")).toHaveValue("plan");
    await option("Effort").selectOption({ label: "High" });
    await expect.poll(() => agentLog().filter((line) => line === "answering set effort to high").length).toBe(2);
  });

  await test.step("Force stop ends a switch that waits for the agent, and starts no other agent for the changes left", async () => {
    const slowStarts = () => agentLog().filter((line) => line === "slow started").length;
    expect(slowStarts()).toBe(1);
    const errorsBefore = await timeline(page).locator(".error-line").count();
    await profilePicker(page).selectOption({ label: "slow" });
    const stop = page.locator(".composer:visible .stop");
    await stop.click();
    await expect(stop).toHaveText("Force stop", { timeout: 5_000 });
    await stop.click();
    await expect(status(page)).toHaveText("idle", { timeout: 5_000 });
    await expect(timeline(page).locator(".error-line")).toHaveCount(errorsBefore + 1);
    await expect(timeline(page).locator(".error-line").last()).toHaveText("Could not set Mode to plan: The opencode (slow) agent process was force stopped.");
    expect(slowStarts()).toBe(1);
  });
});

test("Stop withdraws the question the turn waits on, and the canvas notes it plainly rather than as a success", async ({ page }) => {
  await signInToWorkspace(page);
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${profileName} · opencode` });
  const conversationId = await wedgedConversation(page, "WEDGE asking");
  void callCanvasTool(host, conversationId, "ask", { question: "Keep going?", options: [{ label: "Yes" }, { label: "No" }] }).catch(() => {});
  await expect(page.locator(".canvas-panel:visible .ask-option")).toHaveCount(2);

  await page.locator(".composer:visible .stop").click();
  const note = page.locator(".canvas-panel:visible .settled-note");
  await expect(note).toHaveText("The agent withdrew its question.");
  await expect(note).toHaveClass(/neutral/);
});
