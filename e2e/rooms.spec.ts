import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, addWorkspaceFromSidebar, createProfile, createRoom, literally, openNewRoom, openRoomMenu, openRoomSettings, removeWorkspace, roomCard, signIn, signInWithWorkspace, workspaceCard } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

const host = new TestHost({ fakePrograms: true });
const promptsOf = { Builder: () => join(host.root, "builder-prompts"), Reviewer: () => join(host.root, "reviewer-prompts") };
const recordedPrompts = (agent: keyof typeof promptsOf) => readFileSync(promptsOf[agent](), "utf8");

test.beforeAll(async () => {
  writeBunProgram(host.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"));
  Object.values(promptsOf).forEach((file) => writeFileSync(file(), ""));
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const roomComposer = (page: Page) => page.getByRole("textbox", { name: "Write in Launch, @ tags an agent…" });
const roomEntries = (page: Page) => page.locator(".room-timeline .room-entry");
const thread = (page: Page, agent: string) => page.getByRole("complementary", { name: `Thread of ${agent}` });
/** A message as an agent is sent it: a line with its number, its author's role and name and the time, then its text after "> ". */
const framed = (author: "Owner" | "Builder", text: string) => `#\\d+ \\[${author === "Owner" ? "owner" : "agent"}\\] ${author}, \\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2} UTC:\\n> ${literally(text)}\\n`;

async function write(page: Page, text: string) {
  await roomComposer(page).fill(text);
  await roomComposer(page).press("Enter");
}

async function tag(page: Page, agent: string, typed: string, rest: string) {
  await roomComposer(page).fill(typed);
  await page.getByRole("listbox", { name: "Agents and people of the room" }).getByRole("option", { name: `@${agent}` }).click();
  await roomComposer(page).pressSequentially(rest);
  await roomComposer(page).press("Enter");
}

test("people write in a room, a tagged agent answers in its thread, and another agent catches up on all it missed", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  for (const agent of ["Builder", "Reviewer"] as const) {
    const profiles = await createProfile(page, agent, `OPENCODE_FAKE_ACP_PROMPTS=${promptsOf[agent]()}`, "", "opencode");
    await profiles.getByRole("button", { name: "Close" }).click();
  }

  await test.step("a room is made with both agents, in the workspace", async () => {
    await createRoom(page, "Launch", ["Builder", "Reviewer"]);
    await expect(page.getByRole("list", { name: "Agents" }).getByRole("listitem")).toHaveText(["◆ Builder", "◆ Reviewer"]);
    await expect(roomCard(page, "Launch").locator(".room-card-subline")).toHaveText("Builder, Reviewer");
  });

  await test.step("messages that tag no agent reach none", async () => {
    await write(page, "Morning all");
    await write(page, "The release is Friday");
    await expect(roomEntries(page).locator(".message")).toHaveText(["Morning all", "The release is Friday"]);
    expect(recordedPrompts("Builder")).toBe("");
    expect(recordedPrompts("Reviewer")).toBe("");
  });

  await test.step("a tagged agent is sent what was written before, and its answer quotes the message", async () => {
    await tag(page, "Builder", "@Bu", "SAY Shipped it");
    const answer = roomEntries(page).filter({ hasText: "Shipped it" }).filter({ has: page.locator(".room-quote") });
    await expect(answer.locator(".message.agent")).toHaveText("Shipped it");
    await expect(answer.locator(".room-quote")).toContainText("@Builder SAY Shipped it");
    await expect(answer.locator(".author")).toContainText("Builder");
    const prompt = recordedPrompts("Builder");
    expect(prompt).toContain('You are an attendee of the room "Launch"');
    expect(prompt).toContain("The room's other agents are Reviewer.");
    expect(prompt).toMatch(new RegExp(`${framed("Owner", "Morning all")}${framed("Owner", "The release is Friday")}${framed("Owner", "@Builder SAY Shipped it")}$`));
    expect(recordedPrompts("Reviewer")).toBe("");
    await expect(page.locator(".sidebar .workspace:not(.rooms) li")).toHaveCount(0);
  });

  await test.step("the thread shows the agent's work, and a follow-up there gets a second answer", async () => {
    await roomEntries(page).filter({ hasText: "Shipped it" }).getByRole("button", { name: "Open thread" }).click();
    await expect(thread(page, "Builder").locator(".tool-title")).toHaveText(["Read the room"]);
    await expect(thread(page, "Builder").locator(".message.agent")).toHaveText(["Shipped it"]);
    const followUp = thread(page, "Builder").getByRole("textbox", { name: "Follow up with Builder…" });
    await followUp.fill("SAY Notes written");
    await followUp.press("Enter");
    await expect(thread(page, "Builder").locator(".message.agent")).toHaveText(["Shipped it", "Notes written"]);
    const secondAnswer = roomEntries(page).filter({ has: page.locator(".message.agent", { hasText: "Notes written" }) });
    await expect(secondAnswer.locator(".room-quote")).toContainText("SAY Notes written");
    expect(recordedPrompts("Builder").match(/Morning all/g)).toHaveLength(1);
    await thread(page, "Builder").getByRole("button", { name: "Close thread" }).click();
  });

  await test.step("another agent tagged later is sent everything it missed, the first agent's answers too", async () => {
    await tag(page, "Reviewer", "@Re", "SAY Looks good");
    await expect(roomEntries(page).locator(".message.agent")).toHaveText(["Shipped it", "Notes written", "Looks good"]);
    const prompt = recordedPrompts("Reviewer");
    expect(prompt).toContain("[owner] Owner tagged you there.");
    for (const [author, text] of [
      ["Owner", "Morning all"],
      ["Owner", "The release is Friday"],
      ["Owner", "@Builder SAY Shipped it"],
      ["Builder", "Shipped it"],
      ["Owner", "SAY Notes written"],
      ["Builder", "Notes written"],
    ] as const)
      expect(prompt).toMatch(new RegExp(framed(author, text)));
    expect(prompt).toMatch(new RegExp(`${framed("Owner", "@Reviewer SAY Looks good")}$`));
  });

  await test.step("after a reload the room shows all of it, and its agents' conversations stay out of the sidebar", async () => {
    await page.reload();
    await expect(page.getByRole("heading", { name: "# Launch" })).toBeVisible();
    await expect(roomEntries(page).locator(".message")).toHaveText(["Morning all", "The release is Friday", "@Builder SAY Shipped it", "Shipped it", "Notes written", "@Reviewer SAY Looks good", "Looks good"]);
    await expect(page.locator(".sidebar .workspace:not(.rooms) li")).toHaveCount(0);
    await expect(page.locator(".sidebar")).not.toContainText("Launch: Builder");
    await roomEntries(page).filter({ hasText: "Shipped it" }).getByRole("button", { name: "Open thread" }).click();
    await expect(thread(page, "Builder").locator(".tool-title")).toHaveText(["Read the room", "Read the room"]);
    await expect(thread(page, "Builder").locator(".message.agent")).toHaveText(["Shipped it", "Notes written"]);
    await thread(page, "Builder").getByRole("button", { name: "Close thread" }).click();
  });

  await test.step("a message longer than a room holds stays in the composer, which says so", async () => {
    const composer = page.locator(".room-composer").first();
    const longest = "x".repeat(20_000);
    await roomComposer(page).fill(`${longest}y`);
    await expect(composer.locator(".room-message-too-long")).toHaveText("20,001 characters: a room message holds at most 20,000.");
    await expect(composer.getByRole("button", { name: "Send" })).toBeDisabled();
    await roomComposer(page).press("Enter");
    await expect(roomComposer(page)).toHaveValue(`${longest}y`);
    await roomComposer(page).fill(`  ${longest}  `);
    await expect(composer.locator(".room-message-too-long")).toHaveCount(0);
    await expect(composer.getByRole("button", { name: "Send" })).toBeEnabled();
    await roomComposer(page).fill("");
  });

  await test.step("the room's settings open from its bar, and deleting the room on their General page takes it away", async () => {
    await page.locator(".room-header:visible").getByRole("button", { name: "Room settings" }).click();
    const dialog = page.getByRole("dialog", { name: "Room settings" });
    await expect(dialog.getByRole("tab", { name: "People" })).toHaveAttribute("aria-selected", "true");
    await dialog.getByRole("tab", { name: "General" }).click();
    await dialog.getByRole("button", { name: "Delete room" }).click();
    await dialog.getByRole("button", { name: "Confirm: Delete room" }).click();
    await expect(page.locator(".sidebar .rooms li")).toHaveCount(0);
    await expect(page.getByText("No conversation selected")).toBeVisible();
  });
});

test("a workspace a room works in stays until the room moves to another, where its agent starts afresh and is introduced again", async ({ page }) => {
  const elsewhere = join(host.root, "elsewhere");
  /** The fake agent's answer to FOLDER, which names the folder as the operating system resolves it. */
  const workingIn = (folder: string) => `Working in ${realpathSync(folder)}`;
  const moverPrompts = join(host.root, "mover-prompts");
  mkdirSync(elsewhere, { recursive: true });
  writeFileSync(moverPrompts, "");
  await signInWithWorkspace(page, host);
  await addWorkspaceFromSidebar(page, elsewhere);
  const profiles = await createProfile(page, "Mover", `OPENCODE_FAKE_ACP_PROMPTS=${moverPrompts}`, "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await test.step("New room shows the workspace under the name before More options opens", async () => {
    const dialog = await openNewRoom(page);
    await expect(dialog.getByRole("combobox", { name: /^Workspace/ })).toBeVisible();
    await expect(dialog.getByRole("radio", { name: "Ask for everything" })).toBeHidden();
    await expect(dialog.locator("form > .room-field").nth(1)).toContainText("Workspace");
    await dialog.getByRole("button", { name: "Cancel" }).click();
  });

  await createRoom(page, "Moving", ["Mover"], { workspace: "elsewhere" });
  const composer = page.getByRole("textbox", { name: "Write in Moving, @ tags an agent…" });
  const tagMover = async (rest: string) => {
    await composer.fill("@Mo");
    await page.getByRole("listbox", { name: "Agents and people of the room" }).getByRole("option", { name: "@Mover" }).click();
    await composer.pressSequentially(rest);
    await composer.press("Enter");
  };

  await test.step("the room's ⋯ opens a menu that invites someone, opens its settings and deletes it once asked again, and the list has no Invited heading while there is no invited room", async () => {
    await expect(page.getByRole("heading", { name: "Invited" })).toHaveCount(0);
    const menu = await openRoomMenu(page, "Moving");
    await expect(menu.getByRole("menuitem")).toHaveText(["Invite someone", "Room settings", "Delete room"]);
    await menu.getByRole("menuitem", { name: "Invite someone" }).click();
    await page.getByRole("dialog", { name: "Invite to Moving" }).getByRole("button", { name: "Cancel" }).click();
    await expect(menu).toHaveCount(0);

    await createRoom(page, "Brief", ["Mover"]);
    await openRoomMenu(page, "Brief");
    await page.getByRole("menuitem", { name: "Delete room" }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menuitem", { name: "Delete room" })).toHaveCount(0);
    await expect(roomCard(page, "Brief")).toBeVisible();
    await openRoomMenu(page, "Brief");
    await page.getByRole("menuitem", { name: "Delete room" }).click();
    await page.getByRole("menuitem", { name: "Confirm: Delete room" }).click();
    await expect(roomCard(page, "Brief")).toHaveCount(0);
    await roomCard(page, "Moving").click();
  });

  await test.step("the empty room offers its agents to tag, says only tags reach them, and invites people", async () => {
    const empty = page.getByRole("region", { name: "Nothing written yet" });
    await expect(empty.locator("p")).toHaveText(["Tag an agent to give it a task.", "A message reaches an agent only when it tags it with @."]);
    await expect(empty.getByRole("list", { name: "Tag an agent to give it a task." }).getByRole("button")).toHaveAccessibleName("@Mover");
    await empty.getByRole("button", { name: "Invite people" }).click();
    const invite = page.getByRole("dialog", { name: "Invite to Moving" });
    await expect(invite.getByRole("alert")).toHaveText("Peer to peer is off on this machine. No other machine reaches this one yet. Give it an address in Settings → Devices.");
    await expect(invite.getByRole("button", { name: "Copy invite" })).toBeDisabled();
    await invite.getByRole("button", { name: "Cancel" }).click();
    await expect(invite).toHaveCount(0);
    await composer.fill("first ");
    await empty.getByRole("button", { name: "@Mover" }).click();
    await expect(composer).toHaveValue("first @Mover ");
    await expect(composer).toBeFocused();
    await composer.fill("");
    await empty.getByRole("button", { name: "@Mover" }).click();
    await expect(composer).toHaveValue("@Mover ");
    await expect(composer).toBeFocused();
    await composer.pressSequentially("FOLDER");
    await composer.press("Enter");
    await expect(roomEntries(page).locator(".message.agent")).toHaveText([workingIn(elsewhere)]);
    await expect(empty).toHaveCount(0);
  });

  await test.step("removing the room's workspace is refused, naming the room", async () => {
    await removeWorkspace(workspaceCard(page, elsewhere));
    await expect(page.locator(".notices .notice")).toContainText("Rooms work in this workspace: Moving. Give each another workspace in its settings, or delete it, before you remove this one.");
    await expect(workspaceCard(page, elsewhere)).toBeVisible();
  });

  await test.step("the room moves to another workspace, and its old one can go", async () => {
    const settings = await openRoomSettings(page, "Moving", "General");
    await settings.getByRole("combobox", { name: /^Workspace/ }).selectOption({ label: "project" });
    await settings.getByRole("button", { name: "Close" }).click();
    await removeWorkspace(workspaceCard(page, elsewhere));
    await expect(workspaceCard(page, elsewhere)).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "# Moving" })).toBeVisible();
  });

  await test.step("its agent starts afresh in the new workspace, introduced to the room again with what it said there", async () => {
    const promptsBefore = readFileSync(moverPrompts, "utf8").length;
    await tagMover("FOLDER");
    await expect(roomEntries(page).locator(".message.agent")).toHaveText([workingIn(elsewhere), workingIn(host.projectDir)]);
    const sentAfresh = readFileSync(moverPrompts, "utf8").slice(promptsBefore);
    expect(sentAfresh).toContain('You are an attendee of the room "Moving"');
    expect(sentAfresh).toMatch(new RegExp(`> ${literally(workingIn(elsewhere))}\\n#\\d+ \\[owner\\] Owner, [^\\n]*\\n> @Mover FOLDER\\n$`));
  });
});
