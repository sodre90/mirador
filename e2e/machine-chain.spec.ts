import { connect, createServer, type Server } from "node:net";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addWorkspaceFromSidebar, openSettings, signIn, workspaceCard } from "./helpers.ts";
import { freePorts } from "./free-ports.ts";
import { TestHost } from "./test-host.ts";

/** Where the stand-ins for tailscale serve listen: the server's public port and its canvas port, then the laptop's. */
let publicPorts = 0;
const publicOrigin = (first: number) => `http://localhost:${first}`;
const serverOrigin = () => publicOrigin(publicPorts);
const laptopOrigin = () => publicOrigin(publicPorts + 2);
const reachedAt = (origin: () => string) => () => {
  const { port } = new URL(origin());
  return { MIRADOR_PUBLIC_ORIGIN: origin(), MIRADOR_PUBLIC_CANVAS_ORIGIN: publicOrigin(Number(port) + 1) };
};

/** The home server, which the laptop has joined. */
const server = new TestHost({ environment: reachedAt(serverOrigin) });
/** The laptop, which the desk has joined. */
const laptop = new TestHost({ environment: reachedAt(laptopOrigin) });
/** The computer the user sits at, which has joined only the laptop so far. */
const desk = new TestHost();

/** Stands in for tailscale serve: another address in front of the host, which keeps listening on 127.0.0.1 only. */
function forward(fromPort: number, toPort: number) {
  const forwarder = createServer((client) => {
    const upstream = connect(toPort, "127.0.0.1");
    const closeBoth = () => {
      client.destroy();
      upstream.destroy();
    };
    client.on("error", closeBoth);
    upstream.on("error", closeBoth);
    client.pipe(upstream).pipe(client);
  });
  return new Promise<Server>((resolve) => forwarder.listen(fromPort, "127.0.0.1", () => resolve(forwarder)));
}

let forwarders: Server[] = [];

test.beforeAll(async () => {
  publicPorts = await freePorts(4);
  await Promise.all([server.start(), laptop.start(), desk.start()]);
  forwarders = await Promise.all([
    forward(publicPorts, server.port),
    forward(publicPorts + 1, server.port + 1),
    forward(publicPorts + 2, laptop.port),
    forward(publicPorts + 3, laptop.port + 1),
  ]);
});
test.afterAll(async () => {
  forwarders.forEach((forwarder) => forwarder.close());
  await Promise.all([server.stop(), laptop.stop(), desk.stop()]);
  await Promise.all([server.cleanUp(), laptop.cleanUp(), desk.cleanUp()]);
});

async function inviteLinkFrom(page: Page) {
  const settings = await openSettings(page, "Devices");
  await settings.getByRole("button", { name: "Invite a device" }).click();
  const link = (await settings.locator(".invite-link").textContent())!;
  await page.keyboard.press("Escape");
  return link;
}

async function addAndJoin(page: Page, name: string, link: string) {
  await page.locator(".sidebar").getByRole("button", { name: "Machines…" }).click();
  const machines = page.getByRole("dialog", { name: "Machines" });
  await machines.getByLabel("Name").fill(name);
  await machines.getByLabel("Address or invite link").fill(link);
  await machines.getByRole("button", { name: "Add and join" }).click();
  await expect(machines.locator(".machine-list li", { hasText: name }).locator(".machine-not-joined")).toHaveCount(0);
  await page.keyboard.press("Escape");
}

test("a machine the laptop has joined shows in the desk's own rail, to join from there, and the laptop's page in the frame draws no rail of its own", async ({ page, browser }) => {
  const serverPage = await browser.newPage();
  await signIn(serverPage, server);
  const serverOnly = join(server.root, "server-only");
  mkdirSync(serverOnly, { recursive: true });
  await addWorkspaceFromSidebar(serverPage, serverOnly);
  const laptopPage = await browser.newPage();
  await signIn(laptopPage, laptop);
  await addAndJoin(laptopPage, "Home server", await inviteLinkFrom(serverPage));

  await signIn(page, desk);
  await addAndJoin(page, "Laptop", await inviteLinkFrom(laptopPage));
  const rail = page.getByRole("navigation", { name: "Machines" });
  const laptopFrame = page.frameLocator('iframe[title="Laptop"]');
  const homeServer = rail.getByRole("button", { name: "Home server", exact: true });
  const machines = page.getByRole("dialog", { name: "Machines" });
  const hiddenMachines = machines.getByRole("region", { name: "Hidden from the rail" });

  await test.step("the laptop's own page shows in the desk's frame without a rail, as the desk's rail lists the machines", async () => {
    await rail.getByRole("button", { name: "Laptop" }).click();
    await expect(laptopFrame.getByRole("button", { name: "Settings…" })).toBeVisible();
    await expect(laptopFrame.getByRole("navigation", { name: "Machines" })).toHaveCount(0);
  });

  await test.step("the home server the laptop has joined shows in the desk's rail, not joined yet", async () => {
    await expect(rail.getByRole("button")).toHaveText(["⌂", "LA", "HS", "+"]);
    await expect(homeServer).toHaveClass(/\baway\b/);
    await expect(homeServer).toHaveAttribute("data-hint", `Home server · ${serverOrigin()} · Laptop has joined it · not joined yet`);
  });

  await test.step("a right-click hides it from the rail, and Machines… shows it there again", async () => {
    await homeServer.click({ button: "right" });
    await page.getByRole("menu", { name: "Home server" }).getByRole("menuitem", { name: "Hide from the rail" }).click();
    await expect(rail.getByRole("button")).toHaveText(["⌂", "LA", "+"]);
    await rail.getByRole("button", { name: "Machines…" }).click();
    await expect(hiddenMachines.locator("li")).toHaveText(new RegExp(`^Home server\\s*${serverOrigin()}\\s*Laptop has joined it\\s*Show in the rail$`));
    await hiddenMachines.getByRole("button", { name: "Show Home server in the rail" }).click();
    await expect(hiddenMachines).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(rail.getByRole("button")).toHaveText(["⌂", "LA", "HS", "+"]);
  });

  await test.step("clicking it, even twice, adds it to the desk's machines once and offers to join it", async () => {
    await homeServer.dblclick();
    const joinPanel = page.getByRole("region", { name: "Join Home server" });
    await expect(joinPanel.getByRole("button", { name: "Ask to join" })).toBeVisible();
    await expect(homeServer).toHaveAttribute("aria-current", "true");
    await joinPanel.getByLabel("Invite code or link").fill(await inviteLinkFrom(serverPage));
    await joinPanel.getByRole("button", { name: "Join", exact: true }).click();
    await expect(workspaceCard(page.frameLocator('iframe[title="Home server"]'), serverOnly)).toBeVisible();
    await expect(page.getByText("is already among your machines")).toHaveCount(0);
  });

  await test.step("joined, it is one of the desk's machines, in their order by name, listed once", async () => {
    await expect(rail.getByRole("button")).toHaveText(["⌂", "HS", "LA", "+"]);
    await expect(homeServer).not.toHaveClass(/\baway\b/);
    await expect(homeServer).toHaveAttribute("data-hint", `Home server · ${serverOrigin()}`);
  });

  await test.step("removed from the desk's machines, it stays out of the rail, though the laptop still has it", async () => {
    await rail.getByRole("button", { name: "Machines…" }).click();
    await machines.getByRole("button", { name: "Remove Home server" }).click();
    await machines.getByRole("button", { name: "Confirm: Remove Home server" }).click();
    await expect(hiddenMachines.locator("li")).toHaveText(new RegExp(`^Home server\\s*${serverOrigin()}`));
    await expect(rail.getByRole("button")).toHaveText(["⌂", "LA", "+"]);
  });

  await test.step("added again at another of its addresses, it is the same machine, by the id its Mirador goes by", async () => {
    await hiddenMachines.getByRole("button", { name: "Show Home server in the rail" }).click();
    await expect(rail.getByRole("button")).toHaveText(["⌂", "LA", "HS", "+"]);
    await machines.getByLabel("Name").fill("Home server on the LAN");
    await machines.getByLabel("Address or invite link").fill(server.origin);
    await machines.getByRole("button", { name: "Add", exact: true }).click();
    await machines.locator(".machine-list li", { hasText: "Home server on the LAN" }).getByRole("button", { name: "Open", exact: true }).click();
    const joinPanel = page.getByRole("region", { name: "Join Home server on the LAN" });
    await joinPanel.getByLabel("Invite code or link").fill(await inviteLinkFrom(serverPage));
    await joinPanel.getByRole("button", { name: "Join", exact: true }).click();
    await expect(workspaceCard(page.frameLocator('iframe[title="Home server on the LAN"]'), serverOnly)).toBeVisible();
    await expect(rail.getByRole("button")).toHaveText(["⌂", "HS", "LA", "+"]);
  });
  await Promise.all([serverPage.close(), laptopPage.close()]);
});
