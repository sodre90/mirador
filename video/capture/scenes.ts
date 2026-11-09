import { join } from "node:path";
import { CHECKOUT_FLOW, CHECKOUT_FLOW_QUEUED, CHECKOUT_LEAD, CHECKOUT_RISKS, CHECKOUT_RISKS_QUEUED, CHECKOUT_TITLE, MERMAID_SEQUENCE } from "./checkout-flow.ts";
import { DEMO_VIDEO } from "./demo-video.ts";
import type { Script } from "./director.ts";

/** What the user types in each filmed conversation; the director's scripts answer to these. */
export const prompts = {
  explainCheckout: "Walk me through checkout, end to end. Where can an order get stuck?",
  carMode: "Car mode needs a look for the phone. Mock up a few on an iPhone and let me pick.",
  translate: "Translate the checkout pages to German and French.",
  runbook: "Draft the runbook for the Postgres 18 switch-over.",
  review: "Review the retry-payments branch against main.",
  questionAboutBlocker: "Is the cart id enough if the customer changes the cart?",
  fix: "Fix the blocker from the review: a retried capture must not charge the card twice.",
  reproduce: "Reproduce the double charge: a failing test, and a script that replays a capture that timed out.",
  emailAfterResponse: "Send the email after the response, from a queue. How does the flow change?",
  tightenVideo: "The checkout demo video drags in the middle. Can you tighten it?",
  openVideo: `Open ${DEMO_VIDEO.file} in Media.`,
  spinnerNote: "The spinner drags on here. Keep a second of it.",
  switchOverTime: "How long will the switch-over take, and what could go wrong?",
  deadFlags: "Which of our feature flags can we delete? Check every screen.",
  e2eOnBuildServer: "Run the whole e2e suite on build-01, and tell me when it's green.",
};

/** What Mirador tells the agent once the user answers Install; the agent's next turn answers to it. */
export const MEDIA_INSTALLED = "installed the Media plugin";
export const MEDIA_INSTALLED_REPLY = "Media is installed. Once Mirador restarts, I'll open the video in it.";

/** The profile the agent delegates to: a local model, on opencode rather than Claude Code. */
export const LOCAL_PROFILE = "opencode · Qwen";
/** The task the agent hands to the local model, whose first line titles the conversation it starts. */
const DEAD_FLAGS_TASK = "Find the feature flags in src/flags.ts that nothing reads.";
/** How Mirador starts the message that brings the local model's reply back to the agent. */
const LOCAL_MODEL_REPLIED = `The task delegated to ${LOCAL_PROFILE}`;
const DEAD_FLAGS = ["legacyPushTokens", "holidayBanner", "oldSettingsMenu"];
export const DEAD_FLAGS_ANSWER = "Checked: three flags are dead";

/** The build server the e2e suite runs on; the capture's ssh stand-in reaches it on this machine. */
export const BUILD_SERVER = "build-01";
/** What the agent asks Mirador to tell it once the e2e run ends; its next turn answers to it. */
const E2E_ENDED = "The e2e run on build-01 ended. Read the end of shop-api/e2e.log there and tell the user the result.";
export const E2E_ANSWER = "Green: all 214 e2e tests pass on build-01";

export const CAR_MODE_CHOICE = "Whole screen is the button";

type Risk = { title: string; detail: string; slow: boolean; fixed?: boolean };

const checkoutDiagram = (assetsOrigin: string, flow = CHECKOUT_FLOW, risks: Risk[] = CHECKOUT_RISKS) => `<style>
  :root { color-scheme: light dark; }
  body { font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; padding: 22px 26px; background: light-dark(#fbfaff, #17161f); color: light-dark(#1f1d2b, #ecebf5); }
  h1 { font-size: 21px; margin: 0 0 4px; }
  .lead { color: light-dark(#5d5a70, #a9a6bd); margin: 0 0 14px; }
  .diagram { background: light-dark(#fff, #1f1e2a); border: 1px solid light-dark(#e6e3f2, #34324a); border-radius: 12px; padding: 10px; }
  .risks { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 14px; }
  .risk { background: light-dark(#fff, #1f1e2a); border: 1px solid light-dark(#e6e3f2, #34324a); border-left: 4px solid #e5484d; border-radius: 10px; padding: 9px 12px; font-size: 13px; }
  .risk.slow { border-left-color: #f5a524; }
  .risk.fixed { border-left-color: #30a46c; }
  .risk b { display: block; }
</style>
<h1>${CHECKOUT_TITLE}</h1>
<p class="lead">${CHECKOUT_LEAD}</p>
<div class="diagram"><pre class="mermaid">
${flow}</pre></div>
<div class="risks">
${risks.map(({ title, detail, slow, fixed }) => `  <div class="risk${slow ? " slow" : ""}${fixed ? " fixed" : ""}"><b>${title}</b>${detail}</div>`).join("\n")}
</div>
<script src="${assetsOrigin}/mermaid.min.js"></script>
<script>
  const dark = getComputedStyle(document.documentElement).colorScheme === "dark" || matchMedia("(prefers-color-scheme: dark)").matches;
  mermaid.initialize({ startOnLoad: true, theme: dark ? "dark" : "neutral", sequence: ${JSON.stringify(MERMAID_SEQUENCE)} });
</script>`;

const MIC = (colour: string) => `<svg viewBox="0 0 24 24" width="100%" height="100%"><rect x="9" y="3" width="6" height="11" rx="3" fill="${colour}"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" stroke="${colour}" stroke-width="2" fill="none" stroke-linecap="round"/></svg>`;

const STATUS_ICONS = `<span class="icons"><svg viewBox="0 0 18 12" width="12" height="8"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></svg><svg viewBox="0 0 16 12" width="11" height="8.5"><path d="M8 11.5 5.6 8.9a3.4 3.4 0 0 1 4.8 0zM3.6 6.9a6.2 6.2 0 0 1 8.8 0l-1.3 1.3a4.4 4.4 0 0 0-6.2 0zM1.3 4.6a9.5 9.5 0 0 1 13.4 0l-1.3 1.3a7.6 7.6 0 0 0-10.8 0z"/></svg><svg viewBox="0 0 26 12" width="19" height="9"><rect x="0.5" y="0.5" width="22" height="11" rx="3.2" fill="none" stroke="currentColor" opacity=".45"/><rect x="2.5" y="2.5" width="16" height="7" rx="1.8"/><rect x="23.8" y="4" width="1.7" height="4" rx=".8" opacity=".45"/></svg></span>`;

/** An iPhone showing one look of car mode: titanium edge, side buttons, Dynamic Island, status bar and home bar. */
const iPhone = (screen: string, { background, ink }: { background: string; ink: string }) => `<style>
  body { margin: 0; padding: 8px 6px 12px; background: transparent; font: 11px -apple-system, "SF Pro Text", system-ui, sans-serif; }
  .iphone { position: relative; width: 158px; height: 336px; margin: 0 auto; padding: 4px; box-sizing: border-box; border-radius: 34px; background: linear-gradient(150deg, #9a9ca3 0%, #46474d 16%, #1d1e22 50%, #46474d 84%, #9a9ca3 100%); box-shadow: 0 16px 30px rgba(0, 0, 0, 0.5), 0 2px 5px rgba(0, 0, 0, 0.45), inset 0 0 0 1px rgba(255, 255, 255, 0.22); }
  .button { position: absolute; width: 3px; border-radius: 2px; background: linear-gradient(90deg, #6b6d73, #2d2e33); }
  .bezel { height: 100%; padding: 3px; box-sizing: border-box; border-radius: 30px; background: #000; }
  .screen { position: relative; height: 100%; border-radius: 27px; overflow: hidden; background: ${background}; color: ${ink}; }
  .island { position: absolute; z-index: 3; top: 8px; left: 50%; width: 40px; height: 13px; margin-left: -20px; border-radius: 8px; background: #000; }
  .status { position: absolute; z-index: 2; top: 0; left: 0; right: 0; height: 30px; display: flex; align-items: center; justify-content: space-between; padding: 0 9px 0 20px; font-weight: 600; font-size: 10.5px; color: ${ink}; }
  .icons { display: flex; gap: 2px; align-items: center; fill: currentColor; }
  .home { position: absolute; z-index: 2; bottom: 6px; left: 50%; width: 54px; height: 4px; margin-left: -27px; border-radius: 2px; background: ${ink}; opacity: 0.85; }
  .top { position: absolute; top: 34px; left: 12px; right: 12px; display: flex; align-items: center; gap: 6px; }
  .title { flex: 1; font-size: 9px; font-weight: 600; opacity: 0.75; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .leave { padding: 3px 9px; border-radius: 10px; font-size: 9px; font-weight: 600; }
</style><div class="iphone"><span class="button" style="left:-2px;top:62px;height:14px"></span><span class="button" style="left:-2px;top:88px;height:26px"></span><span class="button" style="left:-2px;top:120px;height:26px"></span><span class="button" style="right:-2px;top:98px;height:42px"></span><div class="bezel"><div class="screen"><div class="island"></div><div class="status"><span>9:41</span>${STATUS_ICONS}</div>${screen}<div class="home"></div></div></div></div>`;

const STATE_CHIPS = [
  ["Listening", "rgba(255,255,255,0.28)"],
  ["Working", "#f59e0b"],
  ["Speaking", "#22c55e"],
  ["Approve", "#ef4444"],
]
  .map(([state, colour]) => `<span style="padding:2px 3.5px;border-radius:5px;background:${colour}">${state}</span>`)
  .join("");

const wholeScreenButton = iPhone(
  `<div class="top"><span class="title">Fix the login bug</span><span class="leave" style="background:rgba(255,255,255,0.2);color:#fff">Leave</span></div>
  <div style="position:absolute;top:92px;left:0;right:0;display:flex;justify-content:center"><div style="position:relative;width:110px;height:110px;display:flex;align-items:center;justify-content:center">
    <div style="position:absolute;inset:0;border-radius:50%;background:rgba(255,255,255,0.08)"></div><div style="position:absolute;inset:16px;border-radius:50%;background:rgba(255,255,255,0.13)"></div>
    <div style="position:relative;width:54px;height:54px;border-radius:50%;background:#fff;box-shadow:0 8px 24px rgba(15,23,80,0.45);padding:13px;box-sizing:border-box">${MIC("#1d4ed8")}</div></div></div>
  <div style="position:absolute;top:214px;left:0;right:0;text-align:center"><div style="font-size:24px;font-weight:800;letter-spacing:-0.02em">Listening…</div><div style="font-size:8.5px;opacity:0.8;margin-top:4px">Tap anywhere when you're done</div></div>
  <div style="position:absolute;bottom:20px;left:0;right:0;display:flex;gap:2px;justify-content:center;font-size:6px;font-weight:600">${STATE_CHIPS}</div>`,
  { background: "radial-gradient(130% 85% at 50% 42%, #4f8cff 0%, #1d4ed8 48%, #172f7a 100%)", ink: "#fff" },
);

const darkForNight = iPhone(
  `<div class="top" style="justify-content:flex-end"><span class="leave" style="background:#1c1c1e;color:#8e8e93">Leave</span></div>
  <div style="position:absolute;top:86px;left:0;right:0;display:flex;justify-content:center"><div style="position:relative;width:122px;height:122px;display:flex;align-items:center;justify-content:center">
    <div style="position:absolute;inset:0;border-radius:50%;border:1px solid rgba(96,165,250,0.18)"></div>
    <div style="position:absolute;inset:12px;border-radius:50%;border:4px solid #60a5fa;box-shadow:0 0 22px #3b82f6, 0 0 60px rgba(59,130,246,0.35), inset 0 0 20px rgba(30,64,175,0.9)"></div>
    <span style="position:relative;font-size:13px;font-weight:600;color:#bfdbfe;letter-spacing:0.02em">Listening</span></div></div>
  <div style="position:absolute;top:226px;left:0;right:0;text-align:center;font-size:9px;color:#5b6b8c">Say "stop" when you're done</div>
  <div style="position:absolute;bottom:22px;left:0;right:0;text-align:center;font-size:8px;color:#3a3a3c">Fix the login bug</div>`,
  { background: "radial-gradient(90% 60% at 50% 42%, #0b1428 0%, #000 70%)", ink: "#fff" },
);

const WAVEFORM = [6, 13, 18, 10, 15, 8, 5]
  .map((height) => `<span style="width:2.5px;height:${height}px;border-radius:2px;background:#007aff"></span>`)
  .join("");

const wordsOnScreen = iPhone(
  `<div class="top"><span class="title" style="color:#3a3a3c">Fix the login bug</span><span class="leave" style="background:#fff;color:#007aff;box-shadow:0 1px 2px rgba(0,0,0,0.08)">Leave</span></div>
  <div style="position:absolute;top:64px;left:10px;right:10px">
    <div style="font-size:7px;font-weight:700;letter-spacing:0.08em;color:#8e8e93;text-align:right;margin:0 2px 3px">YOU SAID</div>
    <div style="margin-left:18px;padding:7px 9px;border-radius:13px 13px 3px 13px;background:#007aff;color:#fff;font-size:11px;font-weight:600;line-height:1.3">Run the tests again and tell me which ones fail</div>
    <div style="font-size:7px;font-weight:700;letter-spacing:0.08em;color:#8e8e93;margin:10px 2px 3px">AGENT</div>
    <div style="margin-right:18px;padding:7px 9px;border-radius:13px 13px 13px 3px;background:#e5e5ea;color:#1c1c1e;font-size:10.5px;line-height:1.3">Two tests failed: session expiry and the remember-me cookie…</div></div>
  <div style="position:absolute;bottom:18px;left:8px;right:8px;display:flex;align-items:center;gap:5px;padding:7px 8px;border-radius:16px;background:#fff;box-shadow:0 4px 14px rgba(0,0,0,0.08)">
    <div style="width:30px;height:30px;border-radius:50%;background:#007aff;padding:7px;box-sizing:border-box;flex:none">${MIC("#fff")}</div>
    <div style="font-size:11px;font-weight:700;color:#1c1c1e">Listening…</div><div style="display:flex;gap:2px;align-items:center;margin-left:auto">${WAVEFORM}</div></div>`,
  { background: "#f2f2f7", ink: "#000" },
);

const carModeQuestion = {
  question: "How should car mode look on the phone?",
  html: `<div style="font: 14px -apple-system, system-ui, sans-serif; color: light-dark(#1f1d2b, #ecebf5); color-scheme: light dark">Each phone shows the <b>Listening…</b> state. Voice commands, Leave and approving on the screen work the same in all three; only the screen changes.</div>`,
  options: [
    {
      label: CAR_MODE_CHOICE,
      description: "Tap anywhere to talk or stop. Each state fills the screen with its own colour, readable from the corner of your eye.",
      html: wholeScreenButton,
      recommended: true,
    },
    {
      label: "Dark, for night",
      description: "A glowing ring on black: almost no glare when driving at night.",
      html: darkForNight,
    },
    {
      label: "Words on screen",
      description: "What you said and the reply, large. Easier to catch a misheard word, but more to read.",
      html: wordsOnScreen,
    },
  ],
};

/** The pull request the review is of. Only the capture's stand-in for gh ever hears of it, never GitHub. */
export const PULL_REQUEST = { url: "https://github.com/acme/shop-api/pull/42", number: 42 };

const review = (shopApi: string) => ({
  title: "Retry failed card payments",
  repository: shopApi,
  base: "main",
  pullRequest: PULL_REQUEST.url,
  verdict: "Request changes: a retried capture can charge the card twice.",
  summary: [
    "The branch retries a failed card capture up to three times, and releases the reserved stock when checkout fails.",
    "",
    "- **Good:** a declined card no longer keeps the stock reserved until the nightly job.",
    "- **Blocker:** the capture carries no idempotency key, so a timed-out capture that the bank accepted is charged again on retry.",
    "",
    "| Change | Where |",
    "| --- | --- |",
    "| Retry around the capture | `src/checkout.ts`, line 8 |",
    "| Release the stock on failure | `src/checkout.ts`, lines 12-14 |",
    "| New `withRetries` helper | `src/retry.ts` |",
  ].join("\n"),
  flow: [
    { title: "Checkout reserves the stock", at: "src/checkout.ts:5-6", say: "As before, the cart's items are reserved first, so nobody else can buy them mid-checkout." },
    { title: "The capture is retried", at: "src/checkout.ts:8", say: "The capture now runs through `withRetries`, up to three attempts." },
    { title: "Backoff between attempts", at: "src/retry.ts:1-10", say: "Waits 200 ms, then 400 ms, and rethrows the last error once the attempts run out." },
    { title: "The stock is released on failure", at: "src/checkout.ts:12-14", say: "Any failure releases the reservation, then rethrows, so the caller still sees the error." },
  ],
  findings: [
    {
      severity: "blocker",
      checked: "confirmed",
      at: "src/checkout.ts:8",
      title: "A retry can charge the card twice",
      body: "`payments.capture` gets no idempotency key. When the first attempt times out after the bank accepted it, the retry charges the card again. Pass `{ idempotencyKey: cart.id }`; the payments client forwards it as the `Idempotency-Key` header.",
      evidence: "Read the payments client: `capture(card, amount, options)` sends `options.idempotencyKey` as the header, and the bank deduplicates on it for 24 hours.",
    },
    {
      severity: "issue",
      checked: "plausible",
      at: "src/checkout.ts:13",
      title: "A failing release hides the payment error",
      body: "If `inventory.release` throws, the original payment error is lost. Catch the release error, log it, and rethrow the payment error.",
    },
    { severity: "nit", checked: "confirmed", at: "src/retry.ts:7", title: "Name the base delay", body: "`100` reads as a magic number; `BASE_DELAY_MS` says what it is." },
  ],
});

/** The director's scripts, for the projects of the demo world. */
export function scripts({ projects, assetsOrigin }: { projects: { shopApi: string; mobileApp: string; storefront: string; infra: string }; assetsOrigin: string }): Script[] {
  const { shopApi, mobileApp, infra } = projects;
  return [
    {
      prompt: prompts.explainCheckout,
      steps: [
        { thinkMs: 1100, say: "I'll trace the request through the code first.", call: { tool: "Read", input: { file_path: join(shopApi, "src/checkout.ts") } } },
        { thinkMs: 700, call: { tool: "Bash", input: { command: 'grep -rn "reserve\\|capture\\|release" src', description: "Find where stock and payments are handled" } } },
        {
          thinkMs: 900,
          say: "Checkout touches four services in one request. I drew the whole path on the canvas, with the three places an order can get stuck.",
          call: { tool: "canvas.show", input: { title: CHECKOUT_TITLE, html: checkoutDiagram(assetsOrigin) } },
        },
        {
          thinkMs: 600,
          say: [
            "**Where an order can get stuck**",
            "",
            "1. **Stock is reserved before the payment.** A declined card leaves it reserved until the nightly job.",
            "2. **The capture has no idempotency key.** A retried request can charge the card twice.",
            "3. **The confirmation email is sent inside the request.** A slow mail server holds the order open.",
            "",
            "Want me to fix the first two? Both are small and covered by `checkout.test.ts`.",
          ].join("\n"),
        },
      ],
    },
    {
      prompt: prompts.carMode,
      steps: [
        { thinkMs: 7500, say: "Three looks for car mode, each on an iPhone. Pick one and I'll build it.", call: { tool: "canvas.ask", input: carModeQuestion } },
        { thinkMs: 800, say: "The whole screen it is. Each state gets its own colour, so you can tell listening from working at a glance." },
      ],
    },
    {
      prompt: prompts.translate,
      steps: [
        { thinkMs: 2200, say: "I'll start with the strings on each page.", call: { tool: "Bash", input: { command: "ls pages", description: "List the checkout pages" } } },
        { thinkMs: 3200, call: { tool: "Bash", input: { command: 'grep -rn "Checkout" pages', description: "Find the strings to translate" } } },
        { thinkMs: 2600, say: "Both translations are in, with each country's currency format." },
      ],
    },
    {
      prompt: prompts.runbook,
      steps: [
        { thinkMs: 3800, say: "Reading the cluster setup first.", call: { tool: "Read", input: { file_path: join(infra, "postgres/cluster.tf") } } },
        { thinkMs: 5200, say: "The runbook is ready: replicate to a new 18 cluster, switch over in the maintenance window, and keep 16 as the fallback for a day." },
      ],
    },
    {
      prompt: prompts.review,
      steps: [
        { thinkMs: 900, say: "Reading the branch's changes against main.", call: { tool: "Bash", input: { command: "git diff --stat main", description: "See what the branch changes" } } },
        { thinkMs: 1000, call: { tool: "canvas.review", input: review(shopApi) } },
        { thinkMs: 500, say: "The review is on the canvas: one blocker, one issue and a nit. Start with the flow tour, it is four steps." },
      ],
    },
    {
      prompt: prompts.questionAboutBlocker,
      steps: [
        {
          thinkMs: 1300,
          say: "No. The cart id stays the same when the customer changes the cart, so the bank would take the new total for a retry and drop it. I reworded the blocker to key on the id and the total.",
          call: {
            tool: "canvas.update_review",
            input: {
              findings: [
                {
                  id: "finding-1",
                  body: "`payments.capture` gets no idempotency key, so a retry after a timeout charges the card again. Pass `{ idempotencyKey: cartKey(cart) }`, built from the cart's id **and its total**: a retry reuses the key, but a changed cart gets a new one.",
                },
              ],
            },
          },
        },
        { thinkMs: 400, say: "Updated: the blocker now keys the capture on the cart's id and total." },
      ],
    },
    {
      prompt: prompts.fix,
      steps: [
        { thinkMs: 900, say: "The capture needs an idempotency key, so the bank can tell a retry from a new charge.", call: { tool: "Read", input: { file_path: join(shopApi, "src/checkout.ts") } } },
        {
          thinkMs: 700,
          call: { tool: "Edit", input: { file_path: join(shopApi, "src/checkout.ts"), old_string: "payments.capture(card, cart.total)", new_string: "payments.capture(card, cart.total, { idempotencyKey: cart.id })" } },
        },
        { thinkMs: 500, say: "Done: the capture sends the cart's id as its idempotency key, so a retry the bank already took no longer charges the card twice." },
      ],
    },
    {
      prompt: prompts.emailAfterResponse,
      steps: [
        {
          thinkMs: 1200,
          say: "The order answers with 201 first, and a queue sends the email after it, so a slow mail server no longer holds the order open.",
          call: { tool: "canvas.show", input: { title: CHECKOUT_TITLE, html: checkoutDiagram(assetsOrigin, CHECKOUT_FLOW_QUEUED, CHECKOUT_RISKS_QUEUED) } },
        },
        { thinkMs: 500, say: "The new flow is on the canvas. Want me to make the change? It's the mailer call in `src/checkout.ts` and a job in `src/jobs`." },
      ],
    },
    {
      prompt: prompts.tightenVideo,
      steps: [
        {
          thinkMs: 1400,
          say: "Mirador's official Media plugin is made for this: you mark the slow part on the frame, and I cut it and render the video.",
          call: { tool: "canvas.plugin_install", input: { name: "media", reason: "Mark the part that drags right on the video, and I cut it and render the result." } },
        },
        { thinkMs: 300, say: "It installs only once you say so." },
      ],
    },
    {
      prompt: MEDIA_INSTALLED,
      steps: [{ thinkMs: 700, say: MEDIA_INSTALLED_REPLY }],
    },
    {
      prompt: prompts.openVideo,
      steps: [
        { thinkMs: 900, call: { tool: "canvas.app_open", input: { app: "media", file: DEMO_VIDEO.file } } },
        { thinkMs: 300, say: "It's open. Mark the part that drags, and tell me what to do there." },
      ],
    },
    {
      prompt: prompts.spinnerNote,
      steps: [
        { thinkMs: 1000, say: "Cutting the spinner down to a second.", call: { tool: "canvas.apply", input: { app: "media", op: { op: "cut", start: DEMO_VIDEO.spinnerStarts + 0.5, end: DEMO_VIDEO.spinnerEnds } } } },
        { thinkMs: 400, call: { tool: "canvas.apply", input: { app: "media", op: { op: "mark-done", mark: "m1" } } } },
        { thinkMs: 400, call: { tool: "canvas.app_run", input: { app: "media", task: "render" } } },
        { thinkMs: 500, say: `Done: the spinner shows for a second instead of six, and the video is ${DEMO_VIDEO.seconds - (DEMO_VIDEO.spinnerEnds - DEMO_VIDEO.spinnerStarts - 0.5)} seconds long. The render is in \`checkout-demo.edited.mp4\`.` },
      ],
    },
    {
      prompt: prompts.deadFlags,
      steps: [
        {
          thinkMs: 1200,
          say: "That's a lot of reading for a short answer, so I'm handing the sweep to Qwen, the model on this machine, in opencode.",
          call: {
            tool: "canvas.delegate",
            input: { profile: LOCAL_PROFILE, task: `${DEAD_FLAGS_TASK}\n\nRead src/flags.ts for the flags' names, then search src for where each is read. Answer with the flags nothing reads, one per line.` },
          },
        },
        { thinkMs: 400, say: "Qwen is on it. I'll check what it finds." },
      ],
    },
    {
      prompt: DEAD_FLAGS_TASK,
      steps: [
        { thinkMs: 1800, call: { tool: "read", input: { path: join(mobileApp, "src/flags.ts") } } },
        { thinkMs: 2400, call: { tool: "grep", input: { pattern: "flags\\.", path: join(mobileApp, "src"), include: "*.tsx" } } },
        { thinkMs: 2000, say: `Three flags are never read:\n\n${DEAD_FLAGS.map((flag) => `- ${flag}`).join("\n")}` },
      ],
    },
    {
      prompt: LOCAL_MODEL_REPLIED,
      steps: [
        { thinkMs: 900, say: "Checking Qwen's list before we rely on it.", call: { tool: "Bash", input: { command: `grep -rn "${DEAD_FLAGS.join("\\|")}" src`, description: "Check that nothing reads them" } } },
        { thinkMs: 700, say: `${DEAD_FLAGS_ANSWER}, as only \`src/flags.ts\` names them: ${new Intl.ListFormat("en").format(DEAD_FLAGS.map((flag) => `\`${flag}\``))}. Say the word and I'll delete them.` },
      ],
    },
    {
      prompt: prompts.e2eOnBuildServer,
      steps: [
        {
          thinkMs: 1000,
          say: "Starting the suite on build-01. It takes a few minutes, so Mirador will wait for it instead of me.",
          call: {
            tool: "Bash",
            input: { command: `ssh ${BUILD_SERVER} 'cd shop-api; nohup bunx playwright test > e2e.log 2>&1 & echo $!'`, description: "Start the e2e suite on the build server" },
          },
        },
        { thinkMs: 600, call: { tool: "canvas.when_done", input: (startedJob) => ({ pid: Number(startedJob.trim()), host: BUILD_SERVER, message: E2E_ENDED }) } },
        { thinkMs: 400, say: "Mirador is watching the run on build-01, and wakes me when it ends. Get on with something else; I'll tell you the result." },
      ],
    },
    {
      prompt: E2E_ENDED,
      steps: [
        { thinkMs: 900, call: { tool: "Bash", input: { command: `ssh ${BUILD_SERVER} 'tail -n 4 shop-api/e2e.log'`, description: "Read the end of the e2e log" } } },
        { thinkMs: 700, say: `${E2E_ANSWER}, the new double-charge test among them, in 3.4 minutes. The fix is ready for review.` },
      ],
    },
    {
      prompt: prompts.switchOverTime,
      steps: [
        { thinkMs: 900, call: { tool: "Read", input: { file_path: join(infra, "postgres/cluster.tf") } } },
        {
          thinkMs: 700,
          say: [
            "**About ten minutes**, and the database is read-only for all of them.",
            "",
            "- **The risk is replication lag.** If 18 is behind when we switch, the last writes are lost, so the runbook waits for zero lag first.",
            "- **The fallback:** 16 keeps running for a day, and switching back takes two minutes.",
          ].join("\n"),
        },
      ],
    },
  ];
}
