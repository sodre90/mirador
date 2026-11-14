import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, primaryModifier, reloadFromRestartedHost, signIn, startConversation } from "./helpers.ts";
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
/** Turns stored at a little over 250 KB each, so the page gets the newest 16 and the host holds the rest. */
const RAW_OUTPUT_SIZE = 250_000;

const question = (turn: number) => `question ${String(turn).padStart(2, "0")}`;

/** The user's message the transcript has at its top edge, or null when another entry is there. */
const messageAtTop = (page: Page) =>
  page.locator(".timeline:visible").evaluate((timeline) => {
    const edge = timeline.getBoundingClientRect().top;
    const atTop = [...timeline.querySelectorAll(":scope > .timeline-entry")].find((entry) => Math.abs(entry.getBoundingClientRect().top - edge) < 20);
    return atTop?.querySelector(".message.user")?.textContent ?? null;
  });

const turnOf = (message: string | null) => Number(message?.match(/^question (\d+)/)?.[1] ?? Number.NaN);

test("two keys step through your own messages, back into the parts only the host holds and forward to the latest", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const conversationId = await startConversation(page);
  await host.stop();
  execFileSync("bun", [join(import.meta.dirname, "seed-paged-conversation.ts"), join(host.dataDir, "state.sqlite"), conversationId, String(TURNS), String(RAW_OUTPUT_SIZE)]);
  await host.start();
  await reloadFromRestartedHost(page);
  const entries = page.locator(".timeline:visible .timeline-entry");
  await expect(entries.last()).toBeInViewport();
  const primary = await primaryModifier(page);
  const back = `${primary}+ArrowUp`;
  const forward = `${primary}+ArrowDown`;
  const composer = page.locator(".composer:visible textarea");
  await composer.focus();

  let turn = Number.NaN;
  await test.step("back goes to the nearest message of yours above the view, and puts it at the top", async () => {
    await page.keyboard.press(back);
    await expect.poll(async () => turnOf(await messageAtTop(page))).not.toBeNaN();
    turn = turnOf(await messageAtTop(page));
    expect(turn).toBeLessThan(TURNS - 1);
  });

  await test.step("again goes one message further back, and forward comes back to it", async () => {
    await page.keyboard.press(back);
    await expect.poll(() => messageAtTop(page)).toBe(question(turn - 1));
    await page.keyboard.press(forward);
    await expect.poll(() => messageAtTop(page)).toBe(question(turn));
  });

  await test.step("back keeps going through the parts the host holds, to the first message, and stops there", async () => {
    for (let earlier = turn - 1; earlier >= 0; earlier--) {
      await page.keyboard.press(back);
      await expect.poll(() => messageAtTop(page)).toBe(question(earlier));
    }
    await page.keyboard.press(back);
    await expect(page.locator(".timeline:visible .load-earlier")).toHaveCount(0);
    expect(await messageAtTop(page)).toBe(question(0));
  });

  await test.step("while a message is being written, the keys move its caret and the transcript stays", async () => {
    await composer.fill("a draft");
    await composer.press(forward);
    await composer.press(back);
    expect(await messageAtTop(page)).toBe(question(0));
    await composer.fill("");
  });

  await test.step("forward past your last message shows the latest reply", async () => {
    for (let later = 1; later < TURNS; later++) await page.keyboard.press(forward);
    await page.keyboard.press(forward);
    await expect(entries.last()).toBeInViewport();
    await expect(page.locator(".jump-to-latest:visible")).toHaveCount(0);
  });
});
