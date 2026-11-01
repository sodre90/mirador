import { canvasImportMap } from "../../shared/canvas-document.ts";
import type { PageLibraries } from "../../shared/canvas-export.ts";
import { assetPackageVersion, resolveAsset } from "./assets.ts";

const CDN_NPM = "https://cdn.jsdelivr.net/npm";
const LEADING_DOCTYPE = /^\s*<!doctype[^>]*>/i;
const INLINED_LIBRARY_FILES = ["d3.min.js", "mermaid.min.js"];
const PAGE_STYLE = "<style>html{background:light-dark(#fff,#111);color:light-dark(#171717,#ececec);font-family:system-ui,sans-serif;overflow-wrap:break-word}</style>";

type Rewrite = [from: string, to: string];

function cdnRewrites(assetsOrigins: string[]): Rewrite[] {
  const threeVersion = assetPackageVersion("three");
  const libraryPaths: Rewrite[] = [
    ["/d3.min.js", `${CDN_NPM}/d3@${assetPackageVersion("d3")}/dist/d3.min.js`],
    ["/mermaid.min.js", `${CDN_NPM}/mermaid@${assetPackageVersion("mermaid")}/dist/mermaid.min.js`],
    ["/three/build/", `${CDN_NPM}/three@${threeVersion}/build/`],
    ["/three/addons/", `${CDN_NPM}/three@${threeVersion}/examples/jsm/`],
  ];
  return assetsOrigins.flatMap((origin) => libraryPaths.map(([path, cdn]): Rewrite => [`${origin}${path}`, cdn]));
}

const rewriteToCdn = (text: string, rewrites: Rewrite[]) => rewrites.reduce((result, [from, to]) => result.replaceAll(from, to), text);

function cdnImportMap(assetsOrigin: string, rewrites: Rewrite[]) {
  const { imports } = canvasImportMap(assetsOrigin);
  return { imports: Object.fromEntries(Object.entries(imports).map(([specifier, address]) => [specifier, rewriteToCdn(address, rewrites)])) };
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const escapeText = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const readLibrary = (pathname: string) => Bun.file(resolveAsset(pathname)!).text();

/** Keeps the library's text from ending the tag it sits in. */
export function inlineScript(text: string) {
  return `<script>${text.replace(/<\/(script)/gi, "<\\/$1")}</script>`;
}

function libraryScriptTagPattern(assetsOrigins: string[]) {
  const origins = assetsOrigins.map(escapeRegExp).join("|");
  const files = INLINED_LIBRARY_FILES.map(escapeRegExp).join("|");
  return new RegExp(`<script\\b[^>]*?\\ssrc\\s*=\\s*(["'])(?:${origins})/(${files})\\1[^>]*>\\s*</script\\s*>`, "g");
}

async function inlineLibraries(html: string, assetsOrigins: string[]) {
  const usedFiles = INLINED_LIBRARY_FILES.filter((file) => assetsOrigins.some((origin) => html.includes(`${origin}/${file}`)));
  const scripts = new Map(await Promise.all(usedFiles.map(async (file) => [file, inlineScript(await readLibrary(`/${file}`))] as const)));
  return html.replace(libraryScriptTagPattern(assetsOrigins), (tag, _quote, file: string) => scripts.get(file) ?? tag);
}

export async function standalonePage(page: { title: string; html: string }, assetsOrigins: string[], libraries: PageLibraries): Promise<string> {
  const rewrites = cdnRewrites(assetsOrigins);
  const body = page.html.replace(LEADING_DOCTYPE, "");
  const inlined = libraries === "inline" ? await inlineLibraries(body, assetsOrigins) : body;
  return [
    "<!doctype html>",
    '<meta charset="utf-8">',
    '<meta name="color-scheme" content="light dark">',
    `<title>${escapeText(page.title)}</title>`,
    `<script type="importmap">${JSON.stringify(cdnImportMap(assetsOrigins[0]!, rewrites))}</script>`,
    PAGE_STYLE,
    rewriteToCdn(inlined, rewrites),
  ].join("\n");
}
