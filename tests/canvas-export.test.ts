import { afterAll, describe, expect, test } from "bun:test";
import { assetPackageVersion, resolveAsset } from "../host/canvas/assets.ts";
import { inlineScript, standalonePage } from "../host/canvas/export.ts";
import { MAX_SENT_IMAGE_BYTES, refuseOversizedImage, writeImageToClipboard } from "../web/canvas-export.ts";

const ORIGIN = "http://127.0.0.1:4601";
const PUBLIC_ORIGIN = "https://mirador.example.com:4601";
const CDN = "https://cdn.jsdelivr.net/npm";

const page = (html: string, title = "Page") => ({ title, html });

const readLibrary = (pathname: string) => Bun.file(resolveAsset(pathname)!).text();

const headLines = (output: string) => output.split("\n").slice(0, 6);

describe("standalonePage", () => {
  test("starts with one doctype, the charset, the colour scheme, the escaped title, the import map on the CDN and the page's style", async () => {
    const output = await standalonePage(page("<p>hi</p>", 'Tom & Jerry <3 > "x"'), [ORIGIN], "cdn");
    const threeCdn = `${CDN}/three@${assetPackageVersion("three")}`;
    const importMap = {
      imports: {
        three: `${threeCdn}/build/three.module.js`,
        "three/webgpu": `${threeCdn}/build/three.webgpu.js`,
        "three/tsl": `${threeCdn}/build/three.tsl.js`,
        "three/addons/": `${threeCdn}/examples/jsm/`,
      },
    };
    expect(headLines(output)).toEqual([
      "<!doctype html>",
      '<meta charset="utf-8">',
      '<meta name="color-scheme" content="light dark">',
      '<title>Tom &amp; Jerry &lt;3 &gt; "x"</title>',
      `<script type="importmap">${JSON.stringify(importMap)}</script>`,
      "<style>html{background:light-dark(#fff,#111);color:light-dark(#171717,#ececec);font-family:system-ui,sans-serif;overflow-wrap:break-word}</style>",
    ]);
    expect(output.split("\n").at(-1)).toBe("<p>hi</p>");
  });

  test("drops the page's own leading doctype, whatever its case", async () => {
    const output = await standalonePage(page("  <!DOCTYPE html>\n<p>hi</p>"), [ORIGIN], "cdn");
    expect(output.match(/<!doctype/gi)).toHaveLength(1);
    expect(output.endsWith("\n<p>hi</p>")).toBe(true);
  });

  test("on the CDN, points d3, mermaid and three's build and addons at jsDelivr with the installed versions", async () => {
    const html = [
      `<script src="${ORIGIN}/d3.min.js"></script>`,
      `<script src="${ORIGIN}/mermaid.min.js"></script>`,
      `<script type="module" src="${ORIGIN}/three/build/three.module.js"></script>`,
      `<script type="module">import { OrbitControls } from "${ORIGIN}/three/addons/controls/OrbitControls.js";</script>`,
    ].join("\n");
    const output = await standalonePage(page(html), [ORIGIN], "cdn");
    expect(output).toContain(`${CDN}/d3@${assetPackageVersion("d3")}/dist/d3.min.js"></script>`);
    expect(output).toContain(`${CDN}/mermaid@${assetPackageVersion("mermaid")}/dist/mermaid.min.js"></script>`);
    expect(output).toContain(`${CDN}/three@${assetPackageVersion("three")}/build/three.module.js"></script>`);
    expect(output).toContain(`${CDN}/three@${assetPackageVersion("three")}/examples/jsm/controls/OrbitControls.js`);
    expect(output).not.toContain(ORIGIN);
    expect(output).not.toContain("<script>");
  });

  test("inline, puts d3's file into a script tag with no src, byte for byte", async () => {
    const d3 = await readLibrary("/d3.min.js");
    const output = await standalonePage(page(`<script src="${ORIGIN}/d3.min.js"></script>`), [ORIGIN], "inline");
    expect(output).toContain(`<script>${d3}</script>`);
    expect(output).not.toContain("<script src");
    expect(output).not.toContain(`${ORIGIN}/d3.min.js`);
  });

  test("inline, takes mermaid's tag with single quotes, another attribute and spaces before the close", async () => {
    const mermaid = await readLibrary("/mermaid.min.js");
    const html = `<script async src='${ORIGIN}/mermaid.min.js' crossorigin="anonymous" ></script >`;
    const output = await standalonePage(page(html), [ORIGIN], "inline");
    expect(output).toContain(`<script>${mermaid}</script>`);
    expect(output).not.toContain("<script src");
  });

  test("inline, keeps three on the CDN, as its modules import each other", async () => {
    const html = `<script type="module" src="${ORIGIN}/three/build/three.module.js"></script>`;
    const output = await standalonePage(page(html), [ORIGIN], "inline");
    expect(output).toContain(`${CDN}/three@${assetPackageVersion("three")}/build/three.module.js"></script>`);
    expect(output).not.toContain(ORIGIN);
  });

  test("on the CDN, rewrites the libraries at every address they are served from", async () => {
    const html = [`<script src="${ORIGIN}/d3.min.js"></script>`, `<script src="${PUBLIC_ORIGIN}/mermaid.min.js"></script>`].join("\n");
    const output = await standalonePage(page(html), [PUBLIC_ORIGIN, ORIGIN], "cdn");
    expect(output).toContain(`${CDN}/d3@${assetPackageVersion("d3")}/dist/d3.min.js"></script>`);
    expect(output).toContain(`${CDN}/mermaid@${assetPackageVersion("mermaid")}/dist/mermaid.min.js"></script>`);
    expect(output).not.toContain(ORIGIN);
    expect(output).not.toContain(PUBLIC_ORIGIN);
  });

  test("inline, puts in the libraries named at any address they are served from", async () => {
    const [d3, mermaid] = await Promise.all([readLibrary("/d3.min.js"), readLibrary("/mermaid.min.js")]);
    const html = [`<script src="${ORIGIN}/d3.min.js"></script>`, `<script src="${PUBLIC_ORIGIN}/mermaid.min.js"></script>`].join("\n");
    const output = await standalonePage(page(html), [PUBLIC_ORIGIN, ORIGIN], "inline");
    expect(output).toContain(`<script>${d3}</script>`);
    expect(output).toContain(`<script>${mermaid}</script>`);
    expect(output).not.toContain("<script src");
  });

  test("matches the origin literally, even with characters that mean something in a regular expression", async () => {
    const ipv6Origin = "http://[::1]:4601";
    const d3 = await readLibrary("/d3.min.js");
    const output = await standalonePage(page(`<script src="${ipv6Origin}/d3.min.js"></script>`), [ipv6Origin], "inline");
    expect(output).toContain(`<script>${d3}</script>`);
    expect(output).not.toContain(ipv6Origin);
  });
});

describe("inlineScript", () => {
  test("writes every closing script tag in the text so it cannot end the tag early, whatever its case", () => {
    expect(inlineScript('a("</SCRIPT>"); b("</script"); c()')).toBe('<script>a("<\\/SCRIPT>"); b("<\\/script"); c()</script>');
  });
});

// WebKit hands out its own NotAllowedError for a write whose promise was rejected, hiding why; the pin below keeps the capture's reason the one the user reads.
Object.defineProperty(globalThis, "ClipboardItem", { value: class {}, configurable: true });
const REFUSED = "NotAllowedError: the clipboard refused the write";
const refusedWrite = { write: () => Promise.reject(new Error(REFUSED)) };
afterAll(() => Reflect.deleteProperty(globalThis, "ClipboardItem"));

describe("the page image on its way to the project and the clipboard", () => {
  test("the capture's own failure wins over the clipboard's refusal", async () => {
    await expect(writeImageToClipboard(Promise.reject(new Error("The page could not be drawn.")), refusedWrite)).rejects.toThrow("The page could not be drawn.");
  });

  test("keeps the clipboard's refusal when the capture came", async () => {
    const drawn = Promise.resolve(new Blob(["x"], { type: "image/png" }));
    await expect(writeImageToClipboard(drawn, refusedWrite)).rejects.toThrow(REFUSED);
  });

  test("refuses the first byte past the cap, and passes the last image whose encoded message still fits", () => {
    expect(() => refuseOversizedImage(new Blob([new Uint8Array(MAX_SENT_IMAGE_BYTES + 1)]))).toThrow("The page's image is too large to send to the host.");
    const lastFits = new Blob([new Uint8Array(MAX_SENT_IMAGE_BYTES)]);
    expect(refuseOversizedImage(lastFits)).toBe(lastFits);
  });
});
