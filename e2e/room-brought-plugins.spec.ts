import { cpSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, createProfile, createRoom, inviteIntoRoom, joinRoom, nameMachine, nameOwnProfile, openRoomSettings, reachedAtOwnPort, roomCard, signIn } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

test.describe.configure({ mode: "serial" });

/** Ann's Mirador, which hosts the room and has Board + Counter installed. */
const owners = new TestHost({ environment: reachedAtOwnPort, fakePrograms: true });
/** Mia's Mirador, which has NO plugins installed locally and brings her Coder agent into Ann's room. */
const mias = new TestHost({ fakePrograms: true });
const coderPrompts = () => join(mias.root, "coder-prompts");
const builderPrompts = () => join(owners.root, "builder-prompts");

test.beforeAll(async () => {
  cpSync(join(import.meta.dirname, "..", "tests", "fixtures", "canvas-plugins", "board"), join(owners.dataDir, "plugins", "board"), { recursive: true });
  cpSync(join(import.meta.dirname, "..", "tests", "fixtures", "apps", "counter"), join(owners.dataDir, "plugins", "counter"), { recursive: true });
  writeBunProgram(mias.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"));
  writeBunProgram(owners.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"));
  writeFileSync(coderPrompts(), "");
  writeFileSync(builderPrompts(), "");
  await Promise.all([owners.start(), mias.start()]);
});

test.afterAll(async () => {
  await Promise.all([owners.stop(), mias.stop()]);
  await Promise.all([owners.cleanUp(), mias.cleanUp()]);
});

const composer = (page: Page) => page.getByRole("textbox", { name: "Write in Studio, @ tags an agent…" });
const joinedCard = (page: Page) => roomCard(page, "Studio").and(page.locator(".joined-room"));
const pageView = (page: Page) => page.frameLocator(".canvas-panel:visible .canvas-body > .canvas-frame.plugin iframe");
const appView = (page: Page) => page.frameLocator(".canvas-panel:visible .app-view .canvas-frame.app iframe");
const answersOfCoder = (page: Page) => page.locator(".room-timeline .room-entry").filter({ has: page.locator(".author", { hasText: "Coder (Mia)" }) });

async function tagCoder(ann: Page, rest: string) {
  await composer(ann).fill("@Co");
  await ann.getByRole("listbox", { name: "Agents and people of the room" }).getByRole("option", { name: "@Coder (Mia)" }).click();
  await composer(ann).fill(`@Coder (Mia) ${rest}`);
  await composer(ann).press("Enter");
}

test("brought agent from another Mirador uses room host's enabled canvas and app plugins with approver gates", async ({ browser }) => {
  const ann = await browser.newPage();
  const mia = await browser.newPage();

  await test.step("Ann creates Studio, enables Board + Counter, and invites Mia", async () => {
    await signIn(ann, owners);
    await nameOwnProfile(ann, "Ann");
    await addWorkspace(ann, owners.projectDir);
    await nameMachine(ann, "Ann's machine");
    const builder = await createProfile(ann, "Builder", `OPENCODE_FAKE_ACP_PROMPTS=${builderPrompts()}`, "", "opencode");
    await builder.getByRole("button", { name: "Close" }).click();
    await createRoom(ann, "Studio", ["Builder"]);

    const settings = await openRoomSettings(ann, "Studio");
    await settings.getByRole("tab", { name: "Plugins" }).click();
    await settings.getByRole("switch", { name: "Use Board in this room" }).click();
    await expect(settings.getByRole("switch", { name: "Use Board in this room" })).toBeChecked();
    await settings.getByRole("switch", { name: "Use Counter in this room" }).click();
    await expect(settings.getByRole("switch", { name: "Use Counter in this room" })).toBeChecked();
    await settings.getByRole("button", { name: "Close" }).click();

    const invite = await inviteIntoRoom(ann, "Studio", { role: "Member" });
    await signIn(mia, mias);
    await nameOwnProfile(mia, "Mia");
    await addWorkspace(mia, mias.projectDir);
    const profiles = await createProfile(mia, "Coder", `OPENCODE_FAKE_ACP_PROMPTS=${coderPrompts()}`, "", "opencode");
    await profiles.getByRole("button", { name: "Close" }).click();
    await expect(await joinRoom(mia, invite)).toHaveCount(0);
  });

  await test.step("Mia brings Coder (with no local plugins) into Studio", async () => {
    await joinedCard(mia).hover();
    await joinedCard(mia).getByRole("button", { name: "More for Studio" }).click();
    await mia.getByRole("menuitem", { name: "Bring an agent…" }).click();
    const dialog = mia.getByRole("dialog", { name: "Bring an agent into Studio" });
    await dialog.getByRole("combobox", { name: /^Agent/ }).selectOption({ label: "Coder" });
    await dialog.getByRole("combobox", { name: /^Workspace/ }).selectOption({ label: basename(mias.projectDir) });
    await dialog.getByLabel("Any time").check();
    await dialog.getByRole("button", { name: "Bring", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(ann.locator(".room-header .agent-chip", { hasText: "Coder (Mia)" })).toBeVisible();
  });

  await test.step("Coder calls proxied show_card, Ann approves it, and the card appears attributed to Coder (Mia)", async () => {
    await tagCoder(ann, 'CANVAS show_card {"title":"From Coder","text":"Shared across hosts"}');
    const approval = ann.locator(".room-approvals");
    await expect(approval).toContainText("Coder (Mia) asks");
    await expect(approval).toContainText("show_card");
    await approval.getByRole("button", { name: "Allow", exact: true }).click();

    await expect(answersOfCoder(ann).last()).toContainText("Shown as ");
    await expect(ann.locator(".canvas-panel:visible .canvas-author")).toContainText("Coder (Mia)");
    await expect(pageView(ann).locator("#title")).toHaveText("From Coder");
    await expect(pageView(ann).locator("#text")).toHaveText("Shared across hosts (pressed 0 times)");

    await pageView(ann).getByRole("button", { name: "Press" }).click();
    await expect(pageView(ann).locator("#text")).toHaveText("Shared across hosts (pressed 1 times)");
  });

  await test.step("Coder opens Counter via proxied app_open (gated) and reads app_state directly (no gate)", async () => {
    await tagCoder(ann, 'CANVAS app_open {"app":"counter","file":"coder.counter.json"}');
    const approval = ann.locator(".room-approvals");
    await expect(approval).toContainText("Open counter on coder.counter.json");
    await approval.getByRole("button", { name: "Allow", exact: true }).click();

    await expect(answersOfCoder(ann).last()).toContainText("Counter is open on coder.counter.json");
    await expect(ann.locator(".canvas-panel:visible .app-toggle", { hasText: "Counter" })).toBeVisible();
    await expect(appView(ann).locator("#count")).toHaveText("0");

    // Read-only app_state completes without any approval card.
    await tagCoder(ann, 'CANVAS app_state {"app":"counter"}');
    await expect(answersOfCoder(ann).last()).toContainText("Counter on coder.counter.json");
    await expect(ann.locator(".room-approvals")).toHaveCount(0);
  });

  await ann.close();
  await mia.close();
});
