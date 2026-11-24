import { expect, test } from "@playwright/test";
import { addWorkspace, allowNotifications, clickNotification, createRoom, inviteIntoRoom, joinRoom, nameMachine, nameOwnProfile, notificationsShown, openSettings, reachedAtOwnPort, roomCard, signIn } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

/** Ann's machine, with the room Dora is invited to. */
const owners = new TestHost({ environment: reachedAtOwnPort });
/** Dora's own Mirador, with a rail. */
const laptop = new TestHost();
/** Dora's other machine, in that rail. */
const box = new TestHost();

test.beforeAll(async () => {
  await Promise.all([owners.start(), laptop.start(), box.start()]);
});
test.afterAll(async () => {
  await Promise.all([owners.stop(), laptop.stop(), box.stop()]);
  await Promise.all([owners.cleanUp(), laptop.cleanUp(), box.cleanUp()]);
});

test("a person's rail holds their own machines alone, while a room they were invited to opens in their own window", async ({ page, browser }) => {
  await signIn(page, owners);
  await nameOwnProfile(page, "Ann");
  await addWorkspace(page, owners.projectDir);
  await nameMachine(page, "Ann's machine");
  await createRoom(page, "Garden", []);
  const invite = await inviteIntoRoom(page, "Garden", { role: "Member" });

  const boxPage = await browser.newPage();
  await signIn(boxPage, box);
  const devices = await openSettings(boxPage, "Devices");
  await devices.getByRole("button", { name: "Invite a device" }).click();
  const boxCode = (await devices.locator(".invite-code").textContent())!;

  const visitor = await browser.newPage();
  await allowNotifications(visitor);
  await signIn(visitor, laptop);
  await nameOwnProfile(visitor, "Dora");
  await addWorkspace(visitor, laptop.projectDir);
  const rail = visitor.getByRole("navigation", { name: "Machines" });
  const railMachines = rail.locator(".rail-machine");
  const boxFrame = visitor.locator('iframe[title="Box"]');
  const room = visitor.getByRole("region", { name: "Ann's room, on Ann's machine" });
  const garden = visitor.frameLocator('iframe[title="Ann\'s machine"]').getByRole("heading", { name: "# Garden" });

  await test.step("the person's own other machine joins their rail", async () => {
    await visitor.locator(".sidebar").getByRole("button", { name: "Machines…" }).click();
    const machines = visitor.getByRole("dialog", { name: "Machines" });
    await machines.getByLabel("Name").fill("Box");
    await machines.getByLabel("Address or invite link").fill(box.origin);
    await machines.getByRole("button", { name: "Add", exact: true }).click();
    await machines.locator(".machine-list li", { hasText: "Box" }).getByRole("button", { name: "Open", exact: true }).click();
    const join = visitor.getByRole("region", { name: "Join Box" });
    await join.getByLabel("Invite code or link").fill(boxCode);
    await join.getByRole("button", { name: "Join", exact: true }).click();
    await expect(boxFrame).toBeVisible();
    await rail.getByRole("button", { name: "This computer" }).click();
    await expect(boxFrame).toBeHidden();
  });

  await test.step("joined, the room opens beside the rail and the person's own sidebar, and its machine takes no place in the rail", async () => {
    await expect(await joinRoom(visitor, invite)).toHaveCount(0);
    await expect(garden).toBeVisible();
    await expect(visitor.locator(".sidebar")).toBeVisible();
    await expect(railMachines).toHaveCount(2);
    await expect(rail.getByRole("button", { name: "This computer" })).toHaveAttribute("aria-current", "true");
    await expect(rail.getByRole("button", { name: "Box" })).toBeVisible();
    await expect(rail.getByRole("button", { name: "Ann's machine" })).toHaveCount(0);
  });

  await test.step("their other machine shows over it, and this computer comes back to the room", async () => {
    await rail.getByRole("button", { name: "Box" }).click();
    await expect(boxFrame).toBeVisible();
    await expect(garden).toBeHidden();
    await rail.getByRole("button", { name: "This computer" }).click();
    await expect(boxFrame).toBeHidden();
    await expect(garden).toBeVisible();
  });

  await test.step("a notification from the room brings it up from under their other machine", async () => {
    await rail.getByRole("button", { name: "Box" }).click();
    await expect(garden).toBeHidden();
    const composer = page.getByRole("textbox", { name: "Write in Garden, @ tags an agent…" });
    await composer.fill("@Do");
    await page.getByRole("listbox", { name: "Agents and people of the room" }).getByRole("option", { name: "@Dora" }).click();
    await composer.pressSequentially("the seeds are in");
    await composer.press("Enter");
    const body = "Ann's machine · Ann tagged you: @Dora the seeds are in";
    await expect.poll(async () => (await notificationsShown(visitor)).map(({ body }) => body)).toEqual([body]);
    await clickNotification(visitor, body);
    await expect(room).toBeVisible();
    await expect(boxFrame).toBeHidden();
    await expect(garden).toBeVisible();
  });

  await test.step("a reload comes back to the room, with the rail as it was", async () => {
    await visitor.reload();
    await expect(garden).toBeVisible();
    await expect(railMachines).toHaveCount(2);
    await expect(roomCard(visitor, "Garden")).toHaveClass(/\bselected\b/);
  });

  await test.step("Open under Machines shows the room's machine in the person's own window too", async () => {
    await createRoom(visitor, "Own room", []);
    await expect(garden).toBeHidden();
    await rail.getByRole("button", { name: "Machines…" }).click();
    const machines = visitor.getByRole("dialog", { name: "Machines" });
    await machines.locator(".machine-list li", { hasText: "Ann's machine" }).getByRole("button", { name: "Open", exact: true }).click();
    await expect(machines).toHaveCount(0);
    await expect(garden).toBeVisible();
    await expect(room).toBeVisible();
  });
  await Promise.all([visitor.close(), boxPage.close()]);
});
