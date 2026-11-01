import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { addWorkspace, createProfile, sendMessage, signIn, workspaceCard } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

const host = new TestHost({ fakePrograms: true });
const promptsFile = join(host.root, "prompts");
const profileName = "snapshotting";
const SNAPSHOT_SECONDS = 6;

const git = (...args: string[]) =>
  execFileSync("git", ["-C", host.projectDir, "-c", "user.name=e2e", "-c", "user.email=e2e@localhost", ...args], { encoding: "utf8" }).trim();

/** Keeping the files runs git's clean filter on each of them, so a filter that sleeps makes it as slow as in a large repository. */
function slowToSnapshot() {
  writeFileSync(join(host.projectDir, ".gitattributes"), "slow.txt filter=slow\n");
  writeFileSync(join(host.projectDir, "slow.txt"), "kept slowly\n");
  git("init", "-q");
  git("add", "-A");
  git("commit", "-qm", "the project as it was");
  git("config", "filter.slow.clean", `sleep ${SNAPSHOT_SECONDS}; cat`);
}

test.beforeAll(async () => {
  writeBunProgram(host.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"), { FAKE_ACP_PROMPTS: promptsFile });
  writeFileSync(promptsFile, "");
  await host.start();
  slowToSnapshot();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

test("a sent message shows at once, while Mirador keeps the turn's files before the agent starts on it", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, profileName, "", "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${profileName} · opencode` });
  await workspaceCard(page, host.projectDir).getByRole("button", { name: "+ New conversation" }).click();

  const message = page.locator(".timeline:visible .message.user").last();
  const undoFiles = page.locator(".timeline:visible .undo-files").last();
  const sentAt = Date.now();
  await sendMessage(page, "SAY done");
  await expect(message).toContainText("SAY done");
  expect(Date.now() - sentAt).toBeLessThan((SNAPSHOT_SECONDS - 2) * 1_000);
  expect(readFileSync(promptsFile, "utf8")).toBe("");
  await message.hover();
  await expect(undoFiles).toBeHidden();

  await expect(page.locator(".timeline:visible .message.agent").last()).toContainText("done", { timeout: 60_000 });
  expect(readFileSync(promptsFile, "utf8")).toContain("SAY done");
  await message.hover();
  await expect(undoFiles).toBeVisible();
});
