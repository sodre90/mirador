import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, createProfile, pasteImage, reloadFromRestartedHost, signIn, startConversation, waitForTurnToEnd } from "./helpers.ts";
import { ScriptedModel, scriptedOpencodeEnvironment } from "./scripted-model.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();
const model = new ScriptedModel();
const PROFILE = "scripted opencode";

// Later tests use the workspace and the profile the first one adds.
test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  await model.start();
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
  model.stop();
});

const onePixelPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const image = { type: "image", mimeType: "image/png", data: onePixelPng };
const acp = (update: object) => ({ type: "acp", update });

const composer = (page: Page) => page.locator(".composer:visible textarea");
const storedImages = (conversationId: string) => {
  const folder = join(host.dataDir, "images", conversationId);
  return existsSync(folder) ? readdirSync(folder) : [];
};

async function startScriptedConversation(page: Page) {
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${PROFILE} · opencode` });
  return startConversation(page);
}

test("images in a replayed session's messages and in the agent's replies show as thumbnails", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const dialog = await createProfile(page, PROFILE, scriptedOpencodeEnvironment(model, host.root), "", "opencode");
  await dialog.getByRole("button", { name: "Close" }).click();
  const conversationId = await startScriptedConversation(page);
  await host.stop();
  const replayed = [
    acp({ sessionUpdate: "user_message_chunk", content: { type: "text", text: "What is in this picture?" } }),
    acp({ sessionUpdate: "user_message_chunk", content: image }),
    acp({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "One pixel. Here it is back:" } }),
    acp({ sessionUpdate: "agent_message_chunk", content: image }),
  ];
  execFileSync("bun", [join(import.meta.dirname, "seed-events.ts"), join(host.dataDir, "state.sqlite"), conversationId, JSON.stringify(replayed)]);
  await host.start();
  await reloadFromRestartedHost(page);

  const timeline = page.locator(".timeline:visible");
  const shown = (message: string) => timeline.locator(`${message} .message-images img`);
  await expect(timeline.locator(".message.user")).toContainText("What is in this picture?");
  await expect(shown(".message.user")).toHaveCount(1);
  await expect(shown(".message.agent")).toHaveCount(1);
  await expect.poll(() => shown(".message.agent").evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
  await expect(timeline).not.toContainText("(image content)");
});

test("an image still uploading shows as a chip until it is attached", async ({ page }) => {
  await signIn(page, host);
  await page.locator(".workspace li").first().click();
  await startScriptedConversation(page);
  let release = () => {};
  const released = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/conversations/*/images", async (route) => {
    await released;
    await route.continue();
  });

  await pasteImage(composer(page), { width: 40, height: 30 });
  const uploading = page.locator(".pasted-images li.uploading");
  await expect(uploading).toHaveText(/\[Image #1\]\s*Uploading…/);
  await expect(page.locator(".composer:visible .send")).toBeDisabled();

  release();
  await expect(uploading).toHaveCount(0);
  await expect(page.locator(".pasted-images .thumbnail")).toHaveCount(1);
});

test("a pasted image taken out of the message box, or left out of the message sent, is deleted from the host", async ({ page }) => {
  await signIn(page, host);
  await page.locator(".workspace li").first().click();
  const conversationId = await startScriptedConversation(page);
  const thumbnails = page.locator(".pasted-images .thumbnail");

  await pasteImage(composer(page), { width: 40, height: 30 });
  await expect(thumbnails).toHaveCount(1);
  expect(storedImages(conversationId)).toHaveLength(1);
  await page.getByRole("button", { name: "Remove image #1" }).click();
  await expect.poll(() => storedImages(conversationId)).toHaveLength(0);

  await pasteImage(composer(page), { width: 40, height: 30, color: "#d65b5b" });
  await pasteImage(composer(page), { width: 40, height: 30, color: "#5bd68a" });
  await expect(thumbnails).toHaveCount(2);
  await expect(composer(page)).toHaveValue("[Image #1] [Image #2] ");
  await composer(page).fill("only the first [Image #1]");
  await composer(page).press("Enter");
  await expect(page.locator(".timeline:visible .message.user .message-images img")).toHaveCount(1);
  await waitForTurnToEnd(page);
  await expect.poll(() => storedImages(conversationId)).toHaveLength(1);
});

test("a pasted image opens over the page, scaled down to fit the window and centred in it", async ({ page }) => {
  await signIn(page, host);
  await page.locator(".workspace li").first().click();
  await startScriptedConversation(page);
  const preview = page.getByRole("dialog", { name: "Image" });
  const { width, height } = page.viewportSize()!;
  const fitsAndIsCentred = async () => {
    const box = (await preview.locator("img").boundingBox())!;
    const inside = box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= height;
    const centred = Math.abs(box.x + box.width / 2 - width / 2) < 1 && Math.abs(box.y + box.height / 2 - height / 2) < 1;
    return inside && centred;
  };

  for (const [index, size] of [{ width: 1152, height: 3000 }, { width: 4000, height: 300 }].entries()) {
    await pasteImage(composer(page), size);
    await page.getByRole("button", { name: `Show image #${index + 1}` }).click();
    await expect.poll(fitsAndIsCentred, `a ${size.width}×${size.height} image`).toBe(true);
    await page.keyboard.press("Escape");
    await expect(preview).toHaveCount(0);
  }
});
