import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import type { ServerMessage } from "../shared/protocol.ts";
import type { Room } from "../shared/rooms.ts";
import { addWorkspace, addWorkspaceFromSidebar, createProfile, createRoom, openRoomSettings, signIn } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

const host = new TestHost({ fakePrograms: true });

test.beforeAll(async () => {
  writeBunProgram(host.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"));
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

type Role = "Collaborator" | "Member";

const thread = (page: Page, agent = "Builder") => page.getByRole("complementary", { name: `Thread of ${agent}` });

/** What the host sends the page, from the moment this is called. */
function receivedBy(page: Page) {
  const received: ServerMessage[] = [];
  page.on("websocket", (socket) => socket.on("framereceived", ({ payload }) => received.push(JSON.parse(String(payload)))));
  return received;
}

async function tagAgent(page: Page, agent: string, rest: string, room = "Launch") {
  const composer = page.getByRole("textbox", { name: `Write in ${room}, @ tags an agent…` });
  await composer.fill(`@${agent.slice(0, 2)}`);
  await page.getByRole("listbox", { name: "Agents and people of the room" }).getByRole("option", { name: `@${agent}` }).click();
  await composer.fill(`@${agent} ${rest}`);
  await composer.press("Enter");
}

async function openThreadOfFailedTurn(page: Page) {
  await expect(page.locator(".room-timeline")).toContainText("The turn failed.");
  await page.locator(".room-timeline").getByRole("button", { name: "Open thread" }).click();
}

/** Gives the person the role in the room, letting them in first when they are not in it yet. */
async function setRole(page: Page, person: string, role: Role, room = "Launch") {
  const dialog = await openRoomSettings(page, room);
  if ((await dialog.getByLabel(`Role of ${person}`).count()) === 0) await dialog.getByRole("combobox", { name: "Add someone you let in before" }).selectOption({ label: person });
  await dialog.getByLabel(`Role of ${person}`).selectOption({ label: role });
  await expect(dialog.getByLabel(`Role of ${person}`)).toHaveValue(role.toLowerCase());
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();
}

async function openRoom(page: Page, room: string) {
  await page.locator(".sidebar .rooms .room-card-name", { hasText: room }).click();
  await expect(page.getByRole("heading", { name: `# ${room}` })).toBeVisible();
}

async function openRoomAs(browser: Browser, cookie: ReturnType<TestHost["admitPerson"]>["cookie"], room = "Launch") {
  const context = await browser.newContext();
  await context.addCookies([cookie]);
  const page = await context.newPage();
  const received = receivedBy(page);
  await page.goto(host.origin);
  await openRoom(page, room);
  return { context, page, received };
}

const roomsIn = (message: ServerMessage): Room[] => (message.type === "snapshot" ? message.rooms : message.type === "room.upserted" ? [message.room] : []);

test("a collaborator reads the agent's work in its thread as the owner does, with nothing in it to act on, while a member reads only its answers", async ({ page, browser }) => {
  const mia = host.admitPerson("Mia");
  const gus = host.admitPerson("Gus");
  const ownerReceived = receivedBy(page);
  await signIn(page, host);
  const profiles = await createProfile(page, "Builder", `OPENCODE_FAKE_ACP_PROMPTS=${join(host.root, "Builder-prompts")}`, "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await addWorkspace(page, host.projectDir, "Builder · opencode");
  await createRoom(page, "Launch", ["Builder"]);
  await setRole(page, "Mia", "Collaborator");
  await setRole(page, "Gus", "Member");
  const asMia = await openRoomAs(browser, mia.cookie);
  const asGus = await openRoomAs(browser, gus.cookie);

  await test.step("while the agent waits for the owner's OK to run a command, Mia's thread shows its request with no way to answer it, and Gus's shows the task alone", async () => {
    await tagAgent(page, "Builder", `ASK ${JSON.stringify([{ kind: "execute", title: "Run pwd", command: "pwd" }])}`);
    for (const { page: person } of [asMia, asGus]) await person.locator(".room-timeline > .room-thread-line").getByRole("button", { name: "Open thread" }).click();
    await expect(thread(asMia.page).locator(".permission.pending")).toContainText("pwd");
    await expect(thread(asMia.page).locator(".permission.pending button")).toHaveCount(0);
    await expect(thread(asGus.page).locator(".room-entry .message")).toHaveText([/Run pwd/]);
    await expect(thread(asGus.page).locator(".permission, .tool")).toHaveCount(0);
  });

  await test.step("once the owner allows it, both read the answer, Mia with the work that led to it, none of whose files open", async () => {
    await page.locator(".room-timeline ~ .room-approvals").getByRole("button", { name: "Allow", exact: true }).click();
    for (const { page: person } of [asMia, asGus]) await expect(thread(person).locator(".message.agent")).toHaveText(["Run pwd: allow"]);
    await expect(thread(asMia.page).locator(".permission.resolved")).toHaveCount(1);
    await expect(thread(asMia.page).locator(".tool").first()).toBeVisible();
    await thread(asMia.page).locator(".tool summary").first().click();
    await expect(thread(asMia.page).locator("button.location, button.file-link")).toHaveCount(0);
    await expect(asMia.page.locator(".notices .notice")).toHaveCount(0);
    expect(asMia.received.filter(({ type }) => type === "error")).toEqual([]);
  });

  await test.step("Mia's page is never told the agent's conversation's id", async () => {
    const agentConversationId = ownerReceived
      .flatMap(roomsIn)
      .flatMap(({ agents }) => agents)
      .map(({ conversationId }) => conversationId)
      .findLast(Boolean)!;
    expect(agentConversationId).toBeTruthy();
    expect(JSON.stringify(asMia.received)).not.toContain(agentConversationId);
  });

  await test.step("made a member, Mia's open thread keeps the answer but no longer shows the work", async () => {
    await setRole(page, "Mia", "Member");
    await expect(thread(asMia.page).locator(".permission, .tool")).toHaveCount(0);
    await expect(thread(asMia.page).locator(".message.agent")).toHaveText(["Run pwd: allow"]);
  });

  await Promise.all([asMia.context.close(), asGus.context.close()]);
});

test("a collaborator reads only that the agent could not start its turn, while its owner reads what the profile's command said", async ({ page, browser }) => {
  const ida = host.admitPerson("Ida");
  const repairsFolder = join(host.root, "repairs");
  mkdirSync(repairsFolder);
  await signIn(page, host);
  const profiles = await createProfile(page, "Mender", "MENDER_TOKEN=$(echo the-owners-vault-is-locked >&2; exit 3)", "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await addWorkspaceFromSidebar(page, repairsFolder, "Mender · opencode");
  await createRoom(page, "Repairs", ["Mender"], { workspace: "repairs" });
  await setRole(page, "Ida", "Collaborator", "Repairs");
  const asIda = await openRoomAs(browser, ida.cookie, "Repairs");
  const idasThread = thread(asIda.page, "Mender");
  const couldNotStart = "The agent could not start its turn. Only the room's owner sees why.";

  await tagAgent(page, "Mender", "SAY Mended", "Repairs");
  for (const reader of [page, asIda.page]) await openThreadOfFailedTurn(reader);
  await expect(thread(page, "Mender").locator(".error-line")).toContainText("the-owners-vault-is-locked");
  await expect(idasThread.locator(".error-line")).toHaveText(couldNotStart);

  await asIda.page.reload();
  await openRoom(asIda.page, "Repairs");
  await openThreadOfFailedTurn(asIda.page);
  await expect(idasThread.locator(".error-line")).toHaveText(couldNotStart);
  for (const ownersAlone of ["the-owners-vault-is-locked", "MENDER_TOKEN"]) expect(JSON.stringify(asIda.received)).not.toContain(ownersAlone);
  await asIda.context.close();
});
