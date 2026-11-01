import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { contrastRatio } from "../web/readable-color.ts";
import { FakeClaudeApi, subscriptionEnvironment } from "./fake-claude-api.ts";
import { addWorkspace, chooseInSettings, createProfile, sendMessage, signIn, startConversation, waitForTurnToEnd } from "./helpers.ts";
import { ScriptedModel, scriptedOpencodeEnvironment } from "./scripted-model.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost({ runsUserStatusLine: true });
const api = new FakeClaudeApi();
const model = new ScriptedModel();

/**
 * Claude settings of the test's own, whose statusline prints what Claude Code's JSON and the profile environment gave it.
 * The script's path is quoted: on Windows Git Bash runs the command, and reads a backslash as an escape.
 */
function claudeSettingsWithStatusline() {
  const configDir = join(host.root, "claude-config");
  mkdirSync(configDir, { recursive: true });
  const script = join(configDir, "statusline.ts");
  writeFileSync(
    script,
    [
      "const input = JSON.parse(await Bun.stdin.text());",
      "const used = input.context_window.used_percentage ?? 'none';",
      "console.log(`\\x1b[1;32mstatus\\x1b[0m context ${used} ${process.env.STATUSLINE_MARKER} cols ${process.env.COLUMNS}`);",
    ].join("\n"),
  );
  writeFileSync(join(configDir, "settings.json"), JSON.stringify({ statusLine: { type: "command", command: `bun '${script}'` } }));
  return configDir;
}

const statuslineEnvironment = () => `CLAUDE_CONFIG_DIR=${claudeSettingsWithStatusline()}\nSTATUSLINE_MARKER=from-the-profile`;

async function startConversationOn(page: Page, profile: string, agent: string) {
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${profile} · ${agent}` });
  return startConversation(page);
}

test.beforeAll(async () => {
  api.limited = false;
  await Promise.all([api.start(), model.start()]);
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
  api.stop();
  model.stop();
});

test("in a Claude Code conversation, the statusline command from the profile's Claude settings replaces the built-in statusline, and the user can switch back", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const dialog = await createProfile(page, "statusline claude", `${subscriptionEnvironment(api)}\n${statuslineEnvironment()}`);
  await dialog.getByRole("button", { name: "Close" }).click();
  const first = await startConversationOn(page, "statusline claude", "Claude Code");

  const statusline = page.getByRole("region", { name: "Statusline" });
  const printed = statusline.locator(".statusline-terminal");
  await expect(printed).toHaveAttribute("aria-label", /context none from-the-profile cols \d+$/);

  await test.step("the strip follows the theme, and on the light one a colour made for dark terminals is darkened until it reads", async () => {
    const green = printed.getByText("status", { exact: true });
    const shown = async () => ({
      color: await green.evaluate((node) => getComputedStyle(node).color),
      background: await printed.evaluate((node) => getComputedStyle(node).backgroundColor),
    });
    const onLight = await shown();
    expect(onLight.background).toBe("rgb(243, 244, 246)");
    expect(contrastRatio(onLight.color, onLight.background)!).toBeGreaterThanOrEqual(4.5);

    await chooseInSettings(page, "Theme", "Dark");
    await expect(printed).toHaveCSS("background-color", "rgb(27, 28, 34)");
    await expect(green).toHaveCSS("color", "rgb(152, 195, 121)");
    await chooseInSettings(page, "Theme", "Light");
  });

  await sendMessage(page, "hello");
  await waitForTurnToEnd(page);
  await expect(printed).toHaveAttribute("aria-label", /context \d+ from-the-profile/);

  await statusline.getByRole("button", { name: "Built-in" }).click();
  await expect(printed).toHaveCount(0);
  await expect(statusline.locator(".context-meter")).toBeVisible();
  await page.reload();
  await expect(statusline.locator(".context-meter")).toBeVisible();
  await statusline.getByRole("button", { name: "Your statusline" }).click();
  await expect(printed).toHaveAttribute("aria-label", /context \d+ from-the-profile/);

  await test.step("coming back to a conversation shows its statusline at once, not the built-in one until the command has run again", async () => {
    await startConversation(page);
    await expect(printed).toHaveAttribute("aria-label", /context none from-the-profile/);
    await expect(statusline.locator(".statusline-chips")).toHaveCount(0);
    await page.evaluate(() => {
      const watched = window as unknown as { builtInShown: boolean };
      watched.builtInShown = false;
      new MutationObserver(() => {
        if (document.querySelector(".statusline-chips")) watched.builtInShown = true;
      }).observe(document.body, { childList: true, subtree: true });
    });
    await page.locator(`li[data-reorder-id="${first}"]`).click();
    await expect(printed).toHaveAttribute("aria-label", /context \d+ from-the-profile/);
    expect(await page.evaluate(() => (window as unknown as { builtInShown: boolean }).builtInShown)).toBe(false);
  });
});

test("an opencode conversation keeps the built-in statusline, with its context once a turn ends, even where Claude settings name a statusline command", async ({ page }) => {
  await signIn(page, host);
  const dialog = await createProfile(page, "statusline opencode", `${scriptedOpencodeEnvironment(model, host.root)}\n${statuslineEnvironment()}`, "", "opencode");
  await dialog.getByRole("button", { name: "Close" }).click();
  await startConversationOn(page, "statusline opencode", "opencode");

  const statusline = page.getByRole("region", { name: "Statusline" });
  await expect(statusline.locator(".statusline-chips")).toBeVisible();
  await sendMessage(page, "hello");
  await waitForTurnToEnd(page);
  await expect(statusline.locator(".context-meter")).toContainText("/ 100k");
  await expect(statusline.locator(".statusline-terminal")).toHaveCount(0);
  await expect(statusline.getByRole("button", { name: "Your statusline" })).toHaveCount(0);
  await expect(statusline.getByRole("button", { name: "Built-in" })).toHaveCount(0);
});

test("a status line asked for just after its conversation was deleted brings no error", async ({ page }) => {
  await signIn(page, host);
  const deletedConversationId = crypto.randomUUID();
  const replies = await page.evaluate(async (conversationId) => {
    const socket = new WebSocket(`${location.origin.replace(/^http/, "ws")}/ws`);
    await new Promise((opened) => (socket.onopen = opened));
    const received: string[] = [];
    const answeredLater = new Promise((answered) => {
      socket.onmessage = ({ data }) => {
        const { type } = JSON.parse(data);
        received.push(type);
        if (type === "fs.completions") answered(null);
      };
    });
    socket.send(JSON.stringify({ type: "statusline.render", requestId: "status", conversationId, columns: 80, runCommand: false }));
    socket.send(JSON.stringify({ type: "fs.complete", requestId: "later", prefix: "/" }));
    await answeredLater;
    socket.close();
    return received;
  }, deletedConversationId);
  expect(replies).not.toContain("error");
});

test("subagent usage asked for just after its conversation was deleted brings no error", async ({ page }) => {
  await signIn(page, host);
  const deletedConversationId = crypto.randomUUID();
  const replies = await page.evaluate(async (conversationId) => {
    const socket = new WebSocket(`${location.origin.replace(/^http/, "ws")}/ws`);
    await new Promise((opened) => (socket.onopen = opened));
    const received: string[] = [];
    const answeredLater = new Promise((answered) => {
      socket.onmessage = ({ data }) => {
        const { type } = JSON.parse(data);
        received.push(type);
        if (type === "fs.completions") answered(null);
      };
    });
    socket.send(JSON.stringify({ type: "subagent-usage.get", requestId: "usage", conversationId, toolCallIds: ["toolu_1"] }));
    socket.send(JSON.stringify({ type: "fs.complete", requestId: "later", prefix: "/" }));
    await answeredLater;
    socket.close();
    return received;
  }, deletedConversationId);
  expect(replies).not.toContain("error");
});
