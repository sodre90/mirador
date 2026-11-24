import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { FakeClaudeApi, fakeClaudeEnvironment } from "./fake-claude-api.ts";
import { addWorkspace, createProfile, createRoom, inviteIntoRoom, joinRoom, nameMachine, nameOwnProfile, openRoomSettings, reachedAtOwnPort, roomCard, signIn } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

test.describe.configure({ mode: "serial" });

const api = new FakeClaudeApi();
const owners = new TestHost({ environment: (port) => ({ ...reachedAtOwnPort(port), ...fakeClaudeEnvironment(api) }) });
/** Mia's own Mirador, which joins Ann's room and brings a Claude agent of hers into it. */
const mias = new TestHost({ environment: () => fakeClaudeEnvironment(api) });

const OWNERS_SECRET = "SECRET-ON-THE-OWNERS-COMPUTER";
const MIAS_SECRET = "SECRET-ON-MIAS-COMPUTER";
const fileOutsideWorkspace = (host: TestHost) => join(host.root, "outside", "secret.txt");
const quotedPathOutsideWorkspace = (host: TestHost) => join(host.root, "out side", "secret.txt");

function keepSecret(host: TestHost, secret: string) {
  for (const path of [fileOutsideWorkspace(host), quotedPathOutsideWorkspace(host)]) {
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, `${secret}\n`);
  }
}

const namingSecretsOf = (host: TestHost) => `@${fileOutsideWorkspace(host)} and @"${quotedPathOutsideWorkspace(host)}"`;

test.beforeAll(async () => {
  api.limited = false;
  await api.start();
  keepSecret(owners, OWNERS_SECRET);
  keepSecret(mias, MIAS_SECRET);
  await Promise.all([owners.start(), mias.start()]);
});
test.afterAll(async () => {
  await Promise.all([owners.stop(), mias.stop()]);
  await Promise.all([owners.cleanUp(), mias.cleanUp()]);
  api.stop();
});

const composer = (page: Page, room: string) => page.getByRole("textbox", { name: new RegExp(`^Write in ${room}`) });
const sentToTheModel = () => api.history.map((messages) => messages.join("\n"));

async function write(page: Page, room: string, text: string) {
  await composer(page, room).fill(text);
  await composer(page, room).press("Enter");
}

async function tag(page: Page, room: string, typed: string, agent: string, rest: string) {
  await composer(page, room).fill(typed);
  await page.getByRole("listbox", { name: "Agents and people of the room" }).getByRole("option", { name: `@${agent}` }).click();
  await write(page, room, `@${agent} ${rest}`);
}

async function makeClaudeProfile(page: Page, name: string) {
  const profiles = await createProfile(page, name, "");
  await profiles.getByRole("button", { name: "Close" }).click();
}

test("a file a guest names with an @ in a room is not read for its Claude agent, which reads what the guest wrote", async ({ page, browser }) => {
  const guest = owners.admitPerson("Gus");
  await signIn(page, owners);
  await nameOwnProfile(page, "Ann");
  await addWorkspace(page, owners.projectDir);
  await nameMachine(page, "Ann's machine");
  await makeClaudeProfile(page, "Claude");
  await createRoom(page, "Garden", ["Claude"]);
  const settings = await openRoomSettings(page, "Garden", "People");
  await settings.getByRole("combobox", { name: "Add someone you let in before" }).selectOption({ label: "Gus" });
  await settings.getByLabel("Role of Gus").selectOption({ label: "Guest" });
  await settings.getByRole("button", { name: "Close" }).click();

  const guestsBrowser = await browser.newContext();
  await guestsBrowser.addCookies([guest.cookie]);
  const guestsPage = await guestsBrowser.newPage();
  await guestsPage.goto(owners.origin);
  await roomCard(guestsPage, "Garden").click();
  await write(guestsPage, "Garden", `Nice beds, see ${namingSecretsOf(owners)}`);
  await expect(page.locator(".room-timeline .room-entry .message", { hasText: "Nice beds" })).toBeVisible();

  await tag(page, "Garden", "@Cl", "Claude", "WATER THE BEDS");
  await expect.poll(() => sentToTheModel().some((sent) => sent.includes("WATER THE BEDS")), { timeout: 60_000 }).toBe(true);
  await expect(page.locator(".room-timeline .room-entry .message.agent")).toBeVisible({ timeout: 60_000 });
  expect(sentToTheModel().some((sent) => sent.includes(`@${fileOutsideWorkspace(owners)}`))).toBe(true);
  expect(sentToTheModel().filter((sent) => sent.includes(OWNERS_SECRET))).toEqual([]);
  await guestsBrowser.close();
});

test("a file of the bringer's computer named with an @ in a task is not read for the Claude agent they brought", async ({ page, browser }) => {
  await signIn(page, owners);
  const invite = await inviteIntoRoom(page, "Garden", { role: "Member" });
  const miasBrowser = await browser.newContext();
  const mia = await miasBrowser.newPage();
  await signIn(mia, mias);
  await nameOwnProfile(mia, "Mia");
  await addWorkspace(mia, mias.projectDir);
  await makeClaudeProfile(mia, "Coder");
  await expect(await joinRoom(mia, invite)).toHaveCount(0);
  const joined = roomCard(mia, "Garden").and(mia.locator(".joined-room"));
  await joined.hover();
  await joined.getByRole("button", { name: "More for Garden" }).click();
  await mia.getByRole("menuitem", { name: "Bring an agent…" }).click();
  const dialog = mia.getByRole("dialog", { name: "Bring an agent into Garden" });
  await dialog.getByRole("combobox", { name: /^Agent/ }).selectOption({ label: "Coder" });
  await dialog.getByLabel("Any time").check();
  await dialog.getByRole("button", { name: "Bring", exact: true }).click();
  await expect(dialog).toHaveCount(0);

  await roomCard(page, "Garden").click();
  await expect(page.locator(".room-header .agent-chip", { hasText: "Mia's Coder" })).toBeVisible();
  await tag(page, "Garden", "@Mi", "Mia's Coder", `RAKE THE LEAVES ${namingSecretsOf(mias)}`);
  await expect(page.locator(".room-timeline .room-entry").filter({ has: page.locator(".author", { hasText: "Mia's Coder" }) })).toBeVisible({ timeout: 60_000 });
  const asked = sentToTheModel().filter((sent) => sent.includes("RAKE THE LEAVES"));
  expect(asked.some((sent) => sent.includes(`@${fileOutsideWorkspace(mias)}`))).toBe(true);
  expect(asked.filter((sent) => sent.includes(MIAS_SECRET))).toEqual([]);
  await miasBrowser.close();
});
