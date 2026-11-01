import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, openSettings, signIn, startConversation } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();

test.beforeAll(() => host.start());
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const storedSettings = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("mirador-terminal-settings") ?? "{}"));

const rowsStyle = (page: Page, cssProperty: string) =>
  page.locator(".terminal-pane .xterm-rows").evaluate((rows, cssProperty) => getComputedStyle(rows).getPropertyValue(cssProperty), cssProperty);

/** xterm keeps the drawn spacing as cell width minus glyph width, so deltas of this show the letter spacing option at work. */
const letterSpacingOf = async (page: Page) => parseFloat(await rowsStyle(page, "letter-spacing"));

/** xterm draws each line as a div of the measured cell height, so a row's line height shows the line height option at work. */
const lineHeightOf = async (page: Page) =>
  parseFloat(await page.locator(".terminal-pane .xterm-rows > div").first().evaluate((row) => getComputedStyle(row).lineHeight));

const terminalBackgroundOf = async (page: Page) =>
  page.locator(".terminal-pane .terminal-view").first().evaluate((view) => getComputedStyle(view).backgroundColor);

const showTerminal = async (page: Page) => {
  const toggle = page.locator(".chat-header:visible").getByRole("button", { name: "Show terminal" });
  if (await toggle.count()) await toggle.click();
  await expect(page.locator(".terminal-pane .xterm-rows")).toBeVisible();
};

const DEFAULTS = {
  preset: "default",
  fontFamily: "",
  fontSize: 12,
  lineHeight: 1,
  letterSpacing: 0,
  cursorStyle: "block",
  cursorBlink: true,
  fontWeightBold: 700,
  scrollback: 5000,
  copyOnSelect: false,
};

test("terminal settings change open terminals at once, survive a reload, and reset", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  await startConversation(page);
  await showTerminal(page);
  const terminal = page.locator(".terminal-pane .xterm");
  await terminal.click();

  await expect.poll(() => rowsStyle(page, "font-size")).toBe("12px");
  await expect.poll(() => rowsStyle(page, "font-family")).toContain("MesloLGS NF");
  await expect.poll(() => terminalBackgroundOf(page)).toBe("rgb(27, 28, 34)");
  await expect.poll(() => rowsStyle(page, "color")).toBe("rgb(212, 214, 222)");

  let spacingWithoutExtra = 0;

  await test.step("font, size, line height and letter spacing reach the open terminal at once", async () => {
    const settings = await openSettings(page, "Terminal");
    const preview = settings.locator(".terminal-font-preview");
    await expect(preview).toHaveCSS("font-family", /MesloLGS NF/);

    await settings.getByLabel("Colour preset").selectOption("nord");
    await expect.poll(() => terminalBackgroundOf(page)).toBe("rgb(46, 52, 64)");
    await expect.poll(() => rowsStyle(page, "color")).toBe("rgb(216, 222, 233)");

    await settings.getByLabel("Colour preset").selectOption("dracula");
    await expect.poll(() => terminalBackgroundOf(page)).toBe("rgb(40, 42, 54)");
    await expect.poll(() => rowsStyle(page, "color")).toBe("rgb(248, 248, 242)");

    await settings.getByLabel("Font", { exact: true }).fill("JetBrains Mono");
    await expect(preview).toHaveCSS("font-family", /^"?JetBrains Mono/);
    await settings.getByRole("button", { name: "Reset font" }).click();
    await expect(settings.getByLabel("Font", { exact: true })).toHaveValue("");
    await expect(preview).toHaveCSS("font-family", /MesloLGS NF/);
    await settings.getByLabel("Font", { exact: true }).fill("JetBrains Mono");
    await expect.poll(() => rowsStyle(page, "font-family")).toContain("JetBrains Mono");

    await settings.getByLabel("Font size").selectOption("16");
    await expect.poll(() => rowsStyle(page, "font-size")).toBe("16px");

    const linesBefore = await lineHeightOf(page);
    await settings.getByLabel("Line height").fill("1.5");
    await expect.poll(() => lineHeightOf(page)).toBeGreaterThan(linesBefore * 1.4);
    expect(await lineHeightOf(page)).toBeLessThan(linesBefore * 1.6);

    spacingWithoutExtra = await letterSpacingOf(page);
    await settings.getByLabel("Letter spacing").fill("2");
    await expect.poll(() => letterSpacingOf(page)).toBeGreaterThan(spacingWithoutExtra + 1.5);
    expect(await letterSpacingOf(page)).toBeLessThan(spacingWithoutExtra + 2.5);

    await settings.getByLabel("Cursor style").selectOption("bar");
    await settings.getByLabel("Bold weight").selectOption("900");
    await settings.getByLabel("Scrollback").selectOption("100000");
    await settings.getByRole("button", { name: "Close" }).click();

    await expect.poll(() => storedSettings(page)).toEqual({
      preset: "dracula",
      fontFamily: "JetBrains Mono",
      fontSize: 16,
      lineHeight: 1.5,
      letterSpacing: 2,
      cursorStyle: "bar",
      cursorBlink: true,
      fontWeightBold: 900,
      scrollback: 100_000,
      copyOnSelect: false,
    });
  });

  await test.step("the cursor follows the cursor style and blink options", async () => {
    await terminal.click();
    await expect(page.locator(".terminal-pane .xterm-cursor.xterm-cursor-bar")).toHaveCount(1);
    await expect(page.locator(".terminal-pane .xterm-cursor.xterm-cursor-blink")).toHaveCount(1);

    const settings = await openSettings(page, "Terminal");
    await settings.getByLabel("Cursor blink").uncheck();
    await settings.getByRole("button", { name: "Close" }).click();

    await terminal.click();
    await expect(page.locator(".terminal-pane .xterm-cursor.xterm-cursor-bar")).toHaveCount(1);
    await expect(page.locator(".terminal-pane .xterm-cursor:not(.xterm-cursor-blink)")).toHaveCount(1);
  });

  await test.step("the settings survive a reload and redraw the terminal", async () => {
    await page.reload();
    await showTerminal(page);
    const settings = await openSettings(page, "Terminal");
    await expect(settings.getByLabel("Colour preset")).toHaveValue("dracula");
    await expect(settings.getByLabel("Font", { exact: true })).toHaveValue("JetBrains Mono");
    await expect(settings.getByLabel("Font size")).toHaveValue("16");
    await expect(settings.getByLabel("Line height")).toHaveValue("1.5");
    await expect(settings.getByLabel("Letter spacing")).toHaveValue("2");
    await expect(settings.getByLabel("Cursor style")).toHaveValue("bar");
    await expect(settings.getByLabel("Cursor blink")).not.toBeChecked();
    await expect(settings.getByLabel("Bold weight")).toHaveValue("900");
    await expect(settings.getByLabel("Scrollback")).toHaveValue("100000");
    await settings.getByRole("button", { name: "Close" }).click();

    await expect.poll(() => rowsStyle(page, "font-family")).toContain("JetBrains Mono");
    await expect.poll(() => rowsStyle(page, "font-size")).toBe("16px");
    await expect.poll(() => letterSpacingOf(page)).toBeGreaterThan(spacingWithoutExtra + 1.5);
    await expect.poll(() => terminalBackgroundOf(page)).toBe("rgb(40, 42, 54)");
    await expect.poll(() => rowsStyle(page, "color")).toBe("rgb(248, 248, 242)");
  });

  await test.step("Reset to defaults puts every option, the saved object and the open terminal back", async () => {
    const spacingBeforeReset = await letterSpacingOf(page);
    const settings = await openSettings(page, "Terminal");
    await settings.getByRole("button", { name: "Reset to defaults" }).click();
    await expect(settings.getByLabel("Colour preset")).toHaveValue("default");
    await expect(settings.getByLabel("Font", { exact: true })).toHaveValue("");
    await expect(settings.getByLabel("Font size")).toHaveValue("12");
    await expect(settings.getByLabel("Line height")).toHaveValue("1");
    await expect(settings.getByLabel("Letter spacing")).toHaveValue("0");
    await expect(settings.getByLabel("Cursor style")).toHaveValue("block");
    await expect(settings.getByLabel("Cursor blink")).toBeChecked();
    await expect(settings.getByLabel("Bold weight")).toHaveValue("700");
    await expect(settings.getByLabel("Scrollback")).toHaveValue("5000");
    await expect.poll(() => storedSettings(page)).toEqual(DEFAULTS);
    await settings.getByRole("button", { name: "Close" }).click();

    await expect.poll(() => rowsStyle(page, "font-family")).toContain("MesloLGS NF");
    await expect.poll(() => rowsStyle(page, "font-size")).toBe("12px");
    await expect.poll(() => letterSpacingOf(page)).toBeLessThan(spacingBeforeReset - 1.5);
    await expect.poll(() => terminalBackgroundOf(page)).toBe("rgb(27, 28, 34)");
    await expect.poll(() => rowsStyle(page, "color")).toBe("rgb(212, 214, 222)");
  });
});

test("the terminal font size and copy on select set in 0.5.0 carry over to the terminal settings", async ({ page }) => {
  await signIn(page, host);
  await page.evaluate(() => {
    localStorage.removeItem("mirador-terminal-settings");
    localStorage.setItem("mirador-terminal-font-size", "16");
    localStorage.setItem("mirador-terminal-copy-on-select", "on");
  });
  await page.reload();
  const settings = await openSettings(page, "Terminal");
  await expect(settings.getByLabel("Font size")).toHaveValue("16");
  await expect(settings.getByLabel("Copy on select")).toBeChecked();
  await expect(settings.getByLabel("Cursor style")).toHaveValue("block");
});
