import { cpSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { addWorkspace, createProfile, lastAgentMessage, sendMessage, signIn, startConversation, waitForTurnToEnd } from "./helpers.ts";
import { modelServerStatus } from "./model-server.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();
const boardFolder = join(host.dataDir, "plugins", "board");

/** The test board plugin, giving a line of summary so that it loads on request. */
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
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const pageView = (page: import("@playwright/test").Page) => page.frameLocator(".canvas-panel:visible .canvas-body > .canvas-frame.plugin iframe");

test.describe.configure({ mode: "serial" });

/** A turn with a plugin load and a tool call in it answers slowly on a shared runner. */
const REAL_MODEL_TURN = 420_000;

const askForACard = async (page: import("@playwright/test").Page) => {
  await sendMessage(page, 'Show me a card titled "Greeting" with the text "Hello board". Then reply with the single word DONE.');
  await waitForTurnToEnd(page, REAL_MODEL_TURN);
  await expect(pageView(page).locator("#title")).toHaveText("Greeting");
  await expect(pageView(page).locator("#text")).toHaveText("Hello board (pressed 0 times)");
  await expect(lastAgentMessage(page)).toContainText("DONE");
};

test("a real agent loads a plugin that loads on request, then runs its tool through use_tool in the same turn", async ({ page }) => {
  test.setTimeout(900_000);
  await expect.poll(modelServerStatus, { message: "the model server answers", timeout: 180_000, intervals: [5_000] }).toBe(200);
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  await startConversation(page);
  await askForACard(page);
});

test("with Claude Code's tool search on, the plugin's tools stay out of the tool list and run through use_tool", async ({ page }) => {
  test.setTimeout(900_000);
  await signIn(page, host);
  const profiles = await createProfile(page, "Tool search", "ENABLE_TOOL_SEARCH=true");
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "Tool search · Claude Code" });
  await startConversation(page);
  await askForACard(page);
  await expect(page.locator(".tool-title", { hasText: "Board · show_card" }).first()).toBeAttached();
});
