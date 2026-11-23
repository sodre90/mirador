import { expect, test } from "@playwright/test";
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

test("someone with no name is asked for one when joining a room, and joins with the name they chose", async ({ page, browser }) => {
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

  await test.step("the room shows the person by the name they gave", async () => {
    const settings = await openRoomSettings(page, "Garden", "People");
    await expect(settings.locator(".room-settings-row-name")).toHaveText(["Dora"]);
    await settings.getByRole("button", { name: "Done" }).click();
  });

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

  await visitor.close();
});
