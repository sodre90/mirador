import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { FakeClaudeApi, subscriptionEnvironment } from "./fake-claude-api.ts";
import { addWorkspace, createProfile, eventsInOrderOn, lastAgentMessage, literally, sendMessage, signIn, startConversation, waitForTurnToEnd } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();
const api = new FakeClaudeApi();
const PROFILE = "advisor";
/** Claude Code gives up on a reply that sends nothing for this long, as it does after five minutes on Bedrock. */
const GIVES_UP_ON_STALLED_REPLY = "CLAUDE_ENABLE_BYTE_WATCHDOG=1\nCLAUDE_BYTE_STREAM_IDLE_TIMEOUT_MS=10000";
const keptOutLines = () => host.log.split("\n").filter((line) => line.includes("wait outside its running turn"));

/** When the page first hears of the advisor's call ending, and of the agent's own tool starting and finishing. */
function advisorEndAndAgentToolOn(page: Page) {
  const steps: string[] = [];
  const once = (step: string) => !steps.includes(step) && steps.push(step);
  page.on("websocket", (socket) =>
    socket.on("framereceived", ({ payload }) => {
      const update = JSON.parse(String(payload)).event?.event?.update;
      if (update?.sessionUpdate === "tool_call_update" && update.toolCallId.startsWith("srvtoolu_") && update.status === "failed") once("advisor ended");
      if (update?.sessionUpdate === "tool_call" && update.toolCallId.startsWith("toolu_")) once("agent's tool started");
      if (update?.sessionUpdate === "tool_call_update" && update.toolCallId.startsWith("toolu_") && update.status === "completed") once("agent's tool finished");
    }),
  );
  return steps;
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  api.limited = false;
  await api.start();
  await host.start();
  mkdirSync(join(host.projectDir, ".claude"), { recursive: true });
  writeFileSync(join(host.projectDir, ".claude", "settings.json"), JSON.stringify({ permissions: { allow: ["Bash"] } }));
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
  api.stop();
});

test("an advisor call Claude makes after another tool call in the same reply, left without its result, leaves the turn ending as usual", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, PROFILE, subscriptionEnvironment(api));
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${PROFILE} · Claude Code` });
  await startConversation(page);

  await sendMessage(page, "ADVISOR AFTER BASH echo ran-$((40+2))");

  await waitForTurnToEnd(page);
  const timeline = page.locator(".timeline:visible");
  await expect(timeline).toContainText("ran-42");
  await expect(lastAgentMessage(page)).toContainText("Answered:");
  await expect(timeline).toContainText("Claude stopped this tool call before it ran.");
  await expect(timeline).not.toContainText("without returning results");
});

test("a message sent while the advisor runs joins the turn once Claude Code gives up on the advisor's stalled reply and the agent's next tool finishes", async ({ page }) => {
  const eventsInOrder = eventsInOrderOn(page);
  const advisorEndAndAgentTool = advisorEndAndAgentToolOn(page);
  const stalling = "ADVISOR CUT OFF echo ran-$((40+2))";
  const joining = "Reply with the word JOINED.";
  await signIn(page, host);
  const profiles = await createProfile(page, `${PROFILE} cut off`, `${subscriptionEnvironment(api)}\n${GIVES_UP_ON_STALLED_REPLY}`);
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${PROFILE} cut off · Claude Code` });
  await startConversation(page);

  await sendMessage(page, stalling);
  const timeline = page.locator(".timeline:visible");
  await expect(timeline.locator(".tool-pending, .tool-in_progress").filter({ hasText: "advisor" })).toBeVisible();
  const composer = page.locator(".composer:visible textarea");
  await composer.fill(joining);
  await composer.press("Enter");
  await expect(page.locator(".queued-delivery")).toHaveText(["joins the turn"]);
  await expect.poll(keptOutLines, { message: "the advisor call it waits on is still running" }).toEqual([expect.stringMatching(/the agent's own tool call srvtoolu_\S+ \(other\) is still open$/)]);
  api.stallAdvisorReply();

  await waitForTurnToEnd(page);
  await expect(timeline).toContainText("ran-42");
  // The steer can reach Claude Code after it asked for its reply to the command's output, which then comes first in the same bubble.
  await expect(lastAgentMessage(page)).toHaveText(new RegExp(`Answered: ${literally(joining)}$`));
  expect(eventsInOrder, "the message joined the turn rather than waiting for it to end").toEqual([stalling, joining, "turn-end"]);
  expect(advisorEndAndAgentTool, "the advisor's call ended once Claude Code asked again, not at the turn's end").toEqual(["agent's tool started", "advisor ended", "agent's tool finished"]);
  await expect(timeline).toContainText("Claude stopped this tool call before it ran.");
});
