import { expect, test, type Page } from "@playwright/test";
import type { DesktopMenuMessage } from "../shared/desktop-menu.ts";
import { addWorkspace, primaryModifier, signIn, startConversation } from "./helpers.ts";
import { echo, printRaw, sum } from "./terminal-shell.ts";
import { TestHost } from "./test-host.ts";

function useHost() {
  const host = new TestHost();
  test.beforeAll(() => host.start());
  test.afterAll(async () => {
    await host.stop();
    await host.cleanUp();
  });
  return host;
}

const PLAIN_ADDRESS = "https://example.com/plain-2";
const HYPERLINK_ADDRESS = "https://example.com/hyperlink";
const terminal = (page: Page) => page.locator(".terminal-pane .xterm");

/** A web address written out, and an OSC 8 hyperlink that shows only its text; the commands that print them show neither as printed. */
async function openTerminalWithLinks(page: Page, host: TestHost) {
  await page.context().route("https://example.com/**", (route) => route.fulfill({ contentType: "text/html", body: "opened" }));
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  await startConversation(page);
  await page.getByRole("button", { name: "Show terminal" }).click();
  await terminal(page).click();
  await page.keyboard.type(`${echo(`https://example.com/plain-${sum("1+1")}`)}\n`);
  await page.keyboard.type(`${printRaw(`\x1b]8;;${HYPERLINK_ADDRESS}\x1b\\the docs\x1b]8;;\x1b\\\n`)}\n`);
  const screen = page.locator(".terminal-pane .xterm-rows");
  await expect(screen).toContainText("the docs");
  const pointInto = async (line: RegExp) => {
    const row = (await screen.locator(":scope > div", { hasText: line }).boundingBox())!;
    return { x: row.x + 20, y: row.y + row.height / 2 };
  };
  return { plainAddress: await pointInto(/^https:\/\/example\.com\/plain-2\s*$/), hyperlink: await pointInto(/^the\sdocs\s*$/) };
}

async function clickWith(page: Page, modifier: string | null, { x, y }: { x: number; y: number }) {
  await page.mouse.move(x, y);
  if (modifier) await page.keyboard.down(modifier);
  await page.mouse.click(x, y);
  if (modifier) await page.keyboard.up(modifier);
}

async function expectToOpenNothing(page: Page, click: () => Promise<void>) {
  await click();
  await page.waitForTimeout(300);
  expect(page.context().pages()).toHaveLength(1);
}

async function expectToOpenInANewTab(page: Page, address: string, click: () => Promise<void>) {
  const opening = page.context().waitForEvent("page");
  await click();
  const opened = await opening;
  await expect(opened).toHaveURL(address);
  await opened.close();
}

test.describe("on Linux", () => {
  test.use({ userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36" });
  const host = useHost();

  test("Ctrl+click opens a web address or a hyperlink a terminal shows in a new tab, as in Konsole; a plain or ⌘-click leaves it to the terminal", async ({ page }) => {
    const { plainAddress, hyperlink } = await openTerminalWithLinks(page, host);

    await page.mouse.move(plainAddress.x, plainAddress.y);
    await expect(terminal(page)).toHaveAttribute("title", "Ctrl+click to open the link in your browser.");
    await page.mouse.move(plainAddress.x, plainAddress.y - 200);
    await expect(terminal(page)).not.toHaveAttribute("title");

    await expectToOpenNothing(page, () => clickWith(page, null, plainAddress));
    await expectToOpenNothing(page, () => clickWith(page, "Meta", plainAddress));
    await expectToOpenNothing(page, () => clickWith(page, null, hyperlink));
    await expectToOpenInANewTab(page, PLAIN_ADDRESS, () => clickWith(page, "Control", plainAddress));
    await expectToOpenInANewTab(page, HYPERLINK_ADDRESS, () => clickWith(page, "Control", hyperlink));
  });
});

test.describe("on macOS", () => {
  test.use({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36" });
  const host = useHost();

  test("⌘-click opens a web address or a hyperlink a terminal shows in a new tab; a plain or Ctrl+click leaves it to the terminal", async ({ page }) => {
    const { plainAddress, hyperlink } = await openTerminalWithLinks(page, host);

    await page.mouse.move(hyperlink.x, hyperlink.y);
    await expect(terminal(page)).toHaveAttribute("title", "⌘-click to open the link in your browser.");

    await expectToOpenNothing(page, () => clickWith(page, null, plainAddress));
    await expectToOpenNothing(page, () => clickWith(page, "Control", hyperlink));
    await expectToOpenInANewTab(page, PLAIN_ADDRESS, () => clickWith(page, "Meta", plainAddress));
    await expectToOpenInANewTab(page, HYPERLINK_ADDRESS, () => clickWith(page, "Meta", hyperlink));
  });
});

test.describe("inside the desktop app", () => {
  const host = useHost();

  test("a terminal's links open in the browser when the page asks the app with its nonce", async ({ page }) => {
    await page.addInitScript(() => {
      const sent: DesktopMenuMessage[] = [];
      Object.assign(window, { sentToDesktopApp: sent });
      window.__electrobunSendToHost = (message) => {
        sent.push(message);
        if (message.type === "desktop-nonce-request") setTimeout(() => window.dispatchEvent(new CustomEvent("mirador:desktop-nonce", { detail: "nonce-1" })));
      };
    });
    const openedLinks = async () =>
      (await page.evaluate(() => (window as unknown as { sentToDesktopApp: DesktopMenuMessage[] }).sentToDesktopApp)).filter(({ type }) => type === "desktop-open-link");
    const { plainAddress, hyperlink } = await openTerminalWithLinks(page, host);
    const modifier = await primaryModifier(page);

    await clickWith(page, null, plainAddress);
    await clickWith(page, modifier, plainAddress);
    await clickWith(page, modifier, hyperlink);

    await expect.poll(openedLinks).toHaveLength(2);
    expect(await openedLinks()).toEqual([
      { type: "desktop-open-link", nonce: "nonce-1", url: PLAIN_ADDRESS },
      { type: "desktop-open-link", nonce: "nonce-1", url: HYPERLINK_ADDRESS },
    ]);
    expect(page.context().pages()).toHaveLength(1);
  });
});
