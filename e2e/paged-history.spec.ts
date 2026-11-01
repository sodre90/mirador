import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, currentMatch, primaryModifier, reloadFromRestartedHost, signIn, startConversation } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();

test.beforeAll(async () => {
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const TURNS = 40;
const RAW_OUTPUT_SIZE = 250_000;
/** Turns stored at a little over 250 KB each: 16 of them make up the 4 MB a page gets at a time. */
const TURNS_PER_PART = 16;
const ENTRIES_PER_TURN = 3;

const numbered = (text: string, turn: number) => `${text} ${String(turn).padStart(2, "0")}`;
const entries = (page: Page) => page.locator(".timeline .timeline-entry");
const earlier = (page: Page) => page.locator(".timeline .load-earlier");

/** Read in the same task as the scroll, before the scroll event lets the page load more. */
const firstEntryAfterScrollingToTheTop = (page: Page) =>
  page.locator(".timeline").evaluate((timeline) => {
    timeline.scrollTop = 0;
    const entry = timeline.querySelector(":scope > .timeline-entry")!;
    return { text: entry.textContent!, top: entry.getBoundingClientRect().top };
  });

const topOfEntry = (page: Page, text: string) =>
  entries(page).evaluateAll((all, text) => all.find((entry) => entry.textContent === text)!.getBoundingClientRect().top, text);

test("a long conversation opens with its newest part, and earlier parts come from the host as the reader scrolls, finds or searches", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const conversationId = await startConversation(page);
  await host.stop();
  execFileSync("bun", [join(import.meta.dirname, "seed-paged-conversation.ts"), join(host.dataDir, "state.sqlite"), conversationId, String(TURNS), String(RAW_OUTPUT_SIZE)]);
  await host.start();
  const histories: { events: number; size: number; hasEarlier: boolean }[] = [];
  page.on("websocket", (socket) =>
    socket.on("framereceived", ({ payload }) => {
      const message = JSON.parse(String(payload));
      if (message.type === "conversation.history") histories.push({ events: message.events.length, size: String(payload).length, hasEarlier: message.hasEarlier });
    }),
  );
  await reloadFromRestartedHost(page);

  await test.step("the page gets the newest turns that make up 4 MB as stored, without the raw output that repeats what each tool shows", async () => {
    await expect.poll(() => histories.at(-1)).toMatchObject({ events: TURNS_PER_PART * 4, hasEarlier: true });
    expect(histories.at(-1)!.size).toBeLessThan(100_000);
    await expect(entries(page)).toHaveCount(TURNS_PER_PART * ENTRIES_PER_TURN);
    await expect(entries(page).first()).toContainText(numbered("question", TURNS - TURNS_PER_PART));
    await expect(entries(page).last()).toContainText(numbered("reply", TURNS - 1));
    await expect(earlier(page)).toHaveText("Show earlier entries");
  });

  await test.step("a tool's raw output comes from the host when it is shown", async () => {
    const card = page.locator(".timeline details.tool").filter({ hasText: numbered("Grep needle", TURNS - 1) });
    await card.locator(":scope > summary").click();
    const output = card.locator("details.raw").filter({ has: page.locator("summary", { hasText: "output" }) });
    await output.locator("summary").click();
    await expect(output.locator("pre")).toContainText(numbered("raw listing", TURNS - 1));
    await card.locator(":scope > summary").click();
  });

  await test.step("↑ in the message box goes back to messages typed in the part the page does not hold", async () => {
    const composer = page.locator(".composer:visible textarea");
    await composer.focus();
    for (let step = 0; step <= TURNS_PER_PART; step++) await composer.press("ArrowUp");
    await expect(composer).toHaveValue(numbered("question", TURNS - TURNS_PER_PART - 1));
    await composer.fill("");
  });

  await test.step("scrolling to the top brings the part before from the host, and what the reader was looking at stays where it was", async () => {
    const first = await firstEntryAfterScrollingToTheTop(page);
    await expect(entries(page)).toHaveCount(2 * TURNS_PER_PART * ENTRIES_PER_TURN);
    await expect(entries(page).first()).toContainText(numbered("question", TURNS - 2 * TURNS_PER_PART));
    expect(Math.abs((await topOfEntry(page, first.text)) - first.top)).toBeLessThan(2);
    await expect(earlier(page)).toHaveText("Show earlier entries");
  });

  await test.step("Find counts the matches the host holds too, and a step to one of them brings its part", async () => {
    const bar = page.getByRole("search");
    await page.keyboard.press("Control+KeyF");
    await bar.getByLabel("Find in this conversation").fill("reply");
    await expect(bar.locator(".find-tally")).toHaveText(`${TURNS} of ${TURNS}`);
    const matchCase = bar.getByRole("button", { name: "Match case" });
    await matchCase.click();
    await bar.getByLabel("Find in this conversation").fill("Reply");
    await expect(bar.locator(".find-tally")).toHaveText("No matches");
    await matchCase.click();
    await expect(bar.locator(".find-tally")).toHaveText(`${TURNS} of ${TURNS}`);
    await bar.getByLabel("Find in this conversation").fill("reply");
    await expect(bar.locator(".find-tally")).toHaveText(`${TURNS} of ${TURNS}`);
    await bar.getByRole("button", { name: "Newer match" }).click();
    await expect(bar.locator(".find-tally")).toHaveText(`1 of ${TURNS}`);
    await expect.poll(() => currentMatch(page)).toMatchObject({ text: "reply", entry: expect.stringContaining(numbered("reply", 0)), inView: true });
    await expect(earlier(page)).toHaveCount(0);
    await bar.getByRole("button", { name: "Close find" }).click();
  });

  await test.step("a search hit in a part the page does not hold opens the conversation there", async () => {
    await page.reload();
    await expect(entries(page)).toHaveCount(TURNS_PER_PART * ENTRIES_PER_TURN);
    const dialog = page.getByRole("dialog", { name: "Search all workspaces" });
    const unheldTurn = TURNS - TURNS_PER_PART - 3;
    await page.keyboard.press(`${await primaryModifier(page)}+Shift+KeyF`);
    await dialog.getByLabel("Search all workspaces").fill("reply");
    await dialog.getByRole("option").filter({ hasText: numbered("reply", unheldTurn) }).click();
    const bar = page.getByRole("search");
    await expect(bar.locator(".find-tally")).toHaveText(`${unheldTurn + 1} of ${TURNS}`);
    await expect.poll(() => currentMatch(page)).toMatchObject({ entry: expect.stringContaining(numbered("reply", unheldTurn)), inView: true });
  });
});
