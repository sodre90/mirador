import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, callCanvasTool, chooseInSettings, signIn, startConversation } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();

// Later tests use the workspace the first one adds.
test.describe.configure({ mode: "serial" });
test.beforeAll(() => host.start());
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const white = "rgb(255, 255, 255)";
const nearBlack = "rgb(17, 17, 17)";

/** Sets no colours itself, and notes what its first paint shows while it is still parsing. */
const barePage = `<body><p>plain page</p><script>
  window.whileParsing = { background: getComputedStyle(document.documentElement).backgroundColor, colorScheme: getComputedStyle(document.documentElement).colorScheme };
</script></body>`;

/** The usual light-dark() recipe, which on its own follows the system. */
const pageFollowingTheSystem = `<style>:root { color-scheme: light dark; } body { margin: 0; background: light-dark(rgb(250, 250, 250), rgb(5, 5, 5)); }</style>
<body><p>own colours</p><script>window.whileParsing = { background: getComputedStyle(document.body).backgroundColor };</script></body>`;

/** Colours picked for the light theme only, as many pages' inline code is, with more of it added once the page has run. */
const pageColouredForLightOnly = `<style>code { background: #f4f4f5; } .muted { color: #737373; } .lead { color: #24292f; }</style>
<body><p>Run <code class="first">make test</code> first.</p><p class="lead"><code class="leading">make</code> builds it</p><p class="muted">a muted note</p>
<script>setTimeout(() => document.body.insertAdjacentHTML("beforeend", '<p>Then <code class="later">bun test</code>.</p>'), 300);</script></body>`;

const lightThemeText = "rgb(23, 23, 23)";
const darkThemeText = "rgb(236, 236, 236)";

const canvasPage = (page: Page) => page.locator(".canvas-panel:visible .canvas-frame.show iframe").contentFrame().locator("body");
const rootBackground = (page: Page) => canvasPage(page).evaluate((node) => getComputedStyle(node.ownerDocument.documentElement).backgroundColor);
const frameBackground = (page: Page) => page.locator(".canvas-panel:visible .canvas-frame.show iframe").evaluate((frame) => getComputedStyle(frame).backgroundColor);
const whileParsing = (page: Page) => canvasPage(page).evaluate(() => (window as unknown as { whileParsing: unknown }).whileParsing);

const textColor = (page: Page, selector: string) => canvasPage(page).locator(selector).first().evaluate((node) => getComputedStyle(node).color);
const ownTextColor = (page: Page, selector: string) => canvasPage(page).locator(selector).evaluate((node: HTMLElement) => node.style.color);

async function showPage(page: Page, html: string) {
  const conversationId = await startConversation(page);
  await callCanvasTool(host, conversationId, "show", { title: "Page", html });
  await expect(canvasPage(page).locator("p").first()).toBeVisible();
}

test("a canvas page's default background follows the panel theme, live", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  await showPage(page, barePage);

  await expect.poll(() => rootBackground(page)).toBe(white);
  expect(await frameBackground(page)).toBe(white);
  await chooseInSettings(page, "Theme", "Dark");
  await expect.poll(() => rootBackground(page)).toBe(nearBlack);
  expect(await frameBackground(page)).toBe(nearBlack);
});

test("a canvas page is in the panel's theme from its first paint, and its scripts can read which", async ({ page }) => {
  await signIn(page, host);
  await chooseInSettings(page, "Theme", "Dark");
  await showPage(page, barePage);

  expect(await whileParsing(page)).toEqual({ background: nearBlack, colorScheme: "dark" });
});

test("the panel's theme wins over the system's, even for a page that asks for the system's", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await signIn(page, host);
  await showPage(page, pageFollowingTheSystem);

  expect(await whileParsing(page)).toEqual({ background: "rgb(250, 250, 250)" });
});

test("under Match system, a canvas page follows the system as it switches", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await signIn(page, host);
  await chooseInSettings(page, "Theme", "Match system");
  await showPage(page, barePage);

  await expect.poll(() => rootBackground(page)).toBe(white);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(() => rootBackground(page)).toBe(nearBlack);
});

test("text a page coloured for the light theme only stays readable in the dark one, and has its own colour again in light", async ({ page }) => {
  await signIn(page, host);
  await chooseInSettings(page, "Theme", "Dark");
  await showPage(page, pageColouredForLightOnly);

  await expect.poll(() => textColor(page, "code.first")).toBe(lightThemeText);
  await expect.poll(() => textColor(page, "code.later")).toBe(lightThemeText);
  expect(await textColor(page, "p")).toBe(darkThemeText);
  expect(await textColor(page, "p.lead")).toBe(darkThemeText);
  expect(await textColor(page, "code.leading")).toBe(lightThemeText);
  expect(await textColor(page, ".muted")).toBe("rgb(115, 115, 115)");

  await chooseInSettings(page, "Theme", "Light");
  await expect.poll(() => ownTextColor(page, "code.first")).toBe("");
  expect(await ownTextColor(page, "code.later")).toBe("");
  expect(await textColor(page, "code.first")).toBe(lightThemeText);
});
