import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type FrameLocator, type Page } from "@playwright/test";
import { addWorkspace, createProfile, createRoom, inviteIntoRoom, joinRoom, nameMachine, nameOwnProfile, openRoomSettings, openSettings, primaryModifier, reachedAtOwnPort, reloadFromRestartedHost, roomCard, signIn } from "./helpers.ts";
import { machineAddress, roomInviteLink } from "../shared/machines.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

/** The owner's machine, with the room and its agent, which other machines reach at its address. */
const owners = new TestHost({ fakePrograms: true, environment: reachedAtOwnPort });
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

const OUT_OF_ROOMS = "Its owner signed this computer out of their rooms there. Ask them for a new invite, and paste it here.";

const roomMessages = (page: Page | FrameLocator) => page.locator(".room-timeline .room-entry .message");

const roomsListed = (scope: Page | FrameLocator) => scope.locator(".sidebar .rooms .room-card-name");

async function setRoleOfDora(page: Page, role: "Guest" | "Not in the room") {
  const dialog = await openRoomSettings(page, "Garden");
  if (role === "Guest") await dialog.getByLabel("Role of Dora").selectOption({ label: role });
  else {
    await dialog.getByRole("button", { name: "Remove Dora" }).click();
    await dialog.getByRole("button", { name: "Confirm: Remove Dora" }).click();
  }
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toBeHidden();
}

test("a person joins a room from their own Mirador with an invite, works in it with their name and role, is let go of at once when taken out or revoked, and told so also when their Mirador was off, and comes back by a room invite alone", async ({ page, browser }) => {
  await signIn(page, owners);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await nameOwnProfile(page, "Ann");
  await nameMachine(page, "Ann's machine");
  const profiles = await createProfile(page, "Builder", `OPENCODE_FAKE_ACP_PROMPTS=${builderPrompts()}`, "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await addWorkspace(page, owners.projectDir, "Builder · opencode");

  const invite = await test.step("the owner makes a room and an invite into it for a member, one text at the machine's address, copied", async () => {
    await createRoom(page, "Garden", ["Builder"]);
    await page.locator(".room-header").getByRole("button", { name: "Invite someone" }).click();
    const dialog = page.getByRole("dialog", { name: "Invite someone to Garden" });
    await expect(dialog.getByLabel("Member: can ask the agents")).toBeChecked();
    const connect = dialog.locator(".room-invite-connect > summary");
    await expect(connect).toHaveText(`Connect: At this machine's address (127.0.0.1:${owners.port})`);
    await expect(dialog.getByLabel("Directly, peer to peer")).toBeHidden();
    await connect.click();
    await expect(dialog.getByLabel("Directly, peer to peer")).toBeDisabled();
    await expect(dialog.locator(".room-invite-no-peer-to-peer")).toHaveText("Peer to peer is off on this machine.");
    await expect(dialog.getByLabel(`At this machine's address (127.0.0.1:${owners.port})`)).toBeChecked();
    await expect(dialog.getByRole("textbox", { name: "Invite" })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Copy invite" }).click();
    await expect(dialog.getByRole("button", { name: "Copied" })).toBeVisible();
    await expect(dialog.getByText("Send it to them. In their Mirador: Rooms → Join a room.")).toBeVisible();
    await expect(dialog.getByText(/^Works once, until .+\.$/)).toBeVisible();
    await expect(dialog.getByRole("textbox", { name: "Invite" })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Show invite" }).click();
    const text = await dialog.getByRole("textbox", { name: "Invite" }).inputValue();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(text);
    expect(machineAddress(text)).toMatchObject({ origin: owners.origin, forRoom: true, tunnel: null, name: "Ann's machine" });
    await dialog.getByRole("button", { name: "Done" }).click();
    const settings = await openRoomSettings(page, "Garden");
    await expect(settings.getByRole("list", { name: "Waiting invites" }).getByRole("listitem")).toHaveText([/^Member · expires in 1[45] minutes/]);
    await settings.getByRole("button", { name: "Done" }).click();
    return text;
  });

  const visitor = await browser.newPage();
  await signIn(visitor, visitors);
  await nameOwnProfile(visitor, "Dora");
  const frame = visitor.frameLocator('iframe[title="Ann\'s machine"]');
  const composer = frame.getByRole("textbox", { name: "Write in Garden, @ tags an agent…" });

  await test.step("the person pastes the invite under Rooms → Join a room in their own Mirador, which opens the room", async () => {
    const join = await joinRoom(visitor, "not an invite");
    await expect(join.locator(".join-room-problem")).toHaveText("That isn't a room invite. Ask whoever sent it for a new one.");
    await join.getByLabel("Paste the invite").fill(invite);
    await expect(join.locator(".join-room-problem")).toHaveCount(0);
    for (const attribute of ["autocorrect", "autocapitalize"]) await expect(join.getByLabel("Paste the invite")).toHaveAttribute(attribute, "off");
    await join.getByRole("button", { name: "Join", exact: true }).click();
    await expect(join).toHaveCount(0);
    await expect(frame.getByRole("heading", { name: "# Garden" })).toBeVisible();
  });

  await test.step("their rail shows the owner's machine, which shows them only the room, and whose it is", async () => {
    const railButton = visitor.getByRole("navigation", { name: "Machines" }).getByRole("button", { name: "Ann's machine" });
    await expect(railButton).toHaveAttribute("aria-current", "true");
    await expect(railButton).toHaveClass(/someone-elses/);
    await expect(roomsListed(frame)).toHaveText(["Garden"]);
    await expect(frame.locator(".sidebar .workspace")).toHaveCount(0);
    await expect(frame.locator(".sidebar .rooms > header button")).toHaveCount(0);
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

  await test.step("the person's own list of rooms shows the room on the owner's machine, which opens it there", async () => {
    const rail = visitor.getByRole("navigation", { name: "Machines" });
    await rail.getByRole("button", { name: "This computer" }).click();
    const joined = roomCard(visitor, "Garden");
    await expect(joined).toHaveClass(/joined-room/);
    await expect(joined.locator(".room-card-subline")).toHaveText("on Ann's machine");
    await expect(joined.getByRole("button", { name: "Settings of Garden" })).toHaveCount(0);
    await joined.click();
    await expect(rail.getByRole("button", { name: "Ann's machine" })).toHaveAttribute("aria-current", "true");
    await expect(frame.getByRole("heading", { name: "# Garden" })).toBeVisible();
  });

  await test.step("in the room, the person sees no way to invite anyone, nor the models its owner chose", async () => {
    await expect(page.locator(".room-header").getByRole("button", { name: "Invite someone" })).toBeVisible();
    await expect(frame.locator(".room-header").getByRole("button", { name: "Invite someone" })).toHaveCount(0);
    await expect(frame.locator(".room-header .room-agents li")).toHaveText([/Builder/]);
    await expect(frame.locator(".room-agent-model")).toHaveCount(0);
    await expect(frame.getByRole("button", { name: "New room or join one" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Nothing written yet" }).getByRole("button", { name: "Invite people" })).toBeVisible();
    const empty = frame.getByRole("region", { name: "Nothing written yet" });
    await expect(empty.getByRole("list", { name: "Tag an agent to give it a task." }).getByRole("button")).toHaveAccessibleName("@Builder");
    await expect(empty.getByRole("button", { name: "Invite people" })).toHaveCount(0);
  });

  await test.step("the person writes, and the owner reads it at once with their name and role", async () => {
    await roomCard(frame, "Garden").click();
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
    await roomCard(frame, "Garden").click();
    await expect(roomMessages(frame)).toHaveText(["Hello from Dora"]);
  });

  await test.step("a link in the room opens from the owner's machine once the person has seen where it leads, and never by the machine's page alone", async () => {
    const address = "https://example.com/garden-notes";
    await visitor.context().route(address, (route) => route.fulfill({ contentType: "text/html", body: "<title>Garden notes</title>" }));
    const ownersComposer = page.getByRole("textbox", { name: "Write in Garden, @ tags an agent…" });
    await ownersComposer.fill(`Read [the notes](${address})`);
    await ownersComposer.press("Enter");
    const link = frame.getByRole("link", { name: "the notes" });
    const prompt = visitor.getByRole("alertdialog", { name: "Open a link from Ann's machine?" });
    const openButton = prompt.getByRole("button", { name: "Open", exact: true });
    await link.click();
    await expect(prompt.locator(".link-host")).toHaveText("example.com");
    await expect(prompt.locator(".link-address")).toHaveText(address);
    await expect(prompt.getByRole("button", { name: "Cancel" })).toBeFocused();
    await prompt.getByRole("button", { name: "Cancel" }).click();
    await expect(prompt).toHaveCount(0);

    await link.click();
    await expect(openButton).toBeEnabled();
    const tabsBefore = visitor.context().pages().length;
    await openButton.dispatchEvent("click", { detail: 1 });
    await visitor.waitForTimeout(500);
    await expect(prompt).toBeVisible();
    expect(visitor.context().pages()).toHaveLength(tabsBefore);
    const opened = visitor.context().waitForEvent("page");
    await openButton.click();
    const tab = await opened;
    await expect(tab).toHaveTitle("Garden notes");
    await expect.poll(() => tab.url()).toBe(address);
    expect(await tab.evaluate(() => [window.opener, document.referrer])).toEqual([null, ""]);
    await tab.close();
    await expect(prompt).toHaveCount(0);
  });

  await test.step("a link in the room to an address of this computer shows no prompt, however it is written, while other links still do", async () => {
    const ownersComposer = page.getByRole("textbox", { name: "Write in Garden, @ tags an agent…" });
    const loopbacks = [`${owners.origin}/mirador-here`, `http://127.1:${visitors.port}/`, `http://[::ffff:127.0.0.1]:${visitors.port}/`, "http://app.localhost./"];
    await ownersComposer.fill(`Local ones: ${loopbacks.map((address, index) => `[local ${index}](${address})`).join(", ")}; and [the notes again](https://example.com/garden-notes)`);
    await ownersComposer.press("Enter");
    const prompt = visitor.getByRole("alertdialog", { name: "Open a link from Ann's machine?" });
    for (const index of loopbacks.keys()) {
      await frame.getByRole("link", { name: `local ${index}`, exact: true }).click();
      await visitor.waitForTimeout(300);
      await expect(prompt).toHaveCount(0);
    }
    await frame.getByRole("link", { name: "the notes again" }).click();
    await expect(prompt.locator(".link-address")).toHaveText("https://example.com/garden-notes");
    await prompt.getByRole("button", { name: "Cancel" }).click();
    await expect(prompt).toHaveCount(0);
  });

  await test.step("the owner's machine's pages run sandboxed even opened outside its frame, so they set no cookie of this computer's", async () => {
    const machineFrame = visitor.locator('iframe[title="Ann\'s machine"]');
    const keyed = (await machineFrame.getAttribute("src"))!;
    for (const address of [keyed, `${new URL(keyed).origin}/`]) {
      const tab = await browser.newPage();
      await tab.goto(address);
      const reached = await tab.evaluate(() => {
        try {
          document.cookie = "mirador_token=tossed; path=/ws";
          return { origin, cookies: "set" };
        } catch {
          return { origin, cookies: "refused" };
        }
      });
      expect({ address, reached }).toEqual({ address, reached: { origin: "null", cookies: "refused" } });
      await tab.close();
    }
  });

  await test.step("the owner's machine's page asks for no link without a click, nor while its frame is not in use", async () => {
    const prompt = visitor.getByRole("alertdialog", { name: "Open a link from Ann's machine?" });
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
    await frame.getByRole("listbox", { name: "Agents and people of the room" }).getByRole("option", { name: "@Builder" }).click();
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
    await expect(frame.getByRole("listbox", { name: "Agents and people of the room" })).toHaveCount(0);
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

  const comingBack = await inviteIntoRoom(page, "Garden");

  await test.step("a room invite, opened in a browser, sends the person to their own Mirador, and never asks to join", async () => {
    const browserTab = await browser.newPage();
    await browserTab.goto(comingBack);
    await expect(browserTab.locator(".join-room-invite")).toHaveText(
      "This invite is for a room on this Mirador. Open your own Mirador, and paste it in Rooms → Join a room.",
    );
    await expect(browserTab.getByRole("button", { name: "Ask to join" })).toHaveCount(0);
    await expect(browserTab.getByLabel("Invite code")).toHaveCount(0);
    await browserTab.close();
  });

  await test.step("added again from a room invite's link under Machines, the owner's machine is someone else's from the start: its place takes a room invite alone, which lets the person back in", async () => {
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
    await expect(join.locator(".join-room-invite")).toHaveText("You were invited into a room there. Paste the invite here.");
    await expect(join.getByRole("button", { name: "Ask to join" })).toHaveCount(0);
    await expect(join.getByRole("button", { name: "Remove Ann's machine" })).toHaveCount(0);

    await join.getByLabel("Paste the invite").fill(comingBack);
    await join.getByRole("button", { name: "Join", exact: true }).click();
    await expect(join).toHaveCount(0);
    await expect(visitor.locator('iframe[title="Ann\'s machine"]')).toHaveAttribute("sandbox", "allow-scripts allow-forms");
    await expect(roomsListed(frame)).toHaveText(["Garden"]);
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
    await joinPanel.getByLabel("Paste the invite").fill(deviceCode);
    await joinPanel.getByRole("button", { name: "Join", exact: true }).click();
    await expect(joinPanel.locator(".join-problem")).toHaveText(
      "This computer joins Ann's machine as a person in its rooms, so only a room invite's code lets it in there, and it does not ask to join. To make this computer one of its owner's own devices, remove Ann's machine under Machines, and add it again with the device invite.",
    );
    await expect(visitor.locator('iframe[title="Ann\'s machine"]')).toHaveCount(0);
    await joinPanel.getByLabel("Paste the invite").fill("");
  });

  const lettingBackIn = await inviteIntoRoom(page, "Garden");
  await test.step("a new invite lets the person in again", async () => {
    await joinPanel.getByLabel("Paste the invite").fill(lettingBackIn);
    await joinPanel.getByRole("button", { name: "Join", exact: true }).click();
    await expect(joinPanel).toHaveCount(0);
    await expect(roomsListed(frame)).toHaveText(["Garden"]);
  });

  await test.step("an invite into another room of the same machine, pasted under Join a room, joins that room too, and both are listed as on the owner's machine", async () => {
    await createRoom(page, "Shed", ["Builder"]);
    const intoShed = await inviteIntoRoom(page, "Shed", { role: "Guest" });
    await visitor.getByRole("navigation", { name: "Machines" }).getByRole("button", { name: "This computer" }).click();
    const join = await joinRoom(visitor, intoShed);
    await expect(join).toHaveCount(0);
    await expect(frame.getByRole("heading", { name: "# Shed" })).toBeVisible();
    const emptyForAGuest = frame.getByRole("region", { name: "Nothing written yet" });
    await expect(emptyForAGuest.locator("p")).toHaveText(["As a guest you write along with everyone here. The members give the agents tasks."]);
    await expect(emptyForAGuest.getByRole("button")).toHaveCount(0);
    await expect(roomsListed(frame)).toHaveText(["Garden", "Shed"]);
    await visitor.getByRole("navigation", { name: "Machines" }).getByRole("button", { name: "This computer" }).click();
    await expect(visitor.locator(".sidebar .rooms li.joined-room .room-card-name")).toHaveText(["Garden", "Shed"]);
    await expect(visitor.locator(".sidebar .rooms li.joined-room .room-card-subline")).toHaveText(["on Ann's machine", "on Ann's machine"]);
    await roomCard(visitor, "Garden").click();
    await expect(frame.getByRole("heading", { name: "# Garden" })).toBeVisible();
    const settings = await openRoomSettings(page, "Shed");
    await settings.getByRole("button", { name: "Remove Dora" }).click();
    await settings.getByRole("button", { name: "Confirm: Remove Dora" }).click();
    await settings.getByRole("button", { name: "Done" }).click();
    await expect(roomsListed(frame)).toHaveText(["Garden"]);
    await visitor.getByRole("navigation", { name: "Machines" }).getByRole("button", { name: "This computer" }).click();
    await expect(visitor.locator(".sidebar .rooms li.joined-room .room-card-name")).toHaveText(["Garden"]);
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
    await joinPanel.getByLabel("Paste the invite").fill(lettingBackIn);
    await joinPanel.getByRole("button", { name: "Join", exact: true }).click();
    await expect(joinPanel.locator(".join-problem")).toHaveText("This invite code is wrong, used or expired. Ask for a new one.");
  });

  await test.step("signed out of the rooms there, the person removes the machine right in its place, once asked again", async () => {
    await joinPanel.getByRole("button", { name: "Remove Ann's machine", exact: true }).click();
    const asked = joinPanel.getByRole("button", { name: "Confirm: Remove Ann's machine" });
    await expect(asked).toHaveText("Remove?");
    await expect(asked).toHaveAttribute("data-hint", "Click again to remove this machine from the list. You can add it again later.");
    await asked.click();
    await expect(joinPanel).toHaveCount(0);
    await expect(visitor.getByRole("navigation", { name: "Machines" })).toHaveCount(0);
    await visitor.locator(".sidebar").getByRole("button", { name: "Machines…" }).click();
    await expect(visitor.getByRole("dialog", { name: "Machines" }).locator(".machine-none")).toHaveText("No machines yet.");
  });
  await visitor.close();
});

test("an invite leaves the owner's list of waiting invites as it expires", async ({ page }) => {
  await page.clock.install();
  await signIn(page, owners);
  await inviteIntoRoom(page, "Garden");
  const dialog = await openRoomSettings(page, "Garden");
  const waiting = dialog.getByRole("list", { name: "Waiting invites" }).getByRole("listitem");
  await expect(waiting).toHaveText([/^Member · expires in 1[45] minutes/]);
  await page.clock.fastForward("14:00");
  await expect(waiting).toHaveText([/^Member · expires in 1 minute(?!s)/]);
  await page.clock.fastForward("02:00");
  await expect(waiting).toHaveCount(0);
});
