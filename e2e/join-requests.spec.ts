import { expect, test, type Locator } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { allowNotifications, notificationsShown, openSettings, signIn } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

/** Where the server serves the network: on the two ports after its own and its canvas port. */
const networkOriginAt = (port: number) => `https://127.0.0.1:${port + 2}`;
/** On the network with its own certificate authority, which the laptop learns as it asks to join. */
const server = new TestHost({
  fakePrograms: true,
  environment: (port) => ({ MIRADOR_NETWORK: "on", MIRADOR_PUBLIC_ORIGIN: networkOriginAt(port), MIRADOR_PUBLIC_CANVAS_ORIGIN: `https://127.0.0.1:${port + 3}` }),
});
const networkOrigin = () => networkOriginAt(server.port);
const laptop = new TestHost();

const notificationsOnDesktop = join(server.root, "notify-send.log");
const linksOpened = join(server.root, "xdg-open.log");

/** The machine's desktop: notify-send, on which the user presses Open at once, and the browser xdg-open opens. */
function fakeDesktop() {
  mkdirSync(server.fakeProgramsDir, { recursive: true });
  const fake = (program: string, script: string) => {
    writeFileSync(join(server.fakeProgramsDir, program), `#!/bin/sh\n${script}\n`);
    chmodSync(join(server.fakeProgramsDir, program), 0o755);
  };
  fake("notify-send", `printf '%s\\n' "$@" >> '${notificationsOnDesktop}'\necho open`);
  fake("xdg-open", `printf '%s\\n' "$1" >> '${linksOpened}'`);
}

test.beforeAll(async () => {
  fakeDesktop();
  await Promise.all([server.start(), laptop.start()]);
});
test.afterAll(async () => {
  await Promise.all([server.stop(), laptop.stop()]);
  await Promise.all([server.cleanUp(), laptop.cleanUp()]);
});

async function numberShownIn(join: Locator) {
  const shown = join.getByRole("status", { name: "Waiting for approval" }).locator(".join-number");
  await expect(shown).toHaveText(/^\d{3} \d{3}$/);
  return (await shown.textContent())!;
}

const anotherNumber = (number: string) => number.replace(/\d$/, (digit) => String((Number(digit) + 1) % 10));

test("another Mirador asks to join over HTTPS, and gets in once someone at the machine types the number it shows", async ({ page, browser }) => {
  const serverPage = await browser.newPage();
  await allowNotifications(serverPage);
  await signIn(serverPage, server);
  const prompt = serverPage.getByRole("alertdialog", { name: /^Mirador on .+ asks to join$/ });

  await signIn(page, laptop);
  await page.locator(".sidebar").getByRole("button", { name: "Machines…" }).click();
  const machines = page.getByRole("dialog", { name: "Machines" });
  await machines.getByLabel("Name").fill("Server");
  await machines.getByLabel("Address or invite link").fill(networkOrigin());
  await machines.getByRole("button", { name: "Add", exact: true }).click();
  await machines.locator(".machine-list li", { hasText: "Server" }).getByRole("button", { name: "Open", exact: true }).click();
  const join = page.getByRole("region", { name: "Join Server" });
  const askToJoin = join.getByRole("button", { name: "Ask to join" });

  await test.step("the machine's own screen gets a notification, and can deny the request", async () => {
    await askToJoin.click();
    await numberShownIn(join);
    await expect(prompt).toContainText("From 127.0.0.1");
    expect(await notificationsShown(serverPage)).toEqual([
      {
        title: expect.stringMatching(/^Mirador on .+ asks to join Mirador$/),
        body: "From 127.0.0.1. Open Mirador to approve it by typing the number it shows.",
        tag: "about-this-machine",
        closed: false,
      },
    ]);
    await prompt.getByRole("button", { name: "Deny" }).click();
    await expect(prompt).toHaveCount(0);
    await expect(join.locator(".join-problem")).toHaveText("Server denied the request. If the number was typed there wrongly, ask again.");
  });

  await test.step("a wrong number denies it too", async () => {
    await askToJoin.click();
    const number = await numberShownIn(join);
    await prompt.getByLabel("Number it shows").fill(anotherNumber(number));
    await prompt.getByRole("button", { name: "Approve" }).click();
    await expect(serverPage.locator(".notice")).toHaveText("That is not the number the device shows, so its request was denied. It can ask again.");
    await expect(prompt).toHaveCount(0);
    await expect(join.locator(".join-problem")).toHaveText("Server denied the request. If the number was typed there wrongly, ask again.");
  });

  await test.step("the number the laptop shows lets it in, and the machine shows in its place", async () => {
    await askToJoin.click();
    const number = await numberShownIn(join);
    await prompt.getByLabel("Number it shows").fill(number);
    await prompt.getByRole("button", { name: "Approve" }).click();
    await expect(page.frameLocator('iframe[title="Server"]').getByRole("button", { name: "Settings…" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Machines" }).getByRole("button", { name: "Server" })).not.toHaveClass(/away/);
    const settings = await openSettings(serverPage, "Devices");
    await expect(settings.locator(".device-name", { hasText: /^Mirador on / })).toHaveCount(1);
  });
  expect(existsSync(notificationsOnDesktop)).toBe(false);
  await serverPage.close();
});

test("a browser on the network asks to join, and is signed in once someone at the machine types the number it shows", async ({ browser }) => {
  const serverPage = await browser.newPage();
  await signIn(serverPage, server);
  const phone = await browser.newPage({ ignoreHTTPSErrors: true });
  await phone.goto(networkOrigin());
  await phone.getByLabel("Name this device").fill("Phone");
  await phone.getByRole("button", { name: "Ask to join" }).click();
  const number = await numberShownIn(phone.locator(".join-machine"));

  const prompt = serverPage.getByRole("alertdialog", { name: "Phone asks to join" });
  await prompt.getByLabel("Number it shows").fill(number.replace(" ", ""));
  await prompt.getByRole("button", { name: "Approve" }).click();
  await expect(phone.getByRole("button", { name: "Settings…" })).toBeVisible();
  await expect(prompt).toHaveCount(0);
  await Promise.all([serverPage.close(), phone.close()]);
});

test("while no page of the machine is open, a request to join shows on its desktop, and mirador approve there lets the browser in", async ({ browser }) => {
  test.skip(process.platform === "win32", "Windows has no notify-send, so a join request shows nothing on its desktop yet (vcs-pgm.36)");
  const phone = await browser.newPage({ ignoreHTTPSErrors: true });
  await phone.goto(networkOrigin());
  await phone.getByLabel("Name this device").fill("Tablet");
  await phone.getByRole("button", { name: "Ask to join" }).click();
  const number = await numberShownIn(phone.locator(".join-machine"));

  await test.step("notify-send shows it, and its Open signs a browser on the machine in", async () => {
    await expect.poll(() => (existsSync(notificationsOnDesktop) ? readFileSync(notificationsOnDesktop, "utf8") : "")).toContain("Tablet asks to join Mirador");
    await expect.poll(() => existsSync(linksOpened)).toBe(true);
    const desk = await browser.newPage();
    await desk.goto(readFileSync(linksOpened, "utf8").trim());
    await expect(desk.getByRole("alertdialog", { name: "Tablet asks to join" })).toBeVisible();
    await desk.close();
  });

  const approve = spawnSync(join(import.meta.dirname, "..", "bin", "mirador"), ["approve"], {
    env: { ...process.env, MIRADOR_DATA_DIR: server.dataDir },
    input: `${number}\n`,
    encoding: "utf8",
  });
  expect(approve.stdout).toContain("Approved. Tablet gets in when it next checks, within seconds.");
  await expect(phone.getByRole("button", { name: "Settings…" })).toBeVisible();
  await phone.close();
});
