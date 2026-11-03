import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { addWorkspace, createProfile, signIn } from "./helpers.ts";
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

test("continuing a session brings back the pages and answered questions its agent put on the canvas", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, profileName, "", "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${profileName} · opencode` });

  await page.getByRole("button", { name: "Continue a session…" }).click();
  const dialog = page.getByRole("dialog", { name: "Continue a session" });
  await dialog.locator(".session-list li", { hasText: "Earlier canvas work" }).getByRole("button", { name: "Continue" }).click();
  await expect(page.locator(".timeline")).toContainText("Going right.", { timeout: 30_000 });

  const history = page.locator(".canvas-panel:visible .canvas-history");
  await page.locator(".canvas-header:visible").getByRole("button", { name: "History (2)" }).click();
  await expect(history.locator(".entry-title")).toHaveText(["Which way?", "The plan"]);

  await history.getByRole("button", { name: /Which way\?/ }).click();
  await expect(page.locator(".canvas-panel:visible .ask-answer")).toContainText("You chose Right — “shorter” (returned to the agent)");

  await page.locator(".canvas-header:visible").getByRole("button", { name: "History (2)" }).click();
  await history.getByRole("button", { name: /The plan/ }).click();
  await expect(page.frameLocator(".canvas-panel:visible .canvas-frame iframe").locator("#plan")).toHaveText("Step one");
});
