import { expect, test, type Page } from "@playwright/test";
import { chmodSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { addWorkspace, answerCanvasQuestion, createProfile, lastAgentMessage, sendMessage, signIn, startConversation, waitForTurnToEnd } from "./helpers.ts";
import { ScriptedModel, antigravityProgram, scriptedAntigravityEnvironment } from "./scripted-model.ts";
import { TestHost } from "./test-host.ts";

/** Short enough to outlast in a test, long enough for the user to answer in time when they do. */
const ASK_WAIT_MS = 10_000;
const host = new TestHost({ environment: { MIRADOR_ANTIGRAVITY_ASK_WAIT_MS: String(ASK_WAIT_MS) } });
const model = new ScriptedModel();
const PROFILE = "scripted Antigravity";
const CANVAS_INSTRUCTIONS = "The user finds long terminal text and ASCII diagrams hard to read";
const CANVAS_USE_GUIDANCE = "Pages are much easier for the user to read than long terminal text";
let page: Page;

test.describe.configure({ mode: "serial" });
test.skip(antigravityProgram() === null, "Antigravity e2e runs only where the Antigravity CLI, agy, is installed");
test.beforeAll(async ({ browser }) => {
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

test("an Antigravity conversation replies and shows a canvas page without asking permission", async () => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const dialog = await createProfile(page, PROFILE, scriptedAntigravityEnvironment(model, host.root), "", "Antigravity");
  await dialog.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${PROFILE} · Antigravity` });
  await startConversation(page);
  await expect(page.locator(".chat-header:visible .harness")).toHaveText("Antigravity");

  await sendMessage(page, "hello Antigravity");
  await waitForTurnToEnd(page);
  await expect(lastAgentMessage(page)).toContainText("Echo: hello Antigravity", { timeout: 60_000 });
  const systemPrompt = model.systemPromptInContext();
  expect(systemPrompt.split(CANVAS_INSTRUCTIONS).length - 1, "the canvas server's instructions reach the model once, in the system prompt").toBe(1);
  expect(systemPrompt, "canvas use is Often by default").toContain(CANVAS_USE_GUIDANCE);

  await sendMessage(page, "SHOW Scripted page");
  await expect(page.frameLocator(".canvas-panel:visible .canvas-frame.show iframe").locator("h1")).toHaveText("Scripted page", { timeout: 60_000 });
  await waitForTurnToEnd(page);
  await expect(page.locator(".permission")).toHaveCount(0);
  await expect(page.locator(".timeline:visible .tool-title", { hasText: "canvas · show" })).toHaveCount(1);
});

test("an Antigravity canvas question waits for the user's answer, which comes back as the tool's result", async () => {
  await sendMessage(page, "ASK Pick a colour");
  await answerCanvasQuestion(page, "Red");
  await waitForTurnToEnd(page);
  await expect(lastAgentMessage(page)).toContainText("Tool result:", { timeout: 60_000 });
  await expect(lastAgentMessage(page)).toContainText("Red");
});

test("an Antigravity canvas question left unanswered past Antigravity's tool call limit is answered as the next message", async () => {
  await sendMessage(page, "ASK Pick a late colour");
  await expect(lastAgentMessage(page)).toContainText("hasn't answered yet", { timeout: ASK_WAIT_MS + 60_000 });
  await waitForTurnToEnd(page);
  await expect(page.locator(".error-line")).toHaveCount(0);
  await answerCanvasQuestion(page, "Blue");
  await expect(lastAgentMessage(page)).toContainText('Echo: My answer to your question "Pick a late colour": Blue', { timeout: 60_000 });
});

test("an Antigravity shell command waits for the user's permission", async () => {
  await sendMessage(page, "RUN echo e2e-shell-output");
  const permission = page.locator(".permission.pending");
  await expect(permission).toBeVisible({ timeout: 60_000 });
  await permission.locator("button.option-allow_once").click();
  await waitForTurnToEnd(page);
  await expect(lastAgentMessage(page)).toContainText("e2e-shell-output");
});

test("an Antigravity conversation continues after a host restart, with its history shown once", async () => {
  await startConversation(page);
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
  await expect(page.locator(".message.agent", { hasText: "Echo: remember the word zebrafish" })).toHaveCount(1);
});

test("a profile's AGY_PATH is the agy that runs", async () => {
  test.skip(process.platform === "win32", "the stand-in is a shell script");
  const wrapper = join(host.root, "agy-path-wrapper");
  const ran = join(host.root, "agy-path-ran");
  writeFileSync(wrapper, `#!/bin/sh\ntouch "${ran}"\nexec "${antigravityProgram()}" "$@"\n`);
  chmodSync(wrapper, 0o755);
  const name = "Antigravity by path";
  const dialog = await createProfile(page, name, `${scriptedAntigravityEnvironment(model, host.root)}\nAGY_PATH=${wrapper}`, "", "Antigravity");
  await dialog.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${name} · Antigravity` });
  await startConversation(page);
  await sendMessage(page, "hello by path");
  await waitForTurnToEnd(page);
  await expect(lastAgentMessage(page)).toContainText("Echo: hello by path", { timeout: 60_000 });
  expect(existsSync(ran)).toBe(true);
});
