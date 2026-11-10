import { realpathSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, createProfile, sendMessage, signIn, startConversation, waitForTurnToEnd } from "./helpers.ts";
import { ScriptedModel, forgetPiAcpSessionsUnder, piProgram, scriptedPiEnvironment } from "./scripted-model.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();
const model = new ScriptedModel();
const PROFILE = "scripted pi";

test.describe.configure({ mode: "serial" });
test.skip(piProgram() === null, "pi is not installed");

test.beforeAll(async () => {
  await model.start();
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  forgetPiAcpSessionsUnder(realpathSync(host.root));
  forgetPiAcpSessionsUnder(host.root);
  await host.cleanUp();
  model.stop();
});

const headerTitle = (page: Page) => page.locator(".chat-header:visible h2");
const sidebarTitle = (page: Page) => page.locator(".sidebar li.selected .conversation-title");

test("pi names its conversation once the first turn is done, and a name the user gives stays", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const dialog = await createProfile(page, PROFILE, scriptedPiEnvironment(model, host.root), "", "pi");
  await dialog.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${PROFILE} · pi` });
  await startConversation(page);

  await sendMessage(page, "Hello pi");
  await waitForTurnToEnd(page);
  await expect(sidebarTitle(page)).toHaveText("Hello pi");
  expect(model.systemPromptInContext()).toContain("title_conversation");

  await sendMessage(page, 'CALL mcp__canvas__title_conversation {"title": "Parser and lexer"}');
  await waitForTurnToEnd(page);
  await expect(sidebarTitle(page)).toHaveText("Parser and lexer");
  await expect(headerTitle(page)).toHaveText("Parser and lexer");

  await headerTitle(page).getByText("Parser and lexer").click();
  const field = page.getByLabel("Conversation name");
  await field.fill("My parser work");
  await field.press("Enter");
  await expect(sidebarTitle(page)).toHaveText("My parser work");

  await sendMessage(page, 'CALL mcp__canvas__title_conversation {"title": "Something else"}');
  await waitForTurnToEnd(page);
  await expect(sidebarTitle(page)).toHaveText("My parser work");
  await expect(headerTitle(page)).toHaveText("My parser work");
});
