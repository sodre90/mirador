import { mkdirSync, realpathSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { addWorkspace, conversationSettings, createProfile, signIn, startConversation } from "./helpers.ts";
import { forgetPiAcpSessionsUnder, piProgram, ScriptedModel, scriptedPiEnvironment } from "./scripted-model.ts";
import { TestHost, writeCompiledBunProgram } from "./test-host.ts";

const OLD_PI_VERSION = "1.0.0";
const LATEST_PI_VERSION = "999.0.0";
const UPDATED_PI = `Updated pi from ${OLD_PI_VERSION} to ${LATEST_PI_VERSION}`;

const releases = createServer((_request, response) => response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ version: LATEST_PI_VERSION })));
/** The fake pi.dev's port is known only once it listens, which is before the host starts and reads this. */
const hostEnvironment: Record<string, string> = {};
const host = new TestHost({ environment: hostEnvironment });
const model = new ScriptedModel();

/** The host, as pi itself, asks for no newer pi where PI_OFFLINE is set: the stand-in pi sets it for the real one. */
const withoutPiOffline = (environment: string) =>
  environment
    .split("\n")
    .filter((line) => line !== "PI_OFFLINE=1")
    .join("\n");

let updatablePi: string;
test.skip(piProgram() === null, "pi is not installed");
test.beforeAll(async () => {
  await new Promise<void>((resolve) => releases.listen(0, "127.0.0.1", resolve));
  const { port } = releases.address() as { port: number };
  hostEnvironment.MIRADOR_PI_RELEASE_URL = `http://127.0.0.1:${port}/api/latest-version`;
  updatablePi = writeCompiledBunProgram(host.root, "updatable-pi", join(import.meta.dirname, "updatable-pi.ts"), { OLD_PI_VERSION, UPDATED_PI, REAL_PI: piProgram()! });
  await model.start();
  await host.start();
  mkdirSync(host.projectDir, { recursive: true });
});
test.afterAll(async () => {
  await host.stop();
  forgetPiAcpSessionsUnder(realpathSync(host.root));
  await host.cleanUp();
  model.stop();
  releases.close();
});

test("a new pi conversation says a newer pi is out, updates it from a button, and can still move to another agent", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const environment = `${withoutPiOffline(scriptedPiEnvironment(model, host.root))}\nPI_ACP_PI_COMMAND=${updatablePi}`;
  const dialog = await createProfile(page, "updatable pi", environment, "", "pi");
  await dialog.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "updatable pi · pi" });
  await startConversation(page);

  const notice = page.locator(".timeline:visible .update-available-line");
  await expect(notice).toContainText(`pi ${LATEST_PI_VERSION} is out; you have ${OLD_PI_VERSION}`, { timeout: 30_000 });

  await test.step("the button runs the updater of the pi the conversation runs, as a ! command", async () => {
    await notice.getByRole("button", { name: "Update pi" }).click();
    const update = page.locator(".timeline:visible .user-command").last();
    await expect(update.locator(".shell-typed")).toHaveText(`${updatablePi} update`);
    await expect(update.locator(".shell-output")).toContainText(UPDATED_PI);
  });

  await test.step("neither the notice nor the update has begun the conversation, so another agent's profile can take it", async () => {
    const profile = (await conversationSettings(page)).getByLabel("Profile", { exact: true });
    await expect(profile.locator("optgroup")).toHaveAttribute("label", "Other agents");
    await profile.selectOption({ label: "Claude Code · Claude Code" });
    await expect(page.locator(".chat-header:visible .conversation-settings-toggle")).toHaveAttribute("data-agent", "Claude Code");
    await expect(page.locator(".timeline:visible")).toContainText("Now using Claude Code, with the profile “Claude Code”");
  });
});
