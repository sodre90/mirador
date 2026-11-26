import { join } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { addWorkspace, createProfile, createRoom, inviteIntoRoom, joinRoom, nameMachine, nameOwnProfile, openRoomMenu, openRoomSettings, openSettings, reachedAtOwnPort, reloadFromRestartedHost, roomCard, signIn } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

/** Ann's machine, with the rooms Dora is invited to. */
const owners = new TestHost({ environment: reachedAtOwnPort });
/** Dora's own Mirador, with an agent of hers. */
const visitors = new TestHost({ fakePrograms: true });

test.beforeAll(async () => {
  writeBunProgram(visitors.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"));
  await Promise.all([owners.start(), visitors.start()]);
});
test.afterAll(async () => {
  await Promise.all([owners.stop(), visitors.stop()]);
  await Promise.all([owners.cleanUp(), visitors.cleanUp()]);
});

const invitedRooms = (visitor: Page) => visitor.getByRole("list", { name: "Invited" }).locator(".room-card-name");

const openInvitedRoom = (visitor: Page) => visitor.getByRole("region", { name: "Ann's room, on Ann's machine" });

const subline = (page: Page, room: string) => roomCard(page, room).locator(".room-card-subline");

const coderWork = (visitor: Page) => visitor.locator(".invited-room-bar").getByRole("button", { name: "Show the work of Coder" });
/** The sidebar's places named after the room its agent works for: none, since the room's line holds it. */
const listedForTheRoom = (visitor: Page) => visitor.locator(".sidebar").getByText("Shed · Ann's machine");

const shownRoom = (visitor: Page, room: string) => visitor.frameLocator('iframe[title="Ann\'s machine"]').getByRole("heading", { name: `# ${room}` });

async function joinsAndSees(visitor: Page, room: string, invite: string) {
  await expect(await joinRoom(visitor, invite)).toHaveCount(0);
  await expect(shownRoom(visitor, room)).toBeVisible();
}

async function openMenuOfLine(visitor: Page, room: string) {
  await openInvitedRoom(visitor).locator(".invited-room-bar").getByRole("button", { name: `More for ${room}` }).click();
  return visitor.getByRole("menu", { name: `More for ${room}` });
}

async function bringsCoder(visitor: Page, room: string) {
  const menu = await openRoomMenu(visitor, room);
  await menu.getByRole("menuitem", { name: "Bring an agent…" }).click();
  const dialog = visitor.getByRole("dialog", { name: `Bring an agent into ${room}` });
  await dialog.getByRole("combobox", { name: /^Agent/ }).selectOption({ label: "Coder" });
  await dialog.getByRole("button", { name: "Bring", exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

async function leaves(visitor: Page, room: string, menu: Locator) {
  await menu.getByRole("menuitem", { name: "Leave room" }).click();
  await expect(roomCard(visitor, room)).toBeVisible();
  await menu.getByRole("menuitem", { name: "Confirm: Leave room" }).click();
  await expect(roomCard(visitor, room)).toHaveCount(0);
}

const listedMachines = (dialog: ReturnType<Page["getByRole"]>) => dialog.locator(".machine-list .machine-name");

test("a person leaves a room they were invited to from their list, and the last one on its machine while that is off, which then goes from their computer, as one whose owner signed them out does by its own menu", async ({ page, browser }) => {
  await signIn(page, owners);
  await nameOwnProfile(page, "Ann");
  await nameMachine(page, "Ann's machine");
  await addWorkspace(page, owners.projectDir);
  await createRoom(page, "Garden", []);
  await createRoom(page, "Shed", []);

  const visitor = await browser.newPage();
  await signIn(visitor, visitors);
  await nameOwnProfile(visitor, "Dora");
  await addWorkspace(visitor, visitors.projectDir);
  const profiles = await createProfile(visitor, "Coder", "", "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();

  await joinsAndSees(visitor, "Garden", await inviteIntoRoom(page, "Garden"));
  await joinsAndSees(visitor, "Shed", await inviteIntoRoom(page, "Shed"));
  await expect(invitedRooms(visitor)).toHaveText(["Garden", "Shed"]);

  await test.step("the menu on the line above the open room closes on a press in the room", async () => {
    await expect(roomCard(visitor, "Shed")).toHaveClass(/\bselected\b/);
    const menu = await openMenuOfLine(visitor, "Shed");
    await expect(menu.getByRole("menuitem")).toHaveText(["Bring an agent…", "Leave room"]);
    await shownRoom(visitor, "Shed").click();
    await expect(menu).toHaveCount(0);
  });

  await test.step("left once confirmed on that line, the open room closes and goes from their list, and they and the agent they brought from the owner's room", async () => {
    await bringsCoder(visitor, "Shed");
    await expect(subline(page, "Shed")).toHaveText("1 person · Coder (Dora)");
    await roomCard(visitor, "Shed").click();
    await expect(coderWork(visitor)).toBeVisible();
    await expect(listedForTheRoom(visitor)).toHaveCount(0);
    await leaves(visitor, "Shed", await openMenuOfLine(visitor, "Shed"));
    await expect(openInvitedRoom(visitor)).toHaveCount(0);
    await expect(invitedRooms(visitor)).toHaveText(["Garden"]);
    await expect(subline(page, "Shed")).toHaveText("No agents yet");
    await expect(subline(page, "Garden")).toHaveText("1 person · No agents yet");
  });

  await test.step("a reload keeps it left, and a new invite lets them in again", async () => {
    await visitor.reload();
    await expect(invitedRooms(visitor)).toHaveText(["Garden"]);
    await joinsAndSees(visitor, "Shed", await inviteIntoRoom(page, "Shed"));
    await expect(invitedRooms(visitor)).toHaveText(["Garden", "Shed"]);
    await expect(subline(page, "Shed")).toHaveText("1 person · No agents yet");
  });

  await test.step("rooms left while their machine is off go from the list at once, and stay gone after a restart", async () => {
    await owners.stop();
    await expect(subline(visitor, "Garden")).toHaveText("Ann · Ann's machine · not answering");
    await leaves(visitor, "Shed", await openRoomMenu(visitor, "Shed"));
    await leaves(visitor, "Garden", await openRoomMenu(visitor, "Garden"));
    await expect(visitor.getByRole("heading", { name: "Invited" })).toHaveCount(0);
    await visitors.stop();
    await visitors.start();
    await reloadFromRestartedHost(visitor);
    await expect(visitor.getByRole("region", { name: "Rooms" })).toBeVisible();
    await expect(visitor.getByRole("heading", { name: "Invited" })).toHaveCount(0);
  });

  await test.step("once the machine answers it learns of it, and goes from their computer, where it never says its owner signed them out", async () => {
    await owners.start();
    await reloadFromRestartedHost(page);
    await expect(subline(page, "Garden")).toHaveText("No agents yet", { timeout: 30_000 });
    await expect(subline(page, "Shed")).toHaveText("No agents yet");
    const devices = await openSettings(page, "Devices");
    await expect(devices.locator(".device-list li", { hasText: "Dora" })).toHaveCount(0);
    await devices.getByRole("button", { name: "Close" }).click();

    await visitor.locator(".sidebar").getByRole("button", { name: "Machines…" }).click();
    const machines = visitor.getByRole("dialog", { name: "Machines" });
    await expect(listedMachines(machines)).toHaveCount(0);
    await machines.getByRole("button", { name: "Close" }).click();
    await expect(visitor.locator("body")).not.toContainText("signed this computer out");
  });

  await test.step("a new invite brings the machine back with its room", async () => {
    await joinsAndSees(visitor, "Garden", await inviteIntoRoom(page, "Garden"));
    await expect(invitedRooms(visitor)).toHaveText(["Garden"]);
  });

  await test.step("signed out by its owner, the machine is listed in the rooms' place, and goes from their computer by its own menu once confirmed", async () => {
    const settings = await openRoomSettings(page, "Garden");
    await settings.getByRole("button", { name: "Remove Dora" }).click();
    await settings.getByRole("button", { name: "Confirm: Remove Dora" }).click();
    await settings.getByRole("button", { name: "Close" }).click();
    await expect(subline(visitor, "Ann's machine")).toHaveText("signed out by its owner");
    await expect(visitor.getByRole("region", { name: "Join Ann's machine" })).toBeVisible();
    const menu = await openRoomMenu(visitor, "Ann's machine");
    await menu.getByRole("menuitem", { name: "Remove Ann's machine", exact: true }).click();
    const asked = menu.getByRole("menuitem", { name: "Confirm: Remove Ann's machine" });
    await expect(asked).toHaveText("Remove?");
    await expect(roomCard(visitor, "Ann's machine")).toBeVisible();
    await asked.click();
    await expect(visitor.getByRole("heading", { name: "Invited" })).toHaveCount(0);
    await expect(visitor.getByRole("region", { name: "Join Ann's machine" })).toHaveCount(0);
    await visitor.locator(".sidebar").getByRole("button", { name: "Machines…" }).click();
    await expect(listedMachines(visitor.getByRole("dialog", { name: "Machines" }))).toHaveCount(0);
  });
  await visitor.close();
});
