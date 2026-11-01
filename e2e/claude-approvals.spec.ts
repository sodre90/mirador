import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { FakeClaudeApi, subscriptionEnvironment } from "./fake-claude-api.ts";
import { addWorkspace, bashPath, createProfile, sendMessage, signIn, startConversation, waitForTurnToEnd } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();
const api = new FakeClaudeApi();
const PROFILE = "approver";
const notes = () => join(host.projectDir, "notes.txt");

// The second test goes on in the conversation the first one leaves.
test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  api.limited = false;
  await api.start();
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
  api.stop();
});

test("a file Claude Code asks to write takes the canvas with its lines, and Yes writes it", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, PROFILE, subscriptionEnvironment(api));
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${PROFILE} · Claude Code` });
  await startConversation(page);

  await sendMessage(page, `WRITE ${notes()} Hello from Claude`);
  const approval = page.locator(".canvas-panel:visible .edit-approval");
  await expect(approval.locator(".edited-file h3")).toContainText("notes.txt", { timeout: 120_000 });
  await expect(approval.locator(".code-row.added")).toContainText("Hello from Claude");
  await expect(page.locator(".timeline:visible .permission.pending")).toContainText("Shown in the canvas");
  expect(existsSync(notes())).toBe(false);

  await approval.getByRole("button", { name: "Yes", exact: true }).click();
  await waitForTurnToEnd(page);
  expect(readFileSync(notes(), "utf8")).toBe("Hello from Claude\n");
});

test("a command Claude Code asks to run shows on its approval card", async ({ page }) => {
  await signIn(page, host);
  await page.locator(".workspace li").first().click();
  const madeByHand = join(host.projectDir, "made-by-hand");
  await sendMessage(page, `RUN touch ${bashPath(madeByHand)}`);
  const card = page.locator(".timeline:visible .permission.pending");
  await expect(card.locator(".shell-body")).toContainText(`touch ${bashPath(madeByHand)}`, { timeout: 120_000 });
  await card.getByRole("button", { name: "Yes", exact: true }).click();
  await waitForTurnToEnd(page);
  expect(existsSync(madeByHand)).toBe(true);
});
