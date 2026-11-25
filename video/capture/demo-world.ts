import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * The trailer's and GIFs' world: a developer's home with four projects under ~/code, each a git repository with real
 * history and its own crisp SVG project icon (.mirador/icon.svg) so the sidebar showcases Mirador 0.15.5's workspace
 * icons cleanly.
 */
export function worldIn(root: string) {
  const home = join(root, "home", "ada");
  const code = join(home, "code");
  return { home, projects: { shopApi: join(code, "shop-api"), mobileApp: join(code, "mobile-app"), storefront: join(code, "storefront"), infra: join(code, "infra") } };
}

/** Claude Code runs commands and the canvas's tools, its plugins' too, without asking; edits it still asks for. */
export const CLAUDE_SETTINGS = JSON.stringify({ permissions: { allow: ["Bash", "mcp__canvas"] }, promptSuggestionEnabled: false }, null, 2);

/** Clean geometric SVG project icons (no filters, plain shapes) rendered by Mirador 0.15.5 in place of initials. */
const ICONS = {
  shopApi: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#2563eb"/><path d="M22 25v-3a10 10 0 0 1 20 0v3" fill="none" stroke="#fff" stroke-width="4.5" stroke-linecap="round"/><rect x="14" y="25" width="36" height="27" rx="7" fill="#fff"/><path d="M34 31l-7 9h6l-2 7 8-10h-6z" fill="#2563eb"/></svg>`,
  mobileApp: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#0d9488"/><rect x="20" y="11" width="24" height="42" rx="6" fill="none" stroke="#fff" stroke-width="4.5"/><line x1="28" y1="17" x2="36" y2="17" stroke="#fff" stroke-width="3.5" stroke-linecap="round"/><circle cx="32" cy="45" r="2.6" fill="#fff"/></svg>`,
  storefront: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#7c3aed"/><path d="M13 26l4-11h30l4 11a6 6 0 0 1-12 0 6 6 0 0 1-13 0 6 6 0 0 1-13 0z" fill="#fff"/><path d="M18 32v17h28V32" fill="none" stroke="#fff" stroke-width="4.5" stroke-linejoin="round"/><rect x="27" y="38" width="10" height="11" rx="2" fill="#fff"/></svg>`,
  infra: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#ea580c"/><rect x="14" y="15" width="36" height="13" rx="4" fill="#fff"/><rect x="14" y="36" width="36" height="13" rx="4" fill="#fff"/><circle cx="22" cy="21.5" r="2.6" fill="#ea580c"/><circle cx="22" cy="42.5" r="2.6" fill="#ea580c"/><line x1="31" y1="21.5" x2="43" y2="21.5" stroke="#ea580c" stroke-width="3.5" stroke-linecap="round"/><line x1="31" y1="42.5" x2="43" y2="42.5" stroke="#ea580c" stroke-width="3.5" stroke-linecap="round"/></svg>`,
};

/** Writes the world's files; Playwright also imports specs in a process that never runs their hooks, so call it from one. */
export function createWorld({ home, projects }: ReturnType<typeof worldIn>) {
  writeFiles(home, {
    ".zshrc": "PROMPT='%F{141}%1~%f %F{245}❯%f '\nPROMPT_EOL_MARK=''\nunsetopt BEEP\n",
    ".claude/settings.json": CLAUDE_SETTINGS,
    ".gitconfig": "[user]\n\tname = Ada\n\temail = ada@example.com\n[commit]\n\tgpgsign = false\n[init]\n\tdefaultBranch = main\n",
  });
  createShopApi(projects.shopApi);
  createProject(projects.mobileApp, { ".mirador/icon.svg": ICONS.mobileApp, "README.md": "# mobile-app\n", "src/settings/SettingsScreen.tsx": settingsScreen, ...featureFlags }, "Settings screen with every option on one page");
  createProject(projects.storefront, { ".mirador/icon.svg": ICONS.storefront, "README.md": "# storefront\n", "pages/checkout.tsx": "export default function Checkout() {\n  return <main>Checkout</main>;\n}\n" }, "Checkout page");
  createProject(projects.infra, { ".mirador/icon.svg": ICONS.infra, "README.md": "# infra\n", "postgres/cluster.tf": 'resource "postgres_cluster" "main" {\n  version = "16"\n}\n' }, "Postgres 16 cluster");
}

function writeFiles(directory: string, files: Record<string, string>) {
  Object.entries(files).forEach(([path, text]) => {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), text);
  });
}

export function git(directory: string, ...args: string[]) {
  execFileSync("git", ["-C", directory, "-c", "user.name=Ada", "-c", "user.email=ada@example.com", "-c", "commit.gpgsign=false", ...args]);
}

function createProject(directory: string, files: Record<string, string>, message: string) {
  writeFiles(directory, files);
  git(directory, "init", "-q", "-b", "main");
  git(directory, "add", ".");
  git(directory, "commit", "-q", "-m", message);
}

/**
 * shop-api on a branch that retries card payments: the change the review and fix tour are about.
 */
function createShopApi(directory: string) {
  createProject(
    directory,
    {
      ".mirador/icon.svg": ICONS.shopApi,
      "README.md": "# shop-api\n",
      "src/checkout.ts": checkoutBefore,
      "src/services.ts": services,
      "src/services/payments.ts": paymentsClient,
      "src/types.ts": types,
    },
    "Checkout reserves stock, captures the payment and creates the order",
  );
  git(directory, "checkout", "-q", "-b", "retry-payments");
  writeFiles(directory, { "src/checkout.ts": checkoutAfter, "src/retry.ts": retry });
  git(directory, "add", ".");
  git(directory, "commit", "-q", "-m", "Retry failed card payments and release the stock");
  writeFiles(directory, { "README.md": readmeWithPayments });
  git(directory, "add", "README.md");
  writeFiles(directory, { [CHECKOUT_TEST]: checkoutTest });
}

const readmeWithPayments = "# shop-api\n\n## Payments\n\nCheckout captures the card once per cart. A capture that times out is retried.\n";

export const CHECKOUT_TEST = "src/checkout.test.ts";
export const checkoutTest = `import { expect, test } from "bun:test";
import { checkout } from "./checkout";
import { payments } from "./services";

test("a capture that times out charges the card once", async () => {
  payments.timeOutOnce();
  await checkout(cart, card);
  expect(payments.chargesOf(card)).toHaveLength(1);
});
`;
export const REPLAY_SCRIPT = "/tmp/replay-capture.sh";
export const replayScript = `#!/bin/sh
# Replays a capture that timed out, against the payments sandbox.
curl -s -X POST localhost:4000/checkout -d @cart.json --max-time 1
curl -s -X POST localhost:4000/checkout -d @cart.json
curl -s localhost:4010/sandbox/charges | jq length
`;

export const checkoutBefore = `import { inventory, mail, orders, payments } from "./services";
import type { Card, Cart } from "./types";

export async function checkout(cart: Cart, card: Card) {
  const reservation = await inventory.reserve(cart.items);
  const payment = await payments.capture(card, cart.total);
  const order = await orders.create(cart, reservation, payment);
  await mail.sendConfirmation(order);
  return order;
}
`;

export const checkoutAfter = `import { inventory, mail, orders, payments } from "./services";
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

export const paymentsClient = `import type { Card } from "../types";

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

export const retry = `export async function withRetries<T>(run: () => Promise<T>, { attempts }: { attempts: number }): Promise<T> {
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

const services = `export { inventory } from "./inventory";
export { mail } from "./mail";
export { orders } from "./orders";
export { payments } from "./services/payments";
`;

const types = `export type Cart = { id: string; items: { sku: string; quantity: number }[]; total: number };
export type Card = { token: string };
`;

const settingsScreen = `export function SettingsScreen() {
  return <ScrollView>{allSettings.map((setting) => <SettingRow key={setting.id} setting={setting} />)}</ScrollView>;
}
`;

const featureFlags = {
  "src/flags.ts": `export const flags = {
  newOnboarding: true,
  quickReorder: true,
  offlineCart: false,
  biometricLogin: true,
  darkModeToggle: true,
  legacyPushTokens: false,
  holidayBanner: false,
  oldSettingsMenu: false,
};
`,
  "src/home/HomeScreen.tsx": `import { flags } from "../flags";

export function HomeScreen() {
  if (flags.newOnboarding) return <Onboarding />;
  return <Home showReorder={flags.quickReorder} />;
}
`,
  "src/cart/CartScreen.tsx": `import { flags } from "../flags";

export const CartScreen = () => <Cart offline={flags.offlineCart} />;
`,
  "src/auth/LoginScreen.tsx": `import { flags } from "../flags";

export const LoginScreen = () => <Login biometric={flags.biometricLogin} />;
`,
  "src/theme/ThemeToggle.tsx": `import { flags } from "../flags";

export const ThemeToggle = () => (flags.darkModeToggle ? <Toggle /> : null);
`,
};
