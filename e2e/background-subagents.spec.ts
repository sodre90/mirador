import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { FakeClaudeApi, subscriptionEnvironment } from "./fake-claude-api.ts";
import { addWorkspace, createProfile, eventsInOrderOn, sendMessage, signIn, startConversation, waitForTurnToEnd } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();
const api = new FakeClaudeApi();
const PROFILE = "fake claude";
const claudeConfigDir = join(host.root, "claude-config");
const SUBAGENT_COMMAND = "sleep 15; echo slept";
const STEERED = "How is it going?";
const WHILE_WAITING = "Anything I can do meanwhile?";
const LONG_ENOUGH_TO_SCROLL = Array.from({ length: 30 }, (_, line) => `Detail ${line + 1} of what I want to know.`).join("\n\n");
const COMMAND_TO_APPROVE = "rm -rf scratch; sleep 1; echo removed";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  api.limited = false;
  await api.start();
  mkdirSync(claudeConfigDir, { recursive: true });
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
  api.stop();
});

test("while only a background subagent works, a message joins the turn and the agent answers it, and the subagent shows done once it ends, before its turn does", async ({ page }) => {
  const eventsInOrder = eventsInOrderOn(page);
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const dialog = await createProfile(page, PROFILE, `${subscriptionEnvironment(api)}\nCLAUDE_CONFIG_DIR=${claudeConfigDir}`);
  await dialog.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${PROFILE} · Claude Code` });
  await startConversation(page);
  await page.getByLabel("YOLO", { exact: true }).click();

  const card = page.locator(".timeline .tool.subagent");
  const command = card.locator(".subagent-work .shell", { hasText: "sleep 15" });
  const badge = page.locator(".chat-header .badge");
  const chip = page.locator(".chat-header .subagents-running");
  await sendMessage(page, `SUBAGENT RUN ${SUBAGENT_COMMAND}`);
  await expect(card.locator(".subagent-facts")).toContainText("in the background", { timeout: 60_000 });
  await expect(command).toHaveClass(/tool-in_progress/, { timeout: 60_000 });
  await expect(chip).toHaveText("◐ 1 subagent running");

  await test.step("a message joins the turn while the subagent's command runs, and the command runs on", async () => {
    const composer = page.locator(".composer textarea");
    await composer.fill(STEERED);
    await composer.press("Enter");
    await expect(page.locator(".timeline .message.agent", { hasText: `Answered: ${STEERED}` })).toBeVisible({ timeout: 10_000 });
    await expect(command, "the agent answered while the subagent's command still ran").toHaveClass(/tool-in_progress/);
    await expect(page.locator(".queue")).toHaveCount(0);
    await expect(badge, "claude-agent-acp holds the turn open for the subagent").toHaveText("running");
    await expect(command).toHaveClass(/tool-completed/, { timeout: 60_000 });
    await expect(command, "the command ran to its end, not moved to the background by the message").toContainText("slept");
  });

  await test.step("the subagent is done once it ends, while the turn still runs", async () => {
    await expect.poll(() => api.endedCommandsWaiting, { timeout: 30_000 }).toBe(1);
    await expect(card).toHaveClass(/subagent-done/);
    await expect(chip).toHaveCount(0);
    await expect(badge).toHaveText("running");
  });

  api.answerEndedCommands();
  await waitForTurnToEnd(page);
  await expect(card).toHaveClass(/subagent-done/);
  expect(eventsInOrder).toEqual([`SUBAGENT RUN ${SUBAGENT_COMMAND}`, STEERED, "turn-end"]);
});

test("a message joins the turn also while a background subagent waits for permission, its request shows above the message box once scrolled away, and the subagent goes on once it gets it", async ({ page }) => {
  await signIn(page, host);
  await page.goto(host.origin);
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${PROFILE} · Claude Code` });
  await startConversation(page);
  const permission = page.locator(".timeline .permission.pending");
  const command = page.locator(".timeline .tool.subagent .subagent-work .shell", { hasText: "rm -rf scratch" });
  await sendMessage(page, `SUBAGENT RUN ${COMMAND_TO_APPROVE}`);
  await expect(permission).toBeVisible({ timeout: 60_000 });

  const dock = page.getByRole("status", { name: "Approvals waiting" });
  await expect(dock, "nothing above the message box while the request is in sight").toHaveCount(0);

  const composer = page.locator(".composer textarea");
  await composer.fill(`${WHILE_WAITING}\n\n${LONG_ENOUGH_TO_SCROLL}`);
  await composer.press("Enter");
  await expect(page.locator(".timeline .message.agent", { hasText: `Answered: ${WHILE_WAITING}` })).toBeVisible({ timeout: 10_000 });
  await expect(permission, "the subagent still waits for its answer").toBeVisible();

  await test.step("the request scrolled away shows above the message box, and leads back to it", async () => {
    await expect(permission).not.toBeInViewport();
    await expect(dock.getByRole("button")).toHaveCount(1);
    await expect(dock.locator(".approval-subject")).toHaveText(/^Permission needed: (Run )?rm -rf scratch; sleep 1; echo removed$/);
    await expect(dock.locator(".approval-facts")).toHaveText(/^asked by Scripted subagent · waiting \d+ s$/);
    await dock.getByRole("button").click();
    await expect(permission).toBeInViewport();
    await expect(dock).toHaveCount(0);
  });

  await permission.locator("button.option-allow_once").click();
  await expect(command).toHaveClass(/tool-completed/, { timeout: 60_000 });
  await expect(command).toContainText("removed");
  await expect.poll(() => api.endedCommandsWaiting, { timeout: 30_000 }).toBe(1);
  api.answerEndedCommands();
  await waitForTurnToEnd(page);
});
