import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { addWorkspace, createProfile, sendMessage, signIn, waitForTurnToEnd } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

const host = new TestHost({ fakePrograms: true });

const fakeOpencode = () =>
  writeBunProgram(host.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"), { FAKE_ACP_PROMPTS: join(host.root, "prompts") });

test.beforeAll(async () => {
  fakeOpencode();
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const HOOK_LINES = ["<persisted-output>", "Recent context, needle in it", "", "Mode: code"];

test("an agent's notice shows as a notice of its own, keeping its lines, not as a wall of reply text", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, "notices", "", "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "notices · opencode" });
  await page.getByRole("button", { name: "+ New conversation" }).click();
  await sendMessage(page, "NOTICE");
  await waitForTurnToEnd(page);

  const notices = page.locator(".timeline:visible .agent-notice");
  await expect(notices).toHaveCount(3);
  await expect(notices.locator(".message.agent")).toHaveCount(0);
  await expect(page.locator(".timeline:visible .message.agent")).toHaveText(["Carrying on."]);

  await test.step("a notice of several lines is one line naming the hook once, folded", async () => {
    const folded = notices.first();
    await expect(folded.locator("summary")).toHaveText("SessionStart:compact hook · 4 lines");
    await expect(folded.locator(".notice-lines")).toBeHidden();
    await folded.locator("summary").click();
    const lines = folded.locator(".notice-lines");
    await expect(lines).toBeVisible();
    expect(await lines.innerText()).toBe(HOOK_LINES.join("\n"));
    await folded.locator("summary").click();
    await expect(lines).toBeHidden();
  });

  await test.step("a short notice shows whole, told apart by its severity", async () => {
    await expect(notices.nth(1)).toHaveText("Warning: PreToolUse:Bash hook: rm -rf was blocked");
    await expect(notices.nth(1)).toHaveClass(/warning/);
    await expect(notices.nth(2)).toHaveText("Warning: Fast mode turned off: Claude could not serve it right now.");
    await expect(notices).toHaveCount(3);
    await expect(page.locator(".timeline:visible")).not.toContainText("**");
  });

  await test.step("a warning's severity, shown by its colour, is a word only a screen reader says, and an info notice has none", async () => {
    const spoken = notices.nth(1).locator(".visually-hidden");
    await expect(spoken).toHaveText("Warning: ");
    expect((await spoken.boundingBox())!.width).toBeLessThanOrEqual(1);
    await expect(notices.first().locator(".visually-hidden")).toHaveCount(0);
  });

  await test.step("find unfolds the notice it matches, as it does a hook message", async () => {
    await page.keyboard.press("Control+KeyF");
    await page.getByRole("search").getByLabel("Find in this conversation").fill("needle");
    await expect(page.getByRole("search").locator(".find-tally")).toHaveText("1 of 1");
    await expect(notices.first().locator(".notice-lines")).toBeVisible();
  });
});
