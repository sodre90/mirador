import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, createProfile, signIn } from "./helpers.ts";
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

async function write(page: Page, text: string) {
  await roomComposer(page).fill(text);
  await roomComposer(page).press("Enter");
}

async function tag(page: Page, agent: string, typed: string, rest: string) {
  await roomComposer(page).fill(typed);
  await page.getByRole("listbox", { name: "Agents of the room" }).getByRole("option", { name: `@${agent}` }).click();
  await roomComposer(page).pressSequentially(rest);
  await roomComposer(page).press("Enter");
}

test("people write in a room, a tagged agent answers in its thread, and another agent catches up on all it missed", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  for (const agent of ["Builder", "Reviewer"] as const) {
    const profiles = await createProfile(page, agent, `FAKE_ACP_PROMPTS=${promptsOf[agent]()}`, "", "opencode");
    await profiles.getByRole("button", { name: "Close" }).click();
  }

  await test.step("a room is made with both agents, in the workspace", async () => {
    await page.getByRole("button", { name: "New room" }).click();
    const dialog = page.getByRole("dialog", { name: "New room" });
    await dialog.getByLabel("Room name").fill("Launch");
    await dialog.getByLabel("Builder").check();
    await dialog.getByLabel("Reviewer").check();
    await dialog.getByRole("button", { name: "Create room" }).click();
    await expect(page.getByRole("heading", { name: "# Launch" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Agents" }).getByRole("listitem")).toHaveText(["◆ Builder", "◆ Reviewer"]);
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
    expect(prompt).toMatch(/Owner: Morning all\n.*Owner: The release is Friday\n.*Owner: @Builder SAY Shipped it\n$/);
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
    expect(prompt).toContain("Owner tagged you there.");
    for (const line of ["Owner: Morning all", "Owner: The release is Friday", "Owner: @Builder SAY Shipped it", "Builder: Shipped it", "Owner: SAY Notes written", "Builder: Notes written"]) expect(prompt).toContain(line);
    expect(prompt).toMatch(/Owner: @Reviewer SAY Looks good\n$/);
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

  await test.step("deleting the room takes it away", async () => {
    await page.getByRole("button", { name: "Settings of Launch" }).click();
    const dialog = page.getByRole("dialog", { name: "Room settings" });
    await dialog.getByRole("button", { name: "Delete room" }).click();
    await dialog.getByRole("button", { name: "Confirm: Delete room" }).click();
    await expect(page.locator(".sidebar .rooms li")).toHaveCount(0);
    await expect(page.getByText("No conversation selected")).toBeVisible();
  });
});
