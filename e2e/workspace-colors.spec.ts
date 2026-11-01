import { mkdirSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { addWorkspace, chooseInSettings, signIn, startConversation, workspaceCard } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();

test.beforeAll(async () => {
  mkdirSync(host.projectDir, { recursive: true });
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const primaryModifier = async (page: Page) => ((await page.evaluate(() => navigator.userAgent.includes("Mac"))) ? "Meta" : "Control");

/** The text's contrast with what the browser paints behind it: every ancestor's background, layered from the page down. */
const contrastOf = (text: Locator) =>
  text.evaluate((element) => {
    const backgrounds: string[] = [];
    for (let layer: Element | null = element; layer; layer = layer.parentElement) backgrounds.unshift(getComputedStyle(layer).backgroundColor);
    const canvas = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
    const painted = (colors: string[]) => {
      canvas.clearRect(0, 0, 1, 1);
      colors.forEach((color) => {
        canvas.fillStyle = color;
        canvas.fillRect(0, 0, 1, 1);
      });
      return [...canvas.getImageData(0, 0, 1, 1).data].slice(0, 3);
    };
    const luminance = (rgb: number[]) => {
      const [r, g, b] = rgb.map((value) => (value / 255 <= 0.03928 ? value / 255 / 12.92 : ((value / 255 + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    const [behind, text] = [luminance(painted(backgrounds)), luminance(painted([...backgrounds, getComputedStyle(element).color]))];
    return (Math.max(behind, text) + 0.05) / (Math.min(behind, text) + 0.05);
  });

async function expectReadable(texts: Locator[]) {
  for (const text of texts) expect(await contrastOf(text), await text.textContent() ?? "").toBeGreaterThanOrEqual(4.5);
}

const backgroundOf = (element: Locator) => element.evaluate((each) => getComputedStyle(each).backgroundColor);

test("a workspace takes a pastel colour from its initials or the palette, every window shows it, and its text stays readable", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  await startConversation(page);
  const card = workspaceCard(page, host.projectDir);
  const heading = [card.locator(".workspace-name"), card.locator(".workspace-folder")];
  const everyText = [...heading, card.locator("li .conversation-title"), card.getByRole("button", { name: "+ New conversation" })];
  const picker = page.getByRole("radiogroup", { name: /^Colour of / });
  const uncoloured = await backgroundOf(card);

  await test.step("the initials open the colours; Esc closes them, and the one picked fills the card", async () => {
    await card.getByRole("button", { name: "Workspace colour" }).click();
    await expect(picker.getByRole("radio", { name: "No colour" })).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");
    await expect(picker).toHaveCount(0);
    await card.getByRole("button", { name: "Workspace colour" }).click();
    await picker.getByRole("radio", { name: "Lavender" }).click();
    await expect(picker).toHaveCount(0);
    await expect(card).toHaveAttribute("data-color", "lavender");
    expect(await backgroundOf(card)).not.toBe(uncoloured);
    await expectReadable(everyText);
  });

  await test.step("another window shows the colour, and so does a reload", async () => {
    const otherWindow = await page.context().newPage();
    await otherWindow.goto(page.url());
    await expect(workspaceCard(otherWindow, host.projectDir)).toHaveAttribute("data-color", "lavender");
    await otherWindow.close();
    await page.reload();
    await expect(card).toHaveAttribute("data-color", "lavender");
  });

  await test.step("Settings colour only the heading, or a stripe over a softer tint", async () => {
    await chooseInSettings(page, "Workspace colours", "Heading only");
    expect(await backgroundOf(card)).toBe(uncoloured);
    expect(await backgroundOf(card.locator("header"))).not.toBe("rgba(0, 0, 0, 0)");
    await expectReadable(heading);
    await chooseInSettings(page, "Workspace colours", "Stripe and soft tint");
    await expect(card).toHaveCSS("box-shadow", /inset/);
    expect(await backgroundOf(card)).not.toBe(uncoloured);
    await expectReadable(everyText);
  });

  await test.step("the dark theme deepens the colour, so its light text stays readable", async () => {
    await chooseInSettings(page, "Workspace colours", "Whole card");
    await chooseInSettings(page, "Theme", "Dark");
    await expectReadable(everyText);
  });

  await test.step("the palette opens the same colours, and No colour takes it away", async () => {
    await page.keyboard.press(`${await primaryModifier(page)}+KeyK`);
    const palette = page.getByLabel("Search conversations and actions");
    await palette.fill("colour");
    await palette.press("Enter");
    await expect(picker.getByRole("radio", { name: "Lavender" })).toHaveAttribute("aria-checked", "true");
    await picker.getByRole("radio", { name: "No colour" }).click();
    await expect(card).not.toHaveAttribute("data-color");
  });
});
