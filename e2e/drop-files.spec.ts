import { readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, createProfile, dropFiles, signIn, startConversation, waitForTurnToEnd } from "./helpers.ts";
import { ScriptedModel, scriptedOpencodeEnvironment } from "./scripted-model.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();
const model = new ScriptedModel();
const PROFILE = "scripted opencode";
const LOG = "first line\nsecond line, with ő\n";

// The second test uses the workspace and the profile the first one adds.
test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  await model.start();
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
  model.stop();
});

const composer = (page: Page) => page.locator(".composer:visible textarea");
const literally = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test("a file dropped on the message box goes in as the path of a copy on the host, and an image dropped with it as an image", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const dialog = await createProfile(page, PROFILE, scriptedOpencodeEnvironment(model, host.root), "", "opencode");
  await dialog.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${PROFILE} · opencode` });
  const conversationId = await startConversation(page);
  const copies = join(host.dataDir, "dropped-files", conversationId);
  let release = () => {};
  const released = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/conversations/*/files", async (route) => {
    await released;
    await route.continue();
  });

  await composer(page).fill("Look at ");
  await dropFiles(composer(page), [{ name: "screenshot.png" }, { name: "server.log", text: LOG }, { name: "build output.log", text: "built\n" }]);

  await test.step("while the files are copied, placeholders hold their places and the message can't go yet", async () => {
    await expect(composer(page)).toHaveValue("Look at [Image #1] [Copying #1: server.log…] [Copying #2: build output.log…] ");
    await expect(page.locator(".composer:visible .send")).toBeDisabled();
    await expect(page.locator(".pasted-images .thumbnail"), "the image goes in as a pasted one does").toHaveCount(1);
    await expect(page.locator(".composer-problem")).toHaveCount(0);
  });

  const copyOf = (name: string) => `${literally(copies)}${literally(sep)}[^${literally(sep)}]+${literally(sep)}${literally(name)}`;
  const serverLog = copyOf("server.log");
  const buildLog = copyOf("build output.log");
  await test.step("then each placeholder becomes the path of the file's copy, quoted when it has a space", async () => {
    release();
    await expect(composer(page)).toHaveValue(new RegExp(`^Look at \\[Image #1\\] ${serverLog} "${buildLog}" $`));
    const [, serverLogCopy] = /\] (\S+) "/.exec(await composer(page).inputValue())!;
    expect(readFileSync(serverLogCopy!, "utf8")).toBe(LOG);
  });

  await test.step("the agent gets the paths with the message", async () => {
    await composer(page).press("Enter");
    await expect.poll(() => model.userMessagesInContext().at(-1) ?? "", { timeout: 120_000 }).toMatch(new RegExp(`${serverLog} "${buildLog}"`));
    await waitForTurnToEnd(page);
  });
});

test("a file the host can't take leaves no placeholder behind, and says why", async ({ page }) => {
  await signIn(page, host);
  await page.locator(".workspace li").first().click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${PROFILE} · opencode` });
  await startConversation(page);
  await page.route("**/conversations/*/files", (route) => route.fulfill({ status: 413, body: "A dropped file can be at most 100 MB." }));

  await dropFiles(composer(page), [{ name: "huge.log", text: "too much" }]);

  await expect(page.locator(".composer-problem")).toHaveText("Could not copy huge.log: A dropped file can be at most 100 MB.");
  await expect(composer(page)).toHaveValue("");
  await expect(page.locator(".composer:visible .send")).toBeDisabled();
});
