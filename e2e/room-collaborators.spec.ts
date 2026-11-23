import { join } from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import type { ServerMessage } from "../shared/protocol.ts";
import type { Room } from "../shared/rooms.ts";
import { addWorkspace, createProfile, createRoom, openRoomSettings, signIn } from "./helpers.ts";
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

const roomComposer = (page: Page) => page.getByRole("textbox", { name: "Write in Launch, @ tags an agent…" });
const thread = (page: Page) => page.getByRole("complementary", { name: "Thread of Builder" });

/** What the host sends the page, from the moment this is called. */
function receivedBy(page: Page) {
  const received: ServerMessage[] = [];
  page.on("websocket", (socket) => socket.on("framereceived", ({ payload }) => received.push(JSON.parse(String(payload)))));
  return received;
}

async function tagBuilder(page: Page, rest: string) {
  await roomComposer(page).fill("@Bu");
  await page.getByRole("listbox", { name: "Agents and people of the room" }).getByRole("option", { name: "@Builder" }).click();
  await roomComposer(page).fill(`@Builder ${rest}`);
  await roomComposer(page).press("Enter");
}

/** Gives the person the role in Launch, letting them in first when they are not in it yet. */
async function setRoleInLaunch(page: Page, person: string, role: Role) {
  const dialog = await openRoomSettings(page, "Launch");
  if ((await dialog.getByLabel(`Role of ${person}`).count()) === 0) await dialog.getByRole("combobox", { name: "Add someone you let in before" }).selectOption({ label: person });
  await dialog.getByLabel(`Role of ${person}`).selectOption({ label: role });
  await expect(dialog.getByLabel(`Role of ${person}`)).toHaveValue(role.toLowerCase());
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toBeHidden();
}

async function openLaunchAs(browser: Browser, cookie: ReturnType<TestHost["admitPerson"]>["cookie"]) {
  const context = await browser.newContext();
  await context.addCookies([cookie]);
  const page = await context.newPage();
  const received = receivedBy(page);
  await page.goto(host.origin);
  await page.locator(".sidebar .rooms .room-card-name", { hasText: "Launch" }).click();
  await expect(page.getByRole("heading", { name: "# Launch" })).toBeVisible();
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
  await setRoleInLaunch(page, "Mia", "Collaborator");
  await setRoleInLaunch(page, "Gus", "Member");
  const asMia = await openLaunchAs(browser, mia.cookie);
  const asGus = await openLaunchAs(browser, gus.cookie);

  await test.step("while the agent waits for the owner's OK to run a command, Mia's thread shows its request with no way to answer it, and Gus's shows the task alone", async () => {
    await tagBuilder(page, `ASK ${JSON.stringify([{ kind: "execute", title: "Run pwd", command: "pwd" }])}`);
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
    await setRoleInLaunch(page, "Mia", "Member");
    await expect(thread(asMia.page).locator(".permission, .tool")).toHaveCount(0);
    await expect(thread(asMia.page).locator(".message.agent")).toHaveText(["Run pwd: allow"]);
  });

  await Promise.all([asMia.context.close(), asGus.context.close()]);
});
