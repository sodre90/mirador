import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Locator } from "@playwright/test";
import { addWorkspace, callCanvasTool, signIn, startConversation } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();

/** A view that sizes itself to the window with its own style block, as plugins' views do when they build their page from script. */
const VIEW = `
const style = document.createElement("style");
style.textContent = "#wide{width:100vw;height:40px;background:#eef;display:flex;justify-content:space-between;align-items:center}";
document.head.append(style);
const wide = document.createElement("div");
wide.id = "wide";
wide.innerHTML = "<b>START</b><b>END</b>";
document.body.append(wide);
window.mirador.onItem(() => {});
`;

const scaleOf = (frame: Locator) =>
  frame.evaluate((node) => {
    const transform = getComputedStyle(node).transform;
    return transform === "none" ? 1 : new DOMMatrixReadOnly(transform).a;
  });

const PLUGIN_HOST = `
export default {
  items: { wide: { icon: "◔", placement: "tab" } },
  tools: {
    show_wide: {
      description: "Show a view as wide as its window in the tab.",
      input: { type: "object", properties: { title: { type: "string" } }, required: ["title"] },
      run(input, { publish }) {
        publish({ type: "wide", title: input.title, data: {} });
        return "Shown.";
      },
    },
  },
  activity() {},
};
`;

test.beforeAll(async () => {
  const folder = join(host.dataDir, "plugins", "wide");
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "plugin.json"), JSON.stringify({ name: "wide", title: "Wide", version: "1.0.0", api: 20, canvas: { host: "host.ts", view: "canvas.js" } }));
  writeFileSync(join(folder, "host.ts"), PLUGIN_HOST);
  writeFileSync(join(folder, "canvas.js"), VIEW);
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

test("a plugin's tab view sized to the window keeps its column's width rather than widening round after round", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 1000 });
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const conversationId = await startConversation(page);
  expect(await callCanvasTool(host, conversationId, "show_wide", { title: "Wide" })).toBe("Shown.");
  const frame = page.locator(".checklist:visible .canvas-frame.plugin iframe");
  const view = frame.contentFrame();
  await expect(view.locator("#wide")).toBeAttached();
  // Chasing its own 100vw content, the frame would grow a few dozen pixels a round up to 2400px, scaled down to a sliver: give it the time.
  await page.waitForTimeout(2_000);
  const column = page.locator(".checklist:visible .canvas-frame.plugin");
  await expect(async () => {
    const [wide, columnBox] = await Promise.all([view.locator("#wide").boundingBox(), column.boundingBox()]);
    const share = wide!.width / columnBox!.width;
    expect(share).toBeGreaterThan(0.9);
    expect(share).toBeLessThan(1.01);
    expect(await scaleOf(frame)).toBeGreaterThan(0.9);
  }).toPass({ timeout: 5_000 });
  await expect(view.getByText("END")).toBeInViewport({ ratio: 0.99 });
});
