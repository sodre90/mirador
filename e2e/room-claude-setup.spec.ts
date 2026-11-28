import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { FakeClaudeApi, fakeClaudeEnvironment } from "./fake-claude-api.ts";
import { addWorkspace, bashPath, createProfile, createRoom, openRoomSettings, signIn, whatItMeans } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const api = new FakeClaudeApi();
const host = new TestHost({ environment: () => fakeClaudeEnvironment(api) });
const ownersClaudeFolder = () => join(host.root, "owners-claude");
const hooksRan = () => join(host.root, "hooks-ran");
const OWNERS_NOTES = "OWNERS-NOTES-MARKER";
const WORKSPACE_NOTES = "WORKSPACE-NOTES-MARKER";
const OWNERS_MEMORY = "OWNERS-MEMORY-MARKER";

const probeServer = () => ({ command: "bun", args: [join(import.meta.dirname, "probe-mcp-server.ts")] });
const hookWriting = (marker: string) => ({ UserPromptSubmit: [{ hooks: [{ type: "command", command: `echo ${marker} >> ${bashPath(hooksRan())}` }] }] });

/** The owner's own Claude Code folder, with a hook, an MCP server, a CLAUDE.md and a memory of the workspace. */
function setUpOwnersClaudeCode() {
  const folder = ownersClaudeFolder();
  const memory = join(folder, "projects", realpathSync.native(host.projectDir).replace(/[^A-Za-z0-9]/g, "-"), "memory");
  mkdirSync(memory, { recursive: true });
  writeFileSync(join(folder, "settings.json"), JSON.stringify({ hooks: hookWriting("OWNERS-HOOK") }));
  writeFileSync(join(folder, ".claude.json"), JSON.stringify({ hasCompletedOnboarding: true, mcpServers: { ownersprobe: probeServer() } }));
  writeFileSync(join(folder, "CLAUDE.md"), `${OWNERS_NOTES}\n`);
  writeFileSync(join(memory, "MEMORY.md"), `${OWNERS_MEMORY}\n`);
}

/** The workspace's own Claude Code setup, with a hook, an MCP server and a CLAUDE.md. */
function setUpWorkspacesClaudeCode() {
  mkdirSync(join(host.projectDir, ".claude"), { recursive: true });
  writeFileSync(join(host.projectDir, ".claude", "settings.json"), JSON.stringify({ hooks: hookWriting("WORKSPACE-HOOK"), enableAllProjectMcpServers: true }));
  writeFileSync(join(host.projectDir, ".mcp.json"), JSON.stringify({ mcpServers: { workspaceprobe: probeServer() } }));
  writeFileSync(join(host.projectDir, "CLAUDE.md"), `${WORKSPACE_NOTES}\n`);
}

test.beforeAll(async ({ browser }) => {
  api.limited = false;
  await api.start();
  mkdirSync(host.projectDir, { recursive: true });
  setUpOwnersClaudeCode();
  setUpWorkspacesClaudeCode();
  await host.start();
  const page = await browser.newPage();
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, "Claude", `CLAUDE_CONFIG_DIR=${ownersClaudeFolder()}`);
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.close();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
  api.stop();
});

const roomComposer = (page: Page) => page.getByRole("textbox", { name: "Write in Setup, @ tags an agent…" });

async function tagClaude(page: Page, rest: string) {
  await roomComposer(page).fill("@Cl");
  await page.getByRole("listbox", { name: "Agents and people of the room" }).getByRole("option", { name: "@Claude" }).click();
  await roomComposer(page).fill(`@Claude ${rest}`);
  await roomComposer(page).press("Enter");
  await expect(page.locator(".room-timeline .room-entry .message.agent", { hasText: rest })).toBeVisible({ timeout: 60_000 });
}

/** What Claude Code sent the model for the message: its system prompt and the user's message with the context it adds, and the tools it offered. */
function requestFor(asked: string) {
  const typed = [...api.tools.keys()].findLast((each) => each.includes(asked));
  if (typed === undefined) throw new Error(`No request asked ${asked}.`);
  return { context: `${api.systemPrompts.get(typed)}\n${api.userMessages.get(typed)}`, tools: api.tools.get(typed)!, prompt: typed };
}

const hooksThatRan = () => (existsSync(hooksRan()) ? readFileSync(hooksRan(), "utf8").trim().split("\n") : []);

test("a room's Claude agent loads all of the owner's Claude Code setup until the owner has it start clean, which costs it one new read of the room", async ({ page }) => {
  await signIn(page, host);
  await createRoom(page, "Setup", ["Claude"]);

  await tagClaude(page, "FIRST ASK");
  const asLoaded = requestFor("FIRST ASK");
  expect([OWNERS_NOTES, WORKSPACE_NOTES, OWNERS_MEMORY].filter((marker) => asLoaded.context.includes(marker))).toEqual([OWNERS_NOTES, WORKSPACE_NOTES, OWNERS_MEMORY]);
  expect(asLoaded.tools).toEqual(expect.arrayContaining(["mcp__ownersprobe__reload_probe", "mcp__workspaceprobe__reload_probe", "mcp__canvas__room_tag"]));
  expect(hooksThatRan().toSorted()).toEqual(["OWNERS-HOOK", "WORKSPACE-HOOK"]);

  await test.step("starting clean waits for the owner to confirm, as the agent at work there starts afresh", async () => {
    const settings = await openRoomSettings(page, "Setup", "Agents");
    const load = settings.getByRole("combobox", { name: "Claude agents load" });
    const parts = settings.getByRole("group", { name: "Your Claude Code setup" });
    await expect(load).toHaveValue("all");
    await expect(parts).toHaveCount(0);
    await load.selectOption({ label: "Chosen parts" });
    await expect(parts.getByRole("checkbox")).toHaveCount(5);
    await expect(parts.getByRole("checkbox", { checked: true })).toHaveCount(5);
    await expect(settings.locator(".room-starts-afresh")).toHaveCount(0);
    await load.selectOption({ label: "None: start clean" });
    await expect(settings.locator(".room-starts-afresh")).toContainText("Claude stops any turn under way, starts afresh and reads the room again, once.");
    await settings.locator(".room-starts-afresh").getByRole("button", { name: "Change" }).click();
    await expect(load).toHaveValue("none");
    await expect(load).toBeEnabled();
    await expect(parts).toHaveCount(0);
    expect((await whatItMeans(page, settings, "Your Claude Code setup")).join("\n")).toContain("The deny and ask rules and the sandbox of settings left out stay.");
    await settings.getByRole("button", { name: "Close" }).click();
  });

  rmSync(hooksRan(), { force: true });
  await tagClaude(page, "SECOND ASK");
  const clean = requestFor("SECOND ASK");
  expect([OWNERS_NOTES, WORKSPACE_NOTES, OWNERS_MEMORY].filter((marker) => clean.context.includes(marker))).toEqual([]);
  expect(clean.tools.filter((tool) => tool.includes("probe"))).toEqual([]);
  expect(clean.tools).toEqual(expect.arrayContaining(["mcp__canvas__show", "mcp__canvas__ask", "mcp__canvas__room_history", "mcp__canvas__room_tag"]));
  expect(hooksThatRan()).toEqual([]);
  expect(clean.prompt).toContain('You are an attendee of the room "Setup"');
  expect(clean.prompt).toContain("FIRST ASK");
});
