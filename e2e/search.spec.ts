import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, addWorkspaceFromSidebar, currentMatch, primaryModifier, reloadFromRestartedHost, signIn, workspaceCard } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();
const secondDir = join(host.root, "second");

test.beforeAll(async () => {
  await host.start();
  mkdirSync(secondDir, { recursive: true });
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

async function startConversationIn(page: Page, directory: string) {
  const previousUrl = page.url();
  await workspaceCard(page, directory).getByRole("button", { name: "+ New conversation" }).click();
  await expect(page).not.toHaveURL(previousUrl);
  await expect(page.locator(".chat-header:visible").getByLabel("Model", { exact: true })).toBeVisible({ timeout: 60_000 });
  return page.url().match(/#\/c\/(.+)$/)![1]!;
}

const seed = (conversationId: string, events: unknown[]) =>
  execFileSync("bun", [join(import.meta.dirname, "seed-events.ts"), join(host.dataDir, "state.sqlite"), conversationId, JSON.stringify(events)]);
const agentSays = (text: string) => ({ type: "acp", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } } });

test("Cmd+Shift+F searches every workspace, and a match opens in its conversation with the find bar on it", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const older = await startConversationIn(page, host.projectDir);
  await addWorkspaceFromSidebar(page, secondDir);
  const newer = await startConversationIn(page, secondDir);
  await host.stop();
  seed(older, [{ type: "user-message", text: "Where should I look?" }, agentSays("The needle is in the haystack, next to another needle."), { type: "turn-end", stopReason: "end_turn" }]);
  execFileSync("bun", [join(import.meta.dirname, "seed-long-conversation.ts"), join(host.dataDir, "state.sqlite"), older, "120"]);
  seed(newer, [{ type: "user-message", text: "Where is the needle?" }]);
  await host.start();
  await reloadFromRestartedHost(page);

  const shortcut = `${await primaryModifier(page)}+Shift+KeyF`;
  const dialog = page.getByRole("dialog", { name: "Search all workspaces" });
  const input = dialog.getByLabel("Search all workspaces");
  const matches = dialog.getByRole("option");

  await test.step("the shortcut opens the search, which lists matches by workspace, the newest first", async () => {
    await page.keyboard.press(shortcut);
    await input.fill("n");
    await expect(dialog.locator(".search-summary")).toHaveText("Type at least 2 characters to search every conversation in every workspace.");
    await input.fill("needle");
    await expect(dialog.locator(".search-summary")).toHaveText("3 matches in 2 conversations");
    await expect(dialog.locator(".search-workspace")).toHaveText(["second", "project"]);
    await expect(matches).toHaveCount(2);
    await expect(matches.first()).toContainText("Where is the needle?");
    await expect(matches.first().locator("mark")).toHaveText("needle");
    await expect(matches.first()).toHaveAttribute("aria-selected", "true");
  });

  await test.step("a match opens its conversation with the find bar on it, loading the entry if it was not in the page", async () => {
    await input.press("ArrowDown");
    await input.press("Enter");
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`#/c/${older}$`));
    const bar = page.getByRole("search");
    await expect(bar.getByLabel("Find in this conversation")).toHaveValue("needle");
    await expect(bar.locator(".find-tally")).toHaveText("1 of 2");
    await expect.poll(() => currentMatch(page)).toMatchObject({ text: "needle", entry: expect.stringContaining("next to another needle"), inView: true });
  });

  await test.step("the search keeps its query, and the shortcut closes it again", async () => {
    await page.keyboard.press(shortcut);
    await expect(input).toHaveValue("needle");
    await expect(matches).toHaveCount(2);
    await page.keyboard.press(shortcut);
    await expect(dialog).toHaveCount(0);
  });
});
