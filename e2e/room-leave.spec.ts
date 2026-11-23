import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, createProfile, createRoom, inviteIntoRoom, joinRoom, nameMachine, nameOwnProfile, openRoomMenu, openSettings, reachedAtOwnPort, reloadFromRestartedHost, roomCard, signIn } from "./helpers.ts";
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

const rail = (visitor: Page) => visitor.getByRole("navigation", { name: "Machines" });

const subline = (page: Page, room: string) => roomCard(page, room).locator(".room-card-subline");

const coderConversation = (visitor: Page) => visitor.locator(".sidebar li").filter({ has: visitor.locator(".conversation-title", { hasText: "Shed · Ann's machine" }) });

async function joins(visitor: Page, invite: string) {
  await expect(await joinRoom(visitor, invite)).toHaveCount(0);
  await rail(visitor).getByRole("button", { name: "This computer" }).click();
}

async function bringsCoder(visitor: Page, room: string) {
  const menu = await openRoomMenu(visitor, room);
  await menu.getByRole("menuitem", { name: "Bring an agent…" }).click();
  const dialog = visitor.getByRole("dialog", { name: `Bring an agent into ${room}` });
  await dialog.getByRole("combobox", { name: /^Agent/ }).selectOption({ label: "Coder" });
  await dialog.getByRole("button", { name: "Bring", exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

async function leaves(visitor: Page, room: string) {
  const menu = await openRoomMenu(visitor, room);
  await menu.getByRole("menuitem", { name: "Leave room" }).click();
  await expect(roomCard(visitor, room)).toBeVisible();
  await menu.getByRole("menuitem", { name: "Confirm: Leave room" }).click();
  await expect(roomCard(visitor, room)).toHaveCount(0);
}

const listedMachines = (dialog: ReturnType<Page["getByRole"]>) => dialog.locator(".machine-list .machine-name");

test("a person leaves a room they were invited to from their list, and the last one on its machine while that is off, which then goes from their computer", async ({ page, browser }) => {
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

  await joins(visitor, await inviteIntoRoom(page, "Garden"));
  await joins(visitor, await inviteIntoRoom(page, "Shed"));
  await expect(invitedRooms(visitor)).toHaveText(["Garden", "Shed"]);

  await test.step("left once confirmed, a room goes from their list, and they and the agent they brought from the owner's room", async () => {
    await bringsCoder(visitor, "Shed");
    await expect(coderConversation(visitor)).toHaveCount(1);
    await expect(subline(page, "Shed")).toHaveText("1 person · Dora's Coder");
    await leaves(visitor, "Shed");
    await expect(invitedRooms(visitor)).toHaveText(["Garden"]);
    await expect(subline(page, "Shed")).toHaveText("No agents yet");
    await expect(subline(page, "Garden")).toHaveText("1 person · No agents yet");
  });

  await test.step("a reload keeps it left, and a new invite lets them in again", async () => {
    await visitor.reload();
    await expect(invitedRooms(visitor)).toHaveText(["Garden"]);
    await joins(visitor, await inviteIntoRoom(page, "Shed"));
    await expect(invitedRooms(visitor)).toHaveText(["Garden", "Shed"]);
    await expect(subline(page, "Shed")).toHaveText("1 person · No agents yet");
  });

  await test.step("rooms left while their machine is off go from the list at once, and stay gone after a restart", async () => {
    await owners.stop();
    await expect(subline(visitor, "Garden")).toHaveText("Ann · Ann's machine · not answering");
    await leaves(visitor, "Shed");
    await leaves(visitor, "Garden");
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

    await expect(rail(visitor)).toHaveCount(0);
    await visitor.locator(".sidebar").getByRole("button", { name: "Machines…" }).click();
    const machines = visitor.getByRole("dialog", { name: "Machines" });
    await expect(listedMachines(machines)).toHaveCount(0);
    await machines.getByRole("button", { name: "Close" }).click();
    await expect(visitor.locator("body")).not.toContainText("signed this computer out");
  });

  await test.step("a new invite brings the machine back with its room", async () => {
    await joins(visitor, await inviteIntoRoom(page, "Garden"));
    await expect(invitedRooms(visitor)).toHaveText(["Garden"]);
  });
  await visitor.close();
});
