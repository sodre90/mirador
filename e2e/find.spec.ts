import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, currentMatch, reloadFromRestartedHost, signIn, startConversation } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();

test.beforeAll(async () => {
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const update = (update: Record<string, unknown>) => ({ type: "acp", update });
const agentSays = (text: string) => update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text } });
const turnEnd = { type: "turn-end", stopReason: "end_turn" };

const oldestTurn = [
  { type: "user-message", text: "Where is the Needle?" },
  agentSays("The **needle** is in the haystack, next to another needle."),
  update({
    sessionUpdate: "tool_call",
    toolCallId: "toolu_read",
    title: "Read haystack.md",
    kind: "read",
    status: "completed",
    rawInput: { file_path: "haystack.md" },
    content: [{ type: "content", content: { type: "text", text: "needle: found on line 3" } }],
  }),
  turnEnd,
];

const lines = Array.from({ length: 12 }, (_, index) => (index === 9 ? "the needle is on line 10" : `line ${index + 1}`)).join("\n");
const newestTurn = [
  { type: "user-message", text: "Show me the lines" },
  update({
    sessionUpdate: "tool_call",
    toolCallId: "toolu_cat",
    title: "cat lines.txt",
    kind: "execute",
    status: "completed",
    rawInput: { command: "cat lines.txt", description: "Show the lines" },
    content: [{ type: "content", content: { type: "text", text: lines } }],
  }),
  agentSays("Done: one more needle."),
  turnEnd,
];

test("Cmd+F finds text anywhere in the conversation, in entries not loaded yet and in folded cards too", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const conversationId = await startConversation(page);
  await host.stop();
  const database = join(host.dataDir, "state.sqlite");
  execFileSync("bun", [join(import.meta.dirname, "seed-events.ts"), database, conversationId, JSON.stringify(oldestTurn)]);
  execFileSync("bun", [join(import.meta.dirname, "seed-long-conversation.ts"), database, conversationId, "120"]);
  execFileSync("bun", [join(import.meta.dirname, "seed-events.ts"), database, conversationId, JSON.stringify(newestTurn)]);
  await host.start();
  await reloadFromRestartedHost(page);

  const bar = page.getByRole("search");
  const input = bar.getByLabel("Find in this conversation");
  const tally = bar.locator(".find-tally");
  await expect(page.locator(".timeline .load-earlier")).toBeVisible();

  await test.step("the shortcut opens the bar, and the first match shown is the newest", async () => {
    await page.keyboard.press("Control+KeyF");
    await expect(input).toBeFocused();
    await input.fill("needle");
    await expect(tally).toHaveText("6 of 6");
    expect(await currentMatch(page)).toMatchObject({ text: "needle", entry: expect.stringContaining("Done: one more needle."), inView: true });
  });

  await test.step("Enter goes up to older matches, unfolding terminal output that was cut short", async () => {
    await input.press("Enter");
    await expect(tally).toHaveText("5 of 6");
    expect(await currentMatch(page)).toMatchObject({ entry: expect.stringContaining("the needle is on line 10"), inView: true });
    await expect(page.locator(".shell-more")).toHaveCount(0);
  });

  await test.step("a match in an entry not in the page yet loads it, and opens the card it is folded in", async () => {
    await input.press("Enter");
    await expect(tally).toHaveText("4 of 6");
    await expect(page.locator(".timeline details.tool", { hasText: "Read haystack.md" })).toHaveAttribute("open");
    expect(await currentMatch(page)).toMatchObject({ entry: expect.stringContaining("needle: found on line 3"), inView: true });
  });

  await test.step("matches step one by one, also within a message, and wrap around at the ends", async () => {
    await input.press("Enter");
    await expect(tally).toHaveText("3 of 6");
    await input.press("Enter");
    await expect(tally).toHaveText("2 of 6");
    await input.press("Enter");
    await expect(tally).toHaveText("1 of 6");
    expect(await currentMatch(page)).toMatchObject({ text: "Needle", entry: expect.stringContaining("Where is the Needle?"), inView: true });
    await input.press("Shift+Enter");
    await expect(tally).toHaveText("2 of 6");
    await input.press("Enter");
    await input.press("Enter");
    await expect(tally).toHaveText("6 of 6");
  });

  await test.step("a match may cross formatting, and the tally says when nothing matches", async () => {
    await input.fill("needle is in");
    await expect(tally).toHaveText("1 of 1");
    expect(await currentMatch(page)).toMatchObject({ text: "needle is in", inView: true });
    await input.fill("no such thing");
    await expect(tally).toHaveText("No matches");
  });

  await test.step("Match case counts only the matches written the same way, in entries not loaded yet and in folded output too", async () => {
    const matchCase = bar.getByRole("button", { name: "Match case" });
    await input.fill("needle");
    await expect(tally).toHaveText("6 of 6");
    await matchCase.click();
    await expect(matchCase).toHaveAttribute("aria-pressed", "true");
    await expect(input).toBeFocused();
    await expect(tally).toHaveText("5 of 5");
    await input.fill("Needle");
    await expect(tally).toHaveText("1 of 1");
    expect(await currentMatch(page)).toMatchObject({ text: "Needle", entry: expect.stringContaining("Where is the Needle?"), inView: true });
    await expect(page.locator(".shell-more")).toHaveCount(1);
    await matchCase.click();
    await expect(tally).toHaveText("6 of 6");
    await expect(page.locator(".shell-more")).toHaveCount(0);
  });

  await test.step("Esc closes the bar and clears the highlights; the header's Find opens it again", async () => {
    await input.press("Escape");
    await expect(bar).toHaveCount(0);
    expect(await currentMatch(page)).toBeNull();
    await expect(page.locator(".composer textarea")).toBeFocused();
    await page.locator(".chat-header").getByRole("button", { name: "Find" }).click();
    await expect(input).toBeFocused();
    await expect(input).toHaveValue("");
    await expect(bar.getByRole("button", { name: "Match case" })).toHaveAttribute("aria-pressed", "false");
  });
});

test("keys typed right after opening the find bar stay in its query", async ({ page }) => {
  await signIn(page, host);
  await startConversation(page);
  const findButton = page.locator(".chat-header").getByRole("button", { name: "Find" });
  const input = page.getByRole("search").getByLabel("Find in this conversation");
  const composer = page.locator(".composer textarea");

  await test.step("a fresh bar keeps the letters typed before the next frame", async () => {
    await findButton.evaluate(async (button: HTMLElement) => {
      button.click();
      for (let microtask = 0; microtask < 20 && document.activeElement?.getAttribute("aria-label") !== "Find in this conversation"; microtask++) await Promise.resolve();
      document.execCommand("insertText", false, "ne");
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      document.execCommand("insertText", false, "edle");
    });
    await expect(input).toHaveValue("needle");
  });

  await test.step("with the bar open and the cursor in the message box, the very next keys go to the query, replacing it", async () => {
    await composer.focus();
    await expect(input).not.toBeFocused();
    await findButton.evaluate((button: HTMLElement) => {
      button.click();
      document.execCommand("insertText", false, "x");
    });
    await expect(input).toHaveValue("x");
    await expect(composer).toHaveValue("");
  });
});

/** The matches highlighted, and how many of them are in the conversation's view. */
const highlighted = (page: Page) =>
  page.evaluate(() => {
    const view = document.querySelector(".timeline")!.getBoundingClientRect();
    const ranges = [...(CSS.highlights.get("find-match") ?? [])] as Range[];
    const inView = ranges.filter((range) => {
      const box = range.getBoundingClientRect();
      return box.bottom > view.top && box.top < view.bottom;
    });
    return { count: ranges.length, inView: inView.length };
  });

test("a single letter in a long, busy conversation is found at once, highlighted where you look", async ({ page }) => {
  await signIn(page, host);
  const conversationId = await startConversation(page);
  await host.stop();
  execFileSync("bun", [join(import.meta.dirname, "seed-busy-conversation.ts"), join(host.dataDir, "state.sqlite"), conversationId, "30", "35"]);
  await host.start();
  await reloadFromRestartedHost(page);
  await expect(page.locator(".timeline .load-earlier")).toBeVisible();

  await page.keyboard.press("Control+KeyF");
  const input = page.getByRole("search").getByLabel("Find in this conversation");
  await input.fill("e");
  const tally = page.getByRole("search").locator(".find-tally");
  await expect(tally).toHaveText(/^\d+ of \d+$/);
  const [position, total] = (await tally.textContent())!.split(" of ").map(Number);
  expect(position).toBe(total);
  expect(total).toBeGreaterThan(100_000);

  await test.step("only the matches in view are highlighted, at most a thousand", async () => {
    const shown = await highlighted(page);
    expect(shown.count).toBeLessThanOrEqual(1_000);
    expect(shown.inView).toBeGreaterThan(0);
  });

  await test.step("scrolling highlights the matches that come into view", async () => {
    const scrolledTo = await page.locator(".timeline").evaluate((timeline) => {
      timeline.scrollTop = Math.max(2 * timeline.clientHeight, timeline.scrollTop - 3 * timeline.clientHeight);
      return timeline.scrollTop;
    });
    expect(scrolledTo).toBeGreaterThan(0);
    await expect.poll(async () => (await highlighted(page)).inView).toBeGreaterThan(0);
  });

  await test.step("stepping up goes to the match before, also from a long run of them", async () => {
    await input.press("Enter");
    const stepsFromNewest = async () => {
      const [shownPosition, shownTotal] = (await tally.textContent())!.split(" of ").map(Number);
      return shownTotal! - shownPosition!;
    };
    await expect.poll(stepsFromNewest).toBe(1);
  });
});
