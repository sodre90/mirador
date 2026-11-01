import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, createProfile, sendMessage, signIn, waitForTurnToEnd } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

const host = new TestHost({ fakePrograms: true });
const reportFile = join(host.projectDir, "report.txt");
const nestedRepository = join(host.projectDir, "another-project");

test.beforeAll(async () => {
  writeBunProgram(host.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"), { FAKE_ACP_PROMPTS: join(host.root, "prompts") });
  mkdirSync(join(nestedRepository, ".git"), { recursive: true });
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const changes = (page: Page) => page.locator(".canvas-panel:visible .changes");

test("in a folder that is no git repository, a file a script wrote shows in Changes, but not one written in a repository inside it", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, "no git", "", "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "no git · opencode" });
  await page.getByRole("button", { name: "+ New conversation" }).click();

  await sendMessage(
    page,
    `WRITE ${JSON.stringify([
      { shell: join(nestedRepository, "join.ts"), content: "another session's edit\n" },
      { shell: reportFile, content: "made by a script\n" },
    ])}`,
  );
  await waitForTurnToEnd(page);

  const row = changes(page).locator(".changed-file").filter({ hasText: "report.txt" });
  await expect(row.locator(".change-status")).toHaveText("A");
  await expect(row.locator(".by-agent")).toHaveCount(0);
  await expect(changes(page)).toContainText("not a git repository");
  await expect(changes(page).locator(".changed-file")).toHaveCount(1);
  await row.click();
  await expect(changes(page).locator(".changes-diff .code-row.added")).toContainText("made by a script");
});
