import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
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

const appRegisteredASession = () =>
  existsSync(sessionRegistry) && readdirSync(sessionRegistry).some((name) => JSON.parse(readFileSync(join(sessionRegistry, name), "utf8")).entrypoint === "sdk-ts");

/** The profile's model check registers a session of its own beside the conversation's, so the page names which is the conversation's. */
function watchConversationSessionId(page: Page) {
  let sessionId: string | null = null;
  page.on("websocket", (socket) =>
    socket.on("framereceived", ({ payload }) => {
      const message = JSON.parse(String(payload));
      sessionId = message.type === "conversation.upserted" ? (message.conversation.acpSessionId ?? sessionId) : sessionId;
    }),
  );
  return () => sessionId;
}

/** What Claude Code writes for a session in a terminal; this test process stands in for the running terminal. */
const openInTerminal = (sessionId: string, status: string) =>
  writeFileSync(terminalRegistration, JSON.stringify({ pid: process.pid, sessionId, entrypoint: "cli", kind: "interactive", status }));

test("a conversation shows when its session is also open in a terminal, and what it is doing there", async ({ page }) => {
  const conversationSessionId = watchConversationSessionId(page);
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const dialog = await createProfile(page, "isolated", `${gatewayEnvironment(gateway)}\nCLAUDE_CONFIG_DIR=${claudeConfigDir}`);
  await dialog.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "isolated · Claude Code" });
  await startConversation(page);
  await expect.poll(appRegisteredASession, { timeout: 30_000 }).toBe(true);
  await expect.poll(conversationSessionId).not.toBeNull();
  const sessionId = conversationSessionId()!;

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
