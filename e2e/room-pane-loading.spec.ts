import { expect, test } from "@playwright/test";
import { addWorkspace, createRoom, inviteIntoRoom, joinRoom, nameMachine, nameOwnProfile, reachedAtOwnPort, signIn } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

/** Ann's machine, with the room Dora is invited to. */
const owners = new TestHost({ environment: reachedAtOwnPort });
/** Dora's own Mirador. */
const visitors = new TestHost();

test.beforeAll(async () => {
  await Promise.all([owners.start(), visitors.start()]);
});
test.afterAll(async () => {
  await Promise.all([owners.stop(), visitors.stop()]);
  await Promise.all([owners.cleanUp(), visitors.cleanUp()]);
});

test("an invited room's pane shows nothing of its machine's own Mirador while that page connects, then the room alone", async ({ page, browser }) => {
  await signIn(page, owners);
  await nameOwnProfile(page, "Ann");
  await addWorkspace(page, owners.projectDir);
  await nameMachine(page, "Ann's machine");
  await createRoom(page, "Garden", []);
  const invite = await inviteIntoRoom(page, "Garden", { role: "Member" });

  const visitor = await browser.newPage();
  await signIn(visitor, visitors);
  await nameOwnProfile(visitor, "Dora");
  const roomPage = visitor.frameLocator('iframe[title="Ann\'s machine"]');

  let sendHeldMessages = () => {};
  let connected = () => {};
  const roomPageConnected = new Promise<void>((resolve) => (connected = resolve));
  await visitor.routeWebSocket(
    (url) => url.port !== String(visitors.port),
    (socket) => {
      const host = socket.connectToServer();
      const held: (string | Buffer)[] = [];
      let holding = true;
      host.onMessage((message) => (holding ? held.push(message) : socket.send(message)));
      sendHeldMessages = () => {
        holding = false;
        held.splice(0).forEach((message) => socket.send(message));
      };
      connected();
    },
  );

  await expect(await joinRoom(visitor, invite)).toHaveCount(0);
  await roomPageConnected;
  await expect(roomPage.locator(".app")).toBeAttached();
  await expect(roomPage.locator(".sidebar")).toHaveCount(0);
  await expect(roomPage.getByText("No conversation selected")).toHaveCount(0);

  sendHeldMessages();
  await expect(roomPage.getByRole("heading", { name: "# Garden" })).toBeVisible();
  await expect(roomPage.locator(".sidebar")).toHaveCount(0);
});
