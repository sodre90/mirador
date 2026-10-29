import { spawn, type ChildProcess } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { ASK_IN_CANVAS, SHORTEN_AFTER_PAGE } from "../host/canvas/reply-check.ts";
import { FakeClaudeApi, fakeClaudeEnvironment } from "./fake-claude-api.ts";
import { addWorkspace, sendMessage, signIn, startConversation, waitForTurnToEnd } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const api = new FakeClaudeApi();
const host = new TestHost({ environment: () => fakeClaudeEnvironment(api) });
let page: Page;
let job: ChildProcess;

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  api.limited = false;
  await api.start();
  await host.start();
  job = spawn(process.execPath, ["-e", "setTimeout(() => {}, 600_000)"], { stdio: "ignore" });
  page = await browser.newPage();
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
});

test.afterAll(async () => {
  job.kill();
  await page.close();
  await host.stop();
  await host.cleanUp();
  api.stop();
});

const fromMirador = () => page.locator(".timeline-entry:visible", { has: page.locator(".author", { hasText: "From a script" }) }).locator(".message.user");

/** The turn, and the follow-up's turn when there is one, have ended, and nothing else is on its way. */
async function settle() {
  await waitForTurnToEnd(page);
  await page.waitForTimeout(1_500);
  await waitForTurnToEnd(page);
}

test("a question asked in chat while ending a turn to wait for a job is sent back to ask, once", async () => {
  await startConversation(page);
  await sendMessage(
    page,
    [
      `CALL mcp__canvas__when_done ${JSON.stringify({ pid: job.pid, message: "The run ended; read its log." })}`,
      "THEN Started the run; I'll pick up when it ends.",
      "",
      "- Should the fix also cover pi?",
      "- Keep the old flag?",
    ].join("\n"),
  );
  await settle();
  await expect(fromMirador()).toHaveCount(1);
  await expect(fromMirador()).toContainText(ASK_IN_CANVAS);
});

test("a long reply after a page is sent back to be cut to a few lines, once", async () => {
  await startConversation(page);
  await sendMessage(
    page,
    [
      'CALL mcp__canvas__show {"title": "Breakdown", "html": "<p>Cache reads are 65% of the spend.</p>"}',
      "THEN The breakdown is on the canvas.",
      "| Part | Share |",
      "|---|---|",
      "| cache reads | 65% |",
    ].join("\n"),
  );
  await settle();
  await expect(fromMirador()).toHaveCount(1);
  await expect(fromMirador()).toContainText(SHORTEN_AFTER_PAGE);
});

test("a short answer with no canvas use goes through untouched", async () => {
  await startConversation(page);
  await sendMessage(page, "Where is the ask tool defined");
  await settle();
  await expect(fromMirador()).toHaveCount(0);
});

test("the follow-up's own turn goes through even when its reply still asks in chat", async () => {
  await startConversation(page);
  api.replySuffix = "\n\nShall I go on?";
  try {
    await sendMessage(page, "Sum up the plan");
    await settle();
  } finally {
    api.replySuffix = "";
  }
  await expect(fromMirador()).toHaveCount(1);
  await expect(fromMirador()).toContainText(ASK_IN_CANVAS);
});
