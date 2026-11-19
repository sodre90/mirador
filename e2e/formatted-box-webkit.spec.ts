import { devices, test } from "@playwright/test";
import { formattedBoxTests } from "./formatted-box.tests.ts";

/** As the desktop app is: WebKit on a Mac, so the page takes the macOS keys, such as Home and End, as it does there. */
test.use({ ...devices["Desktop Safari"], channel: "", launchOptions: {}, viewport: { width: 1600, height: 1000 } });
// The tests share one page. With the trace's screenshots on, WebKit spent ever more of each test encoding screencast
// frames, and the file took about 6 minutes instead of 15 seconds (Playwright 1.65).
test.use({ trace: { mode: "retain-on-failure", screenshots: false } });
test.skip(process.platform === "win32", "The Windows app is WebView2, which the Chromium run covers; Playwright's WebKit for Windows is a port no Mirador runs in");

formattedBoxTests();
