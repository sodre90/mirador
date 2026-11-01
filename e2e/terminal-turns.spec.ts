import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { expect, test } from "@playwright/test";
import { agentEnvironment } from "../host/acp/environment.ts";
import { applyEnvironment, parseEnvironment } from "../shared/profile-environment.ts";
import { FakeClaudeApi, subscriptionEnvironment } from "./fake-claude-api.ts";
import { addWorkspace, createProfile, sendMessage, signIn, startConversation, waitForTurnToEnd } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();
const api = new FakeClaudeApi();
const claudeConfigDir = join(host.root, "claude-config");
const environment = () => `${subscriptionEnvironment(api)}\nCLAUDE_CONFIG_DIR=${claudeConfigDir}`;
const sessionRegistry = join(claudeConfigDir, "sessions");
const terminalRegistration = join(sessionRegistry, `${process.pid}.json`);
const bundledClaude = join(dirname(createRequire(import.meta.url).resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/package.json`)), "claude");

test.beforeAll(async () => {
  api.limited = false;
  await api.start();
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
  api.stop();
});

function sessionIdTheAppRegistered(): string | undefined {
  if (!existsSync(sessionRegistry)) return undefined;
  return readdirSync(sessionRegistry)
    .map((name) => JSON.parse(readFileSync(join(sessionRegistry, name), "utf8")))
    .find(({ entrypoint }) => entrypoint === "sdk-ts")?.sessionId;
}

/** What Claude Code writes for a session in a terminal; this test process stands in for the running terminal. */
function openInTerminal(sessionId: string, status: string) {
  mkdirSync(sessionRegistry, { recursive: true });
  writeFileSync(terminalRegistration, JSON.stringify({ pid: process.pid, sessionId, entrypoint: "cli", kind: "interactive", status }));
}

/** A turn the user takes in the session from a terminal: `claude -p --resume` in the project directory. */
async function takeTurnInTerminal(sessionId: string, prompt: string) {
  host.muteNotifier(sessionId);
  const env = applyEnvironment(agentEnvironment(), parseEnvironment(environment()));
  const claude = spawn(bundledClaude, ["-p", prompt, "--resume", sessionId], { cwd: host.projectDirInTerminal, env, stdio: "ignore" });
  await new Promise((resolve) => claude.once("exit", resolve));
}

test("turns taken in a terminal join the conversation once the terminal is idle, and the agent goes on from them", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const dialog = await createProfile(page, "terminal api", environment());
  await dialog.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "terminal api · Claude Code" });
  await startConversation(page);
  await sendMessage(page, "First task");
  await waitForTurnToEnd(page);
  const timeline = page.locator(".timeline:visible");
  await expect(timeline).toContainText("Answered: First task");
  await expect.poll(sessionIdTheAppRegistered, { timeout: 30_000 }).toBeDefined();
  const sessionId = sessionIdTheAppRegistered()!;

  const terminalBadge = page.locator(".chat-header:visible .badge", { hasText: "in a terminal" });
  openInTerminal(sessionId, "busy");
  await expect(terminalBadge).toHaveText("in a terminal · working");
  await takeTurnInTerminal(sessionId, "Terminal task");
  openInTerminal(sessionId, "idle");

  await expect(timeline.locator(".message.user", { hasText: "Terminal task" })).toHaveCount(1, { timeout: 30_000 });
  await expect(timeline).toContainText("Answered: Terminal task");
  await expect(timeline.locator(".message.user", { hasText: "First task" })).toHaveCount(1);
  rmSync(terminalRegistration);
  await expect(terminalBadge).toHaveCount(0);

  await sendMessage(page, "Mirador task");
  await waitForTurnToEnd(page);
  await expect(timeline).toContainText("Answered: Mirador task");
  const miradorTurn = api.history.find((messages) => messages.includes("user: Mirador task"));
  expect(miradorTurn).toContain("user: Terminal task");
  expect(miradorTurn).toContain("assistant: Answered: Terminal task");
});
