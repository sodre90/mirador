import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { addWorkspace, createRoom, expectPopoverFits, joinRoom, nameMachine, nameOwnProfile, openInviteDialog, openRoomSettings, reachedAtOwnPort, roomCard, signIn } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

/** The owner's machine, with the room, which other machines reach at its address. */
const owners = new TestHost({ environment: reachedAtOwnPort });
/** Three people's own Miradors, each of which comes with an invite of its own. */
const doras = new TestHost();
const elis = new TestHost();
const fays = new TestHost();

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await Promise.all([owners.start(), doras.start(), elis.start(), fays.start()]);
});
test.afterAll(async () => {
  await Promise.all([owners.stop(), doras.stop(), elis.stop(), fays.stop()]);
  await Promise.all([owners.cleanUp(), doras.cleanUp(), elis.cleanUp(), fays.cleanUp()]);
});

async function openOwnersInviteDialog(page: Page) {
  await roomCard(page, "Garden").click();
  return openInviteDialog(page, "Garden");
}

const abilities = (dialog: Locator) => dialog.locator('.room-invite-abilities li[aria-hidden="false"]');
const waitingInvite = (dialog: Locator) => dialog.getByRole("region", { name: "Invite" });
const joined = (dialog: Locator) => dialog.locator(".room-invite-joined p");
const textOf = (dialog: Locator) => dialog.getByRole("textbox", { name: "Invite" });

async function ownersPage(browser: Browser) {
  const page = await browser.newPage();
  await signIn(page, owners);
  return page;
}

/** The room's waiting invites as another page of the owner's lists them, beside the one that has the dialog open. */
async function waitingInvitesIn(page: Page) {
  const settings = await openRoomSettings(page, "Garden");
  return settings.getByRole("list", { name: "Waiting invites" }).getByRole("listitem");
}

async function visit(browser: Browser, host: TestHost, name: string, invite: string) {
  const visitor = await browser.newPage();
  await signIn(visitor, host);
  await nameOwnProfile(visitor, name);
  return { visitor, join: await joinRoom(visitor, invite) };
}

test("the dialog shows what each role can do, and copies the invite by the keyboard alone", async ({ page }) => {
  await signIn(page, owners);
  await nameOwnProfile(page, "Ann");
  await nameMachine(page, "Ann's machine");
  await addWorkspace(page, owners.projectDir);
  await createRoom(page, "Garden", []);
  const dialog = await openInviteDialog(page, "Garden");

  await test.step("each role adds one thing to the one before it, from the least to the most", async () => {
    const adds = ["Write in the room", "Ask the agents", "See the agents' work", "Approve their requests"];
    const roles = ["Guest", "Member", "Collaborator", "Approver"];
    await expect(dialog.getByRole("group", { name: "They join as" }).locator("label")).toHaveText(roles);
    const places = () => dialog.locator(".room-invite-roles label").evaluateAll((labels) => labels.map((label) => label.getBoundingClientRect().left));
    const placesAtFirst = await places();
    for (const [index, role] of roles.entries()) {
      await dialog.getByRole("radio", { name: role }).check();
      expect(await places(), "choosing a role moves no button").toEqual(placesAtFirst);
      await expect(abilities(dialog)).toHaveText(adds.slice(0, index + 1));
    }
  });

  await test.step("Cancel closes it, and nothing was made", async () => {
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
    const settings = await openRoomSettings(page, "Garden");
    await expect(settings.getByRole("list", { name: "Waiting invites" })).toHaveCount(0);
    await settings.getByRole("button", { name: "Close" }).click();
  });

  await test.step("the chosen role has the keys as it opens, and Enter copies the invite, then closes the dialog", async () => {
    await openInviteDialog(page, "Garden");
    await expect(dialog.getByRole("radio", { name: "Member" })).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(dialog.getByRole("radio", { name: "Collaborator" })).toBeChecked();
    await page.keyboard.press("Enter");
    await expect(waitingInvite(dialog)).toContainText("Collaborator · 1 person · At once");
    await expect(dialog.getByRole("button", { name: "Done" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(dialog).toHaveCount(0);
    const settings = await openRoomSettings(page, "Garden");
    await settings.getByRole("button", { name: /^Withdraw the invite/ }).click();
    await expect(settings.getByRole("list", { name: "Waiting invites" })).toHaveCount(0);
  });
});

test("an invite is made once however often it is copied, and changing or withdrawing it leaves no other working", async ({ page, browser }) => {
  await signIn(page, owners);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const besides = await ownersPage(browser);
  const waiting = await waitingInvitesIn(besides);
  const dialog = await openOwnersInviteDialog(page);
  await dialog.getByRole("button", { name: "Copy invite" }).click();
  await expect(waiting).toHaveText([/^Member · expires in 24 hours/]);

  const first = await test.step("copying it again copies the same text", async () => {
    await page.evaluate(() => navigator.clipboard.writeText("something else"));
    await dialog.getByRole("button", { name: "Copy again" }).click();
    await expect(dialog.getByRole("button", { name: "Copied" })).toBeVisible();
    await dialog.getByRole("button", { name: "Show invite" }).click();
    const text = await textOf(dialog).inputValue();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(text);
    await expect(waiting).toHaveCount(1);
    return text;
  });

  await test.step("a change thought better of keeps the invite as it was", async () => {
    await dialog.getByRole("button", { name: "Change" }).click();
    await expect(dialog.getByText("Once you copy this one, the invite you copied before stops working.")).toBeVisible();
    await dialog.getByRole("radio", { name: "Approver" }).check();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(waitingInvite(dialog)).toContainText("Member · 1 person · At once");
    await expect(waiting).toHaveText([/^Member · /]);
    await dialog.getByRole("button", { name: "Change" }).click();
    await expect(dialog.getByRole("radio", { name: "Member" })).toBeChecked();
  });

  await test.step("a change makes another, and the first lets nobody in any more", async () => {
    await dialog.getByRole("radio", { name: "Guest" }).check();
    await dialog.getByLabel("The invite works for").selectOption("1 hour");
    await dialog.getByRole("button", { name: "Copy invite" }).click();
    await expect(waitingInvite(dialog)).toContainText(/Guest · 1 person · At once\s*Waiting for them to join · expires in 1 hour/);
    await expect(waiting).toHaveText([/^Guest · expires in 1 hour/]);
    const { visitor, join } = await visit(browser, doras, "Dora", first);
    await expect(join.locator(".join-room-problem")).toHaveText("This invite code is wrong, used or expired. Ask for a new one.");
    await visitor.close();
  });

  await test.step("withdrawing it leaves none, and goes back to its choices", async () => {
    await dialog.getByRole("button", { name: "Withdraw" }).click();
    await expect(dialog.getByText("The invite was withdrawn.")).toBeVisible();
    await expect(dialog.getByRole("radio", { name: "Guest" })).toBeChecked();
    await expect(waiting).toHaveCount(0);
  });
  await besides.close();
});

test("the dialog tells who came with its invite, and lets in whoever waits for the owner's OK", async ({ page, browser }) => {
  test.setTimeout(120_000);
  await signIn(page, owners);
  const dialog = await openOwnersInviteDialog(page);
  const copiedText = async () => {
    await dialog.getByRole("button", { name: "Copy invite" }).click();
    await expect(textOf(dialog)).toBeVisible();
    return textOf(dialog).inputValue();
  };

  await test.step("the owner's page has no clipboard, as over plain http", async () => {
    await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { value: undefined }));
  });

  await test.step("its invite is shown to copy by hand, and one person joins with it", async () => {
    const invite = await copiedText();
    await expect(dialog.getByText("Copy this invite and send it to them in any chat.")).toBeVisible();
    await dialog.getByRole("button", { name: "Copy invite" }).click();
    await expect(dialog.getByRole("button", { name: "Couldn't copy" })).toBeVisible();
    const { visitor } = await visit(browser, doras, "Dora", invite);
    await expect(joined(dialog)).toHaveText(["Dora joined as Member"]);
    await expect(waitingInvite(dialog)).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Change" })).toHaveCount(0);
    await visitor.close();
  });

  await test.step("someone else waits for the owner's OK, which the owner gives right there", async () => {
    await dialog.getByRole("button", { name: "Invite someone else" }).click();
    await dialog.getByRole("radio", { name: "Guest" }).check();
    await dialog.getByLabel("They come in").selectOption("After my OK");
    const { visitor } = await visit(browser, elis, "Eli", await copiedText());
    const door = dialog.getByRole("list", { name: "Waiting to join" });
    await expect(door.locator(".room-joiner-name")).toHaveText(["Eli"]);
    await expect(joined(dialog)).toHaveCount(0);
    await door.getByRole("button", { name: "Let Eli in" }).click();
    await expect(joined(dialog)).toHaveText(["Eli joined as Guest"]);
    await expect(door).toHaveCount(0);
    await visitor.close();
  });

  await test.step("an invite for several keeps count of who came", async () => {
    await dialog.getByRole("button", { name: "Invite someone else" }).click();
    await dialog.getByRole("radio", { name: "Collaborator" }).check();
    await dialog.getByLabel("How many people").selectOption("Up to 5");
    await dialog.getByLabel("They come in").selectOption("At once");
    const invite = await copiedText();
    await expect(waitingInvite(dialog)).toContainText(/Collaborator · Up to 5 · At once\s*0 of 5 joined/);
    const { visitor } = await visit(browser, fays, "Fay", invite);
    await expect(waitingInvite(dialog)).toContainText("1 of 5 joined");
    await expect(joined(dialog)).toHaveText(["Fay joined as Collaborator"]);
    await visitor.close();
  });

  await test.step("withdrawn on another page, it says so, and another is made from the same choices", async () => {
    const besides = await ownersPage(browser);
    const settings = await openRoomSettings(besides, "Garden");
    await settings.getByRole("button", { name: /^Withdraw the invite/ }).click();
    await expect(dialog.getByText("This invite doesn't work any more.")).toBeVisible();
    await expect(joined(dialog)).toHaveText(["Fay joined as Collaborator"]);
    await dialog.getByRole("button", { name: "Make a new one" }).click();
    await expect(dialog.getByRole("radio", { name: "Collaborator" })).toBeChecked();
    await expect(dialog.getByLabel("How many people")).toHaveValue("5");
    await besides.close();
  });
});

test("an invite that runs out while its dialog is open says so", async ({ page }) => {
  await page.clock.install();
  await signIn(page, owners);
  const dialog = await openOwnersInviteDialog(page);
  await dialog.getByLabel("The invite works for").selectOption("15 minutes");
  await dialog.getByRole("button", { name: "Copy invite" }).click();
  await expect(waitingInvite(dialog)).toContainText(/expires in 1[45] minutes/);
  await page.clock.fastForward("16:00");
  await expect(dialog.getByText("This invite has expired.")).toBeVisible();
  await expect(waitingInvite(dialog)).toHaveCount(0);
  await dialog.getByRole("button", { name: "Make a new one" }).click();
  await expect(dialog.getByRole("button", { name: "Copy invite" })).toBeEnabled();
});

test("the dialog fits a narrow window, in the longest words of a language, with large text", async ({ page }) => {
  await signIn(page, owners);
  await page.evaluate(() => localStorage.setItem("mirador-language", "de"));
  await page.reload();
  await roomCard(page, "Garden").click();
  await page.setViewportSize({ width: 400, height: 760 });
  await page.evaluate(() => document.documentElement.style.setProperty("--font-scale", "1.3"));
  await page.locator(".room-header").getByRole("button", { name: "Jemanden einladen" }).click();
  const dialog = page.getByRole("dialog", { name: "In Garden einladen" });
  await dialog.getByRole("radio", { name: "Mitwirkender" }).check();
  await expectPopoverFits(dialog);
  await dialog.getByRole("button", { name: "Einladung kopieren" }).click();
  await expect(dialog.getByRole("region", { name: "Einladung" })).toBeVisible();
  await expectPopoverFits(dialog);
});
