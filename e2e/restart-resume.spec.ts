import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { FakeClaudeApi, subscriptionEnvironment } from "./fake-claude-api.ts";
import { addWorkspace, createProfile, sendMessage, signIn, startConversation, waitForTurnToEnd } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();
const api = new FakeClaudeApi();
const configDir = join(host.root, "claude-config");
const REQUEST = "Remember the word heliotrope";

test.beforeAll(async () => {
  api.limited = false;
  await api.start();
  mkdirSync(configDir, { recursive: true });
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
  api.stop();
});

const primaryModifier = async (page: Page) => ((await page.evaluate(() => navigator.userAgent.includes("Mac"))) ? "Meta" : "Control");

const projects = join(configDir, "projects");
const transcripts = () =>
  existsSync(projects)
    ? readdirSync(projects).flatMap((project) => readdirSync(join(projects, project)).filter((name) => name.endsWith(".jsonl")).map((name) => join(projects, project, name)))
    : [];

test("a turn a restart stopped before Claude Code recorded its request gets the request again, not a bare continue", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, "restart api", `${subscriptionEnvironment(api)}\nCLAUDE_CONFIG_DIR=${configDir}`);
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "restart api · Claude Code" });
  await startConversation(page);

  api.hold();
  await sendMessage(page, REQUEST);
  await expect.poll(() => transcripts().some((path) => readFileSync(path, "utf8").includes(REQUEST)), { timeout: 30_000 }).toBe(true);
  transcripts().forEach((path) => rmSync(path));

  await page.keyboard.press(`${await primaryModifier(page)}+Shift+R`);
  await expect.poll(() => host.log.match(/Mirador is running/g)?.length, { timeout: 60_000 }).toBe(2);
  await expect(page.locator(".timeline:visible")).toContainText("Turn ended: cancelled", { timeout: 30_000 });
  api.answerHeld();

  await expect(page.locator(".timeline:visible .message.user", { hasText: REQUEST })).toHaveCount(2, { timeout: 60_000 });
  await waitForTurnToEnd(page);
  expect(api.answered).toContain(REQUEST);
  expect(api.answered).not.toContain("Continue where you left off.");
});
