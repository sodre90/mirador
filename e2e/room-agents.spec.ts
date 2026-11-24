import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { AGENT_TAGGED_TURNS_AFTER_A_PERSON } from "../shared/rooms.ts";
import {
  addWorkspace,
  allowNotifications,
  clickNotification,
  createProfile,
  createRoom,
  expectPopoverFits,
  literally,
  notificationsShown,
  openNewRoom as openNewRoomDialog,
  openRoomSettings,
  roomCard,
  signIn,
} from "./helpers.ts";
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
    const profiles = await createProfile(page, agent, `OPENCODE_FAKE_ACP_PROMPTS=${promptsOf[agent]()}\nOPENCODE_FAKE_ACP_ANSWERS_HELD_BY=${answersHeld()}`, "", "opencode");
    await profiles.getByRole("button", { name: "Close" }).click();
  }
  const modeller = await createProfile(page, "Modeller", `OPENCODE_FAKE_ACP_PROMPTS=${promptsOf.Modeller()}\nOPENCODE_FAKE_ACP_MODES=1\nOPENCODE_FAKE_ACP_MODELS=1`, "", "opencode");
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
/** The entries of the agent's own conversation in its thread, under the room messages that asked it. */
const workInThread = (page: Page, agent: string) => thread(page, agent).locator(".room-thread-turn > .timeline-entry:not(.room-entry)");
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
  await expect(workInThread(page, "Builder").locator(".author").first()).toHaveText(/^Builder/);
  await expect(workInThread(page, "Builder").locator(".avatar").first()).toHaveText("◆");
  await expect(thread(page, "Builder")).not.toContainText("opencode");
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
  for (const picker of ["Model of Modeller", "Effort of Modeller"]) await expect(dialog.getByRole("combobox", { name: picker })).not.toHaveAttribute("data-hint");
  await dialog.getByRole("button", { name: "Create room" }).click();
  await expect(page.getByRole("heading", { name: "# Models" })).toBeVisible();
  await expect(page.locator(".room-agents .room-agent-model")).toHaveText(["Opus"]);

  await tag(page, "Models", "Modeller", "CHOICES");
  await expect(answerSaying(page, "On model")).toHaveText(/On model opus, mode default, effort high\./);

  await test.step("a model changed in the room's settings reaches its session at once", async () => {
    const settings = await openRoomSettings(page, "Models", "Agents");
    await settings.getByRole("combobox", { name: "Model of Modeller" }).selectOption({ label: "Haiku" });
    await settings.getByRole("button", { name: "Close" }).click();
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

/** Picks each option in turn within one task of the page, so the host's answer to a pick can't arrive before the next. */
const pickBeforeTheHostAnswers = (scope: Locator, picks: { select: string; option: string }[]) =>
  scope.evaluate(async (element, picks) => {
    for (const { select: name, option } of picks) {
      const select = element.querySelector<HTMLSelectElement>(`select[aria-label="${CSS.escape(name)}"]`)!;
      select.value = [...select.options].find(({ text }) => text === option)!.value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    }
  }, picks);

/** Sizes the window so the room's bar is about this wide, the canvas beside the room taking its share of the rest. */
async function sizeRoomBarTo(page: Page, width: number) {
  const bar = page.locator(".room-header:visible");
  const barWidthAt = async (windowWidth: number) => {
    await page.setViewportSize({ width: windowWidth, height: 800 });
    return (await bar.boundingBox())!.width;
  };
  const [narrow, wide] = [await barWidthAt(1200), await barWidthAt(1600)];
  await barWidthAt(Math.round(1200 + ((width - narrow) * 400) / (wide - narrow)));
}

const endsInEllipsis = (label: Locator) => label.evaluate((element) => element.scrollWidth > element.clientWidth);

/** Whole, on one line: its text neither wraps nor ends in an ellipsis. */
const onOneLineWhole = (name: Locator) =>
  name.evaluate((element) => {
    const text = document.createRange();
    text.selectNodeContents(element);
    return text.getClientRects().length === 1 && element.scrollWidth <= element.clientWidth;
  });

test("the people of a room fit their popover, an agent's long name on one line with its long model and effort under it, in a wide window and a narrow one", async ({ page }) => {
  const agent = "Claude Local Deepseek";
  const longModel = "deepseek-v4.1-flash (opus-compatible, 1M context)";
  await signIn(page, host);
  const profiles = await createProfile(page, agent, `OPENCODE_FAKE_ACP_MODES=1\nOPENCODE_FAKE_ACP_MODELS=1\nOPENCODE_FAKE_ACP_EXTRA_MODEL='${longModel}'`, "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await createRoom(page, "Deepseek", [agent]);
  const people = page.getByRole("dialog", { name: "People in the room" });
  const model = people.getByRole("combobox", { name: `Model of ${agent}` });
  const effort = people.getByRole("combobox", { name: `Effort of ${agent}` });

  await page.locator(".room-here-count").click();
  await test.step("a model and an effort picked in quick succession both stay, the effort never undoing the model", async () => {
    await pickBeforeTheHostAnswers(people, [
      { select: `Model of ${agent}`, option: longModel },
      { select: `Effort of ${agent}`, option: "High" },
    ]);
    await expect(effort).toHaveValue("high");
    await expect(model).toHaveValue(longModel);
    await page.reload();
    await expect(page.locator(".room-agents .room-agent-model")).toHaveText([longModel]);
    await page.locator(".room-here-count").click();
    await expect(model).toHaveValue(longModel);
    await expect(effort).toHaveValue("high");
  });
  await effort.focus();
  await expectPopoverFits(people);
  const name = people.locator(".room-people-agent-name");
  expect(await onOneLineWhole(name)).toBe(true);
  expect((await model.boundingBox())!.y).toBeGreaterThanOrEqual((await name.boundingBox())!.y + (await name.boundingBox())!.height);
  await expect(model).toHaveAttribute("data-hint", longModel);
  await expect(effort).not.toHaveAttribute("data-hint");
  await page.keyboard.press("Escape");

  await page.setViewportSize({ width: 540, height: 860 });
  await page.locator(".room-here-count").click();
  await effort.focus();
  await expectPopoverFits(people);
  await expect(model).toHaveValue(longModel);

  await test.step("grown wider than the room beside its button, it moves back into the window", async () => {
    await people.evaluate((element) => {
      const wide = document.createElement("div");
      wide.style.width = "400px";
      wide.style.height = "1px";
      element.append(wide);
    });
    await expect.poll(async () => (await people.boundingBox())!.width).toBeGreaterThan(400);
    await expectPopoverFits(people);
  });
});

test("with a long model, the room's bar keeps to one line by cutting the agent's chip short, whole in a hint, and the room's settings give the agent's name the room it needs", async ({ page }) => {
  const agent = "Claude Local Kimi";
  const longModel = "kimi-k3-preview (sonnet-compatible, 512k context)";
  await signIn(page, host);
  const profiles = await createProfile(page, agent, `OPENCODE_FAKE_ACP_MODES=1\nOPENCODE_FAKE_ACP_MODELS=1\nOPENCODE_FAKE_ACP_EXTRA_MODEL='${longModel}'`, "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await createRoom(page, "Kimi", [agent, "Builder"]);
  await page.locator(".room-here-count").click();
  await page.getByRole("dialog", { name: "People in the room" }).getByRole("combobox", { name: `Model of ${agent}` }).selectOption({ label: longModel });
  await page.keyboard.press("Escape");
  const bar = page.locator(".room-header:visible");
  const chipLabel = (name: string) => bar.locator(".room-agent-label", { hasText: name });
  await expect(chipLabel(agent).locator(".room-agent-model")).toHaveText(longModel);
  const inviteBesideTitle = async () => {
    const [title, invite] = [await bar.locator(".room-title").boundingBox(), await bar.getByRole("button", { name: "Invite someone" }).boundingBox()];
    return invite!.y < title!.y + title!.height;
  };

  await test.step("in a bar 880px wide, Invite someone stays on the line of the room's name, and only the long chip is cut short", async () => {
    await sizeRoomBarTo(page, 880);
    expect(await inviteBesideTitle()).toBe(true);
    expect(await endsInEllipsis(chipLabel(agent))).toBe(true);
    await expect(chipLabel(agent)).toHaveAttribute("data-hint", `${agent} · ${longModel}`);
    expect(await endsInEllipsis(chipLabel("Builder"))).toBe(false);
    await expect(chipLabel("Builder")).not.toHaveAttribute("data-hint");
  });

  await test.step("in a bar too narrow for a few letters of each chip, the bar wraps, its buttons kept together on the right", async () => {
    await sizeRoomBarTo(page, 460);
    expect(await inviteBesideTitle()).toBe(false);
    const [here, invite, settings] = await Promise.all(
      [bar.locator(".room-here-count"), bar.getByRole("button", { name: "Invite someone" }), bar.getByRole("button", { name: "Room settings" })].map(async (button) => (await button.boundingBox())!),
    );
    const middle = (box: { y: number; height: number }) => box.y + box.height / 2;
    expect(Math.abs(middle(here) - middle(invite))).toBeLessThan(4);
    expect(Math.abs(middle(settings) - middle(invite))).toBeLessThan(4);
    const barBox = (await bar.boundingBox())!;
    expect(settings.x + settings.width).toBeGreaterThan(barBox.x + barBox.width - 40);
  });

  await test.step("the room's settings show the agent's whole name beside its model and effort, and cut it short with a hint only where too narrow", async () => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    const settings = await openRoomSettings(page, "Kimi", "Agents");
    const row = settings.getByRole("button", { name: `Settings of ${agent}` });
    const name = row.locator(".room-settings-agent-name");
    expect(await onOneLineWhole(name)).toBe(true);
    await expect(row).not.toHaveAttribute("data-hint");
    await name.evaluate((element) => (element.closest("li")!.style.width = "120px"));
    await expect(row).toHaveAttribute("data-hint", agent);
    expect(await endsInEllipsis(name)).toBe(true);
  });
});

test("the divider beside a thread drags it wider, and under it higher, and the room keeps both after a reload", async ({ page }) => {
  await openNewRoom(page, "Widths");
  await tag(page, "Widths", "Builder", "SAY Measured");
  const openThread = () => answerSaying(page, "Measured").getByRole("button", { name: "Open thread" }).click();
  const divider = page.getByRole("separator", { name: "Resize the side panel" });
  const threadBox = async () => (await thread(page, "Builder").boundingBox())!;
  const dragDividerBy = async (deltaX: number, deltaY: number) => {
    const box = (await divider.boundingBox())!;
    const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + deltaX, y + deltaY, { steps: 10 });
    await page.mouse.up();
  };
  const canvasToggle = (name: string) => page.locator(".layout-toggles:visible").getByRole("button", { name });

  await test.step("beside the room, wider", async () => {
    await canvasToggle("Hide canvas").click();
    await openThread();
    await expect(divider).toHaveAttribute("aria-orientation", "vertical");
    const before = (await threadBox()).width;
    await dragDividerBy(-150, 0);
    const dragged = (await threadBox()).width;
    expect(Math.abs(dragged - (before + 150))).toBeLessThan(6);
    await page.reload();
    await openThread();
    expect(Math.abs((await threadBox()).width - dragged)).toBeLessThan(1);
  });

  await test.step("under the room, in a pane too narrow for both side by side, higher", async () => {
    await canvasToggle("Show canvas").click();
    await expect(divider).toHaveAttribute("aria-orientation", "horizontal");
    const before = (await threadBox()).height;
    await dragDividerBy(0, -120);
    const dragged = (await threadBox()).height;
    expect(Math.abs(dragged - (before + 120))).toBeLessThan(6);
    await page.reload();
    await openThread();
    expect(Math.abs((await threadBox()).height - dragged)).toBeLessThan(1);
  });
});

test("a thread opens at its latest, follows the agent's work from there, leaves a reader who scrolled up in place, and takes them back when they follow up", async ({ page }) => {
  const longText = (ending: string) => `${"Every plank is measured twice. ".repeat(300)}${ending}`;
  const timeline = thread(page, "Builder").locator(".timeline");
  const scrolledTo = () => timeline.evaluate((element) => element.scrollTop);
  const leftBelow = () => timeline.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop);
  const workSaying = (text: string) => workInThread(page, "Builder").locator(".message.agent", { hasText: text });
  const expectAtLatest = async (answer: string) => {
    await expect(workSaying(answer)).toBeVisible();
    await expect.poll(leftBelow).toBeLessThan(2);
    expect(await scrolledTo()).toBeGreaterThan(0);
  };
  const scrollUp = () =>
    timeline.evaluate((element) => {
      element.scrollTop = 200;
      element.dispatchEvent(new Event("scroll"));
    });
  const followUp = async (text: string) => {
    const box = thread(page, "Builder").getByRole("textbox", { name: "Follow up with Builder…" });
    await box.fill(text);
    await box.press("Enter");
  };

  await openNewRoom(page, "Planks");
  await tag(page, "Planks", "Builder", `SAY ${longText("First coat")}`);
  const answer = answerSaying(page, "First coat");
  await answer.getByRole("button", { name: "Open thread" }).click();
  await expectAtLatest("First coat");

  await followUp(`SAY ${longText("Second coat")}`);
  await expectAtLatest("Second coat");

  const released = join(host.root, "third-coat-released");
  rmSync(released, { force: true });
  await followUp(`WAIT ${released} SAY ${longText("Third coat")}`);
  await expect(thread(page, "Builder").locator(".working")).toHaveText("Builder is working…");
  await scrollUp();
  writeFileSync(released, "");
  await expect(workSaying("Third coat")).toBeVisible();
  expect(await scrolledTo()).toBe(200);

  await followUp(`SAY ${longText("Fourth coat")}`);
  await expectAtLatest("Fourth coat");

  await scrollUp();
  await thread(page, "Builder").getByRole("button", { name: "Close thread" }).click();
  await answer.getByRole("button", { name: "Open thread" }).click();
  await expectAtLatest("Fourth coat");
});

test("a room follows its latest message, leaves a reader who scrolled up in place, and takes them back when they write or jump there", async ({ page }) => {
  const longText = (ending: string) => `${"Every nail is counted once. ".repeat(300)}${ending}`;
  const timeline = page.locator(".room-timeline");
  const scrolledTo = () => timeline.evaluate((element) => element.scrollTop);
  const leftBelow = () => timeline.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop);
  const jump = page.getByRole("button", { name: "Jump to the latest" });
  const expectAtLatest = async () => {
    await expect.poll(leftBelow).toBeLessThan(2);
    expect(await scrolledTo()).toBeGreaterThan(0);
    await expect(jump).toHaveCount(0);
  };
  const scrollUp = async () => {
    await timeline.evaluate((element) => {
      element.scrollTop = 100;
      element.dispatchEvent(new Event("scroll"));
    });
    await expect(jump).toBeVisible();
  };

  await openNewRoom(page, "Nails");
  await tag(page, "Nails", "Builder", `SAY ${longText("First box")}`);
  await expect(answerSaying(page, "First box")).toBeVisible();
  await expectAtLatest();

  await test.step("an answer leaves a reader who scrolled up where they are", async () => {
    const released = join(host.root, "second-box-released");
    rmSync(released, { force: true });
    await tag(page, "Nails", "Builder", `WAIT ${released} SAY ${longText("Second box")}`);
    await expectAtLatest();
    await scrollUp();
    writeFileSync(released, "");
    await expect(answerSaying(page, "Second box")).toHaveCount(1);
    expect(await scrolledTo()).toBe(100);
  });

  await test.step("the jump button takes them to the latest, which is followed from there", async () => {
    await jump.click();
    await expectAtLatest();
    await tag(page, "Nails", "Builder", `SAY ${longText("Third box")}`);
    await expect(answerSaying(page, "Third box")).toBeVisible();
    await expectAtLatest();
  });

  await test.step("a message of their own takes them there too", async () => {
    await scrollUp();
    await write(page, "Nails", "Counted them all");
    await expect(roomEntries(page).last().locator(".message.user")).toHaveText("Counted them all");
    await expectAtLatest();
  });

  await test.step("another room opens at its own latest, and this one too on coming back", async () => {
    await scrollUp();
    await createRoom(page, "Screws", []);
    await write(page, "Screws", longText("None counted yet"));
    await expect(roomEntries(page).last().locator(".message.user")).toContainText("None counted yet");
    await expectAtLatest();
    await scrollUp();
    await roomCard(page, "Nails").click();
    await expect(roomEntries(page).last().locator(".message.user")).toHaveText("Counted them all");
    await expectAtLatest();
  });

  await test.step("the room opens at its latest again", async () => {
    await page.reload();
    await expect(roomEntries(page).last().locator(".message.user")).toHaveText("Counted them all");
    await expectAtLatest();
  });
});
