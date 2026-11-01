import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { addWorkspace, callCanvasTool, createProfile, sendMessage, signIn } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

const host = new TestHost({ fakePrograms: true });
const profileName = "page-marks";
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

const layouts = {
  title: "Workspace layout options",
  html: `<style>td { padding: 8px 16px; }</style>
<h1>Layouts</h1>
<table>
  <tr><th>Option</th><th>Why</th></tr>
  <tr><td>Tabs</td><td class="pro">Familiar</td></tr>
  <tr><td>Splits</td><td class="pro" id="splits">Split conversation panes</td></tr>
</table>
<button id="save" class="primary">Save</button>
<p>Clicks: <span id="clicks">0</span></p>
<canvas id="scene" width="240" height="120"></canvas>
<script type="module">
  import * as THREE from "three";
  const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById("scene") });
  renderer.setClearColor(0x00ff00);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  renderer.setAnimationLoop(() => renderer.render(scene, camera));
  document.getElementById("scene").dataset.drawing = "yes";
</script>
<script>
  document.getElementById("save").addEventListener("click", () => {
    const clicks = document.getElementById("clicks");
    clicks.textContent = String(Number(clicks.textContent) + 1);
  });
</script>`,
};

const canvasPage = (page: Page) => page.locator(".canvas-panel:visible .canvas-frame.show iframe").contentFrame();
const pointToggle = (page: Page) => page.locator(".canvas-header:visible .point-toggle");
const wordsBox = (page: Page) => page.getByRole("dialog", { name: "Ask the agent about what you marked" });
const sentNote = (page: Page) => page.locator(".canvas-panel:visible .page-mark-sent");
const recordedPrompts = () => readFileSync(promptsFile(), "utf8");

async function startConversationWithoutModel(page: Page) {
  const previousUrl = page.url();
  await page.getByRole("button", { name: "+ New conversation" }).click();
  await expect(page).not.toHaveURL(previousUrl);
  return page.url().match(/#\/c\/(.+)$/)![1]!;
}

async function waitForIdle(page: Page) {
  await expect(page.locator(".chat-header:visible .badge")).toHaveText("idle", { timeout: 60_000 });
}

const shownFrameBox = async (page: Page) => (await page.locator(".canvas-panel:visible .canvas-frame.show iframe").boundingBox())!;

/** How much of a picture is clearly green, as three.js clears the scene to. */
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

/** Drags across the element's text with the mouse, from the padding before it to the padding after it. */
async function selectTextOf(page: Page, element: Locator) {
  const frameBox = await shownFrameBox(page);
  const text = await element.evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const { left, right, top, height } = range.getBoundingClientRect();
    return { left, right, middle: top + height / 2 };
  });
  await page.mouse.move(frameBox.x + text.left - 4, frameBox.y + text.middle);
  await page.mouse.down();
  await page.mouse.move(frameBox.x + text.right + 4, frameBox.y + text.middle, { steps: 6 });
  await page.mouse.up();
}

/** Drags a finger from one point of the page to another, as Playwright's touchscreen only taps. */
async function dragAFinger(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const touch = await page.context().newCDPSession(page);
  await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [from] });
  for (const step of [1, 2, 3, 4, 5, 6, 7, 8].map((each) => each / 8))
    await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: from.x + (to.x - from.x) * step, y: from.y + (to.y - from.y) * step }] });
  await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await touch.detach();
}

test("the user selects text or points at an element on a page the agent showed, and asks about it or has it changed", async ({ page, browser }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, profileName, "", "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${profileName} · opencode` });
  const conversationId = await startConversationWithoutModel(page);
  await sendMessage(page, "Start");
  await waitForIdle(page);
  await callCanvasTool(host, conversationId, "show", layouts);
  const shown = canvasPage(page);
  await expect(shown.locator("#splits")).toBeVisible();

  await test.step("selecting text offers to ask about it, and Ask sends the agent the text, where it is and the page's name", async () => {
    const pill = shown.getByRole("button", { name: "Ask about this" });
    await expect(pill).toBeHidden();
    await selectTextOf(page, shown.locator("#splits"));
    await expect(pill).toBeVisible();
    await expect(wordsBox(page)).toBeHidden();
    await pill.click();
    await expect(wordsBox(page)).toContainText("Ask the agent about “Split conversation panes”, or tell it what to change there");
    await wordsBox(page).getByRole("textbox").fill("Why is this better than tabs?");
    await wordsBox(page).getByRole("textbox").press("Enter");
    await expect(wordsBox(page)).toBeHidden();
    await expect(sentNote(page)).toHaveText("Asked about “Split conversation panes”. The answer comes in the chat.");
    await expect.poll(recordedPrompts).toContain(
      [
        'About this text on the canvas page "Workspace layout options":',
        "",
        "> Split conversation panes",
        "",
        "It is in `td#splits`:",
        "",
        "```html",
        '<td class="pro" id="splits">Split conversation panes</td>',
        "```",
        "",
        "Why is this better than tabs?",
      ].join("\n"),
    );
    await waitForIdle(page);
    await expect(page.locator(".timeline:visible .message.user").last()).toContainText("Why is this better than tabs?");
  });

  await test.step("in point mode a click picks the element instead of pressing it, and Change asks for the page again with the change", async () => {
    await pointToggle(page).click();
    await expect(pointToggle(page)).toHaveAttribute("aria-pressed", "true");
    await shown.locator("#save").click();
    await expect(shown.locator("#clicks")).toHaveText("0");
    await expect(pointToggle(page)).toHaveAttribute("aria-pressed", "false");
    await expect(wordsBox(page)).toContainText("Ask the agent about the element button#save");
    await wordsBox(page).getByRole("textbox").fill("Make it green");
    await wordsBox(page).getByRole("button", { name: "Change" }).click();
    await expect(sentNote(page)).toHaveText("Asked the agent to change the element button#save. The new page comes on the canvas.");
    await expect.poll(recordedPrompts).toContain(
      [
        'About this element on the canvas page "Workspace layout options", at `button#save`:',
        "",
        "```html",
        '<button id="save" class="primary">Save</button>',
        "```",
        "",
        "Make it green",
        "",
        "Show the page again with this changed, under the same title, and leave the rest of it as it is.",
      ].join("\n"),
    );
    await waitForIdle(page);
  });

  await test.step("in point mode a drag draws a box, and its area of the 3D scene goes with the message as a picture", async () => {
    await expect(shown.locator("#scene")).toHaveAttribute("data-drawing", "yes");
    await pointToggle(page).click();
    const frameBox = await shownFrameBox(page);
    const scene = (await shown.locator("#scene").boundingBox())!;
    await page.mouse.move(scene.x + 20, scene.y + 20);
    await page.mouse.down();
    await page.mouse.move(scene.x + 140, scene.y + 90, { steps: 8 });
    await page.mouse.up();
    expect(frameBox.width).toBeGreaterThan(0);
    await expect(pointToggle(page)).toHaveAttribute("aria-pressed", "false");
    await expect(wordsBox(page)).toContainText("Ask the agent about the marked area");
    const picture = wordsBox(page).getByRole("img", { name: "The marked area" });
    await expect.poll(() => picture.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
    expect(await greenShare(picture)).toBeGreaterThan(0.9);
    await wordsBox(page).getByRole("textbox").fill("Why is it all green?");
    await wordsBox(page).getByRole("button", { name: "Ask" }).click();
    await expect(sentNote(page)).toHaveText("Asked about the marked area. The answer comes in the chat.");
    await expect.poll(recordedPrompts).toContain('About the area of the canvas page "Workspace layout options" in the attached picture. It is in `canvas#scene`:');
    await expect.poll(recordedPrompts).toContain("Why is it all green?");
    await waitForIdle(page);
    const sent = page.locator(".timeline:visible .message.user").last();
    await expect(sent).toContainText("Why is it all green?");
    await expect.poll(() => sent.locator(".message-images img").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  });

  await test.step("Esc leaves point mode and Cancel sends nothing; the page's own clicks work again", async () => {
    await pointToggle(page).click();
    await expect(pointToggle(page)).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
    await expect(pointToggle(page)).toHaveAttribute("aria-pressed", "false");
    await shown.locator("#save").click();
    await expect(shown.locator("#clicks")).toHaveText("1");

    const promptsBefore = recordedPrompts();
    await pointToggle(page).click();
    await shown.locator("td.pro").first().click();
    await expect(wordsBox(page)).toContainText("the element td.pro");
    await wordsBox(page).getByRole("button", { name: "Cancel" }).click();
    await expect(wordsBox(page)).toBeHidden();
    await shown.locator("#save").click();
    await expect(shown.locator("#clicks")).toHaveText("2");
    expect(recordedPrompts()).toBe(promptsBefore);
  });

  await test.step("on a touch screen a selection made without lifting a finger offers to ask about it, a tap in point mode picks the element instead of pressing it, and a finger's drag draws a box", async () => {
    const touchScreen = await browser.newContext({ hasTouch: true });
    const tablet = await touchScreen.newPage();
    await signIn(tablet, host);
    await tablet.goto(page.url());
    const shownOnTablet = canvasPage(tablet);
    await expect(shownOnTablet.locator("#save")).toBeVisible();
    await shownOnTablet.locator("#splits").evaluate((cell) => getSelection()!.selectAllChildren(cell));
    await shownOnTablet.getByRole("button", { name: "Ask about this" }).tap();
    await expect(wordsBox(tablet)).toContainText("Ask the agent about “Split conversation panes”");
    await wordsBox(tablet).getByRole("button", { name: "Cancel" }).tap();
    await shownOnTablet.locator("#splits").evaluate(() => getSelection()!.removeAllRanges());
    await pointToggle(tablet).tap();
    const save = (await shownOnTablet.locator("#save").boundingBox())!;
    await tablet.touchscreen.tap(save.x + save.width / 2, save.y + save.height / 2);
    await expect(wordsBox(tablet)).toContainText("Ask the agent about the element button#save");
    await expect(shownOnTablet.locator("#clicks")).toHaveText("0");
    await wordsBox(tablet).getByRole("button", { name: "Cancel" }).tap();

    await pointToggle(tablet).tap();
    const scene = (await shownOnTablet.locator("#scene").boundingBox())!;
    await dragAFinger(tablet, { x: scene.x + 20, y: scene.y + 20 }, { x: scene.x + 140, y: scene.y + 90 });
    await expect(wordsBox(tablet)).toContainText("Ask the agent about the marked area");
    await expect(pointToggle(tablet)).toHaveAttribute("aria-pressed", "false");
    await touchScreen.close();
  });
});
