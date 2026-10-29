import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { agentEnvironment } from "../host/acp/environment.ts";
import { applyEnvironment, parseEnvironment } from "../shared/profile-environment.ts";
import { FakeClaudeApi, subscriptionEnvironment } from "./fake-claude-api.ts";
import { FakeGateway, gatewayEnvironment } from "./fake-gateway.ts";
import { addWorkspace, createProfile, sendMessage, signIn, workspaceCard } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();
const gateway = new FakeGateway();
const bundledClaude = join(dirname(createRequire(import.meta.url).resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/package.json`)), "claude");
/** A user's terminal and Mirador's agent are one Claude Code installation; profiles name it, so model aliases resolve the same on both sides of a fork. */
const sameClaudeCode = `CLAUDE_CODE_EXECUTABLE=${bundledClaude}`;
const MARKER = "external-marker-42";
let terminalSessionId = "";

/** What a user does in a terminal: `claude -p` in the project directory, against the fake gateway unless told otherwise. */
async function runClaudeInTerminal(cwd: string, prompt: string, environment = `${gatewayEnvironment(gateway)}\nCLAUDE_CONFIG_DIR=${host.claudeConfigDir}`) {
  const sessionId = crypto.randomUUID();
  host.muteNotifier(sessionId);
  const env = applyEnvironment(agentEnvironment(), parseEnvironment(environment));
  const claude = spawn(bundledClaude, ["-p", prompt, "--session-id", sessionId, "--model", "haiku"], { cwd, env, stdio: "ignore" });
  await new Promise((resolve) => claude.once("exit", resolve));
  return sessionId;
}

test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  await gateway.start();
  await host.start();
  terminalSessionId = await runClaudeInTerminal(host.projectDirInTerminal, `${MARKER}: remember the number 42`);
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
  gateway.stop();
});

async function openSessionsDialog(page: Page) {
  await page.getByRole("button", { name: "Continue a session…" }).click();
  const dialog = page.getByRole("dialog", { name: "Continue a session" });
  await expect(dialog.locator(".session-list")).toBeVisible({ timeout: 30_000 });
  return dialog;
}

const sessionRow = (dialog: ReturnType<Page["getByRole"]>, sessionId: string) => dialog.locator(".session-list li", { hasText: sessionId.slice(0, 8) });
const terminalSessionRow = (dialog: ReturnType<Page["getByRole"]>) => sessionRow(dialog, terminalSessionId);

test("forking a terminal session replays its history into a new conversation and leaves the original alone", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, "fake gateway", [gatewayEnvironment(gateway), `CLAUDE_CONFIG_DIR=${host.claudeConfigDir}`, sameClaudeCode].join("\n"));
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "fake gateway · Claude Code" });

  const dialog = await openSessionsDialog(page);
  await expect(terminalSessionRow(dialog)).toContainText(MARKER);
  await terminalSessionRow(dialog).getByRole("button", { name: "Fork" }).click();

  await expect(page.locator(".chat-header h2")).toContainText("Fork: ");
  await expect(page.locator(".timeline")).toContainText(MARKER, { timeout: 30_000 });
  await expect(page.locator(".chat-header .badge")).toHaveText("idle");

  const reopened = await openSessionsDialog(page);
  await expect(terminalSessionRow(reopened).getByRole("button", { name: "Continue" })).toBeVisible();
  await expect(reopened.getByRole("button", { name: "Open" })).toHaveCount(1);
  await reopened.getByRole("button", { name: "Close" }).click();
});

test("continuing a terminal session in place gives the agent its earlier context, on top of the workspace", async ({ page }) => {
  await signIn(page, host);
  const dialog = await openSessionsDialog(page);
  await terminalSessionRow(dialog).getByRole("button", { name: "Continue" }).click();

  await expect(page.locator(".chat-header h2")).toContainText(MARKER);
  await expect(page.locator(".chat-header h2")).not.toContainText("Fork: ");
  const rows = workspaceCard(page, host.projectDir).locator("li .conversation-title");
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).not.toContainText("Fork: ");
  await expect(rows.last()).toContainText("Fork: ");
  await expect(page.locator(".timeline")).toContainText(MARKER, { timeout: 30_000 });

  const requestsBefore = gateway.messageRequests().length;
  await sendMessage(page, "Which number did I ask you to remember?");
  await expect
    .poll(() => gateway.messageRequests().slice(requestsBefore).some(({ body }) => body.includes(MARKER) && body.includes("Which number")), {
      timeout: 60_000,
    })
    .toBe(true);

  const reopened = await openSessionsDialog(page);
  await expect(terminalSessionRow(reopened).getByRole("button", { name: "Open" })).toBeVisible();
});

test("a terminal session continues and forks on the model that answered in it, not on the one Claude's settings name", async ({ page }) => {
  // The profile names the Claude Code the terminal runs, so `--model haiku` resolves to one model on both sides; settings.json names opus to show what must not win.
  const api = new FakeClaudeApi();
  api.limited = false;
  await api.start();
  const configDir = join(host.root, "claude-config");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, "settings.json"), JSON.stringify({ model: "opus" }));
  const environment = `${subscriptionEnvironment(api)}\nCLAUDE_CONFIG_DIR=${configDir}`;
  const sessionId = await runClaudeInTerminal(host.projectDirInTerminal, "Say hi", environment);
  const model = page.getByLabel("Model", { exact: true }).filter({ visible: true });

  await signIn(page, host);
  const profiles = await createProfile(page, "answering api", [environment, sameClaudeCode].join("\n"));
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "answering api · Claude Code" });
  await sessionRow(await openSessionsDialog(page), sessionId).getByRole("button", { name: "Fork" }).click();
  await expect(page.locator(".timeline")).toContainText("Answered: Say hi", { timeout: 30_000 });
  await expect(model.locator("option:checked")).toHaveText(/^Haiku/);

  await sessionRow(await openSessionsDialog(page), sessionId).getByRole("button", { name: "Continue" }).click();
  await expect(page.locator(".chat-header h2").filter({ visible: true })).toHaveText("Say hi");
  await expect(page.locator(".timeline").filter({ visible: true })).toContainText("Answered: Say hi", { timeout: 30_000 });
  await expect(model.locator("option:checked")).toHaveText(/^Haiku/);
  api.stop();
});
