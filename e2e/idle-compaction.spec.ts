import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { FakeClaudeApi, subscriptionEnvironment } from "./fake-claude-api.ts";
import { addWorkspace, createProfile, openProfiles, sendMessage, signIn, startConversation, waitForTurnToEnd, openProfileTab } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();
const api = new FakeClaudeApi();

test.beforeAll(async () => {
  api.limited = false;
  await api.start();
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
  api.stop();
});

/** What claude-agent-acp logged about idle compaction for the profile's agent, once its conversation went idle. */
const idleCompactionLog = (profile: string) => {
  const logs = join(host.dataDir, "logs");
  return readdirSync(logs)
    .filter((file) => file.startsWith(`claude-${profile}-`))
    .map((file) => readFileSync(join(logs, file), "utf8"))
    .join("")
    .split("\n")
    .filter((line) => line.includes("[idle-compaction]"))
    .join("\n");
};

async function chatOnProfile(page: Page, profile: string) {
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${profile} · Claude Code` });
  await startConversation(page);
  await sendMessage(page, "hello");
  await waitForTurnToEnd(page);
}

test("a Claude Code profile can stop its conversations compacting while they sit idle", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);

  await test.step("the profile keeps the setting", async () => {
    const profiles = await createProfile(page, "quiet", subscriptionEnvironment(api));
    await openProfileTab(profiles, "Defaults");
    const setting = profiles.getByLabel("Profile idle compaction");
    await expect(setting).toBeChecked();
    await setting.uncheck();
    await profiles.getByRole("button", { name: "Save" }).click();
    await expect(profiles.locator(".saved")).toHaveText("Saved");
    await profiles.getByRole("button", { name: "Close" }).click();
    const reopened = await openProfiles(page);
    await reopened.locator(".profile-list li", { hasText: "quiet" }).click();
    await openProfileTab(reopened, "Defaults");
    await expect(reopened.getByLabel("Profile idle compaction")).not.toBeChecked();
    await reopened.getByRole("button", { name: "Close" }).click();
  });

  await test.step("Claude Code hears it and leaves the idle conversation as it is", async () => {
    await chatOnProfile(page, "quiet");
    await expect.poll(() => idleCompactionLog("quiet"), { timeout: 30_000 }).toContain("disabled by idleCompaction setting");
  });

  await test.step("a profile left as it was lets Claude Code decide", async () => {
    const profiles = await createProfile(page, "usual", subscriptionEnvironment(api));
    await openProfileTab(profiles, "Defaults");
    await expect(profiles.getByLabel("Profile idle compaction")).toBeChecked();
    await profiles.getByRole("button", { name: "Close" }).click();
    await chatOnProfile(page, "usual");
    await expect.poll(() => idleCompactionLog("usual"), { timeout: 30_000 }).toContain("skip:");
    expect(idleCompactionLog("usual")).not.toContain("disabled by idleCompaction setting");
  });
});
