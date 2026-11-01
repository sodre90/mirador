import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, signIn, startConversation, workspaceCard } from "./helpers.ts";
import { countTo, printRaw, showKeys, showKeysFollowingTheMouse } from "./terminal-shell.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();

test.beforeAll(() => host.start());
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

test.use({ hasTouch: true });

type Lift = "after a pause" | "at once";

/** A finger on the terminal, through Chrome's touch input as a touch screen gives it. */
async function fingerOnTheTerminal(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  const screen = (await page.locator(".terminal-pane .xterm-screen").boundingBox())!;
  const x = screen.x + screen.width / 2;
  const at = (share: number) => screen.y + screen.height * share;
  // The gesture carries its own clock: on a loaded runner the dispatch delays alone would space the events
  // past the product's pause reading, so a lift meant to fling would read as a finger resting before it.
  const epoch = Date.now() / 1000;
  let seconds = 0;
  const touch = (type: "touchStart" | "touchMove" | "touchEnd", y: number, gap: number) => {
    seconds += gap;
    return cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }], timestamp: epoch + seconds });
  };
  const moves = Array.from({ length: 10 }, (_, index) => (index + 1) / 10);
  return {
    async drag(from: number, to: number, lift: Lift) {
      await touch("touchStart", at(from), 0.016);
      for (const done of moves) {
        await touch("touchMove", at(from + (to - from) * done), 0.016);
        await page.waitForTimeout(16);
      }
      if (lift === "after a pause") await page.waitForTimeout(300);
      await touch("touchEnd", at(to), lift === "after a pause" ? 0.3 : 0.008);
    },
    async tap() {
      await touch("touchStart", at(0.5), 0.016);
      await touch("touchEnd", at(0.5), 0.05);
    },
  };
}

async function showTheTerminalWith300Lines(page: Page) {
  await signIn(page, host);
  const addProject = page.getByRole("button", { name: "+ Add a project directory" });
  await expect(addProject.or(workspaceCard(page, host.projectDir))).toBeVisible();
  if (await addProject.isVisible()) await addWorkspace(page, host.projectDir);
  await startConversation(page);
  await page.getByRole("button", { name: "Show terminal" }).click();
  const shown = page.locator(".terminal-pane .xterm-rows");
  const rows = shown.locator(":scope > div");
  const firstRowShown = async () => Number(await rows.first().textContent());
  const row = (text: string) => rows.filter({ hasText: new RegExp(`^\\s*${text}\\s*$`) });

  await expect(page.locator(".terminal-pane .terminal-screen")).toHaveCSS("touch-action", "none");
  await page.locator(".terminal-pane .xterm-screen").tap();
  await page.keyboard.type(`${countTo(300)}\n`);
  await expect(row("300").locator("xpath=following-sibling::div[1]")).toHaveText(/\S/);
  const latest = await firstRowShown();
  const rowCount = await rows.count();
  const finger = await fingerOnTheTerminal(page);
  return { shown, rows, row, firstRowShown, latest, rowCount, finger };
}

test("a finger drags the terminal's output and flings it till a touch stops it, and in a full-screen program scrolls as a wheel does there, also after the terminal grew and shrank", async ({ page }) => {
  const { shown, rows, row, firstRowShown, latest, rowCount, finger } = await showTheTerminalWith300Lines(page);

  await finger.drag(0.15, 0.85, "after a pause");
  const linesTheFingerMoved = Math.trunc(rowCount * 0.7);
  expect(latest - (await firstRowShown())).toBeGreaterThanOrEqual(linesTheFingerMoved - 1);
  expect(latest - (await firstRowShown())).toBeLessThanOrEqual(linesTheFingerMoved);

  await finger.drag(0.9, 0.05, "after a pause");
  expect(await firstRowShown()).toBe(latest);

  await finger.drag(0.15, 0.85, "at once");
  const whenLifted = await firstRowShown();
  await expect.poll(firstRowShown).toBeLessThan(whenLifted - 3);
  await finger.tap();
  await page.waitForTimeout(100);
  const whereTheTapStoppedIt = await firstRowShown();
  await page.waitForTimeout(500);
  expect(await firstRowShown()).toBe(whereTheTapStoppedIt);

  const viewport = page.viewportSize()!;
  await page.setViewportSize({ ...viewport, height: viewport.height + 300 });
  await expect.poll(() => rows.count()).toBeGreaterThan(rowCount);
  await page.setViewportSize(viewport);
  await expect.poll(() => rows.count()).toBe(rowCount);
  await page.keyboard.type(`${[printRaw("\x1b[?1049h"), countTo(100), showKeys("full-screen")].join("; ")}\n`);
  await expect(row("full-screen")).toHaveCount(1);
  await finger.drag(0.8, 0.2, "after a pause");
  await expect(shown).toContainText("^[[B");
  await expect(shown).not.toContainText("^[[A");
  await finger.drag(0.2, 0.8, "after a pause");
  await expect(shown).toContainText("^[[A");
  await page.keyboard.press("Control+C");

  await page.keyboard.type(`${[printRaw("\x1b[?1049l"), showKeysFollowingTheMouse("follows-the-mouse")].join("; ")}\n`);
  await expect(row("follows-the-mouse")).toHaveCount(1);
  await expect(page.locator(".terminal-pane .xterm"), "the terminal follows the mouse").toHaveClass(/enable-mouse-events/);
  await finger.drag(0.8, 0.2, "after a pause");
  await expect(shown).toContainText("^[[<65;");
  await expect(shown).not.toContainText("^[[<64;");
  await page.keyboard.press("Control+C");
});

test("typing while the output is still flinging stops the fling, and the view stays at the prompt", async ({ page }) => {
  const { firstRowShown, latest, finger } = await showTheTerminalWith300Lines(page);

  await finger.drag(0.15, 0.85, "at once");
  const whenLifted = await firstRowShown();
  await expect.poll(firstRowShown).toBeLessThan(whenLifted - 3);

  await page.keyboard.type("x");
  await expect.poll(firstRowShown).toBe(latest);
  await page.waitForTimeout(500);
  expect(await firstRowShown()).toBe(latest);
});
