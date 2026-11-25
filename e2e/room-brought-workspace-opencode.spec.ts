import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { FakeClaudeApi, fakeClaudeEnvironment } from "./fake-claude-api.ts";
import { addWorkspace, createProfile, createRoom, inviteIntoRoom, joinRoom, nameMachine, nameOwnProfile, reachedAtOwnPort, roomCard, signIn } from "./helpers.ts";
import { ScriptedModel, scriptedOpencodeEnvironment } from "./scripted-model.ts";
import { TestHost } from "./test-host.ts";

test.describe.configure({ mode: "serial" });

const opencodeVersion = (() => {
  const res = spawnSync(process.platform === "win32" ? "where" : "which", ["opencode"], { encoding: "utf8" });
  if (res.status !== 0) return null;
  const ver = spawnSync("opencode", ["--version"], { encoding: "utf8" });
  const match = /(?:^|\bv)(\d+)\.\d+\.\d+/.exec(`${ver.stdout ?? ""}\n${ver.stderr ?? ""}`);
  return match ? Number(match[1]) : null;
})();

const api = new FakeClaudeApi();
const model = new ScriptedModel();
const owners = new TestHost({ environment: (port) => ({ ...reachedAtOwnPort(port), ...fakeClaudeEnvironment(api) }) });
const mias = new TestHost();
const MIAS_SECRET = "OPENCODE-SECRET-ON-MIAS-COMPUTER";

let ann: Page;
let mia: Page;

test.beforeAll(async ({ browser }) => {
  if ((opencodeVersion ?? 0) < 2) return;
  api.limited = false;
  await Promise.all([api.start(), model.start()]);
  await Promise.all([owners.start(), mias.start()]);
  writeFileSync(join(owners.projectDir, "notes.txt"), "Sow the beets\n");

  // Plant user config in Mia's opencode config dir to prove it never leaks.
  const miasOpencodeConfig = join(mias.root, "opencode-config", "opencode");
  mkdirSync(miasOpencodeConfig, { recursive: true });
  writeFileSync(join(miasOpencodeConfig, "AGENTS.md"), `${MIAS_SECRET}\n`);

  ann = await (await browser.newContext()).newPage();
  mia = await (await browser.newContext()).newPage();
});

test.afterAll(async () => {
  if ((opencodeVersion ?? 0) < 2) return;
  await Promise.all([owners.stop(), mias.stop()]);
  await Promise.all([owners.cleanUp(), mias.cleanUp()]);
  api.stop();
  model.stop();
});

test.skip((opencodeVersion ?? 0) < 2, "opencode 2+ is not installed");

test("Mia brings her opencode agent to work in the room's workspace: it reads and edits there after Ann's OK, and leaks nothing of Mia's setup", async () => {
  test.setTimeout(120_000);
  await signIn(ann, owners);
  await nameOwnProfile(ann, "Ann");
  await addWorkspace(ann, owners.projectDir);
  await nameMachine(ann, "Ann's machine");
  const annProfiles = await createProfile(ann, "Claude", "", "");
  await annProfiles.getByRole("button", { name: "Close" }).click();
  await createRoom(ann, "Garden", ["Claude"]);
  const invite = await inviteIntoRoom(ann, "Garden", { role: "Member" });

  await signIn(mia, mias);
  await nameOwnProfile(mia, "Mia");
  await addWorkspace(mia, mias.projectDir);
  const miaProfiles = await createProfile(mia, "OpenCoder", scriptedOpencodeEnvironment(model, mias.root), "", "opencode");
  await miaProfiles.getByRole("button", { name: "Close" }).click();
  await expect(await joinRoom(mia, invite)).toHaveCount(0);

  const joined = roomCard(mia, "Garden").and(mia.locator(".joined-room"));
  await joined.hover();
  await joined.getByRole("button", { name: "More for Garden" }).click();
  await mia.getByRole("menuitem", { name: "Bring an agent…" }).click();
  const dialog = mia.getByRole("dialog", { name: "Bring an agent into Garden" });
  await dialog.getByRole("combobox", { name: /^Agent/ }).selectOption({ label: "OpenCoder" });
  await dialog.getByRole("combobox", { name: /^Workspace/ }).selectOption({ label: "The room's workspace, on Ann's machine" });
  await dialog.getByLabel("Any time").check();
  await dialog.getByRole("button", { name: "Bring", exact: true }).click();
  await expect(dialog).toHaveCount(0);

  await roomCard(ann, "Garden").click();
  const accessCard = ann.locator("[data-workspace-access-asked]");
  await expect(accessCard).toContainText("OpenCoder (Mia) asks to work in this room's workspace");
  await accessCard.getByRole("button", { name: "Let it work here" }).click();
  await expect(accessCard).toHaveCount(0);

  const composer = ann.getByRole("textbox", { name: "Write in Garden, @ tags an agent…" });
  const answers = ann.locator(".room-timeline .room-entry").filter({ has: ann.locator(".author", { hasText: "OpenCoder (Mia)" }) });
  const giveTask = async (line: string) => {
    await composer.fill("@Op");
    await ann.getByRole("listbox", { name: "Agents and people of the room" }).getByRole("option", { name: "@OpenCoder (Mia)" }).click();
    await composer.fill(`@OpenCoder (Mia)\n${line}`);
    await composer.press("Enter");
  };

  await giveTask('CALL room_read {"path":"notes.txt"}');
  await expect(answers.last().locator(".message.agent")).toContainText("Sow the beets", { timeout: 60_000 });

  await giveTask('CALL room_edit {"path":"notes.txt","old":"beets","new":"carrots"}');
  const callCard = ann.locator("[data-workspace-call-asked]");
  await expect(callCard).toContainText("notes.txt", { timeout: 60_000 });
  await callCard.getByRole("button", { name: "Allow" }).click();
  await expect(answers.last().locator(".message.agent")).toContainText("Tool result:", { timeout: 60_000 });
  expect(readFileSync(join(owners.projectDir, "notes.txt"), "utf8")).toBe("Sow the carrots\n");

  const offered = model.toolsOfferedWith('CALL room_read {"path":"notes.txt"}');
  expect(offered.filter((name) => name.includes("canvas")).toSorted()).toEqual([
    "canvas_ask",
    "canvas_room_edit",
    "canvas_room_read",
    "canvas_room_run",
    "canvas_show",
  ]);
  expect(offered).not.toContain("bash");
  expect(offered).not.toContain("read");
  expect(model.textsSent().some((sent) => sent.includes(MIAS_SECRET))).toBe(false);
  expect(existsSync(join(mias.dataDir, "brought-agents-config", "opencode"))).toBe(true);
});
