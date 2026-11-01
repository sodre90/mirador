import { readFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { HERE_PATH } from "../addresses.ts";
import { APP_MEDIA_PATH } from "../../shared/apps.ts";
import { CANVAS_SHELL_PAGE, CANVAS_SHELL_PATH, canvasShellPolicy, CAPTURE_LIBRARY_PATH, shellPolicyAskedFor } from "../../shared/canvas-document.ts";

const packageDir = (name: string) => dirname(Bun.resolveSync(`${name}/package.json`, import.meta.dir));

export function assetPackageVersion(name: "d3" | "mermaid" | "three"): string {
  return JSON.parse(readFileSync(join(packageDir(name), "package.json"), "utf8")).version;
}

const mounts: Record<string, string> = {
  "/three/build/": join(packageDir("three"), "build"),
  "/three/addons/": join(packageDir("three"), "examples", "jsm"),
};

const singleFiles: Record<string, string> = {
  "/d3.min.js": join(packageDir("d3"), "dist", "d3.min.js"),
  "/mermaid.min.js": join(packageDir("mermaid"), "dist", "mermaid.min.js"),
  [CAPTURE_LIBRARY_PATH]: join(packageDir("modern-screenshot"), "dist", "index.mjs"),
};

/** Canvas pages run in opaque-origin iframes, so module imports from here need CORS. */
const corsHeaders = { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=3600" };

/** Not cached: after an update, the panel and the shell it writes into must speak the same version. The policy names the address each request came in on, so it is per request. */
const shellHeaders = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" };

export function resolveAsset(pathname: string): string | null {
  if (singleFiles[pathname]) return singleFiles[pathname];
  const mount = Object.keys(mounts).find((prefix) => pathname.startsWith(prefix));
  if (!mount) return null;
  const root = mounts[mount]!;
  const file = resolve(root, decodeURIComponent(pathname.slice(mount.length)));
  return file.startsWith(root + sep) ? file : null;
}

interface AssetsServing {
  certificate?: { chain: string; key: string } | null;
  /** The addresses pages are given for these assets. A proxy in front may hand the request a Host other than its own address. */
  knownOrigins?: string[];
  /** The code of an installed app's view, by the path it is served at; that path carries a hash of the code, so it never goes stale. */
  appViewCode?: (pathname: string) => Uint8Array<ArrayBuffer> | null;
  /** The file an open app's view was granted to stream at this path, if any. */
  appMediaFile?: (pathname: string) => string | null;
}

const appViewHeaders = { ...corsHeaders, "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "public, max-age=31536000, immutable" };

/** Bun answers a Range request for a file with just those bytes, so a video plays and seeks without loading all of it. Not cached: a render writes the same file again. */
const appMediaHeaders = { "Access-Control-Allow-Origin": "*", "Accept-Ranges": "bytes", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

/** On 127.0.0.1 for this machine's pages; with a certificate, on every network for other devices' pages. */
export function serveCanvasAssets(port: number, { certificate = null, knownOrigins = [], appViewCode = () => null, appMediaFile = () => null }: AssetsServing = {}) {
  return Bun.serve({
    hostname: certificate ? "0.0.0.0" : "127.0.0.1",
    port,
    ...(certificate && { tls: { cert: certificate.chain, key: certificate.key } }),
    async fetch(request) {
      if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
      const url = new URL(request.url);
      const { pathname } = url;
      if (pathname === HERE_PATH) return Response.json({ mirador: true }, { headers: corsHeaders });
      if (pathname === CANVAS_SHELL_PATH) {
        const policy = canvasShellPolicy([...new Set([url.origin, ...knownOrigins])], shellPolicyAskedFor(url));
        return new Response(CANVAS_SHELL_PAGE, { headers: { ...shellHeaders, "Content-Security-Policy": policy } });
      }
      const viewCode = pathname.startsWith("/apps/") ? appViewCode(pathname) : null;
      if (viewCode) return new Response(viewCode, { headers: appViewHeaders });
      if (pathname.startsWith(APP_MEDIA_PATH)) {
        const media = appMediaFile(pathname);
        if (!media || !(await Bun.file(media).exists())) return new Response("not found", { status: 404, headers: corsHeaders });
        return new Response(Bun.file(media), { headers: appMediaHeaders });
      }
      const file = resolveAsset(pathname);
      if (!file || !(await Bun.file(file).exists())) return new Response("not found", { status: 404, headers: corsHeaders });
      return new Response(Bun.file(file), { headers: corsHeaders });
    },
  });
}
