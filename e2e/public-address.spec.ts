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

const editor = (settings: Locator) => settings.getByRole("form", { name: "How browsers and other computers reach this Mirador" });
const addressFields = (settings: Locator) => settings.getByRole("group", { name: "Address on your network" });
const routeChoice = (settings: Locator, name: string) => settings.getByRole("radio", { name });
const save = (settings: Locator) => editor(settings).getByRole("button", { name: "Save" });
const afterRestart = (settings: Locator) => settings.getByText("After the next restart");
/** Null until Settings has written the whole file: a throw would end expect.poll at once, not try again. */
function configFile() {
  try {
    return JSON.parse(readFileSync(join(host.dataDir, "config.json"), "utf8"));
  } catch {
    return null;
  }
}
const ADDRESS_ROUTE = "A proxy's address";
const NETWORK_ROUTE = "This network";
const NO_ADDRESS_ROUTE = "No address";

/** Connection says the address in a row; Change… opens the ways to another in its place. */
async function changeAddress(settings: Locator) {
  await settings.getByRole("button", { name: "Change…" }).click();
  await expect(editor(settings)).toBeVisible();
}

/** Picking the address route brings its fields out; it is chosen for good once an address in them is saved. */
async function chooseAddressRoute(settings: Locator) {
  await routeChoice(settings, ADDRESS_ROUTE).check();
  await expect(addressFields(settings)).toBeVisible();
}

async function invite(settings: Locator) {
  await settings.getByRole("button", { name: "Invite a device" }).click();
  return settings.getByRole("region", { name: "Invite" });
}

test("Connection says in a row that there is no address, and Change… offers one way at a time, naming what each one needs", async ({ page }) => {
  await signIn(page, host);
  const settings = await openSettings(page, "Devices");

  await test.step("a fresh host has no address, and shows no way to another until Change…", async () => {
    const connection = settings.getByRole("region", { name: "Connection" });
    await expect(connection.getByRole("listitem").filter({ hasText: "No address" })).toContainText("No other device reaches this Mirador.");
    await expect(connection.locator(".peer-to-peer-status"), "test hosts run without peer to peer").toHaveText("Off");
    await expect(settings.getByRole("radiogroup")).toHaveCount(0);
    await changeAddress(settings);
    await expect(settings.getByRole("radiogroup", { name: "How browsers and other computers reach this Mirador" }).locator(".route-choice")).toHaveText([NO_ADDRESS_ROUTE, NETWORK_ROUTE, ADDRESS_ROUTE]);
    await expect(routeChoice(settings, NO_ADDRESS_ROUTE)).toBeChecked();
    await expect(addressFields(settings)).toHaveCount(0);
    await expect(save(settings), "the way in use has nothing to save").toBeDisabled();
  });

  await test.step("the ports are named where the address is asked for, so 4600 and 4601 are not a mystery", async () => {
    await chooseAddressRoute(settings);
    await expect(addressFields(settings)).toContainText(`its own port, ${host.port}`);
    await expect(addressFields(settings)).toContainText(`a port of their own, ${host.port + 1}`);
    await expect(save(settings), "with neither field filled in, there is no address to save").toBeDisabled();
  });

  await test.step("the network way names the port it serves on, so 4602 is not a mystery either", async () => {
    await expect(settings.getByRole("radiogroup")).toContainText(`port ${host.port + 2}`);
  });

  await test.step("both servers answer where Settings checks an address", async () => {
    expect(await (await fetch(`${host.origin}/mirador-here`)).json()).toMatchObject({ mirador: true });
    expect(await (await fetch(`http://127.0.0.1:${host.port + 1}/mirador-here`)).json()).toMatchObject({ mirador: true });
  });

  await test.step("a machine with no Tailscale, and nothing answering, is told what works without it", async () => {
    await settings.getByRole("button", { name: "Find the address" }).click();
    await expect(settings.getByText("and it has no Tailscale. This network works without either.")).toBeVisible();
    await expect(settings.getByRole("button", { name: "Use these" })).toHaveCount(0);
  });

  await test.step("Cancel puts the row back, with nothing saved", async () => {
    await editor(settings).getByRole("button", { name: "Cancel" }).click();
    await expect(editor(settings)).toHaveCount(0);
    await expect(settings.getByRole("button", { name: "Change…" })).toBeVisible();
    await expect(afterRestart(settings)).toHaveCount(0);
  });
});

test("a machine with Tailscale is offered one button for both of its ports, and it runs the commands", async ({ page }) => {
  await signIn(page, hostWithTailscale);
  const settings = await openSettings(page, "Devices");
  const expose = settings.getByRole("button", { name: "Expose Mirador on Tailscale" });
  await changeAddress(settings);
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

test("looking at another way loses nothing, and only Save applies it and takes the address back", async ({ page }) => {
  await signIn(page, host);
  const settings = await openSettings(page, "Devices");
  await changeAddress(settings);
  await chooseAddressRoute(settings);
  const fields = addressFields(settings);
  await fields.getByLabel("Address", { exact: true }).fill("https://box.example.ts.net");
  await fields.getByLabel("Canvas address").fill("https://box.example.ts.net:8443");
  await save(settings).click();
  const savedAddress = { publicOrigin: "https://box.example.ts.net", publicCanvasOrigin: "https://box.example.ts.net:8443" };
  await expect.poll(configFile).toEqual(savedAddress);
  await expect(editor(settings), "once saved, the row is back, with what the restart brings").toHaveCount(0);
  await expect(settings.getByText("After the next restart: box.example.ts.net")).toBeVisible();

  await test.step("picking the network way only shows it, and the saved address stays", async () => {
    await changeAddress(settings);
    await routeChoice(settings, NETWORK_ROUTE).check();
    await expect(addressFields(settings), "the fields go away with the choice that used them").toHaveCount(0);
    expect(configFile()).toEqual(savedAddress);
  });

  await test.step("coming back finds the address as saved, and what was typed but not saved is still there", async () => {
    await chooseAddressRoute(settings);
    await expect(fields.getByLabel("Address", { exact: true })).toHaveValue("https://box.example.ts.net");
    await fields.getByLabel("Canvas address").fill("https://box.example.ts.net:9443");
    await routeChoice(settings, NO_ADDRESS_ROUTE).check();
    await chooseAddressRoute(settings);
    await expect(fields.getByLabel("Canvas address")).toHaveValue("https://box.example.ts.net:9443");
    expect(configFile()).toEqual(savedAddress);
  });

  await test.step("Save applies the network way: it clears the address and serves the host's own HTTPS", async () => {
    await routeChoice(settings, NETWORK_ROUTE).check();
    await save(settings).click();
    await expect.poll(configFile).toEqual({ network: true });
    await expect(settings.getByText("After the next restart: this network")).toBeVisible();
  });

  await test.step("no address takes that back too, once saved", async () => {
    await changeAddress(settings);
    await routeChoice(settings, NO_ADDRESS_ROUTE).check();
    expect(configFile()).toEqual({ network: true });
    await save(settings).click();
    await expect.poll(configFile).toEqual({});
    await expect(afterRestart(settings), "as the host runs now").toHaveCount(0);
  });
});

test("an address given by a proxy on another machine is saved with the host's own HTTPS, and the ports the proxy forwards to are named", async ({ page }) => {
  await signIn(page, host);
  let settings = await openSettings(page, "Devices");
  await changeAddress(settings);
  await chooseAddressRoute(settings);
  const fields = () => addressFields(settings);
  await fields().getByLabel("Address", { exact: true }).fill("https://mirador.example.com");
  await fields().getByLabel("Canvas address").fill("https://mirador-canvas.example.com");
  await fields().getByLabel("The proxy runs on another machine").check();
  await expect(fields()).toContainText(`forwards to port ${host.port + 2} for Mirador and ${host.port + 3} for the canvas`);
  await save(settings).click();
  await expect.poll(configFile).toEqual({ publicOrigin: "https://mirador.example.com", publicCanvasOrigin: "https://mirador-canvas.example.com", network: true });

  await page.reload();
  settings = await openSettings(page, "Devices");
  await changeAddress(settings);
  await expect(routeChoice(settings, ADDRESS_ROUTE)).toBeChecked();
  await expect(fields().getByLabel("The proxy runs on another machine")).toBeChecked();

  await test.step("unticking it and saving leaves the address alone, with no network of its own", async () => {
    await fields().getByLabel("The proxy runs on another machine").uncheck();
    await save(settings).click();
    await expect.poll(configFile).toEqual({ publicOrigin: "https://mirador.example.com", publicCanvasOrigin: "https://mirador-canvas.example.com" });
  });

  await test.step("no address takes the address back", async () => {
    await changeAddress(settings);
    await routeChoice(settings, NO_ADDRESS_ROUTE).check();
    await save(settings).click();
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
  await changeAddress(settings);
  await chooseAddressRoute(settings);
  const fields = addressFields(settings);

  await test.step("both addresses are needed", async () => {
    await fields.getByLabel("Address", { exact: true }).fill("https://box.example.ts.net/");
    await save(settings).click();
    await expect(settings.getByText("Set both Address and Canvas address, or neither.")).toBeVisible();
  });

  await test.step("saving writes config.json, and the host keeps its old address until it restarts", async () => {
    await fields.getByLabel("Canvas address").fill("https://box.example.ts.net:8443");
    await save(settings).click();
    await expect(settings.getByText("After the next restart: box.example.ts.net")).toBeVisible();
    await expect(settings.getByRole("listitem").filter({ hasText: "No address" }), "the address it has until then").toBeVisible();
    expect(configFile()).toEqual({ publicOrigin: "https://box.example.ts.net", publicCanvasOrigin: "https://box.example.ts.net:8443" });
    const shownInvite = await invite(settings);
    await expect(shownInvite.locator(".invite-code")).toBeVisible();
    await expect(shownInvite.locator(".invite-link")).toHaveCount(0);
    await expect(inviteQrCode(shownInvite)).toHaveCount(0);
    await expect(shownInvite.getByRole("alert"), "the invite warns that it needs the restart").toContainText("Restart the host, then invite again");
  });

  await test.step("after the restart, invites come with a link to the saved address", async () => {
    await settings.getByRole("region", { name: "Invite" }).getByRole("button", { name: "Restart host" }).click();
    await expect(settings, "the page reloads once the restarted host answers").toBeHidden({ timeout: 30_000 });
    await expect(page.getByText("No conversation selected")).toBeVisible();
    settings = await openSettings(page, "Devices");
    await expect(settings.getByText("Address: box.example.ts.net"), "the saved address is the one shown after the restart").toBeVisible();
    await expect(afterRestart(settings)).toHaveCount(0);
    const linkedInvite = await invite(settings);
    await expect(linkedInvite.locator(".invite-link")).toHaveText(/^https:\/\/box\.example\.ts\.net\/#\/join\/[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    await expect(linkedInvite.locator(".invite-without-link")).toHaveCount(0);
  });
});

test("an address the host's environment sets can't be changed in Settings", async ({ page }) => {
  await signIn(page, hostAddressedByEnvironment);
  const settings = await openSettings(page, "Devices");
  await expect(settings.getByText("Address: env.example.com")).toBeVisible();
  await expect(settings).toContainText("The host's environment sets how other devices reach it");
  await expect(settings.getByRole("button", { name: "Change…" })).toHaveCount(0);
});

test("an invite at an address that goes away at the next restart says so, as Connection does", async ({ page }) => {
  await signIn(page, host);
  const settings = await openSettings(page, "Devices");
  await changeAddress(settings);
  await routeChoice(settings, NO_ADDRESS_ROUTE).check();
  await save(settings).click();
  await expect(settings.getByText("After the next restart: no address")).toBeVisible();
  const goesAway = (await invite(settings)).getByText("This address goes away at the next restart");
  await expect(goesAway).toBeVisible();

  await test.step("until the address is saved again", async () => {
    await changeAddress(settings);
    await chooseAddressRoute(settings);
    await addressFields(settings).getByLabel("Address", { exact: true }).fill("https://box.example.ts.net");
    await addressFields(settings).getByLabel("Canvas address").fill("https://box.example.ts.net:8443");
    await save(settings).click();
    await expect(afterRestart(settings)).toHaveCount(0);
    await expect(goesAway).toHaveCount(0);
  });
});

test("an invite link also shows as a QR code, which reads back as the link for the phone app to scan", async ({ page }) => {
  await signIn(page, hostAddressedByEnvironment);
  const shownInvite = await invite(await openSettings(page, "Devices"));
  const link = await shownInvite.locator(".invite-link").textContent();
  expect(link).toMatch(/^https:\/\/env\.example\.com\/#\/join\/[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  expect(await scanned(inviteQrCode(shownInvite))).toBe(link);
});
