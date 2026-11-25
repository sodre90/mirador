import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { FakeClaudeApi, fakeClaudeEnvironment } from "./fake-claude-api.ts";
import { addWorkspace, createProfile, createRoom, inviteIntoRoom, joinRoom, nameMachine, nameOwnProfile, reachedAtOwnPort, roomCard, signIn } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

test.describe.configure({ mode: "serial" });

const piInstalled = spawnSync(process.platform === "win32" ? "where" : "which", ["pi"]).status === 0;
const api = new FakeClaudeApi();
const owners = new TestHost({ environment: (port) => ({ ...reachedAtOwnPort(port), ...fakeClaudeEnvironment(api) }) });
const mias = new TestHost();
const MIAS_SECRET = "PI-SECRET-ON-MIAS-COMPUTER";

let ann: Page;
let mia: Page;
let miasPiDir: string;

test.beforeAll(async ({ browser }) => {
  if (!piInstalled) return;
  api.limited = false;
  await api.start();
  await Promise.all([owners.start(), mias.start()]);
  writeFileSync(join(owners.projectDir, "notes.txt"), "Sow the beets\n");

  miasPiDir = join(mias.root, "pi-agent");
  mkdirSync(join(miasPiDir, "extensions"), { recursive: true });
  writeFileSync(
    join(miasPiDir, "models.json"),
    JSON.stringify({
      providers: {
        fake: {
          baseUrl: api.url,
          apiKey: "fake-pi-key",
          api: "anthropic-messages",
          models: [{ id: "fake-sonnet", name: "Fake Sonnet", contextWindow: 128000, maxTokens: 4096 }],
        },
      },
    }),
  );
  writeFileSync(join(miasPiDir, "settings.json"), JSON.stringify({ defaultProvider: "fake", defaultModel: "fake-sonnet", defaultThinkingLevel: "low" }));
  writeFileSync(join(miasPiDir, "SYSTEM.md"), `${MIAS_SECRET}\n`);
  writeFileSync(join(miasPiDir, "mcp.json"), JSON.stringify({ mcpServers: { canvas: { command: "sh", args: ["-c", "exit 1"] } } }));

  ann = await (await browser.newContext()).newPage();
  mia = await (await browser.newContext()).newPage();
});

test.afterAll(async () => {
  if (!piInstalled) return;
  await Promise.all([owners.stop(), mias.stop()]);
  await Promise.all([owners.cleanUp(), mias.cleanUp()]);
  api.stop();
});

test.skip(!piInstalled, "pi is not installed");

test("Mia brings her pi agent to work in the room's workspace: it reads and edits there after Ann's OK, and leaks nothing of Mia's setup", async () => {
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
  const miaProfiles = await createProfile(mia, "PiCoder", `PI_CODING_AGENT_DIR=${miasPiDir}`, "", "pi");
  await miaProfiles.getByRole("button", { name: "Close" }).click();
  await expect(await joinRoom(mia, invite)).toHaveCount(0);

  const joined = roomCard(mia, "Garden").and(mia.locator(".joined-room"));
  await joined.hover();
  await joined.getByRole("button", { name: "More for Garden" }).click();
  await mia.getByRole("menuitem", { name: "Bring an agent…" }).click();
  const dialog = mia.getByRole("dialog", { name: "Bring an agent into Garden" });
  await dialog.getByRole("combobox", { name: /^Agent/ }).selectOption({ label: "PiCoder" });
  await dialog.getByRole("combobox", { name: /^Workspace/ }).selectOption({ label: "The room's workspace, on Ann's machine" });
  await dialog.getByLabel("Any time").check();
  await dialog.getByRole("button", { name: "Bring", exact: true }).click();
  await expect(dialog).toHaveCount(0);

  await roomCard(ann, "Garden").click();
  const accessCard = ann.locator("[data-workspace-access-asked]");
  await expect(accessCard).toContainText("PiCoder (Mia) asks to work in this room's workspace");
  await accessCard.getByRole("button", { name: "Let it work here" }).click();
  await expect(accessCard).toHaveCount(0);

  const composer = ann.getByRole("textbox", { name: "Write in Garden, @ tags an agent…" });
  const answers = ann.locator(".room-timeline .room-entry").filter({ has: ann.locator(".author", { hasText: "PiCoder (Mia)" }) });
  const giveTask = async (words: string, calls: string) => {
    api.callsWhenSaid.set(words, calls);
    await composer.fill("@Pi");
    await ann.getByRole("listbox", { name: "Agents and people of the room" }).getByRole("option", { name: "@PiCoder (Mia)" }).click();
    await composer.fill(`@PiCoder (Mia) ${words}`);
    await composer.press("Enter");
  };

  await giveTask("CHECK NOTES", 'CALL mcp__canvas__room_read {"path":"notes.txt"}');
  await expect(answers.last().locator(".message.agent")).toContainText("Sow the beets", { timeout: 30_000 });

  await giveTask("UPDATE NOTES", 'CALL mcp__canvas__room_edit {"path":"notes.txt","old":"beets","new":"carrots"}\nTHEN Carrots it is.');
  const callCard = ann.locator("[data-workspace-call-asked]");
  await expect(callCard).toContainText("notes.txt", { timeout: 30_000 });
  await callCard.getByRole("button", { name: "Allow" }).click();
  await expect(answers.last().locator(".message.agent")).toHaveText("Carrots it is.", { timeout: 30_000 });
  expect(readFileSync(join(owners.projectDir, "notes.txt"), "utf8")).toBe("Sow the carrots\n");

  const [, offered] = [...api.tools].find(([typed]) => typed.includes("CHECK NOTES"))!;
  expect(offered.toSorted()).toEqual(["mcp__canvas__ask", "mcp__canvas__room_edit", "mcp__canvas__room_read", "mcp__canvas__room_run", "mcp__canvas__show"]);
  expect(api.history.map((messages) => messages.join("\n")).filter((sent) => sent.includes(MIAS_SECRET))).toEqual([]);
  expect(existsSync(join(mias.dataDir, "brought-agents-config", "pi"))).toBe(true);
});
