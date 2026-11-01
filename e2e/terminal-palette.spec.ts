import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, callCanvasTool, primaryModifier, signIn, startConversation } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();

test.describe.configure({ mode: "serial" });
test.beforeAll(() => host.start());
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const terminalPane = (page: Page) => page.locator(".terminal-pane");
const tabs = (page: Page) => terminalPane(page).getByRole("tab");
const splits = (page: Page) => page.locator(".terminal-pane .terminal-splits.shown .terminal-split");
const terminalHasFocus = (page: Page) => page.evaluate(() => Boolean(document.activeElement?.closest(".terminal-pane .terminal-splits.shown .xterm")));
const focusMessageBox = (page: Page) => page.locator(".composer textarea:visible").click();

/** From the sidebar's button: a macOS terminal keeps ⌘K to clear itself, and a fullscreen pane covers the message box. */
async function runFromPalette(page: Page, label: string) {
  await page.locator(".sidebar").getByRole("button", { name: /^Palette/ }).click();
  await page.getByPlaceholder(/Go to a conversation/).fill(label);
  await page.keyboard.press("Enter");
}

test("keys and the palette show, hide, open, split, focus and fullscreen the terminal", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  await startConversation(page);
  await expect(terminalPane(page)).toHaveCount(0);

  await page.keyboard.press("Control+Backquote");
  await expect(tabs(page)).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Hide terminal" })).toHaveAttribute("data-shortcut", /`/);
  await page.keyboard.press("Control+Backquote");
  await expect(terminalPane(page)).toHaveCount(0);

  await runFromPalette(page, "New terminal tab");
  await expect(tabs(page)).toHaveCount(2);
  await expect(tabs(page).nth(1)).toHaveAttribute("aria-selected", "true");
  await runFromPalette(page, "Split the terminal right");
  await expect(splits(page)).toHaveCount(2);

  await focusMessageBox(page);
  await page.keyboard.press(`${await primaryModifier(page)}+Shift+ArrowDown`);
  await expect.poll(() => terminalHasFocus(page)).toBe(true);
  await runFromPalette(page, "Focus the terminal");
  await expect.poll(() => terminalHasFocus(page)).toBe(true);

  await runFromPalette(page, "Fullscreen terminals");
  await expect(page.locator('[data-pane="terminals"]')).toHaveClass(/fullscreen/);
  await page.locator(".terminal-pane .terminal-splits.shown .xterm").first().click();
  await page.keyboard.press(`${await primaryModifier(page)}+Shift+ArrowLeft`);
  await expect(page.locator('[data-pane="terminals"]')).not.toHaveClass(/fullscreen/);
  await expect(page.locator(".composer textarea:visible")).toBeFocused();

  await runFromPalette(page, "Fullscreen conversation");
  await expect(page.locator('[data-pane="conversation"]')).toHaveClass(/fullscreen/);
  await runFromPalette(page, "Exit fullscreen");
  await expect(page.locator('[data-pane="conversation"]')).not.toHaveClass(/fullscreen/);
});

test("a canvas page cannot open, show, hide or focus a terminal, by the websocket or by keys it makes up", async ({ page }) => {
  await signIn(page, host);
  const conversationId = await startConversation(page);
  const hostile = `<h1>hostile</h1>
<script>
  const socket = new WebSocket("ws://127.0.0.1:${host.port}/ws");
  socket.onopen = () => socket.send(JSON.stringify({ type: "terminal.open", requestId: "r", conversationId: "${conversationId}", split: null, columns: 80, rows: 24 }));
  const press = (code, modifiers) =>
    parent.postMessage({ source: "mirador-canvas", itemId: "x", kind: "key", key: "", code, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, typing: false, ...modifiers }, "*");
  addEventListener("click", () => {
    press("Backquote", { ctrlKey: true });
    press("ArrowDown", { metaKey: true, shiftKey: true });
    press("ArrowDown", { ctrlKey: true, shiftKey: true });
  });
</script>`;
  expect(await callCanvasTool(host, conversationId, "show", { title: "Hostile", html: hostile })).toContain("connect-src");
  const hostilePage = page.locator(".canvas-panel:visible .canvas-frame.show iframe").contentFrame().getByRole("heading", { name: "hostile" });

  await test.step("with the terminal hidden, its keys from the page leave it hidden", async () => {
    await hostilePage.click();
    await page.waitForTimeout(1_000);
    await expect(terminalPane(page)).toHaveCount(0);
  });

  await test.step("with the terminal shown, its keys from the page neither hide it nor move the keyboard into it", async () => {
    await page.getByRole("button", { name: "Show terminal" }).click();
    await expect(tabs(page)).toHaveCount(1);
    await hostilePage.click();
    await page.waitForTimeout(1_000);
    await expect(terminalPane(page)).toBeVisible();
    expect(await terminalHasFocus(page)).toBe(false);
    await expect(tabs(page)).toHaveCount(1);
  });
});
