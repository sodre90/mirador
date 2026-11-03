import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, callCanvasTool, createProfile, openSettings, signIn } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

const host = new TestHost({ fakePrograms: true });
const historyFile = join(host.root, "history.json");
const profileName = "recorded";

/** A tool call as an agent replays it from its records: named, then its input, then its result. */
const replayedCall = (id: string, tool: string, input: Record<string, unknown>, result: string) => [
  { sessionUpdate: "tool_call", toolCallId: id, title: tool, kind: "other", status: "pending" },
  { sessionUpdate: "tool_call_update", toolCallId: id, rawInput: input },
  { sessionUpdate: "tool_call_update", toolCallId: id, status: "completed", content: [{ type: "content", content: { type: "text", text: result } }] },
];

test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  writeBunProgram(host.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"), {
    FAKE_ACP_PROMPTS: join(host.root, "prompts"),
    FAKE_ACP_HISTORY: historyFile,
  });
  writeFileSync(
    historyFile,
    JSON.stringify({
      sessionId: "recorded-session",
      title: "Earlier canvas work",
      updates: [
        { sessionUpdate: "user_message_chunk", content: { type: "text", text: "Show me the plan" } },
        ...replayedCall("t1", "canvas_show", { title: "The plan", html: "<h1 id='plan'>Step one</h1>" }, "Shown to the user."),
        ...replayedCall("t2", "canvas_ask", { question: "Which way?", options: [{ label: "Left" }, { label: "Right" }] }, "The user chose: Right\nTheir note: shorter"),
        { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Going right." } },
      ],
    }),
  );
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

async function continueTheRecordedSession(page: Page) {
  await page.getByRole("button", { name: "Continue a session…" }).click();
  const dialog = page.getByRole("dialog", { name: "Continue a session" });
  await dialog.locator(".session-list li", { hasText: "Earlier canvas work" }).getByRole("button", { name: "Continue" }).click();
  await expect(page.locator(".timeline")).toContainText("Going right.", { timeout: 30_000 });
}

const historyTitles = (page: Page) => page.locator(".canvas-panel:visible .canvas-history .entry-title");

test("continuing a session brings back the pages and answered questions its agent put on the canvas", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, profileName, "", "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${profileName} · opencode` });

  await continueTheRecordedSession(page);

  const history = page.locator(".canvas-panel:visible .canvas-history");
  await page.locator(".canvas-header:visible").getByRole("button", { name: "History (2)" }).click();
  await expect(historyTitles(page)).toHaveText(["Which way?", "The plan"]);

  await history.getByRole("button", { name: /Which way\?/ }).click();
  await expect(page.locator(".canvas-panel:visible .ask-answer")).toContainText("You chose Right — “shorter” (returned to the agent)");

  await page.locator(".canvas-header:visible").getByRole("button", { name: "History (2)" }).click();
  await history.getByRole("button", { name: /The plan/ }).click();
  await expect(page.frameLocator(".canvas-panel:visible .canvas-frame iframe").locator("#plan")).toHaveText("Step one");
});

test("a deleted conversation's canvas comes back as it was when its session is continued, for as long as Settings keep it", async ({ page }) => {
  await signIn(page, host);
  await page.locator(".sidebar li", { hasText: "Earlier canvas work" }).click();
  const conversationId = page.url().match(/#\/c\/(.+)$/)![1]!;
  await callCanvasTool(host, conversationId, "show", { title: "Shown live", html: "<p id='live'>Not in the history</p>" });
  await expect(page.locator(".canvas-header:visible .canvas-title")).toHaveText("Shown live");

  const settings = await openSettings(page, "Canvas");
  const keep = settings.getByLabel("Keep a deleted conversation's canvas");
  await expect(keep).toHaveValue("30-days");
  await keep.selectOption({ label: "7 days" });
  await page.reload();
  await expect((await openSettings(page, "Canvas")).getByLabel("Keep a deleted conversation's canvas")).toHaveValue("7-days");
  await page.getByRole("dialog", { name: "Settings" }).getByRole("button", { name: "Close" }).click();

  const row = page.locator(".sidebar li", { hasText: "Earlier canvas work" });
  const deleteButton = row.getByRole("button", { name: "Delete conversation" });
  await row.hover();
  await deleteButton.click();
  await expect(deleteButton).toHaveText("Delete?");
  await deleteButton.click();
  await expect(row).toHaveCount(0);

  await continueTheRecordedSession(page);
  await expect(page.locator(".canvas-header:visible .canvas-title")).toHaveText("Shown live");
  await expect(page.frameLocator(".canvas-panel:visible .canvas-frame iframe").locator("#live")).toHaveText("Not in the history");
  await page.locator(".canvas-header:visible").getByRole("button", { name: "History (3)" }).click();
  await expect(historyTitles(page)).toHaveText(["Shown live", "Which way?", "The plan"]);
});
