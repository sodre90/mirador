import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { addWorkspace, createProfile, pasteImage, sendMessage, signIn, startConversation, waitForTurnToEnd } from "./helpers.ts";
import { ScriptedModel, scriptedOpencodeEnvironment } from "./scripted-model.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();
const model = new ScriptedModel();
const PROFILE = "scripted opencode";

test.beforeAll(async () => {
  mkdirSync(host.projectDir, { recursive: true });
  writeFileSync(join(host.projectDir, "notes.md"), "");
  await model.start();
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
  model.stop();
});

async function startScriptedConversation(page: Page) {
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${PROFILE} · opencode` });
  await startConversation(page);
}

/** The badge can still read idle right after Enter, before the turn starts; the reply shows the message went out. */
async function sendAndAwaitReply(page: Page, send: () => Promise<void>) {
  const replies = page.locator(".timeline:visible .message.agent");
  const repliedBefore = await replies.count();
  await send();
  await expect(replies).toHaveCount(repliedBefore + 1);
  await waitForTurnToEnd(page);
}

const caretToStart = (composer: Locator) => composer.evaluate((box: HTMLTextAreaElement) => box.setSelectionRange(0, 0));

async function pressExpecting(composer: Locator, key: string, values: string[]) {
  for (const value of values) {
    await composer.press(key);
    await expect(composer).toHaveValue(value);
  }
}

test("↑ brings back what was typed before, newest first, and ↓ goes forward again to the message being written", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const dialog = await createProfile(page, PROFILE, scriptedOpencodeEnvironment(model, host.root), "", "opencode");
  await dialog.getByRole("button", { name: "Close" }).click();
  await startScriptedConversation(page);
  await sendAndAwaitReply(page, () => sendMessage(page, "an earlier conversation's message"));

  await startScriptedConversation(page);
  const composer = page.locator(".composer:visible textarea");
  const paths = page.getByRole("listbox", { name: "Paths" });
  await sendAndAwaitReply(page, () => sendMessage(page, "first"));
  await composer.fill("!echo hi");
  await composer.press("Enter");
  await expect(page.locator(".user-command", { hasText: "echo hi" })).toBeVisible();
  await composer.fill("read @not");
  await expect(paths).toBeVisible();
  await composer.press("Escape");
  await sendAndAwaitReply(page, () => composer.press("Enter"));

  await test.step("from the start of the box, ↑ steps back through this conversation's messages and commands, then the workspace's", async () => {
    await composer.fill("see @not");
    await expect(paths).toBeVisible();
    await composer.press("Escape");
    await caretToStart(composer);
    await composer.press("ArrowUp");
    await expect(composer).toHaveValue("read @not");
    await expect(paths).toBeHidden();
    await pressExpecting(composer, "ArrowUp", ["!echo hi", "first", "an earlier conversation's message", "an earlier conversation's message"]);
  });

  await test.step("↓ goes forward again, and past the newest back to the message being written", async () => {
    await pressExpecting(composer, "ArrowDown", ["first", "!echo hi", "read @not", "see @not", "see @not"]);
  });

  await test.step("editing a message brought back makes it the one being written", async () => {
    await caretToStart(composer);
    await composer.press("ArrowUp");
    await composer.press("End");
    await composer.pressSequentially(" now");
    await expect(composer).toHaveValue("read @not now");
    await composer.press("ArrowDown");
    await expect(composer).toHaveValue("read @not now");
    await caretToStart(composer);
    await pressExpecting(composer, "ArrowUp", ["read @not"]);
    await pressExpecting(composer, "ArrowDown", ["read @not now"]);
  });

  await test.step("a message comes back with its images, while those of the message being written wait aside", async () => {
    const pasted = page.locator(".pasted-images img");
    await composer.fill("what is ");
    await pasteImage(composer, { width: 300, height: 200 });
    await expect(pasted).toHaveJSProperty("naturalWidth", 300);
    await sendAndAwaitReply(page, () => composer.press("Enter"));
    await expect(pasted).toHaveCount(0);

    await composer.fill("draft ");
    await pasteImage(composer, { width: 120, height: 80, color: "#d65b5b" });
    await expect(pasted).toHaveJSProperty("naturalWidth", 120);
    await caretToStart(composer);
    await pressExpecting(composer, "ArrowUp", ["what is [Image #1] "]);
    await expect(pasted).toHaveJSProperty("naturalWidth", 300);
    await pressExpecting(composer, "ArrowDown", ["draft [Image #1] "]);
    await expect(pasted).toHaveJSProperty("naturalWidth", 120);

    await caretToStart(composer);
    await composer.press("ArrowUp");
    await sendAndAwaitReply(page, () => composer.press("Enter"));
    await expect(page.locator(".timeline:visible .message.user").last().locator(".message-images img")).toHaveJSProperty("naturalWidth", 300);
    expect(JSON.stringify(model.requests.at(-1))).toContain("data:image/png;base64,");
  });
});
