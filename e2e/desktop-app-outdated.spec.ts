import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline";
import { expect, test } from "@playwright/test";
import { signIn, startDesktopNotifier } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();

test.beforeAll(() => host.start());
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

async function browserToken() {
  const signedIn = await fetch(host.authUrl, { redirect: "manual" });
  return signedIn.headers.get("set-cookie")!.split(";")[0]!.split("=")[1]!;
}

const checkoutCode = () => execFileSync("bun", ["shared/desktop-app-code.ts", "desktop"], { cwd: host.sourceDir, encoding: "utf8" }).trim();

/** Listens for notifications as a desktop app built from `builtFromCode` does, until killed. */
async function desktopAppBuiltFrom(builtFromCode: string) {
  const app = startDesktopNotifier(host.origin, await browserToken(), builtFromCode);
  const lines = createInterface({ input: app.stdout! })[Symbol.asyncIterator]();
  expect(String((await lines.next()).value)).toBe("connected");
  return app;
}

test("a desktop app built from older code than the checkout's shows a banner until it quits", async ({ page }) => {
  await signIn(page, host);
  const banner = page.locator(".banner.desktop-app-outdated");

  const currentApp = await desktopAppBuiltFrom(checkoutCode());
  await page.waitForTimeout(1_000);
  await expect(banner).toHaveCount(0);
  currentApp.kill();

  const oldApp = await desktopAppBuiltFrom("0123456789abcdef");
  await expect(banner).toHaveText("The Mirador app is older than its code. Quit it and run bun run build in desktop/.");
  await page.reload();
  await expect(banner).toBeVisible();

  oldApp.kill();
  await expect(banner).toHaveCount(0);
});
