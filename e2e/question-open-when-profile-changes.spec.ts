import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, answerCanvasQuestion, createProfile, openCanvasHistory, openProfiles, sendMessage, signIn, startConversation, waitForTurnToEnd } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

/**
 * Changing a profile stops the turn running on it and takes it up again in a new agent process. The continue message
 * used to carry that turn past a question the user had not answered yet, leaving the question open on a canvas whose
 * agent had moved on. The host now lets a turn whose session kept its request rest until the answer comes, which then
 * reaches the agent as the user's next message; a session that came back without its history gets the request again,
 * and the question its agent never asked is withdrawn.
 *
 * `opencode` here is a `WRITE [{"waitFor": path}]` turn, which holds until the file shows up. The question comes from
 * the test's own canvas `ask` call, closed the moment the profile change takes the asking process down with it: what
 * the answer does then is what it does for an agent whose tool call died.
 */
const keeping = new TestHost({ fakePrograms: true });
const freshening = new TestHost({ fakePrograms: true });

const holdFileOf = (host: TestHost) => join(host.root, "hold-the-turn");
const promptsOf = (host: TestHost) => join(host.root, "prompts");
/** A turn that names one file it read, so its card proves the agent took the request, and then waits for another to appear. */
const heldTurn = (host: TestHost) =>
  `WRITE [{"read": ${JSON.stringify(join(host.root, "the-plan"))}}, {"waitFor": ${JSON.stringify(holdFileOf(host))}}]`;
const promptsSentTo = (host: TestHost) => (existsSync(promptsOf(host)) ? readFileSync(promptsOf(host), "utf8") : "");
const outcome = (page: Page) => page.locator(".canvas-outcome:visible");

/** The canvas `ask` the test asks with, and the way to close it as the agent's own call closes when its process goes. */
function askAndWait(host: TestHost, conversationId: string, question: string) {
  const abort = new AbortController();
  const answered = fetch(`${host.origin}/mcp/${conversationId}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${host.mcpToken}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2025-11-25",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "ask", arguments: { question, options: [{ label: "Restart" }, { label: "Patch" }] } } }),
    signal: abort.signal,
  }).catch(() => {});
  return { answered, closeTheCall: () => abort.abort() };
}

/** Saves a change to the profile, which makes every conversation running on it start again on a new agent process. */
async function changeTheProfile(page: Page, name: string) {
  const dialog = await openProfiles(page);
  await dialog.locator(".profile-list li", { hasText: name }).click();
  await dialog.getByRole("button", { name: "Edit environment" }).click();
  await dialog.getByLabel("Environment", { exact: true }).fill("E2E_PROFILE_CHANGED=1");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog.locator(".saved")).toHaveText("Saved");
  await dialog.getByRole("button", { name: "Close" }).click();
}

/** A conversation on its own `opencode` profile, held in a turn that never ends. */
async function heldTurnOn(host: TestHost, page: Page, name: string) {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const saved = await createProfile(page, name, "", "", "opencode");
  await saved.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${name} · opencode` });
  const conversationId = await startConversation(page, { withModels: false });
  rmSync(holdFileOf(host), { force: true });
  writeFileSync(join(host.root, "the-plan"), "the plan\n");
  await sendMessage(page, heldTurn(host));
  // A profile change before the agent took the request sends it again, as no history of it was made: wait for its card.
  await expect(page.locator(".timeline:visible .tool").first()).toBeVisible();
  await expect(page.locator(".composer:visible .stop")).toBeVisible();
  return { conversationId, row: page.locator(`.workspace li[data-reorder-id="${conversationId}"]`) };
}

test.beforeAll(async () => {
  writeBunProgram(keeping.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"), { FAKE_ACP_PROMPTS: promptsOf(keeping), FAKE_ACP_RESUMES: "1" });
  writeBunProgram(freshening.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"), { FAKE_ACP_PROMPTS: promptsOf(freshening), FAKE_ACP_RESUME_FAILS: "1" });
  await keeping.start();
  await freshening.start();
});
test.afterAll(async () => {
  await keeping.stop();
  await keeping.cleanUp();
  await freshening.stop();
  await freshening.cleanUp();
});

test("the question a stopped turn was waiting on stays open, and its answer takes the turn on", async ({ page }) => {
  const { conversationId, row } = await heldTurnOn(keeping, page, "asking");
  const asked = askAndWait(keeping, conversationId, "Which fix?");
  await expect(row.locator(".waiting-pill")).toHaveText("Needs you");
  await expect(outcome(page)).toHaveText("needs your answer");

  await changeTheProfile(page, "asking");
  await expect(page.locator(".timeline:visible")).toContainText("Turn ended: cancelled", { timeout: 60_000 });
  asked.closeTheCall();

  await test.step("the conversation waits on the question instead of starting again without its answer", async () => {
    await expect(outcome(page)).toHaveText("needs your answer");
    await expect(row.locator(".waiting-pill")).toHaveText("Needs you");
    await expect(page.locator(".composer:visible .send")).toBeVisible();
  });

  await test.step("answering it is the message the agent goes on with", async () => {
    await answerCanvasQuestion(page, "Patch");
    await expect(page.locator(".timeline:visible .message.user").last()).toHaveText('My answer to your question "Which fix?": Patch', { timeout: 60_000 });
    await waitForTurnToEnd(page);
    expect(promptsSentTo(keeping)).toContain('My answer to your question "Which fix?": Patch');
  });

  expect(promptsSentTo(keeping)).not.toContain("Continue where you left off.");
});

test("a session that comes back without its history gets the request again, and its unanswered question is withdrawn", async ({ page }) => {
  const { conversationId, row } = await heldTurnOn(freshening, page, "unresumable");
  const asked = askAndWait(freshening, conversationId, "Which fix?");
  await expect(outcome(page)).toHaveText("needs your answer");

  await changeTheProfile(page, "unresumable");
  await expect(page.locator(".timeline:visible")).toContainText("Turn ended: cancelled", { timeout: 60_000 });
  asked.closeTheCall();

  await expect(page.locator(".timeline:visible")).toContainText("Could not resume", { timeout: 60_000 });
  await expect(row.locator(".waiting-pill")).toHaveCount(0);
  const history = await openCanvasHistory(page);
  await expect(history.locator(".history-entry", { hasText: "Which fix?" })).toContainText("withdrawn");
  await expect.poll(() => promptsSentTo(freshening).split(heldTurn(freshening)).length - 1, { timeout: 60_000 }).toBe(2);
  writeFileSync(holdFileOf(freshening), "");
  await waitForTurnToEnd(page);
});
