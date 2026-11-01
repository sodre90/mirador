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

const DIAGRAM_SOURCE = "graph TD; Checkout-->Payments";

/** A diagram, and whether its source was visible on the page's first paint, before any script could draw it. */
const diagramPage = (drawsIt: string) => `<pre class="mermaid">${DIAGRAM_SOURCE}</pre>
<script>window.sourceOnFirstPaint = getComputedStyle(document.querySelector("pre.mermaid")).visibility;</script>
${drawsIt}`;

const canvasFrame = (page: Page) => page.locator(".canvas-panel:visible .canvas-frame.show iframe").contentFrame();
const sourceOnFirstPaint = (page: Page) => canvasFrame(page).locator("body").evaluate(() => (window as unknown as { sourceOnFirstPaint: string }).sourceOnFirstPaint);

async function showPage(page: Page, html: string) {
  const conversationId = await startConversation(page);
  await callCanvasTool(host, conversationId, "show", { title: "Diagram", html });
  await expect(canvasFrame(page).locator("pre.mermaid")).toBeAttached();
}

test("a Mermaid diagram's source never shows while the diagram is drawn", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const assetsOrigin = `http://127.0.0.1:${host.port + 1}`;
  await showPage(page, diagramPage(`<script src="${assetsOrigin}/mermaid.min.js"></script><script>mermaid.initialize({ startOnLoad: true });</script>`));

  expect(await sourceOnFirstPaint(page)).toBe("hidden");
  await expect(canvasFrame(page).locator("pre.mermaid svg")).toBeVisible();
  await expect(canvasFrame(page).locator("pre.mermaid")).not.toContainText(DIAGRAM_SOURCE);
});

test("a diagram that is never drawn shows its source after a few seconds", async ({ page }) => {
  await signIn(page, host);
  await showPage(page, diagramPage(""));

  expect(await sourceOnFirstPaint(page)).toBe("hidden");
  await expect(canvasFrame(page).getByText(DIAGRAM_SOURCE)).toBeVisible({ timeout: 6_000 });
});
