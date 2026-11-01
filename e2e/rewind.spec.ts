import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { FakeClaudeApi, subscriptionEnvironment } from "./fake-claude-api.ts";
import { addWorkspace, createProfile, lastAgentMessage, primaryModifier, sendMessage, signIn, startConversation, waitForTurnToEnd } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();
const api = new FakeClaudeApi();
const PROFILE = "rewindable";
const readme = join(host.projectDir, "README.md");
const made = join(host.projectDir, "made.txt");
const second = join(host.projectDir, "second.txt");
const third = join(host.projectDir, "third.txt");

const git = (...args: string[]) =>
  execFileSync("git", ["-C", host.projectDir, "-c", "user.name=e2e", "-c", "user.email=e2e@localhost", ...args], { encoding: "utf8" }).trim();

test.beforeAll(async () => {
  api.limited = false;
  await api.start();
  await host.start();
  await git("init", "-q");
  await git("add", "-A");
  await git("commit", "-qm", "the project as it was");
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
  api.stop();
});

/** The turn that began with this message, and the way back to it, which shows while the turn is pointed at. */
const turn = (page: Page, text: string) => page.locator(".timeline:visible .timeline-entry").filter({ has: page.locator(".message.user").getByText(text, { exact: true }) });
const rewindButton = (page: Page, text: string) => turn(page, text).locator(".undo-files");

async function answer(page: Page, task: string) {
  await sendMessage(page, task);
  await expect(lastAgentMessage(page)).toHaveText(`Answered: ${task}`, { timeout: 120_000 });
  await waitForTurnToEnd(page);
}

/** What the agent's own history held when it answered this task, as the request that carried it shows. */
const historyOf = (task: string) => api.history.find((messages) => messages.join("\n").includes(task))!.join("\n");

test("taking a conversation back leaves the turns after it, and the files as they were then", async ({ page }) => {
  test.setTimeout(300_000);
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, PROFILE, subscriptionEnvironment(api));
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${PROFILE} · Claude Code` });
  await startConversation(page);

  await test.step("three turns, the files changed by hand between them", async () => {
    await answer(page, "First task");
    writeFileSync(readme, "from the first turn\n");
    writeFileSync(made, "made by the first turn\n");
    await answer(page, "Second task");
    writeFileSync(second, "made by the second turn\n");
    await answer(page, "Third task");
    writeFileSync(readme, "from the third turn\n");
    writeFileSync(third, "made by the third turn\n");
  });

  const otherPage = await page.context().newPage();
  await otherPage.goto(page.url());

  await test.step("the message of a turn offers to go back to it", async () => {
    await expect(rewindButton(page, "Second task")).toBeHidden();
    await turn(page, "Second task").hover();
    await expect(rewindButton(page, "Second task")).toHaveText("Rewind to here");
  });

  await test.step("the dialog says what the conversation and the files lose", async () => {
    await rewindButton(page, "Second task").click();
    const dialog = page.getByRole("dialog", { name: "Rewind to here" });
    await expect(dialog).toContainText("2 turns leave the conversation, and the agent's own history goes back with them, to before “First task”.");
    await expect(dialog).toContainText("The files go back too, to how they were when this turn began: 1 file put back as it was and 2 files deleted that were created since.");
    await dialog.getByRole("button", { name: "Rewind", exact: true }).click();
    await expect(dialog).toHaveCount(0);
  });

  await test.step("every page showing it drops the turn and everything after it, and keeps what came before", async () => {
    for (const showing of [page, otherPage]) {
      await expect(showing.locator(".timeline")).toContainText("First task");
      await expect(showing.locator(".timeline")).not.toContainText("Second task");
      await expect(showing.locator(".timeline")).not.toContainText("Third task");
    }
  });

  await test.step("the files go back to how they were when the turn began", async () => {
    expect(readFileSync(readme, "utf8")).toBe("from the first turn\n");
    expect(readFileSync(made, "utf8")).toBe("made by the first turn\n");
    expect(() => readFileSync(second, "utf8")).toThrow();
    expect(() => readFileSync(third, "utf8")).toThrow();
  });

  await test.step("the agent goes on without what came after that turn", async () => {
    await answer(page, "Fourth task");
    expect(historyOf("Fourth task")).toContain("First task");
    expect(historyOf("Fourth task")).not.toContain("Second task");
    expect(historyOf("Fourth task")).not.toContain("Third task");
  });

  await test.step("going back to a turn that changed no file says so, and offers no choice about the files", async () => {
    await turn(page, "Fourth task").hover();
    await rewindButton(page, "Fourth task").click();
    const dialog = page.getByRole("dialog", { name: "Rewind to here" });
    await expect(dialog).toContainText("No file changed since this turn began.");
    await expect(dialog.getByRole("checkbox", { name: "Put the files back too" })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
  });

  await test.step("the palette goes back to the first turn, which leaves the agent with nothing of the conversation", async () => {
    const primary = await primaryModifier(page);
    await page.keyboard.press(`${primary}+KeyK`);
    await page.getByLabel("Search conversations and actions").fill("rewind to before");
    await page.getByRole("option", { name: /^Rewind to before “First task”/ }).click();
    const dialog = page.getByRole("dialog", { name: "Rewind to here" });
    await expect(dialog).toContainText("Every turn leaves the conversation, and the agent starts over with nothing of it.");
    await dialog.getByRole("button", { name: "Rewind", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator(".timeline")).not.toContainText("Fourth task");

    await answer(page, "Fifth task");
    expect(historyOf("Fifth task")).not.toContain("First task");
  });

  await otherPage.close();
});
