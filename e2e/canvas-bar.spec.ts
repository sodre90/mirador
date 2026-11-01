import { cpSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, callCanvasTool, signIn, startConversation } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();

/** The board test plugin, whose steps show in the tab beside the canvas, as a checklist does. */
test.beforeAll(async () => {
  cpSync(join(import.meta.dirname, "..", "tests", "fixtures", "canvas-plugins", "board"), join(host.dataDir, "plugins", "board"), { recursive: true });
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const bar = (page: Page) => page.locator(".canvas-header:visible");
const more = (page: Page) => bar(page).getByRole("button", { name: "More" });
const moreMenu = (page: Page) => page.getByRole("menu", { name: "More of the canvas bar" });

/** Whether every button shows inside the bar, Hide at its end included, and how many folded into More. */
const barState = (page: Page) =>
  bar(page).evaluate((element: HTMLElement) => {
    const hide = element.querySelector(".canvas-hide")!.getBoundingClientRect();
    const fits = element.scrollWidth <= element.clientWidth && hide.right <= element.getBoundingClientRect().right;
    return { width: element.clientWidth, fold: Number(element.dataset.fold), fits };
  });

/** Moves the divider between the chat and the canvas, which narrows the canvas pane as it moves right. */
async function moveDividerBy(page: Page, deltaX: number) {
  const box = (await page.getByRole("separator", { name: "Resize the left and right panes" }).boundingBox())!;
  const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + deltaX, y, { steps: 10 });
  await page.mouse.up();
}

async function chooseFromMore(page: Page, entry: string) {
  await more(page).click();
  await moreMenu(page).getByRole("menuitem", { name: entry }).or(moreMenu(page).getByRole("menuitemcheckbox", { name: entry })).click();
}

test("the canvas bar folds its buttons into More as its pane narrows, so every one stays in reach at any width", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const conversationId = await startConversation(page);
  await callCanvasTool(host, conversationId, "track_steps", { title: "Release", steps: ["Run the tests"] });
  await callCanvasTool(host, conversationId, "show", { title: "Sales by region, quarter by quarter", html: "<p>A chart</p>" });
  await expect(bar(page).locator(".canvas-title")).toHaveText("Sales by region, quarter by quarter");

  await test.step("with room, every button shows and there is no More", async () => {
    await moveDividerBy(page, -2 * 80);
    await expect.poll(async () => await barState(page)).toMatchObject({ fold: 0, fits: true });
    await expect(more(page)).toBeHidden();
    await expect(bar(page).getByRole("button", { name: "Export ▾" })).toBeVisible();
    await expect(bar(page).getByRole("button", { name: "Point and ask" })).toBeVisible();
  });

  const seen: Awaited<ReturnType<typeof barState>>[] = [];
  await test.step("narrowing the pane down to its least width folds the least used buttons first, and the bar always fits", async () => {
    for (let step = 0; step < 14; step++) {
      await moveDividerBy(page, 80);
      seen.push(await barState(page));
    }
    expect(seen.filter(({ fits }) => !fits), JSON.stringify(seen)).toEqual([]);
    expect(seen.map(({ fold }) => fold)).toEqual([...seen.map(({ fold }) => fold)].sort());
    expect(seen.map(({ fold }) => fold)).toEqual(expect.arrayContaining([1, 2, 3]));
    expect(seen.at(-1)!.width, "the pane went down to its least width").toBeLessThanOrEqual(260);
    expect(seen.at(-1)!.fold).toBe(3);
    await expect(more(page)).toBeVisible();
    await expect(bar(page).locator(".canvas-hide")).toBeVisible();
  });

  await test.step("More holds every folded button, and they work from there", async () => {
    await more(page).click();
    await expect(moreMenu(page).locator("button")).toHaveText([
      "Older",
      "Newer",
      "Changes",
      "Checklist 0/1",
      "History (1)",
      "Clear",
      "Point and ask",
      "Copy as image",
      "Copy HTML",
      "Ask agent for Markdown",
      "Ask agent to save Markdown file",
      "Download",
      "Save to project…",
      "Save image to project…",
    ]);
    await page.keyboard.press("Escape");
    await expect(moreMenu(page)).toHaveCount(0);

    await chooseFromMore(page, "Copy HTML");
    await expect(page.locator(".page-export-status")).toHaveText("Copied the HTML");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("<title>Sales by region, quarter by quarter</title>");

    await chooseFromMore(page, "Save to project…");
    await expect(page.locator(".page-save").getByLabel("Save in the project as")).toHaveValue("docs/sales-by-region-quarter-by-quarter.html");
    await page.keyboard.press("Escape");
    await expect(page.locator(".page-save")).toHaveCount(0);

    await chooseFromMore(page, "Point and ask");
    await more(page).click();
    await expect(moreMenu(page).getByRole("menuitemcheckbox", { name: "Point and ask" })).toHaveAttribute("aria-checked", "true");
    await moreMenu(page).getByRole("menuitemcheckbox", { name: "Point and ask" }).click();
    await more(page).click();
    await expect(moreMenu(page).getByRole("menuitemcheckbox", { name: "Point and ask" })).toHaveAttribute("aria-checked", "false");
    await page.keyboard.press("Escape");

    await chooseFromMore(page, "History (1)");
    await expect(page.locator(".canvas-history")).toBeVisible();
    await chooseFromMore(page, "History (1)");
    await expect(page.locator(".canvas-history")).toHaveCount(0);

    await chooseFromMore(page, "Checklist 0/1");
    await expect(bar(page).locator(".canvas-title")).toHaveText("Release");
    await more(page).click();
    await expect(moreMenu(page).getByRole("menuitemcheckbox", { name: "Checklist 0/1" })).toHaveAttribute("aria-checked", "true");
    await expect(moreMenu(page).getByRole("menuitem", { name: "Dismiss" }), "with no room for the header's Dismiss button, More holds it").toBeVisible();
    await page.keyboard.press("Escape");
    await expect(bar(page).getByRole("button", { name: "Close the checklist" }), "the checklist's own close button never folds").toBeVisible();
    expect(await barState(page)).toMatchObject({ fold: 3, fits: true });
  });

  await test.step("with the checklist folded, the agent's tick flashes More", async () => {
    await chooseFromMore(page, "Checklist 0/1");
    await callCanvasTool(host, conversationId, "finish_step", {});
    await expect(more(page)).toHaveClass(/agent-edited/);
  });

  await test.step("a waiting question's note shrinks to fit the narrowest bar too", async () => {
    void callCanvasTool(host, conversationId, "ask", { question: "Which chart should come next, the one by month or the one by product line?", options: [{ label: "By month" }, { label: "By product" }] }).catch(() => {});
    await expect(bar(page).locator(".canvas-outcome")).toHaveText("needs your answer");
    expect(await barState(page)).toMatchObject({ fold: 3, fits: true });
  });

  await test.step("widening the pane again unfolds them", async () => {
    await moveDividerBy(page, -14 * 80);
    await expect.poll(async () => (await barState(page)).fold).toBe(0);
    await expect(more(page)).toBeHidden();
    await expect(bar(page).locator(".checklist-toggle")).toHaveText("Checklist 1/1");
  });
});
