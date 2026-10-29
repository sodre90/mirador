import { expect, test, type Locator, type Page } from "@playwright/test";
import { agentEnvironment } from "../host/acp/environment.ts";
import { applyEnvironment, parseEnvironment } from "../shared/profile-environment.ts";
import {
  addWorkspace,
  answerCanvasQuestion,
  createProfile,
  dragOnto,
  lastAgentMessage,
  openCanvasHistory,
  openFromCanvasHistory,
  pasteImage,
  sendMessage,
  signIn,
  startConversation,
  waitForTurnToEnd,
} from "./helpers.ts";
import { SPARE_MODELS, ScriptedModel, opencodeProgram, scriptedOpencodeEnvironment } from "./scripted-model.ts";
import { TestHost, spawnProgram } from "./test-host.ts";

const host = new TestHost();
const model = new ScriptedModel();
const PROFILE = "scripted opencode";
const MARKER = "opencode-terminal-marker-17";

/**
 * What a user does in a terminal: `opencode run` in the project directory, with the same isolated opencode setup.
 * opencode takes the session directory from $PWD, which a shell sets and a spawned child otherwise inherits from its parent.
 */
async function runOpencodeInTerminal(prompt: string) {
  const isolated = applyEnvironment(agentEnvironment(), parseEnvironment(scriptedOpencodeEnvironment(model, host.root)));
  const env = { ...isolated, PWD: host.projectDirInTerminal };
  const opencode = spawnProgram(opencodeProgram(), ["run", "--standalone", "--model", "e2e/scripted", prompt], { cwd: host.projectDirInTerminal, env, stdio: "ignore" });
  const exitCode = await new Promise((resolve) => opencode.once("exit", resolve));
  expect(exitCode).toBe(0);
}

test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  await model.start();
  await host.start();
  await runOpencodeInTerminal(`${MARKER}: remember the number 17`);
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
  model.stop();
});

const innerOverflowOf = (frame: Locator) =>
  frame.contentFrame().locator("html").evaluate((html) => html.scrollHeight - html.clientHeight);

async function chooseScriptedOpencode(page: Page) {
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${PROFILE} · opencode` });
}

test("an opencode conversation asks for permission in the browser and uses the canvas tools", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const dialog = await createProfile(page, PROFILE, scriptedOpencodeEnvironment(model, host.root), "", "opencode");
  await dialog.getByRole("button", { name: "Close" }).click();
  await chooseScriptedOpencode(page);
  await startConversation(page);
  await expect(page.locator(".chat-header:visible .harness")).toHaveText("opencode");
  await expect(page.getByLabel("Profile", { exact: true }).locator("option:checked")).toHaveText(PROFILE);
  const modelPicker = page.getByRole("button", { name: "Model", exact: true });
  await expect(modelPicker).toHaveText("e2e/Scripted");
  await modelPicker.click();
  const search = page.getByRole("combobox", { name: "Search model choices" });
  await expect(search).toBeFocused();
  const choices = page.getByRole("listbox", { name: "Model choices" });
  await expect(choices.getByRole("option")).toHaveCount(1 + SPARE_MODELS);
  await search.fill("spare 7");
  await expect(choices.getByRole("option")).toHaveCount(2);
  await expect(choices.getByRole("group", { name: "Spare" }).getByRole("option", { name: "Spare model 17" })).toBeVisible();
  await search.fill("scripted");
  await expect(choices.getByRole("group", { name: "e2e" }).getByRole("option", { name: "Scripted", selected: true })).toBeVisible();
  await search.press("Enter");
  await expect(search).toHaveCount(0);
  await expect(modelPicker).toBeFocused();
  await expect(modelPicker).toHaveText("e2e/Scripted");

  await sendMessage(page, "RUN echo e2e-bash-output");
  const permission = page.locator(".permission.pending");
  await expect(permission).toBeVisible({ timeout: 60_000 });
  await expect(permission.locator(".shell-typed")).toHaveText("echo e2e-bash-output");
  const shell = page.locator(".shell");
  await expect(shell.locator(".shell-quiet")).toHaveText("waiting for your approval…");
  await permission.locator("button.option-allow_once").click();
  await waitForTurnToEnd(page);
  await expect(lastAgentMessage(page)).toContainText("Tool result: e2e-bash-output");
  await expect(shell.locator(".shell-description")).toHaveText("Run the scripted command");
  await expect(shell.locator(".shell-typed")).toHaveText("echo e2e-bash-output");
  await expect(shell.locator(".shell-output")).toHaveText("e2e-bash-output");
  await expect(shell.locator(".shell-exit")).toHaveCount(0);
  const meter = page.locator(".context-meter");
  await expect(meter).toHaveText("43% · 42.5k / 100k");
  await meter.hover();
  await expect(page.getByRole("tooltip")).toContainText("Context window: 42,500 of 100,000 tokens in use (43%).");

  await sendMessage(page, "SHOW Scripted page");
  await expect(page.frameLocator(".canvas-panel:visible .canvas-frame.show iframe").locator("h1")).toHaveText("Scripted page", { timeout: 60_000 });
  await waitForTurnToEnd(page);

  await sendMessage(page, "ASK Pick a color");
  const context = page.locator(".canvas-frame.ask-context iframe");
  await expect(context.contentFrame().locator("h2")).toHaveText("Why this matters", { timeout: 60_000 });
  await expect.poll(() => innerOverflowOf(context)).toBe(0);
  expect((await context.boundingBox())!.height).toBeGreaterThan(600);
  const preview = page.locator(".canvas-frame.ask-preview iframe");
  await expect.poll(() => innerOverflowOf(preview)).toBe(0);
  expect((await preview.boundingBox())!.height).toBeLessThan(200);
  await expect(page.locator(".ask").getByRole("button", { name: "Submit" })).toBeDisabled();
  await answerCanvasQuestion(page, "Blue");
  await expect(page.locator(".settled-note")).toHaveText("✓ Answer sent: “Blue”");
  await expect(page.locator(".ask")).toHaveCount(0);
  await waitForTurnToEnd(page);
  await expect(lastAgentMessage(page)).toContainText("Blue");

  const history = await openCanvasHistory(page);
  await expect(history.locator(".history-entry")).toHaveText([/Pick a color\s*→ Blue/, /Scripted page/]);
  await openFromCanvasHistory(page, "Pick a color");
  await expect(history).toBeHidden();
  await expect(page.locator(".ask-answer")).toContainText("You chose Blue");
  await expect(page.locator(".ask").getByRole("radio", { name: "Blue" })).toBeChecked();
  await page.getByRole("button", { name: "Older" }).click();
  await expect(page.locator(".canvas-title")).toHaveText("Scripted page");
  await expect(page.frameLocator(".canvas-panel:visible .canvas-frame.show iframe").locator("h1")).toHaveText("Scripted page");
  await expect(page.getByRole("button", { name: "Older" })).toBeDisabled();
  await page.getByRole("button", { name: "Newer" }).click();
  await expect(page.locator(".canvas-title")).toHaveText("Pick a color");
  await page.getByRole("button", { name: "Clear" }).click();
  await expect(page.locator(".canvas-body")).toContainText("Nothing on the canvas right now");
  await expect(page.getByRole("button", { name: "Clear" })).toBeDisabled();
});

test("continuing an opencode session from a terminal gives the agent its earlier context", async ({ page }) => {
  await signIn(page, host);
  await expect(page.getByLabel("Agent", { exact: true })).toHaveValue(/.+/);
  await chooseScriptedOpencode(page);
  await page.getByRole("button", { name: "Continue a session…" }).click();
  const dialog = page.getByRole("dialog", { name: "Continue a session" });
  await expect(dialog).toContainText("opencode sessions started in");
  const terminalSession = dialog.locator(".session-list li", { has: page.getByRole("button", { name: "Continue" }) });
  await expect(terminalSession).toHaveCount(1, { timeout: 30_000 });
  await terminalSession.getByRole("button", { name: "Continue" }).click();

  await expect(page.locator(".timeline:visible")).toContainText(MARKER, { timeout: 30_000 });
  await sendMessage(page, "Tell me what I asked you to remember");
  await waitForTurnToEnd(page);
  await expect(lastAgentMessage(page)).toContainText("Echo: Tell me what I asked you to remember");
  const lastRequest = model.requests.at(-1)!;
  expect(JSON.stringify(lastRequest.messages)).toContain(MARKER);
});

test("an opencode conversation moves to another opencode profile and keeps its context", async ({ page }) => {
  await signIn(page, host);
  const saved = await createProfile(page, "scripted opencode 2", scriptedOpencodeEnvironment(model, host.root), "", "opencode");
  await saved.getByRole("button", { name: "Close" }).click();
  await page.locator(".workspace li", { hasText: "RUN echo e2e-bash-output" }).click();
  await page.getByLabel("Profile", { exact: true }).selectOption({ label: "scripted opencode 2" });
  await expect(page.locator(".timeline:visible")).toContainText("Now using the profile “scripted opencode 2”");

  await sendMessage(page, "after the switch");
  await waitForTurnToEnd(page);
  await expect(lastAgentMessage(page)).toContainText("Echo: after the switch");
  expect(JSON.stringify(model.requests.at(-1)!.messages)).toContain("Pick a color");
  await expect(page.locator(".timeline:visible")).not.toContainText("Could not resume");
});

test("with YOLO on, tools run without asking, and switching it on approves the request already waiting", async ({ page }) => {
  await signIn(page, host);
  await chooseScriptedOpencode(page);
  await startConversation(page);
  const yolo = page.getByLabel("YOLO", { exact: true });
  await expect(yolo).not.toBeChecked();
  await yolo.hover();
  const hint = page.getByRole("tooltip");
  await expect(hint).toContainText('the host answers with the agent\'s own "allow" option');
  await page.getByLabel("Questions").hover();
  await expect(hint).toContainText("What happens when the agent asks you something");
  await page.locator(".chat-header:visible h2").hover();
  await expect(hint).toBeHidden();

  await sendMessage(page, "RUN echo approved-by-yolo");
  await expect(page.locator(".permission.pending")).toBeVisible({ timeout: 60_000 });
  await yolo.click();
  await expect(yolo).toBeChecked();
  await expect(lastAgentMessage(page)).toContainText("Tool result: approved-by-yolo", { timeout: 60_000 });
  await waitForTurnToEnd(page);

  await sendMessage(page, "RUN echo no-questions-asked");
  await expect(lastAgentMessage(page)).toContainText("Tool result: no-questions-asked", { timeout: 60_000 });
  await expect(page.locator(".permission")).toHaveCount(1);
  await page.reload();
  await expect(page.getByLabel("YOLO", { exact: true })).toBeChecked();
});

test("messages sent while the agent works wait in a queue that can be edited and reordered, and go out when the turn ends", async ({ page }) => {
  await signIn(page, host);
  await chooseScriptedOpencode(page);
  await startConversation(page);
  await sendMessage(page, "ASK Pick a color");
  await expect(page.locator(".ask").getByRole("radio", { name: "Blue" })).toBeVisible({ timeout: 60_000 });

  const composer = page.locator(".composer:visible textarea");
  const queued = page.locator(".queue .queued-text");
  await composer.fill("first queued");
  await composer.press("Enter");
  await composer.fill("second queued");
  await page.getByRole("button", { name: "Queue" }).click();
  await expect(queued).toHaveText(["first queued", "second queued"]);
  await expect(composer).toHaveValue("");

  await composer.press("ArrowUp");
  await expect(composer).toHaveValue("second queued");
  await expect(queued).toHaveText(["first queued"]);
  await composer.press("Enter");
  await page.locator(".queued", { hasText: "first queued" }).getByRole("button", { name: "Edit" }).click();
  await expect(composer).toHaveValue("first queued");
  await composer.fill("first queued, edited");
  await composer.press("Enter");
  await expect(queued).toHaveText(["second queued", "first queued, edited"]);
  const queuedMessage = (text: string) => page.locator(".queued", { hasText: text });
  await dragOnto(page, queuedMessage("first queued, edited").locator(".queued-grip"), queuedMessage("second queued"), "top");
  await expect(queuedMessage("second queued")).toHaveClass(/drop-before/);
  await page.mouse.up();
  await expect(queued).toHaveText(["first queued, edited", "second queued"]);
  await queuedMessage("second queued").getByRole("button", { name: "Remove" }).click();
  await expect(queued).toHaveText(["first queued, edited"]);

  await answerCanvasQuestion(page, "Blue");
  await expect(page.locator(".timeline:visible .message.user").last()).toHaveText("first queued, edited", { timeout: 60_000 });
  await expect(lastAgentMessage(page)).toContainText("Echo: first queued, edited", { timeout: 60_000 });
  await expect(page.locator(".queue")).toHaveCount(0);
  await waitForTurnToEnd(page);

  await composer.fill("a draft I haven't sent");
  await startConversation(page);
  await expect(page.locator(".composer:visible textarea")).toHaveValue("");
  await page.locator(".workspace li", { hasText: "ASK Pick a color" }).click();
  await expect(page.locator(".composer:visible textarea")).toHaveValue("a draft I haven't sent");
});

test("deleting a conversation while its agent works ends the turn quietly", async ({ page }) => {
  await signIn(page, host);
  await chooseScriptedOpencode(page);
  await startConversation(page);
  await sendMessage(page, "ASK Pick a shape");
  await expect(page.locator(".ask")).toBeVisible({ timeout: 60_000 });
  const deleteButton = page.locator(".workspace li.selected").getByRole("button", { name: "Delete conversation" });
  await deleteButton.click();
  await expect(deleteButton).toHaveText("Delete?");
  await expect(page.locator(".chat-header")).toHaveCount(1);
  await deleteButton.click();
  await expect(page.locator(".chat-header")).toHaveCount(0);
  await page.waitForTimeout(1_000);
  await expect(page.locator(".notice")).toHaveText([]);
});

test("an image pasted into the message box goes to the agent with the message and stays in the transcript", async ({ page }) => {
  await signIn(page, host);
  await chooseScriptedOpencode(page);
  await startConversation(page);
  const composer = page.locator(".composer:visible textarea");
  await composer.fill("what is in ");
  await pasteImage(composer, { width: 300, height: 200 });
  await expect(composer).toHaveValue("what is in [Image #1] ");
  await expect(page.locator(".pasted-images img")).toHaveJSProperty("naturalWidth", 300);
  await page.keyboard.type("this picture?");
  await composer.press("Enter");

  await expect(lastAgentMessage(page)).toContainText("Echo: what is in [Image #1] this picture?", { timeout: 60_000 });
  expect(JSON.stringify(model.requests.at(-1))).toContain("data:image/png;base64,");
  await expect(page.locator(".pasted-images")).toHaveCount(0);
  const sent = page.locator(".message.user .message-images img");
  await expect(sent).toHaveJSProperty("naturalWidth", 300);
  const overhang = await sent.evaluate((image) => image.getBoundingClientRect().bottom - image.closest(".timeline-entry")!.getBoundingClientRect().bottom);
  expect(overhang).toBeLessThanOrEqual(0);
  await page.locator(".message.user .thumbnail").click();
  await expect(page.getByRole("dialog", { name: "Image" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Image" })).toHaveCount(0);

  await page.reload();
  await expect(sent).toHaveJSProperty("naturalWidth", 300);
});
