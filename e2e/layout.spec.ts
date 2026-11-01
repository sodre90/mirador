import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, callCanvasTool, openSettings, signIn, startConversation, workspaceCard } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();

test.beforeAll(() => host.start());
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const widthOf = (page: Page, selector: string) => page.locator(selector).evaluate((element) => element.getBoundingClientRect().width);

const paneSplitter = (page: Page) => page.getByRole("separator", { name: "Resize the left and right panes" });

async function dragSplitterBy(page: Page, deltaX: number) {
  const box = (await paneSplitter(page).boundingBox())!;
  const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + deltaX, y, { steps: 10 });
  await page.mouse.up();
}

test("chat and canvas can be resized, stay above a minimum width and remember the split", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const conversationId = await startConversation(page);
  await callCanvasTool(host, conversationId, "show", { title: "Big", html: "<div style='height:2000px'>canvas</div>" });
  await expect(page.locator(".canvas-panel:visible .canvas-frame.show iframe")).toBeVisible();

  const canvasBefore = await widthOf(page, ".canvas-panel:visible");
  await dragSplitterBy(page, 300);
  const canvasAfterDraggingOverIframe = await widthOf(page, ".canvas-panel:visible");
  expect(canvasBefore - canvasAfterDraggingOverIframe).toBeGreaterThan(250);

  await dragSplitterBy(page, 5000);
  expect(await widthOf(page, ".canvas-panel:visible")).toBeGreaterThanOrEqual(239);
  await dragSplitterBy(page, -5000);
  expect(await widthOf(page, ".chat-column")).toBeGreaterThanOrEqual(239);
  const chatAtMinimum = await widthOf(page, ".chat-column");

  await page.reload();
  await expect(paneSplitter(page)).toBeVisible();
  expect(Math.abs((await widthOf(page, ".chat-column")) - chatAtMinimum)).toBeLessThan(2);

  await paneSplitter(page).dblclick();
  expect(Math.abs((await widthOf(page, ".canvas-panel:visible")) - canvasBefore)).toBeLessThan(2);
});

test.describe("on a system in dark mode", () => {
  test.use({ colorScheme: "dark" });
  const background = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const LIGHT = "rgb(255, 255, 255)";
  const DARK = "rgb(18, 19, 23)";

  const theme = (page: Page, name: string) => page.getByRole("radiogroup", { name: "Theme" }).getByRole("radio", { name });

  test("the theme is light unless the user picks dark or matching the system, and the choice is remembered", async ({ page }) => {
    await signIn(page, host);
    expect(await background(page)).toBe(LIGHT);
    await openSettings(page);
    const previewBackground = (name: string) => theme(page, name).locator(".preview-window").first().evaluate((window) => getComputedStyle(window).backgroundColor);
    expect([await previewBackground("Light"), await previewBackground("Dark")]).toEqual([LIGHT, DARK]);
    await theme(page, "Dark").click();
    expect(await background(page)).toBe(DARK);
    await page.reload();
    await openSettings(page);
    await expect(theme(page, "Dark")).toHaveAttribute("aria-checked", "true");
    expect(await background(page)).toBe(DARK);
    await theme(page, "Match system").click();
    expect(await background(page)).toBe(DARK);
    await theme(page, "Light").click();
    expect(await background(page)).toBe(LIGHT);
  });

  test("a dropdown's options keep the dark theme's colours, so their light text never sits on a light list", async ({ page }) => {
    await signIn(page, host);
    await openSettings(page);
    await theme(page, "Dark").click();
    const option = page.locator("dialog select option, .settings select option").first();
    const colours = await option.evaluate((element) => {
      const style = getComputedStyle(element);
      return [style.backgroundColor, style.color];
    });
    expect(colours).toEqual(["rgb(21, 22, 26)", "rgb(228, 229, 233)"]);
  });
});

test("a narrow conversation pane keeps its title readable and moves the header's buttons below it", async ({ page }) => {
  await signIn(page, host);
  const addProject = page.getByRole("button", { name: "+ Add a project directory" });
  await expect(addProject.or(workspaceCard(page, host.projectDir))).toBeVisible();
  if (await addProject.isVisible()) await addWorkspace(page, host.projectDir);
  const conversationId = await startConversation(page);
  await callCanvasTool(host, conversationId, "show", { title: "Wide", html: "<p>canvas</p>" });
  await expect(page.locator(".canvas-panel:visible .canvas-frame.show iframe")).toBeVisible();

  await dragSplitterBy(page, -5000);
  expect(await widthOf(page, ".chat-header")).toBeLessThan(400);
  expect(await widthOf(page, ".chat-header h2")).toBeGreaterThanOrEqual(120);
  await expect(page.locator(".chat-header .toggle-terminal")).toBeInViewport({ ratio: 1 });
});
