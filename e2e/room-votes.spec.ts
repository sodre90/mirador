import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { addWorkspace, allowNotifications, clickNotification, createProfile, createRoom, notificationsShown, openRoomSettings, openSettings, reloadFromRestartedHost, roomCard, signIn } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

const host = new TestHost({ fakePrograms: true });
const builderPrompts = () => join(host.root, "builder-prompts");

/** Where the screenshots of votes, tags and unread marks go, when wanted. */
const SCREENSHOTS = process.env.MIRADOR_ROOM_SCREENSHOTS;

async function screenshot(shown: Locator | Page, name: string) {
  if (SCREENSHOTS) await shown.screenshot({ path: join(SCREENSHOTS, `${name}.png`) });
}

const people = { mia: { name: "Mia", personId: "", cookie: { name: "", value: "", url: "" } }, gus: { name: "Gus", personId: "", cookie: { name: "", value: "", url: "" } } };

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  writeBunProgram(host.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"));
  writeFileSync(builderPrompts(), "");
  await host.start();
  for (const person of Object.values(people)) Object.assign(person, host.admitPerson(person.name));
  const page = await browser.newPage();
  await signIn(page, host);
  const settings = await openSettings(page);
  await settings.getByLabel("Name", { exact: true }).fill("Olivia");
  await settings.getByLabel("Name", { exact: true }).press("Enter");
  await settings.getByRole("button", { name: "Close" }).click();
  const profiles = await createProfile(page, "Builder", `OPENCODE_FAKE_ACP_PROMPTS=${builderPrompts()}`, "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await addWorkspace(page, host.projectDir, "Builder · opencode");
  await page.close();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const memberComposer = (page: Page, room: string) => page.getByRole("textbox", { name: `Write in ${room}, @ tags an agent…` });
const roomEntries = (page: Page) => page.locator(".room-timeline .room-entry");
const answerSaying = (page: Page, text: string) => roomEntries(page).filter({ has: page.locator(".message.agent", { hasText: text }) });
const vote = (page: Page, question: string) => page.getByRole("region", { name: question });
const option = (page: Page, question: string, label: string) => vote(page, question).locator(".room-vote-option").filter({ has: page.getByRole("button", { name: label, exact: true }) });
const tagMenu = (page: Page) => page.getByRole("listbox", { name: "Agents and people of the room" });
/** The write-in box under one of several questions: every agent question offers one, so a title alone doesn't pick it. */
const writeIn = (page: Page, title: string, question: string) =>
  vote(page, title).locator(".room-vote-question").filter({ hasText: question }).getByRole("textbox", { name: "Or write another answer…" });

/** Lets the person into the room in the role, from the room's settings. */
async function letIn(page: Page, room: string, person: string, role: "Member" | "Guest") {
  const dialog = await openRoomSettings(page, room);
  await dialog.getByRole("combobox", { name: "Add someone you let in before" }).selectOption({ label: person });
  await dialog.getByLabel(`Role of ${person}`).selectOption({ label: role });
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();
}

async function openAs(browser: import("@playwright/test").Browser, person: (typeof people)[keyof typeof people]) {
  const context = await browser.newContext();
  await context.addCookies([person.cookie]);
  const page = await context.newPage();
  await page.goto(host.origin);
  return page;
}

/** Writes in the room, tagging from the @ menu first the one whose name starts with `typed`. */
async function writeTagging(composer: Locator, menu: Locator, typed: string, tagged: string, rest: string) {
  await composer.fill(`@${typed}`);
  await menu.getByRole("option", { name: `@${tagged}`, exact: true }).click();
  await composer.pressSequentially(rest);
  await composer.press("Enter");
}

test("an agent's question in a room is everyone's vote, which the person whose task it is confirms, and the agent gets only the confirmed answer", async ({ page, browser }) => {
  await signIn(page, host);
  await createRoom(page, "Launch", ["Builder"]);
  await letIn(page, "Launch", "Mia", "Member");
  await letIn(page, "Launch", "Gus", "Guest");
  const mia = await openAs(browser, people.mia);
  const gus = await openAs(browser, people.gus);
  for (const each of [mia, gus]) await roomCard(each, "Launch").click();
  const question = "Which colour?";

  await test.step("Mia gives the agent a task, which asks the room a question once the owner allows it", async () => {
    const ask = { question, options: [{ label: "Blue" }, { label: "Green" }] };
    await writeTagging(memberComposer(mia, "Launch"), tagMenu(mia), "Bu", "Builder", `CANVAS ask ${JSON.stringify(ask)}`);
    await page.locator(".room-timeline ~ .room-approvals").getByRole("button", { name: "Allow", exact: true }).click();
    for (const each of [page, mia, gus]) await expect(vote(each, question)).toBeVisible();
    await screenshot(vote(page, question), "vote-open");
  });

  await test.step("everyone picks an option, the guest too, and sees who picked which", async () => {
    await option(gus, question, "Green").getByRole("button").click();
    await option(page, question, "Blue").getByRole("button").click();
    await option(mia, question, "Green").getByRole("button").click();
    for (const each of [page, mia, gus]) {
      await expect(option(each, question, "Green").locator(".room-vote-count")).toHaveText("2");
      await expect(option(each, question, "Blue").locator(".room-vote-count")).toHaveText("1");
      await expect(option(each, question, "Green").locator(".room-vote-voters")).toHaveAttribute("data-hint", /Gus/);
    }
    await expect(option(page, question, "Blue").locator(".room-vote-voters")).toHaveAttribute("aria-label", "Chosen by Olivia");
    await expect(option(mia, question, "Green").getByRole("button")).toHaveAttribute("aria-pressed", "true");
    await expect(option(mia, question, "Blue").getByRole("button")).toHaveAttribute("aria-pressed", "false");
    await screenshot(vote(page, question), "vote-tallied");
  });

  await test.step("only Mia, whose task it is, and the owner may confirm, each their own pick, and only the owner in words of their own while tasks wait", async () => {
    await expect(vote(gus, question).getByRole("button", { name: /^Confirm/ })).toHaveCount(0);
    await expect(vote(gus, question).locator(".room-vote-status")).toHaveText("Mia or Olivia confirms the answer.");
    await expect(vote(page, question).getByRole("button", { name: "Confirm: Blue" })).toBeVisible();
    const otherAnswer = vote(page, question).getByRole("textbox", { name: "Or write another answer…" });
    await expect(otherAnswer).toBeVisible();
    await expect(otherAnswer).toHaveAttribute("autocorrect", "off");
    await expect(otherAnswer).toHaveAttribute("writingsuggestions", "false");
    await expect(vote(mia, question).getByRole("button", { name: "Confirm: Green" })).toBeVisible();
    await expect(vote(mia, question).getByRole("textbox")).toHaveCount(0);
    await option(mia, question, "Blue").getByRole("button").click();
    await expect(vote(mia, question).getByRole("button", { name: "Confirm: Blue" })).toBeVisible();
    await option(mia, question, "Green").getByRole("button").click();
  });

  await test.step("Mia confirms, the question closes for everyone with who confirmed what, and the agent goes with that answer", async () => {
    await vote(mia, question).getByRole("button", { name: "Confirm: Green" }).click();
    for (const each of [page, mia, gus]) await expect(vote(each, question).locator(".room-vote-status")).toHaveText("Mia confirmed: Green");
    await expect(option(page, question, "Green")).toHaveClass(/\banswer\b/);
    await expect(option(gus, question, "Blue").getByRole("button")).toBeDisabled();
    for (const each of [page, mia, gus]) await expect(answerSaying(each, "Going with Green")).toHaveCount(1);
    expect(readFileSync(builderPrompts(), "utf8")).toContain('[member] Mia answered your question "Which colour?": Green');
    await screenshot(vote(page, question), "vote-confirmed");
  });

  await test.step("the canvas shows the question for reading, and the votes stay after the host restarts", async () => {
    await answerSaying(page, "The question is now showing").getByRole("button", { name: "Open on canvas" }).click();
    await expect(page.locator(".canvas-panel:visible .ask-answer")).toHaveText("Answered: Green");
    await expect(page.locator(".canvas-panel:visible .ask").getByRole("button", { name: "Submit" })).toHaveCount(0);
    await host.restart();
    await reloadFromRestartedHost(page);
    await expect(option(page, question, "Green").locator(".room-vote-count")).toHaveText("2");
    await expect(vote(page, question).locator(".room-vote-status")).toHaveText("Mia confirmed: Green");
  });
});

test("a member whose tasks wait for approval can't answer in words of their own, but can confirm that none of the options fits", async ({ page, browser }) => {
  await signIn(page, host);
  await roomCard(page, "Launch").click();
  const mia = await openAs(browser, people.mia);
  await roomCard(mia, "Launch").click();
  const question = "Which size?";
  const ask = { question, options: [{ label: "Small" }, { label: "Large" }] };
  await writeTagging(memberComposer(mia, "Launch"), tagMenu(mia), "Bu", "Builder", `CANVAS ask ${JSON.stringify(ask)}`);
  await page.locator(".room-timeline ~ .room-approvals").getByRole("button", { name: "Allow", exact: true }).click();
  const noneOfThese = vote(mia, question).getByRole("button", { name: "None of these", exact: true });

  await expect(noneOfThese).toBeVisible();
  await expect(vote(mia, question).getByRole("textbox")).toHaveCount(0);
  await expect(vote(page, question).getByRole("button", { name: "None of these", exact: true }), "the owner writes an answer of their own instead").toHaveCount(0);
  await option(mia, question, "Small").getByRole("button").click();
  await noneOfThese.click();
  await expect(noneOfThese).toHaveAttribute("aria-pressed", "true");
  await expect(option(mia, question, "Small").getByRole("button")).toHaveAttribute("aria-pressed", "false");
  await expect(vote(mia, question).getByRole("button", { name: "Confirm: None of these" })).toBeEnabled();
  await option(mia, question, "Large").getByRole("button").click();
  await expect(noneOfThese, "picking an option takes None of these back").toHaveAttribute("aria-pressed", "false");
  await expect(vote(mia, question).getByRole("button", { name: "Confirm: Large" })).toBeVisible();
  await noneOfThese.click();
  await screenshot(vote(mia, question), "vote-none-of-these");
  await vote(mia, question).getByRole("button", { name: "Confirm: None of these" }).click();

  for (const each of [page, mia]) await expect(vote(each, question).locator(".room-vote-status")).toHaveText("Mia confirmed: None of these");
  await expect.poll(() => readFileSync(builderPrompts(), "utf8")).toContain('[member] Mia answered your question "Which size?": none of the options');
});

test("an agent's several questions are each voted on and confirmed together, only as the confirmer picked them or in words of their own, and a person taken out of the room takes their picks along", async ({ page, browser }) => {
  await signIn(page, host);
  await roomCard(page, "Launch").click();
  const gus = await openAs(browser, people.gus);
  await roomCard(gus, "Launch").click();
  const title = "2 questions: Which bed?";
  const ask = {
    questions: [
      { question: "Which bed?", options: [{ label: "North" }, { label: "South" }] },
      { question: "Which seeds?", options: [{ label: "Peas" }, { label: "Beans" }] },
    ],
  };
  await writeTagging(memberComposer(page, "Launch"), tagMenu(page), "Bu", "Builder", `CANVAS ask ${JSON.stringify(ask)}`);

  await option(gus, title, "South").getByRole("button").click();
  await option(gus, title, "Beans").getByRole("button").click();
  await expect(option(page, title, "Beans").locator(".room-vote-count")).toHaveText("1");
  const confirm = vote(page, title).getByRole("button", { name: /^Confirm/ });
  await expect(confirm).toHaveText("Confirm");
  await expect(confirm).toBeDisabled();
  await expect(vote(page, title).locator(".room-vote-hint")).toHaveText("Pick an answer to confirm it.");
  await expect(writeIn(page, title, "Which bed?")).toHaveCount(1);
  await expect(writeIn(page, title, "Which seeds?")).toHaveCount(1);
  await writeIn(page, title, "Which seeds?").fill("Carrots");
  await expect(confirm).toBeDisabled();
  await option(page, title, "North").getByRole("button").click();
  await expect(vote(page, title).getByRole("button", { name: "Confirm: North · Carrots" })).toBeEnabled();
  await expect(vote(page, title).locator(".room-vote-hint")).toHaveCount(0);
  await option(gus, title, "North").getByRole("button").click();
  await option(page, title, "South").getByRole("button").click();
  await expect(vote(page, title).getByRole("button", { name: "Confirm: South · Carrots" })).toBeVisible();
  await writeIn(page, title, "Which seeds?").press("Enter");

  for (const each of [page, gus]) await expect(vote(each, title).locator(".room-vote-status")).toHaveText("Olivia confirmed: South · Carrots");
  await expect.poll(() => readFileSync(builderPrompts(), "utf8")).toContain(['My answers to your questions:', '1. "Which bed?": South', '2. "Which seeds?": Carrots'].join("\n"));

  await test.step("taken out of the room, Gus takes his picks along, and the tally shows without them at once", async () => {
    await expect(option(page, title, "North").locator(".room-vote-count")).toHaveText("1");
    await expect(option(page, title, "Beans").locator(".room-vote-count")).toHaveText("1");
    const dialog = await openRoomSettings(page, "Launch");
    await dialog.getByRole("button", { name: "Remove Gus" }).click();
    await dialog.getByRole("button", { name: "Confirm: Remove Gus" }).click();
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toBeHidden();
    await expect(option(page, title, "North").locator(".room-vote-count")).toHaveCount(0);
    await expect(option(page, title, "Beans").locator(".room-vote-count")).toHaveCount(0);
    await expect(option(page, title, "South").locator(".room-vote-count")).toHaveText("1");
  });
});

test("tagging a person in a room highlights it for everyone and most for them, counts as unread where they look elsewhere, and notifies them unless they muted the room", async ({ page, browser }) => {
  await allowNotifications(page);
  await signIn(page, host);
  await createRoom(page, "Plots", ["Builder"]);
  await letIn(page, "Plots", "Mia", "Member");
  const mia = await openAs(browser, people.mia);
  await roomCard(mia, "Launch").click();

  await test.step("the owner tags Mia from the @ menu, which offers the room's people besides its agents", async () => {
    await memberComposer(page, "Plots").fill("@");
    await expect(tagMenu(page).getByRole("option")).toHaveText(["@Builder", "@Mia"]);
    await writeTagging(memberComposer(page, "Plots"), tagMenu(page), "Mi", "Mia", "can you water the plots?");
    const tagged = roomEntries(page).last();
    await expect(tagged.locator(".room-mention")).toHaveText("@Mia");
    await expect(tagged.locator(".room-mention.you")).toHaveCount(0);
  });

  await test.step("Mia, looking at another room, sees the room's unread count and that she was tagged, until she opens it, where her tag stands out", async () => {
    const plots = roomCard(mia, "Plots");
    await expect(plots.locator(".room-unread")).toHaveText("1");
    await expect(plots.locator(".room-tagged")).toHaveText("@");
    await screenshot(mia.locator(".sidebar .rooms"), "sidebar-unread");
    await plots.click();
    const tagged = roomEntries(mia).last();
    await expect(tagged.locator(".room-mention.you")).toHaveText("@Mia");
    await expect(tagged).toHaveClass(/\btags-you\b/);
    await expect(plots.locator(".room-unread")).toHaveCount(0);
    await expect(plots.locator(".room-tagged")).toHaveCount(0);
    await screenshot(tagged, "mention");
  });

  await test.step("tagged while looking at another room, the owner is notified and the room is marked, and the notification opens it", async () => {
    await roomCard(page, "Launch").click();
    await writeTagging(memberComposer(mia, "Plots"), tagMenu(mia), "Ol", "Olivia", "done, all watered");
    const body = "project · Mia tagged you: @Olivia done, all watered";
    await expect.poll(async () => (await notificationsShown(page)).map((shown) => `${shown.title}: ${shown.body}`)).toContain(`Plots: ${body}`);
    await expect(roomCard(page, "Plots").locator(".room-unread")).toHaveText("1");
    await expect(roomCard(page, "Plots").locator(".room-tagged")).toHaveText("@");
    await screenshot(page.locator(".sidebar .rooms"), "sidebar-unread-owner");
    const shownOnce = (await notificationsShown(page)).length;
    await writeTagging(memberComposer(mia, "Plots"), tagMenu(mia), "Ol", "Olivia", "and the beans too");
    await expect(roomCard(page, "Plots").locator(".room-unread")).toHaveText("2");
    expect((await notificationsShown(page)).length).toBe(shownOnce);
    await clickNotification(page, body);
    await expect(page.getByRole("heading", { name: "# Plots" })).toBeVisible();
    await expect(roomCard(page, "Plots").locator(".room-unread")).toHaveCount(0);
  });

  await test.step("muted, the room still counts what the owner hasn't read, but notifies nothing", async () => {
    const mute = page.locator(".room-header").getByRole("button", { name: "Mute notifications" });
    await mute.click();
    await expect(mute).toHaveAttribute("aria-pressed", "true");
    await roomCard(page, "Launch").click();
    const shownBefore = (await notificationsShown(page)).length;
    await writeTagging(memberComposer(mia, "Plots"), tagMenu(mia), "Ol", "Olivia", "one more thing");
    await expect(roomCard(page, "Plots").locator(".room-unread")).toHaveText("1");
    await memberComposer(mia, "Plots").fill("and that's all");
    await memberComposer(mia, "Plots").press("Enter");
    await expect(roomCard(page, "Plots").locator(".room-unread")).toHaveText("2");
    await expect(roomCard(page, "Plots")).toHaveClass(/\bmuted\b/);
    expect((await notificationsShown(page)).length).toBe(shownBefore);
  });
});

test("an agent's answer has a faint colour of its own, and stands out for whom it tags unless it answers their own task", async ({ page, browser }) => {
  await signIn(page, host);
  await createRoom(page, "Beds", ["Builder"]);
  await letIn(page, "Beds", "Mia", "Member");
  const mia = await openAs(browser, people.mia);
  const backgroundOf = (entry: Locator) => entry.evaluate((element) => getComputedStyle(element).backgroundColor);
  const textLookOf = (entry: Locator) =>
    entry.locator(".message").evaluate((element) => {
      const { fontSize, color } = getComputedStyle(element);
      return { fontSize, color };
    });

  await test.step("answering the owner's own task, the agent's tag of her is marked, but the answer does not stand out for her", async () => {
    await writeTagging(memberComposer(page, "Beds"), tagMenu(page), "Bu", "Builder", "SAY @Olivia the beds are dug");
    const answer = answerSaying(page, "the beds are dug");
    await expect(answer.locator(".room-mention.you")).toHaveText("@Olivia");
    await expect(answer).not.toHaveClass(/\btags-you\b/);
    await expect(answer).toHaveClass(/\bagent-opencode\b/);
    expect(await backgroundOf(answer)).not.toBe("rgba(0, 0, 0, 0)");
    const task = roomEntries(page).filter({ has: page.locator(".message.user", { hasText: "the beds are dug" }) });
    expect(await textLookOf(answer)).toEqual(await textLookOf(task));
    await screenshot(roomEntries(page).last(), "answer-to-own-task");
  });

  await test.step("answering the owner's task with a tag of Mia, the answer stands out for Mia", async () => {
    await writeTagging(memberComposer(page, "Beds"), tagMenu(page), "Bu", "Builder", "SAY @Mia please water them");
    await expect(answerSaying(page, "please water them")).toHaveCount(1);
    await roomCard(mia, "Beds").click();
    const answer = answerSaying(mia, "please water them");
    await expect(answer.locator(".room-mention.you")).toHaveText("@Mia");
    await expect(answer).toHaveClass(/\btags-you\b/);
    await expect(answerSaying(mia, "the beds are dug")).not.toHaveClass(/\btags-you\b/);
  });
});
