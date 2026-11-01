import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { addWorkspace, createProfile, openSettings, primaryModifier, reloadFromRestartedHost, sendMessage, signIn, startConversation, waitForTurnToEnd } from "./helpers.ts";
import { ScriptedModel, scriptedOpencodeEnvironment } from "./scripted-model.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost({ fakePrograms: true });
const model = new ScriptedModel();
const PROFILE = "scripted opencode";
const holds = () => join(host.root, "awake-holds.log");
const heldAndReleased = () => (existsSync(holds()) ? readFileSync(holds(), "utf8").trim().split("\n") : []);
const held = expect.stringMatching(/^held /);

/** Stand-ins for caffeinate and systemd-inhibit that write down when they start holding the computer awake and when they are stopped, and end with the host as the real ones do. */
function writeFakeAwakeHolders() {
  mkdirSync(host.fakeProgramsDir, { recursive: true });
  for (const name of ["caffeinate", "systemd-inhibit"]) {
    const program = join(host.fakeProgramsDir, name);
    writeFileSync(program, `#!/bin/sh\ntrap 'echo released >> "${holds()}"; exit 0' TERM\necho "held $*" >> "${holds()}"\nhost=$PPID\nwhile kill -0 $host 2>/dev/null; do sleep 0.2; done\n`);
    chmodSync(program, 0o755);
  }
}

test.skip(process.platform === "win32", "Keep awake is for macOS and Linux");

test.beforeAll(async () => {
  writeFakeAwakeHolders();
  await model.start();
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
  model.stop();
});

test("Settings keep the computer awake: always for as long as the host runs, or while agents work until their turns end", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, host);
  let settings = await openSettings(page, "Agents");
  let keepAwake = settings.getByLabel("Keep the computer awake");
  await expect(keepAwake).toHaveValue("never");
  expect(heldAndReleased()).toEqual([]);

  await test.step("Always holds idle sleep off, tied to the host's process, and every window shows it", async () => {
    await keepAwake.selectOption({ label: "Always" });
    await expect.poll(heldAndReleased).toEqual([expect.stringMatching(new RegExp(`^held .*(-w ${host.pid}|--pid=${host.pid})`))]);
    const otherWindow = await page.context().newPage();
    await otherWindow.goto(page.url());
    await expect((await openSettings(otherWindow, "Agents")).getByLabel("Keep the computer awake")).toHaveValue("always");
    await otherWindow.close();
  });

  await test.step("Never lets the computer sleep again", async () => {
    await keepAwake.selectOption({ label: "Never" });
    await expect.poll(heldAndReleased).toEqual([held, "released"]);
  });

  await test.step("a restart in place lets go of the old hold before the host holds again, and the setting is kept", async () => {
    await keepAwake.selectOption({ label: "Always" });
    await expect.poll(heldAndReleased).toEqual([held, "released", held]);
    await page.keyboard.press(`${await primaryModifier(page)}+Shift+R`);
    await expect.poll(() => host.log.match(/Mirador is running/g)?.length, { timeout: 60_000 }).toBe(2);
    await expect.poll(heldAndReleased).toEqual([held, "released", held, "released", held]);
    await reloadFromRestartedHost(page);
    settings = await openSettings(page, "Agents");
    keepAwake = settings.getByLabel("Keep the computer awake");
    await expect(keepAwake).toHaveValue("always");
  });

  await test.step("While agents work holds the computer awake from the start of a turn until it ends", async () => {
    await keepAwake.selectOption({ label: "While agents work" });
    await expect.poll(heldAndReleased).toHaveLength(6);
    await settings.getByRole("button", { name: "Close" }).click();
    await addWorkspace(page, host.projectDir);
    const profiles = await createProfile(page, PROFILE, scriptedOpencodeEnvironment(model, host.root), "", "opencode");
    await profiles.getByRole("button", { name: "Close" }).click();
    await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${PROFILE} · opencode` });
    await startConversation(page);
    await sendMessage(page, "RUN sleep 3");
    await expect.poll(heldAndReleased).toHaveLength(7);
    expect(heldAndReleased().at(-1)).toMatch(/^held /);
    await page.getByRole("button", { name: "Allow once" }).click();
    await waitForTurnToEnd(page);
    await expect.poll(heldAndReleased).toEqual([held, "released", held, "released", held, "released", held, "released"]);
  });
});
