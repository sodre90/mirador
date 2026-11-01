import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, chooseInSettings, openSettings, primaryModifier, signIn, startConversation } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();

test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const fontScale = (page: Page) => page.evaluate(() => document.documentElement.style.getPropertyValue("--font-scale"));
const storedScale = (page: Page) => page.evaluate(() => localStorage.getItem("mirador-font-scale"));
const storedTerminalFontSize = (page: Page) =>
  page.evaluate(() => String(JSON.parse(localStorage.getItem("mirador-terminal-settings") ?? "{}").fontSize));
const headingFontSize = (page: Page) =>
  page.locator(".modal.settings h3").first().evaluate((element) => parseFloat(getComputedStyle(element).fontSize));

test("font size can be scaled from 50% to 200% in Settings and with keyboard shortcuts", async ({ page }) => {
  await signIn(page, host);
  const primary = await primaryModifier(page);

  await test.step("default scale is 100% (scale 1)", async () => {
    expect(await fontScale(page)).toBe("1");
  });

  await test.step("choosing 50% in Settings halves font sizes across chrome", async () => {
    const settings = await openSettings(page, "Appearance");
    const choice = settings.getByRole("radiogroup", { name: "Text size" });
    await choice.getByRole("radio", { name: "50%" }).click();
    expect(await fontScale(page)).toBe("0.5");
    expect(await storedScale(page)).toBe("50");
    expect(await headingFontSize(page)).toBeCloseTo(6.5, 0);

    await choice.getByRole("radio", { name: "200%" }).click();
    expect(await fontScale(page)).toBe("2");
    expect(await storedScale(page)).toBe("200");
    expect(await headingFontSize(page)).toBeCloseTo(26, 0);

    await choice.getByRole("radio", { name: "100%" }).click();
    expect(await fontScale(page)).toBe("1");
    expect(await storedScale(page)).toBe("100");
    expect(await headingFontSize(page)).toBeCloseTo(13, 0);
    await settings.getByRole("button", { name: "Close" }).click();
  });

  await test.step("scale survives page reload", async () => {
    await chooseInSettings(page, "Text size", "140%");
    expect(await fontScale(page)).toBe("1.4");
    expect(await storedScale(page)).toBe("140");

    await page.reload();
    expect(await fontScale(page)).toBe("1.4");
  });

  await test.step("keyboard shortcuts step UI font scale when terminal is not focused", async () => {
    // Current scale is 140%, stepping up reaches 200%
    await page.keyboard.press(`${primary}+Equal`);
    expect(await fontScale(page)).toBe("2");
    expect(await storedScale(page)).toBe("200");

    // Stepping up past 200% stays at 200%
    await page.keyboard.press(`${primary}+Equal`);
    expect(await fontScale(page)).toBe("2");

    // Stepping down goes 140% -> 100% -> 70% -> 50%
    await page.keyboard.press(`${primary}+Minus`);
    expect(await fontScale(page)).toBe("1.4");
    await page.keyboard.press(`${primary}+Minus`);
    expect(await fontScale(page)).toBe("1");
    await page.keyboard.press(`${primary}+Minus`);
    expect(await fontScale(page)).toBe("0.7");
    await page.keyboard.press(`${primary}+Minus`);
    expect(await fontScale(page)).toBe("0.5");

    // Stepping down past 50% stays at 50%
    await page.keyboard.press(`${primary}+Minus`);
    expect(await fontScale(page)).toBe("0.5");

    // 0 resets to 100%
    await page.keyboard.press(`${primary}+Digit0`);
    expect(await fontScale(page)).toBe("1");
    expect(await storedScale(page)).toBe("100");
  });

  await test.step("terminal font size is adjusted independently in Settings", async () => {
    const settings = await openSettings(page, "Terminal");
    const select = settings.getByLabel("Font size");
    await expect(select).toHaveValue("12");

    await select.selectOption("16");
    expect(await storedTerminalFontSize(page)).toBe("16");
    await settings.getByRole("button", { name: "Close" }).click();
  });

  await test.step("keyboard shortcuts target terminal font when terminal is focused", async () => {
    await addWorkspace(page, host.projectDir);
    await startConversation(page);
    await page.getByRole("button", { name: "Show terminal" }).click();

    const terminal = page.locator(".terminal-pane .xterm");
    await terminal.click();

    // Stored terminal font size is 16, stepping up increases it to 17
    await page.keyboard.press(`${primary}+Equal`);
    expect(await storedTerminalFontSize(page)).toBe("17");
    // UI font scale was not affected
    expect(await fontScale(page)).toBe("1");

    // Stepping down decreases it back to 16
    await page.keyboard.press(`${primary}+Minus`);
    expect(await storedTerminalFontSize(page)).toBe("16");
    expect(await fontScale(page)).toBe("1");

    // Resetting restores terminal default (12 px)
    await page.keyboard.press(`${primary}+Digit0`);
    expect(await storedTerminalFontSize(page)).toBe("12");
    expect(await fontScale(page)).toBe("1");
  });
});
