import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, createProfile, createRoom, roomCard, sendMessage, signIn, startConversation, waitForTurnToEnd } from "./helpers.ts";
import { ScriptedModel, scriptedOpencodeEnvironment } from "./scripted-model.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();
const model = new ScriptedModel();
const PROFILE = "Scripted";

test.beforeAll(async ({ browser }) => {
  await model.start();
  await host.start();
  const page = await browser.newPage();
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const dialog = await createProfile(page, PROFILE, scriptedOpencodeEnvironment(model, host.root), "", "opencode");
  await dialog.getByRole("button", { name: "Close" }).click();
  await page.close();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
  model.stop();
});

const open = (page: Page, conversationId: string) => page.locator(`li[data-reorder-id="${conversationId}"]`).click();
const shownTitle = (page: Page) => page.frameLocator(".canvas-panel:visible .canvas-frame.show iframe").locator("h1");

async function startedConversation(page: Page) {
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${PROFILE} · opencode` });
  const conversationId = await startConversation(page);
  await sendMessage(page, "hello");
  await waitForTurnToEnd(page);
  return conversationId;
}

test("each opencode conversation on one agent gets its own canvas calls, and its subagents' too", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, host);
  const first = await startedConversation(page);
  const second = await startedConversation(page);

  await open(page, first);
  await sendMessage(page, "SHOW Page of the first");
  await expect(shownTitle(page)).toHaveText("Page of the first", { timeout: 60_000 });
  await waitForTurnToEnd(page);

  await open(page, second);
  await sendMessage(page, "SHOW Page of the second");
  await expect(shownTitle(page)).toHaveText("Page of the second", { timeout: 60_000 });
  await waitForTurnToEnd(page);

  await open(page, first);
  await expect(shownTitle(page)).toHaveText("Page of the first");
  await sendMessage(page, "DELEGATE SHOW Page from a subagent");
  await expect(shownTitle(page)).toHaveText("Page from a subagent", { timeout: 60_000 });
  await waitForTurnToEnd(page);

  const subagent = page.locator(".timeline .tool.subagent");
  await expect(subagent).toHaveCount(1);
  await expect(subagent.locator(".subagent-task")).toHaveText("Scripted subagent");
  await expect(subagent).toHaveClass(/subagent-done/);
  await expect(subagent.locator(".subagent-work .tool")).toHaveCount(1);
  await expect(subagent.locator(".subagent-work .message.agent")).toHaveCount(1);
  const subagentReply = ((await subagent.locator(".subagent-work .message.agent").textContent()) ?? "").trim();
  await expect(page.locator(".timeline:visible .message.agent:not(.subagent-work .message)").filter({ hasText: subagentReply })).toHaveText(/^Tool result: <subagent /);
});

const roomComposer = (page: Page, room: string) => page.getByRole("textbox", { name: `Write in ${room}, @ tags an agent…` });
const roomAnswerSaying = (page: Page, text: string) => page.locator(".room-timeline .room-entry").filter({ has: page.locator(".message.agent", { hasText: text }) });

/** The canvas tools offered with the conversation's request that holds `marker`, by their own names. */
const canvasToolsOfferedWith = (marker: string) =>
  model
    .toolsOfferedWith(marker)
    .filter((name) => name.includes("canvas"))
    .map((name) => name.replace(/^.*canvas[_-]/, ""))
    .toSorted();

const openNewRoom = (page: Page, room: string) => createRoom(page, room, [PROFILE]);

/** Tags the agent from the @ menu and puts `line` on a line of its own, the last of the prompt the scripted model reads. */
async function tagInRoom(page: Page, room: string, line: string, answered = line) {
  await roomComposer(page, room).fill(`@${PROFILE.slice(0, 2)}`);
  await page.getByRole("listbox", { name: "Agents of the room" }).getByRole("option", { name: `@${PROFILE}` }).click();
  await roomComposer(page, room).fill(`@${PROFILE}\n${line}`);
  await roomComposer(page, room).press("Enter");
  await expect(roomAnswerSaying(page, answered).first()).toBeVisible({ timeout: 60_000 });
}

const ROOM_TOOLS = ["ask", "room_history", "room_tag", "show"];

async function expectRoomKeepsItsTools(page: Page, room: string) {
  const marker = `tools of ${room}`;
  await tagInRoom(page, room, marker);
  expect(canvasToolsOfferedWith(marker)).toEqual(ROOM_TOOLS);
  await tagInRoom(page, room, `SHOW Page of ${room}`, "Tool result: ");
  await expect(shownTitle(page)).toHaveText(`Page of ${room}`);
}

async function expectOwnersConversationKeepsItsTools(page: Page, conversationId: string, name: string) {
  await open(page, conversationId);
  const marker = `tools of ${name}`;
  await sendMessage(page, marker);
  await waitForTurnToEnd(page);
  const offered = canvasToolsOfferedWith(marker);
  expect(offered).toEqual(expect.arrayContaining(["ask", "show", "title_conversation", "usage_stats", "when_done"]));
  expect(offered).not.toContain("room_history");
  expect(offered).not.toContain("room_tag");
  await sendMessage(page, `CALL title_conversation {"title":"Titled ${name}"}`);
  await waitForTurnToEnd(page);
  await expect(page.locator(`li[data-reorder-id="${conversationId}"]`)).toContainText(`Titled ${name}`);
  await sendMessage(page, `SHOW Page of ${name}`);
  await expect(shownTitle(page)).toHaveText(`Page of ${name}`, { timeout: 60_000 });
  await waitForTurnToEnd(page);
}

test("an owner's conversation and a room's on one opencode profile and folder each keep exactly their own canvas tools, whichever started first", async ({ page }) => {
  test.setTimeout(360_000);
  await signIn(page, host);

  await test.step("the owner's conversation first, then the room's", async () => {
    const owners = await startedConversation(page);
    await openNewRoom(page, "Lobby");
    await tagInRoom(page, "Lobby", "hello from the lobby");
    await expectRoomKeepsItsTools(page, "Lobby");
    await expectOwnersConversationKeepsItsTools(page, owners, "the owner's first conversation");
  });

  await test.step("the room's conversation first, then the owner's", async () => {
    await openNewRoom(page, "Annex");
    await tagInRoom(page, "Annex", "hello from the annex");
    const owners = await startedConversation(page);
    await expectOwnersConversationKeepsItsTools(page, owners, "the owner's second conversation");
    await roomCard(page, "Annex").click();
    await expect(page.getByRole("heading", { name: "# Annex" })).toBeVisible();
    await expectRoomKeepsItsTools(page, "Annex");
  });
});
