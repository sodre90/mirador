import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { addWorkspace, chooseInSettings, createProfile, createRoom, expectPopoverFits, inviteIntoRoom, joinRoom, nameMachine, openRoomSettings, openSettings, reachedAtOwnPort, roomCard, signIn } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

/** The owner's machine, with the room, which other machines reach at its address. */
const owners = new TestHost({ fakePrograms: true, environment: reachedAtOwnPort });
/** Five people's own Miradors, which come with the same invite. */
const doras = new TestHost();
const elis = new TestHost();
const guses = new TestHost();
const hals = new TestHost();
const fays = new TestHost();
const builderPrompts = () => join(owners.root, "builder-prompts");

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  writeBunProgram(owners.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"));
  writeFileSync(builderPrompts(), "");
  await Promise.all([owners.start(), doras.start(), elis.start(), guses.start(), hals.start(), fays.start()]);
});
test.afterAll(async () => {
  await Promise.all([owners.stop(), doras.stop(), elis.stop(), guses.stop(), hals.stop(), fays.stop()]);
  await Promise.all([owners.cleanUp(), doras.cleanUp(), elis.cleanUp(), guses.cleanUp(), hals.cleanUp(), fays.cleanUp()]);
});

async function nameOwnProfile(page: Page, name: string) {
  const settings = await openSettings(page);
  await settings.getByLabel("Name", { exact: true }).fill(name);
  await settings.getByLabel("Name", { exact: true }).press("Enter");
  await settings.getByRole("button", { name: "Close" }).click();
}

const knockCard = (page: Page) => page.locator(".sidebar .rooms li.room-knock");
const readsWhole = (label: Locator) => label.evaluate((element) => element.scrollWidth <= element.clientWidth);

/** Each waiting person's device reads whole on a line of its own, under their name and role and clear of their buttons. */
async function expectDevicesOnTheirOwnLines(waiting: Locator) {
  for (const row of await waiting.all()) {
    const [name, role, device, letIn] = await Promise.all(
      [row.locator(".room-joiner-name"), row.locator(".room-joiner-role"), row.locator(".room-joiner-device"), row.getByRole("button", { name: /^Let .+ in$/ })].map((each) => each.boundingBox()),
    );
    expect(device!.y).toBeGreaterThanOrEqual(Math.max(name!.y + name!.height, role!.y + role!.height) - 1);
    expect(device!.x + device!.width).toBeLessThanOrEqual(letIn!.x);
    expect(await readsWhole(row.locator(".room-joiner-device"))).toBe(true);
  }
}

test("one invite brings several people to a room's door, where the owner lets each in or turns them away", async ({ page, browser }) => {
  await signIn(page, owners);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await nameOwnProfile(page, "Ann");
  await nameMachine(page, "Ann's machine");
  const profiles = await createProfile(page, "Builder", `OPENCODE_FAKE_ACP_PROMPTS=${builderPrompts()}`, "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await addWorkspace(page, owners.projectDir, "Builder · opencode");
  await createRoom(page, "Garden", ["Builder"]);

  const invite = await test.step("the owner makes one invite for up to five people, which asks the owner's OK for more than one", async () => {
    await page.locator(".room-header").getByRole("button", { name: "Invite someone" }).click();
    const dialog = page.getByRole("dialog", { name: "Invite someone to Garden" });
    await expect(dialog.getByLabel("How many people")).toHaveValue("1");
    await expect(dialog.getByLabel("Let them in")).toHaveValue("at-once");
    await dialog.getByLabel("How many people").selectOption({ label: "Up to 5" });
    await expect(dialog.getByLabel("Let them in")).toHaveValue("after-ok");
    await dialog.getByRole("button", { name: "Done" }).click();
    const text = await inviteIntoRoom(page, "Garden", { howMany: "Up to 5" });
    const settings = await openRoomSettings(page, "Garden");
    await expect(settings.getByRole("list", { name: "Waiting invites" }).getByRole("listitem")).toHaveText([/^Member · 0 of 5 joined · expires in 1[45] minutes/]);
    await settings.getByRole("button", { name: "Done" }).click();
    return text;
  });

  const dora = await browser.newPage();
  const eli = await browser.newPage();
  const gus = await browser.newPage();
  const hal = await browser.newPage();

  await test.step("each person who comes with it waits at the door, told whose OK they wait for, with nothing of the room opened", async () => {
    for (const [visitor, host, name] of [
      [dora, doras, "Dora"],
      [eli, elis, "Eli"],
      [gus, guses, "Gus"],
      [hal, hals, "Hal"],
    ] as const) {
      await signIn(visitor, host);
      await nameOwnProfile(visitor, name);
      const join = await joinRoom(visitor, invite);
      await expect(join).toHaveCount(0);
      await expect(knockCard(visitor).locator(".room-card-name")).toHaveText("Waiting for Ann to let you in");
      expect(await readsWhole(knockCard(visitor).locator(".room-card-name"))).toBe(true);
      await expect(knockCard(visitor).locator(".room-card-subline")).toHaveText("on Ann's machine");
      await expect(visitor.locator(".sidebar .rooms li.joined-room")).toHaveCount(0);
    }
  });

  await test.step("the owner's room says it needs them while people wait at its door", async () => {
    const needsYou = roomCard(page, "Garden").locator(".waiting-pill");
    await expect(needsYou).toHaveText("Needs you");
    await expect(needsYou).toHaveAttribute("data-hint", "Needs you: someone is waiting to join, for you to let them in or turn them away.");
  });

  await test.step("the owner's room names the first three at its door in a banner, with the rest in its list of people", async () => {
    await roomCard(page, "Garden").click();
    const banner = page.getByRole("region", { name: "People waiting to join" });
    await expect(banner.locator(".room-door-banner-head")).toHaveText("4 people are waiting to join");
    await expect(banner.locator(".room-joiner-name")).toHaveText(["Dora", "Eli", "Gus"]);
    await expect(banner.locator(".room-joiner-role")).toHaveText(["Member", "Member", "Member"]);
    await banner.getByRole("button", { name: "and 1 more" }).click();
    const people = page.getByRole("dialog", { name: "People in the room" });
    await expect(people.getByRole("list", { name: "Waiting to join" }).locator(".room-joiner-name")).toHaveText(["Dora", "Eli", "Gus", "Hal"]);
    await page.keyboard.press("Escape");
    await expect(people).toHaveCount(0);
  });

  await test.step("the owner lets someone in from the banner", async () => {
    const banner = page.getByRole("region", { name: "People waiting to join" });
    await banner.getByRole("button", { name: "Let Gus in" }).click();
    await expect(banner.locator(".room-door-banner-head")).toHaveText("3 people are waiting to join");
    await expect(banner.locator(".room-joiner-name")).toHaveText(["Dora", "Eli", "Hal"]);
    await expect(banner.getByRole("button", { name: /more$/ })).toHaveCount(0);
    await expect(knockCard(gus)).toHaveCount(0);
  });

  await test.step("the owner sees how many came, and who waits at the door, by name, role and device", async () => {
    const settings = await openRoomSettings(page, "Garden");
    await expect(settings.getByRole("list", { name: "Waiting invites" }).getByRole("listitem")).toHaveText([/^Member · 4 of 5 joined · expires in /]);
    const waiting = settings.getByRole("list", { name: "Waiting to join" }).getByRole("listitem");
    await expect(waiting.locator(".room-joiner-name")).toHaveText(["Dora", "Eli", "Hal"]);
    await expect(waiting.locator(".room-joiner-role")).toHaveText(["Member", "Member", "Member"]);
    await expect(waiting.locator(".room-joiner-device")).toHaveText([/^from “Mirador on .+”$/, /^from “Mirador on .+”$/, /^from “Mirador on .+”$/]);
    await expectDevicesOnTheirOwnLines(waiting);
    await expect(settings.getByRole("combobox", { name: "Add someone you let in before" })).toHaveCount(0);
    await settings.getByRole("button", { name: "Let Dora in" }).click();
    await expect(waiting.locator(".room-joiner-name")).toHaveText(["Eli", "Hal"]);
    await expect(settings.getByRole("list", { name: "People" }).locator(".room-settings-row-name")).toHaveText(["Gus", "Dora"]);
    await settings.getByRole("button", { name: "Done" }).click();
  });

  await test.step("the one let in has their Mirador open the room on the owner's machine, in the theme they chose", async () => {
    const frame = dora.frameLocator('iframe[title="Ann\'s machine"]');
    await expect(frame.getByRole("heading", { name: "# Garden" })).toBeVisible();
    await expect(frame.locator(".room-door-banner"), "only the owner is told who waits at the door").toHaveCount(0);
    const rail = dora.getByRole("navigation", { name: "Machines" });
    await rail.getByRole("button", { name: "This computer" }).click();
    await chooseInSettings(dora, "Theme", "Dark");
    await rail.getByRole("button", { name: "Ann's machine" }).click();
    await expect(frame.locator("html")).toHaveAttribute("data-theme", "dark");
    await dora.getByRole("navigation", { name: "Machines" }).getByRole("button", { name: "This computer" }).click();
    await expect(knockCard(dora)).toHaveCount(0);
    await expect(roomCard(dora, "Garden")).toHaveClass(/joined-room/);
  });

  await test.step("the owner turns the others away from the room's list of people and from the banner, each after a second click", async () => {
    await roomCard(page, "Garden").click();
    await page.setViewportSize({ width: 1024, height: 768 });
    const count = page.locator(".room-header .room-here-count");
    await expect(count.locator(".room-door-waiting")).toHaveText("2 waiting");
    await expect(count).toHaveAccessibleName(/^\d+ here 2 waiting$/);
    await count.click();
    const people = page.getByRole("dialog", { name: "People in the room" });
    await expect(people.getByRole("list", { name: "Waiting to join" }).locator(".room-joiner-name")).toHaveText(["Eli", "Hal"]);
    await expectPopoverFits(people);
    await expectDevicesOnTheirOwnLines(people.getByRole("list", { name: "Waiting to join" }).getByRole("listitem"));
    await expectDevicesOnTheirOwnLines(page.getByRole("region", { name: "People waiting to join" }).getByRole("listitem"));
    await people.getByRole("button", { name: "Turn Eli away" }).click();
    await people.getByRole("button", { name: "Confirm: Turn Eli away" }).click();
    await expect(people.getByRole("list", { name: "Waiting to join" }).locator(".room-joiner-name")).toHaveText(["Hal"]);
    await page.keyboard.press("Escape");
    const banner = page.getByRole("region", { name: "People waiting to join" });
    await expect(banner.locator(".room-door-banner-head")).toHaveText("1 person is waiting to join");
    await banner.getByRole("button", { name: "Turn Hal away" }).click();
    await banner.getByRole("button", { name: "Confirm: Turn Hal away" }).click();
    await expect(banner).toHaveCount(0);
    await expect(count).not.toContainText("waiting");
    await expect(roomCard(page, "Garden").locator(".waiting-pill")).toHaveCount(0);
    await expect(knockCard(hal).locator(".room-card-name")).toHaveText("Ann turned you away");
  });

  await test.step("the one turned away is told so, and puts it away", async () => {
    await expect(knockCard(eli).locator(".room-card-name")).toHaveText("Ann turned you away");
    expect(await readsWhole(knockCard(eli).locator(".room-card-name"))).toBe(true);
    await knockCard(eli).getByRole("button", { name: "Dismiss" }).click();
    await expect(knockCard(eli)).toHaveCount(0);
    await expect(eli.locator(".sidebar .rooms li.joined-room")).toHaveCount(0);
  });

  await test.step("someone who comes by a name already in the room waits at the door without it, the name they gave marked for the owner alone", async () => {
    const fay = await browser.newPage();
    await signIn(fay, fays);
    await nameOwnProfile(fay, "DORA");
    await joinRoom(fay, invite);
    await expect(knockCard(fay).locator(".room-card-name")).toHaveText("Waiting for Ann to let you in");
    const settings = await openRoomSettings(page, "Garden");
    const waiting = settings.getByRole("list", { name: "Waiting to join" }).getByRole("listitem");
    await expect(waiting.locator(".room-joiner-name")).toHaveText(["Someone without a name"]);
    await expect(waiting.locator(".room-person-name-clash")).toHaveText(["Gave the name “DORA”, which reads as a name already in the room."]);
    await settings.getByRole("button", { name: "Done" }).click();
    await fay.close();
  });

  await dora.close();
  await eli.close();
  await gus.close();
  await hal.close();
});
