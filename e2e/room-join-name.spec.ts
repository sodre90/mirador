import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, createRoom, inviteIntoRoom, nameMachine, openRoomSettings, openSettings, reachedAtOwnPort, signIn } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

/** The owner's machine, with a room someone is invited into. */
const owners = new TestHost({ environment: reachedAtOwnPort });
/** Someone whose Mirador has no name of theirs yet. */
const visitors = new TestHost();

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await Promise.all([owners.start(), visitors.start()]);
});
test.afterAll(async () => {
  await Promise.all([owners.stop(), visitors.stop()]);
  await Promise.all([owners.cleanUp(), visitors.cleanUp()]);
});

/** Takes the name out of the profile, as the owner of a Mirador may, so that joining a room asks for one again. */
async function clearOwnName(page: Page) {
  const settings = await openSettings(page);
  await settings.getByLabel("Name", { exact: true }).fill("");
  await settings.getByLabel("Name", { exact: true }).press("Enter");
  await settings.getByRole("button", { name: "Close" }).click();
}

async function expectPeopleInGarden(page: Page, names: string[]) {
  const settings = await openRoomSettings(page, "Garden", "People");
  await expect(settings.locator(".room-settings-row-name")).toHaveText(names);
  await settings.getByRole("button", { name: "Done" }).click();
}

test("someone with no name is asked for one wherever they join a room: under Join a room, adding the machine from a room invite's link, and in its place in the rail; and joins with the name they chose", async ({ page, browser }) => {
  await signIn(page, owners);
  await nameMachine(page, "Ann's machine");
  await addWorkspace(page, owners.projectDir);
  await createRoom(page, "Garden", []);
  const invite = await inviteIntoRoom(page, "Garden");

  const visitor = await browser.newPage();
  await signIn(visitor, visitors);

  await test.step("the join dialog asks for a name beside the invite, and joins only once it has one", async () => {
    await visitor.locator(".sidebar .rooms > header button.workspace-new").click();
    await visitor.getByRole("menuitem", { name: "Join a room" }).click();
    const dialog = visitor.getByRole("dialog", { name: "Join a room" });
    await expect(dialog.getByLabel("Your name")).toBeVisible();
    await expect(dialog.getByText("People in the room see you by this name.")).toBeVisible();
    await dialog.getByLabel("Paste the invite").fill(invite);
    await expect(dialog.getByRole("button", { name: "Join", exact: true })).toBeDisabled();
    await dialog.getByLabel("Your name").fill("Owner");
    await expect(dialog.getByRole("button", { name: "Join", exact: true })).toBeEnabled();
    await dialog.getByRole("button", { name: "Join", exact: true }).click();
    await expect(dialog.locator(".join-room-problem")).toHaveText("That name is taken: the owner, an agent or another person here goes by it, or Mirador says it in a name's place. Choose another.");
    await dialog.getByLabel("Your name").fill("Dora [Member]");
    await dialog.getByRole("button", { name: "Join", exact: true }).click();
    await expect(dialog.locator(".join-room-problem")).toHaveText("A name holds no square brackets, which Mirador writes a person's role in. Choose another.");
    await dialog.getByLabel("Your name").fill("Dora");
    await dialog.getByRole("button", { name: "Join", exact: true }).click();
    await expect(dialog).toHaveCount(0);
  });

  await expect(visitor.frameLocator('iframe[title="Ann\'s machine"]').getByRole("heading", { name: "# Garden" })).toBeVisible();

  await test.step("the room shows the person by the name they gave", () => expectPeopleInGarden(page, ["Dora"]));

  await test.step("their own Mirador kept the name as their profile's", async () => {
    await visitor.getByRole("navigation", { name: "Machines" }).getByRole("button", { name: "This computer" }).click();
    const settings = await openSettings(visitor);
    await expect(settings.getByLabel("Name", { exact: true })).toHaveValue("Dora");
    await settings.getByRole("button", { name: "Close" }).click();
  });

  await test.step("with a name, joining a room asks for none", async () => {
    await visitor.locator(".sidebar .rooms > header button.workspace-new").click();
    await visitor.getByRole("menuitem", { name: "Join a room" }).click();
    const dialog = visitor.getByRole("dialog", { name: "Join a room" });
    await expect(dialog.getByLabel("Paste the invite")).toBeVisible();
    await expect(dialog.getByLabel("Your name")).toHaveCount(0);
    await dialog.getByRole("button", { name: "Cancel" }).click();
  });

  const frame = visitor.frameLocator('iframe[title="Ann\'s machine"]');
  const rail = visitor.getByRole("navigation", { name: "Machines" });

  await test.step("added again under Machines from a room invite's link, the machine asks for a name too, while the profile has none", async () => {
    await clearOwnName(visitor);
    const invite = await inviteIntoRoom(page, "Garden");
    await rail.getByRole("button", { name: "Machines…" }).click();
    const machines = visitor.getByRole("dialog", { name: "Machines" });
    const row = machines.locator(".machine-list li", { hasText: "Ann's machine" });
    await row.getByRole("button", { name: "Remove Ann's machine" }).click();
    await row.getByRole("button", { name: "Confirm: Remove Ann's machine" }).click();
    await expect(row).toHaveCount(0);
    await machines.getByLabel("Address or invite link").fill(invite);
    await expect(machines.getByLabel("Your name")).toBeVisible();
    await expect(machines.getByRole("button", { name: "Add and join" })).toBeDisabled();
    await machines.getByLabel("Your name").fill("Dora [Member]");
    await machines.getByRole("button", { name: "Add and join" }).click();
    await expect(machines.locator(".name-to-join-refused")).toHaveText("A name holds no square brackets, which Mirador writes a person's role in. Choose another.");
    await expect(machines.locator(".machine-list li", { hasText: "Ann's machine" })).toHaveCount(0);
    await machines.getByLabel("Your name").fill("Edie");
    await machines.getByRole("button", { name: "Add and join" }).click();
    await expect(machines).toHaveCount(0);
    await expect(frame.getByRole("heading", { name: "# Garden" })).toBeVisible();
    await expectPeopleInGarden(page, ["Edie"]);
  });

  await test.step("taken out of the room, the machine's place in the rail asks for a name with the new invite, while the profile has none", async () => {
    await rail.getByRole("button", { name: "This computer" }).click();
    await clearOwnName(visitor);
    const settings = await openRoomSettings(page, "Garden", "People");
    await settings.getByRole("button", { name: "Remove Edie" }).click();
    await settings.getByRole("button", { name: "Confirm: Remove Edie" }).click();
    await settings.getByRole("button", { name: "Done" }).click();
    await rail.getByRole("button", { name: "Ann's machine" }).click();
    const joinPanel = visitor.getByRole("region", { name: "Join Ann's machine" });
    await expect(joinPanel.locator(".join-out-of-rooms")).toBeVisible({ timeout: 30_000 });
    await joinPanel.getByLabel("Paste the invite").fill(await inviteIntoRoom(page, "Garden"));
    await expect(joinPanel.getByLabel("Your name")).toBeVisible();
    await expect(joinPanel.getByRole("button", { name: "Join", exact: true })).toBeDisabled();
    await joinPanel.getByLabel("Your name").fill("Fay");
    await joinPanel.getByRole("button", { name: "Join", exact: true }).click();
    await expect(joinPanel).toHaveCount(0);
    await expect(frame.getByRole("heading", { name: "# Garden" })).toBeVisible();
    await expectPeopleInGarden(page, ["Fay"]);
  });

  await visitor.close();
});
