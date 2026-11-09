import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { FakeClaudeApi, subscriptionEnvironment } from "./fake-claude-api.ts";
import { FakeGateway, gatewayEnvironment } from "./fake-gateway.ts";
import { addWorkspace, createProfile, openProfiles, sendMessage, signIn, startConversation, waitForTurnToEnd, conversationSettings, turnOnYolo, startInManualMode } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();
const prelaunchMarker = join(host.root, "prelaunch-ran");

const gateway = new FakeGateway();
const api = new FakeClaudeApi();
// Claude Code refuses a foreground `sleep 30` in the command itself, so the long tool call runs a script that waits.
const SLOW_SCRIPT = "wait-then-print.sh";

/** Claude Code retitles a session as later prompts come, so the conversation the tests share is opened by its id. */
let sharedConversationId = "";

const profilePicker = async (page: Page) => (await conversationSettings(page)).getByLabel("Profile", { exact: true });
const chosenProfile = async (page: Page) => (await profilePicker(page)).locator("option:checked");

/** The turn's own request with the text, not the one Claude Code sends on the side to title the session. */
async function requestContaining(text: string) {
  const find = () => gateway.messageRequests().find(({ body }) => body.includes(text) && !body.includes("naming a coding session"));
  await expect.poll(find, { timeout: 60_000 }).toBeDefined();
  return find()!;
}

test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  api.limited = false;
  await api.start();
  await gateway.start();
  await host.start();
  writeFileSync(join(host.projectDir, SLOW_SCRIPT), "sleep 30\necho slept-long\n");
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
  gateway.stop();
  api.stop();
});

test("a profile's environment and pre-launch command reach Claude Code, and its secrets stay hidden", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);

  const dialog = await openProfiles(page);
  await dialog.locator(".profile-list li", { hasText: "+ New profile" }).click();
  await dialog.getByLabel("Environment", { exact: true }).fill('ANTHROPIC_MODEL="$model"');
  await expect(dialog.locator(".form-errors")).toContainText("values are not expanded");
  await expect(dialog.getByRole("button", { name: "Create profile" })).toBeDisabled();
  await dialog.getByRole("button", { name: "Close" }).click();

  const environment = [
    "-u ANTHROPIC_API_KEY",
    "# pasted from a shell alias",
    `ANTHROPIC_BASE_URL=${gateway.url}`,
    'ANTHROPIC_AUTH_TOKEN="e2e-gateway-token"',
    "ANTHROPIC_MODEL=e2e-gateway-model",
  ].join("\n");
  const saved = await createProfile(page, "fake gateway", environment, `echo "$ANTHROPIC_BASE_URL" > '${prelaunchMarker}'`);
  await expect(saved.getByLabel("Environment (secrets hidden)")).toContainText("ANTHROPIC_AUTH_TOKEN=••••••");
  await expect(page.getByText("e2e-gateway-token")).toHaveCount(0);
  await saved.getByRole("button", { name: "Close" }).click();

  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "fake gateway · Claude Code" });
  sharedConversationId = await startConversation(page);
  await expect(await chosenProfile(page)).toHaveText("fake gateway");
  await expect((await conversationSettings(page)).getByLabel("Model", { exact: true })).toHaveValue("e2e-gateway-model");
  expect(readFileSync(prelaunchMarker, "utf8").trim()).toBe(gateway.url);

  await sendMessage(page, "hello");
  await expect.poll(() => gateway.tokensSentToMessages(), { timeout: 60_000 }).toContain("Bearer e2e-gateway-token");
  expect(gateway.messageRequests().some(({ body }) => JSON.parse(body).model === "e2e-gateway-model")).toBe(true);
  await expect(page.locator(".timeline")).toContainText("fake gateway says no", { timeout: 60_000 });
  await waitForTurnToEnd(page);
});

test("saving a changed profile restarts its agent, and the conversation continues with the new environment", async ({ page }) => {
  await signIn(page, host);
  await page.locator(".workspace li").first().click();
  const dialog = await openProfiles(page);
  await dialog.locator(".profile-list li", { hasText: "fake gateway" }).click();
  await dialog.getByRole("button", { name: "Edit environment" }).click();
  const field = dialog.getByLabel("Environment", { exact: true });
  await field.fill((await field.inputValue()).replace("e2e-gateway-token", "e2e-rotated-token"));
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog.getByText("Saved")).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).click();

  await sendMessage(page, "hello again");
  await expect.poll(() => gateway.tokensSentToMessages(), { timeout: 60_000 }).toContain("Bearer e2e-rotated-token");
  await expect(page.locator(".timeline")).not.toContainText("agent process was restarted");
  await waitForTurnToEnd(page);
});

test("a failing pre-launch command is reported with its output", async ({ page }) => {
  await signIn(page, host);
  await createProfile(page, "broken proxy", "A=1", "echo 'proxy binary missing' >&2; exit 3");
  await page.getByRole("dialog", { name: "Profiles" }).getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "broken proxy · Claude Code" });
  await page.getByRole("button", { name: "+ New conversation" }).click();
  await expect(page.locator(".chat-header .status-detail")).toContainText(
    "The pre-launch command of Claude Code (broken proxy) exited with 3: proxy binary missing",
    { timeout: 30_000 },
  );
  expect(existsSync(prelaunchMarker)).toBe(true);

  await page.evaluate(() => localStorage.setItem("mirador-language", "hu"));
  await page.reload();
  await expect(page.locator(".chat-header:visible .status-detail")).toHaveText("Az indítás előtti parancs (Claude Code (broken proxy)) kilépett (3): proxy binary missing");
  await page.evaluate(() => localStorage.removeItem("mirador-language"));
});

test("a conversation moves to another profile of its agent and continues the same session there", async ({ page }) => {
  await signIn(page, host);
  const saved = await createProfile(page, "second gateway", `${gatewayEnvironment(gateway, "e2e-second-token")}\nANTHROPIC_MODEL=e2e-second-model`);
  await saved.getByRole("button", { name: "Close" }).click();
  await page.goto(`${host.origin}/#/c/${sharedConversationId}`);
  await expect(await chosenProfile(page)).toHaveText("fake gateway");

  await (await profilePicker(page)).selectOption({ label: "second gateway" });
  await expect(page.locator(".timeline")).toContainText("Now using the profile “second gateway”");
  await expect((await conversationSettings(page)).getByLabel("Model", { exact: true })).toHaveValue("e2e-second-model", { timeout: 60_000 });
  await sendMessage(page, "after the switch");
  const afterSwitch = await requestContaining("after the switch");
  expect(afterSwitch.authorization).toBe("Bearer e2e-second-token");
  expect(JSON.parse(afterSwitch.body).model).toBe("e2e-second-model");
  expect(afterSwitch.body).toContain("hello again");
  await waitForTurnToEnd(page);
  await expect(page.locator(".timeline")).not.toContainText("Could not resume");
});

test("a new conversation moved to another profile before its first message starts there", async ({ page }) => {
  await signIn(page, host);
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "fake gateway · Claude Code" });
  await startConversation(page);
  await (await profilePicker(page)).selectOption({ label: "second gateway" });
  await expect((await conversationSettings(page)).getByLabel("Model", { exact: true })).toHaveValue("e2e-second-model", { timeout: 60_000 });

  await sendMessage(page, "first message, on the second gateway");
  const first = await requestContaining("first message, on the second gateway");
  expect(first.authorization).toBe("Bearer e2e-second-token");
  await waitForTurnToEnd(page);
  await expect(page.locator(".timeline")).not.toContainText("Could not resume");
  await expect(page.locator(".timeline")).toContainText("fake gateway says no");
});

test("a conversation whose profile was deleted continues after picking another one", async ({ page }) => {
  await signIn(page, host);
  const dialog = await openProfiles(page);
  await dialog.locator(".profile-list li", { hasText: "second gateway" }).click();
  await dialog.getByRole("button", { name: "Delete profile" }).click();
  await dialog.getByRole("button", { name: "Confirm: Delete profile" }).click();
  await expect(dialog.locator(".profile-list li", { hasText: "second gateway" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Close" }).click();
  await page.goto(`${host.origin}/#/c/${sharedConversationId}`);
  await expect(await chosenProfile(page)).toHaveText("Deleted profile");

  await (await profilePicker(page)).selectOption({ label: "fake gateway" });
  await expect((await conversationSettings(page)).getByLabel("Model", { exact: true })).toHaveValue("e2e-gateway-model", { timeout: 60_000 });
  await sendMessage(page, "back on the first gateway");
  const afterSwitch = await requestContaining("back on the first gateway");
  expect(afterSwitch.authorization).toBe("Bearer e2e-rotated-token");
  expect(afterSwitch.body).toContain("after the switch");
  await waitForTurnToEnd(page);
});

test("switching profile while the agent works stops the turn, moves the session and continues it there, then sends the queue", async ({ page }) => {
  await signIn(page, host);
  const saved = await createProfile(page, "scripted claude", `${subscriptionEnvironment(api)}\nCLAUDE_CONFIG_DIR=${host.claudeConfigDir}`);
  await startInManualMode(saved);
  await saved.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "scripted claude · Claude Code" });
  await startConversation(page);
  await turnOnYolo(page);
  await sendMessage(page, `RUN sh ${SLOW_SCRIPT}`);
  await expect(page.locator(".timeline").locator(".tool-pending, .tool-in_progress").first()).toBeVisible();
  const composer = page.locator(".composer textarea");
  await composer.fill("queued before the switch");
  await composer.press("Enter");
  await expect(page.locator(".queue .queued-text")).toHaveText(["queued before the switch"]);

  await expect(await profilePicker(page)).toBeEnabled();
  await (await profilePicker(page)).selectOption({ label: "fake gateway" });
  await expect(page.locator(".timeline")).toContainText("Turn ended: cancelled");
  await expect(page.locator(".timeline")).toContainText("Now using the profile “fake gateway”");
  const continued = await requestContaining("Continue where you left off.");
  expect(continued.body).toContain(SLOW_SCRIPT);
  const queued = await requestContaining("queued before the switch");
  expect(gateway.requests.indexOf(queued)).toBeGreaterThan(gateway.requests.indexOf(continued));
  await expect(page.locator(".message.user").last()).toHaveText("queued before the switch", { timeout: 60_000 });
  await waitForTurnToEnd(page);
  await expect(page.locator(".timeline")).not.toContainText("Could not resume");
});
