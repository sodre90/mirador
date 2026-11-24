import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { addWorkspace, createProfile, lastAgentMessage, sendMessage, signIn, startConversation, waitForTurnToEnd } from "./helpers.ts";
import { ScriptedModel, antigravityProgram, scriptedAntigravityEnvironment } from "./scripted-model.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();
const model = new ScriptedModel();
const PROFILE = "Antigravity plan";
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

function usageReport(fiveHourRemaining: number, fiveHourResetIso: string, weeklyRemaining: number, weeklyResetIso: string) {
  return JSON.stringify({
    conversation_id: "",
    status: "SUCCESS",
    response: "",
    duration_seconds: 0,
    num_turns: 0,
    command: {
      name: "usage",
      data: {
        groups: [
          {
            name: "Gemini Models",
            description: "Models within this group: Gemini 4 Neon, Gemini 4 Carbon",
            buckets: [
              { id: "gemini-weekly", name: "Weekly Limit Remaining", window: "weekly", remaining_fraction: weeklyRemaining, reset_time: weeklyResetIso },
              { id: "gemini-5h", name: "Five Hour Limit Remaining", window: "5h", remaining_fraction: fiveHourRemaining, reset_time: fiveHourResetIso },
            ],
          },
        ],
      },
    },
  });
}

test.skip(process.platform === "win32" || antigravityProgram() === null, "Antigravity quota e2e runs where agy and /bin/sh are available");
test.beforeAll(async () => {
  await model.start();
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
  model.stop();
});

test("an Antigravity conversation shows its five-hour and weekly usage limits in the statusline, updates after each turn, and exposes them to plan_usage", async ({ page }) => {
  const usageFile = join(host.root, "antigravity-usage.json");
  const wrapper = join(host.root, "agy-quota-wrapper");
  writeFileSync(
    wrapper,
    `#!/bin/sh\nif [ "$*" = "-p /usage --output-format json" ]; then cat "${usageFile}"; exit 0; fi\nexec "${antigravityProgram()}" "$@"\n`,
  );
  chmodSync(wrapper, 0o755);

  const now = Date.now();
  const fiveHourReset = new Date(now + 2 * HOUR_MS + 30 * MINUTE_MS).toISOString();
  const weeklyReset = new Date(now + 2 * 24 * HOUR_MS + 15 * HOUR_MS + 30 * MINUTE_MS).toISOString();
  writeFileSync(usageFile, usageReport(0.63, fiveHourReset, 0.12, weeklyReset));

  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const dialog = await createProfile(page, PROFILE, `${scriptedAntigravityEnvironment(model, host.root)}\nAGY_PATH=${wrapper}`, "", "Antigravity");
  await dialog.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${PROFILE} · Antigravity` });
  await startConversation(page);
  const statusline = page.locator(".statusline:visible");

  await expect(statusline.locator(".quota-meter")).toHaveText([/^5h 37% · 2h (29|30)m$/, /^7d 88% · 2d 1[45]h$/], { timeout: 15_000 });
  await expect(statusline.locator(".quota-meter").nth(0)).toHaveClass(/level-ok/);
  await expect(statusline.locator(".quota-meter").nth(1)).toHaveClass(/level-high/);
  await expect(statusline.getByLabel("Five-hour limit 37% used")).toHaveAttribute("data-hint", /usage limit of your plan: 37% used/);

  writeFileSync(usageFile, usageReport(0.59, fiveHourReset, 0.11, weeklyReset));
  await sendMessage(page, "first turn");
  await waitForTurnToEnd(page);
  await expect(statusline.locator(".quota-meter")).toHaveText([/^5h 41% · /, /^7d 89% · /], { timeout: 15_000 });

  writeFileSync(usageFile, usageReport(1, "1970-01-01T00:00:00Z", 0.5, weeklyReset));
  await sendMessage(page, "CALL plan_usage {}");
  await waitForTurnToEnd(page);
  await expect(lastAgentMessage(page)).toContainText('"usedPercent":41');
  await expect(statusline.locator(".quota-meter")).toHaveText([/^5h 0%$/, /^7d 50% · /], { timeout: 15_000 });
  await expect(statusline.getByLabel("Five-hour limit 0% used")).toHaveAttribute("data-hint", /usage limit of your plan: 0% used\./);
});
