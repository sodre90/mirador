import { expect, test } from "@playwright/test";
import { addWorkspace, callCanvasTool, signIn, startConversation } from "./helpers.ts";
import { TestHost } from "./test-host.ts";
import type { DesktopMenuMessage } from "../shared/desktop-menu.ts";

const host = new TestHost();

test.beforeAll(() => host.start());
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const pageWithLinks = `<body>
  <p><a href="https://example.invalid/docs">The docs</a></p>
  <p><a href="#below">Further down</a></p>
  <div style="height:2400px"></div>
  <p id="below">Down here</p>
</body>`;

test("a link to another site on a canvas page opens in the browser, from the desktop app too", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const conversationId = await startConversation(page);
  await callCanvasTool(host, conversationId, "show", { title: "Links", html: pageWithLinks });
  const canvasPage = () => page.locator(".canvas-panel:visible .canvas-frame.show iframe").contentFrame();

  await test.step("in the browser, it opens in a new tab", async () => {
    await page.context().route("https://example.invalid/docs", (route) => route.fulfill({ body: "The docs" }));
    const opened = page.context().waitForEvent("page");
    await canvasPage().getByRole("link", { name: "The docs" }).click();
    const tab = await opened;
    expect(tab.url()).toBe("https://example.invalid/docs");
    await tab.close();
  });

  await test.step("a link within the page still goes where it points there", async () => {
    await canvasPage().getByRole("link", { name: "Further down" }).click();
    await expect(canvasPage().locator("#below")).toBeInViewport();
  });

  await test.step("inside the desktop app, it opens in the browser through the app", async () => {
    await page.addInitScript(() => {
      const sent: DesktopMenuMessage[] = [];
      Object.assign(window, { sentToDesktopApp: sent });
      window.__electrobunSendToHost = (message) => {
        sent.push(message);
        if (message.type === "desktop-nonce-request") setTimeout(() => window.dispatchEvent(new CustomEvent("mirador:desktop-nonce", { detail: "nonce-1" })));
      };
    });
    await page.reload();
    const pagesBefore = page.context().pages().length;
    await canvasPage().getByRole("link", { name: "The docs" }).click();
    const openedLinks = async () =>
      (await page.evaluate(() => (window as unknown as { sentToDesktopApp: DesktopMenuMessage[] }).sentToDesktopApp)).filter(({ type }) => type === "desktop-open-link");
    await expect.poll(openedLinks).toEqual([{ type: "desktop-open-link", nonce: "nonce-1", url: "https://example.invalid/docs" }]);
    expect(page.context().pages()).toHaveLength(pagesBefore);
  });
});
