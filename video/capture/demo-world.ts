import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * The trailer's world: a developer's home with a few projects under ~/code, each a git repository with a history, so
 * the sidebar reads `~/code` instead of a temporary folder, and Claude Code's settings are this home's, never the
 * settings of the person filming.
 */
export function worldIn(root: string) {
  const home = join(root, "home", "ada");
  const code = join(home, "code");
  return { home, projects: { shopApi: join(code, "shop-api"), mobileApp: join(code, "mobile-app"), storefront: join(code, "storefront"), infra: join(code, "infra") } };
}

/** Claude Code runs commands and the canvas's tools, its plugins' too, without asking; edits it still asks for. */
export const CLAUDE_SETTINGS = JSON.stringify({ permissions: { allow: ["Bash", "mcp__canvas"] } }, null, 2);

/** Writes the world's files; Playwright also imports specs in a process that never runs their hooks, so call it from one. */
export function createWorld({ home, projects }: ReturnType<typeof worldIn>) {
  writeFiles(home, {
    ".zshrc": "PROMPT='%F{141}%1~%f %F{245}❯%f '\nPROMPT_EOL_MARK=''\nunsetopt BEEP\n",
    ".claude/settings.json": CLAUDE_SETTINGS,
    ".gitconfig": "[user]\n\tname = Ada\n\temail = ada@example.com\n[commit]\n\tgpgsign = false\n[init]\n\tdefaultBranch = main\n",
  });
  createShopApi(projects.shopApi);
  createProject(projects.mobileApp, { "README.md": "# mobile-app\n", "src/settings/SettingsScreen.tsx": settingsScreen, ...featureFlags }, "Settings screen with every option on one page");
  createProject(projects.storefront, { "README.md": "# storefront\n", "pages/checkout.tsx": "export default function Checkout() {\n  return <main>Checkout</main>;\n}\n" }, "Checkout page");
  createProject(projects.infra, { "README.md": "# infra\n", "postgres/cluster.tf": 'resource "postgres_cluster" "main" {\n  version = "16"\n}\n' }, "Postgres 16 cluster");
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
 * shop-api on a branch that retries card payments: the change the trailer's review is about. On top of it, Ada's own
 * staged note in the README, and the test an earlier turn of the agent's wrote, so the uncommitted work holds both.
 */
function createShopApi(directory: string) {
  createProject(directory, { "README.md": "# shop-api\n", "src/checkout.ts": checkoutBefore, "src/services.ts": services, "src/types.ts": types }, "Checkout reserves stock, captures the payment and creates the order");
  git(directory, "checkout", "-q", "-b", "retry-payments");
  writeFiles(directory, { "src/checkout.ts": checkoutAfter, "src/retry.ts": retry });
  git(directory, "add", ".");
  git(directory, "commit", "-q", "-m", "Retry failed card payments and release the stock");
  writeFiles(directory, { "README.md": readmeWithPayments });
  git(directory, "add", "README.md");
  writeFiles(directory, { [CHECKOUT_TEST]: checkoutTest });
}

const readmeWithPayments = "# shop-api\n\n## Payments\n\nCheckout captures the card once per cart. A capture that times out is retried.\n";

/** The test and the script an earlier turn of the agent's wrote, to reproduce the double charge. */
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
export { payments } from "./payments";
`;

const types = `export type Cart = { id: string; items: { sku: string; quantity: number }[]; total: number };
export type Card = { token: string };
`;

const settingsScreen = `export function SettingsScreen() {
  return <ScrollView>{allSettings.map((setting) => <SettingRow key={setting.id} setting={setting} />)}</ScrollView>;
}
`;

/** The mobile app's feature flags, and the screens that read them: three flags nothing reads any more. */
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
