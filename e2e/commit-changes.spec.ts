import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, createProfile, sendMessage, signIn, waitForTurnToEnd } from "./helpers.ts";
import { scratchPath, TestHost, writeBunProgram } from "./test-host.ts";

const home = scratchPath("commit-changes-home");
const host = new TestHost({ fakePrograms: true, environment: { HOME: home, ...(process.platform === "win32" && { USERPROFILE: home }) } });
const appFile = join(host.projectDir, "src", "app.ts");
const generatedFile = join(host.projectDir, "src", "generated.txt");

const git = (...args: string[]) => execFileSync("git", ["-C", host.projectDir, ...args], { encoding: "utf8" }).trim();

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  mkdirSync(home, { recursive: true });
  writeBunProgram(host.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"), { FAKE_ACP_PROMPTS: join(host.root, "prompts") });
  mkdirSync(join(host.projectDir, "src"), { recursive: true });
  writeFileSync(appFile, "first\n");
  git("init", "-q");
  git("config", "user.name", "The Owner");
  git("config", "user.email", "owner@example.test");
  git("add", "-A");
  git("commit", "-qm", "base");
  writeFileSync(join(host.projectDir, "notes.txt"), "written by hand before the conversation\n");
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
  rmSync(home, { recursive: true, force: true });
});

const changes = (page: Page) => page.locator(".canvas-panel:visible .changes");
const dialog = (page: Page) => page.getByRole("dialog", { name: "Commit changes" });
const fileChoice = (page: Page, path: string) => dialog(page).locator(`.commit-file[data-path=${JSON.stringify(path)}]`).getByRole("checkbox");
const pathsIn = (page: Page, list: string) => dialog(page).getByRole("list", { name: list }).locator(".changed-path");

let conversationUrl: string;

test("Commit in Changes takes the ticked files of the conversation's work with the message typed, as the user, and leaves the rest uncommitted", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, "commits", "", "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "commits · opencode" });
  const previousUrl = page.url();
  await page.getByRole("button", { name: "+ New conversation" }).click();
  await expect(page).not.toHaveURL(previousUrl);
  conversationUrl = page.url();

  await sendMessage(page, `WRITE ${JSON.stringify([{ edit: appFile, content: "first, fixed\n" }, { shell: generatedFile, content: "made by a script\n" }])}`);
  await waitForTurnToEnd(page);

  const open = changes(page).getByRole("button", { name: "Commit…" });
  await expect(open).toHaveAttribute("data-hint", /what you staged yourself stays as it is/);
  await open.click();
  await expect(dialog(page)).toContainText(`The commit goes on ${git("branch", "--show-current")}, as you.`);
  await expect(pathsIn(page, "This conversation's changes")).toHaveText(["src/app.ts", "src/generated.txt"]);
  await expect(fileChoice(page, "src/app.ts")).toBeChecked();
  await expect(fileChoice(page, "src/generated.txt")).toBeChecked();

  await test.step("the folder's other uncommitted changes are offered apart, unticked", async () => {
    await dialog(page).getByText("Other uncommitted changes (1)").click();
    await expect(fileChoice(page, "notes.txt")).not.toBeChecked();
  });

  await test.step("a commit needs a message and a file", async () => {
    await expect(dialog(page).getByRole("button", { name: "Commit 2 files" })).toBeDisabled();
    await fileChoice(page, "src/generated.txt").uncheck();
    await dialog(page).getByLabel("Message").fill("Fix the first line");
    await expect(dialog(page).getByRole("button", { name: "Commit 1 file" })).toBeEnabled();
  });

  await dialog(page).getByRole("button", { name: "Commit 1 file" }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(changes(page).getByRole("status")).toHaveText(`Committed 1 file as ${git("rev-parse", "--short", "HEAD")}: Fix the first line`);
  expect(git("log", "-1", "--format=%an <%ae>: %s")).toBe("The Owner <owner@example.test>: Fix the first line");
  expect(git("show", "--format=", "--name-only", "HEAD")).toBe("src/app.ts");
  expect(git("status", "--porcelain")).toBe("?? notes.txt\n?? src/generated.txt");
});

test("a commit git refuses says why in the dialog, which stays open with the message, and Esc closes it", async ({ page }) => {
  const hook = join(host.projectDir, ".git", "hooks", "pre-commit");
  writeFileSync(hook, "#!/bin/sh\necho the hook says no >&2\nexit 1\n");
  chmodSync(hook, 0o755);
  await signIn(page, host);
  await page.goto(conversationUrl);
  await changes(page).getByRole("button", { name: "Commit…" }).click();
  await expect(pathsIn(page, "This conversation's changes"), "the committed file is no longer offered").toHaveText(["src/generated.txt"]);
  await dialog(page).getByLabel("Message").fill("Add the generated file");
  await dialog(page).getByLabel("Message").press("ControlOrMeta+Enter");
  await expect(dialog(page).getByRole("alert")).toContainText("the hook says no");
  await expect(dialog(page).getByLabel("Message")).toHaveValue("Add the generated file");
  expect(git("status", "--porcelain"), "the file is untracked again").toBe("?? notes.txt\n?? src/generated.txt");
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
});
