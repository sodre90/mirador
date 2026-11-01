import { defineConfig } from "@playwright/test";

/** The browser is set up by capture/studio.ts: a 4K window at 250% zoom. */
export default defineConfig({
  testDir: "capture",
  timeout: 900_000,
  expect: { timeout: 60_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  use: { trace: "off", screenshot: "off", actionTimeout: 30_000 },
});
