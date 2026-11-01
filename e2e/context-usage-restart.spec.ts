import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, createProfile, reloadFromRestartedHost, sendMessage, signIn, startConversation, waitForTurnToEnd } from "./helpers.ts";
import { ScriptedModel, scriptedOpencodeEnvironment } from "./scripted-model.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();
const model = new ScriptedModel();
const PROFILE = "scripted opencode";
const USAGE = "43% · 42.5k / 100k";

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

test("an opencode conversation's context meter survives a host restart, which is where opencode's reports wait for a turn to end", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const dialog = await createProfile(page, PROFILE, scriptedOpencodeEnvironment(model, host.root), "", "opencode");
  await dialog.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${PROFILE} · opencode` });
  await startConversation(page);

  await sendMessage(page, "fill the context");
  await waitForTurnToEnd(page);
  const meter = page.locator(".context-meter");
  await expect(meter).toHaveText(USAGE, { timeout: 60_000 });

  await host.restart();
  await reloadFromRestartedHost(page);
  await expect(meter).toHaveText(USAGE, { timeout: 60_000 });
  await expect(page.locator(".chat-header:visible .harness")).toHaveText("opencode");
});
