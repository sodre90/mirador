import { expect, test, type WebSocketRoute } from "@playwright/test";
import { signIn } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();

test.beforeAll(async () => {
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

test("a page loaded from an earlier run of the host loads again on the new run's first snapshot, before it reads it, so a field the new host reshaped can't crash it", async ({ page }) => {
  let toPage: WebSocketRoute | null = null;
  let firstSnapshot: Record<string, unknown> | null = null;
  await page.routeWebSocket(/\/ws\?/, (socket) => {
    const server = socket.connectToServer();
    server.onMessage((message) => {
      const parsed = JSON.parse(String(message)) as { type: string };
      if (parsed.type === "snapshot") firstSnapshot ??= parsed;
      socket.send(message);
    });
    toPage = socket;
  });
  await signIn(page, host);
  await expect(page.locator(".sidebar")).toBeVisible();
  await expect.poll(() => firstSnapshot).not.toBeNull();
  await page.evaluate(() => ((window as unknown as { loadedBefore: boolean }).loadedBefore = true));

  const reloaded = page.waitForEvent("load", { timeout: 15_000 });
  toPage!.send(JSON.stringify({ ...firstSnapshot!, hostRunId: "a newer run", conversations: { reshaped: true } }));
  await reloaded;

  expect(await page.evaluate(() => (window as unknown as { loadedBefore?: boolean }).loadedBefore)).toBeUndefined();
  await expect(page.locator(".sidebar")).toBeVisible();
});
