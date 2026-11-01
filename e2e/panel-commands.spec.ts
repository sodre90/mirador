import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { addWorkspace, createProfile, reloadFromRestartedHost, signIn, startConversation } from "./helpers.ts";
import { programOnPath, TestHost, writeCompiledBunProgram } from "./test-host.ts";

const host = new TestHost({ fakePrograms: true });
const ranHere = join(host.root, "panel-command-ran");

/**
 * Stands in for the Claude Code a panel command starts: it writes down how it was run and waits, so the tab stays
 * open to read. Everything else — the agent itself — is the real Claude Code.
 */
function fakeClaude() {
  const real = programOnPath("claude");
  if (process.platform === "win32") {
    writeCompiledBunProgram(host.fakeProgramsDir, "claude", join(import.meta.dirname, "fake-claude.ts"), { FAKE_CLAUDE_REAL: real, FAKE_CLAUDE_PANEL_RAN: ranHere });
    return;
  }
  mkdirSync(host.fakeProgramsDir, { recursive: true });
  const script = `#!/bin/sh
case "$1" in
  /*)
    printf 'command=%s\\nmarker=%s\\ndirectory=%s\\n' "$1" "$PANEL_MARKER" "$PWD" > '${ranHere}'
    printf 'panel %s with %s\\n' "$1" "$PANEL_MARKER"
    sleep 30
    ;;
esac
exec '${real}' "$@"
`;
  writeFileSync(join(host.fakeProgramsDir, "claude"), script);
  chmodSync(join(host.fakeProgramsDir, "claude"), 0o755);
}

/** What the host records when the agent refuses a command it can only show in its own terminal. */
function agentRefusedToOpen(text: string, conversationId: string) {
  const refusal = { type: "acp", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } } };
  execFileSync("bun", [join(import.meta.dirname, "seed-events.ts"), join(host.dataDir, "state.sqlite"), conversationId, JSON.stringify([refusal])]);
}

const ran = () => readFileSync(ranHere, "utf8").trim().split("\n");

// Later tests use the workspace the first one adds.
test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  fakeClaude();
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

test("/plugin opens a terminal tab running Claude Code itself, with the conversation's profile", async ({ page }) => {
  rmSync(ranHere, { force: true });
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const dialog = await createProfile(page, "panel", "PANEL_MARKER=from-profile", "", "Claude Code");
  await dialog.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "panel · Claude Code" });
  await startConversation(page);

  const composer = page.locator(".composer:visible textarea");
  await composer.fill("/plug");
  await expect(page.getByRole("listbox", { name: "Slash commands" }).locator('[aria-selected="true"] .slash-command-name')).toHaveText("/plugin");
  await composer.press("Enter");

  await expect(page.locator(".terminal-tab", { hasText: "/plugin" })).toBeVisible();
  await expect(page.locator(".terminal-pane .terminal-splits.shown .xterm-rows")).toContainText("panel /plugin with from-profile");
  expect(ran()).toEqual(["command=/plugin", "marker=from-profile", `directory=${realpathSync(host.projectDir)}`]);
  await expect(composer).toHaveValue("");
  await expect(page.locator(".timeline:visible .message.user"), "the command is Claude Code's, not a message to the agent").toHaveCount(0);
});

test("a command the agent says it cannot open here offers the tab that can", async ({ page }) => {
  rmSync(ranHere, { force: true });
  await signIn(page, host);
  const conversationId = await startConversation(page);
  await host.stop();
  agentRefusedToOpen("/things-to-come isn't available in this environment.", conversationId);
  await host.start();
  await reloadFromRestartedHost(page);

  const refusal = page.locator(".timeline:visible .message.agent", { hasText: "isn't available in this environment" });
  await expect(refusal).toBeVisible();
  await refusal.getByRole("button", { name: "Open a terminal tab" }).click();

  await expect(page.locator(".terminal-tab", { hasText: "/things-to-come" })).toBeVisible();
  await expect(page.locator(".terminal-pane .terminal-splits.shown .xterm-rows")).toContainText("panel /things-to-come with");
  expect(ran()[0]).toBe("command=/things-to-come");
});

test("/mcp auth opens a terminal tab for Claude Code's MCP panel, and its refusal over ACP offers that tab too", async ({ page }) => {
  rmSync(ranHere, { force: true });
  await signIn(page, host);
  const conversationId = await startConversation(page);

  await test.step("sending /mcp auth runs it in a terminal tab, as Claude Code takes only reconnect, enable and disable over ACP", async () => {
    const composer = page.locator(".composer:visible textarea");
    await composer.fill("/mcp auth");
    await composer.press("Enter");
    await expect(page.locator(".terminal-tab", { hasText: "/mcp auth" })).toBeVisible();
    await expect(page.locator(".terminal-pane .terminal-splits.shown .xterm-rows")).toContainText("panel /mcp auth with");
    expect(ran()[0]).toBe("command=/mcp auth");
    await expect(composer).toHaveValue("");
    await expect(page.locator(".timeline:visible .message.user")).toHaveCount(0);
  });

  await test.step("a refused /mcp action, sent from elsewhere, offers the tab with Claude Code's /mcp", async () => {
    rmSync(ranHere, { force: true });
    await host.stop();
    agentRefusedToOpen(`"auth" isn't a recognized /mcp action. Try reconnect, enable, or disable.`, conversationId);
    await host.start();
    await reloadFromRestartedHost(page);
    const refusal = page.locator(".timeline:visible .message.agent", { hasText: "isn't a recognized /mcp action" });
    await refusal.getByRole("button", { name: "Open a terminal tab" }).click();
    await expect(page.locator(".terminal-pane .terminal-splits.shown .xterm-rows")).toContainText("panel /mcp with");
    expect(ran()[0]).toBe("command=/mcp");
  });
});
