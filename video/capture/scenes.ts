import { join } from "node:path";
import { CHECKOUT_FLOW, CHECKOUT_FLOW_QUEUED, CHECKOUT_LEAD, CHECKOUT_RISKS, CHECKOUT_RISKS_QUEUED, CHECKOUT_TITLE, MERMAID_SEQUENCE } from "./checkout-flow.ts";
import { DEMO_VIDEO } from "./demo-video.ts";
import type { Script } from "./director.ts";

/** What the user types in each filmed conversation; the director's scripts answer to these. */
export const prompts = {
  explainCheckout: "Walk me through checkout, end to end. Where can an order get stuck?",
  settingsLayout: "Settings is getting long. Propose a few layouts and let me pick.",
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

export const LAYOUT_CHOICE = "Grouped list (recommended)";

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

/** A phone showing a settings screen; the phone stays light, as the app it previews does. */
const phoneMockup = (body: string) => `<style>
  body { margin: 0; padding: 10px; background: transparent; font: 11px -apple-system, system-ui, sans-serif; color: #1f1d2b; }
  .phone { width: 190px; height: 300px; margin: 0 auto; border: 6px solid #2a2838; border-radius: 22px; background: #fff; overflow: hidden; padding: 12px 10px; box-sizing: border-box; box-shadow: 0 6px 18px rgba(0,0,0,.25); }
  .title { font-weight: 700; font-size: 14px; margin-bottom: 8px; }
  .section { color: #8a86a0; font-size: 9px; letter-spacing: 0.06em; text-transform: uppercase; margin: 8px 0 4px; }
  .row { display: flex; justify-content: space-between; align-items: center; padding: 5px 0; border-bottom: 1px solid #eeecf5; }
  .toggle { width: 22px; height: 12px; border-radius: 6px; background: #6e56cf; }
  .toggle.off { background: #d6d3e3; }
  .tabs { display: flex; gap: 4px; margin-bottom: 8px; }
  .tab { padding: 3px 6px; border-radius: 6px; background: #eeecf5; }
  .tab.on { background: #6e56cf; color: #fff; }
  .search { border: 1px solid #d6d3e3; border-radius: 8px; padding: 6px 8px; color: #8a86a0; margin-bottom: 8px; }
</style><div class="phone">${body}</div>`;

const rows = (...names: string[]) => names.map((name, index) => `<div class="row">${name}<span class="toggle${index % 3 === 1 ? " off" : ""}"></span></div>`).join("");

const settingsQuestion = {
  question: "Which layout should the settings screen use?",
  html: `<div style="font: 14px -apple-system, system-ui, sans-serif; color: light-dark(#1f1d2b, #ecebf5); color-scheme: light dark"><b>Settings today:</b> 27 rows on one page, in the order they were added. People scroll past what they need, and three support tickets this month asked where the theme setting went.</div>`,
  options: [
    {
      label: LAYOUT_CHOICE,
      description: "One page with section headers. Easiest to scan, and nothing hides behind a tap.",
      html: phoneMockup(`<div class="title">Settings</div><div class="section">Appearance</div>${rows("Theme", "Large text")}<div class="section">Notifications</div>${rows("Questions", "Finished turns", "Errors")}<div class="section">Privacy</div>${rows("App lock")}`),
    },
    {
      label: "Tabs per area",
      description: "Shorter pages, but each setting is one tap further away.",
      html: phoneMockup(`<div class="title">Settings</div><div class="tabs"><span class="tab on">Look</span><span class="tab">Alerts</span><span class="tab">Privacy</span></div>${rows("Theme", "Large text", "Accent colour", "Compact rows")}`),
    },
    {
      label: "Search first",
      description: "Fast when you know the name; browsing gets harder.",
      html: phoneMockup(`<div class="title">Settings</div><div class="search">Search settings</div><div class="section">Most used</div>${rows("Theme", "Questions", "App lock")}<div class="section">&nbsp;</div><div class="row" style="color:#6e56cf">All settings ›</div>`),
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
      prompt: prompts.settingsLayout,
      steps: [
        { thinkMs: 7500, say: "Three layouts on the canvas, each with a preview. Pick one and I'll build it.", call: { tool: "canvas.ask", input: settingsQuestion } },
        { thinkMs: 800, say: "Grouped list it is. I'll split the 27 rows into Appearance, Notifications and Privacy, with the theme at the top where people look for it." },
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
        { thinkMs: 700, say: `${DEAD_FLAGS_ANSWER}, as only \`src/flags.ts\` names them: ${new Intl.ListFormat("en").format(DEAD_FLAGS.map((flag) => `\`${flag}\``))}. Want me to delete them?` },
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
