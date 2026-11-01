import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  addWorkspace,
  answerCanvasQuestion,
  lastAgentMessage,
  openCanvasHistory,
  openFromCanvasHistory,
  sendMessage,
  signIn,
  startConversation,
  waitForTurnToEnd,
} from "./helpers.ts";
import { FakeClaudeApi, fakeClaudeEnvironment } from "./fake-claude-api.ts";
import { TestHost } from "./test-host.ts";

const api = new FakeClaudeApi();
const host = new TestHost({ environment: () => fakeClaudeEnvironment(api) });
const CHOSEN_NAME = "Named by the user";
let page: Page;
const agentTitles: string[] = [];

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  api.limited = false;
  await api.start();
  await host.start();
  page = await browser.newPage();
  page.on("websocket", (socket) =>
    socket.on("framereceived", ({ payload }) => {
      const update = JSON.parse(String(payload)).event?.event?.update;
      if (update?.sessionUpdate === "session_info_update" && update.title) agentTitles.push(update.title);
    }),
  );
});

test.afterAll(async () => {
  await page.close();
  await host.stop();
  await host.cleanUp();
  api.stop();
});

test("starts a Claude Code conversation with the test model", async () => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  await startConversation(page);
  await expect(page.getByLabel("Model", { exact: true }).filter({ visible: true })).toHaveValue("haiku");
  await page.locator(".chat-header h2").getByText("New conversation").click();
  await page.getByLabel("Conversation name").fill(CHOSEN_NAME);
  await page.getByLabel("Conversation name").press("Enter");
  await expect(page.locator(".chat-header h2")).toHaveText(CHOSEN_NAME);
});

test("streams a reply and asks for permission in the browser", async () => {
  await sendMessage(page, `WRITE ${join(host.projectDir, "hello.txt")} hi`);
  const permission = page.locator(".permission.pending");
  await expect(permission).toBeVisible();
  await permission.locator("button.option-allow_once").click();
  await waitForTurnToEnd(page);
  expect(readFileSync(join(host.projectDir, "hello.txt"), "utf8")).toContain("hi");
  await expect(page.locator(".context-meter")).toHaveText(/^(<1|\d+)% · [\d.]+k? \/ (200k|1M)$/);
});

test("keeps the name the user chose when Claude Code titles the session", async () => {
  await expect.poll(() => agentTitles.length, { timeout: 60_000 }).toBeGreaterThan(0);
  expect(agentTitles[0]).not.toBe(CHOSEN_NAME);
  await expect(page.locator(".chat-header h2")).toHaveText(CHOSEN_NAME);
});

test("shows a page and returns an ask answer as the tool result", async () => {
  await sendMessage(
    page,
    [
      'CALL mcp__canvas__show {"title": "Greeting", "html": "<h1>Hello canvas</h1>"}',
      'CALL mcp__canvas__ask {"question": "Pick a color", "options": [{"label": "Red"}, {"label": "Blue"}]}',
    ].join("\n"),
  );
  await answerCanvasQuestion(page, "Blue");
  await expect(page.locator(".settled-note")).toHaveText("✓ Answer sent: “Blue”");
  await expect(page.locator(".settled-note")).toHaveClass(/done/);
  await waitForTurnToEnd(page);
  await expect(lastAgentMessage(page)).toContainText("Blue");
  await openFromCanvasHistory(page, "Pick a color");
  await expect(page.locator(".ask-answer")).toContainText("returned to the agent");

  await openFromCanvasHistory(page, "Greeting");
  await expect(page.locator(".canvas-panel:visible .canvas-frame.show iframe").contentFrame().getByRole("heading", { name: "Hello canvas" })).toBeVisible();
});

test("keeps the history across a page refresh", async () => {
  await page.reload();
  await expect(page.locator(".message.user").first()).toContainText("hello.txt");
  await expect((await openCanvasHistory(page)).locator(".history-entry", { hasText: "Pick a color" })).toContainText("→ Blue");
  await expect(lastAgentMessage(page)).toContainText("Blue");
});

test("resumes the agent session and canvas tools after a host restart", async () => {
  await host.restart();
  await expect(page.locator(".banner")).toHaveCount(0, { timeout: 30_000 });
  await page.getByLabel("Mode", { exact: true }).selectOption("acceptEdits");
  await sendMessage(page, 'CALL mcp__canvas__show {"title": "After restart", "html": "<p>The color was Blue</p>"}');
  await waitForTurnToEnd(page);
  expect(api.history.at(-1)!.join("\n"), "the resumed session still holds the answer").toContain("Blue");
  await expect(page.locator(".canvas-panel:visible .canvas-frame.show iframe").contentFrame().getByText("The color was Blue")).toBeVisible();
  await expect(page.getByLabel("Model", { exact: true }).filter({ visible: true })).toHaveValue("haiku");
  await expect(page.getByLabel("Mode", { exact: true })).toHaveValue("acceptEdits");
});

test("delivers an answer as the next message when the conversation is set to", async () => {
  await page.getByLabel("Questions").selectOption("next-message");
  await sendMessage(page, 'CALL mcp__canvas__ask {"question": "Pick a size", "options": [{"label": "Small"}, {"label": "Large"}]}');
  await expect(page.locator(".ask").getByRole("radio", { name: "Large" })).toBeVisible();
  await waitForTurnToEnd(page);
  await answerCanvasQuestion(page, "Large");
  await expect(page.locator(".message.user").last()).toContainText('My answer to your question "Pick a size": Large');
  await openFromCanvasHistory(page, "Pick a size");
  await expect(page.locator(".ask-answer")).toContainText("sent as your next message");
  await waitForTurnToEnd(page);
  expect(existsSync(join(host.dataDir, "state.sqlite"))).toBe(true);
});

test("a conversation that never got a message starts a fresh session after a host restart, without a failed resume", async () => {
  await startConversation(page);
  await expect(page.getByLabel("Model", { exact: true }).filter({ visible: true })).toHaveValue("haiku");
  await host.restart();
  await expect(page.locator(".banner")).toHaveCount(0, { timeout: 30_000 });
  await sendMessage(page, "Reply with only the word ready.");
  await waitForTurnToEnd(page);
  await expect(lastAgentMessage(page)).toContainText("ready");
  await expect(page.locator(".error-line")).toHaveCount(0);
});
