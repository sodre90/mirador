import { expect, test } from "@playwright/test";
import { addWorkspace, signIn, startConversation } from "./helpers.ts";
import { echo, sum } from "./terminal-shell.ts";
import { TestHost } from "./test-host.ts";

/** On macOS /bin/sh is bash; on Linux it is often dash, which has no line editing. */
const lineEditingShell = process.platform === "darwin" ? "/bin/sh" : "/bin/bash";

function useHost() {
  const host = new TestHost({ shell: lineEditingShell });
  test.beforeAll(() => host.start());
  test.afterAll(async () => {
    await host.stop();
    await host.cleanUp();
  });
  return host;
}

test.describe("on macOS", () => {
  test.use({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36" });
  const host = useHost();

  test("on macOS, ⌘K clears the terminal for good, and ⌘←, ⌘→, ⌘⌫, ⌥← and ⌥→ edit the line as in Terminal.app", async ({ page }) => {
    await signIn(page, host);
    await addWorkspace(page, host.projectDir);
    await startConversation(page);
    const palette = page.getByRole("dialog", { name: "Palette" });
    await page.locator(".composer textarea").press("Meta+K");
    await expect(palette).toBeVisible();
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Show terminal" }).click();
    const screen = page.locator(".terminal-pane .xterm-rows");
    await page.locator(".terminal-pane .xterm").click();
    await page.keyboard.type(`${echo(`cleared-${sum("1+1")}`)}\n`);
    await expect(screen).toContainText("cleared-2");
    await page.keyboard.press("Meta+K");
    await expect(screen).not.toContainText("cleared-2");
    await expect(palette).toHaveCount(0);

    await test.step("⌘←, ⌘→, ⌘⌫, ⌥← and ⌥→ edit the line as in Terminal.app", async (step) => {
      step.skip(process.platform === "win32", "They send readline's keys, which PowerShell's PSReadLine reads otherwise (vcs-pgm.42)");
      await page.keyboard.type("cho line-$((2+3))");
      await page.keyboard.press("Meta+ArrowLeft");
      await page.keyboard.type("e");
      await page.keyboard.press("Meta+ArrowRight");
      await page.keyboard.type(" end\n");
      await expect(screen).toContainText("line-5 end");

      await page.keyboard.type("not a command");
      await page.keyboard.press("Meta+Backspace");
      await page.keyboard.type("echo wiped-$((3+3))\n");
      await expect(screen).toContainText("wiped-6");
      await expect(screen).not.toContainText("not: command not found");

      await page.keyboard.type("echo $((4+4)) beta gamma");
      await page.keyboard.press("Alt+ArrowLeft");
      await page.keyboard.press("Alt+ArrowLeft");
      await page.keyboard.type("X");
      await page.keyboard.press("Alt+ArrowRight");
      await page.keyboard.type("Y\n");
      await expect(screen).toContainText("8 XbetaY gamma");
    });

    await test.step("the clear lasts through a reload", async (step) => {
      step.skip(process.platform === "win32", "Windows' console keeps the cleared lines and paints them again at the reload's resize (vcs-pgm.44)");
      await page.reload();
      await expect(screen).toContainText("8 XbetaY gamma");
      await expect(screen).not.toContainText("cleared-2");
    });
  });
});

test.describe("on Linux", () => {
  test.skip(process.platform !== "linux", "Ctrl+Shift+V pastes through the browser's own Linux key binding");
  const host = useHost();

  test("Ctrl+Shift+C copies the terminal's selection and Ctrl+Shift+V pastes, as in GNOME Terminal", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await signIn(page, host);
    await addWorkspace(page, host.projectDir);
    await startConversation(page);
    await page.getByRole("button", { name: "Show terminal" }).click();
    const screen = page.locator(".terminal-pane .xterm-rows");
    await page.locator(".terminal-pane .xterm").click();
    await page.keyboard.type("echo copy-$((5+5))\n");
    await expect(screen).toContainText("copy-10");

    const row = (await screen.locator(":scope > div", { hasText: /^copy-10\s*$/ }).boundingBox())!;
    await page.mouse.dblclick(row.x + 20, row.y + row.height / 2);
    await page.keyboard.press("Control+Shift+C");
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("copy-10");

    await page.keyboard.type("echo pasted-");
    await page.keyboard.press("Control+Shift+V");
    await page.keyboard.press("Enter");
    await expect(screen).toContainText("pasted-copy-10");
  });
});
