import { expect, test, type Locator } from "@playwright/test";
import { addWorkspace, openSettings, signIn, startConversation } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const LINUX = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

test.beforeAll(() => host.start());
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

async function expectTypingAids(field: Locator, autocorrect: "on" | "off", writingSuggestions: "true" | "false") {
  await expect(field).toHaveAttribute("autocorrect", autocorrect);
  await expect(field).toHaveAttribute("writingsuggestions", writingSuggestions);
}

test.describe("on macOS", () => {
  test.use({ userAgent: MAC });

  test("autocorrect and inline predictions are off until switched on in Settings, and never reach the terminal", async ({ page }) => {
    await signIn(page, host);
    await addWorkspace(page, host.projectDir);
    await startConversation(page);
    const composer = page.locator(".composer textarea");
    const terminalInput = page.locator(".terminal-pane .xterm-helper-textarea");
    await page.getByRole("button", { name: "Show terminal" }).click();

    await expectTypingAids(composer, "off", "false");
    await expectTypingAids(terminalInput, "off", "false");

    const settings = await openSettings(page, "Conversations");
    await settings.getByRole("checkbox", { name: "Correct spelling automatically" }).check();
    await settings.getByRole("checkbox", { name: "Inline predictions" }).check();
    await page.keyboard.press("Escape");
    await expectTypingAids(composer, "on", "true");

    await page.reload();
    await expectTypingAids(composer, "on", "true");
    await expectTypingAids(terminalInput, "off", "false");

    await openSettings(page, "Conversations");
    await settings.getByRole("checkbox", { name: "Inline predictions" }).uncheck();
    await expectTypingAids(composer, "on", "false");
  });
});

test.describe("elsewhere", () => {
  test.use({ userAgent: LINUX });

  test("Settings offer no macOS typing switches", async ({ page }) => {
    await signIn(page, host);
    const settings = await openSettings(page, "Conversations");
    await expect(settings.getByRole("heading", { name: "Prompt templates" })).toBeVisible();
    await expect(settings.getByRole("heading", { name: "Typing" })).toHaveCount(0);
  });
});
