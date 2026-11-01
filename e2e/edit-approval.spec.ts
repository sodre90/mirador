import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, createProfile, lastAgentMessage, openSettings, sendMessage, signIn } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

const host = new TestHost({ fakePrograms: true });
const appFile = join(host.projectDir, "src", "app.ts");
const appFileShown = join("src", "app.ts");
const numbered = (count: number) => Array.from({ length: count }, (_, index) => `line ${index + 1}`).join("\n") + "\n";

/** An opencode that is the scripted agent, asking permission for the edits a prompt names. */
function fakeOpencode() {
  writeBunProgram(host.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"), { FAKE_ACP_PROMPTS: join(host.root, "prompts") });
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  fakeOpencode();
  mkdirSync(join(host.projectDir, "src"), { recursive: true });
  writeFileSync(appFile, numbered(30));
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const edit = (title: string, oldText: string | null, newText: string) => ({ title, path: appFile, oldText, newText });
const askToEdit = (page: Page, ...edits: ReturnType<typeof edit>[]) => sendMessage(page, `EDIT ${JSON.stringify(edits)}`);
const canvas = (page: Page) => page.locator(".canvas-panel:visible");
const editView = (page: Page) => page.locator(".canvas-panel:visible .edit-approval");
const pendingCard = (page: Page) => page.locator(".timeline:visible .permission.pending");

async function startConversation(page: Page) {
  const previousUrl = page.url();
  await page.getByRole("button", { name: "+ New conversation" }).click();
  await expect(page).not.toHaveURL(previousUrl);
}

async function signInToWorkspace(page: Page) {
  await signIn(page, host);
  await page.locator(".workspace li").first().click();
}

test("an edit the agent waits to make takes the canvas with the file's line numbers, unified or split, and answering clears it", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, "edits", "", "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "edits · opencode" });
  await startConversation(page);
  await askToEdit(page, edit("Edit src/app.ts", "line 15\n", "line fifteen\nline fifteen and a half\n"));

  const view = editView(page);
  await expect(canvas(page).locator(".canvas-title")).toHaveText("Edit src/app.ts");
  await expect(view.locator(".edited-file h3")).toHaveText(appFileShown);
  await expect(view.locator(".edit-counts")).toHaveText("+2 −1");
  await expect(view.locator(".code-row.removed .line-number")).toHaveText("15");
  await expect(view.locator(".code-row.added .line-number")).toHaveText(["15", "16"]);
  await expect(view.locator(".code-row.context .line-number").first()).toHaveText("12");
  await expect(view.locator(".code-row.removed .word-changed")).toHaveText("15");
  await expect(view.locator(".code-row.added .word-changed")).toHaveText(["fifteen"]);
  const backgrounds = await view.locator(".code-row.added").first().evaluate((row) => ({
    line: getComputedStyle(row).backgroundColor,
    word: getComputedStyle(row.querySelector(".word-changed")!).backgroundColor,
  }));
  expect(backgrounds.word).not.toBe(backgrounds.line);
  await expect(view.locator(".edit-gap")).toHaveText(["⋯ lines 1–11", "⋯ lines 20–31"]);
  await expect(pendingCard(page)).toContainText("+2 −1 · Shown in the canvas");
  await expect(pendingCard(page).locator(".diff")).toHaveCount(0);

  await test.step("Split shows the old lines facing the new ones, and stays chosen after a reload", async () => {
    await view.getByRole("button", { name: "Split" }).click();
    await expect(view.locator(".split-row").filter({ hasText: "line 15" })).toContainText("line fifteen");
    await expect(view.locator(".split-side.added")).toHaveCount(2);
    await expect(view.locator(".split-side.removed .word-changed")).toHaveText("15");
    await expect(view.locator(".split-side.added .word-changed")).toHaveText(["fifteen"]);
    const rowHeights = await view.locator(".split-row").evaluateAll((rows) => rows.map((row) => row.getBoundingClientRect().height));
    expect(new Set(rowHeights).size).toBe(1);
    await page.reload();
    await expect(editView(page).getByRole("button", { name: "Split" })).toHaveAttribute("aria-pressed", "true");
    await expect(editView(page).locator(".split-side.removed .line-number")).toHaveText("15");
  });

  await editView(page).getByRole("button", { name: "Allow", exact: true }).click();
  await expect(canvas(page).locator(".settled-note")).toHaveText(`✓ Allowed: edit to ${appFileShown}`);
  await expect(canvas(page).locator(".settled-note")).toHaveClass(/done/);
  await expect(editView(page)).toHaveCount(0);
  await expect(lastAgentMessage(page)).toHaveText("Edit src/app.ts: allow");
  await expect(page.locator(".timeline:visible .permission.resolved .permission-outcome")).toHaveText("Allow");
  await expect(canvas(page).getByRole("button", { name: /^History/ })).toHaveText("History (0)");
});

test("edits waiting at once show oldest first, one not found in the file shows the agent's snippet, and Clear sets them aside", async ({ page }) => {
  await signInToWorkspace(page);
  await startConversation(page);
  await askToEdit(page, edit("Edit src/app.ts", "not in the file", "something else"), edit("Write src/app.ts", null, numbered(30).replace("line 3\n", "line three\n")));

  const view = editView(page);
  await expect(canvas(page).locator(".canvas-title")).toHaveText("Edit src/app.ts");
  await expect(view.locator(".edits-more")).toHaveText("1 more edit waiting");
  await expect(view.locator(".edited-file .hint")).toContainText("could not be found in the file");
  await expect(view.locator(".code-row .line-number")).toHaveText(["", ""]);
  await expect(view.locator(".code-row.removed")).toContainText("not in the file");

  await test.step("Clear sets the edits aside, and the header brings them back", async () => {
    await canvas(page).getByRole("button", { name: "Clear" }).click();
    await expect(view).toHaveCount(0);
    await canvas(page).getByRole("button", { name: "2 edits waiting" }).click();
    await expect(canvas(page).locator(".canvas-title")).toHaveText("Edit src/app.ts");
  });

  await pendingCard(page).first().getByRole("button", { name: "Reject" }).click();
  await expect(canvas(page).locator(".canvas-title")).toHaveText("Write src/app.ts");
  await expect(view.locator(".settled-note")).toHaveText(`✗ Rejected: edit to ${appFileShown}`);
  await expect(view.locator(".settled-note")).toHaveClass(/neutral/);
  await expect(view.locator(".edits-more")).toHaveCount(0);
  await expect(view.locator(".edit-counts")).toHaveText("+1 −1");
  await expect(view.locator(".code-row.removed .line-number")).toHaveText("3");
  await expect(view.locator(".edit-gap")).toHaveText(["⋯ lines 7–30"]);

  await view.getByRole("button", { name: "Always allow" }).click();
  await expect(canvas(page).locator(".settled-note")).toHaveText(`✓ Always allowed: edit to ${appFileShown}`);
  await expect(lastAgentMessage(page)).toHaveText("Edit src/app.ts: reject; Write src/app.ts: always");
});

test("with edits kept out of the canvas in Settings, or the canvas hidden, the chat card shows the diff", async ({ page }) => {
  await signInToWorkspace(page);
  await startConversation(page);
  const showInCanvas = async (on: boolean) => {
    const settings = await openSettings(page, "Canvas");
    await settings.getByLabel("Show edits waiting for approval in the canvas").setChecked(on);
    await settings.getByRole("button", { name: "Close" }).click();
  };

  await showInCanvas(false);
  await askToEdit(page, edit("Edit src/app.ts", "line 7\n", `line seven ${"and on ".repeat(80)}\n`));
  await expect(pendingCard(page).locator(".diff")).toContainText("line seven");
  await expect(editView(page)).toHaveCount(0);

  await test.step("lines wider than the card keep their colour all the way when scrolled", async () => {
    const widths = await pendingCard(page)
      .locator(".diff pre")
      .evaluate((pre) => ({ scrolled: pre.scrollWidth, shown: pre.clientWidth, rows: [...pre.children].map((row) => (row as HTMLElement).offsetWidth) }));
    expect(widths.scrolled).toBeGreaterThan(widths.shown);
    expect(widths.rows).toEqual(widths.rows.map(() => widths.scrolled));
  });
  await expect(canvas(page).locator(".canvas-title")).toHaveText("Canvas");
  await pendingCard(page).getByRole("button", { name: "Allow", exact: true }).click();
  await expect(lastAgentMessage(page)).toHaveText("Edit src/app.ts: allow");

  await showInCanvas(true);
  await page.locator(".chat-header:visible").getByRole("button", { name: "Hide canvas" }).click();
  await askToEdit(page, edit("Edit src/app.ts", "line 8\n", "line eight\n"));
  await expect(pendingCard(page).locator(".diff")).toContainText("line eight");
  await expect(pendingCard(page).locator(".diff-removed .word-changed")).toHaveText("8");
  await expect(pendingCard(page).locator(".diff-added .word-changed")).toHaveText("eight");
  const fontSizes = await pendingCard(page).locator(".diff-added").evaluate((line) => ({
    line: getComputedStyle(line).fontSize,
    text: getComputedStyle(line.querySelector(".code-text")!).fontSize,
  }));
  expect(fontSizes.text).toBe(fontSizes.line);
  await page.locator(".chat-header:visible").getByRole("button", { name: "Show canvas" }).click();
  await expect(editView(page).locator(".code-row.added")).toContainText("line eight");
  await expect(pendingCard(page)).toContainText("Shown in the canvas");
  await expect(pendingCard(page).locator(".diff")).toHaveCount(0);
});

test("a subagent's step waiting for your permission waits in its card instead of showing as running", async ({ page }) => {
  await signInToWorkspace(page);
  await startConversation(page);
  await sendMessage(page, "SUBAGENT ASKS ls");

  const card = page.locator(".timeline:visible .tool.subagent");
  await expect(card).toBeVisible();
  await card.locator("> summary").click();
  await expect(pendingCard(page)).toBeVisible();
  await expect(card.locator(".subagent-work .tool-status")).toHaveText("○");
  await expect(card.locator(":scope > summary > .tool-status"), "the subagent itself is still running").toHaveText("◐");

  await pendingCard(page).getByRole("button", { name: "Allow", exact: true }).click();
  await expect(lastAgentMessage(page)).toHaveText("ls: allow");
  await expect(page.locator(".timeline:visible .working")).toHaveCount(0);
});
