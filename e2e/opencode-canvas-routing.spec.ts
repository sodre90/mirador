import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, createProfile, sendMessage, signIn, startConversation, waitForTurnToEnd } from "./helpers.ts";
import { ScriptedModel, scriptedOpencodeEnvironment } from "./scripted-model.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();
const model = new ScriptedModel();
const PROFILE = "scripted opencode";

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

async function startedConversation(page: Page) {
  const conversationId = await startConversation(page);
  await sendMessage(page, "hello");
  await waitForTurnToEnd(page);
  return conversationId;
}

test("each opencode conversation on one agent gets its own canvas calls, and its subagents' too", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const dialog = await createProfile(page, PROFILE, scriptedOpencodeEnvironment(model, host.root), "", "opencode");
  await dialog.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${PROFILE} · opencode` });
  const first = await startedConversation(page);
  const second = await startedConversation(page);

  await open(page, first);
  await sendMessage(page, "SHOW Page of the first");
  await expect(shownTitle(page)).toHaveText("Page of the first", { timeout: 60_000 });
  await waitForTurnToEnd(page);

  await open(page, second);
  await sendMessage(page, "SHOW Page of the second");
  await expect(shownTitle(page)).toHaveText("Page of the second", { timeout: 60_000 });
  await waitForTurnToEnd(page);

  await open(page, first);
  await expect(shownTitle(page)).toHaveText("Page of the first");
  await sendMessage(page, "DELEGATE SHOW Page from a subagent");
  await expect(shownTitle(page)).toHaveText("Page from a subagent", { timeout: 60_000 });
  await waitForTurnToEnd(page);

  const subagent = page.locator(".timeline .tool.subagent");
  await expect(subagent).toHaveCount(1);
  await expect(subagent.locator(".subagent-task")).toHaveText("Scripted subagent");
  await expect(subagent).toHaveClass(/subagent-done/);
  await expect(subagent.locator(".subagent-work .tool")).toHaveCount(1);
  await expect(subagent.locator(".subagent-work .message.agent")).toHaveCount(1);
  const subagentReply = ((await subagent.locator(".subagent-work .message.agent").textContent()) ?? "").trim();
  await expect(page.locator(".timeline:visible .message.agent:not(.subagent-work .message)").filter({ hasText: subagentReply })).toHaveText(/^Tool result: <subagent /);
});
