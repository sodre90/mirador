import { expect, test, type Page } from "@playwright/test";
import { chmodSync, cpSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { addWorkspace, createProfile, lastAgentMessage, openSettings, pasteImage, sendMessage, signIn, startConversation, waitForTurnToEnd } from "./helpers.ts";
import { ScriptedModel, copilotProgram, scriptedCopilotEnvironment } from "./scripted-model.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();
const model = new ScriptedModel();
const PROFILE = "scripted Copilot";
const CANVAS_INSTRUCTIONS = "The user finds long terminal text and ASCII diagrams hard to read";
const CANVAS_USE_GUIDANCE = "Pages are much easier for the user to read than long terminal text";
const CANVAS_USE_LABEL = "Claude Code, pi, Codex, Copilot and Antigravity use the canvas";
let page: Page;

test.describe.configure({ mode: "serial" });
test.skip(copilotProgram() === null, "Copilot e2e runs only where the Copilot CLI is installed");
test.beforeAll(async ({ browser }) => {
  cpSync(join(import.meta.dirname, "..", "tests", "fixtures", "canvas-plugins", "board"), join(host.dataDir, "plugins", "board"), { recursive: true });
  await model.start();
  await host.start();
  page = await browser.newPage();
});
test.afterAll(async () => {
  await page.close();
  await host.stop();
  await host.cleanUp();
  model.stop();
});

test("a Copilot conversation replies and shows a canvas page without asking permission", async () => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const dialog = await createProfile(page, PROFILE, scriptedCopilotEnvironment(model, host.root), "", "Copilot");
  await dialog.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${PROFILE} · Copilot` });
  await startConversation(page, { withModels: false });
  await expect(page.locator(".chat-header:visible .harness")).toHaveText("Copilot");

  await sendMessage(page, "hello Copilot");
  await waitForTurnToEnd(page);
  await expect(lastAgentMessage(page)).toContainText("Echo:", { timeout: 60_000 });
  await expect(lastAgentMessage(page)).toContainText("hello Copilot");
  const requestText = JSON.stringify(model.requests);
  expect(requestText, "the canvas server's instructions reach the model").toContain(CANVAS_INSTRUCTIONS);
  expect(requestText, "canvas use is Often by default").toContain(CANVAS_USE_GUIDANCE);

  await sendMessage(page, "SHOW Scripted page");
  await expect(page.frameLocator(".canvas-panel:visible .canvas-frame.show iframe").locator("h1")).toHaveText("Scripted page", { timeout: 60_000 });
  await waitForTurnToEnd(page);
  await expect(page.locator(".permission")).toHaveCount(0);
});

test("a Copilot shell command waits for the user's permission", async () => {
  await sendMessage(page, "RUN echo e2e-bash-output");
  const permission = page.locator(".permission.pending");
  await expect(permission).toBeVisible({ timeout: 60_000 });
  await permission.locator("button.option-allow_once").click();
  await waitForTurnToEnd(page);
  await expect(lastAgentMessage(page)).toContainText("e2e-bash-output");
});

test("an image pasted into a Copilot conversation reaches the model", async () => {
  const composer = page.locator(".composer:visible textarea");
  await composer.fill("what is in ");
  await pasteImage(composer, { width: 300, height: 200 });
  await expect(composer).toHaveValue("what is in [Image #1] ");
  await page.keyboard.type("this picture");
  await composer.press("Enter");
  await waitForTurnToEnd(page);
  await expect(lastAgentMessage(page)).toContainText("what is in", { timeout: 60_000 });
  expect(JSON.stringify(model.requests.at(-1))).toContain("data:image/png;base64,");
});

test("a profile's COPILOT_PATH is the Copilot that runs", async () => {
  test.skip(process.platform === "win32", "the stand-in is a shell script");
  const wrapper = join(host.root, "copilot-path-wrapper");
  const ran = join(host.root, "copilot-path-ran");
  writeFileSync(wrapper, `#!/bin/sh\ntouch "${ran}"\nexec "${copilotProgram()}" "$@"\n`);
  chmodSync(wrapper, 0o755);
  const name = "Copilot by path";
  const dialog = await createProfile(page, name, `${scriptedCopilotEnvironment(model, host.root)}\nCOPILOT_PATH=${wrapper}`, "", "Copilot");
  await dialog.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${name} · Copilot` });
  await startConversation(page, { withModels: false });
  await sendMessage(page, "hello by path");
  await waitForTurnToEnd(page);
  await expect(lastAgentMessage(page)).toContainText("Echo:", { timeout: 60_000 });
  expect(existsSync(ran)).toBe(true);
});

test("with the canvas used as needed, Copilot hears the canvas instructions without the canvas use guidance", async () => {
  const settings = await openSettings(page, "Canvas");
  await settings.getByLabel(CANVAS_USE_LABEL).selectOption({ label: "As needed" });
  await settings.getByRole("button", { name: "Close" }).click();
  try {
    await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${PROFILE} · Copilot` });
    await startConversation(page, { withModels: false });
    const before = model.requests.length;
    await sendMessage(page, "hello as needed");
    await waitForTurnToEnd(page);
    await expect(lastAgentMessage(page)).toContainText("hello as needed", { timeout: 60_000 });
    const requestText = JSON.stringify(model.requests.slice(before));
    expect(requestText).toContain(CANVAS_INSTRUCTIONS);
    expect(requestText).not.toContain(CANVAS_USE_GUIDANCE);
  } finally {
    const again = await openSettings(page, "Canvas");
    await again.getByLabel(CANVAS_USE_LABEL).selectOption({ label: "Often" });
    await again.getByRole("button", { name: "Close" }).click();
  }
});

test("a canvas plugin's tool runs in a Copilot conversation without asking permission", async () => {
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${PROFILE} · Copilot` });
  await startConversation(page, { withModels: false });
  await sendMessage(page, 'CALL show_card {"title": "Plugin card", "text": "from the plugin"}');
  await expect(page.locator(".canvas-header:visible .canvas-title")).toHaveText("Plugin card", { timeout: 60_000 });
  await waitForTurnToEnd(page);
  await expect(page.locator(".permission:visible")).toHaveCount(0);
});

test("a Copilot conversation continues after a host restart, with its history loaded once", async () => {
  await startConversation(page, { withModels: false });
  await sendMessage(page, "remember the word zebrafish");
  await waitForTurnToEnd(page);
  await expect(lastAgentMessage(page)).toContainText("zebrafish", { timeout: 60_000 });

  await host.restart();
  await expect(page.locator(".banner")).toHaveCount(0, { timeout: 30_000 });
  const before = model.requests.length;
  await sendMessage(page, "and what was the word");
  await waitForTurnToEnd(page);
  await expect(lastAgentMessage(page)).toContainText("and what was the word", { timeout: 60_000 });
  expect(JSON.stringify(model.requests.slice(before)), "the first turn is still in the model's context").toContain("zebrafish");
  await expect(page.locator(".error-line")).toHaveCount(0);
  await expect(page.locator(".message.user", { hasText: "remember the word zebrafish" })).toHaveCount(1);
});
