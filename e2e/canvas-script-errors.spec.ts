import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, callCanvasTool, createProfile, sendMessage, signIn } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

const host = new TestHost({ fakePrograms: true });
const promptsFile = join(host.root, "prompts");
const profileName = "page-maker";
const HIDDEN_THROW = "A script on the page threw an error; this browser hides its message.";

test.beforeAll(async () => {
  writeBunProgram(host.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"), { FAKE_ACP_PROMPTS: promptsFile });
  writeFileSync(promptsFile, "");
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

/** Everything the agent was given, in order; a prompt of several lines is written as it stands. */
const agentSaw = () => readFileSync(promptsFile, "utf8");
const status = (page: Page) => page.locator(".chat-header:visible .badge");
const canvasTitle = (page: Page) => page.locator(".canvas-header:visible .canvas-title");
const pageErrors = (page: Page) => page.locator(".canvas-frame.show .frame-errors li");
const selectInSidebar = (page: Page, conversationId: string) => page.locator(`[data-reorder-id="${conversationId}"]`).click();

/** The stub agent offers no model to pick, so this is `startConversation` without that wait. */
async function startConversationWithoutModel(page: Page) {
  const previousUrl = page.url();
  await page.getByRole("button", { name: "+ New conversation" }).click();
  await expect(page).not.toHaveURL(previousUrl);
  return page.url().match(/#\/c\/(.+)$/)![1]!;
}

async function sendAndWait(page: Page, text: string) {
  await sendMessage(page, text);
  await expect(status(page)).toHaveText("idle", { timeout: 60_000 });
}

async function startWithAgent(page: Page) {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, profileName, "", "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${profileName} · opencode` });
  const conversationId = await startConversationWithoutModel(page);
  await sendAndWait(page, "Start");
  return conversationId;
}

/** The page tells its frame's parent once it has rendered, and the canvas sends its report on the same socket as the next message. */
async function waitForPageToRender(page: Page, open: () => Promise<void>) {
  await page.evaluate(() => {
    const seen = window as unknown as { pageRendered?: boolean };
    seen.pageRendered = false;
    addEventListener("message", (event) => {
      if (event.data?.kind === "rendered") seen.pageRendered = true;
    });
  });
  await open();
  await page.waitForFunction(() => (window as unknown as { pageRendered?: boolean }).pageRendered);
}

test("a page's script errors reach the agent: one the browser hides says so, none comes twice, and a page nobody saw shown tells of them with the next message", async ({ page }) => {
  const conversationId = await startWithAgent(page);

  await test.step("a page shown to the user reports its errors in the tool's result", async () => {
    const assetsOrigin = `http://127.0.0.1:${host.port + 1}`;
    const html = `<p>Charts</p>
<script>draw("c1", [[[1, 2]]]], 200);</script>
<script src="${assetsOrigin}/three/addons/controls/OrbitControls.js"></script>`;

    const result = await callCanvasTool(host, conversationId, "show", { title: "Charts", html });

    const reported = result.split("\n").slice(1);
    expect(result).toContain("but the page reported errors:");
    expect(reported).toHaveLength(2);
    expect(reported[0]).toMatch(/^- Uncaught SyntaxError: .*missing \) after argument list/);
    expect(reported[1]).toBe(`- ${HIDDEN_THROW}`);
    await expect(pageErrors(page)).toHaveText([/SyntaxError: .*missing \) after argument list/, HIDDEN_THROW]);
  });

  await test.step("a page shown while nobody was viewing tells the agent what its first view found, once, with the next message", async () => {
    await startConversationWithoutModel(page);
    const html = `<p>Charts</p>\n<script>draw("c1", [[[1, 2]]]], 200);</script>`;

    let result = "";
    await expect.poll(async () => (result = await callCanvasTool(host, conversationId, "show", { title: "Unseen charts", html }))).toContain("Nobody is viewing");
    expect(result).toContain("if the page reports errors when the user opens it, you will hear of them with their next message.");
    const itemId = result.match(/as item ([\w-]+)\./)![1]!;

    await waitForPageToRender(page, () => selectInSidebar(page, conversationId));
    await expect(canvasTitle(page)).toHaveText("Unseen charts");
    await expect(pageErrors(page)).toHaveText([/SyntaxError: .*missing \) after argument list/]);

    await sendAndWait(page, "Carry on");
    expect(agentSaw()).toMatch(
      new RegExp(
        `The page "Unseen charts" \\(canvas item ${itemId}\\), shown while nobody was viewing, reported errors when the user opened it:\\n- Uncaught SyntaxError: [^\\n]*missing \\) after argument list[^\\n]*\\n\\nCarry on\\n`,
      ),
    );
    await expect(canvasTitle(page), "hearing of the errors leaves the canvas where the user had it").toHaveText("Unseen charts");

    await sendAndWait(page, "And on");
    expect(agentSaw().match(/shown while nobody was viewing/g)).toHaveLength(1);
  });
});
