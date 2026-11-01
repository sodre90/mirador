import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, signIn, startConversation } from "./helpers.ts";
import { busyCommandName, echo, keepShellBusy, sum } from "./terminal-shell.ts";
import { jobControlShell, TestHost } from "./test-host.ts";

const host = new TestHost({ shell: jobControlShell });

test.use({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36" });
test.beforeAll(() => host.start());
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const tabs = (page: Page) => page.getByRole("tab");
const splits = (page: Page) => page.locator(".terminal-pane .terminal-splits.shown .terminal-split");
const shownSplits = (page: Page) => page.locator(".terminal-pane .terminal-splits.shown .terminal-split:visible");
const typingInto = (page: Page, index: number) => page.locator(".terminal-pane .terminal-splits.shown .xterm-helper-textarea").nth(index);
const screenOf = (page: Page, index: number) => page.locator(".terminal-pane .terminal-splits.shown .xterm-rows").nth(index);
const boxOf = async (page: Page, index: number) => (await splits(page).nth(index).boundingBox())!;

test("on macOS the cmux and iTerm2 keys split side by side and stacked, move between splits and tabs, zoom, and close what runs nothing", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  await startConversation(page);
  await page.getByRole("button", { name: "Show terminal" }).click();
  await page.locator(".terminal-pane .terminal-splits.shown .xterm").click();
  await expect(typingInto(page, 0)).toBeFocused();

  await test.step("⌘D splits right and ⌘⇧D splits the new one down, each new shell taking the keys", async () => {
    await page.keyboard.press("Meta+D");
    await expect(splits(page)).toHaveCount(2);
    await expect(typingInto(page, 1)).toBeFocused();
    await page.keyboard.press("Meta+Shift+D");
    await expect(splits(page)).toHaveCount(3);
    await expect(typingInto(page, 2)).toBeFocused();
    await page.keyboard.type(`${echo(`below-${sum("2+3")}`)}\n`);
    await expect(screenOf(page, 2)).toContainText("below-5");

    const [left, topRight, bottomRight] = [await boxOf(page, 0), await boxOf(page, 1), await boxOf(page, 2)];
    expect(topRight.x).toBeGreaterThan(left.x + left.width / 2);
    expect(Math.abs(bottomRight.x - topRight.x)).toBeLessThan(2);
    expect(bottomRight.y).toBeGreaterThan(topRight.y + topRight.height / 2);
    expect(left.height).toBeGreaterThan(topRight.height + bottomRight.height - 4);
  });

  await test.step("⌥⌘arrows go to the split that way, and stay put at the edge; ⌘] and ⌘[ go round them in reading order", async () => {
    await page.keyboard.press("Meta+Alt+ArrowUp");
    await expect(typingInto(page, 1)).toBeFocused();
    await page.keyboard.press("Meta+Alt+ArrowLeft");
    await expect(typingInto(page, 0)).toBeFocused();
    await page.keyboard.press("Meta+Alt+ArrowDown");
    await expect(typingInto(page, 0)).toBeFocused();

    await page.keyboard.press("Meta+BracketRight");
    await expect(typingInto(page, 1)).toBeFocused();
    await page.keyboard.press("Meta+Alt+ArrowDown");
    await expect(typingInto(page, 2)).toBeFocused();
    await page.keyboard.press("Meta+BracketRight");
    await expect(typingInto(page, 0)).toBeFocused();
    await page.keyboard.press("Meta+BracketLeft");
    await expect(typingInto(page, 2)).toBeFocused();
    await page.keyboard.press("Meta+BracketLeft");
    await expect(typingInto(page, 1)).toBeFocused();
    await page.keyboard.press("Meta+BracketLeft");
    await expect(typingInto(page, 0)).toBeFocused();
  });

  await test.step("⌘⇧↩ zooms the focused split until pressed again or Show all", async () => {
    await page.keyboard.press("Meta+Shift+Enter");
    await expect(shownSplits(page)).toHaveCount(1);
    await expect(splits(page).nth(0)).toBeVisible();
    await expect(typingInto(page, 0)).toBeFocused();
    await page.keyboard.press("Meta+Shift+Enter");
    await expect(shownSplits(page)).toHaveCount(3);

    await page.keyboard.press("Meta+Shift+Enter");
    await expect(shownSplits(page)).toHaveCount(1);
    await page.getByRole("button", { name: "Show all" }).click();
    await expect(shownSplits(page)).toHaveCount(3);
  });

  await test.step("⌘T opens a tab; ⌘⇧[ ⌘⇧], ⌘1 and ⌃2 switch tabs, each coming back to the split it left", async () => {
    await page.locator(".terminal-pane .terminal-splits.shown .xterm").nth(1).click();
    await page.keyboard.press("Meta+T");
    await expect(tabs(page)).toHaveCount(2);
    const second = tabs(page).nth(1);
    await expect(second).toHaveAttribute("aria-selected", "true");
    await expect(splits(page)).toHaveCount(1);
    await expect(typingInto(page, 0)).toBeFocused();

    await page.keyboard.press("Meta+Shift+BracketLeft");
    await expect(tabs(page).nth(0)).toHaveAttribute("aria-selected", "true");
    await expect(typingInto(page, 1)).toBeFocused();
    await page.keyboard.press("Meta+Shift+BracketLeft");
    await expect(second).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Meta+Shift+BracketRight");
    await expect(tabs(page).nth(0)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Control+2");
    await expect(second).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Meta+1");
    await expect(tabs(page).nth(0)).toHaveAttribute("aria-selected", "true");
    await expect(typingInto(page, 1)).toBeFocused();
  });

  await test.step("⌘W closes a split that runs nothing at once, and the split before it takes the keys", async () => {
    await page.keyboard.press("Meta+W");
    await expect(splits(page)).toHaveCount(2);
    await expect(typingInto(page, 0)).toBeFocused();
    await expect(screenOf(page, 1)).toContainText("below-5");
  });

  await test.step("⌘W on a split running a command asks first: Esc keeps it, Enter ends it", async () => {
    await page.locator(".terminal-pane .terminal-splits.shown .xterm").nth(1).click();
    await keepShellBusy(page, screenOf(page, 1));
    await page.keyboard.press("Meta+W");
    const confirm = page.getByRole("button", { name: "Confirm: Close terminal 2", exact: true });
    await expect(confirm).toBeFocused();
    await expect(confirm).toHaveAttribute("data-hint", new RegExp(`^${busyCommandName} runs in this terminal`));
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Close terminal 2", exact: true })).toBeVisible();
    await expect(splits(page)).toHaveCount(2);

    await page.locator(".terminal-pane .terminal-splits.shown .xterm").nth(1).click();
    await page.keyboard.press("Meta+W");
    await expect(confirm).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(splits(page)).toHaveCount(1);
  });

  await test.step("⌘W on the only terminal of a tab running a command arms the tab's close", async () => {
    await page.locator(".terminal-pane .terminal-splits.shown .xterm").click();
    await keepShellBusy(page, screenOf(page, 0));
    await page.keyboard.press("Meta+W");
    const closeTab = page.locator(".terminal-tab.active .close-tab");
    await expect(closeTab).toHaveText("Close?");
    await expect(closeTab).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(tabs(page)).toHaveCount(1);
  });

  await test.step("a middle-click closes a tab whose shells run nothing, and asks first when one runs a command", async () => {
    const newTab = page.getByRole("button", { name: "New terminal tab" });
    await newTab.click();
    await expect(tabs(page)).toHaveCount(2);
    await tabs(page).nth(1).click({ button: "middle" });
    await expect(tabs(page)).toHaveCount(1);

    await newTab.click();
    await expect(tabs(page)).toHaveCount(2);
    await page.locator(".terminal-pane .terminal-splits.shown .xterm").click();
    await page.keyboard.press("Meta+D");
    await expect(splits(page)).toHaveCount(2);
    await keepShellBusy(page, screenOf(page, 1));
    await tabs(page).nth(1).click({ button: "middle" });
    const closeTab = page.locator(".terminal-tab.active .close-tab");
    await expect(closeTab).toHaveText("Close?");
    await expect(closeTab).toHaveAttribute("data-hint", new RegExp(`^${busyCommandName} runs in this tab`));
    await expect(splits(page)).toHaveCount(2);
    await tabs(page).nth(1).click({ button: "middle" });
    await expect(tabs(page)).toHaveCount(1);
  });
});
