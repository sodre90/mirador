import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { FakeGateway, gatewayEnvironment } from "./fake-gateway.ts";
import { addWorkspace, createProfile, signIn, startConversation } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();
const gateway = new FakeGateway();
const claudeConfigDir = join(host.root, "claude-config");
const sessionRegistry = join(claudeConfigDir, "sessions");
const terminalRegistration = join(sessionRegistry, `${process.pid}.json`);

test.beforeAll(async () => {
  await gateway.start();
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
  gateway.stop();
});

function sessionIdTheAppRegistered(): string | undefined {
  if (!existsSync(sessionRegistry)) return undefined;
  return readdirSync(sessionRegistry)
    .map((name) => JSON.parse(readFileSync(join(sessionRegistry, name), "utf8")))
    .find(({ entrypoint }) => entrypoint === "sdk-ts")?.sessionId;
}

/** What Claude Code writes for a session in a terminal; this test process stands in for the running terminal. */
const openInTerminal = (sessionId: string, status: string) =>
  writeFileSync(terminalRegistration, JSON.stringify({ pid: process.pid, sessionId, entrypoint: "cli", kind: "interactive", status }));

test("a conversation shows when its session is also open in a terminal, and what it is doing there", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const dialog = await createProfile(page, "isolated", `${gatewayEnvironment(gateway)}\nCLAUDE_CONFIG_DIR=${claudeConfigDir}`);
  await dialog.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "isolated · Claude Code" });
  await startConversation(page);
  await expect.poll(sessionIdTheAppRegistered, { timeout: 30_000 }).toBeDefined();
  const sessionId = sessionIdTheAppRegistered()!;

  const badge = page.locator(".chat-header .badge", { hasText: "in a terminal" });
  const warning = page.getByRole("status").filter({ hasText: "also open in Claude Code in a terminal" });
  await page.waitForTimeout(3_000);
  await expect(badge).toHaveCount(0);

  openInTerminal(sessionId, "busy");
  await expect(badge).toHaveText("in a terminal · working");
  await expect(warning).toBeVisible();
  await expect(page.locator(".workspace li .dot")).toHaveClass(/terminal-working/);

  openInTerminal(sessionId, "waiting");
  await expect(badge).toHaveText("in a terminal · waiting for you");

  rmSync(terminalRegistration);
  await expect(badge).toHaveCount(0);
  await expect(warning).toHaveCount(0);
});
