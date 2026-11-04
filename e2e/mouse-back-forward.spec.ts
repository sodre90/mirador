import { expect, test, type Locator, type Page } from "@playwright/test";
import { addWorkspace, callCanvasTool, signIn, startConversation } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();

test.describe.configure({ mode: "serial" });
test.beforeAll(() => host.start());
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

/** Playwright's mouse has no back or forward button, and a made-up event would not show whether the browser steps its own history. */
async function pressMouseButton(page: Page, over: Locator, button: "back" | "forward") {
  const box = (await over.boundingBox())!;
  const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const session = await page.context().newCDPSession(page);
  await session.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...at });
  await session.send("Input.dispatchMouseEvent", { type: "mousePressed", ...at, button, buttons: button === "back" ? 8 : 16, clickCount: 1 });
  await session.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...at, button, buttons: 0, clickCount: 1 });
  await session.detach();
}

const timeline = (page: Page) => page.locator(".timeline:visible");
const canvasTitle = (page: Page) => page.locator(".canvas-panel:visible .canvas-title");
const shownPage = (page: Page) => page.locator(".canvas-panel:visible .canvas-frame.show iframe");

test("the mouse's back and forward buttons go through the conversations shown, and stay in Mirador", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const first = await startConversation(page);
  const second = await startConversation(page);
  const shownUrl = page.url();
  expect(shownUrl).toContain(`#/c/${second}`);

  await pressMouseButton(page, timeline(page), "back");
  await expect(page).toHaveURL(new RegExp(`#/c/${first}$`));
  const firstUrl = page.url();

  await pressMouseButton(page, timeline(page), "back");
  await page.waitForTimeout(300);
  expect(page.url()).toBe(firstUrl);

  await pressMouseButton(page, timeline(page), "forward");
  await expect(page).toHaveURL(new RegExp(`#/c/${second}$`));

  await pressMouseButton(page, timeline(page), "forward");
  await page.waitForTimeout(300);
  expect(page.url()).toBe(shownUrl);
});

test("over the canvas, the mouse's back and forward buttons go through its pages, not the conversations", async ({ page }) => {
  await signIn(page, host);
  const conversationId = await startConversation(page);
  await callCanvasTool(host, conversationId, "show", { title: "First page", html: "<p>first</p>" });
  await callCanvasTool(host, conversationId, "show", { title: "Second page", html: "<p>second</p>" });
  await expect(canvasTitle(page)).toHaveText("Second page");
  await expect(shownPage(page).contentFrame().locator("p")).toHaveText("second");

  await pressMouseButton(page, shownPage(page), "back");
  await expect(canvasTitle(page)).toHaveText("First page");
  await expect(page).toHaveURL(new RegExp(`#/c/${conversationId}$`));

  await pressMouseButton(page, page.locator(".canvas-panel:visible .canvas-header"), "forward");
  await expect(canvasTitle(page)).toHaveText("Second page");

  await pressMouseButton(page, shownPage(page), "forward");
  await page.waitForTimeout(300);
  await expect(canvasTitle(page)).toHaveText("Second page");
  await expect(page).toHaveURL(new RegExp(`#/c/${conversationId}$`));
});
