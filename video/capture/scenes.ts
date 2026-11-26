import { join } from "node:path";
import { CAR_MODE_CHOICE, carModeQuestion } from "./car-mode.ts";
import { CHECKOUT_FLOW, CHECKOUT_FLOW_QUEUED, CHECKOUT_LEAD, CHECKOUT_RISKS, CHECKOUT_RISKS_QUEUED, CHECKOUT_TITLE, MERMAID_SEQUENCE } from "./checkout-flow.ts";
import { DEMO_VIDEO } from "./demo-video.ts";
import { PAYMENT_CASES } from "./demo-world.ts";
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
  fixWithTour: "Fix the double-charge blocker and walk me through the change.",
  sideChatQuestion: "How long does the bank remember it?",
  paymentTests: "Run the payment tests against the bank's sandbox, all 200 cases.",
  deleteDeadFlags: "Delete the three dead flags.",
  commitMessage: "Delete three dead feature flags",
  reproduce: "Reproduce the double charge: a failing test, and a script that replays a capture that timed out.",
  emailAfterResponse: "Send the email after the response, from a queue. How does the flow change?",
  openVideo: `Open ${DEMO_VIDEO.file} in Media.`,
  spinnerNote: "The spinner drags on here. Keep a second of it.",
  deadFlags: "Which of our feature flags can we delete? Check every screen.",
  e2eOnBuildServer: "Run the whole e2e suite on build-01, and tell me when it's green.",
};

export const LOCAL_PROFILE = "opencode · Qwen";
const DEAD_FLAGS_TASK = "Find the feature flags in src/flags.ts that nothing reads.";
const LOCAL_MODEL_REPLIED = `The task delegated to ${LOCAL_PROFILE}`;
const DEAD_FLAGS = ["legacyPushTokens", "holidayBanner", "oldSettingsMenu"];
export const DEAD_FLAGS_ANSWER = "Checked: three flags are dead";

export const BUILD_SERVER = "build-01";
const E2E_ENDED = "The e2e run on build-01 ended. Read the end of shop-api/e2e.log there and tell the user the result.";
export const E2E_ANSWER = "Green: all 214 e2e tests pass on build-01";

export { CAR_MODE_CHOICE };
export const SIDE_CHAT_ANSWER = "24 hours";
export const PAYMENT_TESTS_ANSWER = "All 200 payment tests pass";
/** Words of the reproduce turn's last answer that the side chat scene selects. */
export const SIDE_CHAT_QUOTE = "idempotency key";
const LIVE_FLAGS = ["newOnboarding", "quickReorder", "offlineCart", "biometricLogin", "darkModeToggle"];
export const FLAGS_DELETED = "Deleted the three dead flags from";

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

const fixTour = (shopApi: string) => ({
  title: "What the fix changed",
  folder: shopApi,
  since: "HEAD",
  summary: "A retried capture now carries the cart's id as its **idempotency key**, so the bank charges a card once however often checkout retries.",
  flow: [
    { title: "The capture carries the cart's id", at: "src/checkout.ts:7-9", say: "Checkout still retries a failed capture up to three times, and every attempt now sends the cart's id as the idempotency key." },
    { title: "The key reaches the bank", at: "src/services/payments.ts:5-9", say: "The payments client forwards it as the `Idempotency-Key` header. For 24 hours the bank answers a repeated key with the first capture." },
  ],
});

/** The director's scripts, for the projects of the demo world. */
export function scripts({ projects, assetsOrigin }: { projects: { shopApi: string; mobileApp: string; storefront: string; infra: string }; assetsOrigin: string }): Script[] {
  const { shopApi, mobileApp, infra } = projects;
  return [
    {
      prompt: prompts.explainCheckout,
      steps: [
        { thinkMs: 650, say: "I'll trace checkout through the code first.", call: { tool: "Read", input: { file_path: join(shopApi, "src/checkout.ts") } } },
        {
          thinkMs: 600,
          say: "Checkout touches four services in one request. I drew the full path on the canvas, with the three places an order can get stuck.",
          call: { tool: "canvas.show", input: { title: CHECKOUT_TITLE, html: checkoutDiagram(assetsOrigin) } },
        },
        {
          thinkMs: 400,
          say: [
            "**Where an order can get stuck**",
            "",
            "1. **Stock is reserved before the payment.** A declined card leaves it reserved until the nightly job.",
            "2. **The capture has no idempotency key.** A retried request can charge the card twice.",
            "3. **The confirmation email is sent inside the request.** A slow mail server holds the order open.",
          ].join("\n"),
        },
      ],
    },
    {
      prompt: prompts.carMode,
      steps: [
        { thinkMs: 700, say: "Three looks for car mode, each on an iPhone. Pick one and I'll build it.", call: { tool: "canvas.ask", input: carModeQuestion } },
        { thinkMs: 600, say: "The whole screen it is. Each state gets its own colour, so you can tell listening from working at a glance." },
      ],
    },
    {
      prompt: prompts.translate,
      steps: [
        { thinkMs: 1400, say: "Translating the checkout strings to German and French.", call: { tool: "Bash", input: { command: "ls pages", description: "List the checkout pages" } } },
        { thinkMs: 1200, say: "Both translations are in, with each country's currency format." },
      ],
    },
    {
      prompt: prompts.runbook,
      steps: [
        { thinkMs: 1600, say: "Reading the cluster setup first.", call: { tool: "Read", input: { file_path: join(infra, "postgres/cluster.tf") } } },
        { thinkMs: 1200, say: "The runbook is ready: replicate to a new 18 cluster, switch over in the maintenance window, and keep 16 as fallback." },
      ],
    },
    {
      prompt: prompts.review,
      steps: [
        { thinkMs: 700, say: "Reading the branch's changes against main.", call: { tool: "Bash", input: { command: "git diff --stat main", description: "See what the branch changes" } } },
        { thinkMs: 700, call: { tool: "canvas.review", input: review(shopApi) } },
        { thinkMs: 400, say: "The review is on the canvas: one blocker, one issue and a nit. Start with the flow tour." },
      ],
    },
    {
      prompt: prompts.questionAboutBlocker,
      steps: [
        {
          thinkMs: 900,
          say: "Good catch — the cart id stays the same when items change, so the bank would drop the new total as a retry. Updating the blocker to key on cart id and total.",
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
        { thinkMs: 350, say: "Updated in place: the blocker now keys the capture on cart id and total." },
      ],
    },
    {
      prompt: prompts.fix,
      steps: [
        { thinkMs: 650, say: "Adding the cart id as the capture's idempotency key.", call: { tool: "Read", input: { file_path: join(shopApi, "src/checkout.ts") } } },
        {
          thinkMs: 550,
          call: { tool: "Edit", input: { file_path: join(shopApi, "src/checkout.ts"), old_string: "payments.capture(card, cart.total)", new_string: "payments.capture(card, cart.total, { idempotencyKey: cart.id })" } },
        },
        { thinkMs: 450, say: "Done: every retry now carries the cart's id as its idempotency key." },
      ],
    },
    {
      prompt: prompts.fixWithTour,
      steps: [
        { thinkMs: 600, call: { tool: "canvas.tour", input: fixTour(shopApi) } },
        { thinkMs: 400, say: "I walked through the fix on the canvas — two steps, from `checkout.ts` to the `Idempotency-Key` header in `payments.ts`." },
      ],
    },
    {
      prompt: prompts.sideChatQuestion,
      steps: [
        {
          thinkMs: 650,
          say: `**${SIDE_CHAT_ANSWER}.** \`payments.ts\` sends it as the \`Idempotency-Key\` header, and the bank answers a repeated key with the first capture for a full day.`,
        },
      ],
    },
    {
      prompt: prompts.paymentTests,
      steps: [
        {
          thinkMs: 600,
          say: "Running all 200 payment cases against the sandbox; this takes a little while.",
          call: { tool: "Bash", input: { command: `sh ${PAYMENT_CASES} --sandbox`, description: "Run the payment tests against the bank's sandbox" } },
        },
        { thinkMs: 450, say: `${PAYMENT_TESTS_ANSWER} against the sandbox, the double-charge case too.` },
      ],
    },
    {
      prompt: prompts.deleteDeadFlags,
      steps: [
        {
          thinkMs: 700,
          say: "Deleting them from `src/flags.ts`, which is the only file that names them.",
          call: {
            tool: "Bash",
            input: { command: `cat > src/flags.ts <<'EOF'\nexport const flags = {\n${LIVE_FLAGS.map((flag) => `  ${flag}: ${flag !== "offlineCart"},`).join("\n")}\n};\nEOF`, description: "Delete the dead flags from src/flags.ts" },
          },
        },
        { thinkMs: 450, say: `${FLAGS_DELETED} \`src/flags.ts\`, in this conversation's own worktree. Commit and merge it from Changes.` },
      ],
    },
    {
      prompt: prompts.emailAfterResponse,
      steps: [
        {
          thinkMs: 900,
          say: "The order answers with 201 first, and a queue sends the email asynchronously, so a slow mail server no longer holds checkout open.",
          call: { tool: "canvas.show", input: { title: CHECKOUT_TITLE, html: checkoutDiagram(assetsOrigin, CHECKOUT_FLOW_QUEUED, CHECKOUT_RISKS_QUEUED) } },
        },
        { thinkMs: 400, say: "Updated flow on the canvas — email now leaves the request path." },
      ],
    },
    {
      prompt: prompts.openVideo,
      steps: [
        { thinkMs: 650, call: { tool: "canvas.app_open", input: { app: "media", file: DEMO_VIDEO.file } } },
        { thinkMs: 250, say: "Opened in Media. Mark the part that drags and tell me what to change." },
      ],
    },
    {
      prompt: prompts.spinnerNote,
      steps: [
        { thinkMs: 800, say: "Cutting the spinner down to a second.", call: { tool: "canvas.apply", input: { app: "media", op: { op: "cut", start: DEMO_VIDEO.spinnerStarts + 0.5, end: DEMO_VIDEO.spinnerEnds } } } },
        { thinkMs: 350, call: { tool: "canvas.apply", input: { app: "media", op: { op: "mark-done", mark: "m1" } } } },
        { thinkMs: 350, call: { tool: "canvas.app_run", input: { app: "media", task: "render" } } },
        { thinkMs: 400, say: `Done: spinner cut to one second, rendered to \`checkout-demo.edited.mp4\`.` },
      ],
    },
    {
      prompt: prompts.deadFlags,
      steps: [
        {
          thinkMs: 900,
          say: "That's a lot of reading for a short answer — delegating the sweep to Qwen running locally on opencode.",
          call: {
            tool: "canvas.delegate",
            input: { profile: LOCAL_PROFILE, task: `${DEAD_FLAGS_TASK}\n\nRead src/flags.ts for the flags' names, then search src for where each is read. Answer with the flags nothing reads, one per line.` },
          },
        },
        { thinkMs: 350, say: "Qwen is on it. I'll verify what it finds." },
      ],
    },
    {
      prompt: DEAD_FLAGS_TASK,
      steps: [
        { thinkMs: 1400, call: { tool: "read", input: { path: join(mobileApp, "src/flags.ts") } } },
        { thinkMs: 1800, call: { tool: "grep", input: { pattern: "flags\\.", path: join(mobileApp, "src"), include: "*.tsx" } } },
        { thinkMs: 1400, say: `Three flags are never read:\n\n${DEAD_FLAGS.map((flag) => `- ${flag}`).join("\n")}` },
      ],
    },
    {
      prompt: LOCAL_MODEL_REPLIED,
      steps: [
        { thinkMs: 750, say: "Verifying Qwen's list before we delete anything.", call: { tool: "Bash", input: { command: `grep -rn "${DEAD_FLAGS.join("\\|")}" src`, description: "Check that nothing reads them" } } },
        { thinkMs: 550, say: `${DEAD_FLAGS_ANSWER}, as only \`src/flags.ts\` names them: ${new Intl.ListFormat("en").format(DEAD_FLAGS.map((flag) => `\`${flag}\``))}.` },
      ],
    },
    {
      prompt: prompts.e2eOnBuildServer,
      steps: [
        {
          thinkMs: 800,
          say: "Starting the suite on build-01 and handing watch duty to Mirador.",
          call: {
            tool: "Bash",
            input: { command: `ssh ${BUILD_SERVER} 'cd shop-api; nohup bunx playwright test > e2e.log 2>&1 & echo $!'`, description: "Start the e2e suite on the build server" },
          },
        },
        { thinkMs: 500, call: { tool: "canvas.when_done", input: (startedJob) => ({ pid: Number(startedJob.trim()), host: BUILD_SERVER, message: E2E_ENDED }) } },
        { thinkMs: 350, say: "Mirador is watching build-01 and will wake me when the suite finishes." },
      ],
    },
    {
      prompt: E2E_ENDED,
      steps: [
        { thinkMs: 750, call: { tool: "Bash", input: { command: `ssh ${BUILD_SERVER} 'tail -n 4 shop-api/e2e.log'`, description: "Read the end of the e2e log" } } },
        { thinkMs: 550, say: `${E2E_ANSWER}, including the new double-charge test, in 3.4 minutes.` },
      ],
    },
  ];
}
