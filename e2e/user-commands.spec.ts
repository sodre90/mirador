import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, createProfile, sendMessage, signIn, startConversation, waitForTurnToEnd } from "./helpers.ts";
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

async function runCommand(page: Page, command: string) {
  const composer = page.locator(".composer textarea");
  await composer.fill(`!${command}`);
  await expect(page.locator(".composer.shell-mode")).toBeVisible();
  await composer.press("Enter");
  await expect(composer).toHaveValue("");
  return page.locator(".user-command", { hasText: command }).last();
}

const lastTextSent = () => model.textsSent().filter((text) => text.includes("check-")).at(-1) ?? "";

test("! runs a command in the workspace folder, and its output goes to the agent with the next message unless dropped", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const dialog = await createProfile(page, PROFILE, scriptedOpencodeEnvironment(model, host.root), "", "opencode");
  await dialog.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${PROFILE} · opencode` });
  await startConversation(page);

  const first = await runCommand(page, "pwd; echo to-stderr >&2");
  await expect(first.locator(".shell-output")).toContainText("/project");
  await expect(first.locator(".shell-output")).toContainText("to-stderr");
  await expect(first.locator(".shell-description")).toHaveText("Goes to the agent with your next message");
  const attached = page.locator(".command-outputs-attached");
  await expect(attached).toHaveText(/1 command output goes with your next message/);

  await sendMessage(page, "check-1 say what it printed");
  await waitForTurnToEnd(page);
  await expect.poll(lastTextSent).toMatch(/^<bash-input>pwd; echo to-stderr >&2<\/bash-input>\n<bash-stdout>.*\/project\n<\/bash-stdout><bash-stderr>to-stderr\n<\/bash-stderr>\n\ncheck-1 say what it printed$/);
  await expect(first.locator(".shell-description")).toHaveText("Sent to the agent with your message");
  await expect(attached).toHaveCount(0);

  const dropped = await runCommand(page, "echo not-for-the-agent");
  await expect(dropped.locator(".shell-output")).toHaveText("not-for-the-agent");
  await page.getByRole("button", { name: "Don't send the command outputs" }).click();
  await expect(attached).toHaveCount(0);
  await expect(dropped.locator(".shell-description")).toHaveText("Not sent to the agent");
  await sendMessage(page, "check-2 nothing attached");
  await waitForTurnToEnd(page);
  await expect.poll(lastTextSent).toBe("check-2 nothing attached");

  const stopped = await runCommand(page, "sleep 30; echo never");
  await expect(stopped.locator(".shell-description")).toHaveText("Goes to the agent with your next message once it finishes");
  await stopped.getByRole("button", { name: "Stop" }).click();
  await expect(stopped.locator(".shell-exit")).toHaveText("stopped");
  await expect(stopped.locator(".shell-quiet")).toHaveText("(no output)");

  await page.reload();
  await expect(page.locator(".user-command")).toHaveCount(3);
  await expect(page.locator(".user-command .shell-description").first()).toHaveText("Sent to the agent with your message");
  await expect(attached).toHaveText(/1 command output goes with your next message/);
});
