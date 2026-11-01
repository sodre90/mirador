import { mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { addWorkspace, createProfile, signIn } from "./helpers.ts";
import { forgetPiAcpSessionsUnder, piProgram } from "./scripted-model.ts";
import { TestHost, writeCompiledBunProgram } from "./test-host.ts";

const host = new TestHost();
/** What a pi older than 0.99.0 prints as Mirador's pi extension turns it down. */
const OLD_PI_REFUSAL = 'Error: Failed to load extension "session-extension.js": Failed to load extension: Mirador needs pi 0.99.0 or later. Update pi with npm install -g @earendil-works/pi-coding-agent';

test.skip(piProgram() === null, "pi is not installed");

let oldPi: string;
test.beforeAll(async () => {
  oldPi = writeCompiledBunProgram(host.root, "old-pi", join(import.meta.dirname, "old-pi-refusal.ts"), { OLD_PI_REFUSAL });
  await host.start();
  mkdirSync(host.projectDir, { recursive: true });
});
test.afterAll(async () => {
  await host.stop();
  forgetPiAcpSessionsUnder(realpathSync(host.root));
  await host.cleanUp();
});

test("a pi that stops as it starts, as one older than Mirador needs does, says why rather than leaving the conversation opening", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const dialog = await createProfile(page, "old pi", `PI_ACP_PI_COMMAND=${oldPi}`, "", "pi");
  await dialog.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "old pi · pi" });
  await page.getByRole("button", { name: "+ New conversation" }).click();
  await expect(page.locator(".chat-header:visible .status-detail")).toContainText("Mirador needs pi 0.99.0 or later. Update pi with npm install -g @earendil-works/pi-coding-agent", { timeout: 30_000 });
});
