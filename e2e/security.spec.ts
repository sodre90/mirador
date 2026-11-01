import { expect, test, type Page } from "@playwright/test";
import { PROFILE_LAUNCH_PARAMETER, TOKEN_COOKIE } from "../shared/protocol.ts";
import { addWorkspace, callCanvasTool, signIn, startConversation } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();

test.beforeAll(() => host.start());
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

test("rejects browsers and clients without the right credentials", async ({ page }) => {
  await page.goto(`${host.origin}/`);
  await expect(page.getByRole("heading", { name: "Join this machine" })).toBeVisible();

  expect((await fetch(`${host.origin}/auth?token=wrong`, { redirect: "manual" })).status).toBe(403);

  const signedIn = await fetch(host.authUrl, { redirect: "manual" });
  const cookie = signedIn.headers.get("set-cookie")!.split(";")[0]!;
  expect(signedIn.headers.get("set-cookie")).toContain("HttpOnly");
  expect(signedIn.headers.get("set-cookie")).toContain("SameSite=Strict");

  for (const socketPath of ["/ws", "/notifications"]) {
    const upgrade = (headers: Record<string, string>) => fetch(`${host.origin}${socketPath}`, { headers }).then(({ status }) => status);
    expect(await upgrade({ Origin: "http://evil.example", Cookie: cookie })).toBe(403);
    expect(await upgrade({ Origin: "null", Cookie: cookie })).toBe(403);
    expect(await upgrade({ Origin: host.origin })).toBe(401);
  }

  const mcp = (headers: Record<string, string>) =>
    fetch(`${host.origin}/mcp/anything`, { method: "POST", headers, body: "{}" }).then(({ status }) => status);
  expect(await mcp({})).toBe(401);
  expect(await mcp({ Authorization: "Bearer wrong" })).toBe(401);
  expect(await mcp({ Authorization: `Bearer ${host.mcpToken}`, Origin: host.origin })).toBe(403);

  for (const [path, body] of [
    ["messages", "hello"],
    ["job-waits", JSON.stringify({ job: { kind: "process", pid: process.pid } })],
  ]) {
    const scriptRequest = (headers: Record<string, string>) =>
      fetch(`${host.origin}/sessions/anything/${path}`, { method: "POST", headers, body }).then(({ status }) => status);
    expect(await scriptRequest({})).toBe(401);
    expect(await scriptRequest({ Authorization: `Bearer ${host.mcpToken}` })).toBe(401);
    expect(await scriptRequest({ Authorization: `Bearer ${host.scriptToken}`, Origin: host.origin })).toBe(403);
    expect(await scriptRequest({ Authorization: `Bearer ${host.scriptToken}` })).toBe(404);
  }

  const images = `${host.origin}/conversations/00000000-0000-0000-0000-000000000000/images`;
  const addImage = (headers: Record<string, string>) =>
    fetch(images, { method: "POST", headers: { "Content-Type": "image/png", ...headers }, body: "png" }).then(({ status }) => status);
  const readImage = (headers: Record<string, string>) => fetch(`${images}/x.png`, { headers }).then(({ status }) => status);
  expect(await addImage({ Origin: host.origin })).toBe(401);
  expect(await addImage({ Origin: "http://evil.example", Cookie: cookie })).toBe(403);
  expect(await addImage({ Cookie: cookie })).toBe(403);
  expect(await readImage({})).toBe(401);
  expect(await readImage({ Cookie: cookie, "Sec-Fetch-Site": "cross-site" })).toBe(403);
  expect(await readImage({ Cookie: cookie })).toBe(404);
});

test("the page loads nothing and connects to nothing but its own host, as its Content-Security-Policy says", async ({ page }) => {
  await page.goto(`${host.origin}/`);
  const [policy, imagePolicy] = await page
    .locator("meta[http-equiv='Content-Security-Policy']")
    .evaluateAll((policies) => policies.map((meta) => meta.getAttribute("content")));
  expect(policy).toContain("script-src 'self'");
  expect(policy).toContain("connect-src 'self'");
  expect(imagePolicy, "images from other sites stay blocked until Settings allows them").toBe("img-src 'self' data: blob:");

  const inlineScriptRan = await page.evaluate(async () => {
    const probe = document.createElement("script");
    probe.textContent = "window.__miradorCspProbe = true";
    document.head.append(probe);
    await new Promise((wait) => setTimeout(wait, 250));
    return "__miradorCspProbe" in window;
  });
  expect(inlineScriptRan).toBe(false);
});

test("a browser signs in with a one-time link from mirador sign-in, and the host logs with timestamps and no token where no terminal reads it", async ({ page }) => {
  const browserToken = new URL(host.authUrl).searchParams.get("token")!;
  expect(host.log).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z Mirador is running/m);
  expect(host.log).not.toContain(browserToken);
  expect(host.log).not.toContain("/auth?");

  const link = /(http:\/\/\S+\/auth\?code=\S+)/.exec(host.mirador("sign-in"))![1]!;
  await page.goto(link);
  await expect(page.getByText("No conversation selected")).toBeVisible();
  expect(page.url()).toBe(`${host.origin}/`);

  const usedAgain = await fetch(link, { redirect: "manual" });
  expect(usedAgain.status).toBe(403);
  expect(await usedAgain.text()).toContain("mirador sign-in");
});

/** The profiles in the snapshot a socket of the page gets, opened with the given query. */
const snapshotProfiles = (page: Page, query: string) =>
  page.evaluate(
    (query) =>
      new Promise<{ name: string; environment: string; prelaunch: string }[]>((resolve) => {
        const socket = new WebSocket(`${location.origin.replace(/^http/, "ws")}/ws${query}`);
        socket.onmessage = ({ data }) => {
          const message = JSON.parse(String(data));
          if (message.type !== "snapshot") return;
          socket.close();
          resolve(message.profiles);
        };
      }),
    query,
  );

test("a profile's environment and prelaunch command reach a joined device only when its page asks, as Mirador's own pages do and the phone app does not", async ({ page, browser }) => {
  const launch = { environment: "ANTHROPIC_API_KEY=sk-e2e-secret", prelaunch: "source ~/.work-keys" };
  await signIn(page, host);
  await page.evaluate(
    (profile) =>
      new Promise((resolve) => {
        const socket = new WebSocket(`${location.origin.replace(/^http/, "ws")}/ws`);
        socket.onopen = () => socket.send(JSON.stringify({ type: "profile.save", requestId: "save-work", profile }));
        socket.onmessage = ({ data }) => JSON.parse(String(data)).type === "profile.saved" && resolve(socket.close());
      }),
    { name: "Work", harness: "claude", ...launch, mode: null, effort: null, bypassPermissions: false, askMode: "wait", color: null },
  );

  const code = /Invite code: (\S+)/.exec(host.mirador("invite"))![1]!;
  const joined = await fetch(`${host.origin}/join`, { method: "POST", body: JSON.stringify({ code, name: "Phone" }) });
  const { token } = (await joined.json()) as { token: string };
  const device = await browser.newContext();
  await device.addCookies([{ name: TOKEN_COOKIE, value: token, url: host.origin }]);
  const devicePage = await device.newPage();
  await devicePage.goto(`${host.origin}/mirador-ca.pem`);

  expect(await snapshotProfiles(devicePage, "")).toContainEqual(expect.objectContaining({ name: "Work", environment: "", prelaunch: "" }));
  expect(await snapshotProfiles(devicePage, `?${PROFILE_LAUNCH_PARAMETER}`)).toContainEqual(expect.objectContaining({ name: "Work", ...launch }));
  await device.close();
});

test("a hostile canvas page cannot reach the host, the parent page or the network", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const conversationId = await startConversation(page);

  const hostile = `<h1>hostile</h1>
<script>
  fetch("${host.origin}/").then(() => console.error("LEAK fetch succeeded"), () => {});
  const socket = new WebSocket("ws://127.0.0.1:${host.port}/ws");
  socket.onopen = () => console.error("LEAK websocket opened");
  try { parent.document.title; console.error("LEAK parent document readable"); } catch {}
  try { if (document.cookie) console.error("LEAK cookie " + document.cookie); } catch {}
  try { top.location.href = "http://example.com/"; } catch {}
  try { if (window.open("http://example.com/")) console.error("LEAK popup opened"); } catch {}
  const image = new Image();
  image.src = "http://example.com/exfiltrate.png";
</script>`;
  const result = await callCanvasTool(host, conversationId, "show", { title: "Hostile", html: hostile });

  expect(result).toContain("reported errors");
  expect(result).toContain("connect-src");
  expect(result).toContain("img-src");
  expect(result).not.toContain("LEAK");
  await expect(page.locator(".canvas-panel:visible .canvas-frame.show iframe").contentFrame().getByRole("heading", { name: "hostile" })).toBeVisible();
  expect(new URL(page.url()).origin).toBe(host.origin);
  expect(page.context().pages()).toHaveLength(1);
});

test("canvas pages can load the bundled three.js, D3 and Mermaid", async ({ page }) => {
  await signIn(page, host);
  await page.locator(".workspace li").first().click();
  await expect(page.locator(".canvas-title")).toHaveText("Hostile");
  const conversationId = page.url().match(/#\/c\/(.+)$/)![1]!;

  const assetsOrigin = `http://127.0.0.1:${host.port + 1}`;
  const html = `<div id="out"></div>
<pre class="mermaid">graph TD; A-->B</pre>
<script src="${assetsOrigin}/d3.min.js"></script>
<script src="${assetsOrigin}/mermaid.min.js"></script>
<script>mermaid.initialize({ startOnLoad: true });</script>
<script type="module">
  import * as THREE from "three";
  import { OrbitControls } from "three/addons/controls/OrbitControls.js";
  document.getElementById("out").textContent = ["three " + THREE.REVISION, typeof OrbitControls, "d3 " + d3.version].join(" | ");
</script>`;
  const result = await callCanvasTool(host, conversationId, "show", { title: "Libraries", html });

  expect(result).toContain("rendered without script errors");
  const frame = page.locator(".canvas-panel:visible .canvas-frame.show iframe").contentFrame();
  await expect(frame.locator("#out")).toContainText(/three \d+ \| function \| d3 7/);
  await expect(frame.locator("pre.mermaid svg")).toBeVisible();
});
