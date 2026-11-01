import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 300_000,
  // A Windows runner under four workers needs more patience than a dev machine for the page to catch up.
  expect: { timeout: process.platform === "win32" ? 60_000 : 20_000 },
  workers: 4,
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    channel: process.platform === "darwin" ? "chrome" : undefined,
    viewport: { width: 1600, height: 1000 },
    // The specs read Mirador's English; a browser preferring another language must not turn it into that one.
    locale: "en-US",
    // Pages play their sounds to no speakers, so no run depends on this machine's output device, or is heard on it. A
    // spec's own launchOptions replace these, so it repeats the flag, as e2e/fake-microphone.ts does.
    launchOptions: { args: ["--disable-audio-output"] },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
