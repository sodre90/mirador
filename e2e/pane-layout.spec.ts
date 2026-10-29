import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, callCanvasTool, chooseInSettings, openSettings, signIn, startConversation } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();

test.beforeAll(() => host.start());
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

type PaneId = "conversation" | "canvas" | "terminals";

const pane = (page: Page, id: PaneId) => page.locator(`[data-pane="${id}"]:visible`);
const boxOf = async (page: Page, id: PaneId) => (await pane(page, id).boundingBox())!;
const workspaceBox = async (page: Page) => (await page.locator(".workspace-area").boundingBox())!;

async function placeOf(page: Page, id: PaneId) {
  const area = await workspaceBox(page);
  const box = await boxOf(page, id);
  const column = box.x - area.x < 2 ? "left" : "right";
  if (Math.abs(box.height - area.height) < 2) return column;
  return box.y - area.y < 2 ? `${column} top` : `${column} bottom`;
}

const placesOf = async (page: Page) => ({
  conversation: await placeOf(page, "conversation"),
  canvas: (await pane(page, "canvas").count()) ? await placeOf(page, "canvas") : "hidden",
  terminals: (await pane(page, "terminals").count()) ? await placeOf(page, "terminals") : "hidden",
});

async function dragGripOnto(page: Page, from: PaneId, onto: PaneId) {
  const grip = (await pane(page, from).locator(".pane-grip").boundingBox())!;
  const target = await boxOf(page, onto);
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 12 });
  await expect(pane(page, onto)).toHaveClass(/drop-target/);
  await page.mouse.up();
}

async function dragDividerBy(page: Page, label: string, deltaY: number) {
  const box = (await page.getByRole("separator", { name: label }).boundingBox())!;
  const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + deltaY, { steps: 10 });
  await page.mouse.up();
}

async function runFromPalette(page: Page, label: string) {
  const primary = (await page.evaluate(() => navigator.userAgent.includes("Mac"))) ? "Meta" : "Control";
  await page.keyboard.press(`${primary}+k`);
  const query = page.getByPlaceholder(/Go to a conversation/);
  await query.fill(label);
  /** A terminal pane the previous action showed focuses itself once its tabs arrive, which can be after the fill. */
  await query.press("Enter");
}

test("panes resize, swap by their grips without reloading, go fullscreen, hide, and each conversation remembers its layout", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const conversationId = await startConversation(page);
  await callCanvasTool(host, conversationId, "show", { title: "Drawing", html: "<h1>canvas</h1>" });
  await expect(page.locator(".canvas-panel:visible .canvas-frame.show iframe")).toBeVisible();
  await page.getByRole("button", { name: "Show terminal" }).click();
  await expect(page.locator(".terminal-pane .xterm")).toBeVisible();
  expect(await placesOf(page)).toEqual({ conversation: "left", canvas: "right top", terminals: "right bottom" });

  const terminalsHeight = (await boxOf(page, "terminals")).height;
  await dragDividerBy(page, "Resize the top and bottom panes", -120);
  expect((await boxOf(page, "terminals")).height).toBeGreaterThan(terminalsHeight + 100);
  await dragDividerBy(page, "Resize the top and bottom panes", 5000);
  expect((await boxOf(page, "terminals")).height).toBeGreaterThanOrEqual(119);

  await page.evaluate(() => Object.assign(window, { canvasFrameBefore: document.querySelector(".canvas-panel iframe") }));
  await dragGripOnto(page, "terminals", "conversation");
  expect(await placesOf(page)).toEqual({ conversation: "right bottom", canvas: "right top", terminals: "left" });
  expect(await page.evaluate(() => document.querySelector(".canvas-panel iframe") === (window as unknown as { canvasFrameBefore: Element }).canvasFrameBefore)).toBe(true);

  await dragDividerBy(page, "Resize the top and bottom panes", 5000);
  const conversationBox = await boxOf(page, "conversation");
  expect(conversationBox.height).toBeGreaterThanOrEqual(299);
  const composerBox = (await pane(page, "conversation").locator(".composer").boundingBox())!;
  expect(composerBox.y + composerBox.height).toBeLessThanOrEqual(conversationBox.y + conversationBox.height + 1);

  await pane(page, "canvas").locator(".canvas-title").dblclick();
  const area = await workspaceBox(page);
  expect(await boxOf(page, "canvas")).toEqual(area);
  await page.keyboard.press("Escape");
  expect(await placeOf(page, "canvas")).toBe("right top");

  await page.getByRole("button", { name: "Fullscreen terminals" }).click();
  expect(await boxOf(page, "terminals")).toEqual(area);
  await expect(pane(page, "canvas")).toHaveAttribute("inert", "");
  await page.locator(".terminal-pane .xterm").click();
  await page.keyboard.press("Escape");
  expect(await boxOf(page, "terminals")).toEqual(area);
  await page.getByRole("button", { name: "Exit fullscreen" }).click();
  expect(await placeOf(page, "terminals")).toBe("left");

  const header = page.locator(".chat-header:visible");
  await page.getByRole("button", { name: "Fullscreen conversation" }).click();
  await expect(header.getByRole("button", { name: "Show canvas" })).toBeVisible();
  await header.getByRole("button", { name: "Show terminal" }).click();
  expect(await placesOf(page)).toEqual({ conversation: "right bottom", canvas: "right top", terminals: "left" });
  await expect(header.getByRole("button", { name: "Hide canvas" })).toBeVisible();
  await expect(header.getByRole("button", { name: "Hide terminal" })).toBeVisible();
  await page.getByRole("button", { name: "Fullscreen conversation" }).click();
  await runFromPalette(page, "Show canvas");
  await expect.poll(() => placesOf(page)).toEqual({ conversation: "right bottom", canvas: "right top", terminals: "left" });

  await pane(page, "canvas").getByRole("button", { name: "Hide", exact: true }).click();
  expect(await placesOf(page)).toEqual({ conversation: "right", canvas: "hidden", terminals: "left" });

  await page.reload();
  await expect(page.locator(".terminal-pane .xterm")).toBeVisible();
  expect(await placesOf(page)).toEqual({ conversation: "right", canvas: "hidden", terminals: "left" });

  const second = await startConversation(page);
  await callCanvasTool(host, second, "show", { title: "Second drawing", html: '<h1>canvas</h1><input aria-label="Note">' });
  await expect(page.locator(".canvas-panel:visible .canvas-frame.show iframe")).toBeVisible();
  expect(await placesOf(page)).toEqual({ conversation: "left", canvas: "right", terminals: "hidden" });
  await page.getByRole("button", { name: "Fullscreen canvas" }).click();
  expect(await boxOf(page, "canvas")).toEqual(area);

  const otherConversation = page.locator(".workspace li:not(.selected) .conversation-title");
  await otherConversation.click();
  await expect(page.locator(".terminal-pane .xterm")).toBeVisible();
  expect(await placesOf(page)).toEqual({ conversation: "right", canvas: "hidden", terminals: "left" });
  await otherConversation.click();
  await expect(page.locator(".canvas-title")).toHaveText("Second drawing");
  expect(await boxOf(page, "canvas")).toEqual(area);
  await page.reload();
  await expect(page.locator(".canvas-title")).toHaveText("Second drawing");
  expect(await boxOf(page, "canvas")).toEqual(area);
  const canvasPage = page.frameLocator(".canvas-panel:visible .canvas-frame.show iframe");
  await canvasPage.getByLabel("Note").click();
  await page.keyboard.press("Escape");
  expect(await boxOf(page, "canvas")).toEqual(area);
  await canvasPage.locator("h1").click();
  await page.keyboard.press("Escape");
  await expect.poll(() => placesOf(page)).toEqual({ conversation: "left", canvas: "right", terminals: "hidden" });

  const settings = await openSettings(page, "Layout");
  await settings.getByRole("radio", { name: "Canvas on the left, conversation top right, terminals bottom right" }).click();
  await settings.getByLabel("Terminals start hidden").uncheck();
  await settings.getByRole("button", { name: "Close" }).click();
  expect(await placesOf(page)).toEqual({ conversation: "left", canvas: "right", terminals: "hidden" });

  await runFromPalette(page, "Reset layout to default");
  await expect.poll(() => placesOf(page)).toEqual({ conversation: "right top", canvas: "left", terminals: "right bottom" });

  await runFromPalette(page, "Swap conversation and canvas");
  await expect.poll(() => placesOf(page)).toEqual({ conversation: "left", canvas: "right top", terminals: "right bottom" });
  await runFromPalette(page, "Swap canvas and terminals");
  await expect.poll(() => placesOf(page)).toEqual({ conversation: "left", canvas: "right bottom", terminals: "right top" });
});

test("a canvas the user hid comes back when the agent shows something new on it", async ({ page }) => {
  await signIn(page, host);
  const [newConversation, addProject] = [page.getByRole("button", { name: "+ New conversation" }), page.getByRole("button", { name: "+ Add a project directory" })];
  await expect(newConversation.or(addProject)).toBeVisible();
  if (await addProject.isVisible()) await addWorkspace(page, host.projectDir);
  const conversationId = await startConversation(page);
  const header = page.locator(".chat-header:visible");
  await callCanvasTool(host, conversationId, "show", { title: "Before hiding", html: "<h1>before</h1>" });
  await expect(page.locator(".canvas-title:visible")).toHaveText("Before hiding");
  await header.getByRole("button", { name: "Hide canvas" }).click();
  await expect(pane(page, "canvas")).toHaveCount(0);
  await page.reload();
  await expect(header.getByRole("button", { name: "Show canvas" })).toBeVisible();
  await expect(pane(page, "canvas")).toHaveCount(0);

  await callCanvasTool(host, conversationId, "show", { title: "After hiding", html: "<h1>after</h1>" });
  await expect(page.locator(".canvas-title:visible")).toHaveText("After hiding");
  await expect(header.getByRole("button", { name: "Hide canvas" })).toBeVisible();
});

test("the sidebar resizes between its limits, keeps its width after a reload, and a double-click restores it", async ({ page }) => {
  await signIn(page, host);
  const sidebarWidth = async () => (await page.locator(".sidebar").boundingBox())!.width;
  const divider = page.getByRole("separator", { name: "Resize the sidebar" });
  const dragSidebarEdgeBy = async (deltaX: number) => {
    const box = (await divider.boundingBox())!;
    const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + deltaX, y, { steps: 10 });
    await page.mouse.up();
  };
  expect(await sidebarWidth()).toBe(256);

  await dragSidebarEdgeBy(100);
  expect(Math.abs((await sidebarWidth()) - 356)).toBeLessThan(6);
  expect(Math.abs((await workspaceBox(page)).x - (await sidebarWidth()))).toBeLessThan(1);
  await page.reload();
  expect(Math.abs((await sidebarWidth()) - 356)).toBeLessThan(6);

  await dragSidebarEdgeBy(500);
  expect(await sidebarWidth()).toBe(480);
  await dragSidebarEdgeBy(-600);
  expect(await sidebarWidth()).toBe(180);
  await divider.dblclick();
  expect(await sidebarWidth()).toBe(256);
});

test("at its narrowest and the largest text size, the sidebar keeps its header buttons in view and never scrolls sideways", async ({ page }) => {
  await signIn(page, host);
  await chooseInSettings(page, "Text size", "200%");
  const divider = page.getByRole("separator", { name: "Resize the sidebar" });
  const box = (await divider.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(0, box.y + 200, { steps: 10 });
  await page.mouse.up();
  expect((await page.locator(".sidebar").boundingBox())!.width).toBe(180);

  const sidebarScroll = page.locator(".sidebar-scroll");
  const scrollRight = await sidebarScroll.evaluate((element) => element.getBoundingClientRect().left + element.clientWidth);
  const headerButtons = (await page.locator(".sidebar-header-buttons").boundingBox())!;
  expect(headerButtons.x + headerButtons.width).toBeLessThanOrEqual(scrollRight);

  await sidebarScroll.evaluate((element) => {
    const tooWide = document.createElement("div");
    tooWide.style.width = "400px";
    tooWide.style.height = "1px";
    element.prepend(tooWide);
  });
  await sidebarScroll.hover();
  await page.mouse.wheel(200, 0);
  await page.waitForTimeout(200);
  expect(await sidebarScroll.evaluate((element) => element.scrollLeft)).toBe(0);
});
