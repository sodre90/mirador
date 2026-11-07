import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, callCanvasTool, signIn, startConversation } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();

// Later tests use the workspace the first one adds.
test.describe.configure({ mode: "serial" });
test.beforeAll(() => host.start());
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const assetsOrigin = () => `http://127.0.0.1:${host.port + 1}`;
const canvasFrame = (page: Page) => page.locator(".canvas-panel:visible .canvas-frame.show iframe").contentFrame();
const say = (page: Page) => canvasFrame(page).locator(".diagram-steps-say");
const button = (page: Page, name: string) => canvasFrame(page).getByRole("button", { name, exact: true });

const steps = [
  { say: "The web app calls the API.", boxes: ["web", "api"], arrows: ["web-->api"] },
  { say: "The API answers.", boxes: ["web", "api"], arrows: ["api-->web"] },
  { say: "The API writes the order.", boxes: ["api", "db"], arrows: ["e1"] },
];

const diagramPage = (stepList: unknown = steps) => `<pre class="mermaid">flowchart LR
  web[Web app] --> api[API server]
  api e1@--> db[(Orders)]
  e1@{ animate: true }</pre>
<script type="application/json" class="diagram-steps">${JSON.stringify(stepList)}</script>
<script src="${assetsOrigin()}/mermaid.min.js"></script>
<script>mermaid.initialize({ startOnLoad: true });</script>
<script src="${assetsOrigin()}/diagram-steps.js"></script>`;

const lit = (page: Page) => canvasFrame(page).locator(".node.diagram-step-on");
const litArrows = (page: Page) => canvasFrame(page).locator("path.flowchart-link.diagram-step-on");

test("a Mermaid flowchart steps forward and back, with its boxes and arrows lit", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const conversationId = await startConversation(page);
  const shown = await callCanvasTool(host, conversationId, "show", { title: "Orders", html: diagramPage() });
  expect(shown).toContain("rendered without script errors");

  await expect(say(page)).toHaveText(steps[0]!.say);
  await expect(lit(page)).toHaveCount(2);
  await expect(litArrows(page)).toHaveCount(1);
  await expect(canvasFrame(page).locator(".diagram-steps-count")).toHaveText("1 / 3");

  await button(page, "Next").click();
  await expect(say(page)).toHaveText(steps[1]!.say);

  await button(page, "Next").click();
  await expect(say(page)).toHaveText(steps[2]!.say);
  await expect(canvasFrame(page).locator('path.flowchart-link.diagram-step-on[data-id="e1"]')).toBeAttached();
  await expect(canvasFrame(page).locator('path.flowchart-link[data-id="e1"]')).toHaveClass(/edge-animation-fast/);

  await button(page, "Back").click();
  await expect(say(page)).toHaveText(steps[1]!.say);
});

test("playing runs a dot along the arrows, moves through the steps by itself and stops on the last", async ({ page }) => {
  await signIn(page, host);
  const conversationId = await startConversation(page);
  await callCanvasTool(host, conversationId, "show", { title: "Orders", html: diagramPage() });

  await expect(canvasFrame(page).locator(".diagram-steps-dot")).toHaveAttribute("visibility", "visible");
  await expect(say(page)).toHaveText(steps[1]!.say, { timeout: 10_000 });
  await expect(say(page)).toHaveText(steps[2]!.say, { timeout: 10_000 });
  await expect(button(page, "Play")).toBeVisible({ timeout: 10_000 });
});

test("a page with more than one diagram starts them all stopped, and each plays when asked", async ({ page }) => {
  await signIn(page, host);
  const conversationId = await startConversation(page);
  const second = `<pre class="mermaid">flowchart LR
  a[Queue] --> b[Worker]</pre>
<script type="application/json" class="diagram-steps">${JSON.stringify([{ say: "The queue hands over a job.", boxes: ["a"] }, { say: "The worker runs it.", boxes: ["b"] }])}</script>`;
  await callCanvasTool(host, conversationId, "show", { title: "Two diagrams", html: `${second}${diagramPage()}` });

  const frame = canvasFrame(page);
  const players = frame.locator(".diagram-steps-bar");
  await expect(players).toHaveCount(2);
  await expect(frame.getByRole("button", { name: "Play", exact: true })).toHaveCount(2);
  await expect(frame.locator(".diagram-steps-count").first()).toHaveText("1 / 2");
  await expect(frame.locator(".diagram-steps-dot[visibility=visible]")).toHaveCount(0);
  await expect(frame.locator(".diagram-steps-count").last()).toHaveText("1 / 3");

  await players.first().getByRole("button", { name: "Play", exact: true }).click();
  await expect(frame.locator(".diagram-steps-say").first()).toHaveText("The worker runs it.");
  await expect(frame.locator(".diagram-steps-count").last()).toHaveText("1 / 3");
});

test("with reduced motion, it starts still and runs no dot", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signIn(page, host);
  const conversationId = await startConversation(page);
  await callCanvasTool(host, conversationId, "show", { title: "Orders", html: diagramPage() });

  await expect(say(page)).toHaveText(steps[0]!.say);
  await expect(lit(page)).toHaveCount(2);
  await expect(button(page, "Play")).toBeVisible();
  await button(page, "Next").click();
  await expect(say(page)).toHaveText(steps[1]!.say);
  await expect(canvasFrame(page).locator(".diagram-steps-dot")).toHaveCount(0);
});

test("a step naming a box the diagram lacks reaches the agent as a script error that lists the boxes", async ({ page }) => {
  await signIn(page, host);
  const conversationId = await startConversation(page);
  await callCanvasTool(host, conversationId, "show", { title: "Orders", html: diagramPage([{ say: "Oops", boxes: ["nothing"] }]) });

  await expect(page.locator(".canvas-frame.show .frame-errors li")).toContainText('names a box the diagram doesn\'t have: nothing. It has: web, api, db');
  await expect(canvasFrame(page).locator(".diagram-steps-bar")).toHaveCount(0);
});

test("find reaches a diagram's labels and the step's words", async ({ page }) => {
  await signIn(page, host);
  const conversationId = await startConversation(page);
  await callCanvasTool(host, conversationId, "show", { title: "Orders", html: diagramPage() });
  await expect(say(page)).toBeVisible();

  await page.locator(".canvas-header:visible .page-find-toggle").click();
  const find = page.locator(".canvas-panel:visible .page-find");
  await find.locator("input").fill("API server");
  await expect(find.locator(".find-tally")).toHaveText(/of 1$/);
  await find.locator("input").fill("web app calls");
  await expect(find.locator(".find-tally")).toHaveText(/of 1$/);
});

test("Copy as image draws the diagram with its lit step", async ({ page, context }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await signIn(page, host);
  const conversationId = await startConversation(page);
  await callCanvasTool(host, conversationId, "show", { title: "Orders", html: diagramPage() });
  await expect(lit(page)).toHaveCount(2);

  await page.locator(".canvas-header:visible .page-export .bar-menu-toggle").click();
  await page.getByRole("menu", { name: "Export the page" }).getByRole("menuitem", { name: "Copy as image" }).click();
  await expect(page.locator(".page-export-status")).toHaveText("Copied as an image", { timeout: 30_000 });
  const litPixels = await page.evaluate(async () => {
    const [item] = await navigator.clipboard.read();
    const bitmap = await createImageBitmap(await item!.getType("image/png"));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d")!;
    context.drawImage(bitmap, 0, 0);
    const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
    return data.filter((value, index) => index % 4 === 2 && value > 180 && data[index - 2]! < 130 && data[index - 1]! < 180).length;
  });
  expect(litPixels).toBeGreaterThan(100);
});

test("a page saved to the project carries the player inside it", async ({ page }) => {
  await signIn(page, host);
  const conversationId = await startConversation(page);
  await callCanvasTool(host, conversationId, "show", { title: "Orders", html: diagramPage() });
  await expect(say(page)).toBeVisible();

  await page.locator(".canvas-header:visible .page-export .bar-menu-toggle").click();
  await page.getByRole("menu", { name: "Export the page" }).getByRole("menuitem", { name: "Save to project…" }).click();
  await page.locator(".page-save").getByRole("button", { name: "Save" }).click();
  await expect(page.locator(".page-export-status")).toHaveText("Saved to docs/orders.html");
  const saved = readFileSync(join(host.projectDir, "docs", "orders.html"), "utf8");
  expect(saved).toContain("diagram-steps-bar");
  expect(saved).toContain("cdn.jsdelivr.net/npm/mermaid@");
  expect(saved).not.toContain(assetsOrigin());
});

test("a saved page steps through its diagram outside Mirador", async ({ page }) => {
  await page.route("https://cdn.jsdelivr.net/npm/mermaid@*/dist/mermaid.min.js", async (route) => route.fulfill({ path: join(import.meta.dirname, "..", "node_modules", "mermaid", "dist", "mermaid.min.js"), contentType: "text/javascript" }));
  await page.goto("about:blank");
  await page.setContent(readFileSync(join(host.projectDir, "docs", "orders.html"), "utf8"));
  await expect(page.locator(".diagram-steps-say")).toHaveText(steps[0]!.say);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.locator(".diagram-steps-say")).toHaveText(steps[1]!.say);
});

test("the controls follow the language chosen for Mirador", async ({ page }) => {
  await signIn(page, host);
  const conversationId = await startConversation(page);
  await page.evaluate(() => localStorage.setItem("mirador-language", "de"));
  await page.reload();
  await callCanvasTool(host, conversationId, "show", { title: "Orders", html: diagramPage() });

  await expect(button(page, "Weiter")).toBeVisible();
  await expect(button(page, "Zurück")).toBeVisible();
});
