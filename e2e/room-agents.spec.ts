import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { AGENT_TAGGED_TURNS_AFTER_A_PERSON } from "../shared/rooms.ts";
import { addWorkspace, answerCanvasQuestion, createProfile, literally, signIn } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

const host = new TestHost({ fakePrograms: true });
const promptsOf = { Builder: () => join(host.root, "builder-prompts"), Reviewer: () => join(host.root, "reviewer-prompts") };
const recordedPrompts = (agent: keyof typeof promptsOf) => readFileSync(promptsOf[agent](), "utf8");

test.beforeAll(async ({ browser }) => {
  writeBunProgram(host.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"));
  Object.values(promptsOf).forEach((file) => writeFileSync(file(), ""));
  await host.start();
  const page = await browser.newPage();
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  for (const agent of ["Builder", "Reviewer"] as const) {
    const profiles = await createProfile(page, agent, `FAKE_ACP_PROMPTS=${promptsOf[agent]()}`, "", "opencode");
    await profiles.getByRole("button", { name: "Close" }).click();
  }
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
  await page.getByRole("button", { name: "New room" }).click();
  const dialog = page.getByRole("dialog", { name: "New room" });
  await dialog.getByLabel("Room name").fill(room);
  await dialog.getByLabel("Builder").check();
  await dialog.getByLabel("Reviewer").check();
  await dialog.getByRole("button", { name: "Create room" }).click();
  await expect(page.getByRole("heading", { name: `# ${room}` })).toBeVisible();
}

async function write(page: Page, room: string, text: string) {
  await roomComposer(page, room).fill(text);
  await roomComposer(page, room).press("Enter");
}

/** Tags the agent from the @ menu, then writes the rest of the message after the tag. */
async function tag(page: Page, room: string, agent: string, rest: string) {
  await roomComposer(page, room).fill(`@${agent.slice(0, 2)}`);
  await page.getByRole("listbox", { name: "Agents of the room" }).getByRole("option", { name: `@${agent}` }).click();
  await write(page, room, `@${agent} ${rest}`);
}

const canvasCall = (tool: string, input: unknown) => `CANVAS ${tool} ${JSON.stringify(input)}`;

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

test("a question asked in a room is answered on its canvas, and the agent's reply lands in the thread that asked it", async ({ page }) => {
  await openNewRoom(page, "Colours");
  await tag(page, "Colours", "Builder", canvasCall("ask", { question: "Which colour?", options: [{ label: "Blue" }, { label: "Green" }] }));
  const asking = answersOf(page, "Builder").filter({ has: page.locator(".room-quote", { hasText: "Which colour?" }) });
  await expect(asking.locator(".room-canvas-line")).toContainText("On the canvas: 1 question");
  await tag(page, "Colours", "Builder", "SAY Unrelated done");
  await expect(answerSaying(page, "Unrelated done")).toHaveCount(1);

  await asking.getByRole("button", { name: "Open on canvas" }).click();
  await answerCanvasQuestion(page, "Blue");
  const reply = answerSaying(page, "Going with Blue");
  await expect(reply.locator(".room-quote")).toContainText("Which colour?");
  await reply.getByRole("button", { name: "Open thread" }).click();
  await expect(thread(page, "Builder").locator(".message.agent")).toHaveText([/The question is now showing/, "Going with Blue"]);
  await expect(thread(page, "Builder")).not.toContainText("Unrelated done");
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
  expect(prompt).toContain("Builder tagged you there.");
  expect(prompt).toMatch(new RegExp(`#\\d+ Builder, [^\\n]+ UTC:\\n> ${literally("Your final answer of this turn will tag Reviewer.")}\\n$`));
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
