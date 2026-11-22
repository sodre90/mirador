import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { AGENT_TAGGED_TURNS_AFTER_A_PERSON } from "../shared/rooms.ts";
import { addWorkspace, allowNotifications, clickNotification, createProfile, createRoom, literally, notificationsShown, openNewRoom as openNewRoomDialog, openRoomSettings, roomCard, signIn } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

const host = new TestHost({ fakePrograms: true });
const promptsOf = { Builder: () => join(host.root, "builder-prompts"), Reviewer: () => join(host.root, "reviewer-prompts"), Modeller: () => join(host.root, "modeller-prompts") };
const answersHeld = () => join(host.root, "answers-held");
const recordedPrompts = (agent: keyof typeof promptsOf) => readFileSync(promptsOf[agent](), "utf8");

test.beforeAll(async ({ browser }) => {
  writeBunProgram(host.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"));
  Object.values(promptsOf).forEach((file) => writeFileSync(file(), ""));
  await host.start();
  const page = await browser.newPage();
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  for (const agent of ["Builder", "Reviewer"] as const) {
    const profiles = await createProfile(page, agent, `FAKE_ACP_PROMPTS=${promptsOf[agent]()}\nFAKE_ACP_ANSWERS_HELD_BY=${answersHeld()}`, "", "opencode");
    await profiles.getByRole("button", { name: "Close" }).click();
  }
  const modeller = await createProfile(page, "Modeller", `FAKE_ACP_PROMPTS=${promptsOf.Modeller()}\nFAKE_ACP_MODES=1\nFAKE_ACP_MODELS=1`, "", "opencode");
  await modeller.getByRole("button", { name: "Close" }).click();
  await page.close();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const roomComposer = (page: Page, room: string) => page.getByRole("textbox", { name: `Write in ${room}, @ tags an agent…` });
const roomEntries = (page: Page) => page.locator(".room-timeline .room-entry");
const answersOf = (page: Page, agent: string) => roomEntries(page).filter({ has: page.locator(".author", { hasText: agent }) });
const answerSaying = (page: Page, text: string) => roomEntries(page).filter({ has: page.locator(".message.agent", { hasText: text }) });
const thread = (page: Page, agent: string) => page.getByRole("complementary", { name: `Thread of ${agent}` });
const roomCanvas = (page: Page) => page.locator(".canvas-panel:visible");
const shownPage = (page: Page) => page.frameLocator(".canvas-panel:visible .canvas-frame.show iframe");

async function openNewRoom(page: Page, room: string) {
  await signIn(page, host);
  await createRoom(page, room, ["Builder", "Reviewer"]);
}

async function write(page: Page, room: string, text: string) {
  await roomComposer(page, room).fill(text);
  await roomComposer(page, room).press("Enter");
}

/** Tags the agent from the @ menu, then writes the rest of the message after the tag. */
async function tag(page: Page, room: string, agent: string, rest: string) {
  await roomComposer(page, room).fill(`@${agent.slice(0, 2)}`);
  await page.getByRole("listbox", { name: "Agents and people of the room" }).getByRole("option", { name: `@${agent}` }).click();
  await write(page, room, `@${agent} ${rest}`);
}

const canvasCall = (tool: string, input: unknown) => `CANVAS ${tool} ${JSON.stringify(input)}`;

/** Picks the option in the vote under the agent's answer, then confirms it as the answer the agent gets. */
async function confirmInRoom(answer: Locator, label: string) {
  await answer.locator(".room-vote").getByRole("button", { name: label, exact: true }).click();
  await answer.locator(".room-vote").getByRole("button", { name: `Confirm: ${label}` }).click();
}

test("an agent's page shows on the room's canvas, its answer opens it there, the canvas hidden too, and it stays after a reload", async ({ page }) => {
  await openNewRoom(page, "Pages");
  await tag(page, "Pages", "Builder", canvasCall("show", { title: "Release plan", html: "<h1>Ship on Friday</h1>" }));
  const answer = answersOf(page, "Builder");
  await expect(answer.locator(".room-canvas-line")).toContainText("On the canvas: 1 page");
  await expect(roomCanvas(page).locator(".canvas-title")).toHaveText("Release plan");
  await expect(shownPage(page).locator("h1")).toHaveText("Ship on Friday");
  await expect(roomCanvas(page).getByRole("button", { name: "Changes" })).toHaveCount(0);
  await expect(roomCanvas(page).getByRole("button", { name: "Point and ask" })).toHaveCount(0);

  await tag(page, "Pages", "Builder", canvasCall("show", { title: "Risks", html: "<h1>None known</h1>" }));
  await expect(roomCanvas(page).locator(".canvas-title")).toHaveText("Risks");
  await answersOf(page, "Builder").first().getByRole("button", { name: "Open on canvas" }).click();
  await expect(roomCanvas(page).locator(".canvas-title")).toHaveText("Release plan");

  await page.reload();
  await expect(page.getByRole("heading", { name: "# Pages" })).toBeVisible();
  await expect(roomCanvas(page).locator(".canvas-title")).toHaveText("Risks");
  await expect(shownPage(page).locator("h1")).toHaveText("None known");
  await expect(answersOf(page, "Builder").locator(".room-canvas-line")).toHaveCount(2);
  await answersOf(page, "Builder").first().getByRole("button", { name: "Open on canvas" }).click();
  await expect(shownPage(page).locator("h1")).toHaveText("Ship on Friday");

  await page.locator(".layout-toggles:visible").getByRole("button", { name: "Hide canvas" }).click();
  await expect(roomCanvas(page)).toHaveCount(0);
  await answersOf(page, "Builder").last().getByRole("button", { name: "Open on canvas" }).click();
  await expect(shownPage(page).locator("h1")).toHaveText("None known");
});

test("a question asked in a room is voted on and confirmed there, its canvas only shows it, and the agent's reply lands in the thread that asked it", async ({ page }) => {
  await openNewRoom(page, "Colours");
  await tag(page, "Colours", "Builder", canvasCall("ask", { question: "Which colour?", options: [{ label: "Blue" }, { label: "Green" }] }));
  const asking = answersOf(page, "Builder").filter({ has: page.locator(".room-quote", { hasText: "Which colour?" }) });
  await expect(asking.locator(".room-canvas-line")).toContainText("On the canvas: 1 question");
  await tag(page, "Colours", "Builder", "SAY Unrelated done");
  await expect(answerSaying(page, "Unrelated done")).toHaveCount(1);

  await asking.getByRole("button", { name: "Open on canvas" }).click();
  await expect(roomCanvas(page).locator(".ask-answer")).toHaveText("Vote on it in the room.");
  await expect(roomCanvas(page).getByRole("button", { name: "Submit" })).toHaveCount(0);
  writeFileSync(answersHeld(), "");
  await confirmInRoom(asking, "Blue");
  const working = page.locator(".room-timeline > .room-thread-line", { hasText: "Builder is working…" });
  await expect(working).toBeVisible();
  await working.getByRole("button", { name: "Open thread" }).click();
  await expect(thread(page, "Builder").locator(".working")).toHaveText("Builder is working…");
  rmSync(answersHeld());
  await expect(working).toHaveCount(0);
  const reply = answerSaying(page, "Going with Blue");
  await expect(reply.locator(".room-quote")).toContainText("Which colour?");
  await reply.getByRole("button", { name: "Open thread" }).click();
  await expect(thread(page, "Builder").locator(".message.agent")).toHaveText([/The question is now showing/, "Going with Blue"]);
  await expect(thread(page, "Builder")).not.toContainText("Unrelated done");
});

test("a question asked in a room while you look elsewhere notifies, marks the room and counts in the tab's title until answered", async ({ page }) => {
  await allowNotifications(page);
  await openNewRoom(page, "Sizes");
  const asksRoom = new URL(page.url()).hash;
  const go = join(host.root, "sizes-go");
  await tag(page, "Sizes", "Builder", `WAIT ${go} ${canvasCall("ask", { question: "Which size?", options: [{ label: "Small" }, { label: "Large" }] })}`);
  await openNewRoom(page, "Elsewhere");
  await expect(page).toHaveTitle("Mirador");
  writeFileSync(go, "");

  await expect.poll(async () => (await notificationsShown(page)).map(({ body }) => body)).toEqual(["project · Asks: Which size?", "project · Finished, waiting for you"]);
  await expect(roomCard(page, "Sizes")).toHaveAttribute("data-waiting-tone", "decision");
  await expect(page).toHaveTitle("(1) Mirador");
  await clickNotification(page, "project · Asks: Which size?");
  await expect(page).toHaveURL(new RegExp(`${asksRoom}$`));
  await confirmInRoom(answersOf(page, "Builder"), "Large");
  await expect(answerSaying(page, "Going with Large")).toHaveCount(1);
  await expect(roomCard(page, "Sizes")).not.toHaveAttribute("data-waiting-tone");
  await expect(page).toHaveTitle("Mirador");
});

test("an agent tags another with room_tag, which answers in a thread of its own having read the first one's answer", async ({ page }) => {
  await openNewRoom(page, "Handover");
  await tag(page, "Handover", "Builder", canvasCall("room_tag", { agents: ["Builder"] }));
  await expect(answerSaying(page, "You can't tag yourself.")).toHaveCount(1);
  await expect(answerSaying(page, "You can't tag yourself.").locator(".room-tags-line")).toHaveCount(0);

  await tag(page, "Handover", "Builder", canvasCall("room_tag", { agents: ["@reviewer"] }));
  const handedOver = answerSaying(page, "Your final answer of this turn will tag Reviewer.");
  await expect(handedOver.locator(".room-tags-line")).toHaveText("Tagged Reviewer");
  const reviewerAnswer = answersOf(page, "Reviewer");
  await expect(reviewerAnswer.locator(".message.agent")).toHaveText("Noted.");
  await expect(reviewerAnswer.locator(".room-quote")).toContainText("Your final answer of this turn will tag Reviewer.");
  await reviewerAnswer.getByRole("button", { name: "Open thread" }).click();
  await expect(thread(page, "Reviewer").locator(".message.agent")).toHaveText(["Your final answer of this turn will tag Reviewer.", "Noted."]);
  const prompt = recordedPrompts("Reviewer");
  expect(prompt).toContain("[agent] Builder tagged you there.");
  expect(prompt).toMatch(new RegExp(`#\\d+ \\[agent\\] Builder, [^\\n]+ UTC:\\n> ${literally("Your final answer of this turn will tag Reviewer.")}\\n$`));
});

test(`two agents tagging each other are stopped after ${AGENT_TAGGED_TURNS_AFTER_A_PERSON} turns, with a line saying so`, async ({ page }) => {
  await openNewRoom(page, "Rally");
  await tag(page, "Rally", "Builder", "PINGPONG Reviewer Builder");
  const stopped = roomEntries(page).locator(".room-tags-dropped");
  await expect(stopped).toHaveText(
    `Not tagged: Reviewer. The agents were stopped, as they had tagged each other ${AGENT_TAGGED_TURNS_AFTER_A_PERSON} times since a person wrote. Tag one with @ to go on.`,
  );
  await expect(roomEntries(page).locator(".message.agent")).toHaveCount(AGENT_TAGGED_TURNS_AFTER_A_PERSON + 1);
  await expect(page.locator(".room-timeline")).not.toContainText("is working");
  await expect(roomEntries(page).locator(".room-tags-line")).toHaveCount(AGENT_TAGGED_TURNS_AFTER_A_PERSON);
});

test("an agent reads back older messages of the room with room_history", async ({ page }) => {
  await openNewRoom(page, "Archive");
  await write(page, "Archive", "Morning all");
  await write(page, "Archive", "The release is Friday");
  await tag(page, "Archive", "Reviewer", "SAY Seen");
  await expect(answerSaying(page, "Seen")).toHaveCount(1);
  await tag(page, "Archive", "Reviewer", canvasCall("room_history", { before: 3, limit: 1 }));
  const readBack = answersOf(page, "Reviewer").last();
  await expect(readBack.locator(".message.agent")).toContainText("1 earlier message matches too: ask again with before 2.");
  await expect(readBack.locator(".message.agent")).toContainText("The release is Friday");
  await expect(readBack.locator(".message.agent")).not.toContainText("Morning all");
});

test("a new room's agent is found by name and set to a model there, which it answers on, and the owner changes it later in the room's settings and its bar", async ({ page }) => {
  await signIn(page, host);
  const dialog = await openNewRoomDialog(page);
  const roomName = dialog.getByLabel("Room name");
  await roomName.fill("Models");
  for (const attribute of ["autocorrect", "autocapitalize", "autocomplete"]) await expect(roomName).toHaveAttribute(attribute, "off");
  await expect(roomName).toHaveAttribute("spellcheck", "false");
  const chosen = dialog.getByRole("list", { name: "Agents" }).getByRole("button", { name: /^Remove / });
  while ((await chosen.count()) > 0) await chosen.first().click();
  const search = dialog.getByRole("combobox", { name: "Find an agent" });
  await expect(search).toHaveAttribute("spellcheck", "false");
  await search.fill("nobody");
  await expect(dialog.getByText("No agent by that name.")).toBeVisible();
  await search.fill("mod");
  await expect(dialog.getByRole("listbox", { name: "Find an agent" }).getByRole("option")).toHaveText(["Modeller"]);
  await search.press("Enter");
  await expect(dialog.getByRole("list", { name: "Agents" }).locator(".room-agent-chip-name")).toHaveText(["Modeller"]);
  await dialog.getByRole("combobox", { name: "Model of Modeller" }).selectOption({ label: "Opus" });
  await dialog.getByRole("combobox", { name: "Effort of Modeller" }).selectOption({ label: "High" });
  await dialog.getByRole("button", { name: "Create room" }).click();
  await expect(page.getByRole("heading", { name: "# Models" })).toBeVisible();
  await expect(page.locator(".room-agents .room-agent-model")).toHaveText(["Opus"]);

  await tag(page, "Models", "Modeller", "CHOICES");
  await expect(answerSaying(page, "On model")).toHaveText(/On model opus, mode default, effort high\./);

  await test.step("a model changed in the room's settings reaches its session at once", async () => {
    const settings = await openRoomSettings(page, "Models", "Agents");
    await settings.getByRole("combobox", { name: "Model of Modeller" }).selectOption({ label: "Haiku" });
    await settings.getByRole("button", { name: "Done" }).click();
    await expect(page.locator(".room-agents .room-agent-model")).toHaveText(["Haiku"]);
    await tag(page, "Models", "Modeller", "CHOICES");
    await expect(answerSaying(page, "On model haiku")).toHaveText(/On model haiku, mode default\./);
  });

  await test.step("and so does one changed from the room's bar", async () => {
    await page.locator(".room-here-count").click();
    const people = page.getByRole("dialog", { name: "People in the room" });
    await people.getByRole("combobox", { name: "Model of Modeller" }).selectOption({ label: "Default (recommended)" });
    await page.keyboard.press("Escape");
    await tag(page, "Models", "Modeller", "CHOICES");
    await expect(answerSaying(page, "On model default")).toHaveText(/On model default, mode default, effort high\./);
  });
});
