import { execFileSync } from "node:child_process";
import { cpSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, callCanvasTool, createProfile, createRoom, openRoomSettings, roomCard, signIn } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

const host = new TestHost({ fakePrograms: true });
const promptsFile = () => join(host.root, "builder-prompts");
const boardFolder = () => join(host.dataDir, "plugins", "board");

test.beforeAll(async () => {
  cpSync(join(import.meta.dirname, "..", "tests", "fixtures", "canvas-plugins", "board"), boardFolder(), { recursive: true });
  writeBunProgram(host.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"), { FAKE_ACP_PROMPTS: promptsFile() });
  writeFileSync(promptsFile(), "");
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const roomComposer = (page: Page) => page.getByRole("textbox", { name: "Write in Launch, @ tags an agent…" });
const pageView = (page: Page) => page.frameLocator(".canvas-panel:visible .canvas-body > .canvas-frame.plugin iframe");
const tabView = (page: Page) => page.frameLocator(".checklist:visible .canvas-frame.plugin iframe");
const roomMessages = (page: Page) => page.locator(".room-timeline .room-entry .message");

async function tagBuilder(page: Page, rest: string) {
  await roomComposer(page).fill("@Bu");
  await page.getByRole("listbox", { name: "Agents and people of the room" }).getByRole("option", { name: "@Builder" }).click();
  await roomComposer(page).pressSequentially(rest);
  await roomComposer(page).press("Enter");
}

function roomConversationId(roomName: string) {
  return execFileSync("bun", [join(import.meta.dirname, "room-agent-conversations.ts"), join(host.dataDir, "state.sqlite"), roomName], { encoding: "utf8" }).trim();
}

async function listTools(conversationId: string): Promise<string[]> {
  const response = await fetch(`${host.origin}/mcp/${conversationId}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${host.canvasTokenOf(conversationId)}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2025-11-25",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
  const body = await response.text();
  const payload = body.split("\n").find((line) => line.startsWith("data: "))?.slice("data: ".length) ?? body;
  return (JSON.parse(payload).result.tools as { name: string }[]).map(({ name }) => name);
}

test("owner opts a canvas plugin into a room, host agent publishes shared items, members interact live and guests stay view-only", async ({ page, browser }) => {
  const mia = host.admitPerson("Mia");
  const gus = host.admitPerson("Gus");
  await signIn(page, host);
  const profiles = await createProfile(page, "Builder", `OPENCODE_FAKE_ACP_PROMPTS=${promptsFile()}`, "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await addWorkspace(page, host.projectDir, "Builder · opencode");
  await createRoom(page, "Launch", ["Builder"]);

  await test.step("owner lets Mia in as Member, Gus as Guest, and lets people's tasks start without asking", async () => {
    const dialog = await openRoomSettings(page, "Launch");
    await dialog.getByRole("combobox", { name: "Add someone you let in before" }).selectOption({ label: "Mia" });
    await dialog.getByLabel("Role of Mia").selectOption({ label: "Member" });
    await dialog.getByRole("combobox", { name: "Add someone you let in before" }).selectOption({ label: "Gus" });
    await dialog.getByLabel("Role of Gus").selectOption({ label: "Guest" });
    await dialog.getByRole("switch", { name: "People's tasks start without asking me" }).click();
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toBeHidden();
  });

  await test.step("before opting in, the room agent has no board tools", async () => {
    await tagBuilder(page, " SAY Ready");
    await expect(roomMessages(page)).toContainText(["Ready"]);
    const convId = roomConversationId("Launch");
    expect(await listTools(convId)).not.toContain("show_card");
  });

  await test.step("owner enables Board in Room Settings → Plugins", async () => {
    const dialog = await openRoomSettings(page, "Launch");
    await dialog.getByRole("tab", { name: "Plugins" }).click();
    const boardSwitch = dialog.getByRole("switch", { name: "Use Board in this room" });
    await expect(boardSwitch).not.toBeChecked();
    await boardSwitch.click();
    // Builder already worked in the room, so confirm starting afresh.
    await dialog.getByRole("button", { name: "Change" }).click();
    await expect(boardSwitch).toBeChecked();
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toBeHidden();
  });

  const convId = roomConversationId("Launch");

  const miaContext = await browser.newContext();
  await miaContext.addCookies([mia.cookie]);
  const miaPage = await miaContext.newPage();
  await miaPage.goto(host.origin);
  await roomCard(miaPage, "Launch").click();

  const gusContext = await browser.newContext();
  await gusContext.addCookies([gus.cookie]);
  const gusPage = await gusContext.newPage();
  await gusPage.goto(host.origin);
  await roomCard(gusPage, "Launch").click();

  await test.step("enabled plugin tools appear on the room agent and publish shared card & tab items", async () => {
    expect(await listTools(convId)).toContain("show_card");
    expect(await listTools(convId)).not.toContain("plugin_install");

    expect(await callCanvasTool(host, convId, "show_card", { title: "Launch Card", text: "Shared status" })).toMatch(/^Shown as /);
    expect(await callCanvasTool(host, convId, "track_steps", { title: "Release", steps: ["Build", "Ship"] })).toBe("Tracking 2 steps.");

    for (const viewer of [page, miaPage, gusPage]) {
      await expect(viewer.locator(".canvas-panel:visible .checklist-toggle")).toContainText("0/2");
      await viewer.locator(".canvas-panel:visible .page-tab").click();
      await expect(pageView(viewer).locator("#title")).toHaveText("Launch Card");
      await expect(pageView(viewer).locator("#text")).toHaveText("Shared status (pressed 0 times)");
    }
  });

  await test.step("member Mia interacts with the card and prompts the agent through the room; owner sees updates live", async () => {
    await pageView(miaPage).getByRole("button", { name: "Press" }).click();
    await expect(pageView(miaPage).locator("#reply")).toHaveText("Pressed 1 times");
    await expect(pageView(page).locator("#text")).toHaveText("Shared status (pressed 1 times)");

    await pageView(miaPage).getByLabel("Question").fill("SAY Prompt from board");
    await pageView(miaPage).getByRole("button", { name: "Ask the agent" }).click();
    await expect(pageView(miaPage).locator("#asked")).toHaveText("Asked");
    await expect(roomMessages(page)).toContainText(["Prompt from board"]);
  });

  await test.step("guest Gus can view items but cannot act or dismiss the checklist", async () => {
    await pageView(gusPage).getByRole("button", { name: "Press" }).click();
    await expect(pageView(gusPage).locator("#reply")).toContainText("Guests");
    await expect(pageView(page).locator("#text")).toHaveText("Shared status (pressed 1 times)");

    await gusPage.locator(".canvas-panel:visible .checklist-toggle").click();
    await expect(tabView(gusPage).locator("#title")).toHaveText("Release");
    await expect(gusPage.locator(".canvas-panel:visible .checklist-dismiss")).toHaveCount(0);
  });

  await miaContext.close();
  await gusContext.close();
});
