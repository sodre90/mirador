import { expect, test, type Locator } from "@playwright/test";
import jsQR from "jsqr";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openSettings, signIn } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();
const hostAddressedByEnvironment = new TestHost({
  environment: { MIRADOR_PUBLIC_ORIGIN: "https://env.example.com", MIRADOR_PUBLIC_CANVAS_ORIGIN: "https://env.example.com:8443" },
});

/** Stands in for the machine's Tailscale: its name answers nothing, so Settings has to offer to expose Mirador itself. */
const tailscaleStub = join(host.root, process.platform === "win32" ? "tailscale.cmd" : "tailscale");
const tailscaleCalls = join(host.root, "tailscale-calls");
const hostWithTailscale = new TestHost({ environment: { MIRADOR_TAILSCALE: tailscaleStub } });

/** Windows runs no script without an extension, so there the stub is a .cmd. */
function writeTailscaleStub() {
  if (process.platform === "win32") {
    return writeFileSync(tailscaleStub, `@echo %*>> "${tailscaleCalls}"\r\n@if "%~1"=="status" echo {"Self":{"DNSName":"localhost."}}\r\n@exit /b 0\r\n`);
  }
  writeFileSync(tailscaleStub, `#!/bin/sh\necho "$@" >> ${JSON.stringify(tailscaleCalls)}\n[ "$1" = status ] && echo '{"Self":{"DNSName":"localhost."}}'\nexit 0\n`);
  chmodSync(tailscaleStub, 0o755);
}

test.beforeAll(async () => {
  await Promise.all([host.start(), hostAddressedByEnvironment.start(), hostWithTailscale.start()]);
  writeTailscaleStub();
});
test.afterAll(async () => {
  await Promise.all([host.stop(), hostAddressedByEnvironment.stop(), hostWithTailscale.stop()]);
  await Promise.all([host.cleanUp(), hostAddressedByEnvironment.cleanUp(), hostWithTailscale.cleanUp()]);
});

const addressForm = (settings: Locator) => settings.getByRole("form", { name: "Address on your network" });
const routeChoice = (settings: Locator, name: string) => settings.getByRole("radio", { name });
/** Null until Settings has written the whole file: a throw would end expect.poll at once, not try again. */
function configFile() {
  try {
    return JSON.parse(readFileSync(join(host.dataDir, "config.json"), "utf8"));
  } catch {
    return null;
  }
}
const ADDRESS_ROUTE = "At an address a proxy gives it";
const NETWORK_ROUTE = "Over the network, with no address";
const ALONE_ROUTE = "Only on this machine";

/** Picking the address route brings its fields out; it is chosen for good once an address in them is saved. */
async function chooseAddressRoute(settings: Locator) {
  await routeChoice(settings, ADDRESS_ROUTE).click();
  await expect(addressForm(settings)).toBeVisible();
}

async function invite(settings: Locator) {
  await settings.getByRole("button", { name: "Invite a device" }).click();
  return settings.getByLabel("Invite");
}

test("Settings offers one way at a time to reach it, and names what each one needs", async ({ page }) => {
  await signIn(page, host);
  const settings = await openSettings(page, "Devices");

  await test.step("a fresh host reaches no other device, the first choice, and only that choice shows no controls", async () => {
    await expect(settings.getByRole("radiogroup", { name: "How other devices reach this Mirador" }).locator(".route-choice")).toHaveText([ALONE_ROUTE, ADDRESS_ROUTE, NETWORK_ROUTE]);
    await expect(routeChoice(settings, ALONE_ROUTE)).toBeChecked();
    await expect(addressForm(settings)).toHaveCount(0);
    await expect(settings.getByRole("button", { name: "Find the address" })).toHaveCount(0);
  });

  await test.step("the ports are named where the address is asked for, so 4600 and 4601 are not a mystery", async () => {
    await chooseAddressRoute(settings);
    await expect(addressForm(settings)).toContainText(`its own port, ${host.port}`);
    await expect(addressForm(settings)).toContainText(`a port of their own, ${host.port + 1}`);
  });

  await test.step("the network way names the port it serves on, so 4602 is not a mystery either", async () => {
    await expect(settings.getByRole("radiogroup")).toContainText(`port ${host.port + 2}`);
  });

  await test.step("both servers answer where Settings checks an address", async () => {
    expect(await (await fetch(`${host.origin}/mirador-here`)).json()).toEqual({ mirador: true });
    expect(await (await fetch(`http://127.0.0.1:${host.port + 1}/mirador-here`)).json()).toEqual({ mirador: true });
  });

  await test.step("a machine with no Tailscale, and nothing answering, is told the choice is what is left", async () => {
    await settings.getByRole("button", { name: "Find the address" }).click();
    await expect(settings.getByText("and it has no Tailscale")).toBeVisible();
    await expect(settings.getByRole("button", { name: "Use these" })).toHaveCount(0);
  });
});

test("a machine with Tailscale is offered one button for both of its ports, and it runs the commands", async ({ page }) => {
  await signIn(page, hostWithTailscale);
  const settings = await openSettings(page, "Devices");
  const expose = settings.getByRole("button", { name: "Expose Mirador on Tailscale" });
  await chooseAddressRoute(settings);

  await test.step("Tailscale's name answers nothing yet, so Mirador offers to serve its ports itself", async () => {
    await settings.getByRole("button", { name: "Find the address" }).click();
    await expect(expose, "each address is asked, and each one can take seconds to answer").toBeVisible({ timeout: 30_000 });
  });

  await test.step("the button serves Mirador's own port and the canvas port on the tailnet", async () => {
    await expose.click();
    await expect(expose).toBeEnabled();
    const calls = readFileSync(tailscaleCalls, "utf8").trim().split(/\r?\n/);
    expect(calls).toContain("status --json");
    expect(calls).toContain(`serve --bg --https=${hostWithTailscale.port} http://127.0.0.1:${hostWithTailscale.port}`);
    expect(calls).toContain(`serve --bg --https=${hostWithTailscale.port + 1} http://127.0.0.1:${hostWithTailscale.port + 1}`);
  });
});

test("looking at another way loses nothing, and only its Use this button applies it and takes the address back", async ({ page }) => {
  await signIn(page, host);
  const settings = await openSettings(page, "Devices");
  await chooseAddressRoute(settings);
  const form = addressForm(settings);
  await form.getByLabel("Address", { exact: true }).fill("https://box.example.ts.net");
  await form.getByLabel("Canvas address").fill("https://box.example.ts.net:8443");
  await form.getByRole("button", { name: "Save address" }).click();
  const savedAddress = { publicOrigin: "https://box.example.ts.net", publicCanvasOrigin: "https://box.example.ts.net:8443" };
  await expect.poll(configFile).toEqual(savedAddress);

  await test.step("picking the network way only shows it, and the saved address stays", async () => {
    await routeChoice(settings, NETWORK_ROUTE).click();
    await expect(routeChoice(settings, NETWORK_ROUTE)).toBeChecked();
    await expect(addressForm(settings), "the fields go away with the choice that used them").toHaveCount(0);
    await expect(settings.getByRole("button", { name: "Use this" })).toBeVisible();
    expect(configFile()).toEqual(savedAddress);
  });

  await test.step("coming back finds the address as saved, and what was typed but not saved is still there", async () => {
    await chooseAddressRoute(settings);
    await expect(form.getByLabel("Address", { exact: true })).toHaveValue("https://box.example.ts.net");
    await form.getByLabel("Canvas address").fill("https://box.example.ts.net:9443");
    await routeChoice(settings, ALONE_ROUTE).click();
    await chooseAddressRoute(settings);
    await expect(form.getByLabel("Canvas address")).toHaveValue("https://box.example.ts.net:9443");
    expect(configFile()).toEqual(savedAddress);
  });

  await test.step("Use this applies the network way: it clears the address and serves the host's own HTTPS", async () => {
    await routeChoice(settings, NETWORK_ROUTE).click();
    await settings.getByRole("button", { name: "Use this" }).click();
    await expect.poll(configFile).toEqual({ network: true });
    await expect(settings.getByRole("button", { name: "Use this" }), "the way in use has nothing left to apply").toHaveCount(0);
  });

  await test.step("only on this machine takes that back too, once applied", async () => {
    await routeChoice(settings, ALONE_ROUTE).click();
    expect(configFile()).toEqual({ network: true });
    await settings.getByRole("button", { name: "Use this" }).click();
    await expect.poll(configFile).toEqual({});
  });
});

test("an address given by a proxy on another machine is saved with the host's own HTTPS, and the ports the proxy forwards to are named", async ({ page }) => {
  await signIn(page, host);
  let settings = await openSettings(page, "Devices");
  await chooseAddressRoute(settings);
  const form = () => addressForm(settings);
  await form().getByLabel("Address", { exact: true }).fill("https://mirador.example.com");
  await form().getByLabel("Canvas address").fill("https://mirador-canvas.example.com");
  await form().getByLabel("The proxy runs on another machine").check();
  await expect(form()).toContainText(`forwards to port ${host.port + 2} for Mirador and ${host.port + 3} for the canvas`);
  await form().getByRole("button", { name: "Save address" }).click();
  await expect.poll(configFile).toEqual({ publicOrigin: "https://mirador.example.com", publicCanvasOrigin: "https://mirador-canvas.example.com", network: true });

  await page.reload();
  settings = await openSettings(page, "Devices");
  await expect(routeChoice(settings, ADDRESS_ROUTE)).toBeChecked();
  await expect(form().getByLabel("The proxy runs on another machine")).toBeChecked();

  await test.step("unticking it and saving leaves the address alone, with no network of its own", async () => {
    await form().getByLabel("The proxy runs on another machine").uncheck();
    await form().getByRole("button", { name: "Save address" }).click();
    await expect.poll(configFile).toEqual({ publicOrigin: "https://mirador.example.com", publicCanvasOrigin: "https://mirador-canvas.example.com" });
  });

  await test.step("only on this machine takes the address back", async () => {
    await routeChoice(settings, ALONE_ROUTE).click();
    await settings.getByRole("button", { name: "Use this" }).click();
    await expect.poll(configFile).toEqual({});
  });
});

const inviteQrCode = (invite: Locator) => invite.getByRole("img", { name: "Link as a QR code" });

/** What a phone's camera reads off the QR code: the page draws it on a canvas, and its pixels are decoded here. */
async function scanned(qrCode: Locator) {
  const side = 400;
  const pixels = await qrCode.evaluate(async (svg, side) => {
    const sized = svg.cloneNode(true) as SVGSVGElement;
    sized.setAttribute("width", String(side));
    sized.setAttribute("height", String(side));
    const image = new Image();
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(sized))}`;
    await image.decode();
    const canvas = Object.assign(document.createElement("canvas"), { width: side, height: side });
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    return Array.from(context.getImageData(0, 0, side, side).data);
  }, side);
  return jsQR(Uint8ClampedArray.from(pixels), side, side)?.data ?? null;
}

test("an address saved in Settings goes to config.json, and invite links use it once the host restarts", async ({ page }) => {
  await signIn(page, host);
  let settings = await openSettings(page, "Devices");
  await chooseAddressRoute(settings);
  let form = addressForm(settings);

  await test.step("both addresses are needed", async () => {
    await form.getByLabel("Address", { exact: true }).fill("https://box.example.ts.net/");
    await form.getByRole("button", { name: "Save address" }).click();
    await expect(settings.getByText("Set both Address and Canvas address, or neither.")).toBeVisible();
  });

  await test.step("saving writes config.json, and the host keeps its old address until it restarts", async () => {
    await form.getByLabel("Canvas address").fill("https://box.example.ts.net:8443");
    await form.getByRole("button", { name: "Save address" }).click();
    await expect(settings.getByText("Saved. The host uses it from its next start.")).toBeVisible();
    await expect(form.getByLabel("Address", { exact: true })).toHaveValue("https://box.example.ts.net");
    expect(configFile()).toEqual({ publicOrigin: "https://box.example.ts.net", publicCanvasOrigin: "https://box.example.ts.net:8443" });
    const shownInvite = await invite(settings);
    await expect(shownInvite.locator(".invite-code")).toBeVisible();
    await expect(shownInvite.locator(".invite-link")).toHaveCount(0);
    await expect(inviteQrCode(shownInvite)).toHaveCount(0);
    await expect(shownInvite.locator(".invite-without-link"), "the invite says why it has no link to show").toBeVisible();
  });

  await test.step("after the restart, invites come with a link to the saved address", async () => {
    await settings.getByRole("button", { name: "Restart host" }).click();
    await expect(settings, "the page reloads once the restarted host answers").toBeHidden({ timeout: 30_000 });
    await expect(page.getByText("No conversation selected")).toBeVisible();
    settings = await openSettings(page, "Devices");
    form = addressForm(settings);
    await expect(routeChoice(settings, ADDRESS_ROUTE), "the saved choice is the one shown after the restart").toBeChecked();
    await expect(settings.getByText("Saved. The host uses it from its next start.")).toHaveCount(0);
    const linkedInvite = await invite(settings);
    await expect(linkedInvite.locator(".invite-link")).toHaveText(/^https:\/\/box\.example\.ts\.net\/#\/join\/[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    await expect(linkedInvite.locator(".invite-without-link")).toHaveCount(0);
  });
});

test("an address the host's environment sets can't be changed in Settings", async ({ page }) => {
  await signIn(page, hostAddressedByEnvironment);
  const settings = await openSettings(page, "Devices");
  const form = addressForm(settings);
  await expect(routeChoice(settings, ADDRESS_ROUTE), "the environment's way is the one shown, and it is the only one").toBeChecked();
  await expect(routeChoice(settings, NETWORK_ROUTE)).toBeDisabled();
  await expect(settings).toContainText("The host's environment sets how other devices reach it");
  await expect(form).toContainText("The host's environment sets its address");
  await expect(form.getByLabel("Address", { exact: true })).toHaveValue("https://env.example.com");
  await expect(form.getByLabel("Address", { exact: true })).toBeDisabled();
  await expect(form.getByLabel("Canvas address")).toHaveValue("https://env.example.com:8443");
  await expect(form.getByRole("button", { name: "Save address" })).toBeDisabled();
  await expect(settings.getByRole("button", { name: "Find the address" }), "an address nothing here can change is not searched for").toHaveCount(0);
});

test("an invite link also shows as a QR code, which reads back as the link for the phone app to scan", async ({ page }) => {
  await signIn(page, hostAddressedByEnvironment);
  const shownInvite = await invite(await openSettings(page, "Devices"));
  const link = await shownInvite.locator(".invite-link").textContent();
  expect(link).toMatch(/^https:\/\/env\.example\.com\/#\/join\/[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  expect(await scanned(inviteQrCode(shownInvite))).toBe(link);
});
