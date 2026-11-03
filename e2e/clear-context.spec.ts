import { expect, test } from "@playwright/test";
import { addWorkspace, createProfile, reloadFromRestartedHost, sendMessage, signIn, startConversation, waitForTurnToEnd } from "./helpers.ts";
import { ScriptedModel, scriptedOpencodeEnvironment } from "./scripted-model.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();
const model = new ScriptedModel();
const PROFILE = "scripted opencode";

test.beforeAll(async () => {
  await model.start();
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
  model.stop();
});

const context = () => model.userMessagesInContext().join("\n");

test("/clear starts the agent afresh while the conversation stays on screen, also queued and after a restart", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const dialog = await createProfile(page, PROFILE, scriptedOpencodeEnvironment(model, host.root), "", "opencode");
  await dialog.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${PROFILE} · opencode` });
  await startConversation(page);
  const composer = page.locator(".composer textarea");
  const cleared = page.locator(".notice-line", { hasText: "Context cleared: the agent starts afresh" });
  const userMessages = page.locator(".message.user");

  await sendMessage(page, "remember-1 the code word is plum");
  await waitForTurnToEnd(page);
  await sendMessage(page, "remember-2 and the colour is teal");
  await waitForTurnToEnd(page);
  await expect.poll(context).toContain("remember-2");
  expect(context()).toContain("remember-1");

  await test.step("the menu offers /clear, and Enter runs it: a line marks where the agent starts afresh", async () => {
    await composer.fill("/cle");
    const menu = page.getByRole("listbox", { name: "Slash commands" });
    await expect(menu.locator('[aria-selected="true"] .slash-command-name')).toHaveText("/clear");
    await composer.press("Enter");
    await expect(cleared).toHaveCount(1);
    await expect(composer).toHaveValue("");
    await expect(userMessages).toHaveCount(2);
  });

  await test.step("the next message reaches the agent without the conversation before it, which stays on screen", async () => {
    await sendMessage(page, "after-clear what was the code word?");
    await waitForTurnToEnd(page);
    await expect.poll(context).toContain("after-clear");
    expect(context()).not.toContain("remember-");
    await expect(userMessages.first()).toContainText("remember-1");
  });

  await test.step("a /clear sent while the agent works waits for the turn, and so does what is sent after it", async () => {
    await sendMessage(page, "RUN echo working");
    await expect(page.locator(".permission.pending")).toBeVisible({ timeout: 60_000 });
    for (const queued of ["/clear", "queued-after-clear"]) {
      await composer.fill(queued);
      await composer.press("Enter");
      await expect(composer).toHaveValue("");
    }
    await page.locator(".permission.pending button.option-allow_once").click();
    await expect(cleared).toHaveCount(2);
    await expect(userMessages.filter({ hasText: "queued-after-clear" })).toHaveCount(1);
    await waitForTurnToEnd(page);
    await expect.poll(context).toContain("queued-after-clear");
    expect(context()).not.toContain("after-clear what");
    expect(context()).not.toContain("RUN echo working");
  });

  await test.step("after a restart the agent resumes the fresh session, and the cleared context stays away", async () => {
    await host.stop();
    await host.start();
    await reloadFromRestartedHost(page);
    await expect(userMessages.filter({ hasText: "queued-after-clear" })).toHaveCount(1);
    await sendMessage(page, "after-restart");
    await waitForTurnToEnd(page);
    await expect.poll(context).toContain("after-restart");
    expect(context()).toContain("queued-after-clear");
    expect(context()).not.toContain("remember-");
    await expect(page.locator(".timeline")).not.toContainText("Could not resume");
  });

  await test.step("in Hungarian, the line that marks a /clear speaks Hungarian", async () => {
    await page.evaluate(() => localStorage.setItem("mirador-language", "hu"));
    await page.reload();
    await expect(page.locator(".notice-line:visible", { hasText: "Kontextus törölve: az ágens tiszta lappal indul" })).toHaveCount(2);
    await page.evaluate(() => localStorage.removeItem("mirador-language"));
  });
});
