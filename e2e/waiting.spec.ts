import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { FakeClaudeApi, fakeClaudeEnvironment } from "./fake-claude-api.ts";
import { addWorkspace, answerCanvasQuestion, callCanvasTool, openCanvasHistory, openSettings, sendMessage, signIn, startConversation, waitForTurnToEnd } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const api = new FakeClaudeApi();
const host = new TestHost({ environment: () => fakeClaudeEnvironment(api) });

test.beforeAll(async () => {
  api.limited = false;
  await api.start();
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
  api.stop();
});

/** The agent waits on its question until it is answered, so the call is left running. */
const askInBackground = (conversationId: string, question: string) =>
  void callCanvasTool(host, conversationId, "ask", { question, options: [{ label: "Yes" }, { label: "No" }] }).catch(() => {});

test("the sidebar marks the conversations waiting for you, in the look chosen in Settings", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const first = await startConversation(page);
  const second = await startConversation(page);
  const firstRow = page.locator(`.workspace li[data-reorder-id="${first}"]`);
  const secondRow = page.locator(`.workspace li[data-reorder-id="${second}"]`);
  const firstPill = firstRow.locator(".waiting-pill");
  const count = page.locator(".workspace .waiting-count");
  const waitingList = page.getByRole("region", { name: "Waiting for you" });

  await test.step("a question in another conversation marks it as needing you, and the workspace counts it", async () => {
    askInBackground(first, "Which layout?");
    await expect(firstPill).toHaveText("Needs you");
    await expect(firstPill).toHaveAttribute("data-hint", /question on the canvas/);
    await expect(count).toHaveText("1");
    await expect(secondRow.locator(".waiting-pill")).toHaveCount(0);
    await expect(waitingList).toBeHidden();
  });

  await test.step("Settings switch to the dot alone, or to pills with a list of everything waiting on top", async () => {
    const look = (await openSettings(page)).getByRole("radiogroup", { name: "Waiting for you" });
    await look.getByRole("radio", { name: "Dot only" }).click();
    await expect(firstPill).toBeHidden();
    await expect(count).toBeHidden();
    await expect(firstRow.locator(".dot.waiting.tone-decision")).toBeVisible();
    await look.getByRole("radio", { name: "Pills and a list on top" }).click();
    await page.keyboard.press("Escape");
    await expect(firstPill).toBeVisible();
    await expect(waitingList.locator("li")).toHaveCount(1);
    await expect(waitingList.locator(".waiting-workspace")).toHaveText("project");
  });

  await test.step("the list opens the conversation, and answering clears the marks", async () => {
    await waitingList.locator("li").click();
    await expect(page).toHaveURL(new RegExp(`#/c/${first}$`));
    await answerCanvasQuestion(page, "Yes");
    await expect(firstPill).toHaveCount(0);
    await expect(count).toHaveCount(0);
    await expect(waitingList).toHaveCount(0);
  });

  await test.step("a permission request needs you, and a turn that ends while you watch is not marked", async () => {
    await sendMessage(page, `WRITE ${join(host.projectDir, "hello.txt")} hi`);
    await expect(firstPill).toHaveText("Needs you");
    await expect(firstPill).toHaveAttribute("data-hint", /approve a tool/);
    await page.locator(".permission.pending button.option-allow_once").click();
    await waitForTurnToEnd(page);
    await expect(firstPill).toHaveCount(0);
  });

  await test.step("a turn that ends while you look elsewhere is done until you open the conversation, also after a host restart", async () => {
    api.hold();
    await sendMessage(page, "Reply with just the word OK.");
    await secondRow.click();
    api.answerHeld();
    await expect(firstPill).toHaveText("Done");
    await expect(count).toHaveClass(/tone-done/);
    await expect(waitingList.locator("li")).toHaveCount(1);
    await page.reload();
    await expect(firstPill).toHaveText("Done");
    await host.restart();
    await expect(firstPill).toHaveText("Done", { timeout: 30_000 });
    await firstRow.click();
    await expect(firstPill).toHaveCount(0);
    await expect(waitingList).toHaveCount(0);
  });

  await test.step("a host restart takes back a question whose blocked tool call died with it, and keeps one meant for the next message", async () => {
    askInBackground(first, "Which layout now?");
    await expect(firstPill).toHaveText("Needs you");
    await secondRow.click();
    await page.getByLabel("Questions").filter({ visible: true }).selectOption("next-message");
    askInBackground(second, "Which name?");
    const secondPill = secondRow.locator(".waiting-pill");
    await expect(secondPill).toHaveText("Needs you");
    await host.restart();
    await expect(secondPill).toHaveText("Needs you", { timeout: 30_000 });
    await expect(firstPill).toHaveCount(0);
    await firstRow.click();
    const history = await openCanvasHistory(page);
    await expect(history.locator(".history-entry", { hasText: "Which layout now?" })).toContainText("withdrawn");
    await expect(waitingList.locator("li")).toHaveCount(1);
  });
});
