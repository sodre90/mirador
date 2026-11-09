import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, addWorkspaceFromSidebar, createProfile, lastAgentMessage, sendMessage, signIn, waitForTurnToEnd, workspaceCard } from "./helpers.ts";
import { scratchPath, TestHost, writeBunProgram } from "./test-host.ts";

const home = scratchPath("worktrees-home");
const notARepository = scratchPath("worktrees-plain");
const host = new TestHost({ fakePrograms: true, environment: { HOME: home, ...(process.platform === "win32" && { USERPROFILE: home }) } });
const appFile = join(host.projectDir, "src", "app.ts");
const secrets = "TOKEN=kept out of git\n";

const gitIn = (directory: string, ...args: string[]) => execFileSync("git", ["-C", directory, ...args], { encoding: "utf8" }).trim();
const git = (...args: string[]) => gitIn(host.projectDir, ...args);
const branches = () => git("branch", "--format=%(refname:short)").split("\n");

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  mkdirSync(home, { recursive: true });
  mkdirSync(notARepository, { recursive: true });
  writeBunProgram(host.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"), { FAKE_ACP_PROMPTS: join(host.root, "prompts") });
  mkdirSync(join(host.projectDir, "src"), { recursive: true });
  writeFileSync(appFile, "first\n");
  writeFileSync(join(host.projectDir, ".gitignore"), ".env\n");
  git("init", "-q", "--initial-branch=main");
  git("config", "user.name", "The Owner");
  git("config", "user.email", "owner@example.test");
  git("add", "-A");
  git("commit", "-qm", "base");
  writeFileSync(join(host.projectDir, ".env"), secrets);
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
  rmSync(home, { recursive: true, force: true });
  rmSync(notARepository, { recursive: true, force: true });
});

const worktreesButton = (page: Page, directory: string) => workspaceCard(page, directory).getByRole("button", { name: "Where conversations work" });
const worktreesDialog = (page: Page, workspace: string) => page.getByRole("dialog", { name: `Where conversations work in ${workspace}` });
const selectedRow = (page: Page) => page.locator(".workspace li.selected");
const deleteQuestion = (page: Page) => page.getByRole("alertdialog", { name: "Delete the conversation and its worktree?" });
const commitDialog = (page: Page) => page.getByRole("dialog", { name: "Commit changes" });

async function startNewConversation(page: Page, directory: string) {
  const previousUrl = page.url();
  await workspaceCard(page, directory).getByRole("button", { name: "+ New conversation" }).click();
  await expect(page).not.toHaveURL(previousUrl);
}

/** The folder the agent's session started in, as the fake agent says it. */
async function agentFolder(page: Page) {
  await expect(page.locator(".chat-header:visible .badge")).toHaveText("idle", { timeout: 60_000 });
  await sendMessage(page, "FOLDER");
  await waitForTurnToEnd(page);
  await expect(lastAgentMessage(page)).toContainText("Working in ");
  return (await lastAgentMessage(page).innerText()).trim().replace(/^Working in /, "");
}

async function deleteSelectedConversation(page: Page) {
  const deleteButton = selectedRow(page).getByRole("button", { name: "Delete conversation" });
  await selectedRow(page).hover();
  await deleteButton.click();
  await expect(deleteButton).toHaveText("Delete?");
  await deleteButton.click();
}

test("a workspace set to start conversations in worktrees gives each its own, set up by its command, and leaves the project folder alone", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, "worktrees", "", "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "worktrees · opencode" });

  await test.step("the workspace's new conversations start in worktrees, each set up by a command", async () => {
    await expect(worktreesButton(page, host.projectDir)).toHaveAttribute("data-place", "folder");
    await worktreesButton(page, host.projectDir).click();
    const dialog = worktreesDialog(page, "project");
    await expect(dialog.getByRole("radio", { name: /The project folder/ })).toBeChecked();
    await dialog.getByRole("radio", { name: /A worktree of their own/ }).check();
    await dialog.getByLabel("Setup command for a new worktree").fill('cp "$MIRADOR_WORKSPACE/.env" .env && echo set up here');
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(worktreesButton(page, host.projectDir)).toHaveAttribute("data-place", "worktree");
  });

  await startNewConversation(page, host.projectDir);
  const setupCard = page.locator(".timeline:visible .user-command", { hasText: "echo set up here" });
  await expect(setupCard).toContainText("Not sent to the agent", { timeout: 60_000 });

  const folder = await agentFolder(page);
  const worktreesFolder = join(realpathSync(host.dataDir), "worktrees");
  expect(folder.startsWith(`${worktreesFolder}/project-`), `${folder} is in ${worktreesFolder}`).toBe(true);
  expect(readFileSync(join(folder, ".env"), "utf8"), "the setup command copied what git ignores").toBe(secrets);
  const branch = gitIn(folder, "branch", "--show-current");
  expect(branch).toMatch(/^mirador\/[0-9a-f]{8}$/);
  await expect(selectedRow(page).locator(".worktree-mark")).toHaveAttribute("aria-label", `Works in a worktree of its own, on the branch ${branch}`);

  await test.step("the agent's edits and the commit from Changes go to the worktree's branch, not the project folder", async () => {
    await sendMessage(page, `WRITE ${JSON.stringify([{ edit: join(folder, "src", "app.ts"), content: "changed in the worktree\n" }])}`);
    await waitForTurnToEnd(page);
    expect(readFileSync(appFile, "utf8")).toBe("first\n");
    expect(git("status", "--porcelain")).toBe("");

    await page.locator(".canvas-panel:visible .changes").getByRole("button", { name: "Commit…" }).click();
    await expect(commitDialog(page)).toContainText(`The commit goes on ${branch}, as you.`);
    await expect(commitDialog(page).getByRole("list", { name: "This conversation's changes" }).locator(".changed-path")).toHaveText(["src/app.ts"]);
    await commitDialog(page).getByLabel("Message").fill("Change the first line in the worktree");
    await commitDialog(page).getByRole("button", { name: "Commit 1 file" }).click();
    await expect(commitDialog(page)).toHaveCount(0);
    expect(git("log", "-1", "--format=%s", branch)).toBe("Change the first line in the worktree");
    expect(git("log", "-1", "--format=%s", "main")).toBe("base");
    expect(git("branch", "--show-current")).toBe("main");
  });

  await test.step("commands run in the worktree too", async () => {
    const composer = page.locator(".composer:visible textarea");
    await composer.fill("!pwd");
    await composer.press("Enter");
    await expect(page.locator(".timeline:visible .user-command", { hasText: "pwd" }).last()).toContainText(folder.slice(folder.indexOf("/worktrees/")));
  });

  await test.step("deleting the conversation asks first while its worktree holds uncommitted files, and keeps the branch with its commit", async () => {
    writeFileSync(join(folder, "scratch.txt"), "not committed\n");
    const root = gitIn(folder, "rev-parse", "--show-toplevel");
    await deleteSelectedConversation(page);
    await expect(deleteQuestion(page)).toContainText("Its worktree holds 1 uncommitted file, which is deleted with it.");
    await expect(deleteQuestion(page)).toContainText(`Commits made there stay, on the branch ${branch}.`);
    await deleteQuestion(page).getByRole("button", { name: "Cancel" }).click();
    await expect(deleteQuestion(page)).toHaveCount(0);
    await expect(selectedRow(page)).toHaveCount(1);
    expect(existsSync(join(folder, "scratch.txt"))).toBe(true);

    await deleteSelectedConversation(page);
    await deleteQuestion(page).getByRole("button", { name: "Delete both" }).click();
    await expect(page.locator(".workspace li", { hasText: "FOLDER" })).toHaveCount(0);
    await expect.poll(() => existsSync(root)).toBe(false);
    expect(branches()).toEqual(["main", branch]);
  });
});

test("one conversation starts in the other place, a clean worktree goes without asking, and a folder without a repository gets no worktrees", async ({ page }) => {
  await signIn(page, host);

  await test.step("the dialog starts one conversation in the project folder, which keeps starting them in worktrees", async () => {
    await worktreesButton(page, host.projectDir).click();
    await worktreesDialog(page, "project").getByRole("button", { name: "Start one in the project folder now" }).click();
    expect(await agentFolder(page)).toBe(realpathSync(host.projectDir));
    await expect(selectedRow(page).locator(".worktree-mark")).toHaveCount(0);
    await expect(worktreesButton(page, host.projectDir)).toHaveAttribute("data-place", "worktree");
  });

  await test.step("a worktree with nothing uncommitted goes with its conversation, branch and all", async () => {
    await startNewConversation(page, host.projectDir);
    const folder = await agentFolder(page);
    const branch = gitIn(folder, "branch", "--show-current");
    expect(branches()).toContain(branch);
    await deleteSelectedConversation(page);
    await expect(deleteQuestion(page)).toHaveCount(0);
    await expect.poll(() => existsSync(folder)).toBe(false);
    await expect.poll(branches).not.toContain(branch);
  });

  await test.step("a folder that is no git repository refuses worktrees, and starts none", async () => {
    await addWorkspaceFromSidebar(page, notARepository);
    const refusal = page.locator(".notices .notice", { hasText: "gets its own worktree only in a git repository with a commit" });
    await worktreesButton(page, notARepository).click();
    const dialog = page.getByRole("dialog", { name: /^Where conversations work in mirador-e2e-worktrees-plain/ });
    await dialog.getByRole("radio", { name: /A worktree of their own/ }).check();
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(refusal).toBeVisible();
    await expect(worktreesButton(page, notARepository)).toHaveAttribute("data-place", "folder");
    await refusal.click();

    await worktreesButton(page, notARepository).click();
    await dialog.getByRole("button", { name: "Start one in a worktree now" }).click();
    await expect(refusal).toBeVisible();
    await expect(workspaceCard(page, notARepository).locator("li")).toHaveCount(0);
  });
});
