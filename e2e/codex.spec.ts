import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, answerCanvasQuestion, createProfile, eventsInOrderOn, lastAgentMessage, sendMessage, signIn, startConversation, waitForTurnToEnd } from "./helpers.ts";
import { ScriptedModel, codexProgram, scriptedCodexEnvironment } from "./scripted-model.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();
const model = new ScriptedModel();
const PROFILE = "scripted Codex";
const STEERED = "Also say which day it is";
let page: Page;

test.describe.configure({ mode: "serial" });
/** The owner may not run Codex on every machine that has it, so the spec runs only where it is asked to. */
test.skip(process.env.MIRADOR_E2E_CODEX !== "1" || codexProgram() === null, "Codex e2e runs only with MIRADOR_E2E_CODEX=1 and codex installed");
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

const canvasHeading = () => page.frameLocator(".canvas-panel:visible .canvas-frame.show iframe").locator("h1");
const CANVAS_RENDERING_RULES = "Rendering environment: every page renders in a sandboxed iframe with NO network access";

test("a Codex conversation replies, runs commands and uses the canvas tools", async () => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const dialog = await createProfile(page, PROFILE, scriptedCodexEnvironment(model, host.root), "", "Codex");
  await dialog.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${PROFILE} · Codex` });
  await startConversation(page);
  await expect(page.locator(".chat-header:visible .harness")).toHaveText("Codex");

  await sendMessage(page, "Hello Codex");
  await waitForTurnToEnd(page);
  await expect(lastAgentMessage(page)).toHaveText("Echo: Hello Codex");
  await expect(page.locator(".message.agent")).toHaveCount(1);
  expect(model.toolDescription("when_done")).toContain("Have Mirador wait for a job you leave running");

  await sendMessage(page, "RUN echo codex-shell-output");
  await waitForTurnToEnd(page);
  await expect(page.locator(".shell-output").last()).toHaveText("codex-shell-output");

  await sendMessage(page, "SHOW Scripted page");
  await expect(canvasHeading()).toHaveText("Scripted page", { timeout: 60_000 });
  await waitForTurnToEnd(page);
  await expect(page.locator(".timeline:visible .tool-title").last()).toHaveText("canvas · show");

  await sendMessage(page, "ASK Pick a color");
  await answerCanvasQuestion(page, "Blue");
  await expect(page.locator(".settled-note")).toHaveText("✓ Answer sent: “Blue”");
  await waitForTurnToEnd(page);
  await expect(lastAgentMessage(page)).toContainText("Blue");
});

test("Codex hears the canvas server's instructions with the canvas tools", () => {
  expect(model.namespaceDescription("mcp__canvas")).toContain(CANVAS_RENDERING_RULES);
});

test("a command Codex runs messages its own conversation with mirador message, and Codex reads it", async () => {
  const fromCodexCommand = "The Codex build finished.";
  /** By its path: an agent's PATH has Mirador's own bin last, after any mirador the user installed. */
  const mirador = resolve(process.platform === "win32" ? "bin/mirador.cmd" : "bin/mirador");
  /** Codex runs commands in PowerShell on Windows, where a quoted path is a string until & calls it. */
  const call = process.platform === "win32" ? "& " : "";
  await sendMessage(page, `RUN ${call}'${mirador}' message "${fromCodexCommand}"`);
  const messagesFromScripts = page.locator(".timeline-entry", { has: page.locator(".author", { hasText: "From a script" }) }).locator(".message.user");
  await expect(messagesFromScripts).toHaveText([fromCodexCommand], { timeout: 30_000 });
  await expect(lastAgentMessage(page)).toContainText(`Echo: ${fromCodexCommand}`, { timeout: 30_000 });
  await waitForTurnToEnd(page);
});

test("a message sent with Enter while Codex runs a command joins its turn once the command finishes", async () => {
  const eventsInOrder = eventsInOrderOn(page);
  await page.reload();
  await expect(page.locator(".chat-header:visible .harness")).toHaveText("Codex");
  await sendMessage(page, "RUN sleep 5; echo slept");
  await expect(page.locator(".timeline:visible").locator(".tool-pending, .tool-in_progress").first()).toBeVisible({ timeout: 60_000 });
  model.hold();

  const composer = page.locator(".composer:visible textarea");
  await composer.fill(STEERED);
  await composer.press("Enter");
  await expect(page.locator(".queued-delivery")).toHaveText(["joins the turn"]);
  await expect(page.locator(".timeline:visible .message.user").last()).toHaveText(STEERED, { timeout: 60_000 });
  await expect(page.locator(".queue")).toHaveCount(0);
  model.answerHeld();

  await waitForTurnToEnd(page);
  await expect(lastAgentMessage(page)).toContainText(`Echo: ${STEERED}`);
  expect(eventsInOrder).toEqual(["RUN sleep 5; echo slept", STEERED, "turn-end"]);
});

const codexQuestions = {
  questions: [
    { id: "color", header: "Color", question: "Which color?", options: [{ label: "Red", description: "Warm" }, { label: "Blue", description: "Cool" }] },
    { id: "finish", header: "Finish", question: "Which finish?", options: [{ label: "Gloss", description: "Shiny" }, { label: "Satin", description: "Soft" }] },
  ],
};

test("in Plan mode Codex's questions show as a canvas question, and Codex hears each answer, the user's own words too", async () => {
  await page.getByLabel("Collaboration mode").selectOption("plan");
  await sendMessage(page, `QUESTIONS ${JSON.stringify(codexQuestions)}`);
  const ask = page.locator(".ask");
  await ask.getByRole("radio", { name: "Red", exact: true }).check({ timeout: 60_000 });
  await ask.getByRole("button", { name: "Next" }).click();
  await expect(ask.getByRole("heading", { name: "Which finish?" })).toBeVisible();
  await ask.getByRole("textbox", { name: /note/i }).fill("for the kitchen");
  const ownAnswer = ask.getByRole("textbox", { name: "Your own answer" });
  await ownAnswer.fill("Matte");
  await ownAnswer.press("Enter");
  await ask.getByRole("button", { name: "Submit" }).click();
  await waitForTurnToEnd(page);
  const toolResult = lastAgentMessage(page);
  await expect(toolResult).toContainText('"color":{"answers":["Red"]}');
  await expect(toolResult).toContainText('"finish":{"answers":["None of the above","user_note: Matte","user_note: for the kitchen"]}');
});
