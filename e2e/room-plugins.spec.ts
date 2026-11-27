import { execFileSync } from "node:child_process";
import { cpSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, callCanvasTool, createProfile, createRoom, openRoomSettings, roomCard, signIn } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

test.describe.configure({ mode: "serial" });

const host = new TestHost({ fakePrograms: true });
const promptsFile = () => join(host.root, "builder-prompts");
const boardFolder = () => join(host.dataDir, "plugins", "board");
const counterFolder = () => join(host.dataDir, "plugins", "counter");

test.beforeAll(async () => {
  cpSync(join(import.meta.dirname, "..", "tests", "fixtures", "canvas-plugins", "board"), boardFolder(), { recursive: true });
  cpSync(join(import.meta.dirname, "..", "tests", "fixtures", "apps", "counter"), counterFolder(), { recursive: true });
  writeBunProgram(host.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"), { FAKE_ACP_PROMPTS: promptsFile() });
  writeFileSync(promptsFile(), "");
  await host.start();
  writeFileSync(join(host.projectDir, "note.txt"), "shared room note");
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const roomComposer = (page: Page) => page.getByRole("textbox", { name: "Write in Launch, @ tags an agent…" });
const pageView = (page: Page) => page.frameLocator(".canvas-panel:visible .canvas-body > .canvas-frame.plugin iframe");
const tabView = (page: Page) => page.frameLocator(".checklist:visible .canvas-frame.plugin iframe");
const appView = (page: Page) => page.frameLocator(".canvas-panel:visible .app-view .canvas-frame.app iframe");
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

test("owner opts an app plugin into a room, members edit and read workspace files live, only approvers run host tasks, and guests stay view-only", async ({ page, browser }) => {
  const nora = host.admitPerson("Nora");
  const ava = host.admitPerson("Ava");
  const otto = host.admitPerson("Otto");
  await signIn(page, host);
  await createRoom(page, "AppRoom", ["Builder"]);

  const appRoomComposer = page.getByRole("textbox", { name: "Write in AppRoom, @ tags an agent…" });
  await appRoomComposer.fill("@Bu");
  await page.getByRole("listbox", { name: "Agents and people of the room" }).getByRole("option", { name: "@Builder" }).click();
  await appRoomComposer.pressSequentially(" SAY Ready for apps");
  await appRoomComposer.press("Enter");
  await expect(roomMessages(page)).toContainText(["Ready for apps"]);

  await test.step("owner adds Nora (Member), Ava (Approver), Otto (Guest) and enables Counter in Room Settings → Plugins", async () => {
    const dialog = await openRoomSettings(page, "AppRoom");
    await dialog.getByRole("combobox", { name: "Add someone you let in before" }).selectOption({ label: "Nora" });
    await dialog.getByLabel("Role of Nora").selectOption({ label: "Member" });
    await dialog.getByRole("combobox", { name: "Add someone you let in before" }).selectOption({ label: "Ava" });
    await dialog.getByLabel("Role of Ava").selectOption({ label: "Approver" });
    await dialog.getByRole("combobox", { name: "Add someone you let in before" }).selectOption({ label: "Otto" });
    await dialog.getByLabel("Role of Otto").selectOption({ label: "Guest" });
    await dialog.getByRole("switch", { name: "People's tasks start without asking me" }).click();
    await dialog.getByRole("tab", { name: "Plugins" }).click();
    await dialog.getByRole("switch", { name: "Use Counter in this room" }).click();
    await dialog.getByRole("button", { name: "Change" }).click();
    await expect(dialog.getByRole("switch", { name: "Use Counter in this room" })).toBeChecked();
    await dialog.getByRole("button", { name: "Close" }).click();
  });

  const convId = roomConversationId("AppRoom");
  const openAs = async (person: ReturnType<typeof host.admitPerson>) => {
    const context = await browser.newContext();
    await context.addCookies([person.cookie]);
    const p = await context.newPage();
    await p.goto(host.origin);
    await roomCard(p, "AppRoom").click();
    return { context, page: p };
  };
  const noraSession = await openAs(nora);
  const avaSession = await openAs(ava);
  const ottoSession = await openAs(otto);

  await test.step("agent opens Counter on count.counter.json and every participant sees the live app", async () => {
    expect(await listTools(convId)).toContain("app_open");
    expect(await callCanvasTool(host, convId, "app_open", { app: "counter", file: "count.counter.json" })).toContain("Counter is open on count.counter.json");

    for (const viewer of [page, noraSession.page, avaSession.page, ottoSession.page]) {
      await expect(viewer.locator(".canvas-panel:visible .app-toggle", { hasText: "Counter" })).toBeVisible();
      await expect(appView(viewer).locator("#count")).toHaveText("0");
    }
  });

  await test.step("member Nora edits the count, reads a workspace file, prompts through the room, and cannot run host tasks", async () => {
    await appView(noraSession.page).getByRole("button", { name: "Add one" }).click();
    await expect(appView(noraSession.page).locator("#count")).toHaveText("1");
    await expect(appView(page).locator("#count")).toHaveText("1");
    await expect(appView(ottoSession.page).locator("#count")).toHaveText("1");

    await appView(noraSession.page).getByRole("button", { name: "Read the note" }).click();
    await expect(appView(noraSession.page).locator("#file-text")).toHaveText("shared room note");

    await appView(noraSession.page).getByRole("button", { name: "Ask about the count" }).click();
    await expect(roomMessages(page)).toContainText(["Is 1 a good count?"]);

    // Member cannot run host tasks (count-up adds 3).
    await appView(noraSession.page).getByRole("button", { name: "Count up" }).click();
    await expect(appView(page).locator("#count")).toHaveText("1");
  });

  await test.step("approver Ava runs Count up and everyone sees the task finish", async () => {
    await appView(avaSession.page).getByRole("button", { name: "Count up" }).click();
    await expect(appView(avaSession.page).locator("#task")).toContainText("count-up done");
    await expect(appView(page).locator("#count")).toHaveText("4");
    await expect(appView(noraSession.page).locator("#count")).toHaveText("4");
  });

  await test.step("guest Otto cannot edit the count, and disabling Counter closes the shared tab", async () => {
    await appView(ottoSession.page).getByRole("button", { name: "Add one" }).click();
    await expect(appView(page).locator("#count")).toHaveText("4");

    const dialog = await openRoomSettings(page, "AppRoom");
    await dialog.getByRole("tab", { name: "Plugins" }).click();
    await dialog.getByRole("switch", { name: "Use Counter in this room" }).click();
    await dialog.getByRole("button", { name: "Change" }).click();
    await dialog.getByRole("button", { name: "Close" }).click();

    await expect(page.locator(".canvas-panel:visible .app-toggle", { hasText: "Counter" })).toHaveCount(0);
    await expect(noraSession.page.locator(".canvas-panel:visible .app-toggle", { hasText: "Counter" })).toHaveCount(0);
  });

  await noraSession.context.close();
  await avaSession.context.close();
  await ottoSession.context.close();
});

test("privileged agent app_run tasks and member plugin prompts wait in ApprovalStrip for an approver", async ({ page, browser }) => {
  const lena = host.admitPerson("Lena");
  const sam = host.admitPerson("Sam");
  await signIn(page, host);
  await createRoom(page, "GateRoom", ["Builder"]);

  const gateComposer = page.getByRole("textbox", { name: "Write in GateRoom, @ tags an agent…" });
  await gateComposer.fill("@Bu");
  await page.getByRole("listbox", { name: "Agents and people of the room" }).getByRole("option", { name: "@Builder" }).click();
  await gateComposer.pressSequentially(" SAY Gate ready");
  await gateComposer.press("Enter");
  await expect(roomMessages(page)).toContainText(["Gate ready"]);

  await test.step("owner adds Lena (Member) and Sam (Approver), keeps peoplesTasksWait on, and enables Board + Counter", async () => {
    const dialog = await openRoomSettings(page, "GateRoom");
    await dialog.getByRole("combobox", { name: "Add someone you let in before" }).selectOption({ label: "Lena" });
    await dialog.getByLabel("Role of Lena").selectOption({ label: "Member" });
    await dialog.getByRole("combobox", { name: "Add someone you let in before" }).selectOption({ label: "Sam" });
    await dialog.getByLabel("Role of Sam").selectOption({ label: "Approver" });
    await dialog.getByRole("tab", { name: "Plugins" }).click();
    await dialog.getByRole("switch", { name: "Use Board in this room" }).click();
    await dialog.getByRole("button", { name: "Change" }).click();
    await expect(dialog.getByRole("switch", { name: "Use Board in this room" })).toBeChecked();
    await dialog.getByRole("switch", { name: "Use Counter in this room" }).click();
    await expect(dialog.getByRole("switch", { name: "Use Counter in this room" })).toBeChecked();
    await dialog.getByRole("button", { name: "Close" }).click();
  });

  const convId = roomConversationId("GateRoom");
  const openAs = async (person: ReturnType<typeof host.admitPerson>) => {
    const context = await browser.newContext();
    await context.addCookies([person.cookie]);
    const p = await context.newPage();
    await p.goto(host.origin);
    await roomCard(p, "GateRoom").click();
    return { context, page: p };
  };
  const lenaSession = await openAs(lena);
  const samSession = await openAs(sam);

  await test.step("agent app_run waits in ApprovalStrip for approver Sam (never shown to member Lena), supports Deny and Allow", async () => {
    expect(await callCanvasTool(host, convId, "app_open", { app: "counter", file: "gate.counter.json" })).toContain("Counter is open on gate.counter.json");
    await expect(appView(samSession.page).locator("#count")).toHaveText("0");

    const deniedCall = callCanvasTool(host, convId, "app_run", { app: "counter", task: "count-up" });
    const samApproval = samSession.page.locator(".room-approvals");
    await expect(samApproval).toContainText("Run Counter task");
    await expect(lenaSession.page.locator(".room-approvals")).toHaveCount(0);
    await samApproval.getByRole("button", { name: "Deny" }).click();
    expect(await deniedCall).toContain("Whoever approves in the room said no.");
    await expect(appView(samSession.page).locator("#count")).toHaveText("0");

    const allowedCall = callCanvasTool(host, convId, "app_run", { app: "counter", task: "count-up" });
    await expect(samApproval).toContainText("Run Counter task");
    await samApproval.getByRole("button", { name: "Allow", exact: true }).click();
    expect(await allowedCall).toContain("Counted up");
    await expect(appView(samSession.page).locator("#count")).toHaveText("3");
    await expect(appView(lenaSession.page).locator("#count")).toHaveText("3");
  });

  await test.step("member Lena's plugin prompt waits for approval when peoplesTasksWait is on", async () => {
    expect(await callCanvasTool(host, convId, "show_card", { title: "Review", text: "Needs ok" })).toMatch(/^Shown as /);
    await lenaSession.page.locator(".canvas-panel:visible .page-tab").click();
    await pageView(lenaSession.page).getByLabel("Question").fill("SAY Approved plugin prompt");
    await pageView(lenaSession.page).getByRole("button", { name: "Ask the agent" }).click();
    await expect(pageView(lenaSession.page).locator("#asked")).toHaveText("Asked");

    const taskApproval = samSession.page.locator(".room-task-approval");
    await expect(taskApproval).toContainText("SAY Approved plugin prompt");
    await taskApproval.getByRole("button", { name: "Allow", exact: true }).click();
    await expect(roomMessages(page)).toContainText(["Approved plugin prompt"]);
  });

  await lenaSession.context.close();
  await samSession.context.close();
});
