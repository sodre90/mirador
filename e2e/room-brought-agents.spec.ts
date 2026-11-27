import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, createProfile, createRoom, inviteIntoRoom, joinRoom, nameMachine, nameOwnProfile, openRoomSettings, primaryModifier, reachedAtOwnPort, reloadFromRestartedHost, roomCard, signIn, whatItMeans } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

test.describe.configure({ mode: "serial" });

/** Ann's machine, with the room and her own Builder in it. */
const owners = new TestHost({ environment: reachedAtOwnPort, fakePrograms: true });
/** Mia's own Mirador, which joins Ann's room and brings an agent of hers into it. */
const mias = new TestHost({ fakePrograms: true });
const coderPrompts = () => join(mias.root, "coder-prompts");
const builderPrompts = () => join(owners.root, "builder-prompts");
/** Where the spec leaves its screenshots of the bring dialog, the room and the OK card, when asked to. */
const screenshotsDir = process.env.ROOMS_BROUGHT_SCREENSHOTS;

let ann: Page;
let mia: Page;

test.beforeAll(async ({ browser }) => {
  writeBunProgram(mias.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"));
  writeBunProgram(owners.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"));
  writeFileSync(coderPrompts(), "");
  writeFileSync(builderPrompts(), "");
  await Promise.all([owners.start(), mias.start()]);
  if (screenshotsDir) mkdirSync(screenshotsDir, { recursive: true });
  ann = await browser.newPage();
  mia = await browser.newPage();
});
test.afterAll(async () => {
  await Promise.all([owners.stop(), mias.stop()]);
  await Promise.all([owners.cleanUp(), mias.cleanUp()]);
});

const screenshot = async (page: Page, name: string) => {
  if (screenshotsDir) await page.screenshot({ path: join(screenshotsDir, `${name}.png`) });
};

const composer = (page: Page) => page.getByRole("textbox", { name: "Write in Garden, @ tags an agent…" });
const agentChip = (page: Page) => page.locator(".room-header .agent-chip", { hasText: "Coder (Mia)" });
const answersOfCoder = (page: Page) => page.locator(".room-timeline .room-entry").filter({ has: page.locator(".author", { hasText: "Coder (Mia)" }) });
const joinedCard = (page: Page) => roomCard(page, "Garden").and(page.locator(".joined-room"));
const coderConversation = (page: Page) => page.locator(".sidebar .conversation-title", { hasText: "Garden · Ann's machine" });
const invitedBar = (page: Page) => page.locator(".invited-room-bar");
const workToggle = (page: Page, agent = "Coder") => invitedBar(page).getByRole("button", { name: `Show the work of ${agent}` });
const workPanel = (page: Page, agent = "Coder") => page.getByRole("complementary", { name: `Work of ${agent}` });
const waitingStrip = (page: Page) => page.getByRole("region", { name: "What your agents wait for" });
const okCard = (page: Page) => waitingStrip(page).locator(".brought-task");
const taskCard = (page: Page) => page.locator(".room-task-approval");
const answersOfBuilder = (page: Page) => page.locator(".room-timeline .room-entry").filter({ has: page.locator(".author", { hasText: "Builder" }) });

/** Ann tags Mia's agent from the @ menu and gives it the rest. */
async function tagCoder(rest: string) {
  await composer(ann).fill("@Co");
  await ann.getByRole("listbox", { name: "Agents and people of the room" }).getByRole("option", { name: "@Coder (Mia)" }).click();
  await composer(ann).fill(`@Coder (Mia) ${rest}`);
  await composer(ann).press("Enter");
}

const bringCoder = (othersTasks: "Only after my OK" | "Any time") => chooseToBring("Coder", othersTasks);

async function chooseToBring(agent: string, othersTasks: "Only after my OK" | "Any time") {
  await joinedCard(mia).hover();
  await joinedCard(mia).getByRole("button", { name: "More for Garden" }).click();
  await mia.getByRole("menuitem", { name: "Bring an agent…" }).click();
  const dialog = mia.getByRole("dialog", { name: "Bring an agent into Garden" });
  await dialog.getByRole("combobox", { name: /^Agent/ }).selectOption({ label: agent });
  await dialog.getByRole("combobox", { name: /^Workspace/ }).selectOption({ label: basename(mias.projectDir) });
  await dialog.getByLabel(othersTasks).check();
  return dialog;
}

test("Mia brings an agent of hers into Ann's room: Ann's tasks for it wait for Mia's OK, and its answer comes into the room", async () => {
  await signIn(ann, owners);
  await nameOwnProfile(ann, "Ann");
  await addWorkspace(ann, owners.projectDir);
  await nameMachine(ann, "Ann's machine");
  const builder = await createProfile(ann, "Builder", `OPENCODE_FAKE_ACP_PROMPTS=${builderPrompts()}`, "", "opencode");
  await builder.getByRole("button", { name: "Close" }).click();
  await createRoom(ann, "Garden", ["Builder"]);
  const invite = await inviteIntoRoom(ann, "Garden", { role: "Member" });

  await signIn(mia, mias);
  await nameOwnProfile(mia, "Mia");
  await addWorkspace(mia, mias.projectDir);
  const profiles = await createProfile(mia, "Coder", `OPENCODE_FAKE_ACP_PROMPTS=${coderPrompts()}\nFAKE_ACP_MODES=1`, "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await expect(await joinRoom(mia, invite)).toHaveCount(0);

  await test.step("Mia brings her Coder from her own Mirador, only after her OK for others' tasks", async () => {
    const dialog = await bringCoder("Only after my OK");
    await expect(dialog.getByLabel("Only after my OK")).toBeChecked();
    await expect(dialog).toContainText("The room sees it by this profile's name, followed by yours in parentheses.");
    const meaning = (await whatItMeans(mia, dialog)).join("\n");
    expect(meaning).toContain("reading files in that workspace usually goes ahead without asking");
    expect(meaning).toContain("Its owner could pass a task off as yours");
    await screenshot(mia, "bring-dialog");
    await dialog.getByRole("button", { name: "Bring", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(joinedCard(mia)).toContainText(`Coder (${basename(mias.projectDir)})`);
  });

  await test.step("Mia's own Mirador lists no conversation of it: the line above the room holds it, with nothing to write to it but the room", async () => {
    await joinedCard(mia).click();
    await expect(workToggle(mia)).toBeVisible();
    await expect(coderConversation(mia)).toHaveCount(0);
    await workToggle(mia).click();
    await expect(workToggle(mia)).toHaveAttribute("aria-pressed", "true");
    await expect(workPanel(mia)).toContainText("It has not worked on a task yet.");
    await expect(workPanel(mia)).toContainText("To give it a task, tag it in the room.");
    await expect(workPanel(mia).getByRole("textbox")).toHaveCount(0);
    await workPanel(mia).getByRole("button", { name: "Close its work" }).click();
    await expect(workPanel(mia)).toHaveCount(0);
  });

  await test.step("Ann's room shows it as Mia's, running on her computer, and Ann's @ menu offers it", async () => {
    await roomCard(ann, "Garden").click();
    await expect(agentChip(ann)).toBeVisible();
    await expect(agentChip(ann)).not.toHaveClass(/\baway\b/);
    await expect(agentChip(ann)).toHaveAttribute("data-workspace-scope", "own");
    await expect(agentChip(ann)).toHaveAttribute("data-hint", "On Mia's computer · Works in Mia's workspace");
    await expect(invitedBar(mia).locator('.workspace-scope-pill[data-workspace-scope="own"]')).toHaveText(basename(mias.projectDir));
  });

  await test.step("Ann's list of who is here shows it as Mia's, and fits it without scrolling sideways", async () => {
    await ann.locator(".room-here-count").click();
    const popover = ann.locator(".room-people");
    await expect(popover).toContainText("Coder (Mia)");
    await expect(popover.locator(".room-agent-brought")).toBeVisible();
    await expect(popover.locator(".room-people-agent-workspace")).toHaveText("Works in Mia's workspace");
    expect(await popover.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await screenshot(ann, "people-here-with-brought-agent");
    await ann.keyboard.press("Escape");
    await expect(popover).toHaveCount(0);
  });

  await test.step("Ann's task waits on Mia's Mirador as a card with who wrote it, in what role, where, and all of it", async () => {
    await tagCoder("SAY Weeded the beds");
    await expect(joinedCard(mia)).toHaveClass(/\bwaiting\b/);
    await expect(workToggle(mia)).toHaveClass(/\bwaits\b/);
    await expect(okCard(mia)).toContainText("Ann (Owner) gives this agent a task in Garden on Ann's machine");
    await expect(okCard(mia).locator(".brought-task-text")).toContainText("@Coder (Mia) SAY Weeded the beds");
    await screenshot(mia, "ok-card");
    expect(readFileSync(coderPrompts(), "utf8")).not.toContain("Weeded");
    await expect(ann.locator(".room-timeline")).toContainText("Coder (Mia) has not started on it yet.");
  });

  await test.step("allowed, the task goes to Mia's agent, whose answer comes into the room as its message", async () => {
    await okCard(mia).getByRole("button", { name: "Allow" }).click();
    await expect(okCard(mia)).toHaveCount(0);
    await expect(answersOfCoder(ann).locator(".message.agent")).toHaveText("Weeded the beds");
    await expect(answersOfCoder(ann).locator('.author .workspace-scope-pill[data-workspace-scope="own"]')).toHaveText("Mia's workspace");
    expect(readFileSync(coderPrompts(), "utf8")).toContain('A task from the room "Garden" on Ann\'s machine');
    await screenshot(ann, "room-with-brought-agent");
    await expect(joinedCard(mia)).not.toHaveClass(/\bwaiting\b/);
  });

  await test.step("its work beside the room shows the task in short, all it was sent on asking, and what it answered", async () => {
    await workToggle(mia).click();
    const task = workPanel(mia).locator(".brought-task-sent");
    await expect(task.locator(".brought-task-sent-asked")).toHaveText("Task from the room@Coder (Mia) SAY Weeded the beds");
    await expect(task.getByText("You are an attendee of the room")).toBeHidden();
    await task.getByText("All it was sent").click();
    await expect(task.getByText("You are an attendee of the room")).toBeVisible();
    await expect(workPanel(mia).locator(".message.agent")).toHaveText("Weeded the beds");
    await screenshot(mia, "brought-agent-work");
    await workToggle(mia).click();
    await expect(workPanel(mia)).toHaveCount(0);
  });

  await test.step("opening her brought agent's thread inside the room offers a one-click jump to that task in Its work, and Ann does not see it", async () => {
    const miasRoom = mia.frameLocator(".invited-room .machine-frame.shown");
    const miasAnswer = miasRoom.locator(".room-timeline .room-entry").filter({ hasText: "Weeded the beds" }).last();
    const frameWidthBefore = await mia.locator(".invited-room .machine-frame.shown").evaluate((element) => element.getBoundingClientRect().width);
    await miasAnswer.getByRole("button", { name: "Show in Its work" }).click();
    await expect(workPanel(mia)).toBeVisible();
    await expect(workPanel(mia).locator(".brought-task-sent.jumped")).toContainText("Weeded the beds");
    const frameWidthWithDrawer = await mia.locator(".invited-room .machine-frame.shown").evaluate((element) => element.getBoundingClientRect().width);
    expect(Math.abs(frameWidthWithDrawer - frameWidthBefore)).toBeLessThan(2);

    const splitter = workPanel(mia).getByRole("separator", { name: "Resize the side panel" });
    const widthBeforeDrag = (await workPanel(mia).boundingBox())!.width;
    const handle = (await splitter.boundingBox())!;
    await mia.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await mia.mouse.down();
    await mia.mouse.move(handle.x + handle.width / 2 - 180, handle.y + handle.height / 2, { steps: 6 });
    await mia.mouse.up();
    const widthAfterDrag = (await workPanel(mia).boundingBox())!.width;
    expect(widthAfterDrag).toBeGreaterThan(widthBeforeDrag + 150);
    const frameWidthAfterDrag = await mia.locator(".invited-room .machine-frame.shown").evaluate((element) => element.getBoundingClientRect().width);
    expect(Math.abs(frameWidthAfterDrag - frameWidthBefore)).toBeLessThan(2);

    await mia.keyboard.press("Escape");
    await expect(workPanel(mia)).toHaveCount(0);
    await workToggle(mia).click();
    await expect(workPanel(mia)).toBeVisible();
    expect(Math.abs((await workPanel(mia).boundingBox())!.width - widthAfterDrag)).toBeLessThan(2);

    await splitter.dblclick();
    expect(Math.abs((await workPanel(mia).boundingBox())!.width - widthBeforeDrag)).toBeLessThan(2);

    await mia.keyboard.press("Escape");
    await expect(workPanel(mia)).toHaveCount(0);

    await miasAnswer.getByRole("button", { name: "Open thread" }).click();
    const miasThread = miasRoom.locator(".room-thread");
    await expect(miasThread.locator(".workspace-access")).toHaveAttribute("data-workspace-scope", "own");
    await expect(miasThread).toContainText("Its steps stay on your computer.");
    await miasThread.getByRole("button", { name: "Show in Its work" }).click();
    await expect(workPanel(mia)).toBeVisible();
    await expect(workPanel(mia).locator(".brought-task-sent.jumped")).toContainText("Weeded the beds");
    await workPanel(mia).getByRole("button", { name: "Close its work" }).click();
    await expect(workPanel(mia)).toHaveCount(0);
    await miasThread.getByRole("button", { name: "Close thread" }).click();

    await miasRoom.locator(".room-header .agent-chip", { hasText: "Coder (Mia)" }).getByRole("button").click();
    const card = miasRoom.getByRole("dialog", { name: "Coder (Mia)" });
    await expect(card).toContainText("On Mia's computer");
    await expect(card).toContainText("Works in Mia's workspace");
    await card.getByRole("button", { name: "Show in Its work" }).click();
    await expect(workPanel(mia)).toBeVisible();
    await workPanel(mia).getByRole("button", { name: "Close its work" }).click();
    await expect(workPanel(mia)).toHaveCount(0);

    await expect(answersOfCoder(ann).last().getByRole("button", { name: "Show in Its work" })).toHaveCount(0);
    await answersOfCoder(ann).last().getByRole("button", { name: "Open thread" }).click();
    await expect(ann.locator(".room-thread").getByRole("button", { name: "Show in Its work" })).toHaveCount(0);
    await ann.locator(".room-thread").getByRole("button", { name: "Close thread" }).click();
  });

  await test.step("its model and effort are chosen from the line above the room, and nothing a room's agent may not change is offered", async () => {
    await invitedBar(mia).locator(".conversation-settings-toggle").click();
    const settings = mia.getByRole("dialog", { name: "Settings of Coder" });
    await expect(settings.getByLabel("Effort", { exact: true })).toHaveValue("low");
    await settings.getByLabel("Effort", { exact: true }).selectOption("high");
    await expect(settings.getByLabel("Effort", { exact: true })).toHaveValue("high");
    await expect(settings.getByLabel("Questions", { exact: true })).toHaveCount(0);
    await expect(settings.getByLabel("Profile", { exact: true })).toHaveCount(0);
    await mia.keyboard.press("Escape");
    await expect(settings).toHaveCount(0);
  });

  await test.step("denied, the room says Mia's Mirador did not take the task", async () => {
    await tagCoder("SAY Planted the peas");
    await expect(okCard(mia)).toBeVisible();
    await okCard(mia).getByRole("button", { name: "Deny" }).click();
    await expect(answersOfCoder(ann).last()).toContainText("Its bringer's Mirador did not take the task.");
  });
});

test("brought to take others' tasks any time, the agent answers without a card; taken out, it leaves the room", async () => {
  await test.step("Mia takes her Coder out from the room's card on her own Mirador", async () => {
    await joinedCard(mia).hover();
    await joinedCard(mia).getByRole("button", { name: "More for Garden" }).click();
    const takeOut = mia.getByRole("menuitem", { name: "Take out Coder" });
    await takeOut.click();
    await expect(takeOut).toHaveText("Take out for good?");
    await expect(agentChip(ann)).toHaveCount(1);
    await mia.getByRole("menuitem", { name: "Confirm: Take out Coder" }).click();
    await expect(agentChip(ann)).toHaveCount(0);
  });

  await test.step("brought again for any time, Ann's task reaches it at once", async () => {
    const dialog = await bringCoder("Any time");
    await dialog.getByRole("button", { name: "Bring", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(agentChip(ann)).toBeVisible();
    await tagCoder("SAY Watered the beans");
    await expect(answersOfCoder(ann).locator(".message.agent").last()).toHaveText("Watered the beans");
    await expect(okCard(mia)).toHaveCount(0);
  });

  await test.step("its answer to Ann's own task marks its tag of her, in the room and in its thread, without standing out for her", async () => {
    await tagCoder("SAY @Ann the beans are up");
    const answer = answersOfCoder(ann).last();
    await expect(answer.locator(".room-mention.you")).toHaveText("@Ann");
    await expect(answer).not.toHaveClass(/\btags-you\b/);
    await expect(answer).toHaveClass(/\bagent-opencode\b/);
    await answer.getByRole("button", { name: "Open thread" }).click();
    const inThread = ann.locator(".room-thread .room-entry").filter({ has: ann.locator(".message.agent", { hasText: "the beans are up" }) });
    await expect(inThread.locator(".room-mention.you")).toHaveText("@Ann");
    await expect(inThread).not.toHaveClass(/\btags-you\b/);
    await expect(inThread).toHaveClass(/\bagent-opencode\b/);
    await ann.locator(".room-thread").getByRole("button", { name: "Close thread" }).click();
  });

  await test.step("a command it would run waits under the line above the room, where Mia allows it without leaving the room", async () => {
    await joinedCard(mia).click();
    await tagCoder('ASK [{"kind":"execute","title":"Run ls","command":"ls"}]');
    const asked = waitingStrip(mia).locator(".permission.pending");
    await expect(asked).toContainText("Permission needed: run a shell command");
    await expect(asked.locator(".shell-body")).toContainText("ls");
    await expect(joinedCard(mia)).toHaveClass(/\bwaiting\b/);
    await expect(workToggle(mia)).toHaveClass(/\bwaits\b/);
    await asked.getByRole("button", { name: "Allow", exact: true }).click();
    await expect(answersOfCoder(ann).locator(".message.agent").last()).toHaveText("Run ls: allow");
    await expect(waitingStrip(mia)).toBeHidden();
    await expect(joinedCard(mia)).not.toHaveClass(/\bwaiting\b/);
    await expect(workToggle(mia)).not.toHaveClass(/\bwaits\b/);
  });

  await test.step("its answer tagging Ann's Builder waits for Ann's OK as Mia's task, given by her agent, and reaches Builder once allowed", async () => {
    await tagCoder("SAY @Builder please check the beans");
    await expect(taskCard(ann)).toContainText("Coder (Mia) gives Builder a task on behalf of Mia (Member)");
    await expect(taskCard(ann)).toContainText("@Builder please check the beans");
    await expect(answersOfBuilder(ann)).toHaveCount(0);
    await screenshot(ann, "task-of-brought-agent");
    await taskCard(ann).getByRole("button", { name: "Allow" }).click();
    await expect(taskCard(ann)).toHaveCount(0);
    await expect(answersOfBuilder(ann).locator(".message.agent")).toHaveText("Noted.");
    expect(readFileSync(builderPrompts(), "utf8")).toContain("[member's agent] Coder (Mia)");
  });

  await test.step("Ann lets no member bring agents: Mia's leaves, and her next bringing is refused until Ann lets them again", async () => {
    const membersBring = async (allowed: boolean) => {
      const settings = await openRoomSettings(ann, "Garden", "Agents");
      await settings.getByRole("switch", { name: "Members may bring agents of their own" }).setChecked(allowed);
      await settings.getByRole("button", { name: "Close" }).click();
    };
    await membersBring(false);
    await expect(agentChip(ann)).toHaveCount(0);
    const refused = await bringCoder("Any time");
    await refused.getByRole("button", { name: "Bring", exact: true }).click();
    await expect(refused).toContainText("Only members of the room bring agents into it, and only while its owner lets them.");
    await refused.getByRole("button", { name: "Cancel" }).click();
    await membersBring(true);
    const dialog = await bringCoder("Any time");
    await dialog.getByRole("button", { name: "Bring", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(agentChip(ann)).toBeVisible();
  });
});

test("every task Mia's Mirador took is answered, though she takes it out of the queue or her host restarts in the middle of it", async () => {
  const letGo = (name: string) => join(mias.root, name);
  const working = ann.locator(".room-timeline", { hasText: "Coder (Mia) is working…" });
  const timesStarted = () => mias.log.match(/Mirador is running/g)?.length ?? 0;

  await test.step("a queued task Mia removes reads as not taken in the room", async () => {
    await tagCoder(`WAIT ${letGo("leaves")} SAY Raked the leaves`);
    await expect(working).toBeVisible();
    await tagCoder("SAY Swept the path");
    await joinedCard(mia).click();
    await workToggle(mia).click();
    const queued = workPanel(mia).locator(".queued", { hasText: "Swept the path" });
    await queued.getByRole("button", { name: "Remove" }).click({ timeout: 15_000 });
    await expect(queued).toHaveCount(0);
    await expect(answersOfCoder(ann).last()).toContainText("Its bringer's Mirador did not take the task.");
  });

  await test.step("a task whose turn Mia's restart stops goes on after it, and its answer comes into the room", async () => {
    const startedBefore = timesStarted();
    await mia.keyboard.press(`${await primaryModifier(mia)}+Shift+R`);
    await expect.poll(timesStarted, { timeout: 60_000 }).toBe(startedBefore + 1);
    writeFileSync(letGo("leaves"), "");
    await expect(answersOfCoder(ann).last().locator(".message.agent")).toHaveText("Raked the leaves", { timeout: 60_000 });
    await expect(working).toHaveCount(0);
  });

  await test.step("a task whose turn Mia's host died in says it was stopped once that is back", async () => {
    await expect(agentChip(ann)).not.toHaveClass(/\baway\b/, { timeout: 60_000 });
    await tagCoder(`WAIT ${letGo("hedge")} SAY Trimmed the hedge`);
    await expect(working).toBeVisible();
    await mias.kill();
    await mias.start();
    await expect(answersOfCoder(ann).last()).toContainText("Stopped before it finished.", { timeout: 60_000 });
    await expect(working).toHaveCount(0);
    writeFileSync(letGo("hedge"), "");
    await reloadFromRestartedHost(mia);
  });
});

test("Mia's Builder beside Ann's: the name the @ menu put in tags the one it names, and a task Mia's Coder gives it says whose agent asks", async () => {
  const profiles = await createProfile(mia, "Builder", `OPENCODE_FAKE_ACP_PROMPTS=${join(mias.root, "builder-prompts")}`, "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  const dialog = await chooseToBring("Builder", "Only after my OK");
  await dialog.getByRole("button", { name: "Bring", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const miasBuilderChip = ann.locator(".room-header .agent-chip", { hasText: "Builder (Mia)" });
  await expect(miasBuilderChip).toBeVisible();
  const answersOfMiasBuilder = ann.locator(".room-timeline .room-entry").filter({ has: ann.locator(".author", { hasText: "Builder (Mia)" }) });
  const allowsHerBuilder = async (title: string) => {
    await joinedCard(mia).click();
    await expect(okCard(mia).locator(".permission-title")).toHaveText(title);
    await okCard(mia).getByRole("button", { name: "Allow" }).click();
    await expect(okCard(mia)).toHaveCount(0);
  };

  await test.step("a message whose tag of Ann's Builder gave way to one of Mia's reaches Mia's alone", async () => {
    await composer(ann).fill("@Bu");
    const menu = ann.getByRole("listbox", { name: "Agents and people of the room" });
    await menu.getByRole("option", { name: "@Builder", exact: true }).click();
    await composer(ann).fill("@Bu");
    const miasOption = menu.getByRole("option", { name: "@Builder (Mia)" });
    await expect(miasOption.locator('.workspace-scope-pill[data-workspace-scope="own"]')).toHaveText("Mia's workspace");
    await miasOption.click();
    await composer(ann).fill("@Builder (Mia) SAY Pruned the roses");
    await composer(ann).press("Enter");
    await allowsHerBuilder("Ann (Owner) gives this agent a task in Garden on Ann's machine");
    await expect(answersOfMiasBuilder.locator(".message.agent").last()).toHaveText("Pruned the roses");
    expect(readFileSync(builderPrompts(), "utf8")).not.toContain("Pruned the roses");
  });

  await test.step("Coder's answer tagging it waits on Mia's Mirador as a task of her own Coder", async () => {
    await tagCoder("SAY @Builder (Mia) please check the roses");
    await allowsHerBuilder("Coder (Mia), a member's agent, gives this agent a task in Garden on Ann's machine");
    await expect(answersOfMiasBuilder.locator(".message.agent").last()).toHaveText("Noted.");
    expect(readFileSync(builderPrompts(), "utf8")).not.toContain("check the roses");
  });

  await joinedCard(mia).hover();
  await joinedCard(mia).getByRole("button", { name: "More for Garden" }).click();
  await mia.getByRole("menuitem", { name: "Take out Builder" }).click();
  await mia.getByRole("menuitem", { name: "Confirm: Take out Builder" }).click();
  await expect(miasBuilderChip).toHaveCount(0);
});

test("a brought agent with a long name keeps its bringer visible when cut short and shows the full name on hover", async () => {
  const longName = "VeryLongBroughtAgentNameForNarrowHeaders";
  const fullName = `${longName} (Mia)`;
  const profiles = await createProfile(mia, longName, `OPENCODE_FAKE_ACP_PROMPTS=${join(mias.root, "long-prompts")}`, "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  const dialog = await chooseToBring(longName, "Any time");
  await dialog.getByRole("button", { name: "Bring", exact: true }).click();
  await expect(dialog).toHaveCount(0);

  const originalSize = ann.viewportSize()!;
  await ann.setViewportSize({ width: 760, height: 720 });
  const chip = ann.locator(".room-header .agent-chip", { hasText: fullName });
  await expect(chip).toBeVisible();
  const chipLabel = chip.locator(".room-agent-label");
  await expect(chip.locator(".room-agent-bringer")).toHaveText(" (Mia)");
  await expect.poll(() => chip.locator(".room-agent-base").evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  await expect.poll(() => chip.locator(".room-agent-bringer").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(chipLabel).toHaveAttribute("data-hint", new RegExp(longName));
  await expect(roomCard(ann, "Garden").locator(".room-card-subline")).toHaveAttribute("data-hint", new RegExp(longName));

  const settings = await openRoomSettings(ann, "Garden", "Agents");
  const rowName = settings.locator(".room-settings-row-name", { hasText: fullName });
  await expect(rowName.locator(".room-agent-bringer")).toHaveText(" (Mia)");
  await settings.getByRole("button", { name: "Close" }).click();

  await ann.setViewportSize(originalSize);
  await joinedCard(mia).hover();
  await joinedCard(mia).getByRole("button", { name: "More for Garden" }).click();
  await mia.getByRole("menuitem", { name: `Take out ${longName}` }).click();
  await mia.getByRole("menuitem", { name: `Confirm: Take out ${longName}` }).click();
  await expect(chip).toHaveCount(0);
});

test("a brought agent's canvas drawings and questions appear on the room's canvas for everyone and return confirmed answers", async () => {
  const miasRoom = mia.frameLocator(".invited-room .machine-frame.shown");

  await test.step("Coder draws a page, and both Ann and Mia see it on the room's canvas attributed to Coder (Mia)", async () => {
    const show = { title: "Friendly robot", html: "<p id='robot'>Waving hello</p>" };
    await tagCoder(`CANVAS show ${JSON.stringify(show)}`);
    const answer = answersOfCoder(ann).last();
    await expect(answer.locator(".room-canvas-line")).toContainText("On the canvas: 1 page");
    await expect(answer.locator(".room-canvas-title-chip")).toHaveText("Friendly robot");
    await expect(ann.locator(".canvas-panel:visible .canvas-author")).toContainText("Coder (Mia)");
    await expect(ann.frameLocator(".canvas-panel:visible .canvas-frame.show iframe").locator("#robot")).toHaveText("Waving hello");

    await expect(miasRoom.locator(".canvas-panel:visible .canvas-author")).toContainText("Coder (Mia)");
    await expect(miasRoom.frameLocator(".canvas-panel:visible .canvas-frame.show iframe").locator("#robot")).toHaveText("Waving hello");
  });

  await test.step("Coder asks a question on the room's canvas; everyone votes, Ann confirms, and Coder receives the confirmed answer", async () => {
    const question = "Which robot?";
    const ask = { question, options: [{ label: "Beep" }, { label: "Boop" }] };
    await tagCoder(`CANVAS ask ${JSON.stringify(ask)}`);
    const annVote = ann.getByRole("region", { name: question });
    const miaVote = miasRoom.getByRole("region", { name: question });
    await expect(annVote).toBeVisible();
    await expect(annVote.locator(".room-vote-asker")).toContainText("Coder (Mia) asks");
    await expect(miaVote).toBeVisible();
    await expect(ann.locator(".canvas-panel:visible .ask h3")).toHaveText(question);

    await miaVote.locator(".room-vote-option").filter({ has: miasRoom.getByRole("button", { name: "Boop", exact: true }) }).getByRole("button").click();
    await annVote.locator(".room-vote-option").filter({ has: ann.getByRole("button", { name: "Boop", exact: true }) }).getByRole("button").click();
    await expect(annVote.locator(".room-vote-option").filter({ has: ann.getByRole("button", { name: "Boop", exact: true }) }).locator(".room-vote-count")).toHaveText("2");
    await annVote.getByRole("button", { name: "Confirm: Boop" }).click();

    await expect(annVote.locator(".room-vote-status")).toHaveText("Ann confirmed: Boop");
    await expect(miaVote.locator(".room-vote-status")).toHaveText("Ann confirmed: Boop");
    await expect(answersOfCoder(ann).last().locator(".message.agent")).toContainText("The user chose: Boop");
  });
});

test("while Mia's Mirador is away, the room says so at once, and Ann takes the agent out", async () => {
  await mias.stop();
  await expect(agentChip(ann)).toHaveClass(/\baway\b/);
  await expect(agentChip(ann)).toHaveAttribute("data-hint", "Away: Mia's Mirador is not connected · Works in Mia's workspace");
  await tagCoder("SAY Picked the apples");
  await expect(answersOfCoder(ann).last()).toContainText("Its bringer's Mirador was not connected, so it did not get the task.");
  const settings = await openRoomSettings(ann, "Garden", "Agents");
  const brought = settings.getByRole("list", { name: "Agents people brought" });
  await expect(brought).toContainText("Away: Mia's Mirador is not connected");
  await expect(brought).toContainText("Works in Mia's workspace");
  await brought.getByRole("button", { name: "Take out Coder (Mia)" }).click();
  await brought.getByRole("button", { name: "Take out Coder (Mia)" }).click();
  await expect(brought).toHaveCount(0);
  await settings.getByRole("button", { name: "Close" }).click();
  await expect(agentChip(ann)).toHaveCount(0);
});
