import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, callCanvasTool, createProfile, primaryModifier, sendMessage, signIn } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

const host = new TestHost({ fakePrograms: true });
const profileName = "canvas-find";
const promptsFile = () => join(host.root, "prompts");

test.beforeAll(async () => {
  writeBunProgram(host.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"), { FAKE_ACP_PROMPTS: promptsFile() });
  writeFileSync(promptsFile(), "");
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const pageHtml = `<h1>Lighthouse log</h1>
<p>The keeper trims the lamp by harbour light.</p>
<p>Every harbour ship passes the keeper's door.</p>
<p>Keeper or not, the bell rings at every hour.</p>`;

const canvasPage = (page: Page) => page.locator(".canvas-panel:visible .canvas-frame.show iframe").contentFrame();
const findButton = (page: Page) => page.locator(".canvas-header:visible .page-find-toggle");
const findBar = (page: Page) => page.locator(".canvas-panel:visible .page-find");
const findInput = (page: Page) => findBar(page).locator("input");
const tally = (page: Page) => findBar(page).locator(".find-tally");
const conversationFindBar = (page: Page) => page.locator(".find-bar:visible");

/** The matches the page itself marks, as the highlight registry holds them. */
const markedMatches = (page: Page) =>
  canvasPage(page)
    .locator("body")
    .evaluate((body) => ((body.ownerDocument.defaultView ?? window) as Window & typeof globalThis).CSS.highlights?.get("mirador-find")?.size ?? 0);
const hasFindHighlights = (page: Page) =>
  canvasPage(page)
    .locator("body")
    .evaluate((body) => ((body.ownerDocument.defaultView ?? window) as Window & typeof globalThis).CSS.highlights?.has("mirador-find") ?? false);

async function startConversationWithoutModel(page: Page) {
  const previousUrl = page.url();
  await page.getByRole("button", { name: "+ New conversation" }).click();
  await expect(page).not.toHaveURL(previousUrl);
  return page.url().match(/#\/c\/(.+)$/)![1]!;
}

async function waitForIdle(page: Page) {
  await expect(page.locator(".chat-header:visible .badge")).toHaveText("idle", { timeout: 60_000 });
}

test("the user finds text on the page the agent showed, from the canvas bar's button or with ⌘F inside the page", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, profileName, "", "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${profileName} · opencode` });
  const conversationId = await startConversationWithoutModel(page);

  await test.step("the canvas bar holds no find button until a page is on it", async () => {
    await expect(findButton(page)).toHaveCount(0);
  });

  await sendMessage(page, "Start");
  await waitForIdle(page);
  await callCanvasTool(host, conversationId, "show", { title: "Lighthouse log", html: pageHtml });
  await expect(canvasPage(page).locator("h1")).toHaveText("Lighthouse log");

  await test.step("the button opens the bar; typing finds three matches, Enter steps to the next, Shift+Enter back, and a word that is not there says so", async () => {
    await expect(findButton(page)).toBeVisible();
    await findButton(page).click();
    await expect(findBar(page)).toBeVisible();
    await expect(findInput(page)).toBeFocused();
    await findInput(page).fill("keeper");
    await expect(tally(page)).toHaveText("1 of 3");
    await expect.poll(() => markedMatches(page)).toBe(3);
    await findInput(page).press("Enter");
    await expect(tally(page)).toHaveText("2 of 3");
    await findInput(page).press("Shift+Enter");
    await expect(tally(page)).toHaveText("1 of 3");
    await findInput(page).fill("dragon");
    await expect(tally(page)).toHaveText("No matches");
    await expect.poll(() => hasFindHighlights(page)).toBe(false);
  });

  await test.step("Aa makes the search match case, changing the count", async () => {
    await findInput(page).fill("keeper");
    await expect(tally(page)).toHaveText("1 of 3");
    await findBar(page).getByRole("button", { name: "Match case" }).click();
    await expect(tally(page)).toHaveText("1 of 2");
    await expect.poll(() => markedMatches(page)).toBe(2);
    await findBar(page).getByRole("button", { name: "Match case" }).click();
    await expect(tally(page)).toHaveText("1 of 3");
    await expect.poll(() => markedMatches(page)).toBe(3);
  });

  await test.step("Esc closes the bar, its highlights go, and the page has focus again", async () => {
    await findInput(page).press("Escape");
    await expect(findBar(page)).toHaveCount(0);
    await expect.poll(() => hasFindHighlights(page)).toBe(false);
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe("IFRAME");
  });

  await test.step("⌘F with focus inside the page opens the page's find bar, not the conversation's, and again selects the query", async () => {
    await canvasPage(page).locator("h1").click();
    await page.keyboard.press(`${await primaryModifier(page)}+f`);
    await expect(findBar(page)).toBeVisible();
    await expect(conversationFindBar(page)).toHaveCount(0);
    await expect(findInput(page)).toBeFocused();
    await findInput(page).fill("keeper");
    await expect(tally(page)).toHaveText("1 of 3");
    await page.keyboard.press(`${await primaryModifier(page)}+f`);
    expect(await findInput(page).evaluate((field: HTMLInputElement) => field.value.slice(field.selectionStart ?? 0, field.selectionEnd ?? 0))).toBe("keeper");
    await expect(findBar(page)).toBeVisible();
    await expect(conversationFindBar(page)).toHaveCount(0);
    await findInput(page).press("Escape");
    await expect(findBar(page)).toHaveCount(0);
  });

  await test.step("⌘F with focus in the composer still finds in the conversation", async () => {
    await page.locator(".composer:visible textarea").click();
    await page.keyboard.press(`${await primaryModifier(page)}+f`);
    await expect(conversationFindBar(page)).toBeVisible();
    await expect(findBar(page)).toHaveCount(0);
    await conversationFindBar(page).locator("input").press("Escape");
    await expect(conversationFindBar(page)).toHaveCount(0);
  });
});
