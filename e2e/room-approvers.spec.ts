import { join } from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { addWorkspace, createProfile, createRoom, openRoomSettings, roomCard, signIn } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

const host = new TestHost({ fakePrograms: true });

test.beforeAll(async () => {
  writeBunProgram(host.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"));
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const roomComposer = (page: Page) => page.getByRole("textbox", { name: "Write in Launch, @ tags an agent…" });
const roomMessages = (page: Page) => page.locator(".room-timeline .room-entry .message");
const writersRoles = (page: Page) => page.locator(".room-timeline .room-entry .author .room-role-label");
const strip = (page: Page) => page.locator(".room-timeline ~ .room-approvals");
const needsYou = (page: Page) => roomCard(page, "Launch").locator(".waiting-pill");

async function tagBuilder(page: Page, rest: string) {
  await roomComposer(page).fill("@Bu");
  await page.getByRole("listbox", { name: "Agents and people of the room" }).getByRole("option", { name: "@Builder" }).click();
  await roomComposer(page).fill(`@Builder ${rest}`);
  await roomComposer(page).press("Enter");
}

/** Lets the person into Launch, someone the owner let into the machine before, with the role. */
async function letIntoLaunch(page: Page, person: string, role: "Approver" | "Member") {
  const dialog = await openRoomSettings(page, "Launch");
  await dialog.getByRole("combobox", { name: "Add someone you let in before" }).selectOption({ label: person });
  await dialog.getByLabel(`Role of ${person}`).selectOption({ label: role });
  await expect(dialog.getByLabel(`Role of ${person}`)).toHaveValue(role.toLowerCase());
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();
}

async function openLaunchAs(browser: Browser, cookie: ReturnType<TestHost["admitPerson"]>["cookie"]) {
  const context = await browser.newContext();
  await context.addCookies([cookie]);
  const page = await context.newPage();
  await page.goto(host.origin);
  await page.locator(".sidebar .rooms .room-card-name", { hasText: "Launch" }).click();
  await expect(page.getByRole("heading", { name: "# Launch" })).toBeVisible();
  return { context, page };
}

test("an approver answers the room's agents' requests and people's tasks from their own browser, as the owner does, while a member sees none of them", async ({ page, browser }) => {
  const mia = host.admitPerson("Mia");
  const gus = host.admitPerson("Gus");
  await signIn(page, host);
  const profiles = await createProfile(page, "Builder", `OPENCODE_FAKE_ACP_PROMPTS=${join(host.root, "Builder-prompts")}`, "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await addWorkspace(page, host.projectDir, "Builder · opencode");
  await createRoom(page, "Launch", ["Builder"]);
  await letIntoLaunch(page, "Mia", "Approver");
  await letIntoLaunch(page, "Gus", "Member");
  const asMia = await openLaunchAs(browser, mia.cookie);
  const asGus = await openLaunchAs(browser, gus.cookie);

  await test.step("a member's task waits, and the approver allows it from her own browser, while the member sees nothing to approve", async () => {
    await tagBuilder(asGus.page, "SAY Notes for Gus");
    await expect(strip(asMia.page).locator(".room-approval-asker")).toHaveText("Gus (Member) gives Builder a task");
    await expect(strip(page).locator(".room-approval-asker")).toHaveText("Gus (Member) gives Builder a task");
    await expect(strip(asGus.page)).toHaveCount(0);
    await expect(needsYou(asMia.page)).toHaveText("Needs you");
    await expect(needsYou(asGus.page)).toHaveCount(0);
    await strip(asMia.page).getByRole("button", { name: "Allow", exact: true }).click();
    await expect(roomMessages(asGus.page).last()).toHaveText("Notes for Gus");
    await expect(strip(page)).toHaveCount(0);
    await expect(needsYou(asMia.page)).toHaveCount(0);
  });

  await test.step("the approver's own task starts without waiting, labelled an approver, and she allows the command its agent asks to run", async () => {
    await tagBuilder(asMia.page, 'ASK [{"kind":"execute","title":"Run ls","command":"ls"}]');
    await expect(strip(asMia.page).locator(".room-approval-subject")).toHaveText("Permission needed: run a shell command");
    await expect(strip(asMia.page).locator(".room-approval-detail")).toHaveText("ls");
    await expect(strip(asMia.page).locator(".room-approval-task")).toHaveText(/^Your task: /);
    await expect(strip(page).locator(".room-approval-subject")).toHaveText("Permission needed: run a shell command");
    await expect(strip(asGus.page)).toHaveCount(0);
    await expect(writersRoles(page)).toHaveText(["Member", "Approver"]);
    await strip(asMia.page).getByRole("button", { name: "Allow", exact: true }).click();
    await expect(roomMessages(asGus.page).last()).toHaveText("Run ls: allow");
    await expect(strip(page)).toHaveCount(0);
    await expect(strip(asMia.page)).toHaveCount(0);
  });

  await test.step("made a member, she is shown no request any more, which waits for the owner alone", async () => {
    const settings = await openRoomSettings(page, "Launch");
    await settings.getByLabel("Role of Mia").selectOption({ label: "Member" });
    await settings.getByRole("button", { name: "Close" }).click();
    await tagBuilder(asGus.page, "SAY Gus asks again");
    await expect(strip(page).locator(".room-approval-asker")).toHaveText("Gus (Member) gives Builder a task");
    await expect(roomMessages(asMia.page).last()).toHaveText("@Builder SAY Gus asks again");
    await expect(strip(asMia.page)).toHaveCount(0);
    await expect(needsYou(asMia.page)).toHaveCount(0);
  });

  await asMia.context.close();
  await asGus.context.close();
});
