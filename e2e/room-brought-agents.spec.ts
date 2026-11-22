import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, createProfile, createRoom, inviteIntoRoom, joinRoom, nameMachine, openRoomSettings, openSettings, reachedAtOwnPort, roomCard, signIn } from "./helpers.ts";
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

async function nameOwnProfile(page: Page, name: string) {
  const settings = await openSettings(page);
  await settings.getByLabel("Name", { exact: true }).fill(name);
  await settings.getByLabel("Name", { exact: true }).press("Enter");
  await settings.getByRole("button", { name: "Close" }).click();
}

const screenshot = async (page: Page, name: string) => {
  if (screenshotsDir) await page.screenshot({ path: join(screenshotsDir, `${name}.png`) });
};

const composer = (page: Page) => page.getByRole("textbox", { name: "Write in Garden, @ tags an agent…" });
const agentChip = (page: Page) => page.locator(".room-header .agent-chip", { hasText: "Mia's Coder" });
const answersOfCoder = (page: Page) => page.locator(".room-timeline .room-entry").filter({ has: page.locator(".author", { hasText: "Mia's Coder" }) });
const joinedCard = (page: Page) => roomCard(page, "Garden").and(page.locator(".joined-room"));
const coderConversation = (page: Page) => page.locator(".sidebar li").filter({ has: page.locator(".conversation-title", { hasText: "Garden · Ann's machine" }) });
const okCard = (page: Page) => page.locator(".brought-task:visible");
const taskCard = (page: Page) => page.locator(".room-task-approval");
const answersOfBuilder = (page: Page) => page.locator(".room-timeline .room-entry").filter({ has: page.locator(".author", { hasText: "Builder" }) });

/** Ann tags Mia's agent from the @ menu and gives it the rest. */
async function tagCoder(rest: string) {
  await composer(ann).fill("@Mi");
  await ann.getByRole("listbox", { name: "Agents and people of the room" }).getByRole("option", { name: "@Mia's Coder" }).click();
  await composer(ann).fill(`@Mia's Coder ${rest}`);
  await composer(ann).press("Enter");
}

async function bringCoder(othersTasks: "Only after my OK" | "Any time") {
  await joinedCard(mia).hover();
  await joinedCard(mia).getByRole("button", { name: "More for Garden" }).click();
  await mia.getByRole("menuitem", { name: "Bring an agent…" }).click();
  const dialog = mia.getByRole("dialog", { name: "Bring an agent into Garden" });
  await dialog.getByRole("combobox", { name: /^Agent/ }).selectOption({ label: "Coder" });
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
  const profiles = await createProfile(mia, "Coder", `OPENCODE_FAKE_ACP_PROMPTS=${coderPrompts()}`, "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await expect(await joinRoom(mia, invite)).toHaveCount(0);
  await mia.getByRole("navigation", { name: "Machines" }).getByRole("button", { name: "This computer" }).click();

  await test.step("Mia brings her Coder from her own Mirador, only after her OK for others' tasks", async () => {
    const dialog = await bringCoder("Only after my OK");
    await expect(dialog.getByLabel("Only after my OK")).toBeChecked();
    await expect(dialog).toContainText("The room sees it by this profile's name, after yours.");
    await dialog.getByText("What does this mean?").click();
    await expect(dialog).toContainText("reading files in that workspace usually goes ahead without asking");
    await expect(dialog).toContainText("Its owner could pass a task off as yours");
    await screenshot(mia, "bring-dialog");
    await dialog.getByRole("button", { name: "Bring", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(joinedCard(mia)).toContainText("Coder");
    await expect(coderConversation(mia)).toHaveCount(1);
  });

  await test.step("Ann's room shows it as Mia's, running on her computer, and Ann's @ menu offers it", async () => {
    await roomCard(ann, "Garden").click();
    await expect(agentChip(ann)).toBeVisible();
    await expect(agentChip(ann)).not.toHaveClass(/\baway\b/);
    await expect(agentChip(ann)).toHaveAttribute("data-hint", "On Mia's computer");
  });

  await test.step("Ann's task waits on Mia's Mirador as a card with who wrote it, in what role, where, and all of it", async () => {
    await tagCoder("SAY Weeded the beds");
    await expect(coderConversation(mia).locator(".waiting-pill")).toBeVisible();
    await coderConversation(mia).click();
    await expect(okCard(mia)).toContainText("Ann (Owner) gives this agent a task in Garden on Ann's machine");
    await expect(okCard(mia).locator(".brought-task-text")).toContainText("@Mia's Coder SAY Weeded the beds");
    await screenshot(mia, "ok-card");
    expect(readFileSync(coderPrompts(), "utf8")).not.toContain("Weeded");
    await expect(ann.locator(".room-timeline")).toContainText("Mia's Coder has not started on it yet.");
  });

  await test.step("allowed, the task goes to Mia's agent, whose answer comes into the room as its message", async () => {
    await okCard(mia).getByRole("button", { name: "Allow" }).click();
    await expect(okCard(mia)).toHaveCount(0);
    await expect(answersOfCoder(ann).locator(".message.agent")).toHaveText("Weeded the beds");
    expect(readFileSync(coderPrompts(), "utf8")).toContain('A task from the room "Garden" on Ann\'s machine');
    await screenshot(ann, "room-with-brought-agent");
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
    await mia.getByRole("menuitem", { name: "Take out Coder" }).click();
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

  await test.step("its answer tagging Ann's Builder waits for Ann's OK as Mia's task, given by her agent, and reaches Builder once allowed", async () => {
    await tagCoder("SAY @Builder please check the beans");
    await expect(taskCard(ann)).toContainText("Mia's Coder gives Builder a task on behalf of Mia (Member)");
    await expect(taskCard(ann)).toContainText("@Builder please check the beans");
    await expect(answersOfBuilder(ann)).toHaveCount(0);
    await screenshot(ann, "task-of-brought-agent");
    await taskCard(ann).getByRole("button", { name: "Allow" }).click();
    await expect(taskCard(ann)).toHaveCount(0);
    await expect(answersOfBuilder(ann).locator(".message.agent")).toHaveText("Noted.");
    expect(readFileSync(builderPrompts(), "utf8")).toContain("[member's agent] Mia's Coder");
  });

  await test.step("Ann lets no member bring agents: Mia's leaves, and her next bringing is refused until Ann lets them again", async () => {
    const membersBring = async (allowed: boolean) => {
      const settings = await openRoomSettings(ann, "Garden", "Agents");
      await settings.getByRole("switch", { name: "Members may bring agents of their own" }).setChecked(allowed);
      await settings.getByRole("button", { name: "Done" }).click();
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

test("while Mia's Mirador is away, the room says so at once, and Ann takes the agent out", async () => {
  await mias.stop();
  await expect(agentChip(ann)).toHaveClass(/\baway\b/);
  await expect(agentChip(ann)).toHaveAttribute("data-hint", "Away: Mia's Mirador is not connected");
  await tagCoder("SAY Picked the apples");
  await expect(answersOfCoder(ann).last()).toContainText("Its bringer's Mirador was not connected, so it did not get the task.");
  const settings = await openRoomSettings(ann, "Garden", "Agents");
  const brought = settings.getByRole("list", { name: "Agents people brought" });
  await expect(brought).toContainText("Away: Mia's Mirador is not connected");
  await brought.getByRole("button", { name: "Take out Mia's Coder" }).click();
  await brought.getByRole("button", { name: "Take out Mia's Coder" }).click();
  await expect(brought).toHaveCount(0);
  await settings.getByRole("button", { name: "Done" }).click();
  await expect(agentChip(ann)).toHaveCount(0);
});
