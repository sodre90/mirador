import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
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

test("a long conversation shows its newest entries, and earlier ones load as the reader scrolls up, keeping their place", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const conversationId = await startConversation(page);
  await host.stop();
  execFileSync("bun", [join(import.meta.dirname, "seed-long-conversation.ts"), join(host.dataDir, "state.sqlite"), conversationId, "225"]);
  await host.start();
  const historySizes: number[] = [];
  page.on("websocket", (socket) =>
    socket.on("framereceived", ({ payload }) => {
      const message = JSON.parse(String(payload));
      if (message.type === "conversation.history") historySizes.push(message.events.length);
    }),
  );
  await reloadFromRestartedHost(page);

  await test.step("each answer, streamed a word at a time, reaches the page as one event", async () => {
    await expect.poll(() => historySizes.at(-1)).toBeGreaterThanOrEqual(3 * 225);
    expect(historySizes.at(-1)).toBeLessThan(3 * 225 + 10);
  });

  let notLoaded = 0;
  await test.step("the newest 200 entries are in the page, with the latest in view", async () => {
    await expect(entries(page)).toHaveCount(200);
    await expect(entries(page).last()).toContainText("answer 224");
    await expect(entries(page).last()).toBeInViewport();
    await expect(earlier(page)).toHaveText(/^Show earlier entries \(\d+ more\)$/);
    notLoaded = Number((await earlier(page).textContent())!.match(/\d+/)![0]);
    expect(notLoaded).toBeGreaterThanOrEqual(250);
  });

  await test.step("scrolling to the top loads 200 more above, and what the reader was looking at stays where it was", async () => {
    const first = await firstEntryAfterScrollingToTheTop(page);
    await expect(entries(page)).toHaveCount(400);
    expect(Math.abs((await topOfEntry(page, first.text)) - first.top)).toBeLessThan(2);
    await expect(earlier(page)).toHaveText(`Show earlier entries (${notLoaded - 200} more)`);
  });

  await test.step("the button loads the rest, for keyboards and conversations too short to scroll", async () => {
    await earlier(page).evaluate((button: HTMLElement) => button.click());
    await expect(entries(page)).toHaveCount(200 + notLoaded);
    await expect(entries(page).filter({ hasText: "question 0" })).toHaveCount(1);
    await expect(earlier(page)).toHaveCount(0);
  });

  await test.step("once all is loaded, a visit to the top doesn't pull the reader back there at the next update", async () => {
    const timeline = page.locator(".timeline");
    const scrollTo = (position: "top" | "middle") =>
      timeline.evaluate(async (element, position) => {
        element.scrollTop = position === "top" ? 0 : element.scrollHeight / 2;
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return element.scrollTop;
      }, position);
    await scrollTo("top");
    const middle = await scrollTo("middle");
    await openSettings(page);
    expect(Math.abs((await timeline.evaluate((element) => element.scrollTop)) - middle)).toBeLessThan(2);
  });
});
