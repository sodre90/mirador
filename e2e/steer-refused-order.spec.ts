import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, createProfile, sendMessage, signIn, waitForTurnToEnd } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

const host = new TestHost({ fakePrograms: true });
const promptsFile = join(host.root, "prompts");
const toolDone = join(host.root, "tool-done");
const JOINING = "Joining the turn.";
const AFTER_TURN = "After the turn.";

test.beforeAll(async () => {
  writeBunProgram(host.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"), { FAKE_ACP_PROMPTS: promptsFile, FAKE_ACP_STEERS: "1" });
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

/** The page offers opencode no Steer button, so the messages go out as a page for an agent that steers sends them. */
const sendAsASteeringPage = (page: Page, conversationId: string, messages: { text: string; afterTurn: boolean }[]) =>
  page.evaluate(
    ({ conversationId, messages }) =>
      new Promise<void>((resolve) => {
        const socket = new WebSocket(`${location.origin.replace(/^http/, "ws")}/ws`);
        socket.onopen = () => {
          messages.forEach(({ text, afterTurn }) => socket.send(JSON.stringify({ type: "conversation.prompt", conversationId, text, imageIds: [], afterTurn })));
          resolve();
        };
      }),
    { conversationId, messages },
  );

test("a message the agent refuses to take into a turn that ended meanwhile still goes out before one sent for after the turn", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, "steering", "", "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "steering · opencode" });
  await page.getByRole("button", { name: "+ New conversation" }).click();

  const command = `TOOL UNTIL ${toolDone}`;
  await sendMessage(page, command);
  await expect(page.locator(".timeline:visible .tool-in_progress")).toBeVisible();
  const conversationId = page.url().match(/#\/c\/(.+)$/)![1]!;
  await sendAsASteeringPage(page, conversationId, [
    { text: JOINING, afterTurn: false },
    { text: AFTER_TURN, afterTurn: true },
  ]);
  await expect(page.locator(".queue:visible .queued-text")).toHaveText([JOINING, AFTER_TURN]);
  await expect.poll(() => host.log).toContain("wait outside its running turn: the agent's own tool call");

  writeFileSync(toolDone, "");
  await expect(page.locator(".timeline:visible .message.user")).toHaveText([command, JOINING, AFTER_TURN], { timeout: 30_000 });
  await waitForTurnToEnd(page);
  expect(readFileSync(promptsFile, "utf8").split("\n").filter(Boolean)).toEqual([command, JOINING, AFTER_TURN]);
});
