import { execFileSync } from "node:child_process";
import { mkdirSync, realpathSync, utimesSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { expect, test } from "@playwright/test";
import { FakeGateway, gatewayEnvironment } from "./fake-gateway.ts";
import { addWorkspace, clickWorkspaceButton, createProfile, signIn } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();
const gateway = new FakeGateway();
const SPOKEN_WORD = "platypus";
const WORKTREE_WORD = "axolotl";
const SESSION_COUNT = 35;
const HIDDEN_INDEX = SESSION_COUNT - 1;

const configDir = join(host.root, "claude-config");
let transcriptsDir = "";

const sessionIds: string[] = [];

function writeSessionAt(dir: string, cwd: string, title: string, said: string, when: Date) {
  const sessionId = crypto.randomUUID();
  const record = (type: "user" | "assistant", text: string, uuid: string) =>
    JSON.stringify({
      parentUuid: null,
      isSidechain: false,
      userType: "external",
      cwd,
      sessionId,
      version: "2.0.0",
      entrypoint: "cli",
      type,
      timestamp: when.toISOString(),
      uuid,
      ...(type === "user" ? { origin: { kind: "human" }, promptId: uuid } : {}),
      message: { role: type, content: [{ type: "text", text }] },
    });
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${sessionId}.jsonl`);
  writeFileSync(path, [record("user", title, "u1"), record("assistant", `Ran ${title}.`, "a1"), record("user", said, "u2"), record("assistant", `Noted: ${said}`, "a2")].join("\n") + "\n");
  utimesSync(path, when, when);
  return sessionId;
}

function writeFakeSession(index: number) {
  const said = index === HIDDEN_INDEX ? `We should revisit the ${SPOKEN_WORD} hatchery plan.` : `Nothing special ${index}.`;
  const when = new Date(Date.now() - (index + 1) * 3_600_000);
  sessionIds[index] = writeSessionAt(transcriptsDir, host.projectDirInTerminal, `Nightly backup drill ${index}`, said, when);
}

test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  await gateway.start();
  await host.start();
  writeFileSync(join(host.projectDir, "README.md"), "search\n");
  execFileSync("git", ["-C", host.projectDir, "init", "-q", "--initial-branch=main"]);
  execFileSync("git", ["-C", host.projectDir, "config", "user.name", "The Owner"]);
  execFileSync("git", ["-C", host.projectDir, "config", "user.email", "owner@example.test"]);
  execFileSync("git", ["-C", host.projectDir, "add", "-A"]);
  execFileSync("git", ["-C", host.projectDir, "commit", "-qm", "base"]);
  transcriptsDir = join(configDir, "projects", host.projectDirInTerminal.replace(/[^a-zA-Z0-9]/g, "-"));
  mkdirSync(transcriptsDir, { recursive: true });
  for (const index of Array.from({ length: SESSION_COUNT }, (_, i) => i)) writeFakeSession(index);
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
  gateway.stop();
});

test("the Continue dialog finds a session older than its list by a word said in it and continues it", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, "fake gateway", `${gatewayEnvironment(gateway)}\nCLAUDE_CONFIG_DIR=${configDir}`);
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "fake gateway · Claude Code" });

  await clickWorkspaceButton(page.locator(".workspace"), "Continue a session…");
  const dialog = page.getByRole("dialog", { name: "Continue a session" });
  await expect(dialog.locator(".session-list")).toBeVisible({ timeout: 30_000 });

  const newest = dialog.locator(".session-list li", { hasText: sessionIds[0]!.slice(0, 8) });
  const hidden = dialog.locator(".session-list li", { hasText: sessionIds[HIDDEN_INDEX]!.slice(0, 8) });
  await expect(newest).toBeVisible();
  await expect(hidden).toHaveCount(0);

  await dialog.getByLabel("Search sessions by what was said in them").fill(SPOKEN_WORD);
  await expect(hidden).toBeVisible({ timeout: 30_000 });
  await expect(hidden.locator(".session-match")).toContainText(`revisit the ${SPOKEN_WORD} hatchery`);
  await expect(newest).toHaveCount(0);
  await expect(dialog.locator(".session-list li")).toHaveCount(1);

  await hidden.getByRole("button", { name: "Continue" }).click();
  await expect(page.locator(".chat-header h2")).toContainText(`Nightly backup drill ${HIDDEN_INDEX}`);
  await expect(page.locator(".timeline")).toContainText(`${SPOKEN_WORD} hatchery`, { timeout: 30_000 });
  await expect(page.locator(".workspace li.selected .worktree-mark")).toHaveCount(0);
});

test("the Continue dialog finds a deleted worktree conversation by what was said in it and continues it in a fresh worktree", async ({ page }) => {
  await signIn(page, host);
  const workspaceId = await page.locator("section.workspace").first().getAttribute("data-reorder-id");
  expect(workspaceId).toBeTruthy();
  const folderName = `${basename(host.projectDir).replace(/[^\p{L}\p{N}._-]+/gu, "-")}-${workspaceId!.slice(0, 8)}`;
  const deletedWorktree = join(realpathSync.native(host.dataDir), "worktrees", folderName, "deadbeef");
  const worktreeTranscriptsDir = join(configDir, "projects", deletedWorktree.replace(/[^a-zA-Z0-9]/g, "-"));
  const worktreeSessionId = writeSessionAt(
    worktreeTranscriptsDir,
    deletedWorktree,
    "Deleted worktree chat",
    `Keep the ${WORKTREE_WORD} tank warm.`,
    new Date(Date.now() - 10_000),
  );

  await clickWorkspaceButton(page.locator(".workspace"), "Continue a session…");
  const dialog = page.getByRole("dialog", { name: "Continue a session" });
  const worktreeRow = dialog.locator(".session-list li", { hasText: worktreeSessionId.slice(0, 8) });
  await expect(worktreeRow).toBeVisible({ timeout: 30_000 });
  await expect(worktreeRow.locator(".session-worktree")).toBeVisible();

  await dialog.getByLabel("Search sessions by what was said in them").fill(WORKTREE_WORD);
  await expect(worktreeRow).toBeVisible({ timeout: 30_000 });
  await expect(worktreeRow.locator(".session-match")).toContainText(`${WORKTREE_WORD} tank warm`);
  await expect(worktreeRow.locator(".session-worktree")).toBeVisible();
  await expect(dialog.locator(".session-list li")).toHaveCount(1);

  await worktreeRow.getByRole("button", { name: "Continue" }).click();
  await expect(page.locator(".chat-header h2").filter({ visible: true })).toContainText("Deleted worktree chat");
  await expect(page.locator(".timeline").filter({ visible: true })).toContainText(`${WORKTREE_WORD} tank warm`, { timeout: 30_000 });
  await expect(page.locator(".workspace li.selected .worktree-mark")).toBeVisible();
});
