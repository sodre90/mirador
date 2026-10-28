import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, callCanvasTool, createProfile, literally, sendMessage, signIn, waitForTurnToEnd } from "./helpers.ts";
import { scratchPath, TestHost, writeBunProgram } from "./test-host.ts";

const home = scratchPath("changes-home");
const host = new TestHost({ fakePrograms: true, environment: { HOME: home, ...(process.platform === "win32" && { USERPROFILE: home }) } });
const appFile = join(host.projectDir, "src", "app.ts");
const generatedFile = join(host.projectDir, "src", "generated.txt");
const outsideFile = join(home, "elsewhere", "notes.md");
const outsideFileShown = join("~", "elsewhere", "notes.md");
const editNow = join(host.root, "edit-now");
const finishNow = join(host.root, "finish-now");
const numbered = (count: number) => Array.from({ length: count }, (_, index) => `line ${index + 1}`).join("\n") + "\n";
/** Past the second the host adds to each side of the agent's commands (COMMAND_WINDOW_SLACK_MS), whose module Playwright cannot load. */
const pastTheAgentsCommandsMs = 1_500;
const withLine15 = (text: string) => numbered(30).replace("line 15\n", `${text}\n`);

/** An opencode that is the scripted agent, writing the files a prompt names. */
function fakeOpencode() {
  writeBunProgram(host.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"), { FAKE_ACP_PROMPTS: join(host.root, "prompts") });
}

const git = (...args: string[]) => execFileSync("git", ["-C", host.projectDir, "-c", "user.name=t", "-c", "user.email=t@t", ...args]);

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  mkdirSync(home, { recursive: true });
  fakeOpencode();
  mkdirSync(join(host.projectDir, "src"), { recursive: true });
  writeFileSync(appFile, numbered(30));
  writeFileSync(join(host.projectDir, "src", "stable.ts"), "stays as it is\n");
  mkdirSync(join(host.projectDir, "lib"));
  writeFileSync(join(host.projectDir, "lib", "kept.ts"), "never changed\n");
  git("init", "-q");
  git("add", "-A");
  git("commit", "-qm", "base");
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
  rmSync(home, { recursive: true, force: true });
});

const changes = (page: Page) => page.locator(".canvas-panel:visible .changes");
const fileRow = (page: Page, path: string) => changes(page).locator(`.changed-file[data-path=${JSON.stringify(path)}]`);
const folderRow = (page: Page, name: string) => changes(page).locator(".changed-folder").filter({ has: page.locator(".folder-name", { hasText: new RegExp(`^${literally(name)}$`) }) });
const section = (page: Page, name: string) => changes(page).getByRole("region", { name, exact: true });
/** The files a section lists, in either view: the tree orders them by folder, so the order is not compared. */
const expectListed = (page: Page, sectionName: string, paths: string[], message?: string) =>
  expect
    .poll(() => section(page, sectionName).locator(".changed-file:not(.status-unchanged)").evaluateAll((rows) => rows.map((row) => (row as HTMLElement).dataset.path!).toSorted()), message)
    .toEqual(paths.toSorted());
const writeFiles = (page: Page, steps: Record<string, string>[]) => sendMessage(page, `WRITE ${JSON.stringify(steps)}`);

async function startConversation(page: Page) {
  const previousUrl = page.url();
  await page.getByRole("button", { name: "+ New conversation" }).click();
  await expect(page).not.toHaveURL(previousUrl);
  return page.url().match(/#\/c\/(.+)$/)![1]!;
}

let conversationId: string;

test("the empty canvas lists the files this turn changed as the agent works, its own edits apart from the project's other changes and files outside the project apart, under home as ~/", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, "changes", "", "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "changes · opencode" });
  conversationId = await startConversation(page);
  await expect(changes(page)).toContainText("Files the agent changes in this conversation show here.");
  await expect(changes(page).getByRole("button", { name: "This turn" })).toHaveAttribute("aria-pressed", "true");

  await writeFiles(page, [
    { waitFor: editNow },
    { edit: appFile, content: withLine15("line fifteen") },
    { waitFor: finishNow },
    { shell: generatedFile, content: "made by a script\n" },
    { edit: outsideFile, content: "outside the project\n" },
  ]);

  await test.step("a finished edit shows while the turn still runs", async () => {
    await expect(changes(page)).toContainText("No file changed in this turn.");
    writeFileSync(editNow, "");
    await expect(fileRow(page, "src/app.ts")).toContainText("+1 −1");
    await expect(fileRow(page, "src/app.ts").locator(".by-agent")).toHaveAttribute("aria-label", "Changed by the agent");
    await expect(page.locator(".chat-header:visible .badge")).not.toHaveText("idle");
  });

  writeFileSync(finishNow, "");
  await waitForTurnToEnd(page);

  await expectListed(page, "Project", ["src/app.ts", "src/generated.txt"]);
  await test.step("Tree lists the agent's edits apart from the project's other changes", async () => {
    await changes(page).getByRole("button", { name: "Tree" }).click();
    await expectListed(page, "Edited by the agent", ["src/app.ts"]);
    await expectListed(page, "Changed some other way", ["src/generated.txt"], "a file the agent's command wrote is not one of its edits");
    await expect(changes(page).locator("h3", { hasText: "Changed some other way" })).toHaveAttribute("data-hint", /commands the agent ran/);
    await expect(section(page, "Project"), "the turn's project files are only in the two sections").toHaveCount(0);
    await changes(page).getByRole("button", { name: "All files" }).click();
  });
  await expect(fileRow(page, "src/generated.txt").locator(".change-status")).toHaveText("A");
  await expect(fileRow(page, "src/generated.txt").locator(".by-agent")).toHaveCount(0);
  await expectListed(page, "Outside the project", [outsideFileShown]);
  await expect(fileRow(page, outsideFileShown).locator(".by-agent")).toHaveAttribute("aria-label", "Changed by the agent");
  await expect(fileRow(page, outsideFileShown).locator(".change-status"), "the agent's edit made it").toHaveText("A");
});

test("clicking a file opens its line changes under its row, with the file's line numbers, unified or split, and Open in IDEA", async ({ page }) => {
  await signIn(page, host);
  await page.goto(`${host.origin}/#/c/${conversationId}`);
  await fileRow(page, "src/app.ts").click();

  const diff = changes(page).locator(".changes-diff");
  const appItem = fileRow(page, "src/app.ts").locator("xpath=..");
  await expect(appItem.locator(".changes-diff")).toBeVisible();
  const [diffBox, nextRowBox] = await Promise.all([diff.boundingBox(), fileRow(page, "src/generated.txt").boundingBox()]);
  expect(diffBox!.y + diffBox!.height, "the next file's row comes after the open file's line changes").toBeLessThanOrEqual(nextRowBox!.y);
  await expect(diff.locator(".edited-file h3")).toHaveText("src/app.ts");
  await expect(diff.locator(".code-row.removed .line-number")).toHaveText("15");
  await expect(diff.locator(".code-row.added .line-number")).toHaveText("15");
  await expect(diff.locator(".code-row.added")).toContainText("line fifteen");
  await expect(diff.getByRole("button", { name: "Open in IDEA" })).toBeVisible();

  await diff.getByRole("button", { name: "Split" }).click();
  await expect(diff.locator(".split-side.removed .line-number")).toHaveText("15");
  await diff.getByRole("button", { name: "Unified" }).click();

  await test.step("a file outside the project shows the agent's own edit", async () => {
    await fileRow(page, outsideFileShown).click();
    await expect(diff.locator(".edited-file h3")).toHaveText(outsideFileShown);
    await expect(diff).toContainText("The agent's own edits to this file");
    await expect(diff.locator(".code-row.added")).toContainText("outside the project");
  });

  await test.step("clicking the selected file again closes its line changes", async () => {
    await fileRow(page, outsideFileShown).click();
    await expect(diff).toHaveCount(0);
  });

  await test.step("a file outside the project deleted by other means than the agent's edits shows as deleted", async () => {
    rmSync(outsideFile);
    await changes(page).getByRole("button", { name: "Refresh" }).click();
    await expect(fileRow(page, outsideFileShown).locator(".change-status")).toHaveText("D");
    writeFileSync(outsideFile, "outside the project\n");
    await changes(page).getByRole("button", { name: "Refresh" }).click();
    await expect(fileRow(page, outsideFileShown).locator(".change-status")).toHaveText("A");
  });
});

test("a link to a file outside the project shows as a link, with its target's path in its line changes and never the file's contents", async ({ page }) => {
  const outside = join(host.root, "outside.txt");
  writeFileSync(outside, "secret\n");
  await signIn(page, host);
  await page.goto(`${host.origin}/#/c/${conversationId}`);
  symlinkSync(outside, join(host.projectDir, "notes.md"));

  await changes(page).getByRole("button", { name: "Refresh" }).click();
  await expect(fileRow(page, "notes.md")).toBeVisible();
  await fileRow(page, "notes.md").click();
  await expect(changes(page).locator(".changes-diff")).toContainText(outside);
  await expect(page.locator("body")).not.toContainText("secret");

  rmSync(join(host.projectDir, "notes.md"));
  await changes(page).getByRole("button", { name: "Refresh" }).click();
  await expect(fileRow(page, "src/app.ts")).toBeVisible();
});

test("a new turn starts with an empty list, while Uncommitted keeps git status against HEAD", async ({ page }) => {
  await signIn(page, host);
  await page.goto(`${host.origin}/#/c/${conversationId}`);
  await expect(fileRow(page, "src/app.ts")).toBeVisible();
  await sendMessage(page, "nothing to change");
  await waitForTurnToEnd(page);
  await expect(changes(page)).toContainText("No file changed in this turn.");

  await changes(page).getByRole("button", { name: "Uncommitted" }).click();
  await expectListed(page, "Project", ["src/app.ts", "src/generated.txt"]);
  await expect(fileRow(page, "src/app.ts").locator(".by-agent")).toHaveAttribute("aria-label", "Changed by the agent");
  await expectListed(page, "Outside the project", [outsideFileShown]);

  await test.step("a change made by hand shows after Refresh", async () => {
    writeFileSync(join(host.projectDir, "by-hand.txt"), "typed\n");
    await changes(page).getByRole("button", { name: "Refresh" }).click();
    await expect(fileRow(page, "by-hand.txt")).toBeVisible();
    await expect(fileRow(page, "by-hand.txt").locator(".by-agent")).toHaveCount(0);
  });

  await test.step("the scope stays chosen after a reload", async () => {
    await page.reload();
    await expect(changes(page).getByRole("button", { name: "Uncommitted" })).toHaveAttribute("aria-pressed", "true");
    await changes(page).getByRole("button", { name: "This turn" }).click();
  });
});

test("All files shows every file of the project in its folders, the changed ones marked, and only the folders holding a change open", async ({ page }) => {
  await signIn(page, host);
  await page.goto(`${host.origin}/#/c/${conversationId}`);
  await changes(page).getByRole("button", { name: "Uncommitted" }).click();
  await expect(changes(page).getByRole("button", { name: "All files" })).toHaveAttribute("aria-pressed", "true");

  const lib = folderRow(page, "lib");
  await expect(lib).toHaveAttribute("aria-expanded", "false");
  await expect(lib.locator(".folder-file-count")).toHaveCount(0);
  await expect(folderRow(page, "src")).toHaveAttribute("aria-expanded", "true");
  await expect(fileRow(page, "src/app.ts").locator(".change-status")).toHaveText("M");
  await expect(fileRow(page, "src/stable.ts")).toHaveClass(/status-unchanged/);
  await expect(fileRow(page, "src/stable.ts").locator(".change-status")).toHaveText("");

  await test.step("a folder shows an open or closed folder icon, and an open folder's files hang from a guide line", async () => {
    await expect(folderRow(page, "src").locator(".folder-icon path")).toHaveCount(2);
    await expect(lib.locator(".folder-icon path")).toHaveCount(1);
    const guide = await folderRow(page, "src")
      .locator("xpath=..")
      .locator("> .folder-children")
      .evaluate((list) => getComputedStyle(list, "::before").borderLeftStyle);
    expect(guide).toBe("solid");
  });

  await test.step("an open file's changes start under its row, beside the guide lines of the folders around it", async () => {
    await fileRow(page, "src/app.ts").click();
    const diff = fileRow(page, "src/app.ts").locator("xpath=..").locator(".changes-diff");
    const diffLeft = (await diff.boundingBox())!.x;
    const statusLeft = (await fileRow(page, "src/app.ts").locator(".change-status").boundingBox())!.x;
    expect(Math.abs(diffLeft - statusLeft)).toBeLessThanOrEqual(1);
    expect(await diff.evaluate((element) => getComputedStyle(element).borderLeftWidth)).toBe("0px");
    await fileRow(page, "src/app.ts").click();
  });

  await test.step("folding a folder with a change says how many changed", async () => {
    await folderRow(page, "src").click();
    await expect(folderRow(page, "src").locator(".folder-file-count")).toHaveText("2 changed");
    await folderRow(page, "src").click();
  });

  await test.step("an unchanged file opens under its row with Open in IDEA", async () => {
    await lib.click();
    await fileRow(page, "lib/kept.ts").click();
    const opened = fileRow(page, "lib/kept.ts").locator("xpath=..").locator(".changes-diff");
    await expect(opened).toContainText("No changes in this file.");
    await expect(opened.getByRole("button", { name: "Open in IDEA" })).toBeVisible();
    await fileRow(page, "lib/kept.ts").click();
  });

  await test.step("Tree leaves the unchanged files out", async () => {
    await changes(page).getByRole("button", { name: "Tree" }).click();
    await expect(folderRow(page, "lib")).toHaveCount(0);
    await expect(fileRow(page, "src/stable.ts")).toHaveCount(0);
    await expect(fileRow(page, "src/app.ts")).toBeVisible();
    await changes(page).getByRole("button", { name: "All files" }).click();
    await changes(page).getByRole("button", { name: "This turn" }).click();
  });
});

test("the tree shows the changed files in their folders, a folder holding one folder on one row, folds a folder with its counts, and List shows whole paths again", async ({ page }) => {
  const nested = join(host.projectDir, "pkg", "core");
  mkdirSync(nested, { recursive: true });
  writeFileSync(join(nested, "util.ts"), "one\ntwo\n");
  writeFileSync(join(nested, "types.ts"), "three\n");
  await signIn(page, host);
  await page.goto(`${host.origin}/#/c/${conversationId}`);
  await changes(page).getByRole("button", { name: "Uncommitted" }).click();
  await changes(page).getByRole("button", { name: "Tree" }).click();

  const pkgCore = folderRow(page, "pkg/core");
  await expect(pkgCore).toHaveAttribute("aria-expanded", "true");
  await expect(folderRow(page, "pkg")).toHaveCount(0);
  await expect(fileRow(page, "pkg/core/util.ts").locator(".changed-path")).toHaveText("util.ts");
  await expect(fileRow(page, "pkg/core/types.ts").locator(".changed-path")).toHaveText("types.ts");
  await expect(fileRow(page, "src/app.ts").locator(".changed-path")).toHaveText("app.ts");
  await expect(folderRow(page, join("~", "elsewhere"))).toBeVisible();

  await test.step("folding a folder hides its files and shows how many it holds, with their line counts", async () => {
    await pkgCore.click();
    await expect(pkgCore).toHaveAttribute("aria-expanded", "false");
    await expect(fileRow(page, "pkg/core/util.ts")).toHaveCount(0);
    await expect(pkgCore.locator(".folder-file-count")).toHaveText("2 files");
    await expect(pkgCore.locator(".edit-counts")).toHaveText("+3 −0");
    await pkgCore.click();
  });

  await test.step("a file in a folder opens its line changes under its row", async () => {
    await fileRow(page, "pkg/core/util.ts").click();
    await expect(fileRow(page, "pkg/core/util.ts").locator("xpath=..").locator(".changes-diff .edited-file h3")).toHaveText("pkg/core/util.ts");
  });

  await test.step("Fold all folds every folder, and a folder opens again on its own", async () => {
    await changes(page).getByRole("button", { name: "Fold all" }).click();
    await expect(pkgCore).toHaveAttribute("aria-expanded", "false");
    await expect(folderRow(page, "src")).toHaveAttribute("aria-expanded", "false");
    await expect(folderRow(page, join("~", "elsewhere"))).toHaveAttribute("aria-expanded", "false");
    await folderRow(page, "src").click();
    await expect(folderRow(page, "src")).toHaveAttribute("aria-expanded", "true");
    await expect(pkgCore).toHaveAttribute("aria-expanded", "false");
  });

  await test.step("List shows every file with its whole path, and stays chosen after a reload", async () => {
    await changes(page).getByRole("button", { name: "List" }).click();
    await expect(changes(page).getByRole("button", { name: "Fold all" })).toHaveCount(0);
    await expect(changes(page).locator(".changed-folder")).toHaveCount(0);
    await expect(fileRow(page, "pkg/core/util.ts").locator(".changed-path")).toHaveText("pkg/core/util.ts");
    await expect(fileRow(page, outsideFileShown).locator(".changed-path")).toHaveText(outsideFileShown);
    await page.reload();
    await expect(changes(page).getByRole("button", { name: "List" })).toHaveAttribute("aria-pressed", "true");
    await changes(page).getByRole("button", { name: "Tree" }).click();
    await changes(page).getByRole("button", { name: "This turn" }).click();
  });
  rmSync(join(host.projectDir, "pkg"), { recursive: true });
});

test("Changes opens over a page, and a new page takes the canvas back", async ({ page }) => {
  await signIn(page, host);
  await page.goto(`${host.origin}/#/c/${conversationId}`);
  const canvas = page.locator(".canvas-panel:visible");
  const changesButton = canvas.locator(".canvas-header").getByRole("button", { name: "Changes", exact: true });
  await expect(changesButton).toBeDisabled();

  await callCanvasTool(host, conversationId, "show", { title: "First page", html: "<p>first</p>" });
  await expect(canvas.locator(".canvas-title")).toHaveText("First page");
  await expect(changes(page)).toHaveCount(0);

  await changesButton.click();
  await expect(canvas.locator(".canvas-title")).toHaveText("Changes");
  await expectListed(page, "Project", ["by-hand.txt"]);
  await expect(canvas.locator("iframe")).toHaveCount(0);

  await changesButton.click();
  await expect(canvas.locator(".canvas-title")).toHaveText("First page");

  await changesButton.click();
  await callCanvasTool(host, conversationId, "show", { title: "Second page", html: "<p>second</p>" });
  await expect(canvas.locator(".canvas-title")).toHaveText("Second page");
  await expect(changes(page)).toHaveCount(0);

  await test.step("an edit the agent waits to make takes the canvas from Changes too", async () => {
    await changesButton.click();
    await expect(changes(page)).toBeVisible();
    await sendMessage(page, `EDIT ${JSON.stringify([{ title: "Edit src/app.ts", path: appFile, oldText: "line 16\n", newText: "line sixteen\n" }])}`);
    await expect(canvas.locator(".canvas-title")).toHaveText("Edit src/app.ts");
    await expect(changes(page)).toHaveCount(0);
    await canvas.locator(".edit-approval").getByRole("button", { name: "Reject" }).click();
    await waitForTurnToEnd(page);
  });
});

test("a conversation's canvas comes back as it was left: Changes still open, or the page still shown", async ({ page }) => {
  await signIn(page, host);
  await page.goto(`${host.origin}/#/c/${conversationId}`);
  const canvas = page.locator(".canvas-panel:visible");
  const changesButton = canvas.locator(".canvas-header").getByRole("button", { name: "Changes", exact: true });
  await callCanvasTool(host, conversationId, "show", { title: "Third page", html: "<p>third</p>" });
  await expect(canvas.locator(".canvas-title")).toHaveText("Third page");

  await changesButton.click();
  await expect(canvas.locator(".canvas-title")).toHaveText("Changes");
  const otherId = await startConversation(page);
  await page.goto(`${host.origin}/#/c/${conversationId}`);
  await expect(canvas.locator(".canvas-title")).toHaveText("Changes");

  await changesButton.click();
  await expect(canvas.locator(".canvas-title")).toHaveText("Third page");
  await page.goto(`${host.origin}/#/c/${otherId}`);
  await page.goto(`${host.origin}/#/c/${conversationId}`);
  await expect(canvas.locator(".canvas-title")).toHaveText("Third page");

  await callCanvasTool(host, conversationId, "show", { title: "Fourth page", html: "<p>fourth</p>" });
  await expect(canvas.locator(".canvas-title")).toHaveText("Fourth page");
});

test("Changes shows the files it listed last as soon as it opens again, and still updates them when they change", async ({ page }) => {
  let heldLists: string[] | null = null;
  let sendHeldLists = () => {};
  await page.routeWebSocket(/\/ws\?/, (socket) => {
    const host = socket.connectToServer();
    socket.onMessage((message) => {
      if (heldLists && /"type":"changes\.(list|diff)"/.test(String(message))) heldLists.push(String(message));
      else host.send(message);
    });
    sendHeldLists = () => {
      heldLists?.forEach((message) => host.send(message));
      heldLists = null;
    };
  });
  await signIn(page, host);
  await page.goto(`${host.origin}/#/c/${conversationId}`);
  const canvas = page.locator(".canvas-panel:visible");
  const changesButton = canvas.locator(".canvas-header").getByRole("button", { name: "Changes", exact: true });
  await changesButton.click();
  await changes(page).getByRole("button", { name: "Uncommitted" }).click();
  await expectListed(page, "Project", ["by-hand.txt", "src/app.ts", "src/generated.txt"]);
  await fileRow(page, "src/app.ts").click();
  await expect(changes(page).locator(".changes-diff .code-row.added")).toContainText("line fifteen");

  await changesButton.click();
  await expect(changes(page)).toHaveCount(0);
  heldLists = [];
  await changesButton.click();
  await expect.poll(() => heldLists?.length, "the list and the open file's changes are asked for again").toBe(2);
  await expectListed(page, "Project", ["by-hand.txt", "src/app.ts", "src/generated.txt"], "the list from before, while the host has not answered");
  await expect(changes(page).locator(".changes-diff .code-row.added"), "with the file that was open still open").toContainText("line fifteen");
  await expect(changes(page)).not.toContainText("Loading…");

  writeFileSync(join(host.projectDir, "later.txt"), "later\n");
  sendHeldLists();
  await changes(page).getByRole("button", { name: "Refresh" }).click();
  await expectListed(page, "Project", ["by-hand.txt", "later.txt", "src/app.ts", "src/generated.txt"]);

  await test.step("when the host comes back after a restart, an empty canvas lists the files again", async () => {
    await startConversation(page);
    await expect(fileRow(page, "later.txt")).toBeVisible();
    writeFileSync(join(host.projectDir, "while-away.txt"), "away\n");
    await host.restart();
    await expect(fileRow(page, "while-away.txt")).toBeVisible({ timeout: 60_000 });
  });
  await changes(page).getByRole("button", { name: "This turn" }).click();
});

test("Changes closed and opened again while its list is on the way shows the list once it comes", async ({ page }) => {
  const heldLists: string[] = [];
  let listsAnswered = 0;
  let sendToHost = (_message: string) => {};
  await page.routeWebSocket(/\/ws\?/, (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      if (/"type":"changes\.list"/.test(String(message))) heldLists.push(String(message));
      else server.send(message);
    });
    server.onMessage((message) => {
      if (/"type":"changes\.listed"/.test(String(message))) listsAnswered++;
      socket.send(message);
    });
    sendToHost = (message) => server.send(message);
  });
  await signIn(page, host);
  await page.goto(`${host.origin}/#/c/${conversationId}`);
  const canvas = page.locator(".canvas-panel:visible");
  const changesButton = canvas.locator(".canvas-header").getByRole("button", { name: "Changes", exact: true });
  await callCanvasTool(host, conversationId, "show", { title: "Fifth page", html: "<p>fifth</p>" });
  await expect(canvas.locator(".canvas-title")).toHaveText("Fifth page");

  await changesButton.click();
  await expect(changes(page)).toContainText("Loading…");
  await changesButton.click();
  await expect(canvas.locator(".canvas-title")).toHaveText("Fifth page");
  await changesButton.click();
  await expect(changes(page)).toContainText("Loading…");

  for (const [index, message] of heldLists.entries()) {
    sendToHost(message);
    await expect.poll(() => listsAnswered, "the lists are answered in the order they were asked for").toBe(index + 1);
  }
  await expectListed(page, "Project", ["later.txt", "while-away.txt"]);
});

test("This session lists the agent's edits and the files its commands wrote, tracked or git-ignored, and none written before the conversation or by hand", async ({ page }) => {
  const builtBefore = join(host.projectDir, "build", "old.js");
  const builtInSession = join(host.projectDir, "build", "new.js");
  writeFileSync(join(host.projectDir, ".gitignore"), "build/\n");
  git("add", ".gitignore");
  execFileSync("git", ["-C", host.projectDir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "ignore build output"], {
    env: { ...process.env, GIT_COMMITTER_DATE: "2020-01-01T00:00:00Z" },
  });
  mkdirSync(dirname(builtBefore), { recursive: true });
  writeFileSync(builtBefore, "built before the conversation\n");

  await signIn(page, host);
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "changes · opencode" });
  await startConversation(page);
  await changes(page).getByRole("button", { name: "This session" }).click();
  await expect(changes(page)).toContainText("The agent has not changed a file in this conversation.");
  await expect(changes(page)).toContainText("and the files written while its commands ran");

  await writeFiles(page, [
    { edit: appFile, content: withLine15("changed in this session") },
    { shell: builtInSession, content: "built by a script in this session\n" },
    { shell: generatedFile, content: "generated by a script in this session\n" },
  ]);
  await waitForTurnToEnd(page);
  await new Promise((resolve) => setTimeout(resolve, pastTheAgentsCommandsMs));
  writeFileSync(join(host.projectDir, "build", "by-hand.js"), "built by hand after the agent's commands\n");
  writeFileSync(join(host.projectDir, "by-hand-in-session.txt"), "typed after the agent's commands\n");
  await changes(page).getByRole("button", { name: "Refresh" }).click();
  await expectListed(page, "Project", ["build/new.js", "src/app.ts", "src/generated.txt"]);
  await expect(fileRow(page, "src/app.ts").locator(".by-agent")).toHaveAttribute("aria-label", "Changed by the agent");
  await expect(fileRow(page, "build/new.js").locator(".by-agent")).toHaveCount(0);

  await fileRow(page, "src/generated.txt").click();
  await expect(changes(page).locator(".changes-diff .code-row.added"), "a tracked file a command changed is compared with HEAD").toContainText("generated by a script in this session");
});

test("This session lists the git-ignored files the agent's commands wrote, and says git ignores one it cannot compare", async ({ page }) => {
  const cacheFile = join(host.projectDir, "build", "cache.txt");
  writeFileSync(cacheFile, "from before the conversation\n");
  await signIn(page, host);
  await page.goto(`${host.origin}/#/c/${conversationId}`);
  await startConversation(page);
  await writeFiles(page, [
    { shell: cacheFile, content: "rewritten by a script\n" },
    { shell: join(host.projectDir, "build", "out.txt"), content: "built\n" },
  ]);
  await waitForTurnToEnd(page);

  await changes(page).getByRole("button", { name: "This session" }).click();
  await expect(changes(page)).toContainText("and the files written while its commands ran");
  await expectListed(page, "Project", ["build/cache.txt", "build/out.txt"]);
  await expect(fileRow(page, "build/cache.txt").locator(".change-status")).toHaveText("M");
  await expect(fileRow(page, "build/out.txt").locator(".change-status")).toHaveText("A");
  await fileRow(page, "build/cache.txt").click();
  await expect(changes(page).locator(".changes-diff")).toContainText("Not shown: git ignores this file, so there is no earlier version to compare with.");
});

test("This turn lists the files commits since the turn began changed in a section of their own, the agent's still marked", async ({ page }) => {
  await signIn(page, host);
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "changes · opencode" });
  await startConversation(page);
  await changes(page).getByRole("button", { name: "This turn" }).click();
  await writeFiles(page, [{ edit: appFile, content: withLine15("committed by the agent") }]);
  await waitForTurnToEnd(page);
  await expectListed(page, "Project", ["src/app.ts"]);

  writeFileSync(join(host.projectDir, "pulled.txt"), "from a pull\n");
  git("add", "pulled.txt", "src/app.ts");
  git("commit", "-qm", "a pull and the agent's commit");
  writeFileSync(join(host.projectDir, "by-hand.txt"), "typed after the commits\n");
  await changes(page).getByRole("button", { name: "Refresh" }).click();
  await changes(page).getByRole("button", { name: "Tree" }).click();
  await expectListed(page, "From commits since the turn began", ["pulled.txt", "src/app.ts"]);
  await expect(section(page, "From commits since the turn began").locator(".from-commit")).toHaveCount(0);
  await expect(fileRow(page, "src/app.ts").locator(".by-agent")).toHaveAttribute("aria-label", "Changed by the agent");
  await expectListed(page, "Changed some other way", ["by-hand.txt"]);
  await expect(section(page, "Edited by the agent"), "the agent's edit went into a commit").toHaveCount(0);

  await fileRow(page, "src/app.ts").click();
  await expect(changes(page).locator(".changes-diff")).toContainText("committed by the agent");

  await test.step("All files marks the commits' files in the project's tree, tagged, in place of their own section", async () => {
    await changes(page).getByRole("button", { name: "All files" }).click();
    await expect(section(page, "From commits since the turn began")).toHaveCount(0);
    await expectListed(page, "Project", ["by-hand.txt", "pulled.txt", "src/app.ts"]);
    await expect(fileRow(page, "pulled.txt").locator(".from-commit")).toHaveText("commit");
    await expect(fileRow(page, "by-hand.txt").locator(".from-commit")).toHaveCount(0);
    await expect(changes(page).locator(".changes-diff")).toContainText("committed by the agent");
  });
});

test("This session leaves out the git-ignored files its commands wrote while Git-ignored files is off, and remembers the choice", async ({ page }) => {
  writeFileSync(join(host.projectDir, ".gitignore"), "build/\n");
  const built = join(host.projectDir, "build", "hidden.js");
  await signIn(page, host);
  await page.goto(`${host.origin}/#/c/${conversationId}`);
  await startConversation(page);
  await writeFiles(page, [
    { edit: appFile, content: withLine15("changed with git-ignored files off") },
    { shell: built, content: "built by a script\n" },
  ]);
  await waitForTurnToEnd(page);

  await changes(page).getByRole("button", { name: "This session" }).click();
  const ignoredToggle = changes(page).getByRole("button", { name: "Git-ignored files", exact: true });
  await expect(ignoredToggle).toHaveAttribute("aria-pressed", "true");
  await expectListed(page, "Project", ["build/hidden.js", "src/app.ts"]);

  await ignoredToggle.click();
  await expect(ignoredToggle).toHaveAttribute("aria-pressed", "false");
  await expectListed(page, "Project", ["src/app.ts"]);
  await expect(changes(page)).toContainText("1 git-ignored file hidden.");

  await page.reload();
  await expect(changes(page).getByRole("button", { name: "This session" })).toHaveAttribute("aria-pressed", "true");
  await expect(changes(page).getByRole("button", { name: "Git-ignored files", exact: true })).toHaveAttribute("aria-pressed", "false");
  await expectListed(page, "Project", ["src/app.ts"]);
});

test("This session leaves out a file another conversation's command named as it wrote it, and lists one either may have written apart", async ({ page }) => {
  const theirs = join(host.projectDir, "src", "theirs.txt");
  const both = join(host.projectDir, "src", "both.txt");
  await signIn(page, host);
  await page.goto(`${host.origin}/#/c/${conversationId}`);
  const waiting = await startConversation(page);
  await sendMessage(page, `TOOL UNTIL ${both}`);
  await expect(page.locator(".timeline:visible")).toContainText(`wait for ${both}`);

  await startConversation(page);
  await writeFiles(page, [
    { shell: theirs, content: "written by the second conversation alone\n" },
    { shell: both, content: "written while both ran a command naming it\n" },
  ]);
  await waitForTurnToEnd(page);
  await changes(page).getByRole("button", { name: "This session" }).click();
  await changes(page).getByRole("button", { name: "Tree", exact: true }).click();
  await expectListed(page, "Project", ["src/theirs.txt"]);
  await expectListed(page, "Maybe written by another conversation", ["src/both.txt"]);

  await page.goto(`${host.origin}/#/c/${waiting}`);
  await waitForTurnToEnd(page);
  await expectListed(page, "Maybe written by another conversation", ["src/both.txt"]);
  await expect(fileRow(page, "src/theirs.txt"), "the other conversation's command named it").toHaveCount(0);
});
