import { execFileSync, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { addWorkspaceFromSidebar, reloadFromRestartedHost, signIn, waitForTurnToEnd, walkthroughView, workspaceCard } from "../../e2e/helpers.ts";
import type { Demo, DemoConversation } from "../../e2e/seed-demo.ts";
import { TestHost } from "../../e2e/test-host.ts";
import { Cursor } from "./cursor.ts";
import { DEMO_VIDEO, makeDemoVideo } from "./demo-video.ts";
import { CHECKOUT_TEST, checkoutTest, CLAUDE_SETTINGS, createWorld, git, REPLAY_SCRIPT, replayScript, worldIn } from "./demo-world.ts";
import { Director } from "./director.ts";
import { MEDIA_FROM_CACHE, setUpPlugins } from "./plugins.ts";
import { ClipRecorder } from "./recorder.ts";
import { BUILD_SERVER, CAR_MODE_CHOICE, DEAD_FLAGS_ANSWER, E2E_ANSWER, FLAGS_DELETED, PAYMENT_TESTS_ANSWER, PULL_REQUEST, SIDE_CHAT_ANSWER, SIDE_CHAT_QUOTE, prompts, scripts } from "./scenes.ts";
import { expect, test } from "./studio.ts";
import { typeLikeAPerson } from "./typing.ts";

/**
 * Films the 0.15.5 trailer's 10 dark-theme 4K clips from a real throwaway Mirador host running real Claude Code,
 * real opencode, real plugins, and a local mirador-p2p broker — never touching anyone's real data or account.
 */
const root = join(realpathSync(tmpdir()), `mirador-video-${crypto.randomUUID().slice(0, 8)}`);
const world = worldIn(root);
const { shopApi, mobileApp, storefront, infra } = world.projects;
const catalogFile = join(root, "official-plugins.json");
const clips = join(import.meta.dirname, "..", "public", "clips");
const scenesToFilm = process.env.MIRADOR_VIDEO_SCENES?.split(",");
const scene = (title: string, body: () => Promise<void>) => (scenesToFilm && !scenesToFilm.includes(title.split(":")[0]!) ? Promise.resolve() : test.step(title, body));
const theme = process.env.MIRADOR_VIDEO_THEME ?? "dark";

const director = new Director();
let p2pBroker: ChildProcess | undefined;
let p2pEnv: Record<string, string> = {};

function findP2pBinary(): string | null {
  const candidates = [
    process.env.MIRADOR_P2P_BINARY,
    join(homedir(), "prj", "mirador-p2p", "target", "debug", "mirador-p2p"),
  ].filter((p): p is string => Boolean(p));
  const binDir = join(homedir(), ".mirador", "p2p", "bin");
  if (existsSync(binDir)) {
    for (const entry of readdirSync(binDir)) candidates.push(join(binDir, entry));
  }
  return candidates.find((p) => existsSync(p)) ?? null;
}

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = createServer().once("error", reject).listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });

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
    ...p2pEnv,
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

function linkOpencode() {
  const onPath = [...(process.env.PATH ?? "").split(":"), join(homedir(), ".opencode", "bin")].map((folder) => join(folder, "opencode"));
  const opencode = onPath.find((program) => existsSync(program));
  if (!opencode) throw new Error("The trailer's delegate scene runs opencode: install it from https://opencode.ai");
  symlinkSync(opencode, join(host.fakeProgramsDir, "opencode"));
}

const buildServerHome = join("/tmp", BUILD_SERVER);

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

const e2eRun = (tests: string[]) => `const tests = ${JSON.stringify(tests)};
console.log(\`\\nRunning \${tests.length} tests using 8 workers\\n\`);
for (const [index, test] of tests.entries()) {
  console.log(\`  ✓  \${index + 1} [chromium] › \${test} (\${(0.4 + ((index * 37) % 23) / 10).toFixed(1)}s)\`);
  await Bun.sleep(65);
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

function e2eTests() {
  const titles = Object.entries(E2E_SPECS).flatMap(([spec, names]) => names.map((name, index) => `${spec}:${12 + index * 9}:3 › ${name}`));
  return Array.from({ length: 214 }, (_, index) => titles[(index * 5) % titles.length]!);
}

function setUpBuildServer() {
  rmSync(buildServerHome, { recursive: true, force: true });
  mkdirSync(join(buildServerHome, "shop-api"), { recursive: true });
  const run = join(root, "e2e-run.ts");
  writeFileSync(run, e2eRun(e2eTests()));
  execFileSync("bun", ["build", "--compile", run, "--outfile", join(buildServerHome, "bin", "bunx")], { stdio: "ignore" });
}

async function startLocalP2pBroker() {
  const binary = findP2pBinary();
  if (!binary) return;
  const dir = join(root, "p2p");
  mkdirSync(dir, { recursive: true });
  const [privateKey, publicKey] = spawnSync(binary, ["keygen"], { encoding: "utf8" }).stdout.trim().split("\n");
  if (!privateKey || !publicKey) return;
  const keyFile = join(dir, "broker.key");
  writeFileSync(keyFile, privateKey, { mode: 0o600 });
  const port = await freePort();
  p2pBroker = spawn(binary, ["broker", `--udp=127.0.0.1:${port}`, `--key-file=${keyFile}`], { stdio: ["ignore", "ignore", "inherit"], env: { ...process.env, RUST_LOG: "warn" } });
  p2pEnv = { MIRADOR_P2P_BINARY: binary, MIRADOR_P2P_BROKER: `localhost:${port}`, MIRADOR_P2P_BROKER_KEY: publicKey };
}

test.beforeAll(async () => {
  createWorld(world);
  writeFileSync(REPLAY_SCRIPT, replayScript, { mode: 0o755 });
  await makeDemoVideo(join(storefront, DEMO_VIDEO.file));
  git(storefront, "add", DEMO_VIDEO.file);
  git(storefront, "commit", "-q", "-m", "Checkout demo video");
  writeFakeGh();
  writeFakeSsh();
  linkOpencode();
  setUpBuildServer();
  await startLocalP2pBroker();
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
  p2pBroker?.kill();
  await host.stop();
  await host.cleanUp();
  director.stop();
  rmSync(REPLAY_SCRIPT, { force: true });
  rmSync(buildServerHome, { recursive: true, force: true });
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
  await expect(page.locator(".composer:visible textarea").first()).toBeEditable();
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
  await page.waitForTimeout(220);
  await page.keyboard.press("Enter");
  recorder.mark("sent");
}

const shownPage = (page: Page) => page.locator(".canvas-panel:visible .canvas-frame.show iframe").last().contentFrame();
const mediaView = (page: Page) => page.locator(".canvas-panel:visible .canvas-frame.app iframe").contentFrame();
const sidebarItem = (page: Page, directory: string, title: string) => workspaceCard(page, directory).locator("li", { hasText: title });
const canvasPane = (page: Page) => page.locator('[data-pane="canvas"]');

async function timelinePoint(page: Page, seconds: number) {
  const tracks = (await mediaView(page).getByRole("slider", { name: "Time" }).boundingBox())!;
  return { x: tracks.x + (tracks.width * seconds) / DEMO_VIDEO.seconds, y: tracks.y + tracks.height * 0.75 };
}

/** Where the words sit on the page, in the first text inside `within` that holds them. */
async function textBox(within: Locator, words: string) {
  return within.evaluate((element, wanted) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = node.textContent!.indexOf(wanted);
      if (at === -1) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + wanted.length);
      const { x, y, width, height } = range.getBoundingClientRect();
      return { x, y, width, height };
    }
    throw new Error(`No "${wanted}" in ${element.textContent}`);
  }, words);
}

const update = (update: Record<string, unknown>) => ({ type: "acp", update });
const userSays = (text: string) => ({ type: "user-message", text });
const agentSays = (text: string) => update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text } });
const turnEnd = { type: "turn-end", stopReason: "end_turn" };
const ranCommand = (toolCallId: string, command: string, description: string, output: string) =>
  update({ sessionUpdate: "tool_call", toolCallId, title: command, kind: "execute", status: "completed", rawInput: { command, description }, content: [{ type: "content", content: { type: "text", text: output } }] });
const wroteFile = (toolCallId: string, title: string, path: string, content: string) =>
  update({ sessionUpdate: "tool_call", toolCallId, title, kind: "edit", status: "completed", locations: [{ path }], rawInput: { file_path: path, content }, content: [{ type: "diff", path, oldText: null, newText: content }] });

test("the 0.15.5 trailer clips", async ({ page }) => {
  mkdirSync(clips, { recursive: true });
  await page.addInitScript((chosen) => window.top === window && localStorage.setItem("mirador-theme", chosen), theme);
  const cursor = new Cursor(page, { x: 980, y: 580 });
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
        agentSays(`The test fails: a retried capture charges the card twice, as it carries no ${SIDE_CHAT_QUOTE}. ${REPLAY_SCRIPT} replays it against the sandbox.`),
        turnEnd,
      ]),
      conversation(ids.explainCheckout, "Explain the checkout flow", 1, []),
      conversation(ids.coldStart, "Speed up the cold start", 30, [userSays("Profile the cold start on a mid-range phone."), agentSays("Starting a trace on the emulator…"), { type: "turn-end", stopReason: "refusal" }], "error"),
      conversation(ids.carMode, "Design car mode", 2, []),
      conversation(ids.deadFlags, "Dead flags", 5, []),
      conversation(ids.tightenVideo, "Tighten the checkout video", 4, []),
      conversation(ids.postgres, "Plan the Postgres 18 upgrade", 90, [userSays("Plan the upgrade to Postgres 18 with no downtime."), agentSays("Logical replication to a new 18 cluster, then a switch-over in the maintenance window."), turnEnd]),
    ],
  };

  await host.stop();
  execFileSync("bun", [join(import.meta.dirname, "..", "..", "e2e", "seed-demo.ts"), join(host.dataDir, "state.sqlite"), JSON.stringify(demo)]);
  await host.start();
  await reloadFromRestartedHost(page);
  await cursor.restore();

  const recorder = new ClipRecorder(page, clips);
  const film = async (name: string, body: () => Promise<void>) => {
    await recorder.start(name);
    await body();
    const info = await recorder.stop();
    console.log(`${name}: ${info.seconds.toFixed(1)} s, ${info.frames} frames, median ${info.medianGapMs} ms, moments ${JSON.stringify(info.moments)}`);
  };

  await scene("showPoint: live diagram on the canvas, then point at a risk and update it live", async () => {
    await openConversation(page, ids.explainCheckout);
    await page.waitForTimeout(400);
    await film("showPoint", async () => {
      await sendOnCamera(page, cursor, recorder, prompts.explainCheckout);
      await expect(canvasPane(page).locator(".canvas-frame.show iframe").contentFrame().locator(".mermaid svg")).toBeVisible();
      recorder.mark("canvasShown");
      await recorder.markRect("canvas", canvasPane(page));
      await waitForTurnToEnd(page);
      await page.waitForTimeout(900);
      await cursor.click(page.locator(".canvas-header:visible .point-toggle"));
      recorder.mark("pointing");
      await page.waitForTimeout(350);
      const mailRisk = shownPage(page).locator(".risk").nth(2);
      await cursor.click(mailRisk);
      const wordsBox = page.getByRole("dialog", { name: "Ask the agent about what you marked" });
      await expect(wordsBox.getByRole("textbox")).toBeFocused();
      await typeLikeAPerson(page, prompts.emailAfterResponse);
      await page.waitForTimeout(250);
      await cursor.click(wordsBox.getByRole("button", { name: "Change" }));
      recorder.mark("asked");
      await expect(shownPage(page).locator(".risk.fixed")).toBeVisible({ timeout: 30_000 });
      await expect(shownPage(page).locator(".mermaid svg")).toBeVisible();
      recorder.mark("redrawn");
      await waitForTurnToEnd(page);
      recorder.mark("turnEnded");
      await page.waitForTimeout(2200);
    });
  });

  await scene("ask: the agent asks with visual iPhone mockups", async () => {
    await sendOffCamera(page, ids.carMode, prompts.carMode);
    await openConversation(page, ids.explainCheckout);
    await expect(sidebarItem(page, mobileApp, "Design car mode")).toContainText("Needs you", { timeout: 30_000 });
    await film("ask", async () => {
      await page.waitForTimeout(300);
      await cursor.click(sidebarItem(page, mobileApp, "Design car mode"), { offsetX: 0.35 });
      recorder.mark("opened");
      const ask = page.locator(".ask");
      await expect(ask.locator(".ask-option")).toHaveCount(3);
      await expect(page.locator(".ask-preview").last()).toBeVisible();
      await page.waitForTimeout(450);
      await recorder.markRect("question", canvasPane(page));
      const option = (label: string) => ask.locator(".ask-option", { hasText: label });
      await cursor.glideToElement(option("Words on screen"), { offsetY: 0.6 });
      await page.waitForTimeout(400);
      await cursor.glideToElement(option("Dark, for night"), { offsetY: 0.6 });
      await page.waitForTimeout(350);
      await cursor.click(option(CAR_MODE_CHOICE).locator(".ask-option-label"));
      recorder.mark("picked");
      await page.waitForTimeout(350);
      await cursor.click(ask.getByRole("button", { name: "Submit" }));
      recorder.mark("submitted");
      await waitForTurnToEnd(page);
      recorder.mark("turnEnded");
      await page.waitForTimeout(1600);
    });
  });

  await scene("review: guided code tour and live finding update in place", async () => {
    await openConversation(page, ids.reviewRetries);
    await film("review", async () => {
      await page.waitForTimeout(300);
      await sendOnCamera(page, cursor, recorder, prompts.review);
      const view = walkthroughView(page).locator(".review");
      await expect(view.locator(".verdict")).toBeVisible();
      recorder.mark("reviewShown");
      await recorder.markRect("canvas", canvasPane(page));
      await page.waitForTimeout(1300);
      await cursor.click(view.getByRole("tab", { name: /Flow/ }));
      recorder.mark("flow");
      await page.waitForTimeout(700);
      const flowSteps = view.getByRole("navigation", { name: "Flow steps" });
      await cursor.click(flowSteps.getByText("The capture is retried"));
      recorder.mark("flowStep");
      await page.waitForTimeout(1200);
      await cursor.click(flowSteps.getByText("Backoff between attempts"));
      await page.waitForTimeout(900);
      await cursor.click(view.getByRole("tab", { name: /Findings/ }));
      recorder.mark("findings");
      const blocker = view.locator(".finding").first();
      await expect(blocker).toBeVisible();
      await recorder.markRect("blocker", blocker);
      await waitForTurnToEnd(page);
      await page.waitForTimeout(500);
      await cursor.click(blocker.getByRole("button", { name: "Ask", exact: true }));
      const askDialog = walkthroughView(page).getByRole("dialog", { name: "Ask the agent about these lines" });
      await expect(askDialog.locator("textarea")).toBeFocused();
      await typeLikeAPerson(page, prompts.questionAboutBlocker);
      await page.waitForTimeout(250);
      await cursor.click(askDialog.getByRole("button", { name: "Ask and update the review" }));
      recorder.mark("asked");
      await expect(view.locator(".finding.agent-edited").first()).toBeVisible({ timeout: 25_000 });
      recorder.mark("rewritten");
      await recorder.markRect("rewrittenBlocker", view.locator(".finding").first());
      await waitForTurnToEnd(page);
      recorder.mark("answered");
      await page.waitForTimeout(1800);
    });
  });

  await scene("sideChat: select words in the conversation and ask about them in a side chat while the agent works", async () => {
    await openConversation(page, ids.stopDoubleCharge);
    await cursor.click(page.locator(".chat-header:visible .toggle-canvas"));
    await expect(canvasPane(page)).toBeHidden();
    await sendOffCamera(page, ids.stopDoubleCharge, prompts.paymentTests);
    await expect(page.locator(".chat-header:visible .badge")).not.toHaveText("idle", { timeout: 30_000 });
    await page.waitForTimeout(1200);
    const mainChat = page.locator(".main-chat:visible");
    const side = page.locator(".side-chat:visible");
    await film("sideChat", async () => {
      await page.waitForTimeout(300);
      await cursor.glideToElement(mainChat.getByRole("button", { name: "Side chat", exact: true }));
      recorder.mark("headerButton");
      await page.waitForTimeout(900);
      const words = await textBox(mainChat.locator(".timeline .message.agent", { hasText: SIDE_CHAT_QUOTE }).last(), SIDE_CHAT_QUOTE);
      await cursor.glideTo({ x: words.x + 1, y: words.y + words.height / 2 });
      recorder.mark("selecting");
      await cursor.drag({ x: words.x + words.width - 1, y: words.y + words.height / 2 });
      const askInSideChat = page.locator(".selection-actions").getByRole("button", { name: "Ask in side chat" });
      await expect(askInSideChat).toBeVisible();
      recorder.mark("selected");
      await page.waitForTimeout(350);
      await cursor.click(askInSideChat);
      await expect(side.locator(".side-chat-quote")).toContainText(SIDE_CHAT_QUOTE);
      recorder.mark("sideOpened");
      await recorder.markRect("sideArea", page.locator(".conversation-with-side:visible"));
      await recorder.markRect("side", side);
      const question = side.getByLabel("Ask about this conversation…");
      await cursor.click(question);
      await typeLikeAPerson(page, prompts.sideChatQuestion);
      await page.waitForTimeout(200);
      await page.keyboard.press("Enter");
      recorder.mark("asked");
      await expect(side.locator(".timeline .message.agent").last()).toContainText(SIDE_CHAT_ANSWER, { timeout: 30_000 });
      recorder.mark("sideAnswered");
      await expect(mainChat.locator(".timeline .message.agent").last()).toContainText(PAYMENT_TESTS_ANSWER, { timeout: 60_000 });
      recorder.mark("mainAnswered");
      await page.waitForTimeout(1800);
    });
  });

  await scene("fork: fork the checkout conversation from its first turn", async () => {
    await openConversation(page, ids.explainCheckout);
    await page.waitForTimeout(400);
    const firstTurn = page.locator(".timeline:visible .timeline-entry").filter({ has: page.locator(".message.user", { hasText: prompts.explainCheckout }) });
    await film("fork", async () => {
      await page.waitForTimeout(300);
      await cursor.glideToElement(firstTurn.locator(".message.user"), { offsetX: 0.3 });
      recorder.mark("hovered");
      const forkHere = firstTurn.getByRole("button", { name: "Fork from here" });
      await expect(forkHere).toBeVisible();
      await page.waitForTimeout(400);
      await cursor.click(forkHere);
      recorder.mark("forking");
      await expect(page.locator(".chat-header:visible h2")).toContainText("Fork: ", { timeout: 30_000 });
      recorder.mark("forked");
      await recorder.markRect("forkRow", workspaceCard(page, shopApi));
      await expect(shownPage(page).locator(".mermaid svg")).toBeVisible({ timeout: 30_000 });
      recorder.mark("canvasCopied");
      await page.waitForTimeout(2200);
    });
  });

  await scene("media: Plugins gallery and Media editing checkout-demo.mp4", async () => {
    await openConversation(page, ids.tightenVideo);
    await sendOffCamera(page, ids.tightenVideo, prompts.openVideo);
    await expect(mediaView(page).locator(".filmstrip img").first()).toBeVisible({ timeout: 30_000 });
    await waitForTurnToEnd(page);
    await page.waitForTimeout(400);
    await film("media", async () => {
      await cursor.click(page.getByRole("button", { name: "Plugins…" }));
      const pluginsDialog = page.getByRole("dialog", { name: "Plugins" });
      await expect(pluginsDialog.getByText("Spectra Council")).toBeVisible({ timeout: 15_000 });
      recorder.mark("galleryOpened");
      await recorder.markRect("gallery", pluginsDialog);
      await cursor.glideToElement(pluginsDialog.getByText("Media").first());
      await page.waitForTimeout(700);
      await cursor.glideToElement(pluginsDialog.getByText("Race").first());
      await page.waitForTimeout(700);
      await cursor.click(pluginsDialog.getByRole("button", { name: "Close" }));
      await expect(pluginsDialog).toBeHidden();
      recorder.mark("galleryClosed");
      await page.waitForTimeout(250);
      await recorder.markRect("canvas", canvasPane(page));
      await cursor.glideTo(await timelinePoint(page, DEMO_VIDEO.spinnerEnds - 0.2));
      await cursor.click();
      recorder.mark("seeked");
      await page.waitForTimeout(250);
      await cursor.click(mediaView(page).getByRole("button", { name: "Start a range here" }));
      await cursor.glideTo(await timelinePoint(page, DEMO_VIDEO.spinnerEnds - 0.2));
      await cursor.drag(await timelinePoint(page, DEMO_VIDEO.spinnerStarts + 0.2));
      const frame = (await mediaView(page).locator(".frame").boundingBox())!;
      const { x, y, width, height } = DEMO_VIDEO.spinnerBox;
      const onFrame = (atX: number, atY: number) => ({ x: frame.x + (frame.width * atX) / DEMO_VIDEO.width, y: frame.y + (frame.height * atY) / DEMO_VIDEO.height });
      await cursor.glideTo(onFrame(x, y));
      await cursor.drag(onFrame(x + width, y + height));
      recorder.mark("boxed");
      await cursor.click(mediaView(page).getByLabel("What's wrong here"));
      await typeLikeAPerson(page, prompts.spinnerNote);
      await page.keyboard.press("Enter");
      recorder.mark("markSent");
      await expect(mediaView(page).locator(".timeline .removed.cut")).toBeVisible({ timeout: 30_000 });
      recorder.mark("cut");
      await waitForTurnToEnd(page);
      recorder.mark("rendered");
      await page.waitForTimeout(600);
      await cursor.click(mediaView(page).getByRole("button", { name: "Rendered" }));
      await page.waitForTimeout(400);
      await cursor.click(mediaView(page).getByRole("button", { name: "Play" }));
      recorder.mark("playing");
      await page.waitForTimeout(3500);
    });
  });

  await scene("delegate: Claude Code hands a sweep to local opencode model", async () => {
    await openConversation(page, ids.deadFlags);
    const caller = sidebarItem(page, mobileApp, "Dead flags");
    const delegatedTask = page.locator(".delegated-tasks:visible li:not(.delegated-group)").first();
    await film("delegate", async () => {
      await page.waitForTimeout(300);
      await sendOnCamera(page, cursor, recorder, prompts.deadFlags);
      await expect(delegatedTask).toContainText("Working", { timeout: 45_000 });
      recorder.mark("delegated");
      await recorder.markRect("timeline", page.locator(".main-chat:visible .timeline"));
      await page.waitForTimeout(650);
      await cursor.click(caller.getByRole("button", { name: "1 delegated" }));
      recorder.mark("unfolded");
      await expect(delegatedTask).toContainText("Finished", { timeout: 60_000 });
      recorder.mark("replied");
      await expect(page.locator(".main-chat:visible .timeline .message.agent").last()).toContainText(DEAD_FLAGS_ANSWER, { timeout: 60_000 });
      await waitForTurnToEnd(page);
      recorder.mark("checked");
      await page.waitForTimeout(1800);
    });
  });

  await scene("worktree: a conversation in its own worktree, committed and merged from Changes", async () => {
    await openConversation(page, ids.deadFlags);
    await page.waitForTimeout(400);
    const mobileCard = workspaceCard(page, mobileApp);
    const changes = page.locator(".canvas-panel:visible .changes");
    await film("worktree", async () => {
      await page.waitForTimeout(300);
      await cursor.glideToElement(mobileCard.locator(":scope > header"), { offsetX: 0.4 });
      const whereButton = mobileCard.getByRole("button", { name: "Where conversations work…", exact: true });
      await cursor.click(whereButton);
      const dialog = page.getByRole("dialog", { name: /^Where conversations work in / });
      await expect(dialog).toBeVisible();
      recorder.mark("dialog");
      await recorder.markRect("dialog", dialog);
      await page.waitForTimeout(500);
      await cursor.click(dialog.getByRole("radio", { name: /A worktree of their own/ }));
      await page.waitForTimeout(400);
      await cursor.click(dialog.getByRole("button", { name: "Save" }));
      await expect(dialog).toBeHidden();
      recorder.mark("chosen");
      const previousUrl = page.url();
      await cursor.click(mobileCard.getByRole("button", { name: "+ New conversation" }));
      await expect(page).not.toHaveURL(previousUrl);
      await expect(page.locator(".workspace li.selected .worktree-mark")).toBeVisible({ timeout: 60_000 });
      await expect(page.locator(".chat-header:visible .settings-model")).toBeAttached({ timeout: 60_000 });
      recorder.mark("started");
      await recorder.markRect("sidebar", mobileCard);
      await sendOnCamera(page, cursor, recorder, prompts.deleteDeadFlags);
      await expect(page.locator(".main-chat:visible .timeline .message.agent").last()).toContainText(FLAGS_DELETED, { timeout: 60_000 });
      await waitForTurnToEnd(page);
      recorder.mark("edited");
      await recorder.markRect("timeline", page.locator(".main-chat:visible .timeline"));
      await page.waitForTimeout(500);
      await cursor.click(canvasPane(page).getByRole("button", { name: "Changes" }));
      await expect(changes).toBeVisible();
      recorder.mark("changesOpened");
      await recorder.markRect("changes", canvasPane(page));
      const flagsRow = changes.locator('.changed-file[data-path="src/flags.ts"]');
      await expect(flagsRow).toBeVisible({ timeout: 15_000 });
      await cursor.click(flagsRow);
      await expect(changes.locator(".changes-diff")).toContainText("holidayBanner");
      recorder.mark("diffOpened");
      await page.waitForTimeout(900);
      await cursor.click(changes.getByRole("button", { name: "Commit…" }));
      const commitDialog = page.getByRole("dialog", { name: "Commit changes" });
      await expect(commitDialog).toBeVisible();
      recorder.mark("commitDialog");
      await recorder.markRect("commitDialog", commitDialog);
      await cursor.click(commitDialog.getByLabel("Message"));
      await typeLikeAPerson(page, prompts.commitMessage);
      await page.waitForTimeout(250);
      await cursor.click(commitDialog.getByRole("button", { name: /^Commit 1 file/ }));
      await expect(commitDialog).toBeHidden();
      recorder.mark("committed");
      const merge = changes.getByRole("button", { name: /^Merge 1 commit into / });
      await expect(merge).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(400);
      await cursor.click(merge);
      const merged = changes.locator(".commit-made", { hasText: "Merged 1 commit into" });
      await expect(merged).toBeVisible({ timeout: 30_000 });
      recorder.mark("merged");
      await recorder.markRect("merge", merged);
      await page.waitForTimeout(2000);
    });
  });

  await scene("jobs: Mirador watches a remote e2e build and wakes the agent when green", async () => {
    await openConversation(page, ids.stopDoubleCharge);
    await page.locator(".side-chat:visible").getByRole("button", { name: "Close side chat" }).click().catch(() => {});
    await waitForTurnToEnd(page);
    if (await canvasPane(page).isHidden()) await page.locator(".chat-header:visible .toggle-canvas").click();
    const jobWait = page.locator('section[aria-label="Jobs waited for"]:visible');
    await film("jobs", async () => {
      await page.waitForTimeout(300);
      await sendOnCamera(page, cursor, recorder, prompts.e2eOnBuildServer);
      await expect(jobWait).toContainText(`on ${BUILD_SERVER}`, { timeout: 60_000 });
      recorder.mark("waiting");
      await recorder.markRect("timeline", page.locator(".main-chat:visible .timeline"));
      await recorder.markRect("jobWait", jobWait);
      await waitForTurnToEnd(page);
      await page.waitForTimeout(650);
      await cursor.click(jobWait.locator(".job-wait-follow"));
      const following = page.locator(".terminal-pane .terminal-splits.shown .xterm-rows").last();
      await expect(following).toContainText("[chromium]", { timeout: 30_000 });
      recorder.mark("following");
      await recorder.markRect("terminals", page.locator('[data-pane="terminals"]'));
      await expect(following).toContainText("214 passed", { timeout: 60_000 });
      recorder.mark("passed");
      await expect(jobWait).toBeHidden({ timeout: 60_000 });
      recorder.mark("woken");
      await expect(page.locator(".main-chat:visible .timeline .message.agent").last()).toContainText(E2E_ANSWER, { timeout: 60_000 });
      await waitForTurnToEnd(page);
      recorder.mark("reported");
      await page.waitForTimeout(1800);
    });
  });

  await scene("p2p: zero-setup peer-to-peer invite between computers", async () => {
    await page.getByRole("button", { name: "Hide terminal" }).click().catch(() => {});
    await openConversation(page, ids.explainCheckout);
    await page.waitForTimeout(200);
    // Set a clean demo machine name off-camera so the host's real hostname/serial never appears in the video.
    await page.getByRole("button", { name: "Settings…" }).click();
    const prepSettings = page.getByRole("dialog", { name: "Settings" });
    await prepSettings.getByRole("tab", { name: "Devices" }).click();
    const nameInput = prepSettings.locator("input.machine-name");
    await nameInput.fill("studio-mac");
    await nameInput.press("Enter");
    await nameInput.blur();
    await page.waitForTimeout(300);
    await page.keyboard.press("Escape");
    await expect(prepSettings).toBeHidden();
    await page.waitForTimeout(250);

    await film("p2p", async () => {
      await cursor.click(page.getByRole("button", { name: "Settings…" }));
      const settings = page.getByRole("dialog", { name: "Settings" });
      await expect(settings).toBeVisible();
      await cursor.click(settings.getByRole("tab", { name: "Devices" }));
      await expect(settings.getByRole("button", { name: "Invite a device" })).toBeVisible();
      recorder.mark("opened");
      await recorder.markRect("devicesDialog", settings);
      await page.waitForTimeout(650);
      await cursor.click(settings.getByRole("button", { name: "Invite a device" }));
      const card = settings.getByRole("region", { name: "Invite" });
      await expect(card.getByRole("img", { name: "Link as a QR code" })).toBeVisible({ timeout: 15_000 });
      recorder.mark("phoneInvite");
      await recorder.markRect("inviteCard", card);
      await page.waitForTimeout(300);
      await cursor.click(card.getByRole("radio", { name: "Another computer" }));
      await expect(card.locator(".invite-link")).toBeVisible();
      recorder.mark("computerShown");
      const link = (await card.locator(".invite-link").textContent())!;
      await page.waitForTimeout(700);
      await cursor.click(card.getByRole("button", { name: "Copy link" }));
      recorder.mark("copied");
      await page.waitForTimeout(900);
      const code = link.match(/mirador:\/\/join\/([A-Z2-9-]+)/)?.[1];
      if (code) {
        const joined = await fetch(`${host.origin}/join`, { method: "POST", body: JSON.stringify({ code, name: "ada-laptop" }) });
        expect(joined.status).toBe(200);
        await expect(settings).toContainText("ada-laptop", { timeout: 15_000 });
        recorder.mark("joined");
        await page.waitForTimeout(1600);
      }
    });
  });

  const strays = director.requests.filter(({ mainLoop, scripted }) => mainLoop && !scripted);
  expect(strays, "every turn the agents took came from a script").toEqual([]);
});
