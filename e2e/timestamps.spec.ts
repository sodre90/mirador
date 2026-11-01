import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { addWorkspace, openSettings, reloadFromRestartedHost, signIn, startConversation } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();

test.beforeAll(async () => {
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const turn = [
  { type: "user-message", text: "what time is it" },
  { type: "acp", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "It is now." } } },
  {
    type: "acp",
    update: {
      sessionUpdate: "tool_call",
      toolCallId: "t1",
      title: "Read time.txt",
      kind: "read",
      status: "completed",
      rawInput: { file_path: "time.txt" },
      content: [{ type: "content", content: { type: "text", text: "12:00" } }],
    },
  },
  { type: "turn-end", stopReason: "end_turn" },
];

test("each author's name carries the time; later lines show theirs while pointed at, or always once timestamps are switched on", async ({
  page,
}) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const conversationId = await startConversation(page);
  await host.stop();
  execFileSync("bun", [join(import.meta.dirname, "seed-events.ts"), join(host.dataDir, "state.sqlite"), conversationId, JSON.stringify(turn)]);
  await host.start();
  await reloadFromRestartedHost(page);

  const userLine = page.locator(".timeline-entry", { has: page.locator(".message.user") });
  const userLineTime = userLine.locator(".author .timestamp");
  await expect(userLine.locator(".author")).toContainText("You");
  await expect(userLineTime).toBeVisible();
  await expect(userLineTime).toHaveText(/^\d\d:\d\d$/);
  await expect(userLineTime).toHaveAttribute("title", new RegExp(String(new Date().getFullYear())));
  await expect(page.locator(".timeline-entry", { has: page.locator(".message.agent") }).locator(".author")).toContainText("Claude");

  const laterLine = page.locator(".timeline-entry", { has: page.locator(".tool") });
  const laterLineTime = laterLine.locator(".gutter .timestamp");
  await expect(laterLine).not.toHaveClass(/group-start/);
  await expect(laterLineTime).toBeHidden();
  const indentOf = async () => (await laterLine.locator(".entry-body").boundingBox())!.x - (await laterLine.boundingBox())!.x;
  const indentWithTimeHidden = await indentOf();
  await laterLine.hover();
  await expect(laterLineTime).toBeVisible();
  await expect(laterLineTime).toHaveText(/^\d\d:\d\d$/);
  await page.locator(".chat-header h2").hover();
  await expect(laterLineTime).toBeHidden();

  const toggle = page.getByLabel("Show timestamps");
  await openSettings(page);
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await page.keyboard.press("Escape");
  await expect(laterLineTime).toBeVisible();
  expect(await indentOf()).toBe(indentWithTimeHidden);
  await page.reload();
  await expect(laterLineTime).toBeVisible();
  await openSettings(page);
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await page.keyboard.press("Escape");
  await expect(laterLineTime).toBeHidden();
});
