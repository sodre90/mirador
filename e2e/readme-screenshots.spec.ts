import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addWorkspaceFromSidebar, callCanvasTool, reloadFromRestartedHost, signIn, workspaceCard, walkthroughView } from "./helpers.ts";
import type { Demo, DemoConversation } from "./seed-demo.ts";
import { TestHost } from "./test-host.ts";

/**
 * The README's screenshots, taken from a throwaway host filled with a demo: never from anyone's real conversations.
 * Opt-in because it is not a test: MIRADOR_SCREENSHOTS=1 bunx playwright test e2e/readme-screenshots.spec.ts
 */
test.skip(!process.env.MIRADOR_SCREENSHOTS, "set MIRADOR_SCREENSHOTS=1 to retake the README's screenshots");

/** A plain zsh prompt in the terminals, instead of whatever the person taking the screenshots has. */
const zdotdir = join(tmpdir(), "mirador-readme-zdotdir");
const host = new TestHost({
  shell: "/bin/zsh",
  usesClaudeLogin: true,
  environment: { ZDOTDIR: zdotdir, GIT_PAGER: "cat", MIRADOR_TEST_MODEL: "default", MIRADOR_TEST_EFFORT: "default", MIRADOR_DEFAULT_PLUGINS: join(import.meta.dirname, "..", "plugins", "defaults.json") },
});
const screenshots = join(import.meta.dirname, "..", "docs", "screenshots");
const shopApi = join(host.root, "shop-api");
const mobileApp = join(host.root, "mobile-app");
const infra = join(host.root, "infra");
const assetsOrigin = () => `http://127.0.0.1:${host.port + 1}`;

function writeFiles(directory: string, files: Record<string, string>) {
  Object.entries(files).forEach(([path, text]) => {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), text);
  });
}

function git(directory: string, ...args: string[]) {
  execFileSync("git", ["-C", directory, "-c", "user.name=Ada", "-c", "user.email=ada@example.com", "-c", "commit.gpgsign=false", ...args]);
}

const checkoutBefore = `import { inventory, mail, orders, payments } from "./services";
import type { Card, Cart } from "./types";

export async function checkout(cart: Cart, card: Card) {
  const reservation = await inventory.reserve(cart.items);
  const payment = await payments.capture(card, cart.total);
  const order = await orders.create(cart, reservation, payment);
  await mail.sendConfirmation(order);
  return order;
}
`;

const checkoutAfter = `import { inventory, mail, orders, payments } from "./services";
import { withRetries } from "./retry";
import type { Card, Cart } from "./types";

export async function checkout(cart: Cart, card: Card) {
  const reservation = await inventory.reserve(cart.items);
  try {
    const payment = await withRetries(() => payments.capture(card, cart.total), { attempts: 3 });
    const order = await orders.create(cart, reservation, payment);
    await mail.sendConfirmation(order);
    return order;
  } catch (error) {
    await inventory.release(reservation);
    throw error;
  }
}
`;

const retry = `export async function withRetries<T>(run: () => Promise<T>, { attempts }: { attempts: number }): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      if (attempt >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** attempt));
    }
  }
}
`;

const paymentsClient = `import type { Card } from "../types";

const BANK_URL = process.env.BANK_URL;

export async function capture(card: Card, amount: number, { idempotencyKey }: { idempotencyKey?: string } = {}) {
  const response = await fetch(\`\${BANK_URL}/captures\`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(idempotencyKey && { "Idempotency-Key": idempotencyKey }) },
    body: JSON.stringify({ card, amount }),
  });
  if (!response.ok) throw new Error(\`The bank refused the capture: \${response.status}\`);
  return response.json();
}
`;

const checkoutFixed = checkoutAfter.replace("payments.capture(card, cart.total)", "payments.capture(card, cart.total, { idempotencyKey: cart.id })");

/** shop-api on a branch that retries card payments, the change the demo review is about. */
function createProjects() {
  writeFiles(shopApi, { "README.md": "# shop-api\n", "src/checkout.ts": checkoutBefore, "src/services/payments.ts": paymentsClient });
  git(shopApi, "init", "-q", "-b", "main");
  git(shopApi, "add", ".");
  git(shopApi, "commit", "-q", "-m", "Checkout reserves stock, captures the payment and creates the order");
  git(shopApi, "checkout", "-q", "-b", "retry-payments");
  writeFiles(shopApi, { "src/checkout.ts": checkoutAfter, "src/retry.ts": retry });
  git(shopApi, "add", ".");
  git(shopApi, "commit", "-q", "-m", "Retry failed card payments and release the stock");
  writeFiles(mobileApp, { "README.md": "# mobile-app\n" });
  writeFiles(infra, { "README.md": "# infra\n" });
  writeFiles(zdotdir, { ".zshrc": "PROMPT='%F{141}%1~%f %F{245}❯%f '\nPROMPT_EOL_MARK=''\n" });
}

const update = (update: Record<string, unknown>) => ({ type: "acp", update });
const userSays = (text: string) => ({ type: "user-message", text });
const agentSays = (text: string) => update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text } });
const turnEnd = { type: "turn-end", stopReason: "end_turn" };
const toolCall = (toolCallId: string, title: string, kind: string, rawInput: Record<string, unknown>, output: string) =>
  update({ sessionUpdate: "tool_call", toolCallId, title, kind, status: "completed", rawInput, content: [{ type: "content", content: { type: "text", text: output } }] });

const explainCheckout = [
  userSays("Walk me through checkout, end to end. Where can an order get stuck?"),
  toolCall("toolu_read", "Read src/checkout.ts", "read", { file_path: "src/checkout.ts" }, checkoutBefore),
  toolCall(
    "toolu_grep",
    'grep -rn "reserve\\|capture\\|release" src',
    "execute",
    { command: 'grep -rn "reserve\\|capture\\|release" src', description: "Find where stock and payments are handled" },
    "src/checkout.ts:5:  const reservation = await inventory.reserve(cart.items);\nsrc/checkout.ts:6:  const payment = await payments.capture(card, cart.total);\njobs/nightly.ts:12:  await inventory.releaseExpired();",
  ),
  agentSays("Checkout touches four services in one request. I drew the whole path on the canvas, with the three places an order can get stuck."),
  toolCall("toolu_show", "mcp__canvas__show", "other", { title: "Checkout, end to end" }, "Shown on the canvas."),
  agentSays(
    [
      "**Where an order can get stuck**",
      "",
      "1. **Stock is reserved before the payment.** A declined card leaves it reserved until the nightly job, so items look sold out for hours.",
      "2. **The capture has no idempotency key.** A retried request can charge the card twice.",
      "3. **The confirmation email is sent inside the request.** A slow mail server holds the order open.",
      "",
      "Want me to fix the first two? Both are small and covered by `checkout.test.ts`.",
    ].join("\n"),
  ),
  turnEnd,
];

const reviewRetries = [
  userSays("Review the retry-payments branch against main."),
  agentSays("The review is on the canvas: one blocker, one issue and a nit. Start with the flow tour, it is four steps."),
  turnEnd,
];

const flakyLogin = [
  userSays("The login e2e fails about one run in ten. Find out why and fix it."),
  toolCall("toolu_runs", "bunx playwright test e2e/login.spec.ts --repeat-each 20", "execute", { command: "bunx playwright test e2e/login.spec.ts --repeat-each 20", description: "Run the login spec twenty times" }, "  20 passed (1.4m)"),
  agentSays("Fixed: the test pressed Enter before the sign-in form was ready. It now waits for the form, and twenty runs in a row pass."),
  turnEnd,
];

const settingsLayout = [
  userSays("Settings is getting long. Propose a few layouts and let me pick."),
  agentSays("Three layouts on the canvas, each with a preview. Pick one and I'll build it."),
];

const coldStart = [
  userSays("Profile the cold start on a mid-range phone and cut it below a second."),
  agentSays("Starting a trace on the emulator…"),
  { type: "turn-end", stopReason: "refusal" },
];

const captureLine = "withRetries(() => payments.capture(card, cart.total), { attempts: 3 })";
const stopDoubleCharge = [
  userSays("Fix the blocker from the review: a retried capture must not charge the card twice."),
  update({
    sessionUpdate: "tool_call",
    toolCallId: "toolu_edit",
    title: "Edit src/checkout.ts",
    kind: "edit",
    status: "completed",
    locations: [{ path: join(shopApi, "src/checkout.ts") }],
    content: [{ type: "diff", path: join(shopApi, "src/checkout.ts"), oldText: captureLine, newText: captureLine.replace("cart.total)", "cart.total, { idempotencyKey: cart.id })") }],
  }),
  toolCall("toolu_tour", "mcp__canvas__tour", "other", { title: "What the fix changed" }, "Shown to the user as a tour."),
  agentSays("The capture now sends the cart's id as its idempotency key, so retrying a capture the bank already took doesn't charge the card again. I walked through the change on the canvas, and the files are under *Changes*."),
  turnEnd,
];

const postgres = [
  userSays("Plan the upgrade to Postgres 18 with no downtime."),
  agentSays("Here is the plan: logical replication to a new 18 cluster, then a switch-over in the next maintenance window."),
  turnEnd,
];

async function newConversationIn(page: Page, directory: string) {
  const previousUrl = page.url();
  await workspaceCard(page, directory).getByRole("button", { name: "+ New conversation" }).click();
  await expect(page).not.toHaveURL(previousUrl);
  await expect(page.locator(".chat-header:visible").getByLabel("Model", { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".chat-header:visible").getByLabel("Effort", { exact: true })).toHaveValue("default");
  return page.url().match(/#\/c\/(.+)$/)![1]!;
}

const openConversation = (page: Page, conversationId: string) =>
  page.evaluate((id) => {
    location.hash = `/c/${id}`;
  }, conversationId);

const save = (page: Page, name: string) => page.screenshot({ path: join(screenshots, `${name}.png`) });

const checkoutDiagram = () => `<style>
  body { font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; padding: 22px 26px; background: #fbfaff; color: #1f1d2b; }
  h1 { font-size: 21px; margin: 0 0 4px; }
  .lead { color: #5d5a70; margin: 0 0 14px; }
  .diagram { background: #fff; border: 1px solid #e6e3f2; border-radius: 12px; padding: 10px; }
  .risks { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 10px; margin-top: 14px; }
  .risk { background: #fff; border: 1px solid #e6e3f2; border-left: 4px solid #e5484d; border-radius: 10px; padding: 9px 12px; font-size: 13px; }
  .risk.slow { border-left-color: #f5a524; }
  .risk b { display: block; }
</style>
<h1>Checkout, end to end</h1>
<p class="lead">One request, four services, in the order they run. ⚠ marks where an order can get stuck.</p>
<div class="diagram"><pre class="mermaid">
sequenceDiagram
  autonumber
  participant B as Browser
  participant A as Checkout API
  participant I as Inventory
  participant P as Payments
  participant O as Orders
  B->>A: POST /checkout
  A->>I: reserve(cart.items)
  I-->>A: reservation
  A->>P: capture(card, total)
  Note over A,P: ⚠ no idempotency key
  P-->>A: payment
  A->>O: create(cart, payment)
  O-->>A: order 1042
  A->>A: ⚠ send the email in the request
  A-->>B: 201 Created
</pre></div>
<div class="risks">
  <div class="risk"><b>Declined card</b>Stock stays reserved until the nightly job.</div>
  <div class="risk"><b>Retried capture</b>Without a key, the card is charged twice.</div>
  <div class="risk slow"><b>Slow mail server</b>Holds the order open while it sends.</div>
</div>
<script src="${assetsOrigin()}/mermaid.min.js"></script>
<script>mermaid.initialize({ startOnLoad: true, theme: "neutral", sequence: { mirrorActors: false, showSequenceNumbers: true } });</script>`;

const phoneMockup = (body: string) => `<style>
  body { margin: 0; padding: 10px; background: #f4f3f8; font: 11px -apple-system, system-ui, sans-serif; color: #1f1d2b; }
  .phone { width: 190px; height: 300px; margin: 0 auto; border: 6px solid #1f1d2b; border-radius: 22px; background: #fff; overflow: hidden; padding: 12px 10px; box-sizing: border-box; }
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
  html: `<div style="font: 14px -apple-system, system-ui, sans-serif; background: #fff; color: #1f1d2b"><b>Settings today:</b> 27 rows on one page, in the order they were added. People scroll past what they need, and three support tickets this month asked where the theme setting went.</div>`,
  options: [
    {
      label: "Grouped list (recommended)",
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

const review = {
  title: "Retry failed card payments",
  repository: shopApi,
  base: "main",
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
};

const fixTour = {
  title: "What the fix changed",
  folder: shopApi,
  since: "HEAD",
  summary: "A retried capture now carries the cart's id as its **idempotency key**, so the bank charges a card once however often checkout retries.",
  flow: [
    { title: "The capture carries the cart's id", at: "src/checkout.ts:7-9", say: "Checkout still retries a failed capture up to three times, and every attempt now sends the cart's id as the idempotency key." },
    { title: "The key reaches the bank", at: "src/services/payments.ts:5-9", say: "The payments client sends it as the `Idempotency-Key` header. For 24 hours the bank answers a repeated key with the first capture, instead of charging again." },
  ],
};

async function typeInTerminal(page: Page, index: number, command: string) {
  await page.locator(".terminal-pane .xterm").nth(index).click();
  await page.keyboard.type(command);
  await page.keyboard.press("Enter");
}

test.beforeAll(async () => {
  createProjects();
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

test("the README's screenshots", async ({ page }) => {
  mkdirSync(screenshots, { recursive: true });
  await signIn(page, host);
  for (const directory of [shopApi, mobileApp, infra]) await addWorkspaceFromSidebar(page, directory);

  const ids = {
    reviewRetries: await newConversationIn(page, shopApi),
    flakyLogin: await newConversationIn(page, shopApi),
    settingsLayout: await newConversationIn(page, mobileApp),
    coldStart: await newConversationIn(page, mobileApp),
    postgres: await newConversationIn(page, infra),
    explainCheckout: await newConversationIn(page, shopApi),
    stopDoubleCharge: await newConversationIn(page, shopApi),
  };
  const conversation = (id: string, title: string, minutesAgo: number, events: unknown[], unseenTurnEnd?: DemoConversation["unseenTurnEnd"]): DemoConversation => ({ id, title, minutesAgo, events, unseenTurnEnd });
  const demo: Demo = {
    workspaceColors: { [shopApi]: "sky", [mobileApp]: "mint", [infra]: "peach" },
    sidebar: [{ group: "Shop", workspaces: [shopApi, mobileApp] }, infra],
    conversations: [
      conversation(ids.explainCheckout, "Explain the checkout flow", 12, explainCheckout),
      conversation(ids.reviewRetries, "Review: retry card payments", 40, reviewRetries),
      conversation(ids.flakyLogin, "Fix the flaky login test", 25, flakyLogin, "finished"),
      conversation(ids.settingsLayout, "Pick a settings layout", 8, settingsLayout),
      conversation(ids.coldStart, "Speed up the cold start", 30, coldStart, "error"),
      conversation(ids.postgres, "Plan the Postgres 18 upgrade", 90, postgres),
      conversation(ids.stopDoubleCharge, "Stop the double charge", 4, stopDoubleCharge),
    ],
  };
  await host.stop();
  execFileSync("bun", [join(import.meta.dirname, "seed-demo.ts"), join(host.dataDir, "state.sqlite"), JSON.stringify(demo)]);
  await host.start();
  await reloadFromRestartedHost(page);

  void callCanvasTool(host, ids.settingsLayout, "ask", settingsQuestion).catch(() => {});
  await expect(page.locator(".workspace").getByText("Needs you")).toBeVisible();

  await test.step("the canvas next to the conversation", async () => {
    await openConversation(page, ids.explainCheckout);
    await callCanvasTool(host, ids.explainCheckout, "show", { title: "Checkout, end to end", html: checkoutDiagram() });
    await expect(page.locator(".canvas-panel:visible .canvas-frame.show iframe").contentFrame().locator(".mermaid svg")).toBeVisible();
    await save(page, "canvas");
  });

  await test.step("a question with previews", async () => {
    await openConversation(page, ids.settingsLayout);
    await expect(page.locator('[data-pane="canvas"]').getByText("Grouped list (recommended)")).toBeVisible();
    const options = page.locator(".ask-option");
    await expect(options).toHaveCount(3);
    for (const option of await options.all()) {
      const frame = option.locator("iframe");
      await expect(frame).toHaveAttribute("style", /height/);
      await expect(frame.contentFrame().locator(".phone")).toBeInViewport({ ratio: 0.99 });
    }
    await save(page, "ask");
  });

  await test.step("a review, as a tour of the code and its findings", async () => {
    await openConversation(page, ids.reviewRetries);
    await callCanvasTool(host, ids.reviewRetries, "review", review);
    const view = walkthroughView(page).locator(".review");
    await expect(view.locator(".verdict")).toBeVisible();
    await view.getByRole("tab", { name: /Flow/ }).click();
    await view.getByRole("navigation", { name: "Flow steps" }).getByText("The capture is retried").click();
    await expect(view.locator(".flow-step-say")).toContainText("up to three attempts");
    await save(page, "review-flow");
    await view.getByRole("tab", { name: /Findings/ }).click();
    await save(page, "review-findings");
  });

  await test.step("terminals beside the conversation", async () => {
    await openConversation(page, ids.explainCheckout);
    await page.getByRole("button", { name: "Show terminal" }).click();
    await typeInTerminal(page, 0, "git log --oneline --graph --all");
    await page.getByRole("button", { name: "Split right" }).click();
    await typeInTerminal(page, 1, "git diff --stat main");
    await expect(page.locator(".terminal-pane .xterm-rows").nth(1)).toContainText("2 files changed");
    await save(page, "terminals");
    await page.getByRole("button", { name: "Hide terminal" }).click();
  });

  await test.step("the files a change touched, on the canvas", async () => {
    writeFiles(shopApi, { "src/checkout.ts": checkoutFixed, "README.md": "# shop-api\n\nCheckout retries a failed card capture up to three times.\n" });
    await openConversation(page, ids.stopDoubleCharge);
    const changes = page.locator(".changes");
    await changes.getByRole("button", { name: "Uncommitted" }).click();
    await changes.locator(`.changed-file[data-path="src/checkout.ts"]`).click();
    await expect(changes.locator(".changes-diff")).toContainText("idempotencyKey");
    await save(page, "changes");
  });

  await test.step("a tour of what the agent changed", async () => {
    await callCanvasTool(host, ids.stopDoubleCharge, "tour", fixTour);
    const view = walkthroughView(page).locator(".review");
    await view.getByRole("tab", { name: /Flow/ }).click();
    await expect(view.locator(".code-row.added")).toContainText(["idempotencyKey: cart.id"]);
    await save(page, "tour");
  });
});
