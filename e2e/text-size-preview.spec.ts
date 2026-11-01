import { expect, test } from "@playwright/test";
import { addWorkspace, openSettings, sendMessage, signIn, startConversation } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();

test.beforeAll(() => host.start());
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

test("each Text size preview shows chat text at the size that step gives it, whole", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  await startConversation(page);
  await sendMessage(page, "How big is this text?");
  const chatTextSize = () => page.locator(".message.user").first().evaluate((message) => parseFloat(getComputedStyle(message).fontSize));
  const choice = (await openSettings(page, "Appearance")).getByRole("radiogroup", { name: "Text size" });
  for (const step of ["50%", "70%", "100%", "140%", "200%"]) {
    const option = choice.getByRole("radio", { name: step });
    await option.click();
    const sample = await option.locator(".preview-text-sample").evaluate((element) => {
      const box = element.getBoundingClientRect();
      const card = element.parentElement!.getBoundingClientRect();
      return { size: parseFloat(getComputedStyle(element).fontSize), whole: box.left >= card.left && box.right <= card.right && box.top >= card.top && box.bottom <= card.bottom };
    });
    expect(sample.size, `${step} sample against chat text at ${step}`).toBeCloseTo(await chatTextSize(), 1);
    expect(sample.whole, `${step} sample fits its card`).toBe(true);
  }
});
