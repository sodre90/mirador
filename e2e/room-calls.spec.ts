import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, allowNotifications, clickNotification, createRoom, inviteIntoRoom, joinRoom, nameMachine, nameOwnProfile, notificationsShown, reachedAtOwnPort, roomCard, signIn } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

/** The owner's machine, with the room. */
const owners = new TestHost({ environment: reachedAtOwnPort });
/** The invited person's own Mirador, which joins the owner's machine. */
const visitors = new TestHost();

test.beforeAll(async () => {
  await Promise.all([owners.start(), visitors.start()]);
});
test.afterAll(async () => {
  await Promise.all([owners.stop(), visitors.stop()]);
  await Promise.all([owners.cleanUp(), visitors.cleanUp()]);
});

const joinedCard = (page: Page) => roomCard(page, "Garden").and(page.locator(".joined-room"));

test("tagged in a room of another machine while looking elsewhere, a person is told by their own Mirador once until they open the room, which it marks, until they mute it there or here", async ({ page, browser }) => {
  await signIn(page, owners);
  await nameOwnProfile(page, "Ann");
  await addWorkspace(page, owners.projectDir);
  await nameMachine(page, "Ann's machine");
  await createRoom(page, "Garden", []);
  const invite = await inviteIntoRoom(page, "Garden", { role: "Member" });
  const composer = page.getByRole("textbox", { name: "Write in Garden, @ tags an agent…" });
  const tagDora = async (rest: string) => {
    await composer.fill("@Do");
    await page.getByRole("listbox", { name: "Agents and people of the room" }).getByRole("option", { name: "@Dora" }).click();
    await composer.pressSequentially(rest);
    await composer.press("Enter");
  };

  const visitor = await browser.newPage();
  await allowNotifications(visitor);
  await signIn(visitor, visitors);
  await nameOwnProfile(visitor, "Dora");
  await addWorkspace(visitor, visitors.projectDir);
  await createRoom(visitor, "Own room", []);
  const frame = visitor.frameLocator('iframe[title="Ann\'s machine"]');
  await expect(await joinRoom(visitor, invite)).toHaveCount(0);
  await expect(frame.getByRole("heading", { name: "# Garden" })).toBeVisible();
  await roomCard(visitor, "Own room").click();

  const body = "Ann's machine · Ann tagged you: @Dora the seeds are in";
  await test.step("the owner tags the person, whose own Mirador notifies them and marks the room with what they haven't read", async () => {
    await tagDora("the seeds are in");
    await expect.poll(async () => (await notificationsShown(visitor)).map(({ title, body }) => `${title}: ${body}`)).toEqual([`Garden: ${body}`]);
    await expect(joinedCard(visitor).locator(".room-unread")).toHaveText("1");
    await expect(joinedCard(visitor).locator(".room-tagged")).toHaveText("@");
    await tagDora("and the peas");
    await expect(joinedCard(visitor).locator(".room-unread")).toHaveText("2");
    expect(await notificationsShown(visitor)).toHaveLength(1);
  });

  await test.step("the notification opens the room on the owner's machine, which reads it", async () => {
    await clickNotification(visitor, body);
    await expect(frame.getByRole("heading", { name: "# Garden" })).toBeVisible();
    await expect(frame.locator(".room-timeline .room-mention.you")).toHaveText(["@Dora", "@Dora"]);
    await roomCard(visitor, "Own room").click();
    await expect(joinedCard(visitor).locator(".room-unread")).toHaveCount(0);
    await expect(joinedCard(visitor).locator(".room-tagged")).toHaveCount(0);
  });

  await test.step("muted on this computer from the line above it, the room still counts for the person but calls them no more", async () => {
    await joinedCard(visitor).click();
    await expect(frame.locator(".room-header").getByRole("button", { name: "Mute notifications" })).toHaveCount(0);
    const mute = visitor.locator(".invited-room-bar").getByRole("button", { name: "Mute notifications" });
    await mute.click();
    await expect(mute).toHaveAttribute("aria-pressed", "true");
    await roomCard(visitor, "Own room").click();
    await tagDora("and the beans");
    await composer.fill("watering at six");
    await composer.press("Enter");
    await expect(joinedCard(visitor).locator(".room-unread")).toHaveText("2");
    await expect(joinedCard(visitor)).toHaveClass(/\bmuted\b/);
    expect(await notificationsShown(visitor)).toHaveLength(1);
  });

  await test.step("the mute stays after a reload, and the room's card lifts it", async () => {
    await joinedCard(visitor).click();
    await expect(frame.getByRole("heading", { name: "# Garden" })).toBeVisible();
    await expect(joinedCard(visitor).locator(".room-unread")).toHaveCount(0);
    await roomCard(visitor, "Own room").click();
    await tagDora("and the leeks");
    await expect(joinedCard(visitor).locator(".room-unread")).toHaveText("1");
    expect(await notificationsShown(visitor)).toHaveLength(1);
    await visitor.reload();
    const muteOfCard = joinedCard(visitor).getByRole("button", { name: "Mute notifications" });
    await expect(muteOfCard).toHaveAttribute("aria-pressed", "true");
    await joinedCard(visitor).hover();
    await muteOfCard.click();
    await expect(muteOfCard).toHaveAttribute("aria-pressed", "false");
    await expect(joinedCard(visitor)).not.toHaveClass(/\bmuted\b/);
  });
  await visitor.close();
});
