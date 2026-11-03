import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { addWorkspace, createProfile, sendMessage, signIn, startConversation, waitForTurnToEnd } from "./helpers.ts";
import { ScriptedModel, codexProgram, scriptedCodexEnvironment } from "./scripted-model.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();
const model = new ScriptedModel();
const PROFILE = "ChatGPT plan";
const MINUTE = 60;
const HOUR = 60 * MINUTE;

/** The rate limit headers ChatGPT's backend sends Codex with each reply: percents used, window lengths in minutes, and epoch seconds. */
function rateLimitHeaders(fiveHourPercent: number, weeklyPercent: number) {
  const now = Math.floor(Date.now() / 1000);
  return {
    "x-codex-primary-used-percent": String(fiveHourPercent),
    "x-codex-primary-window-minutes": "300",
    "x-codex-primary-reset-at": String(now + 2 * HOUR + 30 * MINUTE),
    "x-codex-secondary-used-percent": String(weeklyPercent),
    "x-codex-secondary-window-minutes": "10080",
    "x-codex-secondary-reset-at": String(now + 2 * 24 * HOUR + 15 * HOUR + 30 * MINUTE),
  };
}

test.skip(process.env.MIRADOR_E2E_CODEX !== "1" || codexProgram() === null, "Codex e2e runs only with MIRADOR_E2E_CODEX=1 and codex installed");
test.beforeAll(async () => {
  await model.start();
  await host.start();
});
test.afterAll(async () => {
  if (process.platform !== "win32") spawnSync("pkill", ["-f", join(host.root, "codex-home")]);
  await host.stop();
  await host.cleanUp();
  model.stop();
});

test("a Codex conversation shows the plan's five-hour and weekly usage that Codex hears from its backend, turn by turn", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const dialog = await createProfile(page, PROFILE, scriptedCodexEnvironment(model, host.root), "", "Codex");
  await dialog.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${PROFILE} · Codex` });
  await startConversation(page);
  const statusline = page.locator(".statusline:visible");

  model.responsesHeaders = rateLimitHeaders(37, 88);
  await sendMessage(page, "first");
  await waitForTurnToEnd(page);
  await expect(statusline.locator(".quota-meter")).toHaveText([/^5h 37% · 2h (29|30)m$/, /^7d 88% · 2d 1[45]h$/]);
  await expect(statusline.getByLabel("Five-hour limit 37% used")).toHaveAttribute("data-hint", /usage limit of your plan: 37% used/);

  model.responsesHeaders = rateLimitHeaders(41, 89);
  await sendMessage(page, "second");
  await waitForTurnToEnd(page);
  await expect(statusline.locator(".quota-meter")).toHaveText([/^5h 41% · /, /^7d 89% · /]);
});
