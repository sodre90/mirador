import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { PROBLEM_HEADER } from "../shared/host-problems.ts";
import { PERSON_MESSAGE_TYPES } from "../shared/person-messages.ts";
import type { ServerMessage } from "../shared/protocol.ts";
import type { Room } from "../shared/rooms.ts";
import { addWorkspace, createProfile, lastAgentMessage, sendMessage, signIn, startConversation } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

const host = new TestHost({ fakePrograms: true });
const builderPrompts = () => join(host.root, "builder-prompts");

test.beforeAll(async () => {
  writeBunProgram(host.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"));
  writeFileSync(builderPrompts(), "");
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const roomComposer = (page: Page) => page.getByRole("textbox", { name: "Write in Launch, @ tags an agent…" });
const guestComposer = (page: Page) => page.getByRole("textbox", { name: "Write in Launch…" });
const roomMessages = (page: Page) => page.locator(".room-timeline .room-entry .message");
const roomsListed = (page: Page) => page.locator(".sidebar .rooms li");

async function tagBuilder(page: Page, rest: string) {
  await roomComposer(page).fill("@Bu");
  await page.getByRole("listbox", { name: "Agents of the room" }).getByRole("option", { name: "@Builder" }).click();
  await roomComposer(page).pressSequentially(rest);
  await roomComposer(page).press("Enter");
}

async function makeRoom(page: Page, name: string) {
  await page.getByRole("button", { name: "New room" }).click();
  const dialog = page.getByRole("dialog", { name: "New room" });
  await dialog.getByLabel("Room name").fill(name);
  await dialog.getByLabel("Builder").check();
  await dialog.getByRole("button", { name: "Create room" }).click();
  await expect(page.getByRole("heading", { name: `# ${name}` })).toBeVisible();
  await expect(page).toHaveURL(/#\/r\/.+$/);
  return page.url().match(/#\/r\/(.+)$/)![1]!;
}

async function setRoleOfMia(page: Page, room: string, role: "Member" | "Guest" | "Not in the room") {
  await page.getByRole("button", { name: `Settings of ${room}` }).click();
  const dialog = page.getByRole("dialog", { name: "Room settings" });
  await dialog.getByLabel("Role of Mia").selectOption({ label: role });
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
}

/** What the page asks of the host and is sent by it, from the moment this is called. */
function trafficOf(page: Page) {
  const traffic = { sent: [] as { type: string }[], received: [] as ServerMessage[], socketPaths: [] as string[], refused: [] as string[] };
  page.on("websocket", (socket) => {
    traffic.socketPaths.push(new URL(socket.url()).pathname);
    socket.on("framesent", ({ payload }) => traffic.sent.push(JSON.parse(String(payload))));
    socket.on("framereceived", ({ payload }) => traffic.received.push(JSON.parse(String(payload))));
  });
  page.on("response", (response) => {
    if (response.status() >= 400 || response.headers()[PROBLEM_HEADER.toLowerCase()]) traffic.refused.push(`${response.status()} ${response.url()}`);
  });
  return traffic;
}

const roomsIn = (message: ServerMessage): Room[] => (message.type === "snapshot" ? message.rooms : message.type === "room.upserted" ? [message.room] : []);

test("a person the owner lets into a room sees only that room on their own browser, reads it live, and may do there what their role allows, from the moment it changes", async ({ page, browser }) => {
  const mia = host.admitPerson("Mia");
  const ownerTraffic = trafficOf(page);
  await signIn(page, host);
  const profiles = await createProfile(page, "Builder", `FAKE_ACP_PROMPTS=${builderPrompts()}`, "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await addWorkspace(page, host.projectDir, "Builder · opencode");

  const ownConversationId = await test.step("the owner works in a conversation of their own", async () => {
    const conversationId = await startConversation(page, { withModels: false });
    await sendMessage(page, "SAY The plan nobody else reads");
    await expect(lastAgentMessage(page)).toHaveText("The plan nobody else reads");
    return conversationId;
  });

  const hiddenRoomId = await test.step("the owner makes a room Mia is not in, and one she is a member of", async () => {
    const roomId = await makeRoom(page, "Secret");
    await makeRoom(page, "Launch");
    await setRoleOfMia(page, "Launch", "Member");
    await page.getByRole("button", { name: "Settings of Launch" }).click();
    await expect(page.getByRole("dialog", { name: "Room settings" }).getByLabel("Role of Mia")).toHaveValue("member");
    await page.getByRole("dialog", { name: "Room settings" }).getByRole("button", { name: "Cancel" }).click();
    return roomId;
  });

  const miaContext = await browser.newContext();
  await miaContext.addCookies([mia.cookie]);
  const miaPage = await miaContext.newPage();
  const miaTraffic = trafficOf(miaPage);

  await test.step("Mia's browser shows the rooms she is in and nothing else of the machine", async () => {
    await miaPage.goto(host.origin);
    await expect(miaPage.getByRole("heading", { name: "Pick a room on the left." })).toBeVisible();
    await expect(roomsListed(miaPage)).toHaveText(["# Launch"]);
    await expect(miaPage.locator(".sidebar .workspace")).toHaveCount(0);
    for (const name of ["New room", "Settings of Launch", "Settings", "Plugins", "Profiles", "Machines"]) await expect(miaPage.getByRole("button", { name, exact: true })).toHaveCount(0);
    await expect(miaPage.locator("body")).not.toContainText("Secret");
  });

  await test.step("Mia writes in the room, and the owner reads it at once", async () => {
    await roomsListed(miaPage).filter({ hasText: "# Launch" }).click();
    await expect(miaPage.getByRole("heading", { name: "# Launch" })).toBeVisible();
    await roomComposer(miaPage).fill("Morning from Mia");
    await roomComposer(miaPage).press("Enter");
    await expect(roomMessages(page)).toHaveText(["Morning from Mia"]);
  });

  await test.step("Mia reads what the owner and the agent write as they write it, labelled a member, and as one tags the agent herself once the owner allows it", async () => {
    await tagBuilder(page, "SAY Shipped it");
    await expect(roomMessages(miaPage)).toHaveText(["Morning from Mia", "@Builder SAY Shipped it", "Shipped it"]);
    await expect(miaPage.locator(".room-timeline .room-entry .author")).toContainText(["Mia", "Owner", "Builder"]);
    for (const each of [page, miaPage]) await expect(each.locator(".room-timeline .room-entry .room-role-label")).toHaveText(["Member"]);
    await tagBuilder(miaPage, "SAY Notes for Mia");
    const strip = page.locator(".room-timeline ~ .room-approvals");
    await expect(strip.locator(".room-approval-asker")).toHaveText("Mia (Member) gives Builder a task");
    await expect(roomMessages(miaPage).last()).toHaveText("@Builder SAY Notes for Mia");
    await strip.getByRole("button", { name: "Allow", exact: true }).click();
    await expect(roomMessages(miaPage).last()).toHaveText("Notes for Mia");
    await expect(roomMessages(page).last()).toHaveText("Notes for Mia");
  });

  const agentConversationId = ownerTraffic.received
    .flatMap(roomsIn)
    .flatMap(({ agents }) => agents)
    .map(({ conversationId }) => conversationId)
    .findLast(Boolean)!;
  expect(agentConversationId).toBeTruthy();
  expect(JSON.stringify(miaTraffic.received)).not.toContain(agentConversationId);

  await test.step("Mia reaches no conversation and no room she is not in by its address", async () => {
    for (const address of [`#/c/${ownConversationId}`, `#/c/${agentConversationId}`, `#/r/${hiddenRoomId}`]) {
      const receivedBefore = miaTraffic.received.length;
      await miaPage.goto(`${host.origin}/${address}`);
      await miaPage.reload();
      await expect(miaPage.getByRole("heading", { name: "Pick a room on the left." })).toBeVisible();
      await expect(roomsListed(miaPage)).toHaveText(["# Launch"]);
      await expect(miaPage.locator("body")).not.toContainText("The plan nobody else reads");
      await expect(miaPage.locator("body")).not.toContainText("Secret");
      await expect(miaPage.locator(".notices .notice")).toHaveCount(0);
      expect(miaTraffic.received.slice(receivedBefore).filter(({ type }) => type.startsWith("conversation"))).toEqual([]);
    }
  });

  await test.step("made a guest, Mia's open page lets her write, but neither tag the agent nor follow up in its thread", async () => {
    await roomsListed(miaPage).filter({ hasText: "# Launch" }).click();
    await setRoleOfMia(page, "Launch", "Guest");
    await guestComposer(miaPage).fill("@Bu");
    await expect(miaPage.getByRole("listbox", { name: "Agents of the room" })).toHaveCount(0);
    await guestComposer(miaPage).fill("Just watching");
    await guestComposer(miaPage).press("Enter");
    await expect(roomMessages(page).last()).toHaveText("Just watching");
    await miaPage.locator(".room-timeline .room-entry").filter({ hasText: "Notes for Mia" }).getByRole("button", { name: "Open thread" }).click();
    const thread = miaPage.getByRole("complementary", { name: "Thread of Builder" });
    await expect(thread).toContainText("@Builder SAY Notes for Mia");
    await expect(thread.getByRole("textbox")).toHaveCount(0);
    await thread.getByRole("button", { name: "Close thread" }).click();
  });

  await test.step("Mia can't take the name of the room's agent, and is told why; she names herself anew, and the owner's page names her messages so", async () => {
    await miaPage.getByRole("button", { name: "Your profile" }).click();
    const profile = miaPage.getByRole("dialog", { name: "Your profile" });
    await expect(profile).toContainText("Without a name, they say You to you and Someone without a name to everyone else.");
    const name = profile.getByLabel("Name");
    await name.fill("builder");
    await name.press("Enter");
    await expect(profile.getByRole("alert")).toHaveText("That name is taken: the owner, an agent or another person here goes by it, or Mirador says it in a name's place. Choose another.");
    await name.fill("Mia Rossi");
    await name.press("Enter");
    await expect(profile.getByRole("alert")).toHaveCount(0);
    await expect(page.locator(".room-timeline .room-entry .author").first()).toContainText("Mia Rossi");
  });

  await test.step("taken out of her last room, Mia's open page loses it at once, and says she is in no room any more", async () => {
    await setRoleOfMia(page, "Launch", "Not in the room");
    await expect(roomsListed(miaPage)).toHaveCount(0);
    await expect(miaPage.getByRole("heading", { name: "You are in no room on this machine any more. Its owner can invite you again." })).toBeVisible();
  });

  expect(miaTraffic.sent.filter(({ type }) => !(PERSON_MESSAGE_TYPES as readonly string[]).includes(type))).toEqual([]);
  expect(miaTraffic.refused).toEqual([]);
  expect(new Set(miaTraffic.socketPaths)).toEqual(new Set(["/ws"]));
  expect(JSON.stringify(miaTraffic.received)).not.toContain(agentConversationId);

  await miaContext.close();
});
