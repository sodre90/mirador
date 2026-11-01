import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, signIn, startConversation, workspaceCard } from "./helpers.ts";
import { countTo, echo, printRaw, promptMark, showKeys, sum } from "./terminal-shell.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();

test.beforeAll(() => host.start());
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const screens = (page: Page) => page.locator(".terminal-pane .terminal-splits.shown .xterm-rows");
const screenOf = (page: Page, index: number) => screens(page).nth(index);
const terminalToggle = (page: Page, name: "Show terminal" | "Hide terminal") => page.locator(".chat-header:visible").getByRole("button", { name });

/** Shown again, the pane mounts its terminals afresh, and they replay their history. */
async function hideTerminalPane(page: Page) {
  await terminalToggle(page, "Hide terminal").click();
  await expect(page.locator(".terminal-pane")).toHaveCount(0);
}

/** What a program asks its terminal: where the cursor is, and what colour the background is. */
const queries = "\x1b[6n\x1b]11;?\x07";
const cursorPositionAnswer = /\[\d+;\d+R/;
const backgroundColourAnswer = /rgb:/;

test("replaying a terminal's log does not answer the questions in it as though the user had typed the answers", async ({ page }) => {
  test.skip(process.platform === "win32", "Windows' console answers a program's questions itself and passes none on, so a terminal's log there has none to replay");
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  await startConversation(page);
  await page.getByRole("button", { name: "Show terminal" }).click();
  const terminal = page.locator(".terminal-pane .terminal-splits.shown .xterm");
  await expect(terminal).toHaveCount(1);

  const query = join(host.projectDir, "query");
  const reading = join(host.projectDir, "reading");
  await terminal.click();
  await page.keyboard.type(`while [ ! -f ${query} ]; do sleep 0.2; done; cat ${query}; echo REBUILT-FROM-LOG; stty raw -echo; touch ${reading}; cat -v\n`);

  await hideTerminalPane(page);
  writeFileSync(query, queries);
  await expect.poll(() => existsSync(reading)).toBe(true);

  await terminalToggle(page, "Show terminal").click();
  await expect(screenOf(page, 0)).toContainText("REBUILT-FROM-LOG");
  await terminal.click();
  await page.keyboard.type("MARKER\n");
  await expect(screenOf(page, 0)).toContainText("MARKER");

  const shown = (await screenOf(page, 0).textContent())!;
  expect(shown).not.toMatch(cursorPositionAnswer);
  expect(shown).not.toMatch(backgroundColourAnswer);

  await test.step("a question a program asks now, on a terminal the reader is looking at, is still answered", async () => {
    await page.getByRole("button", { name: "New terminal tab" }).click();
    await expect(page.getByRole("tab", { name: "sh 2" })).toHaveAttribute("aria-selected", "true");
    await page.locator(".terminal-pane .terminal-splits.shown .xterm").click();
    await page.keyboard.type(`stty raw -echo; cat ${query}; cat -v\n`);
    await expect(screenOf(page, 0)).toContainText(cursorPositionAnswer);
  });
});

type PasteDuringReplay = { terminalId: string; text: string };

/** Pastes into a terminal right after the page takes its replayed history, before the terminal has parsed any of it. */
async function pasteWhileReplaying(page: Page) {
  await page.addInitScript(() => {
    const armed = window as unknown as { pasteDuringReplay?: PasteDuringReplay };
    const pasteIfReplayed = (event: MessageEvent) => {
      const paste = armed.pasteDuringReplay;
      const message = typeof event.data === "string" ? JSON.parse(event.data) : null;
      if (!paste || message?.type !== "terminal.replayed" || message.terminalId !== paste.terminalId) return;
      delete armed.pasteDuringReplay;
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", paste.text);
      const textarea = document.querySelector(`[data-terminal-id="${paste.terminalId}"] .xterm-helper-textarea`)!;
      textarea.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
    };
    const onmessage = Object.getOwnPropertyDescriptor(WebSocket.prototype, "onmessage")!;
    Object.defineProperty(WebSocket.prototype, "onmessage", {
      ...onmessage,
      set(this: WebSocket, handler: ((event: MessageEvent) => void) | null) {
        onmessage.set!.call(this, handler && ((event: MessageEvent) => (handler.call(this, event), pasteIfReplayed(event))));
      },
    });
  });
  return (paste: PasteDuringReplay) => page.evaluate((armed) => Object.assign(window, { pasteDuringReplay: armed }), paste);
}

test("what the user pastes or types while a terminal's history replays reaches the shell", async ({ page }) => {
  const armPaste = await pasteWhileReplaying(page);
  await signIn(page, host);
  const addProject = page.getByRole("button", { name: "+ Add a project directory" });
  await expect(addProject.or(workspaceCard(page, host.projectDir))).toBeVisible();
  if (await addProject.isVisible()) await addWorkspace(page, host.projectDir);
  await startConversation(page);
  await page.getByRole("button", { name: "Show terminal" }).click();
  const tabs = page.getByRole("tab");
  await page.getByRole("button", { name: "New terminal tab" }).click();
  await expect(tabs).toHaveCount(2);
  await expect(tabs.last()).toHaveAttribute("aria-selected", "true");
  await expect(screenOf(page, 0)).toContainText(promptMark);
  const terminalId = (await page.locator(".terminal-pane .terminal-splits.shown .terminal-split").getAttribute("data-terminal-id"))!;

  await hideTerminalPane(page);
  await armPaste({ terminalId, text: `${echo(`pasted-${sum("6*7")}`)}\n` });
  await terminalToggle(page, "Show terminal").click();
  await expect(tabs.last()).toHaveAttribute("aria-selected", "true");
  await expect(screenOf(page, 0)).toContainText("pasted-42");
});

test("a full-screen program's arrow keys still reach it after its terminal replays more output than the scrollback keeps", async ({ page }) => {
  test.skip(process.platform === "win32", "Windows' console keeps a program's cursor key mode to itself, so the terminal sends ^[[A for the up arrow before a replay too");
  await signIn(page, host);
  const addProject = page.getByRole("button", { name: "+ Add a project directory" });
  await expect(addProject.or(workspaceCard(page, host.projectDir))).toBeVisible();
  if (await addProject.isVisible()) await addWorkspace(page, host.projectDir);
  await startConversation(page);
  await page.getByRole("button", { name: "Show terminal" }).click();
  await expect(screenOf(page, 0)).toContainText(promptMark);
  const terminal = page.locator(".terminal-pane .terminal-splits.shown .xterm");
  const row = (text: string) => screenOf(page, 0).locator(":scope > div").filter({ hasText: new RegExp(`^\\s*${text}\\s*$`) });

  await terminal.click();
  await page.keyboard.type(`${[printRaw("\x1b[?1h"), countTo(60000), showKeys("arrows-ready")].join("; ")}\n`);
  await expect(row("arrows-ready")).toHaveCount(1);

  await hideTerminalPane(page);
  await terminalToggle(page, "Show terminal").click();
  await expect(row("arrows-ready")).toHaveCount(1);
  await terminal.click();
  await page.keyboard.press("ArrowUp");
  await expect(screenOf(page, 0)).toContainText("^[OA");
  await expect(screenOf(page, 0)).not.toContainText("^[[A");
});

test.describe("on macOS", () => {
  test.use({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36" });

  test("on macOS, a colour ⌘K cleared in the middle of its sequence comes back whole after a replay, not as text", async ({ page }) => {
    test.skip(process.platform === "win32", "Windows' console keeps the cleared lines and paints them again at the reload's resize (vcs-pgm.44)");
    await signIn(page, host);
    const addProject = page.getByRole("button", { name: "+ Add a project directory" });
    await expect(addProject.or(workspaceCard(page, host.projectDir))).toBeVisible();
    if (await addProject.isVisible()) await addWorkspace(page, host.projectDir);
    await startConversation(page);
    await page.getByRole("button", { name: "Show terminal" }).click();
    await expect(screenOf(page, 0)).toContainText(promptMark);
    const terminal = page.locator(".terminal-pane .terminal-splits.shown .xterm");
    const redText = screenOf(page, 0).locator(".xterm-fg-1", { hasText: "red-text" });

    await terminal.click();
    await page.keyboard.type(`${printRaw("\x1b[3\n1mred-text")}\n`);
    await expect(redText).toBeVisible();
    await page.keyboard.press("Meta+K");
    await expect(screenOf(page, 0)).not.toContainText(printRaw("\x1b[3\n1mred-text"));

    await hideTerminalPane(page);
    await terminalToggle(page, "Show terminal").click();
    await expect(redText).toBeVisible();
    await expect(screenOf(page, 0)).not.toContainText("1mred-text");
  });
});
