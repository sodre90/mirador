import { appendFileSync, cpSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type FrameLocator, type Page } from "@playwright/test";
import { addWorkspace, callCanvasTool, createProfile, openCanvasMore, primaryModifier, sendMessage, signIn, signInWithWorkspace } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

const host = new TestHost({ fakePrograms: true });
const profileName = "canvas-find";
const promptsFile = () => join(host.root, "prompts");

test.beforeAll(async () => {
  const appDir = join(host.dataDir, "plugins", "counter");
  cpSync(join(import.meta.dirname, "..", "tests", "fixtures", "apps", "counter"), appDir, { recursive: true });
  appendFileSync(join(appDir, "view.js"), `
    const find = document.createElement("input");
    find.id = "app-find";
    find.hidden = true;
    document.body.append(find);
    addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.code === "KeyF") {
        document.body.dataset.findPrevented = String(event.defaultPrevented);
        if (event.defaultPrevented) return;
        event.preventDefault();
        find.hidden = false;
        find.focus();
      }
      if (event.key === "Escape") find.hidden = true;
    });
  `);
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
const findOnPage = "Find on this page";
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

test("the user finds text on the page the agent showed, from the canvas bar's ⋯ menu or with ⌘F inside the page", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, profileName, "", "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${profileName} · opencode` });
  const conversationId = await startConversationWithoutModel(page);

  await test.step("the ⋯ menu offers no find until a page is on the canvas", async () => {
    const menu = await openCanvasMore(page);
    await expect(menu.getByRole("menuitem", { name: "Clear the canvas", exact: true })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: findOnPage, exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
  });

  await sendMessage(page, "Start");
  await waitForIdle(page);
  await callCanvasTool(host, conversationId, "show", { title: "Lighthouse log", html: pageHtml });
  await expect(canvasPage(page).locator("h1")).toHaveText("Lighthouse log");

  await test.step("the ⋯ menu's find shows its shortcut and opens the bar; typing finds three matches, Enter steps to the next, Shift+Enter back, and a word that is not there says so", async () => {
    const findEntry = (await openCanvasMore(page)).getByRole("menuitem", { name: findOnPage, exact: true });
    await expect(findEntry.locator("kbd")).toHaveText((await primaryModifier(page)) === "Meta" ? "⌘F" : "Ctrl+F");
    await findEntry.click();
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

  await test.step("an app's own find handler receives Ctrl+F and ⌘F without the frame cancelling them first", async () => {
    await callCanvasTool(host, conversationId, "app_open", { app: "counter", file: "counter.json" });
    const app = page.locator(".canvas-panel:visible .canvas-frame.app iframe").contentFrame();
    await expect(app.locator("#count")).toHaveText("0");
    for (const modifier of ["Control", "Meta"]) {
      await app.locator("#count").click();
      await page.keyboard.press(`${modifier}+f`);
      await expect(app.locator("body")).toHaveAttribute("data-find-prevented", "false");
      await expect(app.locator("#app-find")).toBeVisible();
      await expect(app.locator("#app-find")).toBeFocused();
      await expect(findBar(page)).toHaveCount(0);
      await expect(conversationFindBar(page)).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(app.locator("#app-find")).toBeHidden();
    }
  });
});

const question = (page: Page) => page.locator(".canvas-panel:visible .ask");
const questionPage = (page: Page, kind: "ask-context" | "ask-preview") => question(page).locator(`.canvas-frame.${kind} iframe`).contentFrame();

/** The question's own matches, which the panel marks in its page under names of its own. */
const questionMarks = (page: Page) =>
  page.evaluate(() => ({ matches: CSS.highlights.get("question-find-match")?.size ?? 0, current: CSS.highlights.has("question-find-current") }));
const pageMarks = (frame: FrameLocator) =>
  frame.locator("body").evaluate((body) => {
    const { CSS: frameCss } = (body.ownerDocument.defaultView ?? window) as Window & typeof globalThis;
    return { matches: frameCss.highlights.get("mirador-find")?.size ?? 0, current: frameCss.highlights.has("mirador-find-current") };
  });

test("⌘F on a question finds in its text, its options and the pages it holds, counting them all in one tally", async ({ page }) => {
  await signInWithWorkspace(page, host);
  const profiles = await createProfile(page, "question-find", "", "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "question-find · opencode" });
  const conversationId = await startConversationWithoutModel(page);
  void callCanvasTool(host, conversationId, "ask", {
    question: "Which lighthouse keeper trims the lamp tonight?",
    html: `<p>The keeper's log says the lamp burns till dawn.</p><div style="height: 2400px"></div><p>Last entry: a storm at sea.</p>`,
    options: [
      { label: "The night keeper", description: "Trims it at dusk" },
      { label: "The day keeper", html: "<p>Keeper of the harbour bell</p>" },
    ],
  }).catch(() => {});
  await expect(question(page).getByRole("heading")).toHaveText("Which lighthouse keeper trims the lamp tonight?");
  await expect(questionPage(page, "ask-context").locator("p").first()).toHaveText("The keeper's log says the lamp burns till dawn.");
  await expect(questionPage(page, "ask-preview").locator("p")).toHaveText("Keeper of the harbour bell");

  await test.step("the ⋯ menu offers find for a question, and ⌘F on one of its answers opens the canvas's bar, not the conversation's", async () => {
    await expect((await openCanvasMore(page)).getByRole("menuitem", { name: findOnPage, exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await question(page).getByRole("radio", { name: "The night keeper", exact: true }).focus();
    await page.keyboard.press(`${await primaryModifier(page)}+f`);
    await expect(findBar(page)).toBeVisible();
    await expect(conversationFindBar(page)).toHaveCount(0);
    await expect(findInput(page)).toBeFocused();
  });

  await test.step("typing counts the question, its options and its pages in the order shown, and Enter steps through them all", async () => {
    await findInput(page).fill("keeper");
    await expect(tally(page)).toHaveText("1 of 5");
    await expect.poll(() => questionMarks(page)).toEqual({ matches: 3, current: true });
    await expect.poll(() => pageMarks(questionPage(page, "ask-context"))).toEqual({ matches: 1, current: false });
    await expect.poll(() => pageMarks(questionPage(page, "ask-preview"))).toEqual({ matches: 1, current: false });
    await findInput(page).press("Enter");
    await expect(tally(page)).toHaveText("2 of 5");
    await expect.poll(() => pageMarks(questionPage(page, "ask-context"))).toEqual({ matches: 1, current: true });
    await expect.poll(() => questionMarks(page)).toEqual({ matches: 3, current: false });
    await findInput(page).press("Enter");
    await expect(tally(page)).toHaveText("3 of 5");
    await expect.poll(() => questionMarks(page)).toEqual({ matches: 3, current: true });
    await expect.poll(() => pageMarks(questionPage(page, "ask-context"))).toEqual({ matches: 1, current: false });
    await findInput(page).press("Enter");
    await findInput(page).press("Enter");
    await expect(tally(page)).toHaveText("5 of 5");
    await expect.poll(() => pageMarks(questionPage(page, "ask-preview"))).toEqual({ matches: 1, current: true });
    await findInput(page).press("Enter");
    await expect(tally(page)).toHaveText("1 of 5");
    await findInput(page).press("Shift+Enter");
    await expect(tally(page)).toHaveText("5 of 5");
  });

  await test.step("Aa matches case across the pages too, and an option's description is found", async () => {
    await findInput(page).fill("Keeper");
    await expect(tally(page)).toHaveText("1 of 5");
    await findBar(page).getByRole("button", { name: "Match case" }).click();
    await expect(tally(page)).toHaveText("1 of 1");
    await expect.poll(() => pageMarks(questionPage(page, "ask-preview"))).toEqual({ matches: 1, current: true });
    await expect.poll(() => questionMarks(page)).toEqual({ matches: 0, current: false });
    await findBar(page).getByRole("button", { name: "Match case" }).click();
    await findInput(page).fill("dusk");
    await expect(tally(page)).toHaveText("1 of 1");
    await expect.poll(() => questionMarks(page)).toEqual({ matches: 1, current: true });
  });

  await test.step("picking an answer, which names it under the options, counts it at once", async () => {
    await findInput(page).fill("night keeper");
    await expect(tally(page)).toHaveText("1 of 1");
    await question(page).getByRole("radio", { name: "The night keeper", exact: true }).check();
    await expect(tally(page)).toHaveText("1 of 2");
  });

  await test.step("the panel scrolls to a match far down one of the question's pages, and back up to the question's own text", async () => {
    const scrolled = () => page.locator(".canvas-panel:visible .canvas-body").evaluate((body) => body.scrollTop);
    await findInput(page).fill("storm");
    await expect(tally(page)).toHaveText("1 of 1");
    await expect.poll(scrolled).toBeGreaterThan(1500);
    await findInput(page).fill("lighthouse");
    await expect(tally(page)).toHaveText("1 of 1");
    await expect.poll(scrolled).toBeLessThan(200);
  });

  await test.step("Esc closes the bar, takes every highlight away and gives the picked answer focus", async () => {
    await findInput(page).focus();
    await findInput(page).press("Escape");
    await expect(findBar(page)).toHaveCount(0);
    await expect.poll(() => questionMarks(page)).toEqual({ matches: 0, current: false });
    await expect.poll(() => pageMarks(questionPage(page, "ask-context"))).toEqual({ matches: 0, current: false });
    await expect.poll(() => pageMarks(questionPage(page, "ask-preview"))).toEqual({ matches: 0, current: false });
    await expect(question(page).getByRole("radio", { name: "The night keeper", exact: true })).toBeFocused();
  });

  await test.step("⌘F inside one of the question's pages opens the canvas's bar as well", async () => {
    await questionPage(page, "ask-context").locator("p").first().click();
    await page.keyboard.press(`${await primaryModifier(page)}+f`);
    await expect(findBar(page)).toBeVisible();
    await expect(conversationFindBar(page)).toHaveCount(0);
    await findInput(page).fill("dawn");
    await expect(tally(page)).toHaveText("1 of 1");
    await expect.poll(() => pageMarks(questionPage(page, "ask-context"))).toEqual({ matches: 1, current: true });
  });

  await test.step("paging on to the next of several questions finds in the page it brings, once that page has loaded", async () => {
    await question(page).getByRole("button", { name: "Submit" }).click();
    void callCanvasTool(host, conversationId, "ask", {
      questions: [
        { question: "Which bell rings first?", options: [{ label: "The harbour bell" }, { label: "The chapel bell" }] },
        { question: "Which flag flies?", html: "<p>The pennant shows a gull.</p>", options: [{ label: "Blue" }, { label: "Red" }] },
      ],
    }).catch(() => {});
    await expect(question(page).getByRole("heading")).toHaveText("Which bell rings first?");
    await question(page).getByRole("radio", { name: "The harbour bell", exact: true }).focus();
    await page.keyboard.press(`${await primaryModifier(page)}+f`);
    await findInput(page).fill("gull");
    await expect(tally(page)).toHaveText("No matches");
    await question(page).getByRole("radio", { name: "The harbour bell", exact: true }).check();
    await question(page).getByRole("button", { name: "Next" }).click();
    await expect(question(page).getByRole("heading")).toHaveText("Which flag flies?");
    await expect(tally(page)).toHaveText("1 of 1");
    await expect.poll(() => pageMarks(questionPage(page, "ask-context"))).toEqual({ matches: 1, current: true });
  });
});
