import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type FrameLocator, type Page } from "@playwright/test";
import { addWorkspace, createProfile, openSettings, primaryModifier, reloadFromRestartedHost, signIn } from "./helpers.ts";
import { roomInviteLink } from "../shared/machines.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

/** The owner's machine, with the room and its agent. */
const owners = new TestHost({ fakePrograms: true });
/** The invited person's own Mirador, which joins the owner's machine. */
const visitors = new TestHost();
const builderPrompts = () => join(owners.root, "builder-prompts");

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  writeBunProgram(owners.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"));
  writeFileSync(builderPrompts(), "");
  await Promise.all([owners.start(), visitors.start()]);
});
test.afterAll(async () => {
  await Promise.all([owners.stop(), visitors.stop()]);
  await Promise.all([owners.cleanUp(), visitors.cleanUp()]);
});

const OUT_OF_ROOMS = "Its owner signed this computer out of their rooms there. Ask them for a new invite, and join with its code.";

const roomMessages = (page: Page | FrameLocator) => page.locator(".room-timeline .room-entry .message");

async function nameOwnProfile(page: Page, name: string) {
  const settings = await openSettings(page);
  await settings.getByLabel("Name", { exact: true }).fill(name);
  await settings.getByLabel("Name", { exact: true }).press("Enter");
  await settings.getByRole("button", { name: "Close" }).click();
}

async function roomSettings(page: Page) {
  await page.getByRole("button", { name: "Settings of Garden" }).click();
  return page.getByRole("dialog", { name: "Room settings" });
}

async function makeMemberInvite(page: Page) {
  const dialog = await roomSettings(page);
  await dialog.getByRole("button", { name: "Make an invite" }).click();
  const code = dialog.getByRole("group", { name: "Invite code" }).locator(".invite-code");
  await expect(code).toHaveText(/^ROOM-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  const shown = (await code.textContent())!;
  await dialog.getByRole("button", { name: "Cancel" }).click();
  return shown;
}

async function setRoleOfDora(page: Page, role: "Guest" | "Not in the room") {
  const dialog = await roomSettings(page);
  await dialog.getByLabel("Role of Dora").selectOption({ label: role });
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
}

test("a person joins a room from their own Mirador with an invite, works in it with their name and role, is let go of at once when taken out or revoked, and told so also when their Mirador was off, and comes back by a room invite alone", async ({ page, browser }) => {
  await signIn(page, owners);
  await nameOwnProfile(page, "Ann");
  const profiles = await createProfile(page, "Builder", `FAKE_ACP_PROMPTS=${builderPrompts()}`, "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await addWorkspace(page, owners.projectDir, "Builder · opencode");

  const code = await test.step("the owner makes a room and an invite into it for a member", async () => {
    await page.getByRole("button", { name: "New room" }).click();
    const create = page.getByRole("dialog", { name: "New room" });
    await create.getByLabel("Room name").fill("Garden");
    await create.getByLabel("Builder").check();
    await create.getByRole("button", { name: "Create room" }).click();
    await expect(page.getByRole("heading", { name: "# Garden" })).toBeVisible();
    const dialog = await roomSettings(page);
    await expect(dialog.getByRole("combobox", { name: "Role", exact: true })).toHaveValue("member");
    await dialog.getByRole("button", { name: "Make an invite" }).click();
    const invite = dialog.getByRole("group", { name: "Invite code" });
    await expect(invite.locator(".invite-code")).toHaveText(/^ROOM-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    await expect(dialog.getByRole("list", { name: "Waiting invites" }).getByRole("listitem")).toHaveText([/^Member, until /]);
    const shown = (await invite.locator(".invite-code").textContent())!;
    await dialog.getByRole("button", { name: "Cancel" }).click();
    return shown;
  });

  const visitor = await browser.newPage();
  await signIn(visitor, visitors);
  await nameOwnProfile(visitor, "Dora");
  const frame = visitor.frameLocator('iframe[title="Ann\'s machine"]');
  const composer = frame.getByRole("textbox", { name: "Write in Garden, @ tags an agent…" });

  await test.step("the person adds the owner's machine to their own Mirador and joins it with the code", async () => {
    await visitor.getByRole("button", { name: "Machines…" }).click();
    const machines = visitor.getByRole("dialog", { name: "Machines" });
    await machines.getByLabel("Name").fill("Ann's machine");
    await machines.getByLabel("Address or invite link").fill(owners.origin);
    await machines.getByRole("button", { name: "Add", exact: true }).click();
    await machines.locator(".machine-list li", { hasText: "Ann's machine" }).getByRole("button", { name: "Open", exact: true }).click();
    const join = visitor.getByRole("region", { name: "Join Ann's machine" });
    await join.getByLabel("Invite code or link").fill(code);
    await join.getByRole("button", { name: "Join", exact: true }).click();
    await expect(join).toHaveCount(0);
  });

  await test.step("their rail shows the owner's machine, which shows them only the room, and whose it is", async () => {
    const railButton = visitor.getByRole("navigation", { name: "Machines" }).getByRole("button", { name: "Ann's machine" });
    await expect(railButton).toHaveAttribute("aria-current", "true");
    await expect(railButton).toHaveClass(/someone-elses/);
    await expect(frame.locator(".sidebar .rooms li")).toHaveText(["# Garden"]);
    await expect(frame.locator(".rooms-only-welcome")).toHaveText("This is the Mirador of Ann. You were invited to: Garden.");
    await expect(frame.locator(".sidebar .workspace")).toHaveCount(0);
    await expect(frame.getByRole("button", { name: "New room" })).toHaveCount(0);
  });

  await test.step("the owner's machine runs sandboxed in an origin of its own, with no microphone or clipboard of the person's Mirador", async () => {
    const machineFrame = visitor.locator('iframe[title="Ann\'s machine"]');
    await expect(machineFrame).toHaveAttribute("sandbox", "allow-scripts allow-forms");
    await expect(machineFrame).not.toHaveAttribute("allow");
    const inside = (await (await machineFrame.elementHandle())!.contentFrame())!;
    const reachedFromInside = await inside.evaluate(() => {
      const refused = (read: () => unknown) => {
        try {
          read();
          return false;
        } catch {
          return true;
        }
      };
      return { origin, cookies: refused(() => document.cookie), storage: refused(() => localStorage.length) };
    });
    expect(reachedFromInside).toEqual({ origin: "null", cookies: true, storage: true });
    expect(await inside.evaluate(() => fetch("mirador-here").then(({ status }) => status, (error: unknown) => String(error)))).toBe(200);
  });

  await test.step("the owner sees whose device joined, and that it reaches the rooms alone", async () => {
    const settings = await openSettings(page, "Devices");
    await expect(settings.locator(".device-list li", { hasText: "Mirador on " }).locator(".device-person")).toHaveText("Dora, in rooms only");
    await settings.getByRole("button", { name: "Close" }).click();
  });

  await test.step("the person writes, and the owner reads it at once with their name and role", async () => {
    await frame.locator(".sidebar .rooms li").filter({ hasText: "# Garden" }).click();
    await composer.fill("Hello from Dora");
    await composer.press("Enter");
    await expect(roomMessages(page)).toHaveText(["Hello from Dora"]);
    await expect(page.locator(".room-timeline .room-entry .author")).toContainText(["Dora"]);
    await expect(page.locator(".room-timeline .room-entry .room-role-label")).toHaveText(["Member"]);
  });

  await test.step("the owner's machine presses no key of the person's Mirador, as a canvas page passes its keys on", async () => {
    await composer.click();
    const machineFrame = visitor.locator('iframe[title="Ann\'s machine"]');
    await expect.poll(() => visitor.evaluate(() => document.activeElement?.getAttribute("title"))).toBe("Ann's machine");
    const mac = (await primaryModifier(visitor)) === "Meta";
    const inside = (await (await machineFrame.elementHandle())!.contentFrame())!;
    await inside.evaluate(
      (press) => window.parent.postMessage({ source: "mirador-canvas", kind: "key", typing: false, repeat: false, ...press }, "*"),
      { key: "k", code: "KeyK", metaKey: mac, ctrlKey: !mac, altKey: false, shiftKey: false },
    );
    await visitor.waitForTimeout(500);
    await expect(visitor.getByLabel("Search conversations and actions")).toHaveCount(0);
  });

  await test.step("reloaded, the person's Mirador shows the room again through the owner's machine", async () => {
    await visitor.reload();
    await visitor.getByRole("navigation", { name: "Machines" }).getByRole("button", { name: "Ann's machine" }).click();
    await frame.locator(".sidebar .rooms li").filter({ hasText: "# Garden" }).click();
    await expect(roomMessages(frame)).toHaveText(["Hello from Dora"]);
  });

  await test.step("a link in the room opens from the owner's machine once the person has seen where it leads, and never by the machine's page alone", async () => {
    const address = `${owners.origin}/mirador-here`;
    const ownersComposer = page.getByRole("textbox", { name: "Write in Garden, @ tags an agent…" });
    await ownersComposer.fill(`Read [the notes](${address})`);
    await ownersComposer.press("Enter");
    const link = frame.getByRole("link", { name: "the notes" });
    const prompt = visitor.getByRole("alertdialog", { name: "Open a link from Ann's machine?" });
    await link.click();
    await expect(prompt.locator(".link-host")).toHaveText(new URL(owners.origin).host);
    await expect(prompt.locator(".link-address")).toHaveText(address);
    await expect(prompt.getByRole("button", { name: "Cancel" })).toBeFocused();
    await prompt.getByRole("button", { name: "Cancel" }).click();
    await expect(prompt).toHaveCount(0);

    await link.click();
    const opened = visitor.context().waitForEvent("page");
    await prompt.getByRole("button", { name: "Open", exact: true }).click();
    const tab = await opened;
    await expect.poll(() => tab.url()).toBe(address);
    expect(await tab.evaluate(() => [window.opener, document.referrer])).toEqual([null, ""]);
    await tab.close();
    await expect(prompt).toHaveCount(0);

    const machineFrame = visitor.locator('iframe[title="Ann\'s machine"]');
    const inside = (await (await machineFrame.elementHandle())!.contentFrame())!;
    const askedUnclicked = (afterMs: number) =>
      inside.evaluate((afterMs) => setTimeout(() => window.parent.postMessage({ type: "mirador:open-link", url: "https://example.com/never-clicked" }, "*"), afterMs), afterMs);
    await askedUnclicked(0);
    await visitor.waitForTimeout(500);
    await expect(prompt).toHaveCount(0);
    await machineFrame.focus();
    // Playwright's evaluate counts as a click for a few seconds, which the page asks after.
    await askedUnclicked(6_000);
    await visitor.waitForTimeout(7_000);
    await expect(prompt).toHaveCount(0);
  });

  await test.step("the person tags the agent, the owner allows the task, and both read the answer", async () => {
    await composer.fill("@Bu");
    await frame.getByRole("listbox", { name: "Agents of the room" }).getByRole("option", { name: "@Builder" }).click();
    await composer.pressSequentially("SAY Seeds are in");
    await composer.press("Enter");
    const strip = page.locator(".room-timeline ~ .room-approvals");
    await expect(strip.locator(".room-approval-asker")).toHaveText("Dora (Member) gives Builder a task");
    await strip.getByRole("button", { name: "Allow", exact: true }).click();
    await expect(roomMessages(page).last()).toHaveText("Seeds are in");
    await expect(roomMessages(frame).last()).toHaveText("Seeds are in");
  });

  await test.step("made a guest, the person can no longer tag the agent", async () => {
    await setRoleOfDora(page, "Guest");
    const guestComposer = frame.getByRole("textbox", { name: "Write in Garden…" });
    await guestComposer.fill("@Bu");
    await expect(frame.getByRole("listbox", { name: "Agents of the room" })).toHaveCount(0);
  });

  await test.step("taken out of the room, the person's Mirador says they are in no room there any more, and offers no way in but a new invite", async () => {
    await setRoleOfDora(page, "Not in the room");
    const join = visitor.getByRole("region", { name: "Join Ann's machine" });
    await expect(join).toContainText(OUT_OF_ROOMS);
    await expect(join.getByRole("button", { name: "Ask to join" })).toHaveCount(0);
    const settings = await openSettings(page, "Devices");
    await expect(settings.locator(".device-person")).toHaveCount(0);
    await settings.getByRole("button", { name: "Close" }).click();
  });

  const comingBack = await makeMemberInvite(page);

  await test.step("a room invite's link, opened in a browser, sends the person to their own Mirador, and never asks to join", async () => {
    const browserTab = await browser.newPage();
    await browserTab.goto(roomInviteLink(owners.origin, comingBack));
    await expect(browserTab.locator(".join-room-invite")).toHaveText(
      "This link invites you into a room on this Mirador. Open your own Mirador, and paste the link under Machines there to join.",
    );
    await expect(browserTab.getByRole("button", { name: "Ask to join" })).toHaveCount(0);
    await expect(browserTab.getByLabel("Invite code")).toHaveCount(0);
    await browserTab.close();
  });

  await test.step("added again from a room invite's link, the owner's machine is someone else's from the start: its place takes a room invite's code alone, which lets the person back in", async () => {
    await visitor.getByRole("button", { name: "Machines…" }).click();
    const machines = visitor.getByRole("dialog", { name: "Machines" });
    const row = machines.locator(".machine-list li", { hasText: "Ann's machine" });
    const join = visitor.getByRole("region", { name: "Join Ann's machine" });
    await row.getByRole("button", { name: "Remove Ann's machine" }).click();
    await row.getByRole("button", { name: "Confirm: Remove Ann's machine" }).click();
    await expect(row).toHaveCount(0);
    await machines.getByLabel("Name").fill("Ann's machine");
    await machines.getByLabel("Address or invite link").fill(roomInviteLink(owners.origin, "ABCD-EFGH-JKLM"));
    await machines.getByRole("button", { name: "Add and join" }).click();
    await row.getByRole("button", { name: "Open", exact: true }).click();
    await expect(join.locator(".join-room-invite")).toHaveText("You were invited into a room there. Join with the room invite's code or link.");
    await expect(join.getByRole("button", { name: "Ask to join" })).toHaveCount(0);

    await join.getByLabel("Invite code or link").fill(comingBack);
    await join.getByRole("button", { name: "Join", exact: true }).click();
    await expect(join).toHaveCount(0);
    await expect(visitor.locator('iframe[title="Ann\'s machine"]')).toHaveAttribute("sandbox", "allow-scripts allow-forms");
    await expect(frame.locator(".sidebar .rooms li")).toHaveText(["# Garden"]);
  });

  const joinPanel = visitor.getByRole("region", { name: "Join Ann's machine" });
  await test.step("the owner revokes the person's Mirador, which says it is signed out of their rooms there", async () => {
    const settings = await openSettings(page, "Devices");
    await settings.locator(".device-list li", { hasText: "Mirador on " }).getByRole("button", { name: /^Revoke / }).click();
    await settings.getByRole("button", { name: /^Confirm: Revoke / }).click();
    await expect(settings.locator(".device-list li", { hasText: "Mirador on " })).toHaveCount(0);
    await settings.getByRole("button", { name: "Close" }).click();
    await expect(joinPanel.locator(".join-out-of-rooms")).toHaveText(OUT_OF_ROOMS, { timeout: 30_000 });
  });

  await test.step("a device invite of the owner's, typed into the place of a machine joined as a person, sends no code to join with, and says how to make this computer the owner's device instead", async () => {
    const settings = await openSettings(page, "Devices");
    await settings.getByRole("button", { name: "Invite a device" }).click();
    const deviceCode = (await settings.locator(".invite-code").textContent())!;
    await settings.getByRole("button", { name: "Close" }).click();
    await joinPanel.getByLabel("Invite code or link").fill(deviceCode);
    await joinPanel.getByRole("button", { name: "Join", exact: true }).click();
    await expect(joinPanel.locator(".join-problem")).toHaveText(
      "This computer joins Ann's machine as a person in its rooms, so only a room invite's code lets it in there, and it does not ask to join. To make this computer one of its owner's own devices, remove Ann's machine under Machines, and add it again with the device invite.",
    );
    await expect(visitor.locator('iframe[title="Ann\'s machine"]')).toHaveCount(0);
    await joinPanel.getByLabel("Invite code or link").fill("");
  });

  const lettingBackIn = await makeMemberInvite(page);
  await test.step("a new invite lets the person in again", async () => {
    await joinPanel.getByLabel("Invite code or link").fill(lettingBackIn);
    await joinPanel.getByRole("button", { name: "Join", exact: true }).click();
    await expect(joinPanel).toHaveCount(0);
    await expect(frame.locator(".sidebar .rooms li")).toHaveText(["# Garden"]);
  });

  await test.step("taken out of the room while their Mirador was off, the person learns it from their own Mirador once it starts", async () => {
    await visitors.stop();
    await setRoleOfDora(page, "Not in the room");
    await visitors.start();
    await reloadFromRestartedHost(visitor);
    await visitor.getByRole("navigation", { name: "Machines" }).getByRole("button", { name: "Ann's machine" }).click();
    await expect(joinPanel.locator(".join-out-of-rooms")).toHaveText(OUT_OF_ROOMS, { timeout: 30_000 });
  });

  await test.step("the invite the person came back with last, typed again, says it is used up", async () => {
    await joinPanel.getByLabel("Invite code or link").fill(lettingBackIn);
    await joinPanel.getByRole("button", { name: "Join", exact: true }).click();
    await expect(joinPanel.locator(".join-problem")).toHaveText("This invite code is wrong, used or expired. Ask for a new one.");
  });
  await visitor.close();
});

test("an invite leaves the owner's list of waiting invites as it expires", async ({ page }) => {
  await page.clock.install();
  await signIn(page, owners);
  await page.locator(".sidebar .rooms li", { hasText: "# Garden" }).click();
  const dialog = await roomSettings(page);
  const waiting = dialog.getByRole("list", { name: "Waiting invites" }).getByRole("listitem");
  await expect(waiting).toHaveCount(0);
  await dialog.getByRole("button", { name: "Make an invite" }).click();
  await expect(waiting).toHaveText([/^Member, until /]);
  await page.clock.fastForward("14:00");
  await expect(waiting).toHaveText([/^Member, until /]);
  await page.clock.fastForward("02:00");
  await expect(waiting).toHaveCount(0);
});
