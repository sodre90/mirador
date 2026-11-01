import { expect, test, type Locator } from "@playwright/test";
import { addWorkspace, signIn, startConversation } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();

test.use({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36" });
test.beforeAll(() => host.start());
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const selectionOf = (composer: Locator) => composer.evaluate((box: HTMLTextAreaElement) => [box.selectionStart, box.selectionEnd]);
const putCaret = (composer: Locator, at: number) => composer.evaluate((box: HTMLTextAreaElement, offset) => box.setSelectionRange(offset, offset), at);

test("on macOS, Home and End (fn+← and fn+→) move to the start and end of the line in the message box, and Shift selects", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  await startConversation(page);
  const composer = page.locator(".composer textarea");
  const first = "first line";
  const long = Array.from({ length: 40 }, (_, index) => `word${index}`).join(" ");
  await composer.fill(`${first}\nsecond line\n${long}`);
  const secondStart = first.length + 1;
  const longStart = secondStart + "second line".length + 1;

  await test.step("on a line that fits, Home goes to its start and End to its end", async () => {
    await putCaret(composer, secondStart + 4);
    await composer.press("Home");
    expect(await selectionOf(composer)).toEqual([secondStart, secondStart]);
    await composer.press("End");
    expect(await selectionOf(composer)).toEqual([longStart - 1, longStart - 1]);
    await composer.press("Shift+Home");
    expect(await selectionOf(composer)).toEqual([secondStart, longStart - 1]);
  });

  await test.step("on a line that wraps, they stop at the start and end of the line on screen", async () => {
    const end = longStart + long.length;
    await putCaret(composer, end);
    await composer.press("Home");
    const [lineStart] = await selectionOf(composer);
    expect(lineStart).toBeGreaterThan(longStart);
    expect(lineStart).toBeLessThan(end);
    expect((await composer.inputValue())[lineStart! - 1]).toBe(" ");
    await putCaret(composer, longStart);
    await composer.press("End");
    const [lineEnd] = await selectionOf(composer);
    expect(lineEnd).toBeGreaterThan(longStart);
    expect(lineEnd).toBeLessThan(end);
  });
});
