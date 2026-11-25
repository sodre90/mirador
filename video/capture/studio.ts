import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test as base, chromium, type BrowserContext } from "@playwright/test";
import { FRAME } from "./frame.ts";

/**
 * Chrome's screencast hands over frames no larger than the window's own size, whatever the device scale, so 4K frames
 * need a 4K window. The app shows at 250% zoom (FRAME.scale) so it lays out at a clean laptop width while drawing
 * every pixel, canvas, and terminal at crisp 4K resolution.
 */
export const test = base.extend<{ context: BrowserContext }>({
  context: async ({}, use) => {
    const profile = mkdtempSync(join(tmpdir(), "mirador-video-chrome-"));
    mkdirSync(join(profile, "Default"));
    const zoomLevel = Math.log(FRAME.scale) / Math.log(1.2);
    writeFileSync(join(profile, "Default", "Preferences"), JSON.stringify({ partition: { default_zoom_level: { x: zoomLevel } } }));
    const context = await chromium.launchPersistentContext(profile, {
      channel: process.platform === "darwin" ? "chrome" : undefined,
      headless: true,
      viewport: { width: FRAME.width, height: FRAME.height },
      deviceScaleFactor: 1,
      args: [`--window-size=${FRAME.width},${FRAME.height}`, `--screen-info={${FRAME.width}x${FRAME.height}}`, "--hide-scrollbars", "--disable-audio-output"],
    });
    await use(context);
    await context.close();
    rmSync(profile, { recursive: true, force: true });
  },
  page: async ({ context }, use) => {
    await use(context.pages()[0] ?? (await context.newPage()));
  },
});

export { expect } from "@playwright/test";
