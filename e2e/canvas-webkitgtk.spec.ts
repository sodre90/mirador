import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";
import { buildCanvasDocument, CANVAS_MESSAGE_SOURCE, CANVAS_SHELL_PATH, canvasCaptureMessage, CAPTURE_LIBRARY_PATH } from "../shared/canvas-document.ts";
import { TestHost } from "./test-host.ts";

/**
 * The Linux desktop app draws canvas pages with the system's WebKitGTK, which matches 'self' in a sandboxed frame's
 * policy against nothing; Chromium and Playwright's own WebKit build load the libraries either way, so only this
 * engine tells whether the shell's policy lets a page load them. The Linux test image has it.
 */
const miniBrowser = ["x86_64-linux-gnu", "aarch64-linux-gnu"].map((triplet) => `/usr/lib/${triplet}/webkit2gtk-4.1/MiniBrowser`).find(existsSync);

const listening = (server: Server) => new Promise<number>((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)));

/** In front of the canvas assets, sending the upstream's own Host on, as nginx's proxy_pass does unless told otherwise. */
const proxy = createServer(async (request, response) => {
  const upstream = await fetch(`http://127.0.0.1:${host.port + 1}${request.url}`);
  response.writeHead(upstream.status, Object.fromEntries([...upstream.headers].filter(([name]) => !["content-encoding", "content-length"].includes(name))));
  response.end(Buffer.from(await upstream.arrayBuffer()));
});
let proxyPort = 0;
const host = new TestHost({
  environment: () => ({ MIRADOR_PUBLIC_ORIGIN: "http://localhost:1", MIRADOR_PUBLIC_CANVAS_ORIGIN: `http://localhost:${proxyPort}` }),
});

const PROBE_SOURCE = "webkitgtk-probe";

const pageUsingTheLibraries = (assetsOrigin: string) => `<p>Uses d3, three.js and the capture library</p>
<script src="${assetsOrigin}/d3.min.js"></script>
<script type="module">
  const loaded = { d3: typeof d3 };
  try { loaded.three = typeof (await import("three")).Scene; } catch (error) { loaded.three = String(error); }
  try { loaded.capture = typeof (await import("${assetsOrigin}${CAPTURE_LIBRARY_PATH}")).domToBlob; } catch (error) { loaded.capture = String(error); }
  parent.postMessage({ source: "${PROBE_SOURCE}", loaded }, "*");
</script>`;

/** The panel's part: frames the shell, gives it the page, asks it for an image once the page loaded, and posts back what came of it. */
const panel = (assetsOrigin: string) => `<!doctype html><iframe id="frame" sandbox="allow-scripts" src="${assetsOrigin}${CANVAS_SHELL_PATH}"></iframe>
<script>
  const frame = document.getElementById("frame");
  const page =${JSON.stringify(buildCanvasDocument(pageUsingTheLibraries(assetsOrigin), "item", assetsOrigin, "light")).replaceAll("</", "<\\/")};
  const result = { errors: [], loaded: null, image: null };
  const report = () => fetch("/result", { method: "POST", body: JSON.stringify(result) });
  setTimeout(report, 30000);
  addEventListener("message", ({ data }) => {
    if (data?.source === "${PROBE_SOURCE}") {
      result.loaded = data.loaded;
      frame.contentWindow.postMessage(${JSON.stringify(canvasCaptureMessage("capture"))}, "*");
    }
    if (data?.source !== "${CANVAS_MESSAGE_SOURCE}") return;
    if (data.kind === "shell-ready") frame.contentWindow.postMessage({ source: "${CANVAS_MESSAGE_SOURCE}", kind: "page", document: page }, "*");
    if (data.kind === "error") result.errors.push(data.message);
    if (data.kind === "captured") { result.image = "a PNG"; report(); }
    if (data.kind === "capture-failed") { result.image = data.message; report(); }
  });
</script>`;

interface Shown {
  errors: string[];
  loaded: Record<string, string> | null;
  image: string | null;
}

let reportResult = (_result: Shown) => {};
const panelServer = createServer((request, response) => {
  const url = new URL(request.url!, "http://panel");
  if (url.pathname === "/result") {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      reportResult(JSON.parse(body));
      response.end();
    });
    return;
  }
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(panel(url.searchParams.get("assets")!));
});
let panelPort = 0;

/** Shows the page in WebKitGTK's MiniBrowser on a display of its own, with the panel on an origin other than the assets', as the app's is. */
async function showInWebKitGtk(assetsOrigin: string): Promise<Shown> {
  const shown = new Promise<Shown>((resolve) => (reportResult = resolve));
  const browser = spawn("xvfb-run", ["-a", miniBrowser!, `http://127.0.0.1:${panelPort}/?assets=${encodeURIComponent(assetsOrigin)}`], {
    detached: true,
    stdio: "ignore",
    // Docker refuses the namespaces WebKitGTK's own sandbox needs; the sandbox is not what this checks.
    env: { ...process.env, WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS: "1" },
  });
  try {
    return await Promise.race([shown, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("WebKitGTK sent no report within 60 s")), 60_000))]);
  } finally {
    try {
      process.kill(-browser.pid!, "SIGTERM");
    } catch {
      // xvfb-run that failed at once took its process group with it.
    }
  }
}

test.skip(!miniBrowser, "needs WebKitGTK's MiniBrowser, which the Linux test image has");
test.beforeAll(async () => {
  const version = execFileSync("xvfb-run", ["-a", miniBrowser!, "--version"], { encoding: "utf8" }).split("\n").find((line) => line.startsWith("WebKitGTK"));
  console.log(`Shown in ${version}: an engine without the 'self' quirk would pass these on the old policy too.`);
  proxyPort = await listening(proxy);
  panelPort = await listening(panelServer);
  await host.start();
});
test.afterAll(async () => {
  proxy.close();
  panelServer.close();
  await host.stop();
  await host.cleanUp();
});

const expectLoadedAndDrawn = (shown: Shown) => {
  expect(shown.errors).toEqual([]);
  expect(shown.loaded).toEqual({ d3: "object", three: "function", capture: "function" });
  expect(shown.image).toBe("a PNG");
};

test("in WebKitGTK, a canvas page loads d3, three.js and the capture library, and draws as an image", async () => {
  expectLoadedAndDrawn(await showInWebKitGtk(`http://127.0.0.1:${host.port + 1}`));
});

test("in WebKitGTK, a canvas page loads its libraries at the public canvas address too, behind a proxy that passes on a Host of its own", async () => {
  expectLoadedAndDrawn(await showInWebKitGtk(`http://localhost:${proxyPort}`));
});
