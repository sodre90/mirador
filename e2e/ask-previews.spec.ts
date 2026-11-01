import { expect, test, type Locator } from "@playwright/test";
import { addWorkspace, answerCanvasQuestion, callCanvasTool, signIn, startConversation } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();

// Later tests use the workspace the first one adds; after a failure, a new worker would start an empty host for them.
test.describe.configure({ mode: "serial" });
test.beforeAll(() => host.start());
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const mockup = (width: number) =>
  `<div style="width:${width}px;display:flex;justify-content:space-between;background:#eef;padding:8px"><b>START</b><b>END</b></div>`;
const fluid = (text: string) => `<p style="margin:8px">${text}</p>`;

/** The agent waits on its question until it is answered, so the call is left running. */
const askInBackground = (conversationId: string, ask: Record<string, unknown>) => void callCanvasTool(host, conversationId, "ask", ask).catch(() => {});

const preview = (option: Locator) => option.locator("iframe");

/** A preview scaled down to fit lands a subpixel short of whole; a cut-off one loses far more of its END. */
const WHOLLY_SHOWN_RATIO = 0.99;

async function expectWhollyShown(frame: Locator) {
  await expect(frame.contentFrame().getByText("END")).toBeInViewport({ ratio: WHOLLY_SHOWN_RATIO });
}

test("previews show whole: option columns widen to fit them, and what is wider than the canvas is scaled down", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 1000 });
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const conversationId = await startConversation(page);
  const options = page.locator(".ask-option");

  askInBackground(conversationId, {
    question: "Which look?",
    html: mockup(900),
    options: [
      { label: "Small", html: fluid("fits anywhere") },
      { label: "Sidebar", html: mockup(300) },
      { label: "Page", html: mockup(700) },
    ],
  });
  await expect(options).toHaveCount(3);
  await expectWhollyShown(page.locator(".ask-context iframe"));
  await expectWhollyShown(preview(options.nth(1)));
  await expectWhollyShown(preview(options.nth(2)));
  await expect(preview(options.nth(1))).not.toHaveAttribute("style", /scale/);
  await expect(preview(options.nth(2))).toHaveAttribute("style", /scale/);
  await answerCanvasQuestion(page, "Sidebar");

  askInBackground(conversationId, {
    question: "Which colour?",
    options: [
      { label: "Green", html: fluid("green") },
      { label: "Blue", html: fluid("blue") },
    ],
  });
  await expect(options.first()).toHaveText(/Green/);
  const [green, blue] = await Promise.all([options.nth(0).boundingBox(), options.nth(1).boundingBox()]);
  expect(blue!.y).toBe(green!.y);
});

test("the agent can make the answer boxes wider, up to the canvas's width", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 900 });
  await signIn(page, host);
  const conversationId = await startConversation(page);
  const options = page.locator(".ask-option");

  askInBackground(conversationId, { question: "Which colour?", optionWidth: 300, options: [{ label: "Green" }, { label: "Blue" }] });
  await expect(options.first()).toHaveText(/Green/);
  const [green, blue] = await Promise.all([options.nth(0).boundingBox(), options.nth(1).boundingBox()]);
  expect(blue!.y, "two boxes 300px wide do not fit side by side").toBeGreaterThan(green!.y);
  expect(green!.width).toBeGreaterThanOrEqual(300);
  await answerCanvasQuestion(page, "Green");

  askInBackground(conversationId, { question: "Which size?", optionWidth: 5000, options: [{ label: "Huge" }, { label: "Small" }] });
  await expect(options.first()).toHaveText(/Huge/);
  const [huge, room] = await Promise.all([options.first().boundingBox(), page.locator(".ask-options").boundingBox()]);
  expect(huge!.width).toBeLessThanOrEqual(room!.width);
  await answerCanvasQuestion(page, "Huge");
});

test("on a wide canvas the answer boxes share the whole row, rather than leaving room for boxes that aren't there", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await signIn(page, host);
  const conversationId = await startConversation(page);
  const options = page.locator(".ask-option");

  askInBackground(conversationId, { question: "Which colour?", options: [{ label: "Green", html: fluid("green") }, { label: "Blue", html: fluid("blue") }] });
  await expect(options.first()).toHaveText(/Green/);
  const [green, blue, row] = await Promise.all([options.nth(0).boundingBox(), options.nth(1).boundingBox(), page.locator(".ask-options").boundingBox()]);
  expect(blue!.y).toBe(green!.y);
  expect(row!.width, "the canvas has room for more boxes than two").toBeGreaterThan(3 * 208);
  expect(blue!.x + blue!.width).toBeCloseTo(row!.x + row!.width, 0);
  expect(blue!.width).toBeCloseTo(green!.width, 0);
  await answerCanvasQuestion(page, "Green");
});

test("a long unbroken word wraps inside its option and the question's page, rather than running past the box or shrinking the page, and short words stay whole", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 900 });
  await signIn(page, host);
  const conversationId = await startConversation(page);
  const identifier = "AvailabilityChecker.doesAllImageSucceedForEveryInstanceGroupOfTheStackWhenItsMetadataIsReadLazily";
  askInBackground(conversationId, {
    question: "Which fix?",
    html: `<div style="border:1px solid #888;border-radius:8px;padding:12px">Note: <code>${identifier}</code> reads the lazy collection.</div>
<table style="width:100%"><tr><td id="commit">a94e17d</td><td>${"Stop the page crashing when a terminal is split, closed or hidden. ".repeat(3)}</td></tr></table>`,
    options: [{ label: "Fix the checker", description: `Change ${identifier} to read instance metadata.` }, { label: "Leave it" }],
  });

  const option = page.locator(".ask-option").first();
  await expect(option).toContainText(identifier);
  expect(await option.evaluate((box) => box.scrollWidth <= box.clientWidth)).toBe(true);
  const context = page.locator(".ask-context iframe");
  await expect(context.contentFrame().getByText(identifier)).toBeVisible();
  await expect(context, "the page has reported its size").toHaveAttribute("style", /height/);
  await expect(context).not.toHaveAttribute("style", /scale/);
  const linesOf = (cell: HTMLElement) => {
    const text = document.createRange();
    text.selectNodeContents(cell);
    return text.getClientRects().length;
  };
  expect(await context.contentFrame().locator("#commit").evaluate(linesOf), "a table's short column is not squeezed to a letter a line").toBe(1);
  await answerCanvasQuestion(page, "Leave it");
});

test("a question's page and previews taller than the window show whole, so a wheel turn over them scrolls the canvas toward the answer", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 700 });
  await signIn(page, host);
  const conversationId = await startConversation(page);
  const tall = (text: string) => `<div style="height:1500px;background:#151922;color:#e3e7ef">${text}</div>`;
  askInBackground(conversationId, { question: "Which plan?", html: tall("The plan"), options: [{ label: "Go" }, { label: "Wait", html: tall("Waiting") }] });

  const context = page.locator(".ask-context iframe");
  const scrollsInside = (frame: Locator) => frame.contentFrame().locator("html").evaluate((root) => root.scrollHeight > root.clientHeight);
  await expect(context.contentFrame().getByText("The plan")).toBeVisible();
  await expect.poll(() => scrollsInside(context)).toBe(false);
  await expect.poll(() => scrollsInside(preview(page.locator(".ask-option").nth(1)))).toBe(false);

  const canvas = page.locator(".canvas-body");
  const { x, y, width } = (await context.boundingBox())!;
  await page.mouse.move(x + width / 2, y + 100);
  await page.mouse.wheel(0, 300);
  await expect.poll(() => canvas.evaluate((element) => element.scrollTop), "the page reports the turn, and the canvas takes it once").toBe(300);
  await answerCanvasQuestion(page, "Go");
});

test("a page that scrolls inside itself keeps the wheel, and the canvas takes the turns the page cannot use", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 700 });
  await signIn(page, host);
  const conversationId = await startConversation(page);
  const scrollsItself = `<div style="height:1500px;background:#151922;color:#e3e7ef">
  <div id="inner" style="height:200px;overflow-y:auto"><div style="height:1000px">inside the box</div></div>
  <div style="height:1000px">below the box</div>
</div>`;
  askInBackground(conversationId, { question: "Which plan?", html: scrollsItself, options: [{ label: "Go" }, { label: "Wait" }] });

  const context = page.locator(".ask-context iframe");
  const insideThePage = context.contentFrame();
  const inner = insideThePage.locator("#inner");
  const canvas = page.locator(".canvas-body");
  await expect(inner).toBeVisible();
  const scrollTop = () => canvas.evaluate((element) => element.scrollTop);

  await test.step("a box inside the page keeps the wheel, and the canvas stays where it is", async () => {
    const box = (await inner.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 50);
    await page.mouse.wheel(0, 200);
    await expect.poll(() => inner.evaluate((element) => element.scrollTop)).toBe(200);
    expect(await scrollTop()).toBe(0);
  });

  await test.step("a turn the page cannot use reaches the canvas", async () => {
    const below = (await insideThePage.getByText("below the box").boundingBox())!;
    await page.mouse.move(below.x + below.width / 2, below.y + 20);
    await page.mouse.wheel(0, 200);
    await expect.poll(scrollTop).toBe(200);
  });

  await answerCanvasQuestion(page, "Go");
});

test("a question asked right after a page carries that page, so both are in the canvas together", async ({ page }) => {
  await signIn(page, host);
  const conversationId = await startConversation(page);
  await callCanvasTool(host, conversationId, "show", { title: "Decision explained", html: fluid("Markers own resources; names only locate them.") });
  askInBackground(conversationId, { question: "Which doctrine?", options: [{ label: "Markers own" }, { label: "Names own" }] });

  const carried = page.getByRole("region", { name: "Shown before the question: Decision explained" });
  await expect(carried.locator("iframe").contentFrame().getByText("Markers own resources")).toBeVisible();
  await expect(page.locator(".ask h3")).toHaveText("Which doctrine?");
  await answerCanvasQuestion(page, "Markers own");

  askInBackground(conversationId, { question: "And the next one?", options: [{ label: "Yes" }, { label: "No" }] });
  await expect(page.locator(".ask h3")).toHaveText("And the next one?");
  await expect(page.locator(".ask-page-before")).toHaveCount(0);
});

test("a question's page and previews keep space from the box's edge even when they set the body's margin to 0, while a page on the canvas stays as the agent wrote it", async ({ page }) => {
  await signIn(page, host);
  const conversationId = await startConversation(page);
  const flush = (text: string) => `<style>body{margin:0}</style><ol style="margin:0"><li>${text}</li></ol>`;
  const listLeft = (frame: Locator) => frame.contentFrame().locator("ol").evaluate((list) => list.getBoundingClientRect().left);
  const wideAndFlush = `<style>body{margin:0}</style><div id="wide" style="width:1400px">wide</div>`;
  askInBackground(conversationId, {
    question: "Which fix?",
    html: flush("What happened"),
    options: [
      { label: "Drop-in", html: flush("Add a file") },
      { label: "Unstick only", html: wideAndFlush },
    ],
  });

  const context = page.locator(".ask-context iframe");
  await expect(context.contentFrame().getByText("What happened")).toBeVisible();
  expect(await listLeft(context)).toBe(8);
  expect(await listLeft(preview(page.locator(".ask-option").first()))).toBe(8);
  const wide = preview(page.locator(".ask-option").nth(1));
  await expect(wide, "a page wider than its box is scaled down").toHaveAttribute("style", /scale/);
  const spaceAfterWide = () => wide.contentFrame().locator("#wide").evaluate((element) => document.documentElement.clientWidth - element.getBoundingClientRect().right);
  await expect.poll(spaceAfterWide, "a scaled page keeps its spacing on the right as well").toBe(8);
  await answerCanvasQuestion(page, "Drop-in");

  await callCanvasTool(host, conversationId, "show", { title: "Flush page", html: flush("Edge to edge") });
  const shown = page.locator(".canvas-panel:visible .canvas-frame.show iframe");
  await expect(shown.contentFrame().getByText("Edge to edge")).toBeVisible();
  expect(await listLeft(shown)).toBe(0);
});

test("all option previews are shown whole when columns widen, without right-edge cut-off", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await signIn(page, host);
  const conversationId = await startConversation(page);
  const card = (text: string) => `<style>
    body { margin: 0; padding: 10px; }
    .card { width: 190px; margin: 0 auto; border: 4px solid #333; display: flex; justify-content: space-between; }
  </style><div class="card"><span>LEFT</span><b>${text} END</b></div>`;

  askInBackground(conversationId, {
    question: "Which card?",
    options: [
      { label: "Alpha", html: card("Alpha") },
      { label: "Beta", html: card("Beta") },
      { label: "Gamma", html: card("Gamma") },
    ],
  });

  const options = page.locator(".ask-option");
  await expect(options).toHaveCount(3);
  for (let i = 0; i < 3; i++) {
    const frame = preview(options.nth(i));
    await expect(frame).toHaveAttribute("style", /height/);
    await expect(frame.contentFrame().getByText("END")).toBeInViewport({ ratio: WHOLLY_SHOWN_RATIO });
    await expect(frame.contentFrame().locator(".card")).toBeInViewport({ ratio: WHOLLY_SHOWN_RATIO });
  }

  await page.setViewportSize({ width: 900, height: 800 });
  for (let i = 0; i < 3; i++) {
    const frame = preview(options.nth(i));
    await expect(frame.contentFrame().getByText("END")).toBeInViewport({ ratio: WHOLLY_SHOWN_RATIO });
  }

  await answerCanvasQuestion(page, "Alpha");
});
