import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { addWorkspace, callCanvasTool, createProfile, primaryModifier, reloadFromRestartedHost, sendMessage, signIn, startConversation } from "./helpers.ts";
import type { Demo } from "./seed-demo.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

const host = new TestHost({ fakePrograms: true });

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  // An opencode that holds a WRITE turn until the file it waits for exists.
  writeBunProgram(host.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"), { FAKE_ACP_PROMPTS: join(host.root, "prompts") });
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

/** As if a turn of the conversation had ended while nobody looked: written while the host is stopped. */
async function endTurnUnseen(page: Page, conversationId: string) {
  await host.stop();
  const demo: Demo = { workspaceColors: {}, sidebar: [], conversations: [{ id: conversationId, title: "Finished elsewhere", minutesAgo: 1, unseenTurnEnd: "finished", events: [] }] };
  execFileSync("bun", [join(import.meta.dirname, "seed-demo.ts"), join(host.dataDir, "state.sqlite"), JSON.stringify(demo)]);
  await host.start();
  await reloadFromRestartedHost(page);
}

test("Mark as unread keeps a conversation to come back to, until it is opened again or marked read", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const first = await startConversation(page);
  const second = await startConversation(page);
  const third = await startConversation(page);
  const row = (conversationId: string) => page.locator(`.workspace li[data-reorder-id="${conversationId}"]`);
  const pill = (conversationId: string) => row(conversationId).locator(".waiting-pill");
  const count = page.locator(".workspace .waiting-count");
  const menuEntry = (name: string) => page.getByRole("menu").getByRole("menuitem", { name });
  const nothingOpen = page.getByText("No conversation selected");
  const modifier = await primaryModifier(page);

  await test.step("right-clicking a conversation marks it unread without opening it, and the workspace and the tab title count it", async () => {
    await row(first).click({ button: "right" });
    await menuEntry("Mark as unread").click();
    await expect(pill(first)).toHaveText("Unread");
    await expect(pill(first)).toHaveAttribute("data-hint", /you marked it/);
    await expect(page).toHaveURL(new RegExp(`#/c/${third}$`));
    await expect(count).toHaveText("1");
    await expect(count).toHaveClass(/tone-unread/);
    await expect(page).toHaveTitle("(1) Mirador");
  });

  await test.step("the mark stays across a reload and a host restart, and opening the conversation clears it", async () => {
    await page.reload();
    await expect(pill(first)).toHaveText("Unread");
    await host.restart();
    await reloadFromRestartedHost(page);
    await expect(pill(first)).toHaveText("Unread", { timeout: 30_000 });
    await row(first).click();
    await expect(pill(first)).toHaveCount(0);
    await expect(page).toHaveTitle("Mirador");
  });

  await test.step("marking the open conversation goes back to the one open before it, skipping one that opening would clear", async () => {
    await page.keyboard.press(`${modifier}+Shift+KeyU`);
    await expect(pill(first)).toHaveText("Unread");
    await expect(page).toHaveURL(new RegExp(`#/c/${third}$`));
    await page.keyboard.press(`${modifier}+Shift+KeyU`);
    await expect(pill(third)).toHaveText("Unread");
    await expect(pill(first)).toHaveText("Unread");
    await expect(nothingOpen).toBeVisible();
    await expect(count).toHaveText("2");
  });

  await test.step("Mark as read clears the mark without opening the conversation, and the palette marks the open one", async () => {
    await row(third).click({ button: "right" });
    await menuEntry("Mark as read").click();
    await expect(pill(third)).toHaveCount(0);
    await expect(nothingOpen).toBeVisible();
    await row(second).click();
    await page.keyboard.press(`${modifier}+KeyK`);
    const palette = page.getByLabel("Search conversations and actions");
    await palette.fill("mark as unread");
    await palette.press("Enter");
    await expect(pill(second)).toHaveText("Unread");
    await expect(page).toHaveURL(new RegExp(`#/c/${third}$`));
  });

  await test.step("Mark as read also clears a Done mark", async () => {
    await endTurnUnseen(page, second);
    await expect(pill(second)).toHaveText("Done", { timeout: 30_000 });
    await row(second).click({ button: "right" });
    await menuEntry("Mark as read").click();
    await expect(pill(second)).toHaveCount(0);
    await expect(count).toHaveText("1");
  });

  await test.step("a conversation that needs you cannot be marked unread, and Esc closes the menu", async () => {
    void callCanvasTool(host, third, "ask", { question: "Which layout?", options: [{ label: "Yes" }, { label: "No" }] }).catch(() => {});
    await expect(pill(third)).toHaveText("Needs you");
    await row(third).click({ button: "right" });
    await expect(menuEntry("Mark as unread")).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`#/c/${third}$`));
    await page.keyboard.press(`${modifier}+Shift+KeyU`);
    await expect(pill(third)).toHaveText("Needs you");
    await expect(page).toHaveURL(new RegExp(`#/c/${third}$`));
  });
});

test("a conversation marked unread while its turn runs keeps its running dot, its pill and the count showing the mark until the turn ends", async ({ page }) => {
  const release = join(host.root, "release-held-turn");
  await signIn(page, host);
  const profiles = await createProfile(page, "held turns", "", "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "held turns · opencode" });
  const previousUrl = page.url();
  await page.getByRole("button", { name: "+ New conversation" }).click();
  await expect(page).not.toHaveURL(previousUrl);
  await expect(page.locator(".chat-header:visible .badge")).toHaveText("idle", { timeout: 30_000 });
  const conversationId = page.url().match(/#\/c\/(.+)$/)![1]!;
  const row = page.locator(`.workspace li[data-reorder-id="${conversationId}"]`);
  const count = page.locator(".workspace .waiting-count");
  const countBefore = Number(await count.textContent());

  await sendMessage(page, `WRITE ${JSON.stringify([{ waitFor: release }])}`);
  await expect(row.locator(".dot")).toHaveClass(/status-running/);
  await row.click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: "Mark as unread" }).click();
  await expect(row.locator(".waiting-pill")).toHaveText("Unread");
  await expect(row.locator(".dot")).toHaveClass(/status-running/);
  await expect(count).toHaveText(String(countBefore + 1));

  writeFileSync(release, "");
  await expect(row.locator(".waiting-pill")).toHaveText("Done");
  await expect(row.locator(".dot")).toHaveClass(/dot waiting tone-done/);
});
