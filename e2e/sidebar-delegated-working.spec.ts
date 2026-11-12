import { cpSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, answerCanvasQuestion, callCanvasTool, createProfile, sendMessage, signIn } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

const host = new TestHost({ fakePrograms: true });
const promptsFile = join(host.root, "prompts");

test.beforeAll(async () => {
  cpSync(join(import.meta.dirname, "..", "tests", "fixtures", "canvas-plugins", "board"), join(host.dataDir, "plugins", "board"), { recursive: true });
  writeBunProgram(host.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"), { FAKE_ACP_PROMPTS: promptsFile });
  writeFileSync(promptsFile, "");
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

/** The stub agent offers no model to pick, so this is `startConversation` without that wait. */
async function startConversation(page: Page) {
  const previousUrl = page.url();
  await page.getByRole("button", { name: "+ New conversation" }).click();
  await expect(page).not.toHaveURL(previousUrl);
  return page.url().match(/#\/c\/(.+)$/)![1]!;
}

test("a conversation shows the working dot while a task it handed over works, and idle again once it stops", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, "Local", "", "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "Local · opencode" });
  const conversationId = await startConversation(page);
  await sendMessage(page, "Start");
  await expect(page.locator(".chat-header:visible .badge")).toHaveText("idle");

  const taskTitle = "STOPPED QUIET Look for the callers";
  expect(await callCanvasTool(host, conversationId, "hand_over", { profile: "Local", task: taskTitle })).toMatch(/^Handed over to [0-9a-f-]+\.$/);

  const callerRow = page.locator(`.sidebar li[data-reorder-id="${conversationId}"]`);
  await expect(callerRow.locator(".dot"), "the caller shows working while its task works").toHaveClass(/status-running/);

  await page.locator(".delegated-tasks:visible li", { hasText: taskTitle }).getByRole("button", { name: "Stop", exact: true }).click();
  await expect(callerRow.locator(".dot"), "the caller is idle again once its task stopped").toHaveClass(/status-idle/);
});

test("deleting a conversation closes the tasks it handed over, instead of leaving them as conversations of their own", async ({ page }) => {
  await signIn(page, host);
  await page.locator(".workspace li").first().click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "Local · opencode" });
  const conversationId = await startConversation(page);
  await sendMessage(page, "Start");
  await expect(page.locator(".chat-header:visible .badge")).toHaveText("idle");

  const taskTitle = "STOPPED QUIET Close with the caller";
  const handedOver = await callCanvasTool(host, conversationId, "hand_over", { profile: "Local", task: taskTitle });
  const taskId = handedOver.match(/^Handed over to ([0-9a-f-]+)\.$/)![1]!;
  const callerRow = page.locator(`.sidebar li[data-reorder-id="${conversationId}"]`);
  await callerRow.getByRole("button", { name: "1 delegated" }).click();
  const taskRow = page.locator(`.sidebar li[data-reorder-id="${taskId}"]`);
  await expect(taskRow).toBeVisible();

  const deleteButton = callerRow.getByRole("button", { name: "Delete conversation" });
  await callerRow.hover();
  await deleteButton.click();
  await expect(deleteButton).toHaveText("Delete?");
  await deleteButton.click();

  await expect(callerRow).toHaveCount(0);
  await expect(taskRow, "the handed-over task closes with its caller").toHaveCount(0);
  await expect(page.locator(".sidebar").getByText(taskTitle)).toHaveCount(0);
});

test("a task that waits for you shows under its caller though folded, dismissing it takes back its question, and a dismissed one that asks again comes back", async ({ page }) => {
  await signIn(page, host);
  await page.locator(".workspace li").first().click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "Local · opencode" });
  const conversationId = await startConversation(page);
  await sendMessage(page, "Start");
  await expect(page.locator(".chat-header:visible .badge")).toHaveText("idle");

  const taskTitle = "STOPPED QUIET Check the volumes";
  const handedOver = await callCanvasTool(host, conversationId, "hand_over", { profile: "Local", task: taskTitle });
  const taskId = handedOver.match(/^Handed over to ([0-9a-f-]+)\.$/)![1]!;
  const task = page.locator(".delegated-tasks:visible li", { hasText: taskTitle });
  await task.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(task.getByRole("button", { name: "Dismiss" })).toBeVisible();
  // The caller's turn on the plugin's word of the stop ends while the page shows it, so it leaves no mark to count later.
  await expect(page.locator(".timeline-entry:visible .message.user").last()).toContainText("The handed-over task stopped");
  await expect(page.locator(".chat-header:visible .badge")).toHaveText("idle");
  const fold = page.locator(`.sidebar li[data-reorder-id="${conversationId}"]`).getByRole("button", { name: "1 delegated" });
  const taskRow = page.locator(`.sidebar li[data-reorder-id="${taskId}"]`);
  await expect(fold).toHaveAttribute("aria-expanded", "false");
  await expect(taskRow, "a task that doesn't wait for you stays folded away").toHaveCount(0);
  const waitingInTitle = async () => Number((await page.title()).match(/^\((\d+)\) Mirador$/)?.[1] ?? 0);
  const waitingBefore = await waitingInTitle();
  const ask = (question: string) => callCanvasTool(host, taskId, "ask", { question, options: [{ label: "Yes" }, { label: "No" }] });

  const asked = ask("Which volume?");
  await expect(taskRow.locator(".waiting-pill"), "a task that asks shows under its caller though its tasks are folded").toHaveText("Needs you");
  await expect.poll(waitingInTitle).toBe(waitingBefore + 1);

  await task.getByRole("button", { name: "Dismiss" }).click();
  expect(await asked, "dismissing the task takes back its question").toContain("The user withdrew the question.");
  await expect(taskRow).toHaveCount(0);
  await expect.poll(waitingInTitle, { message: "nothing out of sight counts as waiting" }).toBe(waitingBefore);

  const askedAgain = ask("Which cluster?");
  await expect(taskRow.locator(".waiting-pill"), "a dismissed task that asks again comes back under its caller").toHaveText("Needs you");
  await expect.poll(waitingInTitle).toBe(waitingBefore + 1);
  await taskRow.click();
  await answerCanvasQuestion(page, "Yes");
  expect(await askedAgain).toBe("The user chose: Yes");
  await expect(taskRow, "answered, the dismissed task leaves the sidebar again").toHaveCount(0);
  await expect.poll(waitingInTitle).toBe(waitingBefore);
});
