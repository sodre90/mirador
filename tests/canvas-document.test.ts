import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveAsset, serveCanvasAssets } from "../host/canvas/assets.ts";
import { APP_STORAGE_CHARACTERS, type AppStorageItems } from "../shared/apps.ts";
import {
  APP_ANSWER_MS,
  appAnswerFailedMessage,
  appAnswerMessage,
  appFileFailedMessage,
  appFileMessage,
  appViewPage,
  buildCanvasDocument,
  CANVAS_MESSAGE_SOURCE,
  CANVAS_SHELL_PAGE,
  CANVAS_SHELL_PATH,
  canvasShellUrl,
  HIDDEN_ERROR_SCRIPT,
  TEXT_CONTRAST_SCRIPT,
  pluginItemPage,
} from "../shared/canvas-document.ts";

const assetsOrigin = "http://127.0.0.1:4601";

describe("buildCanvasDocument", () => {
  test("only a markable page lets the user mark part of it, with the marking script before the agent's markup", () => {
    const marked = buildCanvasDocument("<p>plan</p>", "item", assetsOrigin, "light", { markable: true });
    expect(marked).toContain('document.createElement("mirador-marks")');
    expect(marked.indexOf('document.createElement("mirador-marks")')).toBeLessThan(marked.indexOf("<p>plan</p>"));
    expect(buildCanvasDocument("<p>plan</p>", "item", assetsOrigin, "light")).not.toContain('document.createElement("mirador-marks")');
  });

  test("puts the CSP before any agent markup, even for a full document with its own doctype", () => {
    const document = buildCanvasDocument("<!DOCTYPE html><html><head><script>evil()</script></head></html>", "item", assetsOrigin, "light");
    expect(document.startsWith("<!doctype html>\n<meta http-equiv=\"Content-Security-Policy\"")).toBe(true);
    expect(document.match(/<!doctype/gi)).toHaveLength(1);
    expect(document.indexOf("connect-src 'none'")).toBeLessThan(document.indexOf("evil()"));
  });

  test("lets images and media load from where the canvas assets stream an app's files, and from nowhere else on the network", () => {
    const document = buildCanvasDocument("<p>", "item", assetsOrigin, "light");
    expect(document).toContain(`img-src data: blob: ${assetsOrigin}/media/;`);
    expect(document).toContain(`media-src data: blob: ${assetsOrigin}/media/;`);
    expect(document).toContain("default-src 'none'");
  });

  test("a plugin's view may load images from other sites, while Settings let them load; nothing else on the network opens to it", () => {
    const document = buildCanvasDocument("<p>", "item", assetsOrigin, "light", { policy: { imagesFromOtherSites: true } });
    expect(document).toContain(`img-src data: blob: ${assetsOrigin}/media/ https: http:;`);
    expect(document).toContain(`media-src data: blob: ${assetsOrigin}/media/;`);
    expect(document).toContain("connect-src 'none'");
  });

  test("maps three and its addons to the assets origin", () => {
    const document = buildCanvasDocument("<p>", "item", assetsOrigin, "light");
    expect(document).toContain(`"three":"${assetsOrigin}/three/build/three.module.js"`);
    expect(document).toContain(`"three/addons/":"${assetsOrigin}/three/addons/"`);
  });

  test("a padded page keeps its side spacing on html, ahead of the agent's own styles; other pages are left as the agent wrote them", () => {
    const agentStyle = "<style>body{margin:0}</style>";
    const padded = buildCanvasDocument(agentStyle, "item", assetsOrigin, "light", { padded: true });
    expect(padded.indexOf("html{padding:0 8px}body{margin-left:0;margin-right:0}")).toBeGreaterThan(-1);
    expect(padded.indexOf("html{padding:0 8px}")).toBeLessThan(padded.indexOf(agentStyle));
    expect(buildCanvasDocument(agentStyle, "item", assetsOrigin, "light")).not.toContain("html{padding");
  });

  test("embeds the item id safely in the error reporter", () => {
    const document = buildCanvasDocument("<p>", '"; alert(1); "', assetsOrigin, "light");
    expect(document).toContain(JSON.stringify('"; alert(1); "'));
  });
});

interface PageScript {
  text: string;
  src: string;
  type: string;
}
type HiddenErrorMessage = (pageScripts: PageScript[], freshScripts: PageScript[]) => string;
const hiddenErrorMessage = new Function(`${HIDDEN_ERROR_SCRIPT}; return hiddenErrorMessage;`)() as HiddenErrorMessage;
const pageScript = (text: string, { src = "", type = "" } = {}): PageScript => ({ text, src, type });
const HIDDEN_THROW = "A script on the page threw an error; this browser hides its message.";

describe("hiddenErrorMessage", () => {
  test("names the syntax error WebKit hid, as WebKit's own parser words it, and the script it is in", () => {
    const fine = pageScript("const ok = 1;");
    const broken = pageScript('draw("c1", [[[p32, "l32"]], [[p8, "l8"]]]], 200);', { type: "text/javascript" });
    expect(hiddenErrorMessage([fine, broken], [broken])).toBe(
      "SyntaxError: Unexpected token ']'. Expected ')' to end an argument list. (script 2 on the page)",
    );
  });

  test("a script that parses threw as it ran, which WebKit does not tell", () => {
    const thrower = pageScript("undefinedFunction();");
    expect(hiddenErrorMessage([thrower], [thrower])).toBe(HIDDEN_THROW);
  });

  test("only the page's own classic scripts are parsed again: not one loaded from elsewhere, a module or data", () => {
    const scripts = [
      pageScript("", { src: "https://assets/d3.min.js" }),
      pageScript("import { x } from 'y'; x(", { type: "module" }),
      pageScript("{ not js", { type: "application/json" }),
    ];
    expect(hiddenErrorMessage(scripts, scripts)).toBe(HIDDEN_THROW);
  });
});

type ReadableTextColor = (color: string, backgrounds: string[], scheme: "light" | "dark") => string | null;
const readableTextColor = new Function(`${TEXT_CONTRAST_SCRIPT}; return readableTextColor;`)() as ReadableTextColor;

describe("readableTextColor", () => {
  test("dark theme text on a light code background takes the light theme's text colour", () => {
    expect(readableTextColor("rgb(236, 236, 236)", ["rgb(244, 244, 245)", "rgb(17, 17, 17)"], "dark")).toBe("rgb(23, 23, 23)");
  });

  test("light theme text on a dark code block takes the dark theme's text colour", () => {
    expect(readableTextColor("rgb(23, 23, 23)", ["rgb(29, 33, 40)"], "light")).toBe("rgb(236, 236, 236)");
  });

  test("muted text that still reads is left as the page has it", () => {
    expect(readableTextColor("rgb(115, 115, 115)", ["rgb(255, 255, 255)"], "light")).toBeNull();
    expect(readableTextColor("rgb(139, 148, 158)", ["rgb(17, 17, 17)"], "dark")).toBeNull();
    expect(readableTextColor("rgb(153, 153, 153)", ["rgb(255, 255, 255)"], "light")).toBeNull();
  });

  test("grey text that all but vanishes into the background takes the theme text colour", () => {
    expect(readableTextColor("rgb(68, 68, 68)", ["rgb(17, 17, 17)"], "dark")).toBe("rgb(236, 236, 236)");
    expect(readableTextColor("rgb(170, 170, 170)", ["rgb(255, 255, 255)"], "light")).toBe("rgb(23, 23, 23)");
  });

  test("a see-through background is judged with what shows through it", () => {
    expect(readableTextColor("rgb(236, 236, 236)", ["rgba(255, 255, 255, 0.9)", "rgba(0, 0, 0, 0)", "rgb(17, 17, 17)"], "dark")).toBe("rgb(23, 23, 23)");
    expect(readableTextColor("rgb(236, 236, 236)", ["rgba(255, 255, 255, 0.05)", "rgb(17, 17, 17)"], "dark")).toBeNull();
  });

  test("with no background of its own all the way out, the text is judged on the theme's page colour", () => {
    expect(readableTextColor("rgb(240, 240, 240)", ["rgba(0, 0, 0, 0)"], "light")).toBe("rgb(23, 23, 23)");
    expect(readableTextColor("rgb(240, 240, 240)", ["rgba(0, 0, 0, 0)"], "dark")).toBeNull();
  });

  test("leaves text alone that is meant to be faint or whose colours it cannot read", () => {
    expect(readableTextColor("rgba(0, 0, 0, 0)", ["rgb(255, 255, 255)"], "light")).toBeNull();
    expect(readableTextColor("rgba(255, 255, 255, 0.3)", ["rgb(255, 255, 255)"], "light")).toBeNull();
    expect(readableTextColor("oklch(0.95 0 0)", ["rgb(255, 255, 255)"], "light")).toBeNull();
    expect(readableTextColor("rgb(250, 250, 250)", ["color(srgb 1 1 1)"], "light")).toBeNull();
  });
});

describe("resolveAsset", () => {
  test("serves library files", () => {
    expect(resolveAsset("/d3.min.js")).toEndWith(join("d3", "dist", "d3.min.js"));
    expect(resolveAsset("/three/addons/controls/OrbitControls.js")).toEndWith(join("three", "examples", "jsm", "controls", "OrbitControls.js"));
  });

  test("refuses paths outside the mounted directories", () => {
    expect(resolveAsset("/three/addons/../../package.json")).toBeNull();
    expect(resolveAsset("/three/addons/%2e%2e/%2e%2e/package.json")).toBeNull();
    expect(resolveAsset("/etc/passwd")).toBeNull();
  });
});

describe("serveCanvasAssets", () => {
  test("serves the shell canvas frames load with the canvas policy, sandboxed wherever it is framed, and never from a cache", async () => {
    const server = serveCanvasAssets(0);
    try {
      const response = await fetch(`http://127.0.0.1:${server.port}${CANVAS_SHELL_PATH}`);
      const policy = response.headers.get("content-security-policy");
      // 'self' alone matches nothing in a sandboxed frame on WebKit, which there blocks every library: the address the request came in on is named beside it.
      expect(policy).toContain(`script-src 'unsafe-inline' 'unsafe-eval' blob: 'self' http://127.0.0.1:${server.port}`);
      expect(policy).toContain("connect-src 'none'");
      expect(policy).toContain(`media-src data: blob: http://127.0.0.1:${server.port}/media/;`);
      expect(policy).toEndWith("sandbox allow-scripts");
      expect(response.headers.get("cache-control")).toBe("no-cache");
      expect(await response.text()).toBe(CANVAS_SHELL_PAGE);
    } finally {
      server.stop(true);
    }
  });

  test("serves the shell with images from other sites let in only when its address asks for them", async () => {
    const server = serveCanvasAssets(0);
    const origin = `http://127.0.0.1:${server.port}`;
    try {
      const policyAt = async (url: string) => (await fetch(url)).headers.get("content-security-policy");
      expect(await policyAt(canvasShellUrl(origin, { imagesFromOtherSites: true }))).toContain(`img-src data: blob: ${origin}/media/ https: http:;`);
      expect(await policyAt(canvasShellUrl(origin))).toContain(`img-src data: blob: ${origin}/media/;`);
      expect(await policyAt(`${canvasShellUrl(origin)}?images=other-sites&more`)).toContain(`img-src data: blob: ${origin}/media/;`);
    } finally {
      server.stop(true);
    }
  });

  test("names the addresses pages are given for the assets too, as a proxy in front may hand on a Host of its own", async () => {
    const publicOrigin = "https://mirador.example.com:8443";
    const server = serveCanvasAssets(0, { knownOrigins: [publicOrigin] });
    try {
      const response = await fetch(`http://127.0.0.1:${server.port}${CANVAS_SHELL_PATH}`);
      expect(response.headers.get("content-security-policy")).toContain(`'self' http://127.0.0.1:${server.port} ${publicOrigin};`);
    } finally {
      server.stop(true);
    }
  });

  test("streams the file an open app's view was granted, in the ranges asked for, to the sandboxed page, never from a cache", async () => {
    const clip = join(mkdtempSync(join(tmpdir(), "media-")), "clip.webm");
    writeFileSync(clip, "0123456789");
    const granted = "/media/token/clip.webm";
    const server = serveCanvasAssets(0, { appMediaFile: (pathname) => (pathname === granted ? clip : null) });
    try {
      const response = await fetch(`http://127.0.0.1:${server.port}${granted}?v=1`, { headers: { Range: "bytes=2-5", Origin: "null" } });
      expect(response.status).toBe(206);
      expect(await response.text()).toBe("2345");
      expect(response.headers.get("content-range")).toBe("bytes 2-5/10");
      expect(response.headers.get("content-type")).toBe("video/webm");
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
      expect(response.headers.get("cache-control")).toBe("no-store");
      const whole = await fetch(`http://127.0.0.1:${server.port}${granted}`);
      expect([whole.status, await whole.text(), whole.headers.get("accept-ranges")]).toEqual([200, "0123456789", "bytes"]);
      expect((await fetch(`http://127.0.0.1:${server.port}/media/other/clip.webm`)).status).toBe(404);
    } finally {
      server.stop(true);
    }
  });
});

interface FrameWindow {
  mirador: {
    readFile(path: string): Promise<Blob>;
    mediaUrl(path: string): Promise<string>;
    prompt(text: string, options?: { images?: Blob[] }): Promise<void>;
    run(task: string): void;
    stopTask(): void;
    storage: Storage;
  };
  localStorage: Storage;
}

/** A sandboxed frame's: reading its localStorage throws. */
const sandboxedWindow = () => Object.defineProperty({}, "localStorage", { configurable: true, get: () => { throw new DOMException("The document is sandboxed", "SecurityError"); } });

/**
 * The app page's bridge, run against a stand-in window whose parent records what the view posts and whose clock the test
 * turns; the page starts with `storage` kept.
 */
function runAppBridge({ storage = {} as AppStorageItems, frameWindow = {} as object } = {}) {
  const posted: Record<string, unknown>[] = [];
  const listeners: ((event: { source: unknown; data: unknown }) => void)[] = [];
  const timers: { fire: () => void; delay: number }[] = [];
  const parent = { postMessage: (message: Record<string, unknown>) => posted.push(message) };
  const setTimer = (fire: () => void, delay: number) => timers.push({ fire, delay });
  const bridge = appViewPage("http://assets/view.js", "app:w1/counter", storage).match(/^<script>([\s\S]*?)<\/script>/)![1]!;
  new Function("window", "parent", "addEventListener", "setTimeout", "clearTimeout", bridge)(frameWindow, parent, (_: string, listener: (typeof listeners)[number]) => listeners.push(listener), setTimer, () => {});
  const answer = (data: unknown, source: unknown = parent) => listeners.forEach((listener) => listener({ source, data }));
  const frame = frameWindow as FrameWindow;
  return { mirador: frame.mirador, frameWindow: frame, posted, answer, timers };
}

const storageSets = (posted: Record<string, unknown>[]) => posted.filter(({ kind }) => kind === "app-storage-set").map(({ key, value }) => [key, value]);

describe("an app view's window.mirador.storage", () => {
  test("starts with what the workspace kept, and reads like localStorage", () => {
    const { storage } = runAppBridge({ storage: { step: "2", panel: "closed" } }).mirador;
    expect([storage.getItem("step"), storage.getItem("missing"), storage.length, storage.key(1), storage.key(5)]).toEqual(["2", null, 2, "panel", null]);
  });

  test("posts each change for the host to keep, as text, and nothing for a change that changes nothing", () => {
    const { mirador, posted } = runAppBridge({ storage: { step: "2" } });
    mirador.storage.setItem("step", "2");
    mirador.storage.setItem("count", 3 as unknown as string);
    mirador.storage.removeItem("step");
    mirador.storage.removeItem("missing");
    expect(mirador.storage.getItem("count")).toBe("3");
    expect(posted.find(({ kind }) => kind === "app-storage-set")).toEqual({ source: CANVAS_MESSAGE_SOURCE, itemId: "app:w1/counter", kind: "app-storage-set", key: "count", value: "3" });
    expect(storageSets(posted)).toEqual([["count", "3"], ["step", null]]);
  });

  test("clears item by item", () => {
    const { mirador, posted } = runAppBridge({ storage: { a: "1", b: "2" } });
    mirador.storage.clear();
    expect(mirador.storage.length).toBe(0);
    expect(storageSets(posted)).toEqual([["a", null], ["b", null]]);
  });

  test("throws QuotaExceededError for an item that doesn't fit, as localStorage does, and keeps nothing of it", () => {
    const { mirador, posted } = runAppBridge({ storage: { a: "x".repeat(APP_STORAGE_CHARACTERS - 3) } });
    mirador.storage.setItem("b", "y");
    const refusal = (() => {
      try {
        mirador.storage.setItem("c", "z");
      } catch (error) {
        return error as DOMException;
      }
    })();
    expect(refusal?.name).toBe("QuotaExceededError");
    mirador.storage.removeItem("b");
    mirador.storage.setItem("c", "z");
    expect(storageSets(posted)).toEqual([["b", "y"], ["b", null], ["c", "z"]]);
  });

  test("is the view's localStorage, both where the frame's own throws and where the page has a working one, as a WebView does", () => {
    const sandboxed = runAppBridge({ frameWindow: sandboxedWindow() });
    expect(sandboxed.frameWindow.localStorage).toBe(sandboxed.mirador.storage);
    const inAWebView = runAppBridge({ frameWindow: { localStorage: { getItem: () => "the device's" } } });
    expect(inAWebView.frameWindow.localStorage).toBe(inAWebView.mirador.storage);
  });

  test("starts with values that hold a closing script tag", () => {
    const page = appViewPage("http://assets/view.js", "app:w1/counter", { note: "</script><script>alert(1)</script>" });
    expect(page.match(/<\/script>/g)).toHaveLength(2);
    expect(runAppBridge({ storage: { note: "</script>" } }).mirador.storage.getItem("note")).toBe("</script>");
  });
});

describe("an app view's window.mirador.readFile", () => {
  test("posts the request for the path, and resolves with the bytes it is answered with, typed", async () => {
    const { mirador, posted, answer } = runAppBridge();
    const reading = mirador.readFile("textures/1.jpg");
    const request = posted.find(({ kind }) => kind === "app-read-file")!;
    expect(request).toEqual({ source: CANVAS_MESSAGE_SOURCE, itemId: "app:w1/counter", kind: "app-read-file", requestId: expect.any(String), path: "textures/1.jpg" });
    answer(appFileMessage(request.requestId as string, new TextEncoder().encode("hello").buffer as ArrayBuffer, "image/png"));
    const blob = await reading;
    expect(blob.type).toBe("image/png");
    expect(await blob.text()).toBe("hello");
  });

  test("rejects with the reason it is answered with", async () => {
    const { mirador, posted, answer } = runAppBridge();
    const reading = mirador.readFile("../outside.txt");
    answer(appFileFailedMessage(posted.find(({ kind }) => kind === "app-read-file")!.requestId as string, "../outside.txt is outside the document's folder."));
    await expect(reading).rejects.toThrow("../outside.txt is outside the document's folder.");
  });

  test("keeps two reads apart, and ignores an answer from a window that is not its parent", async () => {
    const { mirador, posted, answer } = runAppBridge();
    const first = mirador.readFile("a.txt");
    const second = mirador.readFile("b.txt");
    const [firstId, secondId] = posted.filter(({ kind }) => kind === "app-read-file").map(({ requestId }) => requestId as string);
    expect(firstId).not.toBe(secondId);
    answer(appFileMessage(firstId!, new ArrayBuffer(1), "text/plain"), {});
    answer(appFileMessage(secondId!, new TextEncoder().encode("b").buffer as ArrayBuffer, "text/plain"));
    expect(await (await second).text()).toBe("b");
    const settled = await Promise.race([first.then(() => "answered"), Bun.sleep(20).then(() => "waiting")]);
    expect(settled).toBe("waiting");
  });

  test("rejects when Mirador doesn't answer in time, as on the phone", async () => {
    const { mirador, timers } = runAppBridge();
    const reading = mirador.readFile("a.txt");
    expect(timers.map(({ delay }) => delay)).toEqual([APP_ANSWER_MS]);
    timers[0]!.fire();
    await expect(reading).rejects.toThrow("Mirador didn't answer the request for a.txt.");
  });
});

describe("an app view's window.mirador.mediaUrl", () => {
  test("asks for the path, and resolves with the address it is answered with", async () => {
    const { mirador, posted, answer } = runAppBridge();
    const asking = mirador.mediaUrl("clips/a.mp4");
    const request = posted.find(({ kind }) => kind === "app-media-url")!;
    expect(request).toEqual({ source: CANVAS_MESSAGE_SOURCE, itemId: "app:w1/counter", kind: "app-media-url", requestId: expect.any(String), path: "clips/a.mp4" });
    answer(appAnswerMessage(request.requestId as string, "http://assets/media/t/a.mp4?v=1"));
    expect(await asking).toBe("http://assets/media/t/a.mp4?v=1");
  });

  test("rejects with the reason it is answered with, or when Mirador doesn't answer in time", async () => {
    const { mirador, posted, answer, timers } = runAppBridge();
    const refused = mirador.mediaUrl("../a.mp4");
    answer(appAnswerFailedMessage(posted.find(({ kind }) => kind === "app-media-url")!.requestId as string, "../a.mp4 is outside the document's folder."));
    await expect(refused).rejects.toThrow("../a.mp4 is outside the document's folder.");
    const unanswered = mirador.mediaUrl("b.mp4");
    timers.at(-1)!.fire();
    await expect(unanswered).rejects.toThrow("Mirador didn't answer the request for b.mp4.");
  });
});

describe("an app view's window.mirador.prompt", () => {
  test("posts the words with their pictures, and resolves once the panel says the message went", async () => {
    const { mirador, posted, answer } = runAppBridge();
    const frame = new Blob(["png"], { type: "image/png" });
    let sent = false;
    const sending = mirador.prompt("What is here?", { images: [frame] }).then(() => (sent = true));
    const request = posted.find(({ kind }) => kind === "app-prompt")!;
    expect(request).toEqual({ source: CANVAS_MESSAGE_SOURCE, itemId: "app:w1/counter", kind: "app-prompt", requestId: expect.any(String), text: "What is here?", images: [frame] });
    await Bun.sleep(5);
    expect(sent).toBe(false);
    answer(appAnswerMessage(request.requestId as string, null));
    await sending;
    expect(sent).toBe(true);
  });

  test("sends words alone, and rejects with the reason the message can't go", async () => {
    const { mirador, posted, answer } = runAppBridge();
    const sending = mirador.prompt("Hello");
    const request = posted.find(({ kind }) => kind === "app-prompt")!;
    expect(request.images).toEqual([]);
    answer(appAnswerFailedMessage(request.requestId as string, "A message can carry at most 4 images."));
    await expect(sending).rejects.toThrow("A message can carry at most 4 images.");
  });
});

describe("an app view's window.mirador.run and stopTask", () => {
  test("post the task to run, and the stop, for the panel to hand on", () => {
    const { mirador, posted } = runAppBridge();
    mirador.run("render");
    mirador.stopTask();
    expect(posted.filter(({ kind }) => kind === "app-run" || kind === "app-stop-task")).toEqual([
      { source: CANVAS_MESSAGE_SOURCE, itemId: "app:w1/counter", kind: "app-run", task: "render" },
      { source: CANVAS_MESSAGE_SOURCE, itemId: "app:w1/counter", kind: "app-stop-task" },
    ]);
  });
});

describe("the messages that answer what an app view asks for", () => {
  test("carry the request id with the bytes and their type, the answer, or the reason", () => {
    const bytes = new ArrayBuffer(2);
    expect(appFileMessage("r1", bytes, "image/png")).toEqual({ source: CANVAS_MESSAGE_SOURCE, kind: "app-file", requestId: "r1", bytes, type: "image/png" });
    expect(appFileFailedMessage("r1", "nope")).toEqual({ source: CANVAS_MESSAGE_SOURCE, kind: "app-file-failed", requestId: "r1", message: "nope" });
    expect(appAnswerMessage("r2", "http://assets/media/t/a.mp4")).toEqual({ source: CANVAS_MESSAGE_SOURCE, kind: "app-answer", requestId: "r2", value: "http://assets/media/t/a.mp4" });
    expect(appAnswerFailedMessage("r2", "nope")).toEqual({ source: CANVAS_MESSAGE_SOURCE, kind: "app-answer-failed", requestId: "r2", message: "nope" });
  });
});

test("a plugin's view can open files only where its page says files open, as Mirador's canvas does and the phone doesn't", () => {
  expect(pluginItemPage("https://assets/view.js", "item-1", { opensFiles: true })).toContain('kind: "item-open-file"');
  expect(pluginItemPage("https://assets/view.js", "item-1")).not.toContain("openFile");
});
