import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { addWorkspace, createProfile, reloadFromRestartedHost, sendMessage, signIn, waitForTurnToEnd } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

const host = new TestHost({ fakePrograms: true });
const PROFILE = "resume fails";
const USAGE = "43% · 42.5k / 100k";

test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  writeBunProgram(host.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"), {
    FAKE_ACP_PROMPTS: join(host.root, "prompts"),
    FAKE_ACP_RESUME_FAILS: "1",
  });
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

test("a conversation whose session cannot be resumed after a restart starts the fresh one with an empty context meter", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, PROFILE, "", "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${PROFILE} · opencode` });
  const previousUrl = page.url();
  await page.getByRole("button", { name: "+ New conversation" }).click();
  await expect(page).not.toHaveURL(previousUrl);

  await sendMessage(page, "USAGE 42500 100000");
  await waitForTurnToEnd(page);
  const meter = page.locator(".context-meter");
  await expect(meter).toHaveText(USAGE);

  await host.restart();
  await reloadFromRestartedHost(page);
  await expect(meter).toHaveText(USAGE);

  await sendMessage(page, "SAY hello");
  await waitForTurnToEnd(page);
  await expect(page.locator(".timeline:visible")).toContainText("Could not resume the previous agent session");
  await expect(page.locator(".timeline:visible .message.agent").last()).toHaveText("hello");
  await expect(meter).toHaveCount(0);

  await host.restart();
  await reloadFromRestartedHost(page);
  await expect(page.locator(".timeline:visible .message.agent").last()).toHaveText("hello");
  await expect(meter).toHaveCount(0);
});
