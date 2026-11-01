import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, openSettings, signIn, startConversation } from "./helpers.ts";
import { echo, printLinesTo, sum } from "./terminal-shell.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();

test.beforeAll(() => host.start());
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

/** Records what the page copies instead of writing it, so a run on macOS leaves the system clipboard alone. */
const recordCopies = (page: Page) =>
  page.addInitScript(() => {
    const copied: string[] = [];
    Object.assign(window, { copied });
    navigator.clipboard.writeText = async (text: string) => void copied.push(text);
  });
const copied = (page: Page) => page.evaluate(() => (window as unknown as { copied: string[] }).copied);
const lastCopied = async (page: Page) => (await copied(page)).at(-1);

test("with copy on select switched on in Settings → Terminal, selecting text in a terminal copies it", async ({ page }) => {
  await recordCopies(page);
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  await startConversation(page);
  await page.getByRole("button", { name: "Show terminal" }).click();
  const screen = page.locator(".terminal-pane .xterm-rows");
  await page.locator(".terminal-pane .xterm").click();
  await page.keyboard.type(`${echo(`copy-${sum("5+5")} and-more`)}\n`);
  await expect(screen).toContainText("copy-10 and-more");
  const row = (await screen.locator(":scope > div", { hasText: /^copy-10 and-more\s*$/ }).boundingBox())!;
  const onTheWord = { x: row.x + 20, y: row.y + row.height / 2 };

  await test.step("off by default: selecting copies nothing", async () => {
    await page.mouse.dblclick(onTheWord.x, onTheWord.y);
    await page.waitForTimeout(300);
    expect(await copied(page)).toEqual([]);
  });

  await test.step("switched on, a double-clicked word and a triple-clicked line are copied as the mouse is released", async () => {
    const settings = await openSettings(page, "Terminal");
    await settings.getByLabel("Copy on select").check();
    await page.keyboard.press("Escape");
    await page.mouse.dblclick(onTheWord.x, onTheWord.y);
    await expect.poll(() => copied(page)).toEqual(["copy-10"]);
    await page.mouse.click(onTheWord.x, onTheWord.y, { clickCount: 3 });
    await expect.poll(() => lastCopied(page)).toBe("copy-10 and-more");
  });

  await test.step("a drag copies what it covers; a plain click copies nothing", async () => {
    await page.mouse.move(row.x + 1, onTheWord.y);
    await page.mouse.down();
    await page.mouse.move(onTheWord.x + 10, onTheWord.y, { steps: 5 });
    await page.mouse.up();
    await expect.poll(() => lastCopied(page)).toMatch(/^copy-?1?$/);
    const copiesBefore = (await copied(page)).length;
    await page.mouse.click(onTheWord.x, onTheWord.y);
    await page.waitForTimeout(300);
    expect(await copied(page)).toHaveLength(copiesBefore);
  });

  await test.step("dragging past the terminal edge scrolls the terminal and copies the selection on release", async () => {
    await page.locator(".terminal-pane .xterm").click();
    await page.keyboard.type(`${printLinesTo(40, "scroll-line")}\n`);
    await expect(screen).toContainText("scroll-line-40");
    const terminalBox = (await page.locator(".terminal-pane .terminal-screen").boundingBox())!;
    const startY = terminalBox.y + terminalBox.height - 20;
    const startX = terminalBox.x + 30;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX, terminalBox.y - 15, { steps: 10 });
    await page.waitForTimeout(500);
    await page.mouse.move(startX, -50, { steps: 5 });
    await page.mouse.up();
    const last = await lastCopied(page);
    expect(last).toContain("scroll-line");
  });

  await test.step("when the browser refuses the copy, the terminal says how to copy instead, and no error goes unhandled", async () => {
    await page.evaluate(() => {
      const unhandled: string[] = [];
      Object.assign(window, { unhandled });
      window.addEventListener("unhandledrejection", (event) => unhandled.push(String(event.reason)));
      navigator.clipboard.writeText = () => Promise.reject(new DOMException("The request is not allowed by the user agent", "NotAllowedError"));
    });
    const note = page.locator(".terminal-copy-note");
    await page.mouse.dblclick(onTheWord.x, onTheWord.y);
    await expect(note).toHaveText(/^Couldn't copy the selection\. Press (⌘C|Ctrl\+Shift\+C) to copy it\.$/);
    expect(await page.evaluate(() => (window as unknown as { unhandled: string[] }).unhandled)).toEqual([]);
    await expect(note, "the note goes away by itself").toHaveCount(0, { timeout: 10_000 });
  });

  await test.step("the setting is remembered in this browser", async () => {
    await page.reload();
    await expect((await openSettings(page, "Terminal")).getByLabel("Copy on select")).toBeChecked();
  });
});
