import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { addWorkspace, createProfile, signIn, waitForTurnToEnd } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

const host = new TestHost({ fakePrograms: true });
const promptsFile = join(host.root, "prompts");

test.beforeAll(async () => {
  writeBunProgram(host.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"), { FAKE_ACP_PROMPTS: promptsFile });
  writeFileSync(promptsFile, "");
  mkdirSync(host.projectDir, { recursive: true });
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const MESSAGE = [
  "Please **check** the *new* ~~old~~ `web/Chat.tsx` and [the docs](https://example.com/docs).",
  "",
  "```ts",
  "const total = 2 * 3 * 4;",
  "```",
  "> what they said",
  "- first",
  "- second",
  "1. one",
  "2. two",
  "# not a heading",
  "src/**/*.ts stays",
].join("\n");

test("a sent message shows Slack's formatting, its lines where they were typed, and goes to the agent as typed", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, "slack", "", "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "slack · opencode" });
  await page.getByRole("button", { name: "+ New conversation" }).click();

  const composer = page.locator(".composer:visible textarea");
  await expect(composer).toBeEditable();
  await composer.fill(MESSAGE);
  await composer.press("Enter");
  await waitForTurnToEnd(page);

  const sent = page.locator(".timeline:visible .message.user").last();
  await expect(sent.locator("strong")).toHaveText("check");
  await expect(sent.locator("em")).toHaveText("new");
  await expect(sent.locator("s")).toHaveText("old");
  await expect(sent.locator("button.file-link code")).toHaveText("web/Chat.tsx");
  await expect(sent.getByRole("link", { name: "the docs" })).toHaveAttribute("href", "https://example.com/docs");
  await expect(sent.locator(".copyable-code pre")).toHaveText("const total = 2 * 3 * 4;");
  await expect(sent.locator(".copyable-code .code-copy")).toHaveCount(1);
  await expect(sent.locator("blockquote")).toHaveText("what they said");
  await expect(sent.locator("ul > li")).toHaveText(["first", "second"]);
  await expect(sent.locator("ol > li")).toHaveText(["one", "two"]);
  await expect(sent.locator(".message-line").filter({ hasText: "# not a heading" })).toHaveCount(1);
  await expect(sent.locator(".message-line").filter({ hasText: "src/**/*.ts stays" })).toHaveCount(1);
  await expect(sent.locator("h1")).toHaveCount(0);

  const blankLine = sent.locator(".message-line").nth(1);
  await expect(blankLine).toHaveText("");
  expect((await blankLine.boundingBox())!.height).toBeGreaterThan(10);

  await expect.poll(() => readFileSync(promptsFile, "utf8")).toContain(MESSAGE);
});
