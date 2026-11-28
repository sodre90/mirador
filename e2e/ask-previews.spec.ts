import { expect, test, type Locator, type Page } from "@playwright/test";
import { addWorkspace, answerCanvasQuestion, callCanvasTool, chooseInSettings, signIn, startConversation } from "./helpers.ts";
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

/** Text drawn within its frame's sides, though a page taller than the window may have it out of sight. */
async function expectInWidth(frame: Locator, text: string) {
  await expect(async () => {
    const { left, right, frameWidth } = await frame
      .contentFrame()
      .getByText(text, { exact: true })
      .evaluate((node) => ({ left: node.getBoundingClientRect().left, right: node.parentElement!.getBoundingClientRect().right, frameWidth: document.documentElement.clientWidth }));
    expect(left).toBeGreaterThanOrEqual(0);
    expect(right).toBeLessThanOrEqual(frameWidth + 1);
  }).toPass({ timeout: 5_000 });
}

const scaleOf = (frame: Locator) =>
  frame.evaluate((node) => {
    const transform = getComputedStyle(node).transform;
    return transform === "none" ? 1 : new DOMMatrixReadOnly(transform).a;
  });

const viewportWide = `<div style="width:100vw;height:30px;background:#eef">VIEWPORT</div>`;

/** A page as wide as its window fills its column: not drawn narrower than it, nor wider and scaled down. */
async function expectAsWideAsItsColumn(option: Locator) {
  await expect(async () => {
    const [page, column] = await Promise.all([preview(option).contentFrame().getByText("VIEWPORT").boundingBox(), option.locator(".canvas-frame").boundingBox()]);
    const share = page!.width / column!.width;
    expect(share).toBeGreaterThan(0.9);
    expect(share).toBeLessThan(1.01);
    expect(await scaleOf(preview(option))).toBeGreaterThan(0.9);
  }).toPass({ timeout: 5_000 });
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

test("a preview that would squeeze its layout to fit beside the others takes its own row instead, at its natural width", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await signIn(page, host);
  const conversationId = await startConversation(page);
  const options = page.locator(".ask-option");
  const toolbar = (name: string) =>
    `<div class="toolbar" style="display:inline-flex;gap:24px;padding:8px;background:#eef">${["Navigation", "Search the whole site", "Account settings", name].map((item) => `<b>${item}</b>`).join("")}</div>`;

  askInBackground(conversationId, {
    question: "Which toolbar?",
    options: [
      { label: "Light", html: toolbar("Light") },
      { label: "Dark", html: toolbar("Dark") },
    ],
  });
  await expect(options).toHaveCount(2);
  const [light, dark, row] = await Promise.all([options.nth(0).boundingBox(), options.nth(1).boundingBox(), page.locator(".ask-options").boundingBox()]);
  const toolbarWidth = await preview(options.nth(0)).contentFrame().locator(".toolbar").evaluate((toolbar) => toolbar.scrollWidth);
  expect(2 * toolbarWidth, "two toolbars don't fit side by side").toBeGreaterThan(row!.width);
  expect(dark!.y, "so they stack").toBeGreaterThan(light!.y);
  for (const option of await options.all()) {
    const heights = await preview(option).contentFrame().locator(".toolbar b").evaluateAll((items) => items.map((item) => item.getBoundingClientRect().height));
    expect(new Set(heights).size, "no item of the toolbar wraps").toBe(1);
  }
  await page.setViewportSize({ width: 1500, height: 1000 });
  await expect(options.nth(1), "the previews measure themselves again as the canvas narrows").toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.locator(".ask-option .frame-errors"), "measuring a preview is no error of its page").toHaveCount(0);
  await answerCanvasQuestion(page, "Light");
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

test("a preview sized to the viewport, in its markup or from its script, keeps its column's width as the window changes rather than widening round after round, while one that grows or animates wider after it loads still widens to show whole", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 1000 });
  await signIn(page, host);
  const conversationId = await startConversation(page);
  const options = page.locator(".ask-option:visible");
  // Only wider, not taller, so its frame keeps its height.
  const growing = `<div id="box" style="width:300px;display:flex;justify-content:space-between;background:#eef;padding:8px"><b>START</b><b>END</b></div>
<script>
  const box = document.getElementById("box");
  setTimeout(() => (box.style.width = "700px"), 500);
  setTimeout(() => (box.style.width = "1300px"), 1500);
</script>`;
  const animatedWide = `<div id="wide" style="width:300px;transition:width 1s ease-in;display:flex;justify-content:space-between;background:#eef;padding:8px"><b>START</b><b>END</b></div>`;
  const scriptedWide = `<div id="set" style="height:30px;background:#eef">VIEWPORT</div>
<script>
  setTimeout(() => (document.getElementById("set").style.width = "100vw"), 500);
</script>`;

  askInBackground(conversationId, {
    question: "Which width?",
    options: [
      { label: "Viewport", html: viewportWide },
      { label: "Growing", html: growing },
      { label: "Animated", html: animatedWide },
      { label: "Scripted", html: scriptedWide },
    ],
  });
  await expect(options).toHaveCount(4);
  const viewportSized = options.nth(0);
  await expect(preview(viewportSized).contentFrame().getByText("VIEWPORT")).toBeAttached();
  // Chasing its 100vw content, the frame grew a few dozen pixels a round up to 2400px, scaled down to a sliver: give it the time.
  await page.waitForTimeout(2_000);
  await expectAsWideAsItsColumn(viewportSized);
  const columnWidth = () => viewportSized.locator(".canvas-frame").evaluate((node) => node.clientWidth);
  for (const width of [1600, 1100]) {
    const before = await columnWidth();
    await page.setViewportSize({ width, height: 1000 });
    await expect.poll(columnWidth).not.toBe(before);
    await expectAsWideAsItsColumn(viewportSized);
  }

  const grown = preview(options.nth(1));
  await expect.poll(() => grown.contentFrame().locator("#box").evaluate((node: HTMLElement) => node.style.width)).toBe("1300px");
  await expectWhollyShown(grown);
  // Widening every frame, it stays ahead of its frame until it stops. Started in view: a browser draws no frame offscreen.
  const animated = preview(options.nth(2));
  await animated.scrollIntoViewIfNeeded();
  const animatedBox = animated.contentFrame().locator("#wide");
  await animatedBox.evaluate((node: HTMLElement) => (node.style.width = "1300px"));
  await expect.poll(() => animatedBox.evaluate((node: HTMLElement) => node.offsetWidth)).toBe(1316);
  await expectWhollyShown(animated);
  // Its script set its width in vw after it loaded, which would chase the frame it is shown in as well.
  await expectAsWideAsItsColumn(options.nth(3));
  await answerCanvasQuestion(page, "Viewport");
});

/** Code side by side in a centred column of text, as agents lay out a before and after, where the code is wider than the column. */
const codeInACentredColumn = (lineLength: number) => {
  const code = `<pre>${`${"x".repeat(lineLength - 1)}\n`.repeat(4)}</pre>`;
  return `<style>
  body { max-width: 900px; margin: 0 auto; padding: 16px }
  .columns { display: grid; grid-template-columns: 1fr 1fr; gap: 12px }
  pre { font: 12px monospace; padding: 8px; background: #eef; overflow-x: auto }
</style>
<p>Every check runs on the calling thread, in dependency order.</p>
<div class="columns"><div><b>BEFORE</b>${code}</div><div><b>AFTER</b>${code}</div></div>`;
};

const columnDivider = (page: Page) => page.getByRole("separator", { name: "Resize the left and right panes" });

/** The widths the frames that match were drawn from since it started, each scaled to fit its column; 0 for one drawn at its column's own width. */
async function widthsDrawnFrom(page: Page, frames: string) {
  await page.evaluate((frames) => {
    const recorder = window as unknown as { widthsDrawn: Set<string> };
    recorder.widthsDrawn = new Set();
    const record = () => {
      document.querySelectorAll<HTMLElement>(frames).forEach((frame, index) => recorder.widthsDrawn.add(`${index} ${frame.style.transform ? parseFloat(frame.style.width) : 0}`));
      requestAnimationFrame(record);
    };
    record();
  }, frames);
  return async (index: number) => {
    const drawn = await page.evaluate(() => [...(window as unknown as { widthsDrawn: Set<string> }).widthsDrawn]);
    return drawn.map((entry) => entry.split(" ").map(Number)).filter(([frame]) => frame === index).map(([, width]) => width!);
  };
}

/** Drags the divider with each pointer move right after the page's current task, before React got round to what the move before it left to do. */
const dragFasterThanThePageRenders = (page: Page, moves: number) =>
  columnDivider(page).evaluate(async (divider, moves) => {
    divider.setPointerCapture = () => {};
    divider.releasePointerCapture = () => {};
    const { x, y } = divider.getBoundingClientRect();
    const point = (type: string, clientX: number) => divider.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX, clientY: y + 100, pointerId: 1 }));
    const channel = new MessageChannel();
    const nextTask = () =>
      new Promise((resolve) => {
        channel.port1.onmessage = resolve;
        channel.port2.postMessage(null);
      });
    point("pointerdown", x);
    for (let move = 0; move < moves; move++) {
      point("pointermove", x + (move % 60) * 2);
      await nextTask();
    }
    point("pointerup", x);
  }, moves);

test("a page and a preview wider than their columns stay scaled to fit while the canvas is resized, rather than flickering between that and their own size, and a drag that outruns the page doesn't end it", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1600, height: 1000 });
  await signIn(page, host);
  const conversationId = await startConversation(page);
  const html = codeInACentredColumn(90);
  await callCanvasTool(host, conversationId, "show", { title: "Before and after", html });
  askInBackground(conversationId, { question: "Which API?", options: [{ label: "After", html }, { label: "Before" }] });
  const carried = page.locator(".ask-page-before:visible iframe");
  const option = preview(page.locator(".ask-option:visible").first());
  for (const frame of [carried, option]) {
    await expect(frame).toHaveAttribute("style", /scale/);
    await expectInWidth(frame, "AFTER");
  }
  await page.waitForTimeout(1_000);

  const widthsDrawn = await widthsDrawnFrom(page, ".ask-page-before iframe, .ask-option iframe");
  const divider = (await columnDivider(page).boundingBox())!;
  const y = divider.y + 100;
  await page.mouse.move(divider.x + divider.width / 2, y);
  await page.mouse.down();
  for (const x of [divider.x + 120, divider.x - 120, divider.x]) await page.mouse.move(x, y, { steps: 30 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  for (const index of [0, 1]) {
    const widths = await widthsDrawn(index);
    expect(Math.max(...widths) - Math.min(...widths), `frame ${index} drawn from ${widths.join(", ")}px wide`).toBeLessThanOrEqual(2);
  }

  await dragFasterThanThePageRenders(page, 150);
  await expect(page.locator(".ask h3")).toHaveText("Which API?");
  expect(errors).toEqual([]);
  for (const frame of [carried, option]) await expectInWidth(frame, "AFTER");
  await answerCanvasQuestion(page, "After");
});

test("a page that moves as its frame widens is drawn as large as shows it whole, at any text size, rather than ever smaller, while one that fills its frame still spreads across it", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await signIn(page, host);
  const conversationId = await startConversation(page);
  const column = "max-width:700px;margin:0 auto";
  const wide = (left: string, right: string) => `<div style="width:1000px;display:flex;justify-content:space-between;background:#eef"><b>${left}</b><b>${right}</b></div>`;
  askInBackground(conversationId, {
    question: "Which page?",
    html: `<style>body{${column}}</style>${wide("BODY START", "BODY END")}`,
    options: [
      { label: "Centred", html: `<main style="${column}">${wide("MAIN START", "MAIN END")}</main>` },
      { label: "Wider than its page", html: `<div style="width:calc(100% + 60px);display:flex;justify-content:space-between;background:#eef"><b>MORE START</b><b>MORE END</b></div>` },
      { label: "Filling", html: `<p style="background:#eef">SPREADS</p>${wide("FILL START", "FILL END")}` },
      { label: "Fixed", html: `<style>html{width:1000px}</style>${wide("HTML START", "HTML END")}` },
    ],
  });
  const pages = [
    { frame: page.locator(".ask-context:visible iframe"), name: "BODY" },
    { frame: preview(page.locator(".ask-option:visible").nth(0)), name: "MAIN" },
    { frame: preview(page.locator(".ask-option:visible").nth(1)), name: "MORE" },
    { frame: preview(page.locator(".ask-option:visible").nth(2)), name: "FILL" },
    { frame: preview(page.locator(".ask-option:visible").nth(3)), name: "HTML" },
  ];
  const edgesOf = (frame: Locator, name: string) =>
    frame.contentFrame().locator("body").evaluate((body, name) => {
      const edge = (text: string, side: "left" | "right") => [...body.querySelectorAll("b")].find((node) => node.textContent === text)!.getBoundingClientRect()[side];
      return { before: edge(`${name} START`, "left"), after: document.documentElement.clientWidth - edge(`${name} END`, "right") };
    }, name);
  const expectEachAsLargeAsShowsItWhole = async (textScale: number) => {
    for (const { frame, name } of pages)
      await expect(async () => {
        const { before, after } = await edgesOf(frame, name);
        for (const room of [before, after]) {
          expect(room, `${name} is whole`).toBeGreaterThanOrEqual(-1);
          expect(room, `${name} leaves no more room beside it than its page's own spacing`).toBeLessThan(30 * textScale);
        }
      }).toPass({ timeout: 8_000 });
  };
  await expectEachAsLargeAsShowsItWhole(1);
  const spread = pages[3]!.frame.contentFrame().getByText("SPREADS");
  expect(await spread.evaluate((node) => node.getBoundingClientRect().width / document.documentElement.clientWidth)).toBeGreaterThan(0.9);

  for (const [choice, textScale] of [["140%", 1.4], ["100%", 1]] as const) {
    await chooseInSettings(page, "Text size", choice);
    await expectEachAsLargeAsShowsItWhole(textScale);
  }
  await answerCanvasQuestion(page, "Centred");
});

test("previews that fit the row a column of their own gives them keep it, rather than going side by side and back without end", async ({ page }) => {
  await page.setViewportSize({ width: 3600, height: 1000 });
  await signIn(page, host);
  const conversationId = await startConversation(page);
  const options = page.locator(".ask-option:visible");
  askInBackground(conversationId, {
    question: "Which of two?",
    options: [
      { label: "First", html: mockup(900) },
      { label: "Second", html: mockup(900) },
    ],
  });
  await expect(options).toHaveCount(2);
  const row = await page.locator(".ask-options:visible").boundingBox();
  expect(row!.width, "side by side they would be cut off, stacked they fit").toBeGreaterThan(900);
  expect(row!.width / 2, "side by side they would be cut off, stacked they fit").toBeLessThan(940);
  for (const width of [3550, 3600]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.waitForTimeout(1_000);
    const layouts = await page.evaluate(async () => {
      const seen = new Set<string>();
      for (let frame = 0; frame < 60; frame++) {
        seen.add([...document.querySelectorAll(".ask-option")].map((option) => Math.round(option.getBoundingClientRect().width)).join(" "));
        await new Promise(requestAnimationFrame);
      }
      return [...seen];
    });
    expect(layouts, `at rest in a window ${width} wide`).toHaveLength(1);
    for (const option of await options.all()) await expectWhollyShown(preview(option));
  }
  await answerCanvasQuestion(page, "First");
});

test("a scaled page about as tall as the panel keeps its size, where the panel's scrollbar takes room", async ({ playwright, browserName, channel, launchOptions, locale }) => {
  const browser = await playwright[browserName].launch({ ...launchOptions, channel, ignoreDefaultArgs: ["--hide-scrollbars"] });
  const page = await browser.newPage({ locale, viewport: { width: 1700, height: 1000 } });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await signIn(page, host);
  await page.addStyleTag({ content: "::-webkit-scrollbar { width: 15px }" });
  const conversationId = await startConversation(page);
  const text = "<p>Every check runs on the calling thread, in dependency order, so nothing runs after one that failed, and no work is wasted on the ones behind it.</p>".repeat(15);
  askInBackground(conversationId, { question: "Which tall page?", html: text + codeInACentredColumn(90), options: [{ label: "This one" }, { label: "Another" }] });
  const frame = page.locator(".ask-context:visible iframe");
  await expect(frame).toHaveAttribute("style", /scale/);
  await expectInWidth(frame, "AFTER");
  const heightThatFits = 1000 + (await page.evaluate(() => document.querySelector<HTMLElement>(".ask")!.offsetHeight - document.querySelector(".canvas-body")!.clientHeight));

  for (let height = heightThatFits + 8; height > heightThatFits - 20; height -= 4) {
    await page.setViewportSize({ width: 1700, height });
    await page.waitForTimeout(200);
    await expect(page.locator(".ask h3")).toHaveText("Which tall page?");
    const sizes = await page.evaluate(async () => {
      const seen = new Set<string>();
      for (let frame = 0; frame < 20; frame++) {
        const page = document.querySelector<HTMLElement>(".ask-context iframe")!;
        seen.add(`drawn from ${page.style.width || "its column's width"} in ${page.parentElement!.clientWidth}px`);
        await new Promise(requestAnimationFrame);
      }
      return [...seen];
    });
    expect(sizes, `at rest in a window ${height} tall`).toHaveLength(1);
  }
  expect(await page.locator(".canvas-body").evaluate((panel: HTMLElement) => panel.offsetWidth - panel.clientWidth), "the scrollbar takes room").toBe(15);
  expect(errors).toEqual([]);
  await answerCanvasQuestion(page, "This one");
  await browser.close();
});

test("a scaled page whose height takes its own column's width away, as a scrollbar that comes and goes would, leaves the page working", async ({ playwright, browserName, channel, launchOptions, locale }) => {
  const browser = await playwright[browserName].launch({ ...launchOptions, channel, ignoreDefaultArgs: ["--hide-scrollbars"] });
  const page = await browser.newPage({ locale, viewport: { width: 1700, height: 1000 } });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (/Maximum update depth|errors\/185/.test(message.text())) errors.push(message.text());
  });
  await signIn(page, host);
  await page.addStyleTag({ content: "::-webkit-scrollbar { width: 15px } .canvas-body:has(> .ask) { overflow-y: auto !important }" });
  const conversationId = await startConversation(page);
  const text = "<p>Every check runs on the calling thread, in dependency order, so nothing runs after one that failed, and no work is wasted on the ones behind it.</p>".repeat(15);
  askInBackground(conversationId, { question: "Which page that comes and goes?", html: text + codeInACentredColumn(90), options: [{ label: "This one" }, { label: "Another" }] });
  const frame = page.locator(".ask-context:visible iframe");
  await expect(frame).toHaveAttribute("style", /scale/);
  const heightThatFits = 1000 + (await page.evaluate(() => document.querySelector<HTMLElement>(".ask")!.offsetHeight - document.querySelector(".canvas-body")!.clientHeight));

  for (let height = heightThatFits + 30; height > heightThatFits - 30; height -= 3) {
    await page.setViewportSize({ width: 1700, height });
    await page.waitForTimeout(150);
    await expect(page.getByText("Something went wrong on this page"), `in a window ${height} tall`).toHaveCount(0);
    await expect(page.locator(".ask h3")).toHaveText("Which page that comes and goes?");
  }
  expect(errors).toEqual([]);
  await answerCanvasQuestion(page, "This one");
  await browser.close();
});

test("a preview at rest does no work, also when Mirador recolours its text to keep it readable", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 1000 });
  await signIn(page, host);
  const conversationId = await startConversation(page);
  askInBackground(conversationId, {
    question: "Which shade?",
    options: [
      { label: "Pale", html: `<div style="background:#fff;padding:8px"><p id="pale" style="color:#eee">Pale text</p></div>` },
      { label: "Plain" },
    ],
  });
  const pale = preview(page.locator(".ask-option:visible").first());
  await pale.scrollIntoViewIfNeeded();
  const text = pale.contentFrame().locator("#pale");
  await expect.poll(() => text.evaluate((node: HTMLElement) => node.style.getPropertyPriority("color"))).toBe("important");
  await page.waitForTimeout(500);

  await pale.evaluate((frame: HTMLIFrameElement) => {
    const sizes = window as unknown as { sizesPosted: number };
    sizes.sizesPosted = 0;
    addEventListener("message", (event) => {
      if (event.source === frame.contentWindow && event.data?.kind === "size") sizes.sizesPosted++;
    });
  });
  await text.evaluate(() => {
    const changes = window as unknown as { pageChanges: number };
    changes.pageChanges = 0;
    new MutationObserver((records) => (changes.pageChanges += records.length)).observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true });
  });
  await page.waitForTimeout(1_000);
  expect(await text.evaluate(() => (window as unknown as { pageChanges: number }).pageChanges)).toBe(0);
  expect(await page.evaluate(() => (window as unknown as { sizesPosted: number }).sizesPosted)).toBe(0);
  await answerCanvasQuestion(page, "Plain");
});

test("a page or canvas as tall as its frame and a caption more keeps a steady height in a question, rather than growing round after round, while one that grows after it loads still grows to show whole", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 1000 });
  await signIn(page, host);
  const conversationId = await startConversation(page);
  const screenAndCaption = `<div style="height:100vh;background:#eef">SCREEN</div><p>Caption</p>`;
  const sceneAndCaption = `<canvas id="scene" style="display:block;background:#eef"></canvas><p>Caption</p>
<script>
  const scene = document.getElementById("scene");
  const fitToWindow = () => {
    scene.style.width = innerWidth + "px";
    scene.style.height = innerHeight + "px";
  };
  fitToWindow();
  addEventListener("resize", fitToWindow);
</script>`;
  const growingTall = `<div id="tall" style="height:30px;background:#eef">TOP</div>
<script>
  const tall = document.getElementById("tall");
  setTimeout(() => (tall.style.height = "600px"), 500);
  setTimeout(() => (tall.style.height = "1200px"), 1500);
</script>`;

  const animatedTall = `<div id="animated" style="height:30px;transition:height 1s ease-in;background:#eef">ANIMATED</div>`;

  askInBackground(conversationId, {
    question: "Which height?",
    html: sceneAndCaption,
    options: [
      { label: "Screen", html: screenAndCaption },
      { label: "Growing", html: growingTall },
      { label: "Animated", html: animatedTall },
    ],
  });
  const context = page.locator(".ask-context:visible iframe");
  const options = page.locator(".ask-option:visible");
  await expect(options).toHaveCount(3);
  await expect(context.contentFrame().getByText("Caption")).toBeAttached();
  const screenPreview = preview(options.nth(0));
  await expect(screenPreview.contentFrame().getByText("Caption")).toBeAttached();
  // Chasing a page always a caption taller than itself, a frame grew by the caption a round: give it the time.
  await page.waitForTimeout(2_000);
  const heights = () => Promise.all([context, screenPreview].map((frame) => frame.evaluate((node: HTMLIFrameElement) => node.clientHeight)));
  const settled = await heights();
  for (const height of settled) expect(height).toBeLessThan(1_000);
  await page.waitForTimeout(1_000);
  expect(await heights()).toEqual(settled);

  const grown = preview(options.nth(1));
  await expect.poll(() => grown.contentFrame().locator("#tall").evaluate((node: HTMLElement) => node.style.height)).toBe("1200px");
  await expect.poll(() => grown.contentFrame().locator("html").evaluate((root) => root.scrollHeight - root.clientHeight)).toBe(0);
  // Growing every frame, it stays ahead of its frame until it stops. Started in view: a browser draws no frame offscreen.
  const animated = preview(options.nth(2));
  await animated.scrollIntoViewIfNeeded();
  const animatedBox = animated.contentFrame().locator("#animated");
  await animatedBox.evaluate((node: HTMLElement) => (node.style.height = "900px"));
  await expect.poll(() => animatedBox.evaluate((node) => node.getBoundingClientRect().height)).toBe(900);
  await expect.poll(() => animated.contentFrame().locator("html").evaluate((root) => root.scrollHeight - root.clientHeight)).toBe(0);
  await answerCanvasQuestion(page, "Screen");
});

test("a question asked while its conversation isn't shown opens with its pages at their starting size, not the size they had hidden", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 1000 });
  await signIn(page, host);
  const hidden = await startConversation(page);
  await startConversation(page);
  const sceneAndCaption = `<canvas id="scene" style="display:block;background:#eef"></canvas><p>Caption</p>
<script>
  const scene = document.getElementById("scene");
  const fitToWindow = () => {
    scene.style.width = innerWidth + "px";
    scene.style.height = innerHeight + "px";
  };
  fitToWindow();
  addEventListener("resize", fitToWindow);
</script>`;
  askInBackground(hidden, {
    question: "Asked while hidden?",
    html: sceneAndCaption,
    options: [{ label: "Text", html: fluid("Just a line of text") }, { label: "Viewport", html: viewportWide }, { label: "Plain" }],
  });
  // Hidden, a page is laid out in no room: the scene has no height, and the page is as tall as its caption.
  await page.waitForTimeout(2_000);
  await page.evaluate((id) => (location.hash = `#/c/${id}`), hidden);
  await expect(page.getByRole("heading", { name: "Asked while hidden?" })).toBeVisible();
  const context = page.locator(".ask-context:visible iframe");
  const scene = context.contentFrame().locator("#scene");
  await expect.poll(() => scene.evaluate((node) => node.getBoundingClientRect().height)).toBeGreaterThan(300);
  const text = page.locator(".ask-option:visible iframe").first();
  const textFrameHeight = () => text.evaluate((node: HTMLIFrameElement) => node.clientHeight);
  const textPageHeight = () => text.contentFrame().locator("html").evaluate((root) => Math.ceil(root.getBoundingClientRect().height));
  // Its frame still measures the page it shows, so a line of text gets a line's height.
  await expect.poll(async () => (await textFrameHeight()) - (await textPageHeight())).toBe(0);
  expect(await textFrameHeight()).toBeLessThan(100);
  // Hidden, its window had no width at all: shown, it takes its column's.
  await expectAsWideAsItsColumn(page.locator(".ask-option:visible").nth(1));
  await answerCanvasQuestion(page, "Plain");
});

test("a question that arrives together with the answer to the one before it takes the canvas", async ({ page }) => {
  let heldAnswer: string | null = null;
  await page.routeWebSocket(/\/ws\?/, (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => server.send(message));
    server.onMessage((message) => {
      const text = String(message);
      if (/"type":"canvas\.upserted"/.test(text) && /"status":"answered"/.test(text)) return void (heldAnswer = text);
      if (heldAnswer && /"type":"canvas\.upserted"/.test(text) && /"status":"waiting"/.test(text)) {
        socket.send(heldAnswer);
        heldAnswer = null;
      }
      socket.send(message);
    });
  });
  await signIn(page, host);
  const conversationId = await startConversation(page);
  const options = page.locator(".ask-option:visible");

  askInBackground(conversationId, { question: "Which colour?", options: [{ label: "Green" }, { label: "Blue" }] });
  await expect(options.first()).toHaveText(/Green/);
  await answerCanvasQuestion(page, "Green");
  await expect.poll(() => heldAnswer).not.toBeNull();

  askInBackground(conversationId, { question: "Which size?", options: [{ label: "Huge" }, { label: "Small" }] });
  await expect(options.first()).toHaveText(/Huge/);
  await answerCanvasQuestion(page, "Huge");
});
