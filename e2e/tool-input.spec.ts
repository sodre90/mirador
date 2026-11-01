import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, createProfile, sendMessage, signIn, waitForTurnToEnd } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

const host = new TestHost({ fakePrograms: true });

test.beforeAll(async () => {
  writeBunProgram(host.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"), { FAKE_ACP_PROMPTS: join(host.root, "prompts") });
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const card = (page: Page, title: string) => page.locator(".timeline:visible details.tool").filter({ hasText: title });
const inputOf = (page: Page, title: string) => card(page, title).locator("details.raw").filter({ has: page.locator("summary", { hasText: "input" }) });

test("a tool call shows the input it was given, and a tool that takes none shows no empty input", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, "tools", "", "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "tools · opencode" });
  await page.getByRole("button", { name: "+ New conversation" }).click();
  const tools = [
    { title: "Ask the advisor", kind: "other", rawInput: {} },
    { title: "Read notes.md", kind: "read", rawInput: { file_path: "notes.md" } },
  ];
  await sendMessage(page, `RUN TOOLS ${JSON.stringify(tools)}`);
  await waitForTurnToEnd(page);

  for (const { title } of tools) await card(page, title).locator(":scope > summary").click();
  await inputOf(page, "Read notes.md").locator("summary").click();
  await expect(inputOf(page, "Read notes.md").locator("pre")).toContainText('"file_path": "notes.md"');
  await expect(inputOf(page, "Ask the advisor")).toHaveCount(0);
});
