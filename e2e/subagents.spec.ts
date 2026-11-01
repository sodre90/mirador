import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Locator } from "@playwright/test";
import { FakeClaudeApi, subscriptionEnvironment } from "./fake-claude-api.ts";
import { addWorkspace, createProfile, reloadFromRestartedHost, sendMessage, signIn, startConversation, waitForTurnToEnd } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();
const api = new FakeClaudeApi();
const PROFILE = "fake claude";
const claudeConfigDir = join(host.root, "claude-config");

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

test("a subagent's work folds into its card, and the header counts the subagents still at work", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const dialog = await createProfile(page, PROFILE, `${subscriptionEnvironment(api)}\nCLAUDE_CONFIG_DIR=${claudeConfigDir}`);
  await dialog.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${PROFILE} · Claude Code` });
  const conversationId = await startConversation(page);
  await sendMessage(page, "hello");
  await waitForTurnToEnd(page);

  await host.stop();
  execFileSync("bun", [join(import.meta.dirname, "seed-subagents.ts"), join(host.dataDir, "state.sqlite"), conversationId]);
  execFileSync("bun", [join(import.meta.dirname, "seed-subagent-transcript.ts"), join(host.dataDir, "state.sqlite"), conversationId, claudeConfigDir]);
  await host.start();
  await reloadFromRestartedHost(page);

  const cards = page.locator(".timeline .tool.subagent");
  const [explore, watch] = [cards.nth(0), cards.nth(1)];
  const chip = page.locator(".chat-header .subagents-running");
  const dock = page.getByRole("status", { name: "Subagents at work" });
  const watchLatest = watch.locator(".subagent-work > *").last();
  const lint = page.locator(".timeline > .timeline-entry .shell", { hasText: "bun run lint" });

  await test.step("each subagent is one card with what it is, and what it did is inside it", async () => {
    await expect(cards).toHaveCount(2);
    await expect(explore.locator(".subagent-task")).toHaveText("Explore the cache");
    await expect(explore.locator(".subagent-facts")).toHaveText("Explore · haiku · 2 calls · 39 s");
    await expect(explore).toHaveClass(/subagent-done/);
    await expect(watch.locator(".subagent-facts")).toContainText("sonnet · 3 calls · ");
    await expect(watch.locator(".subagent-facts")).toContainText("in the background");
    await expect(page.locator(".timeline .tool:not(.subagent)", { hasText: "Read host/cache.ts" })).toHaveCount(1);
    await expect(explore.locator(".subagent-work .tool", { hasText: "Read host/cache.ts" })).toBeAttached();
    await expect(page.locator(".message.agent", { hasText: "Both subagents are on it." })).toBeVisible();
    await expect(page.locator(".message.agent", { hasText: "The cache lives in host/cache.ts." })).toBeHidden();
    await explore.locator("summary").first().click();
    await explore.locator(".subagent-prompt > summary").click();
    await expect(explore.locator(".subagent-prompt pre")).toHaveText("Find where the cache lives.");
    await expect(explore.locator(".subagent-work .message.agent")).toHaveText("The cache lives in host/cache.ts.");
    await expect(explore.locator(".tool-output").last()).toHaveText("Report: the cache is in host/cache.ts.");
  });

  await test.step("while the turn is open the background subagent counts as running", async () => {
    await expect(watch).toHaveClass(/subagent-stopped/);
    await expect(chip).toHaveCount(0);
    await expect(lint, "nothing runs while the conversation is idle").toHaveClass(/tool-pending/);
    api.hold();
    await sendMessage(page, "Keep an eye on the build");
    await expect(chip).toHaveText("◐ 1 subagent running", { timeout: 60_000 });
    await expect(lint, "the call the agent runs shows as running, though claude-agent-acp reports it pending").toHaveClass(/tool-in_progress/);
    await expect(lint.locator(".shell-quiet")).toHaveText("running…");
    await expect(watch).toHaveClass(/subagent-running/);
    await expect(watch.locator(".subagent-now")).toHaveText("now: bun run build");
    await expect(watch.locator(":scope > summary > .tool-status"), "the running subagent's own icon blinks").toHaveCSS("animation-name", "pulse");
    await expect(watch.locator(".subagent-work .tool-completed .tool-status"), "a call it finished does not").toHaveCSS("animation-name", "none");
    await expect(watchLatest, "the call it runs shows as running, though claude-agent-acp reports it pending").toHaveClass(/tool-in_progress/);
    await expect(watchLatest.locator(".shell-quiet")).toHaveText("running…");
    await expect(watch.locator(".subagent-work .tool", { hasText: "advisor" }), "a server call that work followed has ended").toHaveClass(/tool-pending/);
    await page.locator(".timeline").evaluate((timeline) => timeline.scrollTo(0, 0));
    await chip.click();
    await expect(watchLatest).toContainText("bun run build");
    await expect(watchLatest, "the subagent's latest work, at the end of its long card").toBeInViewport();
    await expect(watch).toHaveAttribute("open");
  });

  await test.step("a shell block in a subagent's card looks as it does in the timeline, its command not framed apart from its output", async () => {
    const commandPlacement = (shell: Locator) =>
      shell.evaluate((element) => {
        const summary = element.querySelector(":scope > summary")!;
        const command = summary.querySelector(":scope > .shell-body")!.getBoundingClientRect();
        const block = element.getBoundingClientRect();
        return { left: command.left - block.left, right: block.right - command.right, background: getComputedStyle(summary).backgroundColor };
      });
    await expect(watch).toHaveAttribute("open");
    const nested = watch.locator(".subagent-work .shell", { hasText: "bun run build" });
    expect(await commandPlacement(nested)).toEqual(await commandPlacement(lint));
  });

  await test.step("above the message box, the subagents at work stay in sight wherever the conversation is scrolled, and open at their latest work", async () => {
    await expect(dock.getByRole("button")).toHaveCount(1);
    await expect(dock.locator(".subagent-task")).toHaveText("Watch the build");
    await expect(dock.locator(".subagent-now")).toHaveText("now: bun run build");
    await expect(dock.locator(".subagent-facts")).toHaveText(/^Sonnet 4\.5 · 2\.23M in · 3\.5k out · \d/);
    await expect(dock.locator(".subagent-facts")).toHaveAttribute(
      "data-hint",
      "Input tokens: 2.2M read from the cache, 25k written to it, 5 new. Counted from Claude Code's transcript of the subagent.",
    );
    await watch.locator("summary").first().click();
    await expect(watch).not.toHaveAttribute("open");
    await page.locator(".timeline").evaluate((timeline) => timeline.scrollTo(0, 0));
    await dock.getByRole("button").click();
    await expect(watchLatest).toBeInViewport();
    await expect(watch).toHaveAttribute("open");
  });

  await test.step("the subagent is done when the turn ends", async () => {
    api.answerHeld();
    await waitForTurnToEnd(page);
    await expect(chip).toHaveCount(0);
    await expect(dock).toHaveCount(0);
    await expect(watch).toHaveClass(/subagent-done/);
    await expect(watchLatest, "a call left unfinished is no longer shown running").toHaveClass(/tool-pending/);
    await expect(lint).toHaveClass(/tool-pending/);
  });
});
