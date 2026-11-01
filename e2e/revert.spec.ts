import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, addWorkspaceFromSidebar, createProfile, primaryModifier, sendMessage, signIn, workspaceCard } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

const host = new TestHost({ fakePrograms: true });
const promptsFile = join(host.root, "prompts");
const profileName = "rewindable";
const readme = join(host.projectDir, "README.md");
const made = join(host.projectDir, "made.txt");
const accented = join(host.projectDir, "café.txt");
let headAtStart = "";

/** An opencode stand-in that is an agent of its own, taking prompts and ending its turns at once. */
function fakeOpencode() {
  writeBunProgram(host.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"), { FAKE_ACP_PROMPTS: promptsFile });
}

/** Everything the agent was given, in order; a prompt of several lines is written as it stands. */
const agentSaw = () => readFileSync(promptsFile, "utf8");

const noteAboutAddAFile =
  'The user put this workspace\'s files back to how they were before the turn that began with "Add a file"';

const git = (...args: string[]) =>
  execFileSync("git", ["-C", host.projectDir, "-c", "user.name=e2e", "-c", "user.email=e2e@localhost", ...args], { encoding: "utf8" }).trim();

// The later tests go on from the first one: the second in the conversation it leaves, the third with its profile.
test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  fakeOpencode();
  writeFileSync(promptsFile, "");
  await host.start();
  await git("init", "-q");
  await git("add", "-A");
  await git("commit", "-qm", "the project as it was");
  headAtStart = await git("rev-parse", "HEAD");
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const status = (page: Page) => page.locator(".chat-header:visible .badge");
const userMessage = (page: Page) => page.locator(".timeline:visible .message.user").last();
const undoFiles = (page: Page) => page.locator(".timeline:visible .undo-files").last();

/** The stub agent offers no model to pick, so this is `startConversation` without that wait. */
async function startConversationWithoutModel(page: Page, directory = host.projectDir) {
  const previousUrl = page.url();
  await workspaceCard(page, directory).getByRole("button", { name: "+ New conversation" }).click();
  await expect(page).not.toHaveURL(previousUrl);
  return page.url().match(/#\/c\/(.+)$/)![1]!;
}

test("a turn's files go back to how they were, the agent hears about it, and your git history is left alone", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, profileName, "", "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${profileName} · opencode` });
  await startConversationWithoutModel(page);
  await sendMessage(page, "Add a file");
  await expect(status(page)).toHaveText("idle", { timeout: 60_000 });

  await test.step("the message of a turn Mirador kept files for offers to undo them", async () => {
    await expect(undoFiles(page)).toBeHidden();
    await userMessage(page).hover();
    await expect(undoFiles(page)).toBeVisible();
    await expect(undoFiles(page)).toHaveText("Undo files");
  });

  await test.step("the dialog says what the undo would change, and putting the files back does it, unstaging what the turn staged", async () => {
    writeFileSync(readme, "changed by the turn\n");
    writeFileSync(made, "made by the turn\n");
    writeFileSync(accented, "made by the turn, with a name git would quote\n");
    await git("add", "README.md", "made.txt");
    await userMessage(page).hover();
    await undoFiles(page).click();
    const dialog = page.getByRole("dialog", { name: "Undo the files of a turn" });
    await expect(dialog).toContainText("The files go back to how they were when this turn began: 1 file put back as it was and 2 files deleted that were created since.");
    await dialog.getByRole("button", { name: "Put the files back" }).click();
    await expect(dialog).toHaveCount(0);
    expect(readFileSync(readme, "utf8")).toBe("# e2e project\n");
    expect(() => readFileSync(made, "utf8")).toThrow();
    expect(() => readFileSync(accented, "utf8")).toThrow();
  });

  await test.step("the conversation keeps the turn and notes the undo", async () => {
    await expect(page.locator(".timeline:visible")).toContainText("Files put back to how they were before the turn of “Add a file”");
    await expect(userMessage(page)).toHaveText("Add a file");
  });

  await test.step("the agent is told, ahead of the next message", async () => {
    await sendMessage(page, "Start again");
    await expect.poll(agentSaw).toContain(noteAboutAddAFile);
    expect(agentSaw().indexOf(noteAboutAddAFile)).toBeLessThan(agentSaw().lastIndexOf("Start again"));
  });

  await test.step("the palette undoes a turn by name, the same way the message does", async () => {
    writeFileSync(made, "made again\n");
    const primary = await primaryModifier(page);
    await page.keyboard.press(`${primary}+KeyK`);
    const palette = page.getByLabel("Search conversations and actions");
    await palette.fill("undo the files");
    await palette.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Undo the files of a turn" });
    await expect(dialog).toContainText("Start again");
    await dialog.getByRole("button", { name: "Put the files back" }).click();
    await expect(dialog).toHaveCount(0);
    expect(() => readFileSync(made, "utf8")).toThrow();
  });

  await test.step("a turn whose files are as they were when it began has nothing to undo: the dialog says no file changed and offers no undo", async () => {
    await userMessage(page).hover();
    await undoFiles(page).click();
    const dialog = page.getByRole("dialog", { name: "Undo the files of a turn" });
    await expect(dialog.locator(".revert-summary")).toHaveText(["No file changed since this turn began."]);
    await expect(dialog.getByRole("button", { name: "Put the files back" })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
  });

  await test.step("the user's own history is untouched, and nothing the turns changed is left staged", async () => {
    expect(await git("rev-parse", "HEAD")).toBe(headAtStart);
    expect(await git("log", "--format=%s")).toBe("the project as it was");
    expect(await git("status", "--porcelain")).toBe("");
  });
});

test("an undo leaves a submodule that moved as it is and says so, and a turn whose files Mirador no longer keeps says that", async ({ page }) => {
  const library = join(host.root, "library");
  const gitIn = (directory: string, ...args: string[]) =>
    execFileSync("git", ["-C", directory, "-c", "user.name=e2e", "-c", "user.email=e2e@localhost", "-c", "protocol.file.allow=always", ...args], { encoding: "utf8" }).trim();
  mkdirSync(library, { recursive: true });
  gitIn(library, "init", "-q");
  writeFileSync(join(library, "lib.txt"), "v1\n");
  gitIn(library, "add", "-A");
  gitIn(library, "commit", "-qm", "v1");
  gitIn(host.projectDir, "submodule", "add", "-q", library, "library");
  gitIn(host.projectDir, "commit", "-qm", "with the library");

  await signIn(page, host);
  await page.locator(".workspace li").first().click();
  await page.locator(".conversation-title").first().click();
  await sendMessage(page, "Move the library on");
  await expect(status(page)).toHaveText("idle", { timeout: 60_000 });
  writeFileSync(join(host.projectDir, "library", "lib.txt"), "v2\n");
  gitIn(join(host.projectDir, "library"), "commit", "-qam", "v2");
  writeFileSync(readme, "changed by the turn\n");

  await test.step("the dialog counts the submodule apart, and putting the files back leaves it", async () => {
    await userMessage(page).hover();
    await undoFiles(page).click();
    const dialog = page.getByRole("dialog", { name: "Undo the files of a turn" });
    await expect(dialog).toContainText("The files go back to how they were when this turn began: 1 file put back as it was. 1 submodule that changed stays as it is now");
    await dialog.getByRole("button", { name: "Put the files back" }).click();
    await expect(dialog).toHaveCount(0);
    expect(readFileSync(readme, "utf8")).toBe("# e2e project\n");
    expect(readFileSync(join(host.projectDir, "library", "lib.txt"), "utf8")).toBe("v2\n");
  });

  await test.step("once git has dropped a turn's files, its undo says Mirador no longer keeps them", async () => {
    const refs = gitIn(host.projectDir, "for-each-ref", "--format=delete %(refname)", "refs/mirador/");
    execFileSync("git", ["-C", host.projectDir, "update-ref", "--stdin"], { input: `${refs}\n` });
    gitIn(host.projectDir, "gc", "--quiet", "--prune=now");
    await userMessage(page).hover();
    await undoFiles(page).click();
    const dialog = page.getByRole("dialog", { name: "Undo the files of a turn" });
    await expect(dialog).toContainText("Mirador no longer keeps the files of that turn: it keeps those of a workspace's newest 100 turns.");
    await expect(dialog.getByRole("button", { name: "Put the files back" })).toHaveCount(0);
  });
});

test("in a workspace below the repository's top, an undo puts back that folder's files and leaves the rest of the repository as it is", async ({ page }) => {
  const app = join(host.projectDir, "app");
  const appFile = join(app, "app.txt");
  const madeInApp = join(app, "made.txt");
  const madeAtTop = join(host.projectDir, "top.txt");
  mkdirSync(app);
  writeFileSync(appFile, "the app as it was\n");
  git("add", "-A");
  git("commit", "-qm", "the app");

  await signIn(page, host);
  await addWorkspaceFromSidebar(page, app);
  await workspaceCard(page, app).getByLabel("Agent", { exact: true }).selectOption({ label: `${profileName} · opencode` });
  await startConversationWithoutModel(page, app);
  await sendMessage(page, "Change the app");
  await expect(status(page)).toHaveText("idle", { timeout: 60_000 });
  writeFileSync(appFile, "changed by the turn\n");
  writeFileSync(madeInApp, "made by the turn\n");
  writeFileSync(readme, "the user's own change\n");
  writeFileSync(madeAtTop, "made outside the app\n");

  await userMessage(page).hover();
  await undoFiles(page).click();
  const dialog = page.getByRole("dialog", { name: "Undo the files of a turn" });
  await expect(dialog).toContainText("The files go back to how they were when this turn began: 1 file put back as it was and 1 file deleted that was created since.");
  await dialog.getByRole("button", { name: "Put the files back" }).click();
  await expect(dialog).toHaveCount(0);
  expect(readFileSync(appFile, "utf8")).toBe("the app as it was\n");
  expect(() => readFileSync(madeInApp, "utf8")).toThrow();
  expect(readFileSync(readme, "utf8")).toBe("the user's own change\n");
  expect(readFileSync(madeAtTop, "utf8")).toBe("made outside the app\n");
});

test("an undo puts files back with the line endings they had, even where core.autocrlf would convert them", async ({ page }) => {
  const unix = join(host.projectDir, "unix.txt");
  const windows = join(host.projectDir, "windows.txt");
  git("config", "core.autocrlf", "true");
  writeFileSync(unix, "lf\n");
  writeFileSync(windows, "crlf\r\n");

  await signIn(page, host);
  await workspaceCard(page, host.projectDir).getByLabel("Agent", { exact: true }).selectOption({ label: `${profileName} · opencode` });
  await startConversationWithoutModel(page);
  await sendMessage(page, "Change the line endings");
  await expect(status(page)).toHaveText("idle", { timeout: 60_000 });
  writeFileSync(unix, "changed by the turn\r\n");
  writeFileSync(windows, "changed by the turn\n");

  await userMessage(page).hover();
  await undoFiles(page).click();
  const dialog = page.getByRole("dialog", { name: "Undo the files of a turn" });
  await expect(dialog).toContainText("The files go back to how they were when this turn began: 2 files put back as they were.");
  await dialog.getByRole("button", { name: "Put the files back" }).click();
  await expect(dialog).toHaveCount(0);
  expect(readFileSync(unix, "utf8")).toBe("lf\n");
  expect(readFileSync(windows, "utf8")).toBe("crlf\r\n");
  git("config", "--unset", "core.autocrlf");
});

test("an undo puts back a file's own line endings where .gitattributes has git store text with LF", async ({ page }) => {
  const attributes = join(host.projectDir, ".gitattributes");
  const windows = join(host.projectDir, "attributed.txt");
  writeFileSync(attributes, "* text=auto\n");
  writeFileSync(windows, "crlf\r\n");

  await signIn(page, host);
  await workspaceCard(page, host.projectDir).getByLabel("Agent", { exact: true }).selectOption({ label: `${profileName} · opencode` });
  await startConversationWithoutModel(page);
  await sendMessage(page, "Rewrite the attributed file");
  await expect(status(page)).toHaveText("idle", { timeout: 60_000 });
  writeFileSync(windows, "changed by the turn\n");

  await userMessage(page).hover();
  await undoFiles(page).click();
  const dialog = page.getByRole("dialog", { name: "Undo the files of a turn" });
  await expect(dialog).toContainText("The files go back to how they were when this turn began: 1 file put back as it was.");
  await dialog.getByRole("button", { name: "Put the files back" }).click();
  await expect(dialog).toHaveCount(0);
  expect(readFileSync(windows, "utf8")).toBe("crlf\r\n");
});

test("a turn can be undone where core.safecrlf=true refuses to store a file with other line endings, and the file comes back as it was", async ({ page }) => {
  const refused = join(host.projectDir, "refused.txt");
  git("config", "core.safecrlf", "true");
  writeFileSync(join(host.projectDir, ".gitattributes"), "* text=auto\n");
  writeFileSync(refused, "crlf\r\n");

  await signIn(page, host);
  await workspaceCard(page, host.projectDir).getByLabel("Agent", { exact: true }).selectOption({ label: `${profileName} · opencode` });
  await startConversationWithoutModel(page);
  await sendMessage(page, "Rewrite the refused file");
  await expect(status(page)).toHaveText("idle", { timeout: 60_000 });
  writeFileSync(refused, "changed by the turn\n");

  await userMessage(page).hover();
  await undoFiles(page).click();
  const dialog = page.getByRole("dialog", { name: "Undo the files of a turn" });
  await expect(dialog).toContainText("The files go back to how they were when this turn began: 1 file put back as it was.");
  await dialog.getByRole("button", { name: "Put the files back" }).click();
  await expect(dialog).toHaveCount(0);
  expect(readFileSync(refused, "utf8")).toBe("crlf\r\n");
  git("config", "--unset", "core.safecrlf");
});

test("an undo after a commit leaves the commit's files as committed, says so, and tells the agent", async ({ page }) => {
  const pulled = join(host.projectDir, "pulled.txt");
  const readmeAtStart = readFileSync(readme, "utf8");
  const leftAsCommitted = "1 commit came in since then, and the 1 file it changed stays as committed.";

  await signIn(page, host);
  await workspaceCard(page, host.projectDir).getByLabel("Agent", { exact: true }).selectOption({ label: `${profileName} · opencode` });
  await startConversationWithoutModel(page);
  await sendMessage(page, "Edit while a pull comes in");
  await expect(status(page)).toHaveText("idle", { timeout: 60_000 });
  writeFileSync(readme, "changed by the turn\n");
  writeFileSync(pulled, "from a pull\n");
  git("add", "pulled.txt");
  git("commit", "-qm", "a pull");

  await userMessage(page).hover();
  await undoFiles(page).click();
  const dialog = page.getByRole("dialog", { name: "Undo the files of a turn" });
  await expect(dialog).toContainText(`The files go back to how they were when this turn began: 1 file put back as it was. ${leftAsCommitted}`);
  await dialog.getByRole("button", { name: "Show the files" }).click();
  await expect(dialog.getByRole("region", { name: "Put back as they were" }).getByRole("listitem")).toHaveText(["README.md"]);
  await expect(dialog.getByRole("region", { name: "Stay as committed" }).getByRole("listitem")).toHaveText(["pulled.txt"]);
  await dialog.getByRole("button", { name: "Put the files back" }).click();
  await expect(dialog).toHaveCount(0);
  expect(readFileSync(readme, "utf8")).toBe(readmeAtStart);
  expect(readFileSync(pulled, "utf8")).toBe("from a pull\n");
  expect(git("status", "--porcelain", "--", "pulled.txt")).toBe("");

  await sendMessage(page, "Carry on after the pull");
  await expect.poll(agentSaw).toContain(leftAsCommitted);
});
