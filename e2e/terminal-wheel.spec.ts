import { expect, test } from "@playwright/test";
import { addWorkspace, signIn, startConversation } from "./helpers.ts";
import { countTo, printRaw, showKeys, showKeysFollowingTheMouse } from "./terminal-shell.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();

test.beforeAll(() => host.start());
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

test("a mouse wheel over a full-screen program sends it arrow keys, also after the terminal grew and shrank", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  await startConversation(page);
  await page.getByRole("button", { name: "Show terminal" }).click();
  const shown = page.locator(".terminal-pane .xterm-rows");
  const rows = shown.locator(":scope > div");
  const row = (text: string) => rows.filter({ hasText: new RegExp(`^\\s*${text}\\s*$`) });
  const wheelUpOverTheTerminal = async () => {
    const screen = (await page.locator(".terminal-pane .xterm-screen").boundingBox())!;
    await page.mouse.move(screen.x + screen.width / 2, screen.y + screen.height / 2);
    await page.mouse.wheel(0, -300);
  };
  const runFullScreenProgram = async (marker: string) => {
    await page.keyboard.type(`${[printRaw("\x1b[?1049h"), countTo(100), showKeys(marker)].join("; ")}\n`);
    await expect(row(marker)).toHaveCount(1);
  };

  await page.locator(".terminal-pane .xterm-screen").click();
  await runFullScreenProgram("before-resize");
  await wheelUpOverTheTerminal();
  await expect(shown).toContainText("^[[A");
  await page.keyboard.press("Control+C");
  await page.keyboard.type(`${printRaw("\x1b[?1049l")}\n`);

  const rowCount = await rows.count();
  const viewport = page.viewportSize()!;
  await page.setViewportSize({ ...viewport, height: viewport.height + 300 });
  await expect.poll(() => rows.count()).toBeGreaterThan(rowCount);
  await page.setViewportSize(viewport);
  await expect.poll(() => rows.count()).toBe(rowCount);

  await runFullScreenProgram("after-resize");
  await wheelUpOverTheTerminal();
  await expect(shown).toContainText("^[[A");
  await expect(shown).not.toContainText("^[[B");
  await page.keyboard.press("Control+C");

  await test.step("a full-screen program that follows the mouse gets the wheel with the keys held down", async () => {
    await page.keyboard.type(`${showKeysFollowingTheMouse("follows-the-mouse")}\n`);
    await expect(row("follows-the-mouse")).toHaveCount(1);
    await expect(page.locator(".terminal-pane .xterm"), "the terminal follows the mouse").toHaveClass(/enable-mouse-events/);
    await page.keyboard.down("Alt");
    await wheelUpOverTheTerminal();
    await page.keyboard.up("Alt");
    await expect(shown).toContainText("^[[<72;");
    await expect(shown).not.toContainText("^[[<64;");
    await page.keyboard.press("Control+C");
  });
});
