import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { FakeClaudeApi, subscriptionEnvironment } from "./fake-claude-api.ts";
import { addWorkspace, createProfile, lastAgentMessage, sendMessage, signIn, startConversation, waitForTurnToEnd } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();
const api = new FakeClaudeApi();
const PROFILE = "rewindable";
const notes = join(host.projectDir, "notes.md");
const pulled = join(host.projectDir, "pulled.md");
const scratch = join(host.projectDir, "scratch.md");

const git = (...args: string[]) =>
  execFileSync("git", ["-C", host.projectDir, "-c", "user.name=e2e", "-c", "user.email=e2e@localhost", ...args], { encoding: "utf8" }).trim();

test.beforeAll(async () => {
  api.limited = false;
  await api.start();
  await host.start();
  writeFileSync(notes, "as committed\n");
  git("init", "-q");
  git("add", "-A");
  git("commit", "-qm", "the project as it was");
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
  api.stop();
});

const turn = (page: Page, text: string) => page.locator(".timeline:visible .timeline-entry").filter({ has: page.locator(".message.user").getByText(text, { exact: true }) });

async function answer(page: Page, task: string) {
  await sendMessage(page, task);
  await expect(lastAgentMessage(page)).toHaveText(`Answered: ${task}`, { timeout: 120_000 });
  await waitForTurnToEnd(page);
}

/** The paths the dialog lists under a heading, once its files are shown. */
const listedUnder = (dialog: Locator, heading: string) => dialog.getByRole("region", { name: heading }).getByRole("listitem");

async function openRewind(page: Page, task: string) {
  await turn(page, task).hover();
  await turn(page, task).locator(".undo-files").click();
  return page.getByRole("dialog", { name: "Rewind to here" });
}

test("a rewind leaves what commits since the turn changed as committed, lists the files it touches, and can leave every file as it is", async ({ page }) => {
  test.setTimeout(300_000);
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, PROFILE, subscriptionEnvironment(api));
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${PROFILE} · Claude Code` });
  await startConversation(page);

  await test.step("a turn edits a file, and a pull comes in after it began", async () => {
    await answer(page, "First task");
    await answer(page, "Second task");
    writeFileSync(notes, "edited in the second turn\n");
    writeFileSync(scratch, "made in the second turn\n");
    writeFileSync(pulled, "from a pull\n");
    git("add", "pulled.md");
    git("commit", "-qm", "a pull");
  });

  await test.step("the dialog says the pull's file stays as committed, lists each file, and puts the edits back", async () => {
    const dialog = await openRewind(page, "Second task");
    await expect(dialog).toContainText("1 turn leaves the conversation, and the agent's own history goes back with it, to before “First task”.");
    await expect(dialog).toContainText(
      "The files go back too, to how they were when this turn began: 1 file put back as it was and 1 file deleted that was created since. 1 commit came in since then, and the 1 file it changed stays as committed.",
    );
    await expect(dialog.getByRole("region", { name: "Deleted" })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Show the files" }).click();
    await expect(listedUnder(dialog, "Deleted")).toHaveText(["scratch.md"]);
    await expect(listedUnder(dialog, "Put back as they were")).toHaveText(["notes.md"]);
    await expect(listedUnder(dialog, "Stay as committed")).toHaveText(["pulled.md"]);
    await dialog.getByRole("button", { name: "Hide the files" }).click();
    await expect(dialog.getByRole("region", { name: "Deleted" })).toHaveCount(0);
    await expect(dialog.getByRole("checkbox", { name: "Put the files back too" })).toBeChecked();
    await dialog.getByRole("button", { name: "Rewind", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator(".timeline")).not.toContainText("Second task");
    expect(readFileSync(notes, "utf8")).toBe("as committed\n");
    expect(readFileSync(pulled, "utf8")).toBe("from a pull\n");
    expect(() => readFileSync(scratch, "utf8")).toThrow();
    expect(git("status", "--porcelain")).toBe("");
  });

  await test.step("with the files kept, only the conversation goes back", async () => {
    await answer(page, "Third task");
    writeFileSync(notes, "edited in the third turn\n");
    const dialog = await openRewind(page, "Third task");
    await expect(dialog).toContainText("The files go back too, to how they were when this turn began: 1 file put back as it was.");
    await dialog.getByRole("checkbox", { name: "Put the files back too" }).uncheck();
    await expect(dialog).toContainText("The files stay as they are now, with what the turns that leave did to them.");
    await expect(dialog.getByRole("button", { name: "Show the files" })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Rewind", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator(".timeline")).not.toContainText("Third task");
    expect(readFileSync(notes, "utf8")).toBe("edited in the third turn\n");
  });
});
