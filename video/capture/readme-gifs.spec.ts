import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, expect, test as base, type BrowserContext, type Page } from "@playwright/test";
import { addWorkspaceFromSidebar, reloadFromRestartedHost, signIn, waitForTurnToEnd, walkthroughView, workspaceCard } from "../../e2e/helpers.ts";
import type { Demo, DemoConversation } from "../../e2e/seed-demo.ts";
import { TestHost } from "../../e2e/test-host.ts";
import { Cursor } from "./cursor.ts";
import { CHECKOUT_TEST, checkoutAfter, checkoutTest, CLAUDE_SETTINGS, createWorld, REPLAY_SCRIPT, replayScript, worldIn } from "./demo-world.ts";
import { Director } from "./director.ts";
import { MEDIA_FROM_CACHE, setUpPlugins } from "./plugins.ts";
import { ClipRecorder } from "./recorder.ts";
import { CAR_MODE_CHOICE, DEAD_FLAGS_ANSWER, PULL_REQUEST, SIDE_CHAT_ANSWER, prompts, scripts } from "./scenes.ts";
import { typeLikeAPerson } from "./typing.ts";

/**
 * Films the 7 light-theme feature GIFs for README.md from a real Mirador 0.15.5 host at 1280x760:
 * 1. show-and-point — Show diagram + Point and ask live redraw
 * 2. ask            — Ask with visual iPhone mockup previews
 * 3. tour           — Guided code tour of a fix in execution order
 * 4. review         — Code review Flow + Findings + live Ask & update
 * 5. changes        — Edit approval on canvas + Changes view inline diff
 * 6. side-chat      — Side chat (/btw) beside the active conversation
 * 7. delegate       — Multi-agent Delegate (Claude Code -> local opencode)
 */
export const GIF_FRAME = { width: 1280, height: 760 };

const test = base.extend<{ context: BrowserContext }>({
  context: async ({}, use) => {
    const profile = mkdtempSync(join(tmpdir(), "mirador-gifs-chrome-"));
    const context = await chromium.launchPersistentContext(profile, {
      channel: process.platform === "darwin" ? "chrome" : undefined,
      headless: true,
      viewport: GIF_FRAME,
      deviceScaleFactor: 1,
      args: [`--window-size=${GIF_FRAME.width},${GIF_FRAME.height}`, "--hide-scrollbars", "--disable-audio-output"],
    });
    await use(context);
    await context.close();
    rmSync(profile, { recursive: true, force: true });
  },
  page: async ({ context }, use) => {
    await use(context.pages()[0] ?? (await context.newPage()));
  },
});

const root = join(realpathSync(tmpdir()), `mirador-gifs-${crypto.randomUUID().slice(0, 8)}`);
const world = worldIn(root);
const { shopApi, mobileApp, storefront, infra } = world.projects;
const catalogFile = join(root, "official-plugins.json");
const clips = join(import.meta.dirname, "..", "public", "gif-clips");
const only = process.env.MIRADOR_GIFS?.split(",");
const step = (name: string, body: () => Promise<void>) => (only && !only.includes(name) ? Promise.resolve() : test.step(name, body));

const director = new Director();
const host = new TestHost({
  copiesSource: true,
  shell: "/bin/zsh",
  fakePrograms: true,
  environment: () => ({
    HOME: world.home,
    ZDOTDIR: world.home,
    GIT_PAGER: "cat",
    MIRADOR_TEST_MODEL: "default",
    MIRADOR_TEST_EFFORT: "default",
    MIRADOR_PLUGIN_CATALOG: `file://${catalogFile}`,
    ...MEDIA_FROM_CACHE,
  }),
});

function writeFakeGh() {
  const pulls = `pulls/${PULL_REQUEST.number}`;
  const gh = `#!/bin/bash
input=""
if [[ " $* " == *" --input - "* ]]; then input=$(cat); fi
case "$*" in
  "auth status"*) exit 0 ;;
  *"${pulls}/reviews"*) echo '[]' ;;
  *"${pulls}"*) echo "{\\"node_id\\":\\"PR_42\\",\\"head\\":{\\"sha\\":\\"$(git -C '${shopApi}' rev-parse HEAD)\\"}}" ;;
  *graphql*)
    if [[ "$input" == *"reviewThreads("* ]]; then
      echo '{"data":{"repository":{"pullRequest":{"reviewThreads":{"pageInfo":{"hasNextPage":false,"endCursor":null},"nodes":[]}}}}}'
    elif [[ "$input" == *"reviews(states: PENDING"* ]]; then
      echo '{"data":{"repository":{"pullRequest":{"reviews":{"nodes":[]}}}}}'
    else
      echo '{"data":{"addPullRequestReview":{"pullRequestReview":{"id":"PRR_1","url":"${PULL_REQUEST.url}#pullrequestreview-1"}}}}'
    fi ;;
  *) exit 1 ;;
esac
`;
  mkdirSync(host.fakeProgramsDir, { recursive: true });
  writeFileSync(join(host.fakeProgramsDir, "gh"), gh, { mode: 0o755 });
}

function linkOpencode() {
  const onPath = [...(process.env.PATH ?? "").split(":"), join(homedir(), ".opencode", "bin")].map((folder) => join(folder, "opencode"));
  const opencode = onPath.find((program) => existsSync(program));
  if (!opencode) throw new Error("The delegate GIF runs opencode: install it from https://opencode.ai");
  symlinkSync(opencode, join(host.fakeProgramsDir, "opencode"));
}

test.beforeAll(async () => {
  createWorld(world);
  writeFileSync(REPLAY_SCRIPT, replayScript, { mode: 0o755 });
  writeFakeGh();
  linkOpencode();
  await director.start();
  mkdirSync(host.dataDir, { recursive: true });
  mkdirSync(host.claudeConfigDir, { recursive: true });
  writeFileSync(join(host.claudeConfigDir, "settings.json"), CLAUDE_SETTINGS);
  setUpPlugins(host.dataDir, catalogFile);
  execFileSync("bun", [join(import.meta.dirname, "seed-profile.ts"), join(host.dataDir, "state.sqlite"), director.environment, director.opencodeEnvironment]);
  await host.start();
  director.scripts = scripts({ projects: world.projects, assetsOrigin: `http://127.0.0.1:${host.port + 1}` });
});

test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
  director.stop();
  rmSync(REPLAY_SCRIPT, { force: true });
  rmSync(root, { recursive: true, force: true });
});

async function newConversationIn(page: Page, directory: string) {
  const previousUrl = page.url();
  await workspaceCard(page, directory).getByRole("button", { name: "+ New conversation" }).click();
  await expect(page).not.toHaveURL(previousUrl);
  await expect(page.locator(".chat-header:visible .settings-model")).toBeAttached({ timeout: 60_000 });
  return page.url().match(/#\/c\/(.+)$/)![1]!;
}

async function openConversation(page: Page, conversationId: string) {
  await page.evaluate((id) => {
    location.hash = `/c/${id}`;
  }, conversationId);
  await expect(page.locator(".main-chat:visible .composer textarea")).toBeEditable();
}

async function sendOffCamera(page: Page, conversationId: string, text: string) {
  await openConversation(page, conversationId);
  const composer = page.locator(".main-chat:visible .composer textarea");
  await composer.fill(text);
  await composer.press("Enter");
  await expect(page.locator(".main-chat:visible .timeline .message.user").filter({ hasText: text })).toBeVisible();
}

async function sendOnCamera(page: Page, cursor: Cursor, recorder: ClipRecorder, text: string) {
  const composer = page.locator(".main-chat:visible .composer textarea");
  await cursor.click(composer);
  recorder.mark("typing");
  await typeLikeAPerson(page, text);
  await page.waitForTimeout(180);
  await page.keyboard.press("Enter");
  recorder.mark("sent");
}

const shownPage = (page: Page) => page.locator(".canvas-panel:visible .canvas-frame.show iframe").last().contentFrame();
const sidebarItem = (page: Page, directory: string, title: string) => workspaceCard(page, directory).locator("li", { hasText: title });
const canvasPane = (page: Page) => page.locator('[data-pane="canvas"]');

const update = (update: Record<string, unknown>) => ({ type: "acp", update });
const userSays = (text: string) => ({ type: "user-message", text });
const agentSays = (text: string) => update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text } });
const turnEnd = { type: "turn-end", stopReason: "end_turn" };
const ranCommand = (toolCallId: string, command: string, description: string, output: string) =>
  update({ sessionUpdate: "tool_call", toolCallId, title: command, kind: "execute", status: "completed", rawInput: { command, description }, content: [{ type: "content", content: { type: "text", text: output } }] });
const wroteFile = (toolCallId: string, title: string, path: string, content: string) =>
  update({ sessionUpdate: "tool_call", toolCallId, title, kind: "edit", status: "completed", locations: [{ path }], rawInput: { file_path: path, content }, content: [{ type: "diff", path, oldText: null, newText: content }] });

test("the 7 README feature GIFs", async ({ page }) => {
  mkdirSync(clips, { recursive: true });
  await page.addInitScript(() => window.top === window && localStorage.setItem("mirador-theme", "light"));
  const cursor = new Cursor(page, { x: 820, y: 480 });
  await cursor.install();
  await signIn(page, host);
  for (const directory of [infra, storefront, mobileApp, shopApi]) await addWorkspaceFromSidebar(page, directory, "Claude Code");

  const ids = {
    flakyLogin: await newConversationIn(page, shopApi),
    reviewRetries: await newConversationIn(page, shopApi),
    stopDoubleCharge: await newConversationIn(page, shopApi),
    fixTour: await newConversationIn(page, shopApi),
    explainCheckout: await newConversationIn(page, shopApi),
    carMode: await newConversationIn(page, mobileApp),
    deadFlags: await newConversationIn(page, mobileApp),
    postgres: await newConversationIn(page, infra),
  };

  const conversation = (id: string, title: string, minutesAgo: number, events: unknown[], unseenTurnEnd?: DemoConversation["unseenTurnEnd"]): DemoConversation => ({ id, title, minutesAgo, events, unseenTurnEnd });
  const demo: Demo = {
    workspaceColors: { [shopApi]: "sky", [mobileApp]: "mint", [storefront]: "lavender", [infra]: "peach" },
    sidebar: [{ group: "Shop", workspaces: [shopApi, mobileApp, storefront] }, infra],
    conversations: [
      conversation(
        ids.flakyLogin,
        "Fix the flaky login test",
        25,
        [
          userSays("The login e2e fails about one run in ten. Find out why and fix it."),
          ranCommand("toolu_runs", "bunx playwright test e2e/login.spec.ts --repeat-each 20", "Run the login spec twenty times", "  20 passed (1.4m)"),
          agentSays("Fixed: the test pressed Enter before the sign-in form was ready. Twenty runs in a row pass."),
          turnEnd,
        ],
        "finished",
      ),
      conversation(ids.reviewRetries, "Review: retry card payments", 3, []),
      conversation(ids.stopDoubleCharge, "Stop the double charge", 6, [
        userSays(prompts.reproduce),
        wroteFile("toolu_test", `Write ${CHECKOUT_TEST}`, join(shopApi, CHECKOUT_TEST), checkoutTest),
        wroteFile("toolu_replay", `Write ${REPLAY_SCRIPT}`, REPLAY_SCRIPT, replayScript),
        agentSays(`The test fails: the card is charged twice. ${REPLAY_SCRIPT} replays it against the sandbox.`),
        turnEnd,
      ]),
      conversation(ids.fixTour, "Walk through the fix", 4, []),
      conversation(ids.explainCheckout, "Explain the checkout flow", 1, []),
      conversation(ids.carMode, "Design car mode", 2, []),
      conversation(ids.deadFlags, "Find the dead feature flags", 5, []),
      conversation(ids.postgres, "Plan the Postgres 18 upgrade", 90, [userSays("Plan the upgrade to Postgres 18 with no downtime."), agentSays("Logical replication to a new 18 cluster, then a switch-over in the maintenance window."), turnEnd]),
    ],
  };

  await host.stop();
  execFileSync("bun", [join(import.meta.dirname, "..", "..", "e2e", "seed-demo.ts"), join(host.dataDir, "state.sqlite"), JSON.stringify(demo)]);
  await host.start();
  await reloadFromRestartedHost(page);
  await cursor.restore();

  const recorder = new ClipRecorder(page, clips, { width: GIF_FRAME.width, height: GIF_FRAME.height, quality: 92 });
  const film = async (name: string, body: () => Promise<void>) => {
    await recorder.start(name);
    await body();
    const info = await recorder.stop();
    console.log(`gif ${name}: ${info.seconds.toFixed(1)} s, ${info.frames} frames, moments ${JSON.stringify(info.moments)}`);
  };

  await step("show-and-point", async () => {
    await openConversation(page, ids.explainCheckout);
    await page.waitForTimeout(300);
    await film("show-and-point", async () => {
      await sendOnCamera(page, cursor, recorder, prompts.explainCheckout);
      await expect(canvasPane(page).locator(".canvas-frame.show iframe").contentFrame().locator(".mermaid svg")).toBeVisible();
      recorder.mark("shown");
      await waitForTurnToEnd(page);
      await page.waitForTimeout(800);
      await cursor.click(page.locator(".canvas-header:visible .point-toggle"));
      recorder.mark("pointing");
      await page.waitForTimeout(300);
      await cursor.click(shownPage(page).locator(".risk").nth(2));
      const wordsBox = page.getByRole("dialog", { name: "Ask the agent about what you marked" });
      await expect(wordsBox.getByRole("textbox")).toBeFocused();
      await typeLikeAPerson(page, prompts.emailAfterResponse);
      await page.waitForTimeout(200);
      await cursor.click(wordsBox.getByRole("button", { name: "Change" }));
      recorder.mark("asked");
      await expect(shownPage(page).locator(".risk.fixed")).toBeVisible({ timeout: 30_000 });
      await expect(shownPage(page).locator(".mermaid svg")).toBeVisible();
      recorder.mark("done");
      await waitForTurnToEnd(page);
      await page.waitForTimeout(1000);
    });
  });

  await step("ask", async () => {
    await sendOffCamera(page, ids.carMode, prompts.carMode);
    await openConversation(page, ids.explainCheckout);
    await expect(sidebarItem(page, mobileApp, "Design car mode")).toContainText("Needs you", { timeout: 30_000 });
    await film("ask", async () => {
      await page.waitForTimeout(250);
      await cursor.click(sidebarItem(page, mobileApp, "Design car mode"), { offsetX: 0.35 });
      recorder.mark("opened");
      const ask = page.locator(".ask");
      await expect(ask.locator(".ask-option")).toHaveCount(3);
      await expect(page.locator(".ask-preview").last()).toBeVisible();
      await page.waitForTimeout(500);
      const option = (label: string) => ask.locator(".ask-option", { hasText: label });
      await cursor.glideToElement(option("Words on screen"), { offsetY: 0.55 });
      await page.waitForTimeout(350);
      await cursor.glideToElement(option("Dark, for night"), { offsetY: 0.55 });
      await page.waitForTimeout(350);
      await cursor.click(option(CAR_MODE_CHOICE).locator(".ask-option-label"));
      recorder.mark("picked");
      await page.waitForTimeout(350);
      await cursor.click(ask.getByRole("button", { name: "Submit" }));
      recorder.mark("submitted");
      await waitForTurnToEnd(page);
      recorder.mark("done");
      await page.waitForTimeout(900);
    });
  });

  await step("changes", async () => {
    await openConversation(page, ids.stopDoubleCharge);
    await page.waitForTimeout(300);
    await film("changes", async () => {
      await sendOnCamera(page, cursor, recorder, prompts.fix);
      const approval = page.locator(".canvas-panel:visible .edit-approval");
      await expect(approval).toBeVisible();
      recorder.mark("approval");
      await page.waitForTimeout(1000);
      await cursor.click(approval.getByRole("button", { name: "Yes", exact: true }));
      recorder.mark("approved");
      await waitForTurnToEnd(page);
      await page.waitForTimeout(450);
      await cursor.click(canvasPane(page).getByRole("button", { name: "Changes" }));
      const changes = page.locator(".changes:visible");
      await cursor.click(changes.getByRole("button", { name: "Uncommitted", exact: true }));
      const row = changes.locator('.changed-file[data-path="src/checkout.ts"]');
      await expect(row).toBeVisible();
      await cursor.click(row);
      await expect(changes.locator(".changes-diff")).toContainText("idempotencyKey");
      recorder.mark("done");
      await page.waitForTimeout(1000);
    });
  });

  await step("tour", async () => {
    // Ensure checkout.ts has the fix for the diff tour even if `changes` was skipped
    writeFileSync(join(shopApi, "src/checkout.ts"), checkoutAfter.replace("payments.capture(card, cart.total)", "payments.capture(card, cart.total, { idempotencyKey: cart.id })"));
    await openConversation(page, ids.fixTour);
    await page.waitForTimeout(300);
    await film("tour", async () => {
      await sendOnCamera(page, cursor, recorder, prompts.fixWithTour);
      const view = walkthroughView(page).locator(".review");
      await expect(view.getByRole("tab", { name: /Flow/ })).toBeVisible({ timeout: 30_000 });
      recorder.mark("opened");
      await waitForTurnToEnd(page);
      await page.waitForTimeout(700);
      await cursor.click(view.getByRole("tab", { name: /Flow/ }));
      await expect(view.locator(".code-row.added")).toContainText(["idempotencyKey: cart.id"]);
      recorder.mark("step1");
      await page.waitForTimeout(1200);
      await cursor.click(view.getByRole("button", { name: /Next/ }));
      await expect(view.locator(".flow-step-say")).toContainText("Idempotency-Key");
      recorder.mark("step2");
      await page.waitForTimeout(1200);
      await cursor.click(view.getByRole("tab", { name: /Files/ }));
      recorder.mark("done");
      await page.waitForTimeout(900);
    });
  });

  await step("review", async () => {
    await openConversation(page, ids.reviewRetries);
    await page.waitForTimeout(300);
    await film("review", async () => {
      await sendOnCamera(page, cursor, recorder, prompts.review);
      const view = walkthroughView(page).locator(".review");
      await expect(view.locator(".verdict")).toBeVisible();
      recorder.mark("opened");
      await page.waitForTimeout(900);
      await cursor.click(view.getByRole("tab", { name: /Flow/ }));
      await page.waitForTimeout(600);
      await cursor.click(view.getByRole("navigation", { name: "Flow steps" }).getByText("The capture is retried"));
      recorder.mark("flow");
      await page.waitForTimeout(950);
      await cursor.click(view.getByRole("tab", { name: /Findings/ }));
      const blocker = view.locator(".finding").first();
      await expect(blocker).toBeVisible();
      await waitForTurnToEnd(page);
      await page.waitForTimeout(550);
      await cursor.click(blocker.getByRole("button", { name: "Ask", exact: true }));
      const askDialog = walkthroughView(page).getByRole("dialog", { name: "Ask the agent about these lines" });
      await expect(askDialog.locator("textarea")).toBeFocused();
      await typeLikeAPerson(page, prompts.questionAboutBlocker);
      await page.waitForTimeout(200);
      await cursor.click(askDialog.getByRole("button", { name: "Ask and update the review" }));
      recorder.mark("asked");
      await expect(view.locator(".finding.agent-edited").first()).toBeVisible({ timeout: 25_000 });
      await waitForTurnToEnd(page);
      recorder.mark("done");
      await page.waitForTimeout(1000);
    });
  });

  await step("side-chat", async () => {
    await openConversation(page, ids.stopDoubleCharge);
    await page.waitForTimeout(300);
    await film("side-chat", async () => {
      const composer = page.locator(".main-chat:visible .composer textarea");
      await cursor.click(composer);
      recorder.mark("typing");
      await typeLikeAPerson(page, `/btw ${prompts.sideChatQuestion}`);
      await page.waitForTimeout(220);
      await page.keyboard.press("Enter");
      const side = page.locator(".side-chat:visible");
      await expect(side).toBeVisible({ timeout: 30_000 });
      recorder.mark("opened");
      await expect(side.locator(".timeline .message.agent").last()).toContainText(SIDE_CHAT_ANSWER, { timeout: 30_000 });
      recorder.mark("done");
      await page.waitForTimeout(1000);
    });
  });

  await step("delegate", async () => {
    await openConversation(page, ids.deadFlags);
    const caller = sidebarItem(page, mobileApp, "Find the dead feature flags");
    const delegatedTask = page.locator(".delegated-tasks:visible li:not(.delegated-group)").first();
    await film("delegate", async () => {
      await page.waitForTimeout(250);
      await sendOnCamera(page, cursor, recorder, prompts.deadFlags);
      await expect(delegatedTask).toContainText("Working", { timeout: 45_000 });
      recorder.mark("delegated");
      await page.waitForTimeout(550);
      await cursor.click(caller.getByRole("button", { name: "1 delegated" }));
      recorder.mark("unfolded");
      await expect(delegatedTask).toContainText("Finished", { timeout: 60_000 });
      await expect(page.locator(".main-chat:visible .timeline .message.agent").last()).toContainText(DEAD_FLAGS_ANSWER, { timeout: 60_000 });
      await waitForTurnToEnd(page);
      recorder.mark("done");
      await page.waitForTimeout(1000);
    });
  });

  const strays = director.requests.filter(({ mainLoop, scripted }) => mainLoop && !scripted);
  expect(strays, "every turn the agents took came from a script").toEqual([]);
});
