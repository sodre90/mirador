import { connect, createServer, type Server } from "node:net";
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  addWorkspace,
  addWorkspaceFromSidebar,
  allowNotifications,
  callCanvasTool,
  clickLatestNotification,
  clickNotification,
  notificationsShown,
  openSettings,
  signIn,
  startConversation,
  workspaceCard,
} from "./helpers.ts";
import { CANVAS_SHELL_PATH } from "../shared/canvas-document.ts";
import { freePorts } from "./free-ports.ts";
import { TestHost } from "./test-host.ts";

/** Where the stand-in for tailscale serve listens, in front of the host's own port and its canvas port after it. */
let publicPort = 0;
const publicOrigin = () => `http://localhost:${publicPort}`;
const publicCanvasOrigin = () => `http://localhost:${publicPort + 1}`;
/** The server other devices reach at its public address. */
const host = new TestHost({
  environment: () => ({ MIRADOR_PUBLIC_ORIGIN: publicOrigin(), MIRADOR_PUBLIC_CANVAS_ORIGIN: publicCanvasOrigin() }),
});
/** The user's own computer, which opens the server as one of its machines. */
const laptop = new TestHost();

/** Stands in for tailscale serve: another address in front of the host, which keeps listening on 127.0.0.1 only. */
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

let forwarders: Server[] = [];

test.beforeAll(async () => {
  publicPort = await freePorts(2);
  await Promise.all([host.start(), laptop.start()]);
  forwarders = await Promise.all([forward(publicPort, host.port), forward(publicPort + 1, host.port + 1)]);
});
test.afterAll(async () => {
  forwarders.forEach((server) => server.close());
  await Promise.all([host.stop(), laptop.stop()]);
  await Promise.all([host.cleanUp(), laptop.cleanUp()]);
});

async function inviteLinkFrom(page: Page) {
  const settings = await openSettings(page, "Devices");
  await settings.getByRole("button", { name: "Invite a device" }).click();
  return { settings, link: (await settings.locator(".invite-link").textContent())! };
}

/** The conversation the machine's own page in the frame shows, from that page's address. */
const conversationInFrame = (page: Page) =>
  page
    .frames()
    .map((frame) => frame.url().match(/#\/c\/(.+)$/)?.[1])
    .find(Boolean);

test("another device joins the machine at its public address with an invite, and revoking it signs it out", async ({ page, browser }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const { settings, link } = await inviteLinkFrom(page);
  expect(link).toMatch(new RegExp(`^${publicOrigin()}/#/join/[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$`));

  const phone = await browser.newPage();
  await test.step("a device without an invite is asked for one", async () => {
    await phone.goto(publicOrigin());
    await expect(phone.getByRole("heading", { name: "Join this machine" })).toBeVisible();
  });

  await test.step("the invite link joins the device, which then works with the machine's workspaces", async () => {
    await phone.goto(link);
    await expect(workspaceCard(phone, host.projectDir)).toBeVisible();
    await expect(settings.locator(".device-list li")).toHaveCount(1);
    await expect(settings.locator(".device-name")).toHaveText(/^Chrome on /);
  });

  await test.step("a used invite lets nobody else in", async () => {
    const stranger = await browser.newPage();
    await stranger.goto(link);
    await expect(stranger.locator(".join-problem")).toHaveText("This invite code is wrong, used or expired. Ask for a new one.");
    await stranger.close();
  });

  await test.step("revoking the device signs it out at once", async () => {
    await settings.getByRole("button", { name: /^Revoke / }).click();
    await settings.getByRole("button", { name: /^Confirm: Revoke / }).click();
    await expect(phone.getByRole("heading", { name: "Join this machine" })).toBeVisible();
    await expect(settings.locator(".device-list .device-none")).toBeVisible();
  });
  await phone.close();
});

test("the laptop joins the server with an invite link and shows its own Mirador in the rail, through a relay only its pages can use", async ({ page, browser }) => {
  const server = await browser.newPage();
  await allowNotifications(server);
  await signIn(server, host);
  const serverOnly = join(host.root, "server-only");
  mkdirSync(serverOnly, { recursive: true });
  await addWorkspaceFromSidebar(server, serverOnly);
  const { settings, link } = await inviteLinkFrom(server);

  await allowNotifications(page);
  await signIn(page, laptop);
  const rail = page.getByRole("navigation", { name: "Machines" });
  const serverButton = rail.getByRole("button", { name: "Home server" });
  await expect(rail).toHaveCount(0);
  await page.getByRole("button", { name: "Machines…" }).click();
  const machines = page.getByRole("dialog", { name: "Machines" });
  const frame = page.frameLocator('iframe[title="Home server"]');
  let serverConversation = "";

  await test.step("the invite link joins this computer's host to the server, as one of its devices", async () => {
    await machines.getByLabel("Name").fill("Home server");
    await machines.getByLabel("Address or invite link").fill(link);
    await machines.getByRole("button", { name: "Add and join" }).click();
    await expect(machines.locator(".machine-list li")).toHaveText(new RegExp(`Home server\\s*${publicOrigin()}`));
    await expect(machines.locator(".machine-not-joined")).toHaveCount(0);
    await expect(settings.locator(".device-name", { hasText: /^Mirador on / })).toBeVisible();

    await machines.getByLabel("Address or invite link").fill(`${publicOrigin()}/`);
    await expect(machines.getByText("This machine is already in the list.")).toBeVisible();
    await expect(machines.getByRole("button", { name: "Add", exact: true })).toBeDisabled();
  });

  await test.step("opening it shows the server's own Mirador next to the rail, which works there as at the server", async () => {
    await machines.getByRole("button", { name: "Open", exact: true }).click();
    await expect(machines).toHaveCount(0);
    await expect(serverButton).toHaveAttribute("aria-current", "true");
    await expect(page).toHaveURL(/#\/m\/[\w-]+$/);
    const card = workspaceCard(frame, serverOnly);
    await card.getByRole("button", { name: "+ New conversation" }).click();
    await expect(frame.locator(".chat-header:visible").getByLabel("Model", { exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("No conversation selected")).toBeHidden();
    await expect.poll(() => conversationInFrame(page)).toBeTruthy();
    serverConversation = conversationInFrame(page)!;
  });

  await test.step("its canvas pages load their libraries from this computer, whose browser need not trust the server's certificate", async () => {
    const html = `<div id="out"></div><script src="${publicCanvasOrigin()}/d3.min.js"></script><script>document.getElementById("out").textContent = "d3 " + d3.version;</script>`;
    void callCanvasTool(host, serverConversation, "show", { title: "Chart", html }).catch(() => {});
    const canvasPage = frame.locator(".canvas-panel:visible .canvas-frame.show iframe");
    await expect(canvasPage.contentFrame().locator("#out")).toHaveText(/^d3 7/);
    const laptopAssets = `http://127.0.0.1:${laptop.port + 1}`;
    expect(await canvasPage.getAttribute("src")).toBe(`${laptopAssets}${CANVAS_SHELL_PATH}`);
    await expect(canvasPage.contentFrame().locator("script[src$='/d3.min.js']")).toHaveAttribute("src", `${laptopAssets}/d3.min.js`);
  });

  await test.step("the page shows the server again after a reload, and this computer's own view at a click", async () => {
    await page.reload();
    await expect(workspaceCard(frame, serverOnly)).toBeVisible();
    await rail.getByRole("button", { name: "This computer" }).click();
    await expect(page.getByText("No conversation selected")).toBeVisible();
    await expect(page.locator('iframe[title="Home server"]')).toBeHidden();
    await expect(page).not.toHaveURL(/#\/m\//);
  });

  await test.step("a question at the server shows on its rail button, and its notification here opens the conversation in the frame", async () => {
    void callCanvasTool(host, serverConversation, "ask", { question: "Ship it?", options: [{ label: "Yes" }, { label: "No" }] }).catch(() => {});
    await expect(serverButton.locator(".rail-waiting")).toHaveText("1");
    await expect
      .poll(() => notificationsShown(page))
      .toEqual([{ title: "New conversation", body: "Home server · server-only · Asks: Ship it?", tag: serverConversation, closed: false }]);
    await clickLatestNotification(page);
    await expect(serverButton).toHaveAttribute("aria-current", "true");
    await expect(frame.locator(".ask")).toContainText("Ship it?");
  });

  await test.step("the server's own pages are notified too, but not its page in this computer's frame", async () => {
    await expect
      .poll(() => notificationsShown(server))
      .toEqual([{ title: "New conversation", body: "server-only · Asks: Ship it?", tag: serverConversation, closed: false }]);
    const serverPageInFrame = page.frames().find((candidate) => candidate.url().endsWith(`#/c/${serverConversation}`))!;
    expect(await notificationsShown(serverPageInFrame)).toEqual([]);
  });

  await test.step("the relay serves only this computer's signed-in pages, and only the machine's own page in the frame", async () => {
    const relay = new URL((await page.locator('iframe[title="Home server"]').getAttribute("src"))!).origin;
    expect((await fetch(`${relay}/ws`)).status).toBe(401);
    expect(await (await page.request.get(`${relay}/`, { headers: { origin: laptop.origin } })).text()).toBe("forbidden origin");
    const askedThroughRelay = await page.request.post(`${relay}/join-requests`, { data: {}, failOnStatusCode: false });
    expect(await askedThroughRelay.text()).toBe("This computer asks to join its machines itself, from its own window.");
  });

  await test.step("revoked on the server, it offers this computer's own ways to join again, and a new code joins it", async () => {
    await settings.locator(".device-list li", { hasText: "Mirador on " }).getByRole("button", { name: /^Revoke / }).click();
    await settings.getByRole("button", { name: /^Confirm: Revoke / }).click();
    await expect(serverButton).toHaveClass(/\baway\b/);
    await serverButton.click();
    const rejoin = page.getByRole("region", { name: "Join Home server" });
    await expect(rejoin.getByRole("button", { name: "Ask to join" })).toBeVisible();
    await expect(page.locator('iframe[title="Home server"]')).toHaveCount(0);
    await settings.getByRole("button", { name: "Invite a device" }).click();
    await expect(settings.locator(".invite-link")).not.toHaveText(link);
    await rejoin.getByLabel("Invite code or link").fill((await settings.locator(".invite-link").textContent())!);
    await rejoin.getByRole("button", { name: "Join", exact: true }).click();
    await expect(workspaceCard(frame, serverOnly)).toBeVisible();
    await expect(serverButton).not.toHaveClass(/\baway\b/);
  });
  await server.close();
});

test("a machine added by its address alone asks for an invite code in this computer's own window", async ({ page, browser }) => {
  const server = await browser.newPage();
  await signIn(server, host);
  await signIn(page, laptop);
  await addWorkspaceFromSidebar(page, laptop.projectDir);
  await startConversation(page);
  const deleteSelectedHere = page.locator(".workspace li.selected").getByRole("button", { name: "Delete conversation" });
  await expect(deleteSelectedHere).toBeVisible();
  await page.locator(".sidebar").getByRole("button", { name: "Machines…" }).click();
  const machines = page.getByRole("dialog", { name: "Machines" });
  await machines.getByLabel("Name").fill("Server nearby");
  await machines.getByLabel("Address or invite link").fill(host.origin);
  await machines.getByRole("button", { name: "Add", exact: true }).click();
  const added = machines.locator(".machine-list li", { hasText: "Server nearby" });
  await expect(added.locator(".machine-not-joined")).toBeVisible();
  await added.getByRole("button", { name: "Open", exact: true }).click();

  const join = page.getByRole("region", { name: "Join Server nearby" });
  const code = join.getByLabel("Invite code or link");
  await test.step("it shows a place for the code instead of the machine, which has nothing to show yet", async () => {
    await expect(join).toBeVisible();
    await expect(code).toBeFocused();
    await expect(page.locator('iframe[title="Server nearby"]')).toHaveCount(0);
    await expect(deleteSelectedHere, "nothing of this computer's own view shows through, not even buttons that show themselves").toBeHidden();
  });

  await test.step("a wrong code says why it did not join", async () => {
    await code.fill("AAAA-AAAA-AAAA");
    await join.getByRole("button", { name: "Join", exact: true }).click();
    await expect(join.locator(".join-problem")).toHaveText("This invite code is wrong, used or expired. Ask for a new one.");
  });

  await test.step("a pasted invite link joins, and the machine shows in its place", async () => {
    const { link } = await inviteLinkFrom(server);
    await code.fill(link);
    await join.getByRole("button", { name: "Join", exact: true }).click();
    await expect(page.frameLocator('iframe[title="Server nearby"]').getByRole("button", { name: "Settings…" })).toBeVisible();
    await expect(join).toHaveCount(0);
  });
  await server.close();
});

test("a machine left hidden for ten minutes lets go of its page, which comes back on the conversation it showed last", async ({ page }) => {
  await page.clock.install();
  await allowNotifications(page);
  await signIn(page, laptop);
  const rail = page.getByRole("navigation", { name: "Machines" });
  const serverButton = rail.getByRole("button", { name: "Home server" });
  const thisComputer = rail.getByRole("button", { name: "This computer" });
  const frameElement = page.locator('iframe[title="Home server"]');
  const frame = page.frameLocator('iframe[title="Home server"]');
  const markPage = async () => (await (await frameElement.elementHandle())!.contentFrame())!.evaluate(() => ((window as { marked?: boolean }).marked = true));
  const pageStillMarked = async () => (await (await frameElement.elementHandle())!.contentFrame())!.evaluate(() => (window as { marked?: boolean }).marked === true);
  const serverOnly = workspaceCard(frame, join(host.root, "server-only"));
  let shownLast = "";

  await test.step("a notification opens one conversation in the frame, and the reader goes on to another there", async () => {
    await serverButton.click();
    await serverOnly.locator("li").first().click();
    await expect.poll(() => conversationInFrame(page)).toBeTruthy();
    const asking = conversationInFrame(page)!;
    await thisComputer.click();
    void callCanvasTool(host, asking, "ask", { question: "Keep going?", options: [{ label: "Yes" }, { label: "No" }] }).catch(() => {});
    const homeServerAsks = "Home server · server-only · Asks: Keep going?";
    await expect.poll(() => notificationsShown(page)).toContainEqual(expect.objectContaining({ body: homeServerAsks }));
    await clickNotification(page, homeServerAsks);
    await expect(serverButton).toHaveAttribute("aria-current", "true");
    await expect.poll(() => conversationInFrame(page)).toBe(asking);
    await serverOnly.getByRole("button", { name: "+ New conversation" }).click();
    await expect.poll(() => conversationInFrame(page)).not.toBe(asking);
    shownLast = conversationInFrame(page)!;
    await markPage();
  });

  await test.step("shown again within ten minutes each time, the machine keeps its page", async () => {
    await thisComputer.click();
    await page.clock.fastForward("09:00");
    await serverButton.click();
    await thisComputer.click();
    await page.clock.fastForward("09:00");
    await expect(frameElement).toHaveCount(1);
    expect(await pageStillMarked()).toBe(true);
  });

  await test.step("hidden for ten minutes, it lets go of the page, and opens again where the reader was, not where the notification led", async () => {
    await page.clock.fastForward("01:01");
    await expect(frameElement).toHaveCount(0);
    await expect(serverButton.locator(".rail-waiting")).toHaveText("1");
    await serverButton.click();
    await expect(frameElement).toHaveAttribute("src", new RegExp(`#/c/${shownLast}$`));
    await expect(frame.locator(".workspace li.selected")).toBeVisible();
    expect(await pageStillMarked()).toBe(false);
  });
});

test("pages of other sites cannot join for their visitors", async () => {
  const otherOrigin = await fetch(`${publicOrigin()}/join`, {
    method: "POST",
    headers: { origin: "http://evil.example", "content-type": "application/json" },
    body: JSON.stringify({ code: "AAAA-AAAA-AAAA" }),
  });
  expect(await otherOrigin.text()).toBe("forbidden origin");
});
