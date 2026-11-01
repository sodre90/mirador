import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { addWorkspace, reloadFromRestartedHost, signIn, startConversation } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();

test.beforeAll(() => host.start());
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const informational = (text: string, level = "notice") => ({
  type: "acp",
  update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text }, _meta: { claudeCode: { kind: "informational", level } } },
});

const turn = [
  { type: "user-message", text: "carry on" },
  informational("**Notice:** Stop says: all checks passed"),
  informational("**Notice:** Context left until *auto-compact*: 10%"),
  { type: "acp", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Carrying on." } } },
  { type: "turn-end", stopReason: "end_turn" },
];

test("what Claude Code said aside before Mirador took its notices, a hook's message too, shows as it was written, apart from the reply", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const conversationId = await startConversation(page);
  await host.stop();
  execFileSync("bun", [join(import.meta.dirname, "seed-events.ts"), join(host.dataDir, "state.sqlite"), conversationId, JSON.stringify(turn)]);
  await host.start();
  await reloadFromRestartedHost(page);

  await expect(page.locator(".message.agent")).toHaveText(["Carrying on."]);
  const asides = page.locator(".timeline .info-line");
  await expect(asides).toHaveText(["Notice: Stop says: all checks passed", "Notice: Context left until auto-compact: 10%"]);
  await expect(asides.locator("strong")).toHaveText(["Notice:", "Notice:"]);
});
