import { execFileSync, spawn } from "node:child_process";
import { realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { agentEnvironment } from "../host/acp/environment.ts";
import { applyEnvironment, parseEnvironment } from "../shared/profile-environment.ts";
import { addWorkspace, answerCanvasQuestion, createProfile, eventsInOrderOn, lastAgentMessage, pasteImage, reloadFromRestartedHost, sendMessage, signIn, startConversation, waitForTurnToEnd } from "./helpers.ts";
import { ScriptedModel, forgetPiAcpSessionsUnder, piProgram, scriptedPiEnvironment } from "./scripted-model.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();
const model = new ScriptedModel();
const PROFILE = "scripted pi";
const SLOW_PROFILE = "slow scripted pi";
const OTHER_PROFILE = "other scripted pi";
const SLOW_PI_START_SECONDS = 3;
const STEERED = "Also say which day it is";
const STEERED_BEFORE_STOP = "Also say which month it is";
const STEERED_INTO_STOPPED_TURN = "Also say which year it is";
const TERMINAL_MARKER = "pi-terminal-marker-17";
const SLOWLY_CONTINUED_MARKER = "pi-slowly-continued-marker-23";
let page: Page;
let firstConversationId: string;

test.describe.configure({ mode: "serial" });
test.skip(piProgram() === null, "pi is not installed");
test.beforeAll(async ({ browser }) => {
  await model.start();
  await host.start();
  page = await browser.newPage();
});
test.afterAll(async () => {
  await page.close();
  await host.stop();
  forgetPiAcpSessionsUnder(realpathSync(host.root));
  forgetPiAcpSessionsUnder(host.root);
  await host.cleanUp();
  model.stop();
});

const canvasHeading = () => page.frameLocator(".canvas-panel:visible .canvas-frame.show iframe").locator("h1");
const CANVAS_RENDERING_RULES = "Rendering environment: every page renders in a sandboxed iframe with NO network access";
const OWN_APPENDED_INSTRUCTIONS = "Instructions from the user's own APPEND_SYSTEM.md";

/** On Windows pi keeps its command line, with each argument quoted, and a pi whose cmd.exe ended is still counted. */
function windowsPiProcesses() {
  const query = "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object CommandLine -match '--mode\\W+rpc' | ForEach-Object ProcessId";
  return execFileSync("powershell", ["-NoProfile", "-Command", query], { encoding: "utf8" }).split(/\s+/).filter(Boolean);
}

/**
 * A session of the profile's pi started in a terminal in the workspace. Not synchronous: the scripted model answering
 * it runs in this process. The prompt has no spaces, as Windows runs pi.cmd through a shell.
 */
async function runPiInTerminal(prompt: string) {
  const env = applyEnvironment(agentEnvironment(), parseEnvironment(scriptedPiEnvironment(model, host.root)));
  const pi = spawn(piProgram()!, ["-p", prompt], { cwd: host.projectDir, env, stdio: "ignore", shell: process.platform === "win32" });
  expect(await new Promise((resolve, reject) => pi.once("exit", resolve).once("error", reject))).toBe(0);
}

/** Each profile has its pi-acp, which runs one pi for each session it has open; pi renames its process, so they are told by their parent. */
function piSessionProcesses() {
  if (process.platform === "win32") return windowsPiProcesses();
  const processes = execFileSync("ps", ["-A", "-o", "pid=,ppid=,command="], { encoding: "utf8" })
    .trim()
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .map(([pid, parentPid, ...command]) => ({ pid: Number(pid), parentPid: Number(parentPid), command: command.join(" ") }));
  const piAcps = new Set(processes.filter(({ parentPid, command }) => parentPid === host.pid && command.includes("pi-acp")).map(({ pid }) => pid));
  return processes.filter(({ parentPid }) => piAcps.has(parentPid));
}

/** As a crash would: pi-acp gets no say in it. */
function killPiSessionProcesses() {
  piSessionProcesses().forEach((pi) => process.kill(typeof pi === "string" ? Number(pi) : pi.pid, "SIGKILL"));
}

async function rewindTo(message: string) {
  const turn = page.locator(".timeline:visible .timeline-entry").filter({ has: page.locator(".message.user").getByText(message, { exact: true }) });
  await turn.hover();
  await turn.locator(".undo-files").click();
  const dialog = page.getByRole("dialog", { name: "Rewind to here" });
  await dialog.getByRole("button", { name: "Rewind", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(turn).toHaveCount(0);
}

test("a pi conversation replies, runs commands and uses the canvas tools", async () => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const dialog = await createProfile(page, PROFILE, scriptedPiEnvironment(model, host.root), "", "pi");
  writeFileSync(join(host.root, "pi-agent", "APPEND_SYSTEM.md"), OWN_APPENDED_INSTRUCTIONS);
  await dialog.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${PROFILE} · pi` });
  firstConversationId = await startConversation(page);
  await expect(page.locator(".chat-header:visible .harness")).toHaveText("pi");

  await sendMessage(page, "Hello pi");
  await waitForTurnToEnd(page);
  await expect(lastAgentMessage(page)).toContainText("Echo: Hello pi");
  await expect(page.locator(".message.agent")).toHaveCount(1);
  expect(model.systemPromptInContext()).toContain(CANVAS_RENDERING_RULES);
  expect(model.systemPromptInContext()).toContain(OWN_APPENDED_INSTRUCTIONS);
  expect(model.toolDescription("when_done")).toContain("Have Mirador wait for a job you leave running");

  await sendMessage(page, "RUN printenv PI_ACP_SESSION || echo no-canvas-servers-in-env");
  await waitForTurnToEnd(page);
  await expect(page.locator(".shell-output").last()).toHaveText("no-canvas-servers-in-env");

  await sendMessage(page, "SHOW Scripted page");
  await expect(canvasHeading()).toHaveText("Scripted page", { timeout: 60_000 });
  await waitForTurnToEnd(page);

  await sendMessage(page, "ASK Pick a color");
  await answerCanvasQuestion(page, "Blue");
  await expect(page.locator(".settled-note")).toHaveText("✓ Answer sent: “Blue”");
  await waitForTurnToEnd(page);
  await expect(lastAgentMessage(page)).toContainText("Blue");
});

test("a command pi runs messages its own conversation with mirador message, and pi reads it", async () => {
  const fromPisCommand = "The pi build finished.";
  /** By its path: an agent's PATH has Mirador's own bin last, after any mirador the user installed. */
  const mirador = resolve("bin/mirador");
  await sendMessage(page, `RUN '${mirador}' message "${fromPisCommand}"`);
  const messagesFromScripts = page.locator(".timeline-entry", { has: page.locator(".author", { hasText: "From a script" }) }).locator(".message.user");
  await expect(messagesFromScripts).toHaveText([fromPisCommand], { timeout: 30_000 });
  await expect(lastAgentMessage(page)).toContainText(`Echo: ${fromPisCommand}`, { timeout: 30_000 });
  await waitForTurnToEnd(page);
});

test("a pi command's output past what pi keeps of it shows each line once, as pi keeps only its last lines", async () => {
  const lastLine = 2520;
  await sendMessage(page, `RUN seq 1 2500; for i in $(seq 2501 ${lastLine}); do echo $i; sleep 0.2; done`);
  await waitForTurnToEnd(page);
  const card = page.locator(".timeline .shell").last();
  await card.locator("summary").click();
  await card.locator(".shell-more").click();
  const output = card.locator(".shell-output");
  await expect(output).toContainText(String(lastLine));
  const timesShown = (line: number) => output.evaluate((element, line) => element.textContent!.split("\n").filter((shown) => shown === String(line)).length, line);
  for (const line of [2501, 2510, lastLine]) expect(await timesShown(line)).toBe(1);
});

test("a second pi conversation on the same profile leaves the first one working", async () => {
  await startConversation(page);
  await expect(page.locator(".chat-header:visible .harness")).toHaveText("pi");
  await sendMessage(page, "SHOW Second page");
  await expect(canvasHeading()).toHaveText("Second page", { timeout: 60_000 });
  await waitForTurnToEnd(page);

  await page.locator(".workspace li", { hasText: "Hello pi" }).click();
  await sendMessage(page, "Still there");
  await waitForTurnToEnd(page);
  await expect(lastAgentMessage(page)).toContainText("Echo: Still there");
});

test("deleting a pi conversation in the middle of a turn ends its pi process quietly, and the other one goes on", async () => {
  await expect.poll(piSessionProcesses).toHaveLength(2);
  await page.locator(".workspace li", { hasText: "Second page" }).click();
  await sendMessage(page, "ASK Pick a size");
  await expect(page.locator(".ask")).toBeVisible({ timeout: 60_000 });
  const deleteButton = page.locator(".workspace li.selected").getByRole("button", { name: "Delete conversation" });
  await deleteButton.click();
  await expect(deleteButton).toHaveText("Delete?");
  await deleteButton.click();
  await expect(page.locator(".workspace li", { hasText: "Second page" })).toHaveCount(0);
  await expect.poll(piSessionProcesses).toHaveLength(1);
  await page.waitForTimeout(1_000);
  await expect(page.locator(".notice")).toHaveCount(0);

  await page.locator(".workspace li", { hasText: "Hello pi" }).click();
  await sendMessage(page, "After the delete");
  await waitForTurnToEnd(page);
  await expect(lastAgentMessage(page)).toContainText("Echo: After the delete");
});

test("deleting a pi conversation while its session opens ends the pi that session starts", async () => {
  const slowPi = join(host.root, process.platform === "win32" ? "slow-pi.cmd" : "slow-pi");
  const slowPiScript =
    process.platform === "win32"
      ? `@echo off\r\npowershell -NoProfile -Command "Start-Sleep -Seconds ${SLOW_PI_START_SECONDS}"\r\ncall "${piProgram()}" %*\r\n`
      : `#!/bin/sh\nsleep ${SLOW_PI_START_SECONDS}\nexec '${piProgram()}' "$@"\n`;
  writeFileSync(slowPi, slowPiScript, { mode: 0o755 });
  const dialog = await createProfile(page, SLOW_PROFILE, `${scriptedPiEnvironment(model, host.root)}\nPI_ACP_PI_COMMAND=${slowPi}`, "", "pi");
  await dialog.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${SLOW_PROFILE} · pi` });
  await page.getByRole("button", { name: "+ New conversation" }).click();
  await expect(page.locator(".chat-header:visible h2")).toHaveText("New conversation");
  await expect.poll(piSessionProcesses).toHaveLength(2);

  const deleteButton = page.locator(".workspace li.selected").getByRole("button", { name: "Delete conversation" });
  await deleteButton.click();
  await deleteButton.click();
  await expect(page.locator(".workspace li")).toHaveCount(1);
  await expect.poll(piSessionProcesses, { timeout: (SLOW_PI_START_SECONDS + 20) * 1_000 }).toHaveLength(1);
  await expect(page.locator(".notice")).toHaveCount(0);
  await page.locator(".workspace li", { hasText: "Hello pi" }).click();
});

test("deleting a pi conversation while the session it continues loads ends the pi that session starts", async () => {
  await runPiInTerminal(SLOWLY_CONTINUED_MARKER);
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${SLOW_PROFILE} · pi` });
  await page.getByRole("button", { name: "Continue a session…" }).click();
  const session = page.getByRole("dialog", { name: "Continue a session" }).locator(".session-list li", { hasText: SLOWLY_CONTINUED_MARKER });
  await session.getByRole("button", { name: "Continue" }).click();
  await expect(page.locator(".workspace li.selected")).toContainText(SLOWLY_CONTINUED_MARKER);
  await expect.poll(piSessionProcesses).toHaveLength(2);

  const deleteButton = page.locator(".workspace li.selected").getByRole("button", { name: "Delete conversation" });
  await deleteButton.click();
  await deleteButton.click();
  await expect(page.locator(".workspace li", { hasText: SLOWLY_CONTINUED_MARKER })).toHaveCount(0);
  await expect.poll(piSessionProcesses, { timeout: (SLOW_PI_START_SECONDS + 20) * 1_000 }).toHaveLength(1);
  await expect(page.locator(".notice")).toHaveCount(0);
  await page.locator(".workspace li", { hasText: "Hello pi" }).click();
});

test("after a host restart, a pi conversation goes on in its own session with the canvas tools", async () => {
  await host.restart();
  await expect(page.locator(".banner")).toHaveCount(0, { timeout: 30_000 });
  await sendMessage(page, "SHOW After restart");
  await expect(canvasHeading()).toHaveText("After restart", { timeout: 60_000 });
  await waitForTurnToEnd(page);
  expect(model.userMessagesInContext()).toEqual(expect.arrayContaining(["Hello pi", "Still there", "SHOW After restart"]));
  expect(model.systemPromptInContext()).toContain(CANVAS_RENDERING_RULES);
});

test("a message sent with Enter while pi runs a command joins its turn once the command finishes", async () => {
  const eventsInOrder = eventsInOrderOn(page);
  await page.reload();
  await expect(page.locator(".chat-header:visible .harness")).toHaveText("pi");
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

test("↑ after stopping a pi turn edits its message, and Enter replaces the turn while pi keeps the turns before it", async () => {
  await sendMessage(page, "RUN sleep 30");
  await expect(page.locator(".timeline:visible").locator(".tool-pending, .tool-in_progress").first()).toBeVisible({ timeout: 60_000 });
  const composer = page.locator(".composer:visible textarea");
  await composer.press("Escape");
  await expect(page.locator(".timeline:visible").getByText("Turn ended: cancelled")).toBeVisible({ timeout: 30_000 });
  await waitForTurnToEnd(page);

  await composer.press("ArrowUp");
  await expect(composer).toHaveValue("RUN sleep 30");
  await expect(page.locator(".editing-stopped")).toBeVisible();
  await composer.fill("SHOW After going back");
  await composer.press("Enter");
  await expect(canvasHeading()).toHaveText("After going back", { timeout: 60_000 });
  await waitForTurnToEnd(page);
  await expect.poll(piSessionProcesses).toHaveLength(1);

  await expect(page.locator(".timeline:visible .message.user", { hasText: "RUN sleep 30" })).toHaveCount(0);
  expect(model.userMessagesInContext()).toEqual(expect.arrayContaining(["Hello pi", "Still there", STEERED, "SHOW After going back"]));
  expect(model.userMessagesInContext()).not.toContain("RUN sleep 30");
  expect(model.systemPromptInContext()).toContain(CANVAS_RENDERING_RULES);
});

test("a pi conversation moves to another pi profile, even one with its own PI_CODING_AGENT_DIR, and goes on in the same session and model", async () => {
  const dialog = await createProfile(page, OTHER_PROFILE, scriptedPiEnvironment(model, join(host.root, "other"), "other"), "", "pi");
  await dialog.getByRole("button", { name: "Close" }).click();
  const profilePicker = page.getByLabel("Profile", { exact: true }).filter({ visible: true });
  await expect(profilePicker.locator("option:checked")).toHaveText(PROFILE);

  await profilePicker.selectOption({ label: OTHER_PROFILE });
  await expect(page.locator(".timeline:visible")).toContainText(`Now using the profile “${OTHER_PROFILE}”`);
  await sendMessage(page, "After the switch");
  await waitForTurnToEnd(page);
  await expect(lastAgentMessage(page)).toContainText("Echo: After the switch");
  expect(model.requests.at(-1)!.model).toBe("scripted");
  await expect(page.getByRole("region", { name: "Statusline" }).filter({ visible: true })).toContainText("e2e/Scripted");
  expect(model.userMessagesInContext()).toEqual(expect.arrayContaining(["Hello pi", "SHOW After going back", "After the switch"]));
  expect(model.systemPromptInContext()).not.toContain(OWN_APPENDED_INSTRUCTIONS);
  expect(model.systemPromptInContext()).toContain(CANVAS_RENDERING_RULES);
  await expect(page.locator(".timeline:visible")).not.toContainText("Could not resume");
  await expect.poll(piSessionProcesses).toHaveLength(1);
});

test("an image pasted into a pi conversation reaches the model with its message", async () => {
  const composer = page.locator(".composer:visible textarea");
  await composer.fill("Say which colour this is");
  await pasteImage(composer, { width: 64, height: 64, color: "#e11d1d" });
  await expect(page.locator(".pasted-images img")).toHaveJSProperty("naturalWidth", 64);
  await composer.press("Enter");
  await expect(lastAgentMessage(page)).toContainText("Echo: Say which colour this is", { timeout: 60_000 });
  await waitForTurnToEnd(page);
  const sent = page.locator(".timeline:visible .message.user", { hasText: "Say which colour this is" });
  await expect(sent.locator(".message-images img")).toHaveJSProperty("naturalWidth", 64);
  const lastUserMessage = model.requests.at(-1)!.messages.findLast(({ role }) => role === "user");
  expect(JSON.stringify(lastUserMessage)).toContain("data:image/png;base64,");
});

test("a pi that dies in the middle of a turn ends the turn with its error, and the next message starts pi again in the same session", async () => {
  await sendMessage(page, "RUN sleep 45");
  await expect(page.locator(".timeline:visible").locator(".tool-pending, .tool-in_progress").first()).toBeVisible({ timeout: 60_000 });
  await expect.poll(piSessionProcesses).toHaveLength(1);
  killPiSessionProcesses();
  await expect(page.locator(".timeline:visible .error-line").last()).toContainText("pi process exited", { timeout: 30_000 });
  await expect(page.locator(".timeline:visible .tool-failed", { hasText: "sleep 45" })).toBeVisible();
  await expect(page.locator(".timeline:visible .tool-in_progress, .timeline:visible .tool-pending")).toHaveCount(0);
  await waitForTurnToEnd(page);

  await sendMessage(page, "After pi died");
  await waitForTurnToEnd(page);
  await expect(lastAgentMessage(page)).toContainText("Echo: After pi died");
  expect(model.userMessagesInContext()).toEqual(expect.arrayContaining(["Hello pi", "RUN sleep 45", "After pi died"]));
  expect(model.systemPromptInContext()).toContain(CANVAS_RENDERING_RULES);
  await expect.poll(piSessionProcesses).toHaveLength(1);
});

test("a message that joined a pi turn goes out again after Stop if pi had not read it yet, as the next turn", async () => {
  model.hold();
  await sendMessage(page, "Before the stop");
  await expect.poll(() => model.userMessagesInContext().at(-1), { timeout: 60_000 }).toBe("Before the stop");
  const composer = page.locator(".composer:visible textarea");
  await composer.fill(STEERED_BEFORE_STOP);
  await composer.press("Enter");
  const steeredMessages = page.locator(".timeline:visible .message.user", { hasText: STEERED_BEFORE_STOP });
  await expect(steeredMessages).toHaveCount(1, { timeout: 60_000 });
  const cancelledTurns = page.locator(".timeline:visible").getByText("Turn ended: cancelled");
  const cancelledBefore = await cancelledTurns.count();
  await composer.press("Escape");
  await expect(cancelledTurns).toHaveCount(cancelledBefore + 1, { timeout: 30_000 });

  model.answerHeld();
  await expect(lastAgentMessage(page)).toContainText(`Echo: ${STEERED_BEFORE_STOP}`, { timeout: 60_000 });
  await waitForTurnToEnd(page);
  await expect(steeredMessages).toHaveCount(1);
  const context = model.userMessagesInContext();
  expect(context.slice(-2)).toEqual(["Before the stop", STEERED_BEFORE_STOP]);
  expect(context.filter((text) => text === STEERED_BEFORE_STOP)).toHaveLength(1);
});

test("rewinding a pi conversation to a turn keeps a message pi read in the turn before it, though Stop came before pi answered it", async () => {
  // The Stop of the test before leaves its force-stop timer running, which would swallow this test's Escape.
  await page.reload();
  await expect(page.locator(".chat-header:visible .harness")).toHaveText("pi");
  const command = "RUN sleep 3; echo slept";
  await sendMessage(page, command);
  await expect(page.locator(".timeline:visible").locator(".tool-pending, .tool-in_progress", { hasText: "sleep 3; echo slept" })).toBeVisible({ timeout: 60_000 });
  model.hold();
  await expect.poll(() => model.requests.findLast(({ tools }) => (tools ?? []).length > 0)?.messages.at(-1)?.role, { timeout: 60_000 }).toBe("tool");
  const composer = page.locator(".composer:visible textarea");
  await composer.fill(STEERED_INTO_STOPPED_TURN);
  await composer.press("Enter");
  await expect(page.locator(".timeline:visible .message.user").last()).toHaveText(STEERED_INTO_STOPPED_TURN, { timeout: 60_000 });
  model.answerHeld();
  model.hold();
  await expect.poll(() => model.userMessagesInContext().at(-1), { timeout: 60_000 }).toBe(STEERED_INTO_STOPPED_TURN);
  const cancelledTurns = page.locator(".timeline:visible").getByText("Turn ended: cancelled");
  const cancelledBefore = await cancelledTurns.count();
  await composer.press("Escape");
  await expect(cancelledTurns).toHaveCount(cancelledBefore + 1, { timeout: 30_000 });
  model.answerHeld();
  await waitForTurnToEnd(page);
  await sendMessage(page, "Rewound away");
  await waitForTurnToEnd(page);

  await rewindTo("Rewound away");
  await sendMessage(page, "After rewinding to the turn");
  await waitForTurnToEnd(page);
  await expect(lastAgentMessage(page)).toContainText("Echo: After rewinding to the turn");
  expect(model.userMessagesInContext().slice(-3)).toEqual([command, STEERED_INTO_STOPPED_TURN, "After rewinding to the turn"]);
});

test("a pi session started in a terminal can be forked and continued, and each goes on from its own history", async () => {
  await runPiInTerminal(TERMINAL_MARKER);
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${PROFILE} · pi` });
  const terminalSession = async () => {
    await page.getByRole("button", { name: "Continue a session…" }).click();
    const dialog = page.getByRole("dialog", { name: "Continue a session" });
    const session = dialog.locator(".session-list li", { hasText: TERMINAL_MARKER, has: page.getByRole("button", { name: "Continue" }) });
    await expect(session).toHaveCount(1, { timeout: 30_000 });
    return session;
  };
  const replayedMarker = page.locator(".timeline:visible .message.user", { hasText: TERMINAL_MARKER });

  await (await terminalSession()).getByRole("button", { name: "Fork" }).click();
  await expect(replayedMarker).toHaveCount(1, { timeout: 30_000 });
  await sendMessage(page, "In the fork");
  await waitForTurnToEnd(page);
  await expect(lastAgentMessage(page)).toContainText("Echo: In the fork");
  expect(model.userMessagesInContext()).toEqual([TERMINAL_MARKER, "In the fork"]);
  expect(model.systemPromptInContext()).toContain(CANVAS_RENDERING_RULES);

  await (await terminalSession()).getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { level: 2, name: TERMINAL_MARKER, exact: true }).filter({ visible: true })).toBeVisible({ timeout: 30_000 });
  await expect(replayedMarker).toHaveCount(1, { timeout: 30_000 });
  await sendMessage(page, "In the original");
  await waitForTurnToEnd(page);
  await expect(lastAgentMessage(page)).toContainText("Echo: In the original");
  expect(model.userMessagesInContext()).toEqual([TERMINAL_MARKER, "In the original"]);
  expect(model.systemPromptInContext()).toContain(CANVAS_RENDERING_RULES);
  await page.locator(".workspace li", { hasText: "Hello pi" }).click();
});

test("a pi conversation from before pi marked its replies can't be taken back past its first turn", async () => {
  const oldConversationId = await startConversation(page);
  await host.stop();
  const said = (text: string) => ({ type: "acp", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } } });
  const oldTurns = [{ type: "user-message", text: "Old first" }, said("Old reply"), { type: "user-message", text: "Old second" }, said("Another old reply")];
  execFileSync("bun", [join(import.meta.dirname, "seed-events.ts"), join(host.dataDir, "state.sqlite"), oldConversationId, JSON.stringify(oldTurns)]);
  await host.start();
  await reloadFromRestartedHost(page);

  const turn = page.locator(".timeline:visible .timeline-entry").filter({ has: page.locator(".message.user").getByText("Old second", { exact: true }) });
  await turn.hover();
  await turn.locator(".undo-files").click();
  const dialog = page.getByRole("dialog", { name: "Rewind to here" });
  await expect(dialog).toContainText("The agent's replies before this turn carry no mark of where its session should go back to");
  await expect(dialog.getByRole("button", { name: "Rewind", exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await page.locator(".workspace li", { hasText: "Hello pi" }).click();
});

test("Log in opens pi in a terminal tab, where /login offers pi's ways to sign in", async () => {
  await host.stop();
  const refusal = { type: "error", message: "Authentication required", authRequired: true };
  execFileSync("bun", [join(import.meta.dirname, "seed-events.ts"), join(host.dataDir, "state.sqlite"), firstConversationId, JSON.stringify([refusal])]);
  await host.start();
  await reloadFromRestartedHost(page);

  await page.locator(".timeline:visible .sign-in-line").getByRole("button", { name: "Log in" }).click();
  const terminalScreen = page.locator(".terminal-pane .terminal-splits.shown .xterm-rows");
  await expect(terminalScreen).toContainText("/ commands", { timeout: 30_000 });
  await page.locator(".terminal-pane .terminal-splits.shown .xterm").click();
  await page.keyboard.type("/login");
  await page.keyboard.press("Enter");
  await expect(terminalScreen).toContainText("Select authentication method:");
});
