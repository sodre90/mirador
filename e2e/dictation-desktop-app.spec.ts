import { expect, test } from "@playwright/test";
import { addWorkspace, openSettings, signIn, startConversation, useOwnVoiceServer, voiceSection } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();

test.beforeAll(() => host.start());
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

test("inside the desktop app, a refused microphone says to allow it when the app asks and where the system allows it, and an app built without the microphone says to update it", async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    window.__electrobunSendToHost = (message) => {
      if (message.type === "desktop-nonce-request") setTimeout(() => window.dispatchEvent(new CustomEvent("mirador:desktop-nonce", { detail: "nonce-1" })));
    };
  });
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  await startConversation(page);
  const settings = await openSettings(page, "Voice");
  await useOwnVoiceServer(voiceSection(settings, "When you speak"), "Speech recognition", { url: "http://127.0.0.1:9/v1", model: "whisper-turbo" });
  await settings.getByRole("button", { name: "Close" }).click();
  const mic = page.locator(".composer:visible").getByRole("button", { name: "Dictate" });
  const problem = page.locator(".composer-area:visible .composer-problem");
  const status = page.locator(".composer-area:visible .dictation-status");

  await test.step("the user blocked the microphone in the app's dialog", async () => {
    await page.evaluate(() => {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("Permission denied", "NotAllowedError"));
    });
    await mic.click();
    const userAgent = await page.evaluate(() => navigator.userAgent);
    const systemSetting = userAgent.includes("Mac")
      ? " and in System Settings → Privacy & Security → Microphone"
      : userAgent.includes("Windows")
        ? " and in Windows Settings → Privacy & security → Microphone, which desktop apps need too"
        : "";
    await expect(problem).toHaveText(`Mirador may not use the microphone. Allow it when the desktop app asks${systemSetting}. Blocking it in the app holds until the app quits.`);
    await expect(status).toHaveCount(0);
  });

  await test.step("the macOS app was built without NSMicrophoneUsageDescription, so its webview offers no microphone", async () => {
    await page.evaluate(() => Object.defineProperty(Navigator.prototype, "mediaDevices", { get: () => undefined }));
    await mic.click();
    await expect(problem).toHaveText("This build of the desktop app can't use the microphone. Update or rebuild it, or dictate in a browser.");
    await expect(status).toHaveCount(0);
  });
});
