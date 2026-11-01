import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, signIn, startConversation } from "./helpers.ts";
import { echo, sum } from "./terminal-shell.ts";
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

const screen = (page: Page) => page.locator(".terminal-pane .xterm-rows");
const findBar = (page: Page) => page.locator(".terminal-pane .terminal-find");
const tally = (page: Page) => findBar(page).locator(".find-tally");
/** One per match, and the current match's drawn again over it with an outline. */
const highlights = (page: Page) => page.locator(".terminal-pane .xterm-find-result-decoration");

/** Four lines to find in; the command that prints them does not contain the word itself. */
const printFourLines =
  process.platform === "win32" ? `$w='rror'; "e$w one"; "E$w two"; "te$w three"; "e$w four"` : `w=rror; printf "e$w one\\nE$w two\\nte$w three\\ne$w four\\n"`;

async function openTerminalWithLines(page: Page, host: TestHost) {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  await startConversation(page);
  await page.getByRole("button", { name: "Show terminal" }).click();
  await page.locator(".terminal-pane .xterm").click();
  await page.keyboard.type(`${printFourLines}\n`);
  await expect(screen(page)).toContainText("error four");
}

test.describe("on macOS", () => {
  test.use({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36" });
  const host = useHost();

  test("⌘F finds in the terminal's output, with match case, whole word and regular expression, and Esc gives the keys back to the shell", async ({ page }) => {
    await openTerminalWithLines(page, host);
    await page.keyboard.press("Meta+F");
    const query = findBar(page).getByLabel("Find in this terminal");
    await expect(query).toBeFocused();
    await expect(page.locator(".find-bar")).toHaveCount(0);

    await query.fill("error");
    await expect(tally(page)).toHaveText("4 of 4");
    await expect(highlights(page)).toHaveCount(5);
    await expect(highlights(page).and(page.locator('[style*="outline"]'))).toHaveCount(1);
    await query.press("Enter");
    await expect(tally(page)).toHaveText("3 of 4");
    await query.press("Shift+Enter");
    await expect(tally(page)).toHaveText("4 of 4");

    await test.step("the toggles narrow the matches and leave the caret in the query", async () => {
      await findBar(page).getByRole("button", { name: "Match case" }).click();
      await expect(tally(page)).toHaveText("3 of 3");
      await expect(query).toBeFocused();
      await findBar(page).getByRole("button", { name: "Match whole word" }).click();
      await expect(tally(page)).toHaveText("2 of 2");
      await findBar(page).getByRole("button", { name: "Use regular expression" }).click();
      await query.fill("e(");
      await expect(tally(page)).toHaveText("Invalid pattern");
      await query.fill("error (one|two)");
      await expect(tally(page)).toHaveText("1 of 1");
      await query.fill("nothing like it");
      await expect(tally(page)).toHaveText("No matches");
    });

    await test.step("⌘F again selects the query rather than opening the conversation's find, and ⌘⇧← still selects text in it", async () => {
      await query.press("Meta+F");
      await expect(page.locator(".find-bar")).toHaveCount(0);
      await page.keyboard.type("four");
      await expect(query).toHaveValue("four");
      await query.press("Meta+Shift+ArrowLeft");
      await expect(query).toBeFocused();
    });

    await test.step("⌘F from the shell, with the bar still open, takes the very next keys to the query", async () => {
      await page.locator(".terminal-pane .xterm").click();
      await expect(query).not.toBeFocused();
      await page.keyboard.press("Meta+F");
      await page.keyboard.type("three");
      await expect(query).toHaveValue("three");
    });

    await query.press("Escape");
    await expect(findBar(page)).toHaveCount(0);
    await expect(highlights(page)).toHaveCount(0);
    await page.keyboard.type(`${echo(`back-${sum("1+1")}`)}\n`);
    await expect(screen(page)).toContainText("back-2");
  });
});

test.describe("on Linux", () => {
  test.use({ userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36" });
  const host = useHost();

  test("Ctrl+Shift+F finds in the terminal, as in GNOME Terminal, rather than searching every workspace", async ({ page }) => {
    await openTerminalWithLines(page, host);
    await page.keyboard.press("Control+Shift+F");
    await expect(findBar(page).getByLabel("Find in this terminal")).toBeFocused();
    await expect(page.getByRole("dialog", { name: "Search all workspaces" })).toHaveCount(0);
    await page.keyboard.type("error");
    await expect(tally(page)).toHaveText("4 of 4");
  });
});
