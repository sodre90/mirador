import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, answerCanvasQuestion, createProfile, lastAgentMessage, sendMessage, signIn, startConversation, waitForTurnToEnd } from "./helpers.ts";
import { antigravityProgram, ScriptedModel, scriptedAntigravityEnvironment } from "./scripted-model.ts";
import { TestHost } from "./test-host.ts";

/** Short enough to outlast in a test, long enough for the user to answer in time when they do. */
const ASK_WAIT_MS = 10_000;
const host = new TestHost({ environment: { MIRADOR_ANTIGRAVITY_ASK_WAIT_MS: String(ASK_WAIT_MS) } });
const model = new ScriptedModel();
const PROFILE = "scripted Antigravity";

test.beforeAll(async () => {
  await model.start();
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
  model.stop();
});

const open = (page: Page, conversationId: string) => page.locator(`li[data-reorder-id="${conversationId}"]`).click();
const shownTitle = (page: Page) => page.frameLocator(".canvas-panel:visible .canvas-frame.show iframe").locator("h1");

test.skip(antigravityProgram() === null, "Antigravity e2e runs only where the Antigravity CLI, agy, is installed");

async function startedConversation(page: Page) {
  const conversationId = await startConversation(page);
  await sendMessage(page, "hello");
  await waitForTurnToEnd(page);
  return conversationId;
}

test("each Antigravity conversation on one profile gets its own canvas pages and questions", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const dialog = await createProfile(page, PROFILE, scriptedAntigravityEnvironment(model, host.root), "", "Antigravity");
  await dialog.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${PROFILE} · Antigravity` });
  const first = await startedConversation(page);
  const second = await startedConversation(page);

  await open(page, second);
  await sendMessage(page, "SHOW Page of the second");
  await expect(shownTitle(page)).toHaveText("Page of the second", { timeout: 60_000 });
  await waitForTurnToEnd(page);

  await open(page, first);
  await expect(shownTitle(page)).toHaveCount(0);
  await sendMessage(page, "ASK Pick a colour");
  await answerCanvasQuestion(page, "Red");
  await waitForTurnToEnd(page);
  await expect(lastAgentMessage(page)).toContainText("Tool result:");
  await expect(lastAgentMessage(page)).toContainText("Red");

  await open(page, second);
  await expect(shownTitle(page)).toHaveText("Page of the second");
});
