import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { release } from "node:os";
import { dirname, join } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { addWorkspace, addWorkspaceFromSidebar, clickWorkspaceButton, createProfile, createRoom, openRoomSettings, roomCard, sendMessage, signIn, workspaceCard } from "./helpers.ts";
import { bunProgramPath, TestHost, writeBunProgram } from "./test-host.ts";

const sandboxesRunHere = process.platform === "darwin" && process.arch === "arm64" && Number(release().split(".")[0]) >= 25;

const host = new TestHost({ fakePrograms: true, environment: () => ({ ANTHROPIC_BASE_URL: "http://127.0.0.1:9", MIRADOR_SANDBOX: fakeContainer() }) });
const fakeContainer = () => bunProgramPath(join(host.root, "fake-container"), "container");
const containerState = () => join(host.root, "fake-container-state");
const promptsFile = () => join(host.root, "prompts");
const promptsSoFar = () => (existsSync(promptsFile()) ? readFileSync(promptsFile(), "utf8") : "");
const turnsMayEnd = () => join(host.root, "turns-may-end");
const inProject = (path: string) => join(host.projectDir, path);
const inner = () => inProject("inner");

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  mkdirSync(host.fakeProgramsDir, { recursive: true });
  mkdirSync(containerState(), { recursive: true });
  writeBunProgram(dirname(fakeContainer()), "container", join(import.meta.dirname, "fake-container.ts"), { FAKE_CONTAINER_STATE: containerState(), FAKE_ACP_PROMPTS: promptsFile() });
  const claude = join(host.fakeProgramsDir, "claude");
  writeFileSync(claude, `#!/bin/sh\necho "2.1.330 (Claude Code)"\n`);
  chmodSync(claude, 0o755);
  for (const folder of [host.projectDir, inner()]) {
    mkdirSync(folder, { recursive: true });
    execFileSync("git", ["init", "-q", folder]);
  }
  await host.start();
  const page = await browser.newPage();
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, "Builder", "ANTHROPIC_API_KEY=sk-e2e-one-folder-key-8765", "", "Claude Code");
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.close();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const projectCard = (page: Page) => workspaceCard(page, host.projectDir);
const heldCard = (scope: Page | Locator) => scope.getByRole("region", { name: "Agent config change held for you" });
const roomComposer = (page: Page) => page.getByRole("textbox", { name: "Write in Reviews, @ tags an agent…" });

async function openSandboxOf(page: Page, card: Locator, workspace: string) {
  await clickWorkspaceButton(card, "Sandbox…");
  const dialog = page.getByRole("dialog", { name: `Sandbox for ${workspace}` });
  await expect(dialog.getByText("Checking whether this workspace can have a sandbox…")).toBeHidden();
  return { dialog, sandboxSwitch: dialog.getByRole("switch", { name: "Run this workspace's agents in a sandbox" }) };
}

const vmsStarted = () =>
  readFileSync(join(containerState(), "calls.log"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as string[])
    .filter(([command]) => command === "run");

const mountsOfProject = (run: string[]) => run.filter((argument, index) => run[index - 1] === "-v" && argument.split(":")[1]!.startsWith(realpathSync(host.projectDir)));

test("a workspace's sandbox and a room's in the same folder mount the same of it, and what an agent changes there is held in both until it is answered in one", async ({ page }) => {
  test.skip(!sandboxesRunHere, "Sandboxes run on macOS 26 on Apple silicon only.");
  await signIn(page, host);
  await projectCard(page).getByLabel("Agent", { exact: true }).selectOption({ label: "Builder · Claude Code" });
  const { dialog, sandboxSwitch } = await openSandboxOf(page, projectCard(page), "project");
  await sandboxSwitch.check();
  await expect(dialog.locator(".room-sandbox-setup")).toHaveText("Set up on this Mac.");
  await dialog.getByRole("button", { name: "Done" }).click();
  const previousUrl = page.url();
  await projectCard(page).getByRole("button", { name: "+ New conversation" }).click();
  await expect(page).not.toHaveURL(previousUrl);
  await sendMessage(page, `WRITE ${JSON.stringify([{ waitFor: turnsMayEnd() }])}`);
  await expect.poll(() => vmsStarted().length).toBe(1);

  await createRoom(page, "Reviews", ["Builder"], { workspace: "project" });
  const settings = await openRoomSettings(page, "Reviews", "Permissions");
  await expect(settings.getByText("Checking whether this room can have a sandbox…")).toBeHidden();
  await settings.getByRole("switch", { name: "Run the agents in a sandbox" }).check();
  await settings.getByRole("button", { name: "Close" }).click();
  await roomComposer(page).fill("@Bu");
  await page.getByRole("listbox", { name: "Agents and people of the room" }).getByRole("option", { name: "@Builder" }).click();
  await roomComposer(page).fill(`@Builder WAIT ${turnsMayEnd()} SAY Reviewed.`);
  await roomComposer(page).press("Enter");
  await expect.poll(() => promptsSoFar().split(turnsMayEnd()).length).toBe(3);

  const [ofWorkspace, ofRoom] = vmsStarted().map(mountsOfProject);
  expect(ofWorkspace!.length).toBeGreaterThan(2);
  expect(ofRoom).toEqual(ofWorkspace);

  writeFileSync(inProject(".mcp.json"), `{"mcpServers":{"tunnel":{"command":"curl"}}}\n`);
  const needsYou = projectCard(page).locator(".workspace-held");
  await expect(needsYou).toHaveText("Needs you");
  await expect(roomCard(page, "Reviews").locator(".waiting-pill")).toHaveText("Needs you");
  await expect(heldCard(page).locator(".room-held-title")).toHaveText("Builder wants to add .mcp.json");
  await page.reload();
  await expect(heldCard(page).locator(".room-held-title")).toHaveText("Builder wants to add .mcp.json");
  await needsYou.click();
  await expect(heldCard(dialog).locator(".diff-added")).toContainText([`{"mcpServers":{"tunnel":{"command":"curl"}}}`]);
  await dialog.getByRole("button", { name: "Done" }).click();

  await heldCard(page).getByRole("button", { name: "Discard" }).click();
  await expect(heldCard(page)).toBeHidden();
  await expect(needsYou).toHaveCount(0);
  await expect(roomCard(page, "Reviews").locator(".waiting-pill")).toHaveCount(0);
  expect(existsSync(inProject(".mcp.json"))).toBe(false);
  writeFileSync(turnsMayEnd(), "");
  await expect(page.locator(".room-timeline .room-entry .message.agent", { hasText: "Reviewed." })).toBeVisible();
});

test("a workspace inside one whose sandbox is on can't have one of its own, saying which, until that one is off", async ({ page }) => {
  test.skip(!sandboxesRunHere, "Sandboxes run on macOS 26 on Apple silicon only.");
  await signIn(page, host);
  await addWorkspaceFromSidebar(page, inner());
  const card = workspaceCard(page, inner());
  const { dialog, sandboxSwitch } = await openSandboxOf(page, card, "inner");
  await expect(sandboxSwitch).toBeDisabled();
  await expect(dialog.locator(".room-sandbox-reasons")).toContainText(`Another sandbox that is on works in ${realpathSync(host.projectDir)}, which holds the workspace or lies inside it: only one sandbox may write there.`);
  await dialog.getByRole("button", { name: "Done" }).click();
});
