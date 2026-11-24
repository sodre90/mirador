import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  addWorkspace,
  allowNotifications,
  clickNotification,
  createProfile,
  createRoom,
  inviteIntoRoom,
  joinRoom,
  nameMachine,
  nameOwnProfile,
  notificationsShown,
  reachedAtOwnPort,
  roomCard,
  signIn,
} from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

/** The owner's machine, with the room and its agent. */
const owners = new TestHost({ fakePrograms: true, environment: reachedAtOwnPort });
/** The approver's own Mirador, which joins the owner's machine. */
const visitors = new TestHost();
const builderPrompts = () => join(owners.root, "builder-prompts");

test.beforeAll(async () => {
  writeBunProgram(owners.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"));
  writeFileSync(builderPrompts(), "");
  await Promise.all([owners.start(), visitors.start()]);
});
test.afterAll(async () => {
  await Promise.all([owners.stop(), visitors.stop()]);
  await Promise.all([owners.cleanUp(), visitors.cleanUp()]);
});

const joinedCard = (page: Page) => roomCard(page, "Orchard").and(page.locator(".joined-room"));

test("an approver who joined from their own Mirador is told there once that a request waits for approval, which marks the room until they answer it", async ({ page, browser }) => {
  await signIn(page, owners);
  await nameOwnProfile(page, "Ann");
  await nameMachine(page, "Ann's machine");
  const profiles = await createProfile(page, "Builder", `OPENCODE_FAKE_ACP_PROMPTS=${builderPrompts()}`, "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await addWorkspace(page, owners.projectDir, "Builder · opencode");
  await createRoom(page, "Orchard", ["Builder"]);
  const invite = await inviteIntoRoom(page, "Orchard", { role: "Approver" });
  const composer = page.getByRole("textbox", { name: "Write in Orchard, @ tags an agent…" });

  const visitor = await browser.newPage();
  await allowNotifications(visitor);
  await signIn(visitor, visitors);
  await nameOwnProfile(visitor, "Dora");
  await addWorkspace(visitor, visitors.projectDir);
  await createRoom(visitor, "Own room", []);
  const frame = visitor.frameLocator('iframe[title="Ann\'s machine"]');
  await expect(await joinRoom(visitor, invite)).toHaveCount(0);
  await expect(frame.getByRole("heading", { name: "# Orchard" })).toBeVisible();
  await roomCard(visitor, "Own room").click();

  const body = "Ann's machine · Waits for your approval: Run ls";
  await test.step("the agent asks to run a command, and the approver's own Mirador notifies her once and marks the room as needing her", async () => {
    await composer.fill("@Bu");
    await page.getByRole("listbox", { name: "Agents and people of the room" }).getByRole("option", { name: "@Builder" }).click();
    await composer.fill('@Builder ASK [{"kind":"execute","title":"Run ls","command":"ls"}]');
    await composer.press("Enter");
    await expect.poll(async () => (await notificationsShown(visitor)).map(({ title, body }) => `${title}: ${body}`)).toEqual([`Orchard: ${body}`]);
    await expect(joinedCard(visitor).locator(".waiting-pill")).toHaveText("Needs you");
  });

  await test.step("the notification opens the room on the owner's machine, where she allows the command, and the mark goes", async () => {
    await clickNotification(visitor, body);
    const strip = frame.locator(".room-timeline ~ .room-approvals");
    await expect(strip.locator(".room-approval-detail")).toHaveText("ls");
    await strip.getByRole("button", { name: "Allow", exact: true }).click();
    await expect(page.locator(".room-timeline .room-entry .message.agent")).toHaveText(["Run ls: allow"]);
    await roomCard(visitor, "Own room").click();
    await expect(joinedCard(visitor).locator(".waiting-pill")).toHaveCount(0);
    expect(await notificationsShown(visitor)).toHaveLength(1);
  });
  await visitor.close();
});
