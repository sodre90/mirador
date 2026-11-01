import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, callCanvasTool, signIn, startConversation } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();

test.beforeAll(() => host.start());
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

interface WithRecordedErrors {
  recordedErrors: string[];
}

const recordWindowErrors = (page: Page) =>
  page.addInitScript(() => {
    const errors: string[] = [];
    (window as unknown as WithRecordedErrors).recordedErrors = errors;
    window.addEventListener("error", (event) => errors.push(event.message), true);
  });

const resizeObserverErrors = async (page: Page) =>
  (await page.evaluate(() => (window as unknown as WithRecordedErrors).recordedErrors)).filter((message) => /ResizeObserver loop/.test(message));

const afterTwoFrames = (page: Page) => page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

async function dragSplitter(page: Page, name: string, deltaX: number, deltaY: number) {
  const splitter = page.getByRole("separator", { name });
  await expect(splitter).toBeVisible();
  const box = (await splitter.boundingBox())!;
  const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + deltaX, y + deltaY, { steps: 10 });
  await page.mouse.up();
  await afterTwoFrames(page);
}

test("resizing the window and the panes with the terminal and canvas open raises no ResizeObserver error", async ({ page }) => {
  await recordWindowErrors(page);
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const conversationId = await startConversation(page);
  await page.getByRole("button", { name: "Show terminal" }).click();
  await expect(page.locator(".terminal-pane .xterm")).toBeVisible();
  await callCanvasTool(host, conversationId, "show", { title: "Wide", html: "<div style='width:1800px;height:900px'>wide</div>" });
  await expect(page.locator(".canvas-panel:visible .canvas-frame.show iframe")).toBeVisible();

  await test.step("the window changes width and height", async () => {
    for (const [width, height] of [[1600, 1000], [1200, 800], [900, 700], [700, 600], [1100, 900], [1600, 1000]] as const) {
      await page.setViewportSize({ width, height });
      await afterTwoFrames(page);
    }
  });

  await test.step("the splitters are dragged", async () => {
    await dragSplitter(page, "Resize the left and right panes", 200, 0);
    await dragSplitter(page, "Resize the left and right panes", -300, 0);
    await dragSplitter(page, "Resize the top and bottom panes", 0, 100);
    await dragSplitter(page, "Resize the top and bottom panes", 0, -150);
  });

  await test.step("the panes are hidden and shown again", async () => {
    for (const name of ["Hide terminal", "Show terminal", "Hide canvas", "Show canvas"]) {
      await page.getByRole("button", { name }).click();
      await afterTwoFrames(page);
    }
  });

  expect(await resizeObserverErrors(page)).toEqual([]);
});
