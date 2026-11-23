import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { addWorkspace, allowNotifications, clickNotification, createProfile, createRoom, notificationsShown, openProfileTab, openRoomSettings, roomCard, signIn } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

const host = new TestHost({ fakePrograms: true });
const promptsKeptIn = (agent: string) => `OPENCODE_FAKE_ACP_PROMPTS=${join(host.root, `${agent}-prompts`)}`;

test.beforeAll(async ({ browser }) => {
  writeBunProgram(host.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"));
  await host.start();
  const page = await browser.newPage();
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  for (const agent of ["Builder", "Reviewer"]) {
    const profiles = await createProfile(page, agent, promptsKeptIn(agent), "", "opencode");
    await profiles.getByRole("button", { name: "Close" }).click();
  }
  const daredevil = await createProfile(page, "Daredevil", promptsKeptIn("Daredevil"), "", "opencode");
  await openProfileTab(daredevil, "Defaults");
  await daredevil.getByLabel("Profile YOLO").check();
  await daredevil.getByRole("button", { name: "Save" }).click();
  await expect(daredevil.locator(".saved")).toHaveText("Saved");
  await daredevil.getByRole("button", { name: "Close" }).click();
  await page.close();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

type AskStep = { kind: string; title: string; command?: string; path?: string } | { waitFor: string };

const ask = (steps: AskStep[]) => `ASK ${JSON.stringify(steps)}`;
const read = { kind: "read", title: "Read README.md", path: "{{folder}}/README.md" };
const edit = { kind: "edit", title: "Edit notes.md", path: "{{folder}}/notes.md" };
const run = (command: string) => ({ kind: "execute", title: `Run ${command}`, command });

const roomComposer = (page: Page, room: string) => page.getByRole("textbox", { name: `Write in ${room}, @ tags an agent…` });
const answerSaying = (page: Page, text: string | RegExp) => page.locator(".room-timeline .room-entry").filter({ has: page.locator(".message.agent", { hasText: text }) });
const thread = (page: Page, agent: string) => page.getByRole("complementary", { name: `Thread of ${agent}` });
const roomStrip = (page: Page) => page.locator(".room-timeline ~ .room-approvals");
const threadStrip = (page: Page, agent: string) => thread(page, agent).locator(".room-approvals");
const subjectOf = (strip: Locator) => strip.locator(".room-approval-subject");
const detailOf = (strip: Locator) => strip.locator(".room-approval-detail");
const workingLine = (page: Page, text: string) => page.locator(".room-timeline > .room-thread-line", { hasText: text });
const answer = (strip: Locator, button: "Allow" | "Allow for this task" | "Deny") => strip.getByRole("button", { name: button, exact: true }).click();

const openNewRoom = (page: Page, room: string, agents: string[], preset?: string) => createRoom(page, room, agents, { preset });

/** Tags the agent from the @ menu, then writes the rest of the message after the tag. */
async function tag(page: Page, room: string, agent: string, rest: string) {
  await roomComposer(page, room).fill(`@${agent.slice(0, 2)}`);
  await page.getByRole("listbox", { name: "Agents and people of the room" }).getByRole("option", { name: `@${agent}` }).click();
  await roomComposer(page, room).fill(`@${agent} ${rest}`);
  await roomComposer(page, room).press("Enter");
}

test("each permission preset lets through by itself what it names, and asks for the rest", async ({ page }) => {
  await signIn(page, host);
  const strip = roomStrip(page);

  await test.step("asking for everything asks before a read, an edit and a command", async () => {
    await openNewRoom(page, "Careful", ["Builder"], "Ask for everything");
    await tag(page, "Careful", "Builder", ask([read, edit, run("ls")]));
    await expect(subjectOf(strip)).toHaveText("Permission needed: Read README.md");
    await answer(strip, "Allow");
    await expect(subjectOf(strip)).toHaveText("Permission needed: Edit notes.md");
    await answer(strip, "Allow");
    await expect(detailOf(strip)).toHaveText("ls");
    await answer(strip, "Allow");
    await expect(answerSaying(page, "Read README.md: allow; Edit notes.md: allow; Run ls: allow")).toHaveCount(1);
    await expect(strip).toHaveCount(0);
  });

  await test.step("free reading reads without asking, and asks before an edit and a command", async () => {
    await openNewRoom(page, "Reading", ["Builder"]);
    await tag(page, "Reading", "Builder", ask([read, edit, run("ls")]));
    await expect(subjectOf(strip)).toHaveText("Permission needed: Edit notes.md");
    await answer(strip, "Allow");
    await expect(detailOf(strip)).toHaveText("ls");
    await answer(strip, "Deny");
    await expect(answerSaying(page, "Read README.md: allow; Edit notes.md: allow; Run ls: reject")).toHaveCount(1);
  });

  await test.step("working freely reads and edits inside the workspace without asking, and asks before a command and an edit outside it", async () => {
    await openNewRoom(page, "Free", ["Builder"], "Work freely inside the workspace");
    const outside = { kind: "edit", title: "Edit outside.md", path: join(host.root, "outside.md") };
    await tag(page, "Free", "Builder", ask([read, edit, run("ls"), outside]));
    await expect(detailOf(strip)).toHaveText("ls");
    await answer(strip, "Allow");
    await expect(subjectOf(strip)).toHaveText("Permission needed: Edit outside.md");
    await answer(strip, "Deny");
    await expect(answerSaying(page, "Read README.md: allow; Edit notes.md: allow; Run ls: allow; Edit outside.md: reject")).toHaveCount(1);
  });

  await test.step("a changed preset holds from the agent's next request on", async () => {
    const dialog = await openRoomSettings(page, "Free", "Permissions");
    await expect(dialog.getByLabel("Work freely inside the workspace")).toBeChecked();
    await dialog.getByLabel("Ask for everything").check();
    await dialog.getByRole("button", { name: "Done" }).click();
    await tag(page, "Free", "Builder", ask([read]));
    await expect(subjectOf(strip)).toHaveText("Permission needed: Read README.md");
    await answer(strip, "Allow");
    await expect(answerSaying(page, /^Read README\.md: allow$/)).toHaveCount(1);
  });

  await test.step("never asking lets a command and an edit outside the workspace through without asking", async () => {
    const dialog = await openRoomSettings(page, "Free", "Permissions");
    await dialog.getByLabel("Never ask, anywhere on this computer").check();
    const meaning = dialog.locator(".room-permissions-field + .what-it-means");
    await meaning.getByText("What does this mean?").click();
    await expect(meaning).toContainText("Through the agents, people here can do anything you can on this computer");
    await dialog.getByRole("button", { name: "Done" }).click();
    const outside = { kind: "edit", title: "Edit anywhere.md", path: join(host.root, "anywhere.md") };
    await tag(page, "Free", "Builder", ask([read, run("git rebase origin/main"), outside]));
    await expect(answerSaying(page, "Read README.md: allow; Run git rebase origin/main: allow; Edit anywhere.md: allow")).toHaveCount(1);
    await expect(strip).toHaveCount(0);
  });
});

test("the strip names the agent, its request and whose task it is, and allowing for the task lets the same command through until the turn ends", async ({ page }) => {
  await signIn(page, host);
  await openNewRoom(page, "Tasks", ["Builder"]);
  const strip = roomStrip(page);
  const message = ask([run("ls"), run("ls"), run("pwd")]);
  await tag(page, "Tasks", "Builder", message);

  await expect(strip.locator(".room-approval-asker")).toHaveText("Builder asks");
  await expect(subjectOf(strip)).toHaveText("Permission needed: run a shell command");
  await expect(detailOf(strip)).toHaveText("ls");
  await expect(strip.locator(".room-approval-task")).toHaveText(`Your task: “${`@Builder ${message}`.slice(0, 80)}…”`);
  await expect(workingLine(page, "Builder is waiting for approval…")).toBeVisible();

  await answer(strip, "Allow for this task");
  await expect(detailOf(strip)).toHaveText("pwd");
  await answer(strip, "Allow");
  await expect(answerSaying(page, "Run ls: allow; Run ls: allow; Run pwd: allow")).toHaveCount(1);
  await expect(strip).toHaveCount(0);

  await tag(page, "Tasks", "Builder", ask([run("ls")]));
  await expect(detailOf(strip)).toHaveText("ls");
  await answer(strip, "Deny");
  await expect(answerSaying(page, "Run ls: reject")).toHaveCount(1);
});

test("two agents' requests queue oldest first, the room and the sidebar say what it waits for, and answering in the thread clears the strip", async ({ page }) => {
  await signIn(page, host);
  await openNewRoom(page, "Queue", ["Builder", "Reviewer"]);
  const strip = roomStrip(page);
  await tag(page, "Queue", "Builder", ask([edit]));
  await expect(strip.locator(".room-approval-asker")).toHaveText("Builder asks");
  await tag(page, "Queue", "Reviewer", ask([run("ls")]));

  await expect(strip.locator(".room-approval-count")).toHaveText("1 of 2");
  await expect(strip.locator(".room-approval-asker")).toHaveText("Builder asks");
  await expect(workingLine(page, "Builder is waiting for approval…")).toBeVisible();
  await expect(workingLine(page, "Reviewer is waiting for approval…")).toBeVisible();
  await expect(roomCard(page, "Queue")).toHaveAttribute("data-waiting-tone", "decision");
  await expect(roomCard(page, "Queue").locator(".waiting-pill")).toHaveText("Needs you");
  await expect(roomCard(page, "Queue").locator(".waiting-pill")).toHaveAttribute("data-hint", "Needs you: an agent waits for your answer, or someone's task for your OK.");

  await workingLine(page, "Builder is waiting for approval…").getByRole("button", { name: "Open thread" }).click();
  await expect(threadStrip(page, "Builder").locator(".room-approval-asker")).toHaveText("Builder asks");
  await expect(threadStrip(page, "Builder").locator(".room-approval-count")).toHaveCount(0);
  const card = thread(page, "Builder").locator(".permission.pending");
  await expect(card.locator(".permission-title")).toHaveText("Permission needed: Edit notes.md");
  await card.getByRole("button", { name: "Allow", exact: true }).click();

  await expect(threadStrip(page, "Builder")).toHaveCount(0);
  await expect(strip.locator(".room-approval-asker")).toHaveText("Reviewer asks");
  await expect(strip.locator(".room-approval-count")).toHaveCount(0);
  await expect(answerSaying(page, "Edit notes.md: allow")).toHaveCount(1);
  await workingLine(page, "Reviewer is waiting for approval…").getByRole("button", { name: "Open thread" }).click();
  const reviewerCard = thread(page, "Reviewer").locator(".permission");
  await expect(reviewerCard).toHaveClass(/pending/);
  await answer(strip, "Deny");
  await expect(strip).toHaveCount(0);
  await expect(reviewerCard).toHaveClass(/resolved/);
  await expect(reviewerCard.locator(".permission-outcome")).toHaveText("Reject");
  await expect(answerSaying(page, "Run ls: reject")).toHaveCount(1);
  await expect(roomCard(page, "Queue")).not.toHaveClass(/waiting/);
  await expect(roomCard(page, "Queue").locator(".waiting-pill")).toHaveCount(0);
});

test("an agent whose profile is set to YOLO still asks in a room", async ({ page }) => {
  await signIn(page, host);
  await openNewRoom(page, "Daring", ["Daredevil"]);
  await tag(page, "Daring", "Daredevil", ask([run("ls")]));
  await expect(roomStrip(page).locator(".room-approval-asker")).toHaveText("Daredevil asks");
  await answer(roomStrip(page), "Allow");
  await expect(answerSaying(page, "Run ls: allow")).toHaveCount(1);
});

test("a request waiting and a finished answer to your message notify while you look elsewhere, and open the room", async ({ page }) => {
  await allowNotifications(page);
  await signIn(page, host);
  await openNewRoom(page, "Away", ["Builder"]);
  const awayRoom = new URL(page.url()).hash;
  expect(awayRoom).toMatch(/^#\/r\/.+/);
  const bodies = async () => (await notificationsShown(page)).map(({ body }) => body);

  await test.step("a request waiting", async () => {
    const go = join(host.root, "away-go");
    await tag(page, "Away", "Builder", ask([{ waitFor: go }, run("ls")]));
    await openNewRoom(page, "Elsewhere", ["Reviewer"]);
    writeFileSync(go, "");
    await expect.poll(bodies).toEqual(["project · Wants permission: Run ls"]);
    expect((await notificationsShown(page))[0]!.title).toBe("Away: Builder");
    await clickNotification(page, "project · Wants permission: Run ls");
    await expect(page).toHaveURL(new RegExp(`${awayRoom}$`));
    await answer(roomStrip(page), "Allow");
    await expect(answerSaying(page, "Run ls: allow")).toHaveCount(1);
    await page.waitForTimeout(1_000);
    expect(await bodies()).toEqual(["project · Wants permission: Run ls"]);
  });

  await test.step("an answer finished", async () => {
    const finish = join(host.root, "away-finish");
    await tag(page, "Away", "Builder", ask([{ waitFor: finish }]));
    await roomCard(page, "Elsewhere").click();
    await expect(page.getByRole("heading", { name: "# Elsewhere" })).toBeVisible();
    writeFileSync(finish, "");
    await expect.poll(bodies).toContain("project · Finished, waiting for you");
    await clickNotification(page, "project · Finished, waiting for you");
    await expect(page).toHaveURL(new RegExp(`${awayRoom}$`));
    await expect(answerSaying(page, "Done.")).toHaveCount(1);
  });

  await test.step("a page loaded on the room's agent's conversation, as the desktop app opens a notification, shows the room", async () => {
    const builderInRoom = (await notificationsShown(page))[0]!.tag;
    await page.goto("about:blank");
    await page.goto(`${host.origin}/#/c/${builderInRoom}`);
    await expect(page.getByRole("heading", { name: "# Away" })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${awayRoom}$`));
  });
});

test("a member's task waits until the owner, told who asks and as what, allows it or declines it, unless people's tasks start without asking", async ({ page, browser }) => {
  const mia = host.admitPerson("Mia");
  await allowNotifications(page);
  await signIn(page, host);
  await openNewRoom(page, "People", ["Builder"]);
  const settings = page.getByRole("dialog", { name: "Room settings" });
  const openSettings = () => openRoomSettings(page, "People");
  const addMia = () => settings.getByRole("combobox", { name: "Add someone you let in before" }).selectOption({ label: "Mia" });
  await openSettings();
  await settings.locator(".room-tab-panel").getByText("What does this mean?").click();
  await expect(settings.locator(".room-people-reach")).toHaveText(
    "Through the agents, people here read the workspace's files and reach what else you allow: edits and commands ask you first. Everyone in the room reads the agents' answers, so whatever an agent reads, they can read too. Some agents go further without asking: Claude Code reads its workspace, Codex reads any file on this computer, pi and opencode may ask nothing, and your own agent settings can allow commands.",
  );
  await expect(settings.getByLabel("People's tasks start without asking me")).not.toBeChecked();
  await addMia();
  await expect(settings.getByLabel("Role of Mia")).toHaveValue("member");
  await settings.getByRole("button", { name: "Done" }).click();
  await expect(settings).toBeHidden();
  await openNewRoom(page, "Lookout", ["Reviewer"]);
  await openRoomSettings(page, "Lookout");
  await addMia();
  await settings.getByLabel("Role of Mia").selectOption({ label: "Guest" });
  await settings.getByRole("button", { name: "Done" }).click();
  await expect(settings).toBeHidden();

  const miaContext = await browser.newContext();
  await miaContext.addCookies([mia.cookie]);
  const miaPage = await miaContext.newPage();
  await miaPage.goto(host.origin);
  await roomCard(miaPage, "People").click();
  const strip = roomStrip(page);
  const builderPrompts = () => readFileSync(join(host.root, "Builder-prompts"), "utf8");
  const miasTask = "@Builder Build the page\n\n\nSAY Done for Mia";

  await test.step("Mia's tag waits, and the owner is told who asks, as what, for what, and what goes to the agent with it", async () => {
    await roomCard(page, "People").click();
    await roomComposer(page, "People").fill("Lunch at noon");
    await roomComposer(page, "People").press("Enter");
    await expect(page.locator(".room-timeline .room-entry", { hasText: "Lunch at noon" })).toHaveCount(1);
    await roomCard(page, "Lookout").click();
    await tag(miaPage, "People", "Builder", "Build the page\n\n\n\n\n\nSAY Done for Mia");
    await expect(workingLine(miaPage, "Builder starts once this task is allowed.")).toBeVisible();
    await expect.poll(async () => (await notificationsShown(page)).map(({ body }) => body)).toEqual(["project · Wants permission: a task of Mia, member"]);
    await expect(roomCard(page, "People")).toHaveAttribute("data-waiting-tone", "decision");
    await expect(roomCard(page, "People").locator(".waiting-pill")).toHaveText("Needs you");
    await roomCard(page, "People").click();
    await expect(strip.locator(".room-approval-asker")).toHaveText("Mia (Member) gives Builder a task");
    await expect(strip.locator(".room-approval-task-text")).toHaveText(miasTask);
    await expect(strip.locator(".room-approval-task-lines")).toHaveText("4 lines");
    await strip.getByRole("button", { name: "Show all" }).click();
    await expect(strip.locator(".room-approval-task-text.whole")).toHaveText(miasTask);
    await expect(strip.getByRole("button", { name: "Show less" })).toHaveAttribute("aria-expanded", "true");
    await expect(strip.locator(".room-approval-sent-along > div").first()).toHaveText("1 other unread message goes to the agents with it. Show them");
    await strip.getByRole("button", { name: "Show them" }).click();
    const riding = strip.locator(".room-approval-sent-along-list li");
    await expect(riding).toHaveCount(1);
    await expect(riding.locator(".room-role-label")).toHaveText("Owner");
    await expect(riding.locator(".room-approval-sent-along-text")).toHaveText("Lunch at noon");
    await expect(page.locator(".room-timeline .room-entry", { hasText: "Build the page" }).locator(".room-role-label")).toHaveText("Member");
    await expect(workingLine(page, "Builder starts once this task is allowed.")).toBeVisible();
    expect(builderPrompts()).not.toContain("Done for Mia");
  });

  await test.step("allowed, the task starts, and its answer reaches both", async () => {
    await answer(strip, "Allow");
    await expect(answerSaying(page, "Done for Mia")).toHaveCount(1);
    await expect(answerSaying(miaPage, "Done for Mia")).toHaveCount(1);
    await expect(strip).toHaveCount(0);
    await expect(roomCard(page, "People").locator(".waiting-pill")).toHaveCount(0);
    expect(builderPrompts()).toContain("> Lunch at noon");
  });

  await test.step("declined, the room says so and the agent is sent nothing", async () => {
    await tag(miaPage, "People", "Builder", "SAY Never sent");
    await expect(strip.locator(".room-approval-task-text")).toHaveText("@Builder SAY Never sent");
    await expect(strip.locator(".room-approval-task-lines")).toHaveText("1 line");
    await expect(strip.locator(".room-approval-sent-along")).toHaveCount(0);
    await answer(strip, "Deny");
    for (const each of [page, miaPage]) await expect(each.locator(".room-timeline .notice-line", { hasText: "The task was declined." })).toHaveCount(1);
    await expect(strip).toHaveCount(0);
    expect(builderPrompts()).not.toContain("Never sent");
  });

  await test.step("taken out of the room, though not out of every room, Mia's waiting task is declined at once", async () => {
    await tag(miaPage, "People", "Builder", "SAY Left behind");
    await expect(strip.locator(".room-approval-task-text")).toHaveText("@Builder SAY Left behind");
    await openSettings();
    await settings.getByRole("button", { name: "Remove Mia" }).click();
    await settings.getByRole("button", { name: "Confirm: Remove Mia" }).click();
    await settings.getByRole("button", { name: "Done" }).click();
    await expect(settings).toBeHidden();
    await expect(page.locator(".room-timeline .notice-line", { hasText: "The task was declined." })).toHaveCount(2);
    await expect(strip).toHaveCount(0);
    expect(builderPrompts()).not.toContain("Left behind");
    await openSettings();
    await addMia();
    await settings.getByRole("button", { name: "Done" }).click();
    await expect(settings).toBeHidden();
    await roomCard(miaPage, "People").click();
  });

  await test.step("once people's tasks start without asking, Mia's tag starts at once", async () => {
    await openSettings();
    await settings.getByLabel("People's tasks start without asking me").check();
    await settings.getByRole("button", { name: "Done" }).click();
    await expect(settings).toBeHidden();
    await tag(miaPage, "People", "Builder", "SAY Straight away");
    await expect(answerSaying(miaPage, "Straight away")).toHaveCount(1);
    await expect(strip).toHaveCount(0);
    await openSettings();
    await expect(settings.getByLabel("People's tasks start without asking me")).toBeChecked();
  });

  await miaContext.close();
});
