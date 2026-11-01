import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test as base, chromium, type BrowserContext } from "@playwright/test";
import { FRAME } from "./frame.ts";

/**
 * What Chrome's fake microphone hears, from the start each time it opens: the user's question in the voice scene, spoken
 * by bun run narrate, then silence for the dictation to hear it end.
 */
function microphoneFile(profile: string) {
  const file = join(profile, "microphone.wav");
  const question = join(import.meta.dirname, "..", "public", "narration", "voiceAsk.wav");
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", question, "-af", "apad=pad_dur=6", "-ar", "48000", "-ac", "1", file]);
  return file;
}

/**
 * Chrome's screencast hands over frames no larger than the window's own size, whatever the device scale, so 4K frames
 * need a 4K window. The app then shows at 250% zoom, as ⌘+ does: it lays out at a laptop's size and draws everything,
 * canvases and terminals too, at 2.5 pixels per point. Chrome keeps zoom in its profile, so each run starts a profile
 * of its own with that zoom.
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
      args: [
        `--window-size=${FRAME.width},${FRAME.height}`,
        `--screen-info={${FRAME.width}x${FRAME.height}}`,
        "--hide-scrollbars",
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
        `--use-file-for-fake-audio-capture=${microphoneFile(profile)}`,
        "--disable-audio-output",
      ],
      permissions: ["microphone"],
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
