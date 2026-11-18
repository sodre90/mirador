import { cpSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, createProfile, lastAgentMessage, sendMessage, signIn, startConversation, waitForTurnToEnd } from "./helpers.ts";
import { ScriptedModel, scriptedOpencodeEnvironment } from "./scripted-model.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();
const model = new ScriptedModel();
const PROFILE = "scripted use_tool";
const boardFolder = join(host.dataDir, "plugins", "board");

/** The test board plugin, giving a line of summary so that it loads on request and its tools run through use_tool. */
function installBoardLoadingOnRequest() {
  cpSync(join(import.meta.dirname, "..", "tests", "fixtures", "canvas-plugins", "board"), boardFolder, { recursive: true });
  renameSync(join(boardFolder, "host.ts"), join(boardFolder, "board-host.ts"));
  writeFileSync(
    join(boardFolder, "host.ts"),
    `import board from "./board-host.ts";
export default { ...board, guidance: { ...board.guidance, summary: "cards on the canvas that the user can press; when the user asks for a card." } };
`,
  );
}

test.beforeAll(async () => {
  installBoardLoadingOnRequest();
  await model.start();
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
  model.stop();
});

const pageView = (page: Page) => page.frameLocator(".canvas-panel:visible .canvas-body > .canvas-frame.plugin iframe");

test("a scripted agent publishes a plugin item through use_tool, and the chat names the plugin", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const dialog = await createProfile(page, PROFILE, scriptedOpencodeEnvironment(model, host.root), "", "opencode");
  await dialog.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${PROFILE} · opencode` });
  await startConversation(page);
  await sendMessage(page, "hello");
  await waitForTurnToEnd(page);

  expect(model.toolDescription("use_tool")).toContain("Run a canvas tool that is not in your tool list");
  expect(model.toolDescription("show_card"), "the plugin's tools stay out of the tool list").toBeUndefined();
  expect(model.systemPromptInContext()).toContain("use_tool runs the canvas tools that are not in your tool list (show_card, change_card,");

  await sendMessage(page, 'CALL use_tool {"tool":"show_card"}');
  await waitForTurnToEnd(page);
  await expect(lastAgentMessage(page), "the describe call loads the plugin and answers with its schema").toContainText("Board is loaded.");
  await expect(lastAgentMessage(page)).toContainText("Show a card the user can press.");
  await expect(lastAgentMessage(page)).toContainText("Call use_tool again with tool");

  await sendMessage(page, 'CALL use_tool {"tool":"show_card","input":{"title":"Hello","text":"First"}}');
  await expect(pageView(page).locator("#title")).toHaveText("Hello", { timeout: 60_000 });
  await expect(pageView(page).locator("#text")).toHaveText("First (pressed 0 times)");
  await waitForTurnToEnd(page);
  await expect(page.locator(".timeline:visible .tool-title").filter({ hasText: "show_card" }).last()).toHaveText("Board · show_card");
});
