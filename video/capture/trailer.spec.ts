import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { addWorkspaceFromSidebar, openSettings, signIn, useOwnVoiceServer, voiceSection, waitForTurnToEnd, walkthroughView, workspaceCard } from "../../e2e/helpers.ts";
import type { Demo, DemoConversation } from "../../e2e/seed-demo.ts";
import { TestHost } from "../../e2e/test-host.ts";
import { Cursor } from "./cursor.ts";
import { textOf } from "../narration/lines.ts";
import { DEMO_VIDEO, makeDemoVideo } from "./demo-video.ts";
import { CHECKOUT_TEST, checkoutTest, CLAUDE_SETTINGS, createWorld, git, REPLAY_SCRIPT, replayScript, worldIn } from "./demo-world.ts";
import { Director } from "./director.ts";
import { MEDIA_FROM_CACHE, setUpPlugins } from "./plugins.ts";
import { ClipRecorder } from "./recorder.ts";
import { BUILD_SERVER, DEAD_FLAGS_ANSWER, E2E_ANSWER, LAYOUT_CHOICE, MEDIA_INSTALLED, MEDIA_INSTALLED_REPLY, PULL_REQUEST, prompts, scripts } from "./scenes.ts";
import { expect, test } from "./studio.ts";
import { typeLikeAPerson } from "./typing.ts";

/**
 * Films the trailer's clips from a throwaway Mirador running the real Claude Code against the director, never against
 * anyone's account or conversations. Each scene is one clip in public/clips, with the moments and boxes the edit keys
 * its camera and captions to. Run from the repository: bunx playwright test -c video/playwright.config.ts
 */
const root = join(realpathSync(tmpdir()), `mirador-video-${crypto.randomUUID().slice(0, 8)}`);
const world = worldIn(root);
const { shopApi, mobileApp, storefront, infra } = world.projects;
const catalogFile = join(root, "official-plugins.json");
/** It runs a copy of the source, so another edit of the checkout during a take can't show the host's restart warning. */
const host = new TestHost({
  copiesSource: true,
  shell: "/bin/zsh",
  fakePrograms: true,
  environment: { HOME: world.home, ZDOTDIR: world.home, GIT_PAGER: "cat", MIRADOR_TEST_MODEL: "default", MIRADOR_TEST_EFFORT: "default", MIRADOR_PLUGIN_CATALOG: `file://${catalogFile}`, ...MEDIA_FROM_CACHE },
});
const director = new Director();
const clips = join(import.meta.dirname, "..", "public", "clips");
/** MIRADOR_VIDEO_SCENES=point,media films only those scenes and keeps the other clips; a scene may need the one before it to have run. */
const scenesToFilm = process.env.MIRADOR_VIDEO_SCENES?.split(",");
const scene = (title: string, body: () => Promise<void>) => (scenesToFilm && !scenesToFilm.includes(title.split(":")[0]!) ? Promise.resolve() : test.step(title, body));
const theme = process.env.MIRADOR_VIDEO_THEME ?? "dark";

/** A gh that answers like GitHub for the review's pull request, so posting the review needs no account and reaches no one. */
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
    elif [[ "$input" == *"addPullRequestReview("* ]]; then
      echo '{"data":{"addPullRequestReview":{"pullRequestReview":{"id":"PRR_1","url":"${PULL_REQUEST.url}#pullrequestreview-1"}}}}'
    else
      echo "{\\"data\\":{\\"addPullRequestReviewThread\\":{\\"thread\\":{\\"id\\":\\"PRRT_$RANDOM\\"}}}}"
    fi ;;
  *) echo "The capture's gh stand-in doesn't know: $*" >&2; exit 1 ;;
esac
`;
  mkdirSync(host.fakeProgramsDir, { recursive: true });
  writeFileSync(join(host.fakeProgramsDir, "gh"), gh, { mode: 0o755 });
}

/** The real opencode, which the host's PATH would not find in the fake home, for the profile the agent delegates to. */
function linkOpencode() {
  const onPath = [...(process.env.PATH ?? "").split(":"), join(homedir(), ".opencode", "bin")].map((folder) => join(folder, "opencode"));
  const opencode = onPath.find((program) => existsSync(program));
  if (!opencode) throw new Error("The trailer's delegate scene runs opencode: install it from https://opencode.ai");
  symlinkSync(opencode, join(host.fakeProgramsDir, "opencode"));
}

/**
 * The build server's home, on this machine. lsof names the real path of the run's log in the terminal that follows the
 * job, so it is a short one.
 */
const buildServerHome = join("/tmp", BUILD_SERVER);

/** An ssh that reaches only the build server, on this machine: the agent's, the host's checks and the terminal that follows the job. */
function writeFakeSsh() {
  const ssh = `#!/bin/bash
while [[ $# -gt 0 ]]; do
  case "$1" in
    --) shift; break ;;
    -[BbcDEeFIiJLlmOopQRSWw]) shift 2 ;;
    -*) shift ;;
    *) break ;;
  esac
done
[[ "$1" == "${BUILD_SERVER}" ]] || { echo "ssh: Could not resolve hostname $1" >&2; exit 255; }
shift
export HOME='${buildServerHome}' PATH='${join(buildServerHome, "bin")}':"$PATH"
cd "$HOME"
exec /bin/bash -c "$*"
`;
  writeFileSync(join(host.fakeProgramsDir, "ssh"), ssh, { mode: 0o755 });
}

/** The e2e run build-01 plays as its bunx: Playwright's list of passing tests, in about 15 seconds. */
const e2eRun = (tests: string[]) => `const tests = ${JSON.stringify(tests)};
console.log(\`\\nRunning \${tests.length} tests using 8 workers\\n\`);
for (const [index, test] of tests.entries()) {
  console.log(\`  ✓  \${index + 1} [chromium] › \${test} (\${(0.4 + ((index * 37) % 23) / 10).toFixed(1)}s)\`);
  await Bun.sleep(70);
}
console.log(\`\\n  \${tests.length} passed (3.4m)\`);
`;

const E2E_SPECS: Record<string, string[]> = {
  "checkout.spec.ts": ["pays with a saved card", "a capture that times out charges the card once", "releases the stock when the card is declined", "shows the order number", "applies a discount code"],
  "cart.spec.ts": ["adds an item", "keeps the cart after sign-in", "updates the total when the quantity changes", "removes the last item"],
  "login.spec.ts": ["signs in with a password", "signs in with a passkey", "locks the account after five tries"],
  "orders.spec.ts": ["lists past orders", "cancels an order before it ships", "downloads an invoice"],
  "search.spec.ts": ["finds a product by name", "filters by price", "suggests as you type"],
  "account.spec.ts": ["changes the email address", "deletes the account", "exports the data"],
};

/** 214 tests, the specs taking turns as Playwright's workers do. */
function e2eTests() {
  const titles = Object.entries(E2E_SPECS).flatMap(([spec, names]) => names.map((name, index) => `${spec}:${12 + index * 9}:3 › ${name}`));
  return Array.from({ length: 214 }, (_, index) => titles[(index * 5) % titles.length]!);
}

/** build-01's home: the project the suite runs in, and the bunx that plays the run. */
function setUpBuildServer() {
  rmSync(buildServerHome, { recursive: true, force: true });
  mkdirSync(join(buildServerHome, "shop-api"), { recursive: true });
  const run = join(root, "e2e-run.ts");
  writeFileSync(run, e2eRun(e2eTests()));
  execFileSync("bun", ["build", "--compile", run, "--outfile", join(buildServerHome, "bin", "bunx")], { stdio: "ignore" });
}

/**
 * The voice services the voice scene uses, all on this machine: speech recognition hears the user's question once and
 * "Thanks" after, the voice model sums the reply up in the line the agent is heard saying, and the reply voice is that
 * line as bun run narrate spoke it.
 */
let heard = 0;
const voiceServer = createServer((request, response) => {
  request.resume();
  request.on("end", () => {
    if (request.url!.endsWith("/audio/transcriptions")) {
      response.setHeader("content-type", "application/json");
      return response.end(JSON.stringify({ text: heard++ === 0 ? prompts.switchOverTime : "Thanks.", language: "en" }));
    }
    if (request.url!.endsWith("/chat/completions")) {
      response.setHeader("content-type", "application/json");
      return response.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: textOf("voiceReply") }, finish_reason: "stop" }] }));
    }
    response.setHeader("content-type", "audio/wav");
    response.end(readFileSync(join(import.meta.dirname, "..", "public", "narration", "voiceReply.wav")));
  });
});
const voiceAddress = () => `http://127.0.0.1:${(voiceServer.address() as AddressInfo).port}/v1`;

test.beforeAll(async () => {
  createWorld(world);
  writeFileSync(REPLAY_SCRIPT, replayScript, { mode: 0o755 });
  await makeDemoVideo(join(storefront, DEMO_VIDEO.file));
  git(storefront, "add", DEMO_VIDEO.file);
  git(storefront, "commit", "-q", "-m", "Checkout demo video");
  await new Promise<void>((resolve) => voiceServer.listen(0, "127.0.0.1", resolve));
  writeFakeGh();
  writeFakeSsh();
  linkOpencode();
  setUpBuildServer();
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
  voiceServer.close();
  rmSync(REPLAY_SCRIPT, { force: true });
  rmSync(buildServerHome, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
});

async function newConversationIn(page: Page, directory: string) {
  const previousUrl = page.url();
  await workspaceCard(page, directory).getByRole("button", { name: "+ New conversation" }).click();
  await expect(page).not.toHaveURL(previousUrl);
  await expect(page.locator(".chat-header:visible").getByLabel("Model", { exact: true })).toBeVisible({ timeout: 60_000 });
  return page.url().match(/#\/c\/(.+)$/)![1]!;
}

async function openConversation(page: Page, conversationId: string) {
  await page.evaluate((id) => {
    location.hash = `/c/${id}`;
  }, conversationId);
  await expect(page.locator(".composer:visible textarea")).toBeEditable();
}

/** Starts a turn without filming it, for conversations that work in the background of a scene. */
async function sendOffCamera(page: Page, conversationId: string, text: string) {
  await openConversation(page, conversationId);
  const composer = page.locator(".composer:visible textarea");
  await composer.fill(text);
  await composer.press("Enter");
  await expect(page.locator(".timeline:visible .message.user").filter({ hasText: text })).toBeVisible();
}

/** Types into the composer on camera and sends it. */
async function sendOnCamera(page: Page, cursor: Cursor, recorder: ClipRecorder, text: string) {
  const composer = page.locator(".composer:visible textarea");
  await cursor.click(composer);
  recorder.mark("typing");
  await typeLikeAPerson(page, text);
  await page.waitForTimeout(250);
  await page.keyboard.press("Enter");
  recorder.mark("sent");
}

/** The canvas page the agent showed last. */
const shownPage = (page: Page) => page.locator(".canvas-panel:visible .canvas-frame.show iframe").last().contentFrame();
/** The Media plugin's view on the canvas. */
const mediaView = (page: Page) => page.locator(".canvas-panel:visible .canvas-frame.app iframe").contentFrame();

/** Sets up dictation, spoken replies and Keep talking against the stand-in voice services, off camera. */
async function setUpVoice(page: Page) {
  const settings = await openSettings(page, "Voice");
  const speaking = voiceSection(settings, "When you speak");
  await useOwnVoiceServer(speaking, "Speech recognition", { url: voiceAddress(), model: "whisper-turbo" });
  await speaking.getByLabel("Send right away").check();
  await useOwnVoiceServer(voiceSection(settings, "Translating and summing up"), "Voice model", { url: voiceAddress(), model: "gemma" });
  const replies = voiceSection(settings, "When the agent replies");
  await useOwnVoiceServer(replies, "Read aloud", { url: voiceAddress(), model: "kokoro", voice: "bm_george" });
  await replies.getByLabel("Keep talking").check();
  await expect(replies.getByRole("status")).toHaveText("Saved.");
  await settings.getByRole("button", { name: "Close" }).click();
}

/** Restarts the host off camera, as a newly installed plugin asks, and brings the page back. */
async function restartHost(page: Page, cursor: Cursor) {
  await host.stop();
  await host.start();
  await page.reload();
  await cursor.restore();
}

/** A point of the Media view's timeline, at `seconds` of the video. */
async function timelinePoint(page: Page, seconds: number) {
  const tracks = (await mediaView(page).getByRole("slider", { name: "Time" }).boundingBox())!;
  return { x: tracks.x + (tracks.width * seconds) / DEMO_VIDEO.seconds, y: tracks.y + tracks.height * 0.75 };
}

const sidebarItem = (page: Page, directory: string, title: string) => workspaceCard(page, directory).locator("li", { hasText: title });
const canvasPane = (page: Page) => page.locator('[data-pane="canvas"]');

/** Reaching the last workspace scrolls the sidebar down; a person scrolls back up to see where it went. */
async function scrollSmoothlyToTop(scroller: Locator) {
  await scroller.evaluate((element) => element.scrollTo({ top: 0, behavior: "smooth" }));
  await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBe(0);
}

/** Scrolls a target to the middle of its scroller as a person's wheel would, instead of the jump Playwright makes. */
async function scrollSmoothlyTo(page: Page, target: Locator) {
  await target.evaluate((element) => element.scrollIntoView({ behavior: "smooth", block: "center" }));
  await page.waitForTimeout(800);
}

const update = (update: Record<string, unknown>) => ({ type: "acp", update });
const userSays = (text: string) => ({ type: "user-message", text });
const agentSays = (text: string) => update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text } });
const turnEnd = { type: "turn-end", stopReason: "end_turn" };
const ranCommand = (toolCallId: string, command: string, description: string, output: string) =>
  update({ sessionUpdate: "tool_call", toolCallId, title: command, kind: "execute", status: "completed", rawInput: { command, description }, content: [{ type: "content", content: { type: "text", text: output } }] });
const wroteFile = (toolCallId: string, title: string, path: string, content: string) =>
  update({ sessionUpdate: "tool_call", toolCallId, title, kind: "edit", status: "completed", locations: [{ path }], rawInput: { file_path: path, content }, content: [{ type: "diff", path, oldText: null, newText: content }] });

test("the trailer's clips", async ({ page }) => {
  mkdirSync(clips, { recursive: true });
  await page.addInitScript((chosen) => window.top === window && localStorage.setItem("mirador-theme", chosen), theme);
  const cursor = new Cursor(page, { x: 980, y: 620 });
  await cursor.install();
  await signIn(page, host);
  for (const directory of [infra, storefront, mobileApp, shopApi]) await addWorkspaceFromSidebar(page, directory, "Claude Code");

  const ids = {
    flakyLogin: await newConversationIn(page, shopApi),
    reviewRetries: await newConversationIn(page, shopApi),
    stopDoubleCharge: await newConversationIn(page, shopApi),
    explainCheckout: await newConversationIn(page, shopApi),
    tightenVideo: await newConversationIn(page, storefront),
    coldStart: await newConversationIn(page, mobileApp),
    settingsLayout: await newConversationIn(page, mobileApp),
    deadFlags: await newConversationIn(page, mobileApp),
    translate: await newConversationIn(page, storefront),
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
          agentSays("Fixed: the test pressed Enter before the sign-in form was ready. It now waits for the form, and twenty runs in a row pass."),
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
      conversation(ids.explainCheckout, "Explain the checkout flow", 1, []),
      conversation(ids.coldStart, "Speed up the cold start", 30, [userSays("Profile the cold start on a mid-range phone and cut it below a second."), agentSays("Starting a trace on the emulator…"), { type: "turn-end", stopReason: "refusal" }], "error"),
      conversation(ids.settingsLayout, "Pick a settings layout", 2, []),
      conversation(ids.deadFlags, "Find the dead feature flags", 5, []),
      conversation(ids.translate, "Translate the checkout pages", 2, []),
      conversation(ids.tightenVideo, "Tighten the checkout video", 4, []),
      conversation(ids.postgres, "Plan the Postgres 18 upgrade", 90, [userSays("Plan the upgrade to Postgres 18 with no downtime."), agentSays("Logical replication to a new 18 cluster, then a switch-over in the next maintenance window."), turnEnd]),
    ],
  };
  await host.stop();
  execFileSync("bun", [join(import.meta.dirname, "..", "..", "e2e", "seed-demo.ts"), join(host.dataDir, "state.sqlite"), JSON.stringify(demo)]);
  await host.start();
  await page.reload();
  await cursor.restore();
  const recorder = new ClipRecorder(page, clips);
  const film = async (name: string, scene: () => Promise<void>) => {
    await recorder.start(name);
    await scene();
    const info = await recorder.stop();
    console.log(`${name}: ${info.seconds.toFixed(1)} s, ${info.frames} frames, gaps median ${info.medianGapMs} ms, p95 ${info.p95GapMs} ms, moments ${JSON.stringify(info.moments)}`);
  };

  await scene("show: the agent draws the checkout flow", async () => {
    await openConversation(page, ids.explainCheckout);
    await page.waitForTimeout(500);
    await film("show", async () => {
      await recorder.markRect("composer", page.locator(".composer:visible"));
      await recorder.markRect("sidebar", page.locator("nav.sidebar"));
      await page.waitForTimeout(600);
      await sendOnCamera(page, cursor, recorder, prompts.explainCheckout);
      await expect(page.locator(".timeline:visible .tool-title").first()).toBeVisible();
      recorder.mark("firstTool");
      await expect(canvasPane(page).locator(".canvas-frame.show iframe").contentFrame().locator(".mermaid svg")).toBeVisible();
      recorder.mark("canvasShown");
      await recorder.markRect("canvas", canvasPane(page));
      await recorder.markRect("timeline", page.locator(".timeline:visible"));
      await cursor.glideTo({ x: 1150, y: 420 });
      await waitForTurnToEnd(page);
      recorder.mark("turnEnded");
      await page.waitForTimeout(2500);
    });
  });

  await scene("point: point at part of the page and have it changed", async () => {
    await film("point", async () => {
      await recorder.markRect("canvas", canvasPane(page));
      await page.waitForTimeout(500);
      await cursor.click(page.locator(".canvas-header:visible .point-toggle"));
      recorder.mark("pointing");
      await page.waitForTimeout(400);
      const mailRisk = shownPage(page).locator(".risk").nth(2);
      await recorder.markRect("risk", mailRisk);
      await cursor.click(mailRisk);
      recorder.mark("picked");
      const wordsBox = page.getByRole("dialog", { name: "Ask the agent about what you marked" });
      await expect(wordsBox.getByRole("textbox")).toBeFocused();
      await recorder.markRect("wordsBox", wordsBox);
      await typeLikeAPerson(page, prompts.emailAfterResponse);
      recorder.mark("typed");
      await page.waitForTimeout(300);
      await cursor.click(wordsBox.getByRole("button", { name: "Change" }));
      recorder.mark("asked");
      await expect(shownPage(page).locator(".risk.fixed")).toBeVisible({ timeout: 30_000 });
      await expect(shownPage(page).locator(".mermaid svg")).toBeVisible();
      recorder.mark("redrawn");
      await waitForTurnToEnd(page);
      recorder.mark("turnEnded");
      await page.waitForTimeout(2500);
    });
  });

  await scene("overview: agents at work across the projects", async () => {
    await sendOffCamera(page, ids.settingsLayout, prompts.settingsLayout);
    await sendOffCamera(page, ids.translate, prompts.translate);
    await sendOffCamera(page, ids.postgres, prompts.runbook);
    await openConversation(page, ids.explainCheckout);
    await film("overview", async () => {
      await recorder.markRect("sidebar", page.locator("nav.sidebar"));
      await recorder.markRect("shop", page.locator(".workspace-group").first());
      await cursor.glideTo({ x: 420, y: 520 });
      await expect(sidebarItem(page, mobileApp, "Pick a settings layout")).toContainText("Needs you", { timeout: 30_000 });
      recorder.mark("needsYou");
      await expect(sidebarItem(page, storefront, "Translate the checkout pages")).toContainText("Done", { timeout: 30_000 });
      recorder.mark("translateDone");
      await expect(sidebarItem(page, infra, "Plan the Postgres 18 upgrade")).toContainText("Done", { timeout: 30_000 });
      recorder.mark("runbookDone");
      await cursor.glideToElement(sidebarItem(page, mobileApp, "Pick a settings layout"), { offsetX: 0.35 });
      await page.waitForTimeout(900);
    });
  });

  await scene("ask: the agent asks with pictures", async () => {
    await film("ask", async () => {
      await page.waitForTimeout(400);
      await cursor.click(sidebarItem(page, mobileApp, "Pick a settings layout"), { offsetX: 0.35 });
      recorder.mark("opened");
      const ask = page.locator(".ask");
      await expect(ask.locator(".ask-option")).toHaveCount(3);
      await expect(page.locator(".ask-preview").last()).toBeVisible();
      await page.waitForTimeout(500);
      await recorder.markRect("question", canvasPane(page));
      await recorder.markRect("options", ask.locator(".ask-options"));
      recorder.mark("questionShown");
      const option = (label: string) => ask.locator(".ask-option", { hasText: label });
      await cursor.glideToElement(option("Search first"), { offsetY: 0.6 });
      await page.waitForTimeout(500);
      await cursor.glideToElement(option("Tabs per area"), { offsetY: 0.6 });
      await page.waitForTimeout(450);
      await cursor.click(option(LAYOUT_CHOICE).locator(".ask-option-label"));
      recorder.mark("picked");
      await page.waitForTimeout(500);
      await cursor.click(ask.getByRole("button", { name: "Submit" }));
      recorder.mark("submitted");
      await waitForTurnToEnd(page);
      recorder.mark("turnEnded");
      await recorder.markRect("timeline", page.locator(".timeline:visible"));
      await page.waitForTimeout(1800);
    });
  });

  await scene("review: a guided tour of the change", async () => {
    await openConversation(page, ids.reviewRetries);
    await film("review", async () => {
      await page.waitForTimeout(400);
      await recorder.markRect("composer", page.locator(".composer:visible"));
      await sendOnCamera(page, cursor, recorder, prompts.review);
      const view = walkthroughView(page).locator(".review");
      await expect(view.locator(".verdict")).toBeVisible();
      recorder.mark("reviewShown");
      await recorder.markRect("canvas", canvasPane(page));
      await recorder.markRect("verdict", view.locator(".verdict"));
      await page.waitForTimeout(1600);
      await cursor.click(view.getByRole("tab", { name: /Flow/ }));
      recorder.mark("flow");
      await page.waitForTimeout(900);
      const flowSteps = view.getByRole("navigation", { name: "Flow steps" });
      await cursor.click(flowSteps.getByText("The capture is retried"));
      recorder.mark("flowStep");
      await page.waitForTimeout(1500);
      await cursor.click(flowSteps.getByText("Backoff between attempts"));
      recorder.mark("flowStep3");
      await page.waitForTimeout(1200);
      await cursor.click(view.getByRole("tab", { name: /Findings/ }));
      recorder.mark("findings");
      const blocker = view.locator(".finding").first();
      await expect(blocker).toBeVisible();
      await recorder.markRect("blocker", blocker);
      await waitForTurnToEnd(page);
      await page.waitForTimeout(700);
      await cursor.click(blocker.getByRole("button", { name: "Ask", exact: true }));
      recorder.mark("askOpened");
      const askDialog = walkthroughView(page).getByRole("dialog", { name: "Ask the agent about these lines" });
      await expect(askDialog.locator("textarea")).toBeFocused();
      await recorder.markRect("askDialog", askDialog);
      await typeLikeAPerson(page, prompts.questionAboutBlocker);
      recorder.mark("questionTyped");
      await page.waitForTimeout(300);
      await cursor.click(askDialog.getByRole("button", { name: "Ask and update the review" }));
      recorder.mark("asked");
      const sentNote = view.locator(".review-sent");
      await expect(sentNote).toBeVisible();
      await page.waitForTimeout(500);
      await cursor.click(sentNote.getByRole("button", { name: "Show the chat" }));
      recorder.mark("chatShown");
      await recorder.markRect("timelineBeside", page.locator(".timeline:visible"));
      await recorder.markRect("canvasBeside", canvasPane(page));
      await expect(view.locator(".finding.agent-edited").first()).toBeVisible({ timeout: 20_000 });
      recorder.mark("rewritten");
      await recorder.markRect("rewrittenBlocker", view.locator(".finding").first());
      await waitForTurnToEnd(page);
      recorder.mark("answered");
      await page.waitForTimeout(1600);
      const nit = view.locator(".finding.severity-nit");
      await scrollSmoothlyTo(page, nit);
      await recorder.markRect("nit", nit);
      await cursor.click(nit.getByRole("button", { name: "Kept", exact: true }));
      recorder.mark("dropped");
      await expect(nit).toHaveClass(/dropped/);
      await page.waitForTimeout(500);
      const postPanel = view.locator(".post-panel");
      await scrollSmoothlyTo(page, postPanel);
      await recorder.markRect("postPanel", postPanel);
      await cursor.click(postPanel.getByRole("button", { name: "Post 2 findings to the pull request" }));
      recorder.mark("postClicked");
      await expect(postPanel.locator(".posted-note")).toContainText("2 findings are on your pending review");
      recorder.mark("posted");
      await recorder.markRect("postedPanel", postPanel);
      await page.waitForTimeout(2200);
    });
  });

  await scene("plugins: the agent recommends an official plugin, and installs it once the user says so", async () => {
    await openConversation(page, ids.tightenVideo);
    await film("plugins", async () => {
      await page.waitForTimeout(400);
      await recorder.markRect("composer", page.locator(".composer:visible"));
      await sendOnCamera(page, cursor, recorder, prompts.tightenVideo);
      const ask = page.locator(".ask");
      await expect(ask).toContainText("Install the Media plugin?");
      recorder.mark("asked");
      await recorder.markRect("question", canvasPane(page));
      await recorder.markRect("timeline", page.locator(".timeline:visible"));
      await page.waitForTimeout(1800);
      await cursor.click(ask.locator(".ask-option-label", { hasText: /^Install/ }));
      recorder.mark("picked");
      await page.waitForTimeout(400);
      await cursor.click(ask.getByRole("button", { name: "Submit" }));
      recorder.mark("submitted");
      await page.waitForTimeout(2500);
    });
    await expect(page.locator(".timeline:visible .message.user").last()).toContainText(MEDIA_INSTALLED, { timeout: 300_000 });
    await expect(page.locator(".timeline:visible .message.agent").last()).toContainText(MEDIA_INSTALLED_REPLY);
    await waitForTurnToEnd(page);
    await restartHost(page, cursor);
  });

  await scene("media: mark the part that drags, and the agent cuts it and renders the video", async () => {
    await openConversation(page, ids.tightenVideo);
    await film("media", async () => {
      await page.waitForTimeout(400);
      await recorder.markRect("composer", page.locator(".composer:visible"));
      await sendOnCamera(page, cursor, recorder, prompts.openVideo);
      await expect(mediaView(page).locator(".filmstrip img").first()).toBeVisible();
      recorder.mark("opened");
      await recorder.markRect("canvas", canvasPane(page));
      await waitForTurnToEnd(page);
      await page.waitForTimeout(600);
      await cursor.glideTo(await timelinePoint(page, DEMO_VIDEO.spinnerEnds - 0.2));
      await cursor.click();
      recorder.mark("seeked");
      await page.waitForTimeout(300);
      await cursor.click(mediaView(page).getByRole("button", { name: "Start a range here" }));
      recorder.mark("rangeStarted");
      await cursor.glideTo(await timelinePoint(page, DEMO_VIDEO.spinnerEnds - 0.2));
      await cursor.drag(await timelinePoint(page, DEMO_VIDEO.spinnerStarts + 0.2));
      recorder.mark("ranged");
      await recorder.markRect("timelineLanes", mediaView(page).getByRole("slider", { name: "Time" }));
      const frame = (await mediaView(page).locator(".frame").boundingBox())!;
      const { x, y, width, height } = DEMO_VIDEO.spinnerBox;
      const onFrame = (atX: number, atY: number) => ({ x: frame.x + (frame.width * atX) / DEMO_VIDEO.width, y: frame.y + (frame.height * atY) / DEMO_VIDEO.height });
      await cursor.glideTo(onFrame(x, y));
      await cursor.drag(onFrame(x + width, y + height));
      recorder.mark("boxed");
      await recorder.markRect("frame", mediaView(page).locator(".frame"));
      await cursor.click(mediaView(page).getByLabel("What's wrong here"));
      await typeLikeAPerson(page, prompts.spinnerNote);
      await page.keyboard.press("Enter");
      recorder.mark("markSent");
      await expect(mediaView(page).locator(".timeline .removed.cut")).toBeVisible({ timeout: 30_000 });
      recorder.mark("cut");
      await waitForTurnToEnd(page);
      recorder.mark("rendered");
      await page.waitForTimeout(800);
      await cursor.click(mediaView(page).getByRole("button", { name: "Rendered" }));
      recorder.mark("comparing");
      await page.waitForTimeout(500);
      await cursor.click(mediaView(page).getByRole("button", { name: "Play" }));
      recorder.mark("playing");
      await page.waitForTimeout(4000);
    });
  });

  await scene("delegate: the agent hands the reading to a local model, and checks what comes back", async () => {
    await openConversation(page, ids.deadFlags);
    const caller = sidebarItem(page, mobileApp, "Find the dead feature flags");
    const delegatedTask = page.locator(".delegated-tasks:visible li");
    await film("delegate", async () => {
      await page.waitForTimeout(400);
      await recorder.markRect("composer", page.locator(".composer:visible"));
      await recorder.markRect("caller", caller);
      await sendOnCamera(page, cursor, recorder, prompts.deadFlags);
      await expect(delegatedTask).toContainText("Working");
      recorder.mark("delegated");
      await recorder.markRect("timeline", page.locator(".timeline:visible"));
      await recorder.markRect("conversation", page.locator('[data-pane="conversation"]:visible'));
      await page.waitForTimeout(800);
      await cursor.click(caller.getByRole("button", { name: "1 delegated" }));
      recorder.mark("unfolded");
      await recorder.markRect("workspace", workspaceCard(page, mobileApp));
      await expect(delegatedTask.locator(".delegated-task-detail")).toBeVisible({ timeout: 60_000 });
      recorder.mark("working");
      await expect(delegatedTask).toContainText("Finished", { timeout: 60_000 });
      recorder.mark("replied");
      await expect(page.locator(".timeline:visible .message.agent").last()).toContainText(DEAD_FLAGS_ANSWER, { timeout: 60_000 });
      await waitForTurnToEnd(page);
      recorder.mark("checked");
      await page.waitForTimeout(2200);
    });
  });

  await scene("voice: ask out loud, hear the gist of the reply, and keep talking", async () => {
    await setUpVoice(page);
    await openConversation(page, ids.postgres);
    const composer = page.locator(".composer:visible");
    const dictate = composer.getByRole("button", { name: "Dictate" });
    await film("voice", async () => {
      await recorder.markRect("composer", composer);
      await page.waitForTimeout(600);
      await cursor.click(dictate);
      recorder.mark("listening");
      await cursor.glideToElement(page.locator(".timeline:visible"), { offsetX: 0.7, offsetY: 0.8 });
      await expect(page.locator(".timeline:visible .message.user").last()).toContainText(prompts.switchOverTime, { timeout: 30_000 });
      recorder.mark("sent");
      await recorder.markRect("timeline", page.locator(".timeline:visible"));
      await waitForTurnToEnd(page);
      recorder.mark("answered");
      await expect(page.locator('.read-aloud button[aria-label="Stop reading"]')).toBeVisible({ timeout: 30_000 });
      recorder.mark("reading");
      await expect(dictate).toHaveAttribute("aria-pressed", "true", { timeout: 30_000 });
      recorder.mark("listeningAgain");
      await page.waitForTimeout(1500);
      await page.keyboard.press("Escape");
      recorder.mark("stopped");
      await expect(dictate).toHaveAttribute("aria-pressed", "false");
      await page.waitForTimeout(800);
    });
  });

  await scene("edit: approve the change, then see what it touched", async () => {
    await openConversation(page, ids.stopDoubleCharge);
    await film("edit", async () => {
      await page.waitForTimeout(400);
      await sendOnCamera(page, cursor, recorder, prompts.fix);
      const approval = page.locator(".canvas-panel:visible .edit-approval");
      await expect(approval).toBeVisible();
      recorder.mark("approval");
      await recorder.markRect("canvas", canvasPane(page));
      await recorder.markRect("timeline", page.locator(".timeline:visible"));
      await page.waitForTimeout(1800);
      await cursor.click(approval.getByRole("button", { name: "Yes", exact: true }));
      recorder.mark("allowed");
      await waitForTurnToEnd(page);
      recorder.mark("turnEnded");
      await page.waitForTimeout(700);
      await cursor.click(canvasPane(page).getByRole("button", { name: "Changes" }));
      recorder.mark("changes");
      const changes = page.locator(".changes:visible");
      await expect(changes.getByRole("button", { name: /checkout\.ts .*Changed by the agent/ })).toBeVisible();
      await expect(canvasPane(page).getByText(/Allowed: edit/)).toBeHidden({ timeout: 15_000 });
      recorder.mark("turnListed");
      await page.waitForTimeout(900);
      await cursor.click(changes.getByRole("button", { name: "Uncommitted", exact: true }));
      recorder.mark("uncommitted");
      await expect(changes.getByRole("region", { name: "Outside the project" }).getByRole("button", { name: /replay-capture\.sh/ })).toBeVisible();
      const project = changes.getByRole("region", { name: "Project", exact: true });
      await expect(project.getByRole("button", { name: /checkout\.test\.ts/ })).toBeVisible();
      await expect(project.getByRole("button", { name: /README\.md/ })).toBeVisible();
      await expect(page.locator(".timeline:visible .error-line")).toHaveCount(0);
      recorder.mark("uncommittedListed");
      await recorder.markRect("changesList", changes);
      await page.waitForTimeout(2600);
    });
  });

  await scene("terminals: a shell beside the conversation", async () => {
    await openConversation(page, ids.explainCheckout);
    await film("terminals", async () => {
      await page.waitForTimeout(400);
      await cursor.click(page.getByRole("button", { name: "Show terminal" }));
      recorder.mark("shown");
      const terminals = page.locator(".terminal-pane .terminal-splits.shown .xterm");
      await expect(terminals.first()).toBeVisible();
      await page.waitForTimeout(600);
      await cursor.click(terminals.first());
      await typeLikeAPerson(page, "git log --oneline --graph main retry-payments");
      await page.keyboard.press("Enter");
      recorder.mark("logged");
      await page.waitForTimeout(900);
      await cursor.click(page.getByRole("button", { name: "Split right" }));
      await expect(terminals).toHaveCount(2);
      await page.waitForTimeout(500);
      await cursor.click(terminals.nth(1));
      await typeLikeAPerson(page, "git diff --stat main");
      await page.keyboard.press("Enter");
      await expect(page.locator(".terminal-pane .terminal-splits.shown .xterm-rows").nth(1)).toContainText("changed");
      recorder.mark("diffed");
      await recorder.markRect("terminals", page.locator('[data-pane="terminals"]'));
      await page.waitForTimeout(2000);
    });
    await page.getByRole("button", { name: "Hide terminal" }).click();
  });

  await scene("groups: put the workspaces in order", async () => {
    await film("groups", async () => {
      await recorder.markRect("sidebar", page.locator("nav.sidebar"));
      await page.waitForTimeout(400);
      await cursor.click(page.getByRole("button", { name: "New group" }));
      await typeLikeAPerson(page, "Platform");
      await page.keyboard.press("Enter");
      const platform = page.locator(".workspace-group", { has: page.locator(".group-name", { hasText: /^Platform$/ }) });
      await expect(platform).toBeVisible();
      recorder.mark("grouped");
      await page.waitForTimeout(600);
      await dragWorkspaceInto(page, cursor, workspaceCard(page, infra).locator(":scope > header"), platform.locator(":scope > header"));
      await expect(platform.locator("section.workspace")).toHaveCount(1);
      recorder.mark("moved");
      await page.waitForTimeout(500);
      await scrollSmoothlyToTop(page.locator(".sidebar-scroll"));
      recorder.mark("movedInView");
      await page.waitForTimeout(1800);
    });
  });

  await scene("jobs: the agent leaves the e2e suite running on the build server, and Mirador wakes it when the run ends", async () => {
    await openConversation(page, ids.stopDoubleCharge);
    const jobWait = page.locator('section[aria-label="Jobs waited for"]:visible');
    await film("jobs", async () => {
      await page.waitForTimeout(400);
      await recorder.markRect("composer", page.locator(".composer:visible"));
      await sendOnCamera(page, cursor, recorder, prompts.e2eOnBuildServer);
      await expect(jobWait).toContainText(`on ${BUILD_SERVER}`, { timeout: 60_000 });
      recorder.mark("waiting");
      await recorder.markRect("timeline", page.locator(".timeline:visible"));
      await recorder.markRect("jobWait", jobWait);
      await waitForTurnToEnd(page);
      recorder.mark("turnEnded");
      await page.waitForTimeout(900);
      await cursor.click(jobWait.locator(".job-wait-follow"));
      const following = page.locator(".terminal-pane .terminal-splits.shown .xterm-rows").last();
      await expect(following).toContainText("[chromium]", { timeout: 30_000 });
      recorder.mark("following");
      await recorder.markRect("terminals", page.locator('[data-pane="terminals"]'));
      await expect(following).toContainText("214 passed", { timeout: 60_000 });
      recorder.mark("passed");
      await expect(jobWait).toBeHidden({ timeout: 60_000 });
      recorder.mark("woken");
      await expect(page.locator(".timeline:visible .message.agent").last()).toContainText(E2E_ANSWER, { timeout: 60_000 });
      await waitForTurnToEnd(page);
      recorder.mark("reported");
      await page.waitForTimeout(2200);
    });
  });

  const strays = director.requests.filter(({ mainLoop, scripted }) => mainLoop && !scripted);
  expect(strays, "every turn the agents took came from a script").toEqual([]);
});

/** Drags a workspace by its heading onto the lower part of a group's heading, which puts it last in the group. */
async function dragWorkspaceInto(page: Page, cursor: Cursor, workspaceHeading: Locator, groupHeading: Locator) {
  await cursor.glideToElement(workspaceHeading, { offsetX: 0.3, offsetY: 0.4 });
  const target = (await groupHeading.boundingBox())!;
  await cursor.drag({ x: target.x + target.width * 0.4, y: target.y + target.height * 0.8 });
  await page.waitForTimeout(200);
}
