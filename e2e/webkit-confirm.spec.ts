import { devices, expect, test } from "@playwright/test";
import { actAsDesktopApp, addWorkspace, pressCommandWInTheApp, removeWorkspace, signIn, startConversation, workspaceCard } from "./helpers.ts";
import { keepShellBusy } from "./terminal-shell.ts";
import { jobControlShell, TestHost } from "./test-host.ts";

// The macOS desktop app's web view is WebKit, where pressing a button doesn't focus it: a confirm that has the focus loses it on
// mousedown. Only macOS WebKit does this; WebKitGTK focuses a pressed button, so on Linux these pass even without the fix.
// Chrome's channel and its audio flag don't apply to WebKit, and Safari's user agent is what the app reads in web/Devices.tsx.
const { defaultBrowserType: _, ...safari } = devices["Desktop Safari"];
test.use({ ...safari, browserName: "webkit", channel: "", launchOptions: {}, viewport: { width: 1600, height: 1000 } });

const host = new TestHost({ shell: jobControlShell });

test.beforeAll(() => host.start());
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

test("in WebKit, a second click on the workspace's trash confirms and removes the workspace", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const card = workspaceCard(page, host.projectDir);
  await removeWorkspace(card);
  await expect(card).toHaveCount(0);
});

test("in WebKit, a click on the confirm ⌘W raised on a busy terminal closes that shell", async ({ page }) => {
  await actAsDesktopApp(page, { nonce: "nonce-1", items: [] });
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  await startConversation(page);
  await page.getByRole("button", { name: "Show terminal" }).click();
  await page.getByRole("button", { name: "Split right" }).click();
  const splits = page.locator(".terminal-pane .terminal-split");
  await expect(splits).toHaveCount(2);
  await page.locator(".terminal-pane .xterm").nth(1).click();
  await keepShellBusy(page, page.locator(".terminal-pane .xterm-rows").nth(1));

  await pressCommandWInTheApp(page);
  const question = page.getByRole("button", { name: "Confirm: Close terminal 2", exact: true });
  await expect(question).toBeFocused();
  await question.click();
  await expect(splits).toHaveCount(1);
});
