import { expect, test, type APIRequestContext } from "@playwright/test";
import { createHash, X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { request as httpsRequest } from "node:https";
import { join } from "node:path";
import { connect as connectTls } from "node:tls";
import { TOKEN_COOKIE } from "../shared/protocol.ts";
import { addWorkspace, addWorkspaceFromSidebar, callCanvasTool, openSettings, signIn, startConversation, workspaceCard } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

/** Where the host serves the network: on the two ports after its own and its canvas port. */
const networkOriginAt = (port: number) => `https://127.0.0.1:${port + 2}`;
const networkCanvasOriginAt = (port: number) => `https://127.0.0.1:${port + 3}`;
/** On the network from its environment, at an address its own certificate covers wherever the tests run. */
const host = new TestHost({
  environment: (port) => ({ MIRADOR_NETWORK: "on", MIRADOR_PUBLIC_ORIGIN: networkOriginAt(port), MIRADOR_PUBLIC_CANVAS_ORIGIN: networkCanvasOriginAt(port) }),
});
const networkOrigin = () => networkOriginAt(host.port);
const networkCanvasOrigin = () => networkCanvasOriginAt(host.port);
const hostSwitchedInSettings = new TestHost();
/** Another computer's Mirador, which shows the host as one of its machines. */
const laptop = new TestHost();

test.beforeAll(async () => {
  await Promise.all([host.start(), hostSwitchedInSettings.start(), laptop.start()]);
});
test.afterAll(async () => {
  await Promise.all([host.stop(), hostSwitchedInSettings.stop(), laptop.stop()]);
  await Promise.all([host.cleanUp(), hostSwitchedInSettings.cleanUp(), laptop.cleanUp()]);
});

const authorityOf = (testHost: TestHost) => readFileSync(join(testHost.dataDir, "tls", "authority.pem"), "utf8");

/** Verified against the host's own authority alone, as a machine that pinned it connects. */
function fetchTrusting(authority: string, url: string) {
  return new Promise<string>((resolve, reject) => {
    httpsRequest(url, { ca: authority }, (response) => {
      let body = "";
      response.on("data", (chunk) => (body += chunk));
      response.on("end", () => resolve(body));
    })
      .on("error", reject)
      .end();
  });
}

async function statusOf(request: APIRequestContext, method: "get" | "post", url: string) {
  return (await request[method](url, { failOnStatusCode: false })).status();
}

test("a device joins over HTTPS with an invite link that names the host's certificate authority, and the network serves nothing only this machine may use", async ({
  page,
  browser,
}) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const settings = await openSettings(page, "Devices");
  const addressRoute = settings.getByRole("radio", { name: "At an address a proxy gives it" });
  await expect(addressRoute, "the address the environment sets is what invite links use").toBeChecked();
  await expect(addressRoute).toBeDisabled();
  await expect(settings).toContainText("The host's environment sets how other devices reach it");

  const authority = authorityOf(host);
  const fingerprint = createHash("sha256").update(new X509Certificate(authority).raw).digest("base64url");
  await settings.getByRole("button", { name: "Invite a device" }).click();
  const link = (await settings.locator(".invite-link").textContent())!;
  expect(link).toMatch(new RegExp(`^${networkOrigin()}/#/join/[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}/${fingerprint}$`));

  await test.step("the host's own certificate authority vouches for both of its network ports", async () => {
    expect(await fetchTrusting(authority, `${networkOrigin()}/mirador-ca.pem`)).toBe(authority);
    expect(await fetchTrusting(authority, `${networkCanvasOrigin()}/d3.min.js`)).toContain("d3js.org");
  });

  const phone = await browser.newPage({ ignoreHTTPSErrors: true });
  await test.step("the invite link joins a phone over HTTPS", async () => {
    await phone.goto(link);
    await expect(workspaceCard(phone, host.projectDir)).toBeVisible();
  });

  await test.step("the network port has no sign-in link, MCP endpoint or script messages", async () => {
    expect(await statusOf(phone.request, "get", `${networkOrigin()}/auth?token=anything`)).toBe(404);
    expect(await statusOf(phone.request, "post", `${networkOrigin()}/mcp/some-conversation`)).toBe(404);
    expect(await statusOf(phone.request, "post", `${networkOrigin()}/sessions/some-session/messages`)).toBe(404);
  });
  await phone.close();
});

test("the host's own page loads canvas libraries from this machine, though agents were given the network address", async ({ page }) => {
  await signIn(page, host);
  await addWorkspaceFromSidebar(page, host.projectDir);
  const conversationId = await startConversation(page);
  const html = `<div id="out"></div><script src="${networkCanvasOrigin()}/d3.min.js"></script><script>document.getElementById("out").textContent = "d3 " + d3.version;</script>`;
  const result = await callCanvasTool(host, conversationId, "show", { title: "Chart", html });

  expect(result, "this browser does not trust the host's own certificate authority").toContain("rendered without script errors");
  await expect(page.locator(".canvas-panel:visible .canvas-frame.show iframe").contentFrame().locator("#out")).toHaveText(/^d3 7/);
});

test("turning the network on in Settings takes effect when the host restarts", async ({ page }) => {
  await signIn(page, hostSwitchedInSettings);
  let settings = await openSettings(page, "Devices");
  const networkRoute = () => settings.getByRole("radio", { name: "Over the network, with no address" });
  await networkRoute().check();
  await settings.getByRole("button", { name: "Use this" }).click();
  await expect(settings.getByText("Saved. The host uses it from its next start.")).toBeVisible();
  expect(JSON.parse(readFileSync(join(hostSwitchedInSettings.dataDir, "config.json"), "utf8"))).toEqual({ network: true });

  await settings.getByRole("button", { name: "Restart host" }).click();
  await expect(settings, "the page reloads once the restarted host answers").toBeHidden({ timeout: 30_000 });
  settings = await openSettings(page, "Devices");
  await expect(networkRoute()).toBeChecked();
  await expect(settings.getByRole("link", { name: "certificate authority" })).toHaveAttribute("href", "/mirador-ca.pem");
  await expect(settings.getByText(new RegExp(`reach it directly at https://.+:${hostSwitchedInSettings.port + 2}`))).toBeVisible();
  const authority = authorityOf(hostSwitchedInSettings);
  expect(await fetchTrusting(authority, `${networkOriginAt(hostSwitchedInSettings.port)}/mirador-ca.pem`)).toBe(authority);

  await settings.getByRole("radio", { name: "Only on this machine" }).check();
  await settings.getByRole("button", { name: "Use this" }).click();
  await expect(settings.getByText("Saved. The host uses it from its next start.")).toBeVisible();
});

test("another Mirador joins over HTTPS only with the certificate authority the invite link names, then shows the host through it", async ({ page, browser }) => {
  const server = await browser.newPage();
  await signIn(server, host);
  const settings = await openSettings(server, "Devices");
  await settings.getByRole("button", { name: "Invite a device" }).click();
  const link = (await settings.locator(".invite-link").textContent())!;

  await signIn(page, laptop);
  await page.locator(".sidebar").getByRole("button", { name: "Machines…" }).click();
  const machines = page.getByRole("dialog", { name: "Machines" });
  await machines.getByLabel("Name").fill("Network box");
  await machines.getByLabel("Address or invite link").fill(networkOrigin());
  await machines.getByRole("button", { name: "Add", exact: true }).click();
  await machines.locator(".machine-list li", { hasText: "Network box" }).getByRole("button", { name: "Open", exact: true }).click();
  const join = page.getByRole("region", { name: "Join Network box" });
  const code = join.getByLabel("Invite code or link");

  await test.step("a link naming another certificate authority sends no code", async () => {
    await code.fill(link.replace(/[\w-]{43}$/, "A".repeat(43)));
    await join.getByRole("button", { name: "Join", exact: true }).click();
    await expect(join.locator(".join-problem")).toHaveText(
      "Network box's certificate authority is not the one in the invite link, so the code was not sent. Something on the network may be posing as Network box.",
    );
  });

  await test.step("the real link joins, and the host shows in the rail over its pinned certificate authority", async () => {
    await code.fill(link);
    await join.getByRole("button", { name: "Join", exact: true }).click();
    await expect(page.frameLocator('iframe[title="Network box"]').getByRole("button", { name: "Settings…" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Machines" }).getByRole("button", { name: "Network box" }), "the laptop keeps up with the host").not.toHaveClass(/away/);
    await expect(settings.locator(".device-name", { hasText: /^Mirador on / })).toBeVisible();
  });
  await server.close();
});

test("the network closes a connection that goes quiet after a request, so a device cannot hold the host's sockets open", async () => {
  const { hostname, port } = new URL(networkOrigin());
  const quietFor = await new Promise<{ answered: boolean; closedAfterMs: number }>((resolve) => {
    let answered = false;
    const opened = Date.now();
    const socket = connectTls({ host: hostname, port: Number(port), ca: authorityOf(host) }, () => {
      socket.write(`GET /mirador-ca.pem HTTP/1.1\r\nHost: ${hostname}:${port}\r\n\r\n`);
    });
    socket.on("data", () => (answered = true));
    socket.on("error", () => {});
    socket.on("close", () => resolve({ answered, closedAfterMs: Date.now() - opened }));
    setTimeout(() => socket.destroy(), 30_000);
  });
  expect(quietFor.answered).toBe(true);
  expect(quietFor.closedAfterMs).toBeLessThan(20_000);
});

/** Posts to the network a chunk every 2 s, 16 s in all, as a signed-in page on a slow connection does, and answers what came back. */
function trickleToTheNetwork(path: string, headers: string[], chunks: string[]) {
  const { hostname, port } = new URL(networkOrigin());
  const signedInCookie = `${TOKEN_COOKIE}=${new URL(host.authUrl).searchParams.get("token")}`;
  return new Promise<{ status: string; body: string }>((resolve) => {
    let received = "";
    const socket = connectTls({ host: hostname, port: Number(port), ca: authorityOf(host) }, async () => {
      socket.write(
        [
          `POST ${path} HTTP/1.1`,
          `Host: ${hostname}:${port}`,
          `Origin: ${networkOrigin()}`,
          `Cookie: ${signedInCookie}`,
          ...headers,
          `Content-Length: ${Buffer.byteLength(chunks.join(""))}`,
          "Connection: close",
          "",
          "",
        ].join("\r\n"),
      );
      for (const chunk of chunks) {
        await new Promise((wait) => setTimeout(wait, 2_000));
        if (!socket.destroyed) socket.write(chunk);
      }
    });
    socket.on("data", (data) => (received += data));
    socket.on("error", () => {});
    socket.on("close", () => {
      const [head = "", body = ""] = received.split("\r\n\r\n");
      resolve({ status: head.split("\r\n")[0] || "no answer", body });
    });
    setTimeout(() => socket.destroy(), 40_000);
  });
}

test("an image or file a device on a slow network sends still arrives, though it takes longer than a quiet connection may", async ({ page }) => {
  await signIn(page, host);
  await addWorkspaceFromSidebar(page, host.projectDir);
  const conversationId = await startConversation(page);
  const fileChunks = Array.from({ length: 8 }, (_, index) => `line ${index} of a file that trickles in\n`);
  const imageChunks = Array.from({ length: 8 }, (_, index) => `bytes ${index} of an image`);

  const [file, image] = await Promise.all([
    trickleToTheNetwork(`/conversations/${conversationId}/files`, ["Content-Type: application/octet-stream", "X-File-Name: notes.txt"], fileChunks),
    trickleToTheNetwork(`/conversations/${conversationId}/images`, ["Content-Type: image/png"], imageChunks),
  ]);

  expect(file.status, "the file took longer to arrive than Bun lets a request take by default").toBe("HTTP/1.1 200 OK");
  expect(readFileSync((JSON.parse(file.body) as { path: string }).path, "utf8")).toBe(fileChunks.join(""));
  expect(image.status, "the image took longer to arrive than Bun lets a request take by default").toBe("HTTP/1.1 200 OK");
  expect((JSON.parse(image.body) as { imageId: string }).imageId).toMatch(/\.png$/);
});
