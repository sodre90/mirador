import { realpathSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { FakeClaudeApi, subscriptionEnvironment } from "./fake-claude-api.ts";
import { addWorkspace, createProfile, lastAgentMessage, sendMessage, signIn, startConversation, waitForTurnToEnd } from "./helpers.ts";
import { ScriptedModel, forgetPiAcpSessionsUnder, piProgram, scriptedPiEnvironment } from "./scripted-model.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();
const api = new FakeClaudeApi();
const model = new ScriptedModel();
const CLAUDE_PROFILE = "fake claude";
const PI_PROFILE = "scripted pi";
let page: Page;
let claudeOriginalId = "";

test.describe.configure({ mode: "serial" });
test.beforeAll(async ({ browser }) => {
  api.limited = false;
  await api.start();
  await model.start();
  await host.start();
  page = await browser.newPage();
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
});
test.afterAll(async () => {
  await page.close();
  await host.stop();
  forgetPiAcpSessionsUnder(realpathSync(host.root));
  forgetPiAcpSessionsUnder(host.root);
  await host.cleanUp();
  api.stop();
  model.stop();
});

const header = () => page.locator(".chat-header:visible");
const forkButton = () => header().getByRole("button", { name: "Fork", exact: true });
const userMessages = () => page.locator(".timeline:visible .message.user");
const agentMessages = () => page.locator(".timeline:visible .message.agent");
const openConversation = (conversationId: string) => page.evaluate((id) => (location.hash = `#/c/${id}`), conversationId);
const shownConversationId = () => page.url().match(/#\/c\/(.+)$/)![1]!;
const sidebarRow = (conversationId: string) => page.locator(`.workspace li[data-reorder-id="${conversationId}"]`);
const menuEntry = (name: string) => page.getByRole("menu").getByRole("menuitem", { name });

async function startOn(profile: string, environment: string, agent: string) {
  const dialog = await createProfile(page, profile, environment, "", agent);
  await dialog.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${profile} · ${agent}` });
  return startConversation(page);
}

/** Forks the shown conversation from its header and waits for the fork to open with its history replayed. */
async function forkFromHeader(originalId: string, firstMessage: string) {
  await forkButton().click();
  await expect(page).not.toHaveURL(new RegExp(`#/c/${originalId}$`));
  await expect(header().locator("h2")).toContainText("Fork: ");
  await expect(userMessages().filter({ hasText: firstMessage })).toHaveCount(1, { timeout: 60_000 });
  await waitForTurnToEnd(page);
  return shownConversationId();
}

test("forking a Claude Code conversation while its turn runs copies the finished turns into a new conversation, and the turn goes on in the original", async () => {
  test.setTimeout(300_000);
  const originalId = await startOn(CLAUDE_PROFILE, subscriptionEnvironment(api), "Claude Code");
  claudeOriginalId = originalId;
  await expect(forkButton()).toBeDisabled();
  await sendMessage(page, "First task");
  await expect(lastAgentMessage(page)).toHaveText("Answered: First task", { timeout: 120_000 });
  await waitForTurnToEnd(page);

  api.hold();
  await sendMessage(page, "Second task");
  await expect.poll(() => api.held.includes("Second task"), { timeout: 60_000 }).toBe(true);
  await expect(header().locator(".badge")).toHaveText("running");
  const forkId = await forkFromHeader(originalId, "First task");
  // Whether Claude Code had saved the running turn's message when it forked depends on timing; its answer it had not.
  await expect(userMessages().first()).toHaveText("First task");
  await expect(agentMessages().filter({ hasText: "Answered: First task" })).toHaveCount(1);
  await expect(agentMessages().filter({ hasText: "Answered: Second task" })).toHaveCount(0);

  api.answerHeld();
  await openConversation(originalId);
  await expect(lastAgentMessage(page)).toHaveText("Answered: Second task", { timeout: 120_000 });
  await waitForTurnToEnd(page);
  await expect(userMessages()).toHaveText(["First task", "Second task"]);

  await openConversation(forkId);
  await sendMessage(page, "In the fork");
  await expect(lastAgentMessage(page)).toHaveText("Answered: In the fork", { timeout: 120_000 });
  await waitForTurnToEnd(page);
  const forkHistory = api.history.findLast((messages) => messages.join("\n").includes("In the fork"))!.join("\n");
  expect(forkHistory).toContain("First task");
  expect(forkHistory).not.toContain("Answered: Second task");

  await openConversation(originalId);
  await expect(userMessages()).toHaveText(["First task", "Second task"]);
  await expect(agentMessages().filter({ hasText: "In the fork" })).toHaveCount(0);
});

test("the palette forks the open conversation too", async () => {
  const originalId = shownConversationId();
  await page.keyboard.press("Control+KeyK");
  await page.getByLabel("Search conversations and actions").fill("fork conversation");
  await page.getByRole("option").filter({ has: page.locator(".entry-label", { hasText: /^Fork conversation$/ }) }).click();

  await expect(page).not.toHaveURL(new RegExp(`#/c/${originalId}$`));
  await expect(header().locator("h2")).toContainText("Fork: ");
  await expect(userMessages()).toHaveText(["First task", "Second task"], { timeout: 60_000 });
});

test("forking a pi conversation while its turn runs leaves the message pi is on unanswered in the fork, and the turn goes on in the original", async () => {
  test.skip(piProgram() === null, "pi is not installed");
  test.setTimeout(300_000);
  const originalId = await startOn(PI_PROFILE, scriptedPiEnvironment(model, host.root), "pi");
  await sendMessage(page, "First turn");
  await waitForTurnToEnd(page);

  model.hold();
  await sendMessage(page, "Second turn");
  await expect(header().locator(".badge")).toHaveText("running");
  const forkId = await forkFromHeader(originalId, "First turn");
  await expect(userMessages()).toHaveText(["First turn", "Second turn"]);
  await expect(agentMessages()).toHaveCount(1);
  await expect(lastAgentMessage(page)).toContainText("Echo: First turn");

  model.answerHeld();
  await openConversation(originalId);
  await waitForTurnToEnd(page);
  await expect(lastAgentMessage(page)).toContainText("Echo: Second turn");
  await expect(userMessages()).toHaveText(["First turn", "Second turn"]);

  await openConversation(forkId);
  await expect(agentMessages()).toHaveCount(1);
  await sendMessage(page, "In the fork");
  await waitForTurnToEnd(page);
  await expect(lastAgentMessage(page)).toContainText("Echo: In the fork");
  expect(model.userMessagesInContext()).toEqual(["First turn", "Second turn", "In the fork"]);

  await openConversation(originalId);
  await expect(userMessages()).toHaveText(["First turn", "Second turn"]);
});

test("a conversation's right-click menu in the sidebar forks it while its turn runs, though another conversation is open", async () => {
  test.setTimeout(300_000);
  const freshId = await startConversation(page);
  await sidebarRow(freshId).click({ button: "right" });
  await expect(menuEntry("Fork conversation")).toBeDisabled();
  await page.keyboard.press("Escape");

  await openConversation(claudeOriginalId);
  api.hold();
  await sendMessage(page, "Third task");
  await expect.poll(() => api.held.includes("Third task"), { timeout: 60_000 }).toBe(true);
  await openConversation(freshId);

  await sidebarRow(claudeOriginalId).click({ button: "right" });
  await expect(menuEntry("Fork conversation")).toBeEnabled();
  await menuEntry("Fork conversation").click();
  await expect(page).not.toHaveURL(new RegExp(`#/c/(${freshId}|${claudeOriginalId})$`));
  await expect(header().locator("h2")).toContainText("Fork: ");
  await expect(agentMessages().filter({ hasText: "Answered: Second task" })).toHaveCount(1, { timeout: 60_000 });
  await waitForTurnToEnd(page);
  await expect(agentMessages().filter({ hasText: "Answered: Third task" })).toHaveCount(0);

  api.answerHeld();
  await openConversation(claudeOriginalId);
  await expect(lastAgentMessage(page)).toHaveText("Answered: Third task", { timeout: 120_000 });
  await waitForTurnToEnd(page);
  await expect(userMessages()).toHaveText(["First task", "Second task", "Third task"]);
});
