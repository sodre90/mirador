import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { FakeClaudeApi, fakeClaudeEnvironment } from "./fake-claude-api.ts";
import { addWorkspace, reloadFromRestartedHost, sendMessage, signIn, startConversation, waitForTurnToEnd } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const api = new FakeClaudeApi();
const host = new TestHost({ environment: () => fakeClaudeEnvironment(api) });

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

interface TurnEnd {
  startedAt?: number;
  filesEdited?: number;
}

function turnEndsHeardOn(page: Page) {
  const turnEnds: TurnEnd[] = [];
  page.on("websocket", (socket) =>
    socket.on("framereceived", ({ payload }) => {
      const event = JSON.parse(String(payload)).event?.event;
      if (event?.type === "turn-end") turnEnds.push(event);
    }),
  );
  return turnEnds;
}

const notices = (page: Page) => page.locator(".timeline:visible .notice-line");

test("a turn that worked for minutes ends with a line saying how long it worked and how many files it edited", async ({ page }) => {
  const turnEnds = turnEndsHeardOn(page);
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const conversationId = await startConversation(page);

  await test.step("the host counts the files the agent's edit tools changed in a turn, and a turn of seconds gets no line", async () => {
    await sendMessage(page, `WRITE ${join(host.projectDir, "hello.txt")} hi`);
    await page.locator(".permission.pending button.option-allow_once").click();
    await waitForTurnToEnd(page);
    await expect.poll(() => turnEnds.at(-1)?.filesEdited).toBe(1);
    await sendMessage(page, "Reply with just the word OK.");
    await waitForTurnToEnd(page);
    await expect.poll(() => turnEnds.length).toBe(2);
    expect(turnEnds[1]!.filesEdited).toBeUndefined();
    await expect(notices(page).filter({ hasText: "Worked" })).toHaveCount(0);
  });

  await test.step("a turn of 18 minutes that edited 9 files says so under its reply, and the short turn after it says nothing", async () => {
    await host.stop();
    execFileSync("bun", [join(import.meta.dirname, "seed-turn-recap.ts"), join(host.dataDir, "state.sqlite"), conversationId, "18", "9"]);
    await host.start();
    await reloadFromRestartedHost(page);
    await expect(notices(page).filter({ hasText: "Worked" })).toHaveText(["Worked 18 min · 9 files edited"]);
    const entries = page.locator(".timeline:visible .timeline-entry");
    const recapIndex = await entries.evaluateAll((all) => all.findIndex((entry) => entry.textContent?.includes("Worked 18 min")));
    await expect(entries.nth(recapIndex - 1)).toContainText("The checkout is refactored.");
    await expect(entries.nth(recapIndex + 1)).toContainText("thanks");
    await expect(entries.last()).toContainText("You're welcome.");
  });
});
