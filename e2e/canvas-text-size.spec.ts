import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { addWorkspace, answerCanvasQuestion, callCanvasTool, chooseInSettings, createProfile, sendMessage, signIn } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

const host = new TestHost({ fakePrograms: true });
const profileName = "canvas-text-size";

test.beforeAll(async () => {
  const promptsFile = join(host.root, "prompts");
  writeBunProgram(host.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"), { FAKE_ACP_PROMPTS: promptsFile });
  writeFileSync(promptsFile, "");
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const plan = {
  title: "Text size plan",
  html: `<style>p { font-size: 13px; line-height: 20px; margin: 0; } #field { width: 240px; height: 120px; background: #00ff00; }</style>
<p id="line">Text the agent sized in pixels</p>
<div id="field"></div>`,
};

const fullHeight = {
  title: "Full height",
  html: `<style>body { margin: 0; } #screen { height: 100vh; box-sizing: border-box; border: 4px solid #333; }</style><div id="screen">One screen</div>`,
};

const widePreview = `<div id="wide" style="width:900px;display:flex;justify-content:space-between;background:#eef;padding:8px"><b>START</b><b>END</b></div>`;

const shownFrame = (page: Page) => page.locator(".canvas-panel:visible .canvas-frame.show iframe");
const shownPage = (page: Page) => shownFrame(page).contentFrame();
const pointToggle = (page: Page) => page.locator(".canvas-header:visible .point-toggle");
const wordsBox = (page: Page) => page.getByRole("dialog", { name: "Ask the agent about what you marked" });

/**
 * Where an element of a framed page shows on the screen, the frame's scale included: Playwright's boundingBox places
 * the element by the frame's offset alone. The frame is reached as the element's own page sees it, so a shown page and
 * an option preview alike.
 */
async function onScreen(frame: Locator, element: Locator) {
  const inner = await element.evaluate((node) => node.getBoundingClientRect().toJSON() as DOMRect);
  const outer = await frame.evaluate((node: HTMLIFrameElement) => {
    const { left, top } = node.getBoundingClientRect();
    // The transform itself, not the rect over offsetWidth: offsetWidth rounds, which at 200% reads a scale of 1.998.
    const transform = getComputedStyle(node).transform;
    const scale = transform === "none" ? 1 : new DOMMatrixReadOnly(transform).a;
    return { left: left + node.clientLeft * scale, top: top + node.clientTop * scale, scale };
  });
  return { x: outer.left + inner.left * outer.scale, y: outer.top + inner.top * outer.scale, width: inner.width * outer.scale, height: inner.height * outer.scale };
}

/** How much of a picture is clearly green, as the page's field is. */
const greenShare = (picture: Locator) =>
  picture.evaluate(async (image: HTMLImageElement) => {
    const bitmap = await createImageBitmap(image);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d")!;
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    let green = 0;
    for (let index = 0; index < pixels.length; index += 4) if (pixels[index + 1]! > 200 && pixels[index]! < 60 && pixels[index + 2]! < 60) green++;
    return green / (pixels.length / 4);
  });

test("pages the agent shows or asks with follow the text size chosen in Settings, and marks on them land where the user points", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, profileName, "", "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${profileName} · opencode` });
  const previousUrl = page.url();
  await page.getByRole("button", { name: "+ New conversation" }).click();
  await expect(page).not.toHaveURL(previousUrl);
  const conversationId = page.url().match(/#\/c\/(.+)$/)![1]!;
  await sendMessage(page, "SAY ready");
  await expect(page.locator(".chat-header:visible .badge")).toHaveText("idle", { timeout: 60_000 });
  await callCanvasTool(host, conversationId, "show", plan);
  const line = shownPage(page).locator("#line");
  const field = shownPage(page).locator("#field");
  await expect(line).toBeVisible();
  expect((await onScreen(shownFrame(page), line)).height).toBeCloseTo(20, 0);

  await test.step("choosing 140% grows the shown page's text and what it drew in pixels, without reloading it", async () => {
    await shownPage(page).locator("body").evaluate((body) => (body.dataset.loaded = "once"));
    await chooseInSettings(page, "Text size", "140%");
    await expect.poll(async () => (await onScreen(shownFrame(page), line)).height).toBeCloseTo(28, 0);
    expect((await onScreen(shownFrame(page), field)).width).toBeCloseTo(240 * 1.4, 0);
    await expect(shownPage(page).locator("body")).toHaveAttribute("data-loaded", "once");
  });

  await test.step("the page opens at the chosen size after a reload", async () => {
    await page.reload();
    await expect(line).toBeVisible();
    await expect.poll(async () => (await onScreen(shownFrame(page), line)).height).toBeCloseTo(28, 0);
  });

  await test.step("in point mode the outline sits on the element under the pointer", async () => {
    await pointToggle(page).click();
    const fieldBox = await onScreen(shownFrame(page), field);
    await page.mouse.move(fieldBox.x + fieldBox.width / 2, fieldBox.y + fieldBox.height / 2);
    const outline = shownPage(page).locator(".outline");
    await expect(outline).toBeVisible();
    const outlineBox = await onScreen(shownFrame(page), outline);
    for (const side of ["x", "y", "width", "height"] as const) expect(Math.abs(outlineBox[side] - fieldBox[side])).toBeLessThanOrEqual(2);
  });

  await test.step("a box drawn on the zoomed page pictures the part of it the box covers", async () => {
    const fieldBox = await onScreen(shownFrame(page), field);
    await page.mouse.move(fieldBox.x + 30, fieldBox.y + 30);
    await page.mouse.down();
    await page.mouse.move(fieldBox.x + fieldBox.width - 30, fieldBox.y + fieldBox.height - 30, { steps: 8 });
    await page.mouse.up();
    await expect(wordsBox(page)).toContainText("Ask the agent about the marked area");
    const picture = wordsBox(page).getByRole("img", { name: "The marked area" });
    await expect.poll(() => picture.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
    expect(await greenShare(picture)).toBeGreaterThan(0.9);
    await wordsBox(page).getByRole("button", { name: "Cancel" }).click();
  });

  await test.step("a page one screen tall still fits the panel, without scrolling", async () => {
    await callCanvasTool(host, conversationId, "show", fullHeight);
    const screen = shownPage(page).locator("#screen");
    await expect(screen).toBeVisible();
    const frameBox = (await shownFrame(page).evaluate((node) => node.getBoundingClientRect().toJSON())) as DOMRect;
    const screenBox = await onScreen(shownFrame(page), screen);
    expect(Math.abs(screenBox.height - frameBox.height)).toBeLessThanOrEqual(2);
    expect(await shownPage(page).locator("html").evaluate((root) => root.scrollHeight - root.clientHeight)).toBe(0);
  });

  await test.step("an option preview too wide for the zoomed column is scaled to fit it whole, and its text is no smaller than at 100%", async () => {
    void callCanvasTool(host, conversationId, "ask", { question: "Which one?", options: [{ label: "Wide", html: widePreview }, { label: "Plain" }] }).catch(() => {});
    const preview = page.locator(".ask-option").first().locator("iframe");
    const end = preview.contentFrame().getByText("END");
    await expect(end).toBeAttached();
    await preview.scrollIntoViewIfNeeded();
    await expect(end).toBeInViewport({ ratio: 0.99 });
    const zoomedHeight = (await onScreen(preview, end)).height;
    await chooseInSettings(page, "Text size", "100%");
    await preview.scrollIntoViewIfNeeded();
    await expect(end).toBeInViewport({ ratio: 0.99 });
    await expect.poll(async () => (await onScreen(preview, end)).height).toBeLessThanOrEqual(zoomedHeight);
    await answerCanvasQuestion(page, "Plain");
  });

  await test.step("going back to 100% gives a shown page its own size again", async () => {
    await callCanvasTool(host, conversationId, "show", plan);
    await expect.poll(async () => (await onScreen(shownFrame(page), line)).height).toBeCloseTo(20, 0);
  });

  await test.step("the ladder's ends scale a shown page by their own factor", async () => {
    for (const [size, factor] of [["200%", 2], ["50%", 0.5]] as const) {
      await chooseInSettings(page, "Text size", size);
      await expect.poll(async () => (await onScreen(shownFrame(page), line)).height).toBeCloseTo(20 * factor, 0);
      expect((await onScreen(shownFrame(page), field)).width).toBeCloseTo(240 * factor, 0);
    }
  });

  await test.step("a page one screen tall fits the panel at the ladder's ends too", async () => {
    await callCanvasTool(host, conversationId, "show", fullHeight);
    await expect(shownPage(page).locator("#screen")).toBeVisible();
    for (const size of ["200%", "50%"] as const) {
      await chooseInSettings(page, "Text size", size);
      await expect.poll(async () => shownPage(page).locator("html").evaluate((root) => root.scrollHeight - root.clientHeight)).toBe(0);
      const frameBox = (await shownFrame(page).evaluate((node) => node.getBoundingClientRect().toJSON())) as DOMRect;
      const screenBox = await onScreen(shownFrame(page), shownPage(page).locator("#screen"));
      expect(Math.abs(screenBox.height - frameBox.height)).toBeLessThanOrEqual(2);
    }
  });
});
