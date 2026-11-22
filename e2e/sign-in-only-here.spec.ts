import { connect, createServer, type Server } from "node:net";
import { expect, test, type Page } from "@playwright/test";
import { BROWSER_TOKEN_ONLY_HERE } from "../host/from-this-computer.ts";
import { TOKEN_COOKIE } from "../shared/protocol.ts";
import { freePorts } from "./free-ports.ts";
import { openSettings, signIn } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

/** Where a stand-in for `tailscale serve` listens, in front of the host's own port, as another computer reaches it. */
let publicPort = 0;
const publicOrigin = () => `http://localhost:${publicPort}`;
const host = new TestHost({
  environment: () => ({ MIRADOR_PUBLIC_ORIGIN: publicOrigin(), MIRADOR_PUBLIC_CANVAS_ORIGIN: `http://localhost:${publicPort + 1}` }),
});
let forwarder: Server | null = null;

/** Passes every connection on to the host as it is, adding nothing, as a forward on this computer does. */
function forward(fromPort: number, toPort: number) {
  const server = createServer((client) => {
    const upstream = connect(toPort, "127.0.0.1");
    const closeBoth = () => {
      client.destroy();
      upstream.destroy();
    };
    client.on("error", closeBoth);
    upstream.on("error", closeBoth);
    client.pipe(upstream).pipe(client);
  });
  return new Promise<Server>((resolve) => server.listen(fromPort, "127.0.0.1", () => resolve(server)));
}

test.beforeAll(async () => {
  publicPort = await freePorts(2);
  await host.start();
  forwarder = await forward(publicPort, host.port);
});
test.afterAll(async () => {
  forwarder?.close();
  await host.stop();
  await host.cleanUp();
});

const browserToken = () => new URL(host.authUrl).searchParams.get("token")!;
const atPublicAddress = (link: string) => {
  const url = new URL(link);
  return `${publicOrigin()}${url.pathname}${url.search}`;
};

async function inviteCode(page: Page) {
  const settings = await openSettings(page, "Devices");
  await settings.getByRole("button", { name: "Invite a device" }).click();
  const code = (await settings.locator(".invite-code").textContent())!;
  await settings.getByRole("button", { name: "Close" }).click();
  return code;
}

test("a browser at another address is told the host's own sign-in works only on its computer, and joins with a device invite instead", async ({ page, browser }) => {
  const elsewhere = await browser.newContext();
  const other = await elsewhere.newPage();

  await test.step("the sign-in link, with the token or a one-time code, shows why it does not sign in there", async () => {
    await other.goto(atPublicAddress(host.authUrl));
    await expect(other.getByText(BROWSER_TOKEN_ONLY_HERE)).toBeVisible();
    const link = /(http:\/\/\S+\/auth\?code=\S+)/.exec(host.mirador("sign-in"))![1]!;
    await other.goto(atPublicAddress(link));
    await expect(other.getByText(BROWSER_TOKEN_ONLY_HERE)).toBeVisible();
    await page.goto(link);
    await expect(page.getByText("No conversation selected"), "the code tried at the other address still signs in this computer's browser").toBeVisible();
  });

  await test.step("the token put in a cookie there signs in nobody", async () => {
    await elsewhere.addCookies([{ name: TOKEN_COOKIE, value: browserToken(), url: publicOrigin() }]);
    await other.goto(publicOrigin());
    await expect(other.getByRole("heading", { name: "Join this machine" })).toBeVisible();
  });

  await test.step("a device invite from Settings → Devices signs it in", async () => {
    await signIn(page, host);
    const code = await inviteCode(page);
    await other.getByLabel("Name this device").fill("Laptop");
    await other.getByLabel("Invite code").fill(code);
    await other.getByRole("button", { name: "Join", exact: true }).click();
    await expect(other.getByRole("button", { name: "Settings…" })).toBeVisible();
  });
  await elsewhere.close();
});

test("a browser at this computer's own address through a proxy that says so is told the same", async ({ browser }) => {
  const throughTailscaleServe = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "100.101.5.7", "x-forwarded-proto": "https", "tailscale-user-login": "someone@github" } });
  const other = await throughTailscaleServe.newPage();
  await other.goto(host.authUrl);
  await expect(other.getByText(BROWSER_TOKEN_ONLY_HERE)).toBeVisible();
  await throughTailscaleServe.close();
});
