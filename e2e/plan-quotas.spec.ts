import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { FakeClaudeApi, subscriptionEnvironment } from "./fake-claude-api.ts";
import { addWorkspace, createProfile, sendMessage, signIn, startConversation, waitForTurnToEnd } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost({ runsUserStatusLine: true });
const api = new FakeClaudeApi();
const PROFILE = "subscription";
const MINUTE = 60;
const HOUR = 60 * MINUTE;

/**
 * Claude settings of the test's own, whose statusline prints the rate_limits Claude Code's JSON gave it, and, past the width it was given, a word that must wrap into view.
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
      "const limits = input.rate_limits ?? {};",
      "const padding = '.'.repeat(Number(process.env.COLUMNS));",
      "console.log(`5h=${limits.five_hour?.used_percentage ?? 'none'} 7d=${limits.seven_day?.used_percentage ?? 'none'} ${padding} past-the-edge`);",
    ].join("\n"),
  );
  writeFileSync(join(configDir, "settings.json"), JSON.stringify({ statusLine: { type: "command", command: `bun '${script}'` } }));
  return configDir;
}

test.beforeAll(async () => {
  await api.start();
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
  api.stop();
});

test("the plan's five-hour and weekly usage show after the context meter once the agent reports them, with when each starts over, and reach the statusline command", async ({ page }) => {
  test.setTimeout(240_000);
  const now = Math.floor(Date.now() / 1000);
  api.limited = false;
  api.planUsage = { fiveHour: 0.3, fiveHourResetsAt: now + 2 * HOUR + 28 * MINUTE + 30, sevenDay: 0.8, sevenDayResetsAt: now + 2 * 24 * HOUR + 15 * HOUR + 30 };
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, PROFILE, `${subscriptionEnvironment(api)}\nCLAUDE_CONFIG_DIR=${claudeSettingsWithStatusline()}`);
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${PROFILE} · Claude Code` });
  await startConversation(page);
  const statusline = page.getByRole("region", { name: "Statusline" });
  const printed = statusline.locator(".statusline-terminal");

  await test.step("the statusline command gets them as Claude Code's rate_limits, and a line wider than the statusline wraps", async () => {
    await expect(printed).toContainText("5h=none 7d=none");
    await sendMessage(page, "hello");
    await waitForTurnToEnd(page);
    // Claude Code reports the usage only when it changed, and claude-agent-acp passes on none before a session's first
    // answer, which the usage Claude Code learns on starting may come before.
    api.planUsage = { ...api.planUsage!, fiveHour: 0.37, sevenDay: 0.88 };
    await sendMessage(page, "again");
    await waitForTurnToEnd(page);
    await expect(printed).toContainText("5h=37 7d=88", { timeout: 30_000 });
    await expect(printed.getByText("past-the-edge")).toBeInViewport();
    const box = (await statusline.boundingBox())!;
    const word = (await printed.getByText(/past-the-edge/).boundingBox())!;
    expect(word.x + word.width).toBeLessThanOrEqual(box.x + box.width);
  });

  await test.step("the built-in statusline shows them right after the context meter, each with when it starts over, the weekly one amber past 75%", async () => {
    await statusline.getByRole("button", { name: "Built-in" }).click();
    const meters = statusline.locator(".usage-meter");
    await expect(meters).toHaveCount(3);
    await expect(meters.nth(0)).toHaveClass(/context-meter/);
    await expect(statusline.locator(".quota-meter")).toHaveText([/^5h 37% · 2h 2[89]m$/, /^7d 88% · 2d 1[45]h$/]);
    await expect(statusline.locator(".quota-meter").nth(0)).toHaveClass(/level-ok/);
    await expect(statusline.locator(".quota-meter").nth(1)).toHaveClass(/level-high/);
    await expect(statusline.getByLabel("Five-hour limit 37% used")).toHaveAttribute("data-hint", /37% used, starts over in 2h 2[89]m/);
    await expect(statusline.getByLabel("Weekly limit 88% used")).toHaveAttribute("data-hint", /starts over in 2d 1[45]h/);
  });

  await test.step("another conversation of the same profile shows them before its first answer", async () => {
    await startConversation(page);
    await expect(statusline.locator(".quota-meter")).toHaveText([/^5h 37% · 2h 2[89]m$/, /^7d 88% · 2d 1[45]h$/]);
  });
});
