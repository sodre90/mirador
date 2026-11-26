import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { FakeClaudeApi, fakeClaudeEnvironment } from "./fake-claude-api.ts";
import { addWorkspace, conversationSettings, createProfile, createRoom, inviteIntoRoom, joinRoom, nameMachine, nameOwnProfile, openRoomSettings, reachedAtOwnPort, roomCard, signIn, whatItMeans } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

test.describe.configure({ mode: "serial" });

const api = new FakeClaudeApi();
/** Ann's machine, with the room and its workspace. */
const owners = new TestHost({ environment: (port) => ({ ...reachedAtOwnPort(port), ...fakeClaudeEnvironment(api) }) });
/** Mia's own Mirador, which joins Ann's room and brings a Claude agent of hers to work in the room's workspace. */
const mias = new TestHost({ environment: () => fakeClaudeEnvironment(api), fakePrograms: true });
/** Where the spec leaves its screenshots of the bring dialog, the cards and the thread, when asked to. */
const screenshotsDir = process.env.ROOMS_BROUGHT_SCREENSHOTS;

const MIAS_SECRET = "SECRET-ON-MIAS-COMPUTER";
const inRoomsWorkspace = (...path: string[]) => join(owners.projectDir, ...path);
const coderFolders = () => readdirSync(join(mias.dataDir, "brought-agents"));

let ann: Page;
let mia: Page;
/** Those Ann let into her machine before; none is in the room yet. */
let admitted: Record<"Pat" | "Gus" | "Max", ReturnType<TestHost["admitPerson"]>>;

test.beforeAll(async ({ browser }) => {
  writeBunProgram(mias.fakeProgramsDir, "codex", join(import.meta.dirname, "fake-acp-agent.ts"));
  api.limited = false;
  await api.start();
  await Promise.all([owners.start(), mias.start()]);
  admitted = { Pat: owners.admitPerson("Pat"), Gus: owners.admitPerson("Gus"), Max: owners.admitPerson("Max") };
  writeFileSync(inRoomsWorkspace("notes.txt"), "Sow the beets\n");
  writeFileSync(join(mias.projectDir, "secret.txt"), `${MIAS_SECRET}\n`);
  if (screenshotsDir) mkdirSync(screenshotsDir, { recursive: true });
  ann = await (await browser.newContext()).newPage();
  mia = await (await browser.newContext()).newPage();
});
test.afterAll(async () => {
  await Promise.all([owners.stop(), mias.stop()]);
  await Promise.all([owners.cleanUp(), mias.cleanUp()]);
  api.stop();
});

const screenshot = async (page: Page, name: string) => {
  if (screenshotsDir) await page.screenshot({ path: join(screenshotsDir, `${name}.png`) });
};

const composer = (page: Page) => page.getByRole("textbox", { name: "Write in Garden, @ tags an agent…" });
const agentChip = (page: Page) => page.locator(".room-header .agent-chip", { hasText: "Coder (Mia)" });
const answersOfCoder = (page: Page) => page.locator(".room-timeline .room-entry").filter({ has: page.locator(".author", { hasText: "Coder (Mia)" }) });
const accessCard = (page: Page) => page.locator("[data-workspace-access-asked]");
const callCard = (page: Page) => page.locator("[data-workspace-call-asked]");
const thread = (page: Page) => page.locator(".room-thread");
const callsInThread = (page: Page) => thread(page).locator("[data-workspace-call]");

const joinedCard = () => roomCard(mia, "Garden").and(mia.locator(".joined-room"));

async function chooseInMenuOfJoinedRoom(item: string) {
  await joinedCard().hover();
  await joinedCard().getByRole("button", { name: "More for Garden" }).click();
  await mia.getByRole("menuitem", { name: item, exact: true }).click();
}

async function takeOutOfJoinedRoom(agent: string) {
  await chooseInMenuOfJoinedRoom(`Take out ${agent}`);
  await mia.getByRole("menuitem", { name: `Confirm: Take out ${agent}` }).click();
}

async function bringDialog(profile: string) {
  await chooseInMenuOfJoinedRoom("Bring an agent…");
  const dialog = mia.getByRole("dialog", { name: "Bring an agent into Garden" });
  await dialog.getByRole("combobox", { name: /^Agent/ }).selectOption({ label: profile });
  await dialog.getByRole("combobox", { name: /^Workspace/ }).selectOption({ label: "The room's workspace, on Ann's machine" });
  await dialog.getByLabel("Any time").check();
  return dialog;
}

async function bringCoder() {
  const dialog = await bringDialog("Coder");
  await dialog.getByRole("button", { name: "Bring", exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

/** Ann gives Mia's agent a task, which its model answers by calling the tools of these `CALL ` lines. */
async function giveTask(words: string, calls: string) {
  api.callsWhenSaid.set(words, calls);
  await composer(ann).fill("@Co");
  await ann.getByRole("listbox", { name: "Agents and people of the room" }).getByRole("option", { name: "@Coder (Mia)" }).click();
  await composer(ann).fill(`@Coder (Mia) ${words}`);
  await composer(ann).press("Enter");
}

const openThreadOf = (page: Page, task: string) => answersOfCoder(page).filter({ hasText: task }).last().getByRole("button", { name: "Open thread" }).click();

const lastAnswer = (page: Page) => answersOfCoder(page).last().locator(".message.agent");

async function makeProfile(page: Page, name: string, agent?: string) {
  const profiles = await createProfile(page, name, "", "", agent);
  await profiles.getByRole("button", { name: "Close" }).click();
}

test("Mia brings her Claude agent to work in the room's workspace, and nothing of her computer comes with it", async () => {
  await signIn(ann, owners);
  await nameOwnProfile(ann, "Ann");
  await addWorkspace(ann, owners.projectDir);
  await nameMachine(ann, "Ann's machine");
  await makeProfile(ann, "Claude");
  await createRoom(ann, "Garden", ["Claude"]);
  const invite = await inviteIntoRoom(ann, "Garden", { role: "Member" });

  await signIn(mia, mias);
  await nameOwnProfile(mia, "Mia");
  await addWorkspace(mia, mias.projectDir);
  await makeProfile(mia, "Other", "Codex");
  await makeProfile(mia, "Coder");
  await expect(await joinRoom(mia, invite)).toHaveCount(0);

  await test.step("the dialog defaults to the room's workspace and a profile that works there, and says what it means", async () => {
    await chooseInMenuOfJoinedRoom("Bring an agent…");
    const dialog = mia.getByRole("dialog", { name: "Bring an agent into Garden" });
    await expect(dialog.getByRole("combobox", { name: /^Workspace/ })).toHaveValue("");
    await expect(dialog.getByRole("combobox", { name: /^Agent/ }).locator("option:checked")).toHaveText("Claude Code");
    await expect(dialog.getByRole("button", { name: "Bring", exact: true })).toBeEnabled();
    await dialog.getByRole("combobox", { name: /^Agent/ }).selectOption({ label: "Other" });
    await expect(dialog).toContainText("Only Claude Code, pi and opencode profiles can work in the room's workspace so far.");
    await expect(dialog.getByRole("button", { name: "Bring", exact: true })).toBeDisabled();
    await dialog.getByRole("combobox", { name: /^Agent/ }).selectOption({ label: "Coder" });
    await dialog.getByLabel("Any time").check();
    await expect(dialog).not.toContainText("Only Claude Code, pi and opencode profiles");
    const meaning = (await whatItMeans(mia, dialog)).join("\n");
    expect(meaning).toContain("has nothing else of this computer: no files, no commands");
    expect(meaning).toContain("tells the agent your account's email address");
    expect(meaning).toContain("they allow each change and each command");
    await screenshot(mia, "workspace-bring-dialog");
    await dialog.getByRole("button", { name: "Bring", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(joinedCard()).toContainText("Coder (room's workspace)");
  });

  await test.step("its conversation is in a workspace named after the room, with an empty folder", async () => {
    await expect(mia.locator(".sidebar .workspace", { hasText: "Garden · Ann's machine" })).toBeVisible();
    expect(coderFolders()).toHaveLength(1);
    expect(readdirSync(join(mias.dataDir, "brought-agents", coderFolders()[0]!))).toEqual([]);
  });

  await test.step("which is no workspace of hers to bring another agent to work in", async () => {
    const dialog = await bringDialog("Coder");
    await expect(dialog.getByRole("combobox", { name: /^Workspace/ }).locator("option")).toHaveText(["The room's workspace, on Ann's machine", basename(mias.projectDir)]);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
  });
});

test("Ann lets it in, and it reads the room's workspace, changes a file and runs a command there, each only after her OK", async () => {
  await test.step("before she does, its call is refused", async () => {
    await roomCard(ann, "Garden").click();
    await expect(accessCard(ann)).toContainText("Coder (Mia) asks to work in this room's workspace");
    await expect(accessCard(ann)).toContainText("each change and each command asks first");
    await expect(agentChip(ann)).toHaveAttribute("data-hint", "On Mia's computer · Waits to be let into this room's workspace");
    await ann.locator(".room-here-count").click();
    await expect(ann.locator(".room-people .room-people-agent-workspace")).toHaveText("Waits to be let into this room's workspace");
    await ann.keyboard.press("Escape");
    await screenshot(ann, "workspace-access-card");
    await giveTask("COUNT THE BEDS", 'CALL mcp__canvas__room_read {"path":"notes.txt"}');
    await expect(lastAnswer(ann)).toContainText("has not let you work in its workspace", { timeout: 60_000 });
  });

  await test.step("the model is offered the canvas and the room's workspace, and nothing else", async () => {
    const [, offered] = [...api.tools].find(([typed]) => typed.includes("COUNT THE BEDS"))!;
    expect(offered.toSorted()).toEqual(["ask", "room_edit", "room_read", "room_run", "show"].map((tool) => `mcp__canvas__${tool}`));
  });

  await test.step("let in, it reads a file", async () => {
    await accessCard(ann).getByRole("button", { name: "Let it work here" }).click();
    await expect(accessCard(ann)).toHaveCount(0);
    await expect(agentChip(ann)).toHaveAttribute("data-hint", "On Mia's computer · Works in this room's workspace");
    await ann.locator(".room-here-count").click();
    await expect(ann.locator(".room-people .room-people-agent-workspace")).toHaveText("Works in this room's workspace");
    await ann.keyboard.press("Escape");
    await giveTask("READ THE NOTES", 'CALL mcp__canvas__room_read {"path":"notes.txt"}');
    await expect(lastAnswer(ann)).toContainText("Sow the beets", { timeout: 60_000 });
    await expect(callCard(ann)).toHaveCount(0);
  });

  await test.step("a change shows as a diff to Ann, and is made once she allows it", async () => {
    await giveTask("CHANGE THE NOTES", 'CALL mcp__canvas__room_edit {"path":"notes.txt","old":"beets","new":"peas"}\nTHEN Peas it is.');
    await expect(callCard(ann)).toContainText("Coder (Mia) asks to change a file", { timeout: 60_000 });
    await expect(callCard(ann).locator(".workspace-call-path")).toHaveText("notes.txt");
    await expect(callCard(ann).locator(".diff-removed")).toHaveText("-Sow the beets");
    await expect(callCard(ann).locator(".diff-added")).toHaveText("+Sow the peas");
    await expect(callCard(ann)).toContainText("Your task: “@Coder (Mia) CHANGE THE NOTES”");
    await expect(ann.locator(".room-timeline")).toContainText("Coder (Mia) is waiting for approval");
    await screenshot(ann, "workspace-change-card");
    expect(readFileSync(inRoomsWorkspace("notes.txt"), "utf8")).toBe("Sow the beets\n");
    await callCard(ann).getByRole("button", { name: "Allow" }).click();
    await expect(callCard(ann)).toHaveCount(0);
    await expect(lastAnswer(ann)).toHaveText("Peas it is.", { timeout: 60_000 });
    expect(readFileSync(inRoomsWorkspace("notes.txt"), "utf8")).toBe("Sow the peas\n");
  });

  await test.step("a command shows whole, with what it runs as, and runs in the room's workspace once she allows it", async () => {
    await giveTask("COPY THE NOTES", `CALL mcp__canvas__room_run {"command":"cat notes.txt > copy.txt\\npwd\\ncat ${join(mias.projectDir, "nothing-here.txt")} || true"}\nTHEN Copied.`);
    await expect(callCard(ann)).toContainText("Coder (Mia) asks to run a command", { timeout: 60_000 });
    await expect(callCard(ann).locator(".workspace-call-text")).toContainText("cat notes.txt > copy.txt");
    await expect(callCard(ann).locator(".workspace-call-text .token.function").first()).toHaveText("cat");
    await expect(callCard(ann)).toContainText("3 lines");
    await expect(callCard(ann)).toContainText("It runs on the room's machine with all its owner may do there, not only in the workspace.");
    await screenshot(ann, "workspace-command-card");
    expect(existsSync(inRoomsWorkspace("copy.txt"))).toBe(false);
    await callCard(ann).getByRole("button", { name: "Allow" }).click();
    await expect(lastAnswer(ann)).toHaveText("Copied.", { timeout: 60_000 });
    expect(readFileSync(inRoomsWorkspace("copy.txt"), "utf8")).toBe("Sow the peas\n");
    expect(existsSync(join(mias.projectDir, "copy.txt"))).toBe(false);
  });

  await test.step("a denied command does not run, and the agent is told", async () => {
    await giveTask("DROP THE NOTES", 'CALL mcp__canvas__room_run {"command":"rm notes.txt"}');
    await expect(callCard(ann)).toContainText("rm notes.txt", { timeout: 60_000 });
    await callCard(ann).getByRole("button", { name: "Deny" }).click();
    await expect(lastAnswer(ann)).toContainText("Whoever approves in the room said no.", { timeout: 60_000 });
    expect(existsSync(inRoomsWorkspace("notes.txt"))).toBe(true);
  });
});

test("a task's thread shows what it did there and who allowed it; Ann takes the workspace away from there, and a call that waits ends with it", async () => {
  await test.step("a read, a change, a command and a denied command each show in the thread of their task", async () => {
    const shownFor = async (task: string) => {
      await openThreadOf(ann, task);
      await expect(callsInThread(ann)).toHaveCount(1);
      await callsInThread(ann).locator("summary").click();
      return callsInThread(ann);
    };
    const summaryOf = (call: Locator) => call.locator("summary");
    await expect(summaryOf(await shownFor("READ THE NOTES"))).toContainText("Readnotes.txtdone");
    const changed = await shownFor("CHANGE THE NOTES");
    await expect(summaryOf(changed)).toContainText("Changenotes.txtdone");
    await expect(changed).toContainText("Allowed by Ann");
    await expect(changed.locator(".diff-added")).toHaveText("+Sow the peas");
    const ran = await shownFor("COPY THE NOTES");
    await expect(summaryOf(ran).locator(".workspace-call-about .token.function").first()).toHaveText("cat");
    await expect(ran.locator(".workspace-call-text.highlighted-code .token.function").first()).toHaveText("cat");
    await expect(ran).toContainText("It exited with 0.");
    await expect(ran.locator(".workspace-call-text").last()).toContainText(owners.projectDir);
    await screenshot(ann, "workspace-thread");
    const denied = await shownFor("DROP THE NOTES");
    await expect(summaryOf(denied)).toContainText("denied");
    await expect(denied).toContainText("Denied by Ann");
    await expect(thread(ann).locator(".workspace-access")).toContainText("Works in this room's workspace");
  });

  await test.step("taken away, what waits stops, and its next call is refused", async () => {
    await giveTask("DROP THEM AGAIN", 'CALL mcp__canvas__room_run {"command":"rm notes.txt"}');
    await expect(callCard(ann).first()).toBeVisible({ timeout: 60_000 });
    const takeAway = thread(ann).getByRole("button", { name: "Take this room's workspace away from Coder (Mia)" });
    await takeAway.click();
    await takeAway.click();
    await expect(callCard(ann)).toHaveCount(0);
    await expect(thread(ann).locator(".workspace-access")).toContainText("Not let into this room's workspace");
    await expect(lastAnswer(ann)).toContainText("It was stopped.", { timeout: 60_000 });
    await giveTask("READ THEM AGAIN", 'CALL mcp__canvas__room_read {"path":"notes.txt"}');
    await expect(lastAnswer(ann)).toContainText("has not let you work in its workspace", { timeout: 60_000 });
  });

  await test.step("let in again from the room's settings", async () => {
    const settings = await openRoomSettings(ann, "Garden", "Agents");
    const brought = settings.getByRole("list", { name: "Agents people brought" });
    await expect(brought).toContainText("Not let into this room's workspace");
    await brought.getByRole("button", { name: "Let Coder (Mia) work in this room's workspace" }).click();
    await expect(brought).toContainText("Works in this room's workspace");
    await screenshot(ann, "workspace-in-settings");
    await settings.getByRole("button", { name: "Close" }).click();
    await giveTask("READ THEM ONCE MORE", 'CALL mcp__canvas__room_read {"path":"notes.txt"}');
    await expect(lastAnswer(ann)).toContainText("Sow the peas", { timeout: 60_000 });
  });
});

test("an approver allows its calls too, a guest sees none of them, and a member's task for it waits", async ({ browser }) => {
  const pageOf = async ({ cookie }: ReturnType<TestHost["admitPerson"]>) => {
    const context = await browser.newContext();
    await context.addCookies([cookie]);
    const page = await context.newPage();
    await page.goto(owners.origin);
    await roomCard(page, "Garden").click();
    return page;
  };
  const settings = await openRoomSettings(ann, "Garden", "People");
  for (const [name, role] of [["Pat", "Approver"], ["Gus", "Guest"], ["Max", "Member"]] as const) {
    await settings.getByRole("combobox", { name: "Add someone you let in before" }).selectOption({ label: name });
    await settings.getByLabel(`Role of ${name}`).selectOption({ label: role });
  }
  await settings.getByRole("button", { name: "Close" }).click();
  const [pat, gus, max] = await Promise.all([pageOf(admitted.Pat), pageOf(admitted.Gus), pageOf(admitted.Max)]);

  await test.step("Max's task waits for an approver, and opens the workspace once Pat allows it", async () => {
    api.callsWhenSaid.set("WEED THE NOTES", 'CALL mcp__canvas__room_edit {"path":"notes.txt","old":"peas","new":"beans"}\nTHEN Beans it is.');
    await composer(max).fill("@Co");
    await max.getByRole("listbox", { name: "Agents and people of the room" }).getByRole("option", { name: "@Coder (Mia)" }).click();
    await composer(max).fill("@Coder (Mia) WEED THE NOTES");
    await composer(max).press("Enter");
    const task = pat.locator(".room-task-approval");
    await expect(task).toContainText("WEED THE NOTES");
    await task.getByRole("button", { name: "Allow" }).click();
    await expect(callCard(pat)).toContainText("Task of Max (Member): “@Coder (Mia) WEED THE NOTES”", { timeout: 60_000 });
    await expect(callCard(pat).locator(".diff-added")).toHaveText("+Sow the beans");
  });

  await test.step("neither Gus nor Max is asked, and Pat allows it", async () => {
    await expect(callCard(gus)).toHaveCount(0);
    await expect(callCard(max)).toHaveCount(0);
    await callCard(pat).getByRole("button", { name: "Allow" }).click();
    await expect(lastAnswer(pat)).toHaveText("Beans it is.", { timeout: 60_000 });
    expect(readFileSync(inRoomsWorkspace("notes.txt"), "utf8")).toBe("Sow the beans\n");
  });

  await test.step("its thread shows what it did to Pat, and to Gus and Max only its answers", async () => {
    await openThreadOf(pat, "WEED THE NOTES");
    await callsInThread(pat).locator("summary").click();
    await expect(callsInThread(pat)).toContainText("Allowed by Pat");
    await expect(thread(pat).getByRole("button", { name: "Take this room's workspace away from Coder (Mia)" })).toBeVisible();
    for (const page of [gus, max]) {
      await openThreadOf(page, "WEED THE NOTES");
      await expect(thread(page)).toContainText("Beans it is.");
      await expect(callsInThread(page)).toHaveCount(0);
      await expect(thread(page).getByRole("button", { name: "Take this room's workspace away from Coder (Mia)" })).toHaveCount(0);
    }
  });
  await Promise.all([pat, gus, max].map((page) => page.context().close()));
});

test("nothing of Mia's computer went to the model, and once she takes it out it is gone from the room", async () => {
  expect(api.history.map((messages) => messages.join("\n")).filter((sent) => sent.includes(MIAS_SECRET))).toEqual([]);
  await takeOutOfJoinedRoom("Coder");
  await expect(agentChip(ann)).toHaveCount(0);
  await bringCoder();
  await expect(accessCard(ann)).toContainText("Coder (Mia) asks to work in this room's workspace");
  expect(coderFolders()).toHaveLength(1);
});

test("brought to work in a workspace of hers, it runs in the mode that asks, though her settings start Claude in one that never does", async () => {
  writeFileSync(join(mias.claudeConfigDir, "settings.json"), JSON.stringify({ permissions: { defaultMode: "bypassPermissions" }, skipDangerousModePermissionPrompt: true }));
  await takeOutOfJoinedRoom("Coder");
  await expect(agentChip(ann)).toHaveCount(0);
  const dialog = await bringDialog("Coder");
  await dialog.getByRole("combobox", { name: /^Workspace/ }).selectOption({ label: basename(mias.projectDir) });
  await dialog.getByRole("button", { name: "Bring", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(agentChip(ann)).toBeVisible();

  const hers = mia.getByRole("region", { name: basename(mias.projectDir), exact: true });
  const modeOfOpenConversation = async () => (await conversationSettings(mia)).getByLabel("Mode", { exact: true });
  await test.step("as a conversation of her own does not", async () => {
    await hers.getByLabel("Agent", { exact: true }).selectOption({ label: "Coder · Claude Code" });
    await hers.getByRole("button", { name: "+ New conversation" }).click();
    await expect(mia.locator(".chat-header:visible h2")).toHaveText("New conversation");
    await expect(await modeOfOpenConversation()).toHaveValue("bypassPermissions", { timeout: 60_000 });
    await mia.keyboard.press("Escape");
  });

  await hers.locator(".conversation-title", { hasText: "Garden · Ann's machine" }).click();
  await expect(mia.locator(".chat-header:visible h2")).toHaveText("Garden · Ann's machine");
  const mode = await modeOfOpenConversation();
  await expect(mode).toHaveValue("default", { timeout: 60_000 });
  const offered = await mode.locator("option").evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
  expect(offered).toEqual(["default", "acceptEdits"]);
});
