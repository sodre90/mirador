import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { FakeClaudeApi, subscriptionEnvironment } from "./fake-claude-api.ts";
import { addWorkspace, createProfile, lastAgentMessage, sendMessage, signIn, startConversation, waitForTurnToEnd } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();
const api = new FakeClaudeApi();
const PROFILE = "stoppable";
const halfMade = join(host.projectDir, "half-made.txt");

const git = (...args: string[]) =>
  execFileSync("git", ["-C", host.projectDir, "-c", "user.name=e2e", "-c", "user.email=e2e@localhost", ...args], { encoding: "utf8" }).trim();

// The second test goes on in the conversation the first one leaves.
test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  api.limited = false;
  await api.start();
  await host.start();
  git("init", "-q");
  git("add", "-A");
  git("commit", "-qm", "the project as it was");
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
  api.stop();
});

const composer = (page: Page) => page.locator(".composer:visible textarea");
const editingBar = (page: Page) => page.locator(".editing-stopped");
const userMessages = (page: Page) => page.locator(".timeline:visible .message.user");

async function answer(page: Page, task: string) {
  await sendMessage(page, task);
  await expect(lastAgentMessage(page)).toHaveText(`Answered: ${task}`, { timeout: 120_000 });
  await waitForTurnToEnd(page);
}

/** Sends the task and stops the agent while it waits on its reply, after `meanwhile` ran in the turn: the files are kept as the turn began once its message shows. */
async function stopWhileWorking(page: Page, task: string, meanwhile = () => {}) {
  api.hold();
  await sendMessage(page, task);
  await expect(page.locator(".composer:visible .stop")).toBeVisible();
  await expect(userMessages(page).last()).toHaveText(task);
  await expect.poll(() => api.held.includes(task), { timeout: 60_000 }).toBe(true);
  meanwhile();
  await composer(page).press("Escape");
  await waitForTurnToEnd(page);
  api.answerHeld();
}

/** What the agent's own history held when it answered this task, as the request that carried it shows. */
const historyOf = (task: string) => api.history.findLast((messages) => messages.join("\n").includes(task))!.join("\n");

test("↑ after stopping an answer edits the stopped message, and Enter replaces it, its answer and the files it changed", async ({ page }) => {
  test.setTimeout(300_000);
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, PROFILE, subscriptionEnvironment(api));
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${PROFILE} · Claude Code` });
  await startConversation(page);
  await answer(page, "First task");

  await stopWhileWorking(page, "Paint it red", () => writeFileSync(halfMade, "made before the stop\n"));
  await composer(page).press("ArrowUp");
  await expect(composer(page)).toHaveValue("Paint it red");
  await expect(editingBar(page)).toHaveText("Editing your stopped message. Enter replaces it and its answer, and puts back any files it changed; Esc keeps them.");

  await composer(page).fill("Paint it blue");
  await expect(editingBar(page)).toBeVisible();
  await composer(page).press("Enter");
  await expect(lastAgentMessage(page)).toHaveText("Answered: Paint it blue", { timeout: 120_000 });
  await waitForTurnToEnd(page);

  await expect(userMessages(page)).toHaveText(["First task", "Paint it blue"]);
  await expect(editingBar(page)).toHaveCount(0);
  expect(existsSync(halfMade)).toBe(false);
  expect(historyOf("Paint it blue")).toContain("First task");
  expect(historyOf("Paint it blue")).not.toContain("Paint it red");
});

test("Esc keeps the stopped message, and the edit goes out as a new message after it", async ({ page }) => {
  test.setTimeout(300_000);
  await signIn(page, host);
  await page.locator(".workspace li").first().click();
  await page.locator(".conversation-title").first().click();
  await expect(userMessages(page)).toHaveText(["First task", "Paint it blue"]);

  await stopWhileWorking(page, "Paint it green");
  await composer(page).press("ArrowUp");
  await expect(editingBar(page)).toBeVisible();
  await composer(page).press("Escape");
  await expect(editingBar(page)).toHaveCount(0);
  await expect(composer(page)).toHaveValue("Paint it green");

  await composer(page).fill("Paint it yellow");
  await composer(page).press("Enter");
  await expect(lastAgentMessage(page)).toContainText("Paint it yellow", { timeout: 120_000 });
  await waitForTurnToEnd(page);
  await expect(userMessages(page)).toHaveText(["First task", "Paint it blue", "Paint it green", "Paint it yellow"]);
  expect(historyOf("Paint it yellow")).toContain("Paint it green");
});
