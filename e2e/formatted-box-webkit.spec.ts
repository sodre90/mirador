import { devices, test } from "@playwright/test";
import { formattedBoxTests } from "./formatted-box.tests.ts";

/** As the desktop app is: WebKit on a Mac, so the page takes the macOS keys, such as Home and End, as it does there. */
test.use({ ...devices["Desktop Safari"], channel: "", launchOptions: {}, viewport: { width: 1600, height: 1000 } });
test.skip(process.platform === "win32", "The Windows app is WebView2, which the Chromium run covers; Playwright's WebKit for Windows is a port no Mirador runs in");

formattedBoxTests();
