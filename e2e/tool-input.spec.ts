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

test("a tool call's card draws what it holds once it opens, or once find has a match in it", async ({ page }) => {
  await signIn(page, host);
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "tools · opencode" });
  await page.getByRole("button", { name: "+ New conversation" }).click();
  await expect(page.locator(".chat-header:visible h2")).toHaveText("New conversation");
  const edits = ["first", "second", "third"].map((name) => ({ edit: join(host.projectDir, `${name}.ts`), content: `export const ${name} = true;\n` }));
  await sendMessage(page, `WRITE ${JSON.stringify(edits)}`);
  await waitForTurnToEnd(page);
  const [first, second, third] = [card(page, "first.ts"), card(page, "second.ts"), card(page, "third.ts")];
  const drawnDiffs = page.locator(".timeline:visible details.tool .diff");

  await test.step("a card nobody opened draws the files it names, and none of its diff", async () => {
    await expect(page.locator(".timeline:visible details.tool")).toHaveCount(3);
    await expect(second.locator(".locations button")).toHaveText(/second\.ts/);
    await expect(drawnDiffs).toHaveCount(0);
  });

  await test.step("opening a card draws its diff, which stays when the card closes", async () => {
    await first.locator(":scope > summary").click();
    await expect(first.locator(".diff")).toContainText("export const first = true;");
    await first.locator(":scope > summary").click();
    await expect(first.locator(".diff")).toBeHidden();
    await expect(drawnDiffs).toHaveCount(1);
  });

  await test.step("a card opens from the keyboard too", async () => {
    await third.locator(":scope > summary").focus();
    await page.keyboard.press("Enter");
    await expect(third.locator(".diff")).toBeVisible();
  });

  await test.step("find opens the card its match is in, and the diff stays once find closes", async () => {
    await page.reload();
    await expect(page.locator(".timeline:visible details.tool")).toHaveCount(3);
    await expect(drawnDiffs).toHaveCount(0);
    await page.keyboard.press("Control+KeyF");
    const find = page.getByRole("search");
    await find.getByLabel("Find in this conversation").fill("const second");
    await expect(find.locator(".find-tally")).toHaveText("2 of 2");
    await expect(second).toHaveAttribute("open");
    await expect(second.locator(".diff")).toBeInViewport();
    await expect(drawnDiffs, "a card without a match stays undrawn").toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(second.locator(".diff")).toBeVisible();
  });
});
