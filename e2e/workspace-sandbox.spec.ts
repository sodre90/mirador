import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer, request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { connect, type AddressInfo, type Socket } from "node:net";
import { release } from "node:os";
import { dirname, join } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { guardedIn, mountsOfRun } from "../tests/guard-told.ts";
import { addWorkspace, addWorkspaceFromSidebar, clickWorkspaceButton, createProfile, lastAgentMessage, openProfiles, sendMessage, signIn, waitForTurnToEnd, workspaceCard } from "./helpers.ts";
import { bunProgramPath, TestHost, writeBunProgram } from "./test-host.ts";

const sandboxesRunHere = process.platform === "darwin" && process.arch === "arm64" && Number(release().split(".")[0]) >= 25;
const KEY = "sk-e2e-sandboxed-workspace-key-8765";

const host = new TestHost({ fakePrograms: true, environment: () => ({ ANTHROPIC_BASE_URL: "http://127.0.0.1:9", MIRADOR_SANDBOX: fakeContainer() }) });
const fakeContainer = () => bunProgramPath(join(host.root, "fake-container"), "container");
const containerState = () => join(host.root, "fake-container-state");
const buildHeldBy = () => join(host.root, "build-may-go-on");
const installHeldBy = () => join(host.root, "install-may-go-on");
const pullHeldBy = () => join(host.root, "pull-may-go-on");
const unpackHeldBy = () => join(host.root, "unpack-may-go-on");
const installerPullHeldBy = () => join(host.root, "installer-pull-may-go-on");
const worktree = () => join(host.root, "worktree");
const promptsFile = () => join(host.root, "prompts");
const promptsSoFar = () => (existsSync(promptsFile()) ? readFileSync(promptsFile(), "utf8") : "");
const inProject = (path: string) => join(host.projectDir, path);

test.describe.configure({ mode: "serial" });

/** The `container` the host is given: e2e/fake-container.ts, its state in the host's folder, its agents the fake ACP agent. */
function writeFakeContainer() {
  mkdirSync(containerState(), { recursive: true });
  writeBunProgram(dirname(fakeContainer()), "container", join(import.meta.dirname, "fake-container.ts"), {
    FAKE_CONTAINER_STATE: containerState(),
    FAKE_CONTAINER_BUILD_HELD_BY: buildHeldBy(),
    FAKE_CONTAINER_INSTALL_HELD_BY: installHeldBy(),
    FAKE_CONTAINER_PULL_HELD_BY: pullHeldBy(),
    FAKE_CONTAINER_UNPACK_HELD_BY: unpackHeldBy(),
    FAKE_CONTAINER_INSTALLER_PULL_HELD_BY: installerPullHeldBy(),
    FAKE_ACP_PROMPTS: promptsFile(),
  });
  const claude = join(host.fakeProgramsDir, "claude");
  writeFileSync(claude, `#!/bin/sh\necho "2.1.330 (Claude Code)"\n`);
  chmodSync(claude, 0o755);
}

function makeWorktree() {
  const repository = join(host.root, "repository");
  execFileSync("git", ["init", "-q", repository]);
  execFileSync("git", ["-C", repository, "-c", "user.name=e2e", "-c", "user.email=e2e@example.com", "commit", "-q", "--allow-empty", "-m", "first"]);
  execFileSync("git", ["-C", repository, "worktree", "add", "-q", worktree()]);
}

test.beforeAll(async ({ browser }) => {
  mkdirSync(host.fakeProgramsDir, { recursive: true });
  writeFakeContainer();
  mkdirSync(host.projectDir, { recursive: true });
  execFileSync("git", ["init", "-q", host.projectDir]);
  writeFileSync(inProject(".gitconfig"), "[mirador]\n\tteam = shared\n");
  execFileSync("git", ["-C", host.projectDir, "config", "include.path", "../.gitconfig"]);
  execFileSync("git", ["-C", host.projectDir, "add", ".gitconfig"]);
  execFileSync("git", ["-C", host.projectDir, "-c", "user.name=e2e", "-c", "user.email=e2e@example.com", "commit", "-q", "-m", "first"]);
  makeWorktree();
  await host.start();
  const page = await browser.newPage();
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  for (const [name, environment, agent] of [
    ["Builder", `ANTHROPIC_API_KEY=${KEY}`, "Claude Code"],
    ["Coder", "", "Codex"],
  ]) {
    const profiles = await createProfile(page, name!, environment!, "", agent);
    await profiles.getByRole("button", { name: "Close" }).click();
  }
  await page.close();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const screenshotsFolder = process.env.MIRADOR_SANDBOX_SCREENSHOTS;
const keepScreenshot = async (shown: Locator, name: string) => screenshotsFolder && (await shown.screenshot({ path: join(screenshotsFolder, `${name}.png`) }));
const keepPageScreenshot = async (page: Page, name: string) => screenshotsFolder && (await page.screenshot({ path: join(screenshotsFolder, `${name}.png`) }));

const projectCard = (page: Page) => workspaceCard(page, host.projectDir);
const sandboxDialog = (page: Page, workspace: string) => page.getByRole("dialog", { name: `Sandbox for ${workspace}` });
const networkChoice = (dialog: Locator, name: string) => dialog.getByRole("radiogroup", { name: "Network" }).getByRole("radio", { name, exact: true });
const sandboxSwitch = (dialog: Locator) => dialog.getByRole("switch", { name: "Run this workspace's agents in a sandbox" });
const reasons = (dialog: Locator) => dialog.locator(".room-sandbox-reasons");
const startOnPicker = (dialog: Locator) => dialog.getByRole("combobox", { name: "Start new conversations on" });
const heldCard = (scope: Page | Locator) => scope.getByRole("region", { name: "Agent config change held for you" });
const chatHeader = (page: Page) => page.locator(".chat-header:visible");

/** The steps the first sandbox here takes for Claude Code, in the order it takes them. */
const STEPS_OF_CLAUDE_CODE = ["Start Apple's container service", "Build Mirador's base image", "Build Mirador's guard", /^Install Bun \d+\.\d+\.\d+$/, "Install Node.js 22", "Install Claude Code 2.1.330"];

const setupSteps = (dialog: Locator) => dialog.getByRole("group", { name: "Setting up the sandbox" });
const stepRow = (steps: Locator, name: string) => steps.getByRole("listitem").filter({ has: steps.page().locator(".sandbox-setup-name", { hasText: name }) });

async function openSandboxOf(page: Page, card: Locator, workspace: string) {
  await clickWorkspaceButton(card, "Sandbox…");
  const dialog = sandboxDialog(page, workspace);
  await expect(dialog.getByText("Checking whether this workspace can have a sandbox…")).toBeHidden();
  return dialog;
}

async function startConversation(page: Page) {
  const previousUrl = page.url();
  await projectCard(page).getByRole("button", { name: "+ New conversation" }).click();
  await expect(page).not.toHaveURL(previousUrl);
  return page.url().match(/#\/c\/(.+)$/)![1]!;
}

const openConversation = (page: Page, conversationId: string) => page.locator(`li[data-reorder-id="${conversationId}"] .conversation-title`).click();

let builderConversation = "";

const loggedCalls = (name: string): string[][] => {
  const log = join(containerState(), name);
  return existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line)) : [];
};
/** Each call the fake `container` got, by its arguments, but the tools' installs. */
const containerCalls = () => loggedCalls("calls.log");
/** Each throwaway run that installed a tool of the sandbox's. */
const toolInstalls = () => loggedCalls("installs.log");

test("the workspace's sandbox switch stays off, with the reason under it, where the workspace can't have one", async ({ page }) => {
  await signIn(page, host);
  await addWorkspaceFromSidebar(page, worktree());
  const dialog = await openSandboxOf(page, workspaceCard(page, worktree()), "worktree");
  await expect(sandboxSwitch(dialog)).toBeDisabled();
  await test.step("what it means shows in a hint that stays while it is pointed at and scrolled", async () => {
    const marker = dialog.getByRole("button", { name: "What does this mean?" });
    const hint = page.locator(".hint-bubble.long");
    await marker.hover();
    await expect(hint).toContainText("On the canvas the agents can show you pages and ask you questions, but they get none of Mirador's other tools, as those act on this computer.");
    await expect(dialog.getByText("On the canvas the agents can show you pages")).toHaveCount(0);
    const from = (await marker.boundingBox())!;
    const to = (await hint.boundingBox())!;
    const gapY = to.y > from.y ? (from.y + from.height + to.y) / 2 : (to.y + to.height + from.y) / 2;
    await page.mouse.move(from.x + 4, gapY);
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2);
    await page.mouse.wheel(0, 400);
    await expect.poll(() => hint.evaluate((bubble) => bubble.scrollTop)).toBeGreaterThan(0);
    await expect(hint).toBeVisible();
    await page.mouse.move(0, 0);
    await expect(hint).toBeHidden();
  });
  if (!sandboxesRunHere) {
    await expect(reasons(dialog)).toBeVisible();
    return;
  }
  await expect(reasons(dialog)).toHaveText(/^The workspace is a git worktree/);
  await keepScreenshot(dialog, "switch-off-with-reason");
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toBeHidden();
  expect(containerCalls().filter(([command]) => command !== "system")).toEqual([]);
});

test("the switch stays off where the workspace's git config includes a file of it that isn't there, saying so, and can be turned on once it is", async ({ page }) => {
  test.skip(!sandboxesRunHere, "Sandboxes run on macOS 26 on Apple silicon only.");
  const including = join(host.root, "including");
  execFileSync("git", ["init", "-q", including]);
  execFileSync("git", ["-C", including, "config", "include.path", "../.gitconfig.local"]);
  await signIn(page, host);
  await addWorkspaceFromSidebar(page, including);
  const dialog = await openSandboxOf(page, workspaceCard(page, including), "including");
  await expect(reasons(dialog)).toHaveText("Git's config includes .gitconfig.local, which isn't there, so the sandbox could make it: make that file, or take the include out, to use a sandbox.");
  await expect(sandboxSwitch(dialog)).toBeDisabled();
  await keepScreenshot(dialog, "include-missing");
  await dialog.getByRole("button", { name: "Done" }).click();

  writeFileSync(join(including, ".gitconfig.local"), "[mirador]\n\tlocal = yes\n");
  const again = await openSandboxOf(page, workspaceCard(page, including), "including");
  await expect(reasons(again)).toHaveCount(0);
  await expect(sandboxSwitch(again)).toBeEnabled();
  await again.getByRole("button", { name: "Done" }).click();
});

test("the switch stays off where the workspace's git config runs hooks from a folder that holds a repository, saying so, and can be turned on once they have one of their own", async ({ page }) => {
  test.skip(!sandboxesRunHere, "Sandboxes run on macOS 26 on Apple silicon only.");
  const hooked = join(host.root, "hooked");
  execFileSync("git", ["init", "-q", hooked]);
  execFileSync("git", ["-C", hooked, "config", "core.hooksPath", "."]);
  await signIn(page, host);
  await addWorkspaceFromSidebar(page, hooked);
  const dialog = await openSandboxOf(page, workspaceCard(page, hooked), "hooked");
  await expect(reasons(dialog)).toHaveText("Git's config names . as the hooks folder, which holds a repository, so a sandbox can't keep the hooks read-only: have core.hooksPath name a folder of its own to use a sandbox.");
  await expect(sandboxSwitch(dialog)).toBeDisabled();
  await keepScreenshot(dialog, "hooks-folder-holds-repository");
  await dialog.getByRole("button", { name: "Done" }).click();

  execFileSync("git", ["-C", hooked, "config", "core.hooksPath", "githooks"]);
  const again = await openSandboxOf(page, workspaceCard(page, hooked), "hooked");
  await expect(reasons(again)).toHaveCount(0);
  await expect(sandboxSwitch(again)).toBeEnabled();
  await again.getByRole("button", { name: "Done" }).click();
});

test("turned on, the workspace's sandbox is set up with its progress shown, in a conversation waiting for it too, marked in the sidebar and the conversation, and its agent works in a VM of its own without the key", async ({ page }) => {
  test.skip(!sandboxesRunHere, "Sandboxes run on macOS 26 on Apple silicon only.");
  await signIn(page, host);
  const card = projectCard(page);
  await card.getByLabel("Agent", { exact: true }).selectOption({ label: "Builder · Claude Code" });

  await test.step("new conversations were set to start in worktrees", async () => {
    await clickWorkspaceButton(card, "Where conversations work…");
    const where = page.getByRole("dialog", { name: "Where conversations work in project" });
    await where.getByRole("radio", { name: /A worktree of their own/ }).check();
    await where.getByRole("button", { name: "Save" }).click();
    await expect(where).toHaveCount(0);
    await clickWorkspaceButton(card, "Where conversations work…");
    await expect(where.getByRole("radio", { name: /A worktree of their own/ })).toBeChecked();
    await where.getByRole("button", { name: "Cancel" }).click();
  });

  const dialog = await openSandboxOf(page, card, "project");
  await expect(dialog.locator(".room-sandbox-kind")).toHaveText("Runs in a light VM of its own on this Mac, made with Apple's container tool.");
  await expect(dialog.locator(".workspace-sandbox-starts-on")).toHaveCount(0);
  await sandboxSwitch(dialog).check();
  await expect(dialog.getByRole("radio", { name: "Agents work freely inside" })).toBeChecked();
  await expect(dialog.getByRole("radio", { name: "Their profile's permission mode still applies" })).not.toBeChecked();
  const steps = setupSteps(dialog);
  await expect(steps.locator(".sandbox-setup-name")).toHaveText(STEPS_OF_CLAUDE_CODE);
  await expect(steps.getByRole("status")).toHaveText("Step 2 of 6");
  await expect(steps.getByRole("img", { name: "Done" })).toHaveCount(1);
  const building = stepRow(steps, "Build Mirador's base image");
  await expect(building.getByRole("img", { name: "Under way" })).toBeVisible();
  await expect(building.locator(".sandbox-setup-detail")).toHaveText("Part 2 of 3 of the build");
  await expect(building.getByRole("progressbar", { name: "How far this step got" })).toHaveAttribute("aria-valuenow", "2");
  await expect(steps.getByRole("progressbar", { name: "Steps done" })).toHaveAttribute("aria-valuenow", "1");
  await keepScreenshot(dialog, "setup-progress");
  await expect(networkChoice(dialog, "Only the model and Mirador")).toBeChecked();
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toBeHidden();

  const sidebarMark = card.locator(".workspace-sandboxed");
  await expect(sidebarMark).toHaveAccessibleName("Sandboxed");
  await expect(sidebarMark).toHaveAttribute("data-hint", "This workspace's agents run in a sandbox. Click for its settings.");
  await keepScreenshot(card.locator(":scope > header"), "sidebar-mark");

  builderConversation = await startConversation(page);
  const headerMark = chatHeader(page).locator(".conversation-sandboxed");
  await expect(headerMark).toHaveText("Sandboxed");

  await test.step("while the sandbox is set up, the conversation says how far it got, in its header and a card that opens every step, until its agent has started", async () => {
    const waitingFor = chatHeader(page).locator(".status-detail");
    await expect(waitingFor).toHaveText("Setting up the sandbox, step 2 of 6: Build Mirador's base image");
    await expect(waitingFor).toHaveClass(/\bbusy\b/);
    await keepScreenshot(chatHeader(page), "header-setting-up");
    const setupCard = page.locator(".sandbox-setup-card:visible");
    await expect(setupCard.locator("strong")).toHaveText("Setting up the sandbox before its agent starts");
    await expect(setupCard.locator(".sandbox-setup-doing")).toHaveText("Step 2 of 6: Build Mirador's base image");
    await expect(setupCard.getByRole("progressbar", { name: "Steps done" })).toHaveAttribute("aria-valuenow", "1");
    await expect(setupCard).toHaveAttribute("data-hint", "Click for every step, in the sandbox's settings.");
    await keepScreenshot(setupCard, "conversation-setting-up");
    writeFileSync(buildHeldBy(), "");
    await expect(waitingFor).toHaveText(/^Setting up the sandbox, step 4 of 6: Install Bun \d+\.\d+\.\d+$/);
    await expect(setupCard.locator(".sandbox-setup-doing")).toHaveText(/^Step 4 of 6: Install Bun /);
    await setupCard.click();
    const installing = sandboxDialog(page, "project");
    const installingSteps = setupSteps(installing);
    const bun = stepRow(installingSteps, "Install Bun");
    await expect(bun.locator(".sandbox-setup-detail")).toHaveText("Downloading node:22-bookworm-slim 40%");
    await expect(bun.getByRole("progressbar", { name: "How far this step got" })).toHaveAttribute("aria-valuenow", "40");
    await keepScreenshot(installing, "installer-downloading");
    writeFileSync(installerPullHeldBy(), "");
    await expect(installingSteps.getByRole("status")).toHaveText("Step 6 of 6");
    await expect(installingSteps.getByRole("img", { name: "Done" })).toHaveCount(5);
    await expect(stepRow(installingSteps, "Install Claude Code 2.1.330").getByRole("img", { name: "Under way" })).toBeVisible();
    await installing.getByRole("button", { name: "Done" }).click();
    await expect(installing).toBeHidden();
    await expect(waitingFor).toHaveText("Setting up the sandbox, step 6 of 6: Install Claude Code 2.1.330");
    await expect(setupCard.locator(".sandbox-setup-doing")).toHaveText("Step 6 of 6: Install Claude Code 2.1.330");
    writeFileSync(installHeldBy(), "");
    await expect(waitingFor).toHaveCount(0);
    await expect(setupCard).toHaveCount(0);
    await keepScreenshot(chatHeader(page), "header-mark");
    const settings = await openSandboxOf(page, card, "project");
    await expect(settings.locator(".room-sandbox-setup")).toHaveText("Set up on this Mac.");
    await keepScreenshot(settings, "switch-on");
    await settings.getByRole("button", { name: "Done" }).click();
    await expect(settings).toBeHidden();
  });

  await test.step("it starts in the project folder, as the sandbox sees no worktree", async () => {
    await sendMessage(page, "FOLDER");
    await waitForTurnToEnd(page);
    await expect(lastAgentMessage(page)).toHaveText(`Working in ${realpathSync(host.projectDir)}`);
  });

  await test.step("the agent's key stays with Mirador", async () => {
    const keySeen = join(host.root, "key-seen");
    await sendMessage(page, `WRITE ${JSON.stringify([{ edit: keySeen, content: "{{env:ANTHROPIC_API_KEY}}" }])}`);
    await waitForTurnToEnd(page);
    expect(readFileSync(keySeen, "utf8")).toBe("kept-by-mirador");
  });

  const calls = containerCalls();
  const runs = calls.filter(([command]) => command === "run");
  expect(runs).toHaveLength(1);
  const [run] = runs as [string[]];
  expect(run[run.indexOf("--network") + 1]).toBe("none");
  expect(run.filter((argument) => argument.startsWith("mirador.owner="))).toEqual([expect.stringMatching(/^mirador\.owner=workspace:/)]);
  expect(JSON.stringify(run)).not.toContain(realpathSync(worktree()));
  expect(JSON.stringify(calls)).not.toContain(KEY);

  await test.step("the VM's guard protects the project's .gitconfig, which its git config includes", () => {
    const [project, ...others] = guardedIn(mountsOfRun(run));
    expect(others).toEqual([]);
    expect(project).toMatchObject({ folder: realpathSync(host.projectDir), parts: { files: expect.arrayContaining([".gitconfig"]), gitFolders: expect.arrayContaining([".git"]) } });
  });

  const openSandboxFromMark = async () => {
    await headerMark.click();
    await page.getByRole("menu", { name: "Where this conversation's agent runs" }).getByRole("menuitem", { name: "Sandbox settings…" }).click();
  };

  await test.step("the conversation's mark opens the workspace's sandbox", async () => {
    await expect(headerMark.getByRole("button")).toHaveAttribute("data-hint", "This conversation's agent runs in its workspace's sandbox. Click to move it out, or for the sandbox's settings.");
    await openSandboxFromMark();
    await expect(sandboxSwitch(dialog)).toBeChecked();
  });

  await test.step("what it reaches is changed at once, in the same VM, and stays through a reload", async () => {
    await networkChoice(dialog, "The internet too, but not this computer or its networks").check();
    const reaches = dialog.locator(".room-sandbox-reaches");
    await expect(reaches).toContainText("Git over HTTPS, npm and whatever else uses a web proxy get out through Mirador");
    await expect(reaches).not.toContainText("bring into the room");
    await expect(dialog.getByRole("button", { name: "Change" })).toHaveCount(0);
    await keepScreenshot(dialog, "network-internet");
    await dialog.getByRole("button", { name: "Done" }).click();
    await sendMessage(page, "SAY Still in the same VM.");
    await waitForTurnToEnd(page);
    expect(containerCalls().filter(([command]) => command === "run")).toHaveLength(1);
    await page.reload();
    await openSandboxFromMark();
    await expect(networkChoice(dialog, "The internet too, but not this computer or its networks")).toBeChecked();
    await networkChoice(dialog, "Only the model and Mirador").check();
    await expect(networkChoice(dialog, "Only the model and Mirador")).toBeChecked();
    await dialog.getByRole("button", { name: "Done" }).click();
  });
});

test("a change to an agent config file is put back and held in the conversation it happened in, and on the workspace, until the owner allows or discards it", async ({ page }) => {
  test.skip(!sandboxesRunHere, "Sandboxes run on macOS 26 on Apple silicon only.");
  await signIn(page, host);
  await openConversation(page, builderConversation);
  const needsYou = projectCard(page).locator(".workspace-held");
  const card = heldCard(page);

  await test.step("a new file comes as the conversation's turn is under way, and is written once allowed there", async () => {
    const turnMayEnd = join(host.root, "turn-may-end");
    await sendMessage(page, `WRITE ${JSON.stringify([{ waitFor: turnMayEnd }])}`);
    await expect.poll(promptsSoFar).toContain(turnMayEnd);
    writeFileSync(inProject(".mcp.json"), `{"mcpServers":{"tunnel":{"command":"curl"}}}\n`);
    await expect(card.locator(".room-held-title")).toHaveText("Builder wants to add .mcp.json");
    await expect(card.locator(".diff-added")).toContainText([`{"mcpServers":{"tunnel":{"command":"curl"}}}`]);
    expect(existsSync(inProject(".mcp.json"))).toBe(false);
    await expect(needsYou).toHaveText("Needs you");
    await expect(needsYou).toHaveAttribute("data-hint", "Needs you: the sandbox holds an agent config change for your OK. Click to see it.");
    await keepScreenshot(card, "held-card");
    await keepPageScreenshot(page, "held-in-conversation");
    writeFileSync(turnMayEnd, "");
    await waitForTurnToEnd(page);
    await card.getByRole("button", { name: "Allow" }).click();
    await expect(card).toBeHidden();
    await expect(needsYou).toHaveCount(0);
    expect(readFileSync(inProject(".mcp.json"), "utf8")).toBe(`{"mcpServers":{"tunnel":{"command":"curl"}}}\n`);
  });

  await test.step("a change while no turn is under way is held on the workspace alone, and stays undone once discarded there", async () => {
    writeFileSync(inProject(".mcp.json"), "{}\n");
    await expect(needsYou).toHaveText("Needs you");
    await expect(card).toBeHidden();
    await needsYou.click();
    const dialog = sandboxDialog(page, "project");
    const onWorkspace = heldCard(dialog);
    await expect(onWorkspace.locator(".room-held-title")).toHaveText("An agent of this workspace wants to change .mcp.json");
    expect(readFileSync(inProject(".mcp.json"), "utf8")).toBe(`{"mcpServers":{"tunnel":{"command":"curl"}}}\n`);
    await onWorkspace.getByRole("button", { name: "Discard" }).click();
    await expect(onWorkspace).toBeHidden();
    await expect(needsYou).toHaveCount(0);
    expect(readFileSync(inProject(".mcp.json"), "utf8")).toBe(`{"mcpServers":{"tunnel":{"command":"curl"}}}\n`);
    await dialog.getByRole("button", { name: "Done" }).click();
  });
});

test("a base image of the owner's own is pulled and checked for what the agents need, Claude Code's own program too, before a VM runs on it, what it lacks said in the sandbox's settings and its conversation, and Mirador's comes back once it is cleared", async ({ page }) => {
  test.skip(!sandboxesRunHere, "Sandboxes run on macOS 26 on Apple silicon only.");
  await signIn(page, host);
  const card = projectCard(page);
  await openConversation(page, builderConversation);
  const runs = () => containerCalls().filter(([command]) => command === "run");
  const imageRun = (run: string[]) => run[run.indexOf("--entrypoint") + 2];
  const useBaseImage = async (name: string) => {
    const dialog = await openSandboxOf(page, card, "project");
    await dialog.getByRole("textbox", { name: "Base image" }).fill(name);
    await dialog.getByRole("button", { name: "Use" }).click();
    await expect(dialog.getByRole("alert").locator("span")).toHaveText("1 conversation here starts afresh as it goes on: its agent won't remember what was said before.");
    await dialog.getByRole("button", { name: "Change" }).click();
    await expect(dialog.getByRole("textbox", { name: "Base image" })).toHaveValue(name);
    return dialog;
  };

  await test.step("the field names Mirador's own until another is used, and won't take what isn't an image's name", async () => {
    const dialog = await openSandboxOf(page, card, "project");
    const baseImage = dialog.getByRole("textbox", { name: "Base image" });
    await expect(baseImage).toHaveValue("");
    await expect(baseImage).toHaveAttribute("placeholder", "Mirador's own: Debian with git");
    await expect(dialog.locator(".room-sandbox-base-image .hint")).toHaveText(
      "Any image with a Linux build for Arm (arm64) that has glibc, /bin/sh, /bin/bash and git; Mirador's own programs come in beside it. It is pulled again each time Mirador starts, unless you name its digest.",
    );
    await baseImage.fill("--privileged");
    await expect(dialog.locator(".room-sandbox-base-image-invalid")).toHaveText("That isn't an image name, such as ghcr.io/you/image:tag.");
    await expect(dialog.getByRole("button", { name: "Use" })).toBeDisabled();
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(dialog).toBeHidden();
  });

  await test.step("one without git is set up as far as its check, which says so, and the conversation's next turn fails saying it too", async () => {
    const dialog = await useBaseImage("team/lacks-git:1");
    const lacks = "The sandbox's base image team/lacks-git:1 lacks what the agents need: git.";
    const failedSteps = setupSteps(dialog);
    await expect(failedSteps.locator("strong")).toHaveText("Setting it up failed.");
    await expect(failedSteps.getByRole("status")).toHaveText("Step 6 of 8");
    await expect(failedSteps.locator(".sandbox-setup-problem")).toHaveText(lacks);
    await expect(stepRow(failedSteps, "Check that team/lacks-git:1 has what the agents need").getByRole("img", { name: "Failed" })).toBeVisible();
    await keepScreenshot(dialog, "base-image-lacks");
    await dialog.getByRole("button", { name: "Done" }).click();
    const runsBefore = runs().length;
    await sendMessage(page, "SAY On a base without git.");
    await expect(page.locator(".error-line:visible")).toContainText(lacks);
    expect(runs()).toHaveLength(runsBefore);
  });

  await test.step("one whose glibc is too old for Claude Code's own program is checked for it once that is installed, which says what it said", async () => {
    const dialog = await useBaseImage("team/old-glibc:1");
    await expect(setupSteps(dialog).locator(".sandbox-setup-problem")).toHaveText(
      /^Claude Code \S+ doesn't run on the sandbox's base image team\/old-glibc:1: claude: \/lib\/aarch64-linux-gnu\/libc\.so\.6: version `GLIBC_2\.38' not found$/,
    );
    await dialog.getByRole("button", { name: "Done" }).click();
  });

  await test.step("one with all they need is pulled with a bar of how far its fetching and then its unpacking got, then runs the VM, by its name as Docker reads it, checked once", async () => {
    const dialog = await useBaseImage("team/dev:1");
    await expect(setupSteps(dialog).getByRole("status")).toHaveText("Step 2 of 8");
    const pulling = stepRow(setupSteps(dialog), "Pull team/dev:1");
    await expect(pulling.locator(".sandbox-setup-detail")).toHaveText("Downloading team/dev:1 40%");
    const howFar = pulling.getByRole("progressbar", { name: "How far this step got" });
    await expect(howFar).toHaveAttribute("aria-valuenow", "40");
    await keepScreenshot(dialog, "base-image-pulling");
    writeFileSync(pullHeldBy(), "");
    await expect(pulling.locator(".sandbox-setup-detail")).toHaveText("Unpacking team/dev:1 60%");
    await expect(howFar).toHaveAttribute("aria-valuenow", "60");
    writeFileSync(unpackHeldBy(), "");
    await expect(dialog.locator(".room-sandbox-setup")).toHaveText("Set up on this Mac.");
    await dialog.getByRole("button", { name: "Done" }).click();
    await sendMessage(page, "SAY On the team's base.");
    await waitForTurnToEnd(page);
    await expect(lastAgentMessage(page)).toHaveText("On the team's base.");
    expect(imageRun(runs().at(-1)!)).toBe("docker.io/team/dev:1");
    expect(containerCalls().flatMap(([command, sub, ...rest]) => (command === "image" && sub === "pull" ? [rest.at(-1)!] : [])).filter((image) => image.includes("/team/"))).toEqual(["docker.io/team/lacks-git:1", "docker.io/team/old-glibc:1", "docker.io/team/dev:1"]);
    expect(loggedCalls("checks.log").map(imageRun)).toEqual(["docker.io/team/lacks-git:1", "docker.io/team/old-glibc:1", "docker.io/team/old-glibc:1", "docker.io/team/dev:1", "docker.io/team/dev:1"]);
  });

  await test.step("cleared, the sandbox runs on Mirador's base again", async () => {
    const dialog = await useBaseImage("");
    await dialog.getByRole("button", { name: "Done" }).click();
    await sendMessage(page, "SAY On Mirador's base.");
    await waitForTurnToEnd(page);
    await expect(lastAgentMessage(page)).toHaveText("On Mirador's base.");
    expect(imageRun(runs().at(-1)!)).toMatch(/^mirador-sandbox-base:[0-9a-f]{10}$/);
  });
});

test("while the workspace is sandboxed, a Codex profile is refused with what to do instead, and new conversations can't start in worktrees", async ({ page }) => {
  test.skip(!sandboxesRunHere, "Sandboxes run on macOS 26 on Apple silicon only.");
  await signIn(page, host);
  const card = projectCard(page);
  const refusedCodex =
    "Coder can't run in a sandbox yet: sandboxes run Claude Code and pi agents for now, other kinds are coming. Pick a profile that can run there, or turn the sandbox off for this workspace.";
  await card.getByLabel("Agent", { exact: true }).selectOption({ label: "Coder · Codex" });

  await test.step("the sandbox's settings say new conversations start on a profile that can't run there", async () => {
    const dialog = await openSandboxOf(page, card, "project");
    await expect(dialog.locator(".workspace-sandbox-starts-on-why")).toHaveText(
      "New conversations here start on a profile that can't run in the sandbox. Coder can't run in a sandbox yet: sandboxes run Claude Code and pi agents for now, other kinds are coming.",
    );
    await expect(startOnPicker(dialog).locator("option:not([disabled])")).toHaveText(["Builder · Claude Code"]);
    await keepScreenshot(dialog, "starts-on-refused");
    await expect(sandboxSwitch(dialog)).toBeChecked();
    await dialog.getByRole("button", { name: "Done" }).click();
  });

  await test.step("a conversation on it says so under its header as it starts, and again for a message, starting nothing", async () => {
    const execsBefore = containerCalls().filter(([command]) => command === "exec").length;
    await startConversation(page);
    const refused = `This workspace runs its agents in a sandbox, where this one can't run. ${refusedCodex}`;
    await expect(chatHeader(page).locator(".badge")).toHaveText("error");
    await expect(page.locator(".status-detail:visible")).toHaveText(refused);
    await sendMessage(page, "SAY Hello.");
    await expect(page.locator(".error-line:visible")).toHaveText(refused);
    await keepPageScreenshot(page, "codex-refused");
    expect(containerCalls().filter(([command]) => command === "exec")).toHaveLength(execsBefore);
  });

  await test.step("the sandbox's settings start new conversations on a profile picked there from those that can run in it", async () => {
    const dialog = await openSandboxOf(page, card, "project");
    await startOnPicker(dialog).selectOption({ label: "Builder · Claude Code" });
    await expect(dialog.locator(".workspace-sandbox-starts-on")).toHaveCount(0);
    await expect(card.locator(".agent-chip-label")).toHaveText("Builder · Claude Code");
    await dialog.getByRole("button", { name: "Done" }).click();
  });

  await test.step("the worktree choice is off, says why, and leads to the sandbox's settings", async () => {
    await clickWorkspaceButton(card, "Where conversations work…");
    const where = page.getByRole("dialog", { name: "Where conversations work in project" });
    await expect(where.getByRole("radio", { name: /The project folder/ })).toBeChecked();
    await expect(where.getByRole("radio", { name: /A worktree of their own/ })).toBeDisabled();
    await expect(where.locator(".worktrees-sandboxed")).toContainText("While this workspace runs its agents in a sandbox, new conversations start in the project folder: the sandbox doesn't see worktrees.");
    await expect(where.getByRole("button", { name: /^Start one in / })).toHaveCount(0);
    await keepScreenshot(where, "worktrees-off");
    await where.getByRole("button", { name: "Sandbox settings…" }).click();
    await expect(where).toHaveCount(0);
    await expect(sandboxSwitch(sandboxDialog(page, "project"))).toBeChecked();
    await sandboxDialog(page, "project").getByRole("button", { name: "Done" }).click();
  });
});

test("turned off, the workspace's conversations start afresh on this computer once confirmed, and its marks go", async ({ page }) => {
  test.skip(!sandboxesRunHere, "Sandboxes run on macOS 26 on Apple silicon only.");
  await signIn(page, host);
  const card = projectCard(page);
  await openConversation(page, builderConversation);
  await expect(chatHeader(page).locator(".conversation-sandboxed")).toBeVisible();
  const dialog = await openSandboxOf(page, card, "project");
  await sandboxSwitch(dialog).uncheck();
  await expect(dialog.getByRole("alert").locator("span")).toHaveText("1 conversation here starts afresh as it goes on: its agent won't remember what was said before.");
  await dialog.getByRole("button", { name: "Change" }).click();
  await expect(sandboxSwitch(dialog)).not.toBeChecked();
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(card.locator(".workspace-sandboxed")).toHaveCount(0);
  await expect(chatHeader(page).locator(".conversation-sandboxed")).toHaveCount(0);

  await clickWorkspaceButton(card, "Where conversations work…");
  const where = page.getByRole("dialog", { name: "Where conversations work in project" });
  await expect(where.getByRole("radio", { name: /A worktree of their own/ })).toBeChecked();
  await expect(where.getByRole("radio", { name: /A worktree of their own/ })).toBeEnabled();
});

test("turned on, the workspace's sandbox leaves its conversations on this computer unless brought in, new ones start in it marked in the sidebar, and one moves in and out from its mark", async ({ page }) => {
  test.skip(!sandboxesRunHere, "Sandboxes run on macOS 26 on Apple silicon only.");
  writeBunProgram(host.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"), { FAKE_ACP_PROMPTS: join(host.root, "prompts-here") });
  await signIn(page, host);
  const card = projectCard(page);
  const agentChip = card.getByLabel("Agent", { exact: true });
  const timeline = page.locator(".timeline:visible");
  const contextCleared = timeline.getByText("Context cleared: the agent starts afresh");
  const sandboxRuns = () => containerCalls().filter(([command]) => command === "exec").length;
  const rowMark = (conversationId: string) => page.locator(`li[data-reorder-id="${conversationId}"] .conversation-sandboxed-row`);
  const headerMark = () => chatHeader(page).locator(".conversation-sandbox .sandboxed-mark");
  const placeMenu = () => page.getByRole("menu", { name: "Where this conversation's agent runs" });
  const askToMove = () => page.getByRole("alertdialog", { name: "Where this conversation's agent runs" });

  await test.step("new conversations start in the project folder, on this computer while the sandbox is off", async () => {
    await clickWorkspaceButton(card, "Where conversations work…");
    const where = page.getByRole("dialog", { name: "Where conversations work in project" });
    await where.getByRole("radio", { name: /The project folder/ }).check();
    await where.getByRole("button", { name: "Save" }).click();
    await expect(where).toHaveCount(0);
    const profiles = await createProfile(page, "Here", "", "", "opencode");
    await profiles.getByRole("button", { name: "Close" }).click();
  });

  await agentChip.selectOption({ label: "Here · opencode" });
  const kept = await startConversation(page);
  await sendMessage(page, "SAY Before the sandbox.");
  await waitForTurnToEnd(page);
  await agentChip.selectOption({ label: "Builder · Claude Code" });
  const moving = await startConversation(page);

  await test.step("the sandbox turns on without bringing them in, saying what that leaves open", async () => {
    const dialog = await openSandboxOf(page, card, "project");
    const bringIn = dialog.getByRole("checkbox", { name: /^Bring the \d+ conversations here into the sandbox too$/ });
    await expect(bringIn).not.toBeChecked();
    await expect(dialog.locator(".workspace-sandbox-bring-in .hint")).toHaveText(
      "Left out, they go on on this computer as they are, and only new conversations start in the sandbox. An agent on this computer can still run what a sandboxed agent writes in the project folder.",
    );
    await keepScreenshot(dialog, "bring-in-left-out");
    await sandboxSwitch(dialog).check();
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    await expect(sandboxSwitch(dialog)).toBeChecked();
    await expect(dialog.locator(".workspace-sandbox-outside")).toHaveText(/^\d+ conversations here run on this computer, outside the sandbox\. Move one in from the mark at its top\.$/);
    await dialog.getByRole("button", { name: "Done" }).click();
  });

  await test.step("a conversation left out goes on in its session on this computer, marked so", async () => {
    await openConversation(page, kept);
    await expect(headerMark()).toHaveText("On this computer");
    await expect(rowMark(kept)).toHaveCount(0);
    const runsBefore = sandboxRuns();
    await sendMessage(page, "SAY Still here.");
    await waitForTurnToEnd(page);
    await expect(lastAgentMessage(page)).toHaveText("Still here.");
    await expect(contextCleared).toHaveCount(0);
    expect(sandboxRuns()).toBe(runsBefore);
  });

  await test.step("a new conversation starts in the sandbox, marked in the sidebar too", async () => {
    const started = await startConversation(page);
    await expect(headerMark()).toHaveText("Sandboxed");
    await expect(rowMark(started)).toHaveAttribute("data-hint", "Runs in the sandbox");
    await keepScreenshot(card, "sidebar-row-marks");
    await sendMessage(page, "SAY In the sandbox.");
    await waitForTurnToEnd(page);
    await expect(lastAgentMessage(page)).toHaveText("In the sandbox.");
  });

  await test.step("moved in from its mark, the conversation's agent works in the sandbox", async () => {
    await openConversation(page, moving);
    await expect(headerMark()).toHaveText("On this computer");
    await headerMark().click();
    await expect(placeMenu().getByRole("menuitemcheckbox", { name: "Run in the sandbox" })).toHaveAttribute("aria-checked", "false");
    await keepScreenshot(chatHeader(page), "conversation-menu-outside");
    await placeMenu().getByRole("menuitemcheckbox", { name: "Run in the sandbox" }).click();
    await expect(headerMark()).toHaveText("Sandboxed");
    await expect(rowMark(moving)).toHaveCount(1);
    const runsBefore = sandboxRuns();
    await sendMessage(page, "FOLDER");
    await waitForTurnToEnd(page);
    await expect(lastAgentMessage(page)).toHaveText(`Working in ${realpathSync(host.projectDir)}`);
    expect(sandboxRuns()).toBeGreaterThan(runsBefore);
  });

  await test.step("moved out again once confirmed, as its agent would forget what was said, it runs on this computer", async () => {
    await headerMark().click();
    await expect(placeMenu().getByRole("menuitemcheckbox", { name: "Run in the sandbox" })).toHaveAttribute("aria-checked", "true");
    await placeMenu().getByRole("menuitemcheckbox", { name: "Run in the sandbox" }).click();
    await expect(askToMove()).toContainText("Its agent moves to this computer and starts afresh: it won't remember what was said before.");
    await keepScreenshot(chatHeader(page), "conversation-move-out-asks");
    await askToMove().getByRole("button", { name: "Move it out" }).click();
    await expect(headerMark()).toHaveText("On this computer");
    await expect(rowMark(moving)).toHaveCount(0);
  });

  await test.step("the mark's menu opens the sandbox's settings, where it is turned off again", async () => {
    await headerMark().click();
    await placeMenu().getByRole("menuitem", { name: "Sandbox settings…" }).click();
    const dialog = sandboxDialog(page, "project");
    await sandboxSwitch(dialog).uncheck();
    await dialog.getByRole("button", { name: "Change" }).click();
    await expect(sandboxSwitch(dialog)).not.toBeChecked();
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(headerMark()).toHaveCount(0);
  });
});

test("the switch stays off where the way to the workspace follows a link inside a folder a sandbox worked in, saying so", async ({ page }) => {
  test.skip(!sandboxesRunHere, "Sandboxes run on macOS 26 on Apple silicon only.");
  const elsewhere = join(host.root, "elsewhere");
  execFileSync("git", ["init", "-q", elsewhere]);
  const linked = inProject("linked");
  symlinkSync(elsewhere, linked);
  await signIn(page, host);
  await addWorkspaceFromSidebar(page, linked);
  const dialog = await openSandboxOf(page, workspaceCard(page, linked), "linked");
  await expect(reasons(dialog)).toHaveText(
    `The way to the workspace follows the link ${join(realpathSync(host.projectDir), "linked")}, inside a folder a sandbox worked in, whose agents could have made it lead anywhere: open the workspace at the folder the link leads to, to use a sandbox.`,
  );
  await expect(sandboxSwitch(dialog)).toBeDisabled();
  await keepScreenshot(dialog, "way-through-link-sandbox-left");
  await dialog.getByRole("button", { name: "Done" }).click();
});

/** A VM another Mirador on this computer runs, as the shared `container` lists it, mounting `folder` read and write; it goes again with the call it returns. */
function anotherMiradorsVmIn(folder: string) {
  const name = "mirador-of-another-host";
  const changeState = (changing: (state: { vms: Record<string, Record<string, string>>; mounts?: Record<string, unknown[]> }) => void) => {
    const statePath = join(containerState(), "state.json");
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    changing(state);
    writeFileSync(`${statePath}.spec`, JSON.stringify(state));
    renameSync(`${statePath}.spec`, statePath);
  };
  changeState((state) => {
    state.vms[name] = { "mirador.host": "another-mirador", "mirador.owner": "workspace:theirs" };
    state.mounts = { ...state.mounts, [name]: [{ source: `${folder}/`, options: [] }] };
  });
  return () =>
    changeState((state) => {
      delete state.vms[name];
      delete state.mounts?.[name];
    });
}

test("a sandboxed conversation doesn't start its VM where another Mirador on this computer has one writing in the workspace, saying so, and does once that one has gone", async ({ page }) => {
  test.skip(!sandboxesRunHere, "Sandboxes run on macOS 26 on Apple silicon only.");
  const shared = join(host.root, "shared-with-another");
  execFileSync("git", ["init", "-q", shared]);
  await signIn(page, host);
  await addWorkspaceFromSidebar(page, shared);
  const card = workspaceCard(page, shared);
  await card.getByLabel("Agent", { exact: true }).selectOption({ label: "Builder · Claude Code" });
  const dialog = await openSandboxOf(page, card, "shared-with-another");
  await sandboxSwitch(dialog).check();
  await expect(dialog.locator(".room-sandbox-setup")).toHaveText("Set up on this Mac.");
  await dialog.getByRole("button", { name: "Done" }).click();

  const gone = anotherMiradorsVmIn(realpathSync(shared));
  try {
    const previousUrl = page.url();
    await card.getByRole("button", { name: "+ New conversation" }).click();
    await expect(page).not.toHaveURL(previousUrl);
    const runsBefore = containerCalls().filter(([command]) => command === "run").length;
    await sendMessage(page, "SAY Hello.");
    await expect(page.locator(".error-line:visible")).toContainText(
      `Another Mirador on this computer has a sandbox at work that writes in ${realpathSync(shared)}, where this sandbox would work or on the way there: wait until that sandbox stops, or stop it in that Mirador, to use this one.`,
    );
    await keepPageScreenshot(page, "other-mirador-writes-there");
    expect(containerCalls().filter(([command]) => command === "run")).toHaveLength(runsBefore);
  } finally {
    gone();
  }

  await sendMessage(page, "SAY Hello again.");
  await waitForTurnToEnd(page);
  await expect(lastAgentMessage(page)).toHaveText("Hello again.");
});

test("a repository the owner makes in the workspace while its VM runs, with a hooks folder of its own, stops the VM by the turn's end, and the next turn works in one that guards it", async ({ page }) => {
  test.skip(!sandboxesRunHere, "Sandboxes run on macOS 26 on Apple silicon only.");
  const shared = join(host.root, "shared-with-another");
  await signIn(page, host);
  const card = workspaceCard(page, shared);
  const previousUrl = page.url();
  await card.getByRole("button", { name: "+ New conversation" }).click();
  await expect(page).not.toHaveURL(previousUrl);
  await sendMessage(page, "SAY Ready.");
  await waitForTurnToEnd(page);

  const runs = () => containerCalls().filter(([command]) => command === "run");
  const runsBefore = runs().length;
  const run = runs().findLast((each) => JSON.stringify(each).includes(realpathSync(shared)))!;
  const vm = run[run.indexOf("--name") + 1]!;
  const vmStopped = () => containerCalls().some(([command, name]) => command === "stop" && name === vm);
  const holdsTheTurn = join(host.root, "holds-the-turn-89");
  await sendMessage(page, `WRITE ${JSON.stringify([{ waitFor: holdsTheTurn }])}`);
  await expect.poll(() => promptsSoFar().includes(holdsTheTurn)).toBe(true);

  const vendored = join(shared, "vendor", "lib");
  mkdirSync(vendored, { recursive: true });
  execFileSync("git", ["init", "-q", vendored]);
  execFileSync("git", ["-C", vendored, "config", "core.hooksPath", "githooks"]);
  writeFileSync(holdsTheTurn, "");
  await expect.poll(vmStopped, { timeout: 15_000 }).toBe(true);
  await waitForTurnToEnd(page);

  await sendMessage(page, "SAY Guarded.");
  await waitForTurnToEnd(page);
  await expect(lastAgentMessage(page)).toHaveText("Guarded.");
  expect(runs()).toHaveLength(runsBefore + 1);
  const [workspaceGuarded] = guardedIn(mountsOfRun(runs().at(-1)!));
  expect(workspaceGuarded).toMatchObject({ folder: realpathSync(shared), parts: { folders: ["vendor/lib/githooks"] } });
});

test("where none of the profiles can run in the sandbox, its settings say so and name the kind that could", async ({ page }) => {
  await signIn(page, host);
  const card = projectCard(page);
  await card.getByLabel("Agent", { exact: true }).selectOption({ label: "Coder · Codex" });
  const profiles = await openProfiles(page);
  await profiles.locator(".profile-list li", { hasText: "Builder" }).click();
  await profiles.getByRole("button", { name: "Delete profile" }).click();
  await profiles.getByRole("button", { name: "Confirm: Delete profile" }).click();
  await profiles.getByRole("button", { name: "Close" }).click();

  const dialog = await openSandboxOf(page, card, "project");
  await expect(dialog.locator(".workspace-sandbox-no-profile-runs")).toHaveText(
    "None of your profiles can run in the sandbox. A Claude Code profile that signs in with an API key or a CLAUDE_CODE_OAUTH_TOKEN can, and so can a pi profile whose model pi's models.json sets up with a key.",
  );
  await expect(startOnPicker(dialog)).toHaveCount(0);
  await dialog.getByRole("button", { name: "Done" }).click();
});

const PI_KEY = "sk-e2e-pi-gateway-key-4321";
const PI_TEAM = "e2e-pi-team-header-9876";
const piWorkspace = () => join(host.root, "pi-project");

/** A pi agent folder made for the test, as the profile names it in PI_CODING_AGENT_DIR. */
function piAgentFolder(name: string, models: unknown, settings: unknown) {
  const folder = join(host.root, name);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "models.json"), JSON.stringify(models));
  writeFileSync(join(folder, "settings.json"), JSON.stringify(settings));
  return folder;
}

/** The pi the host asks for its version, which the sandbox's image installs from npm. */
function piSayingItsVersion() {
  const program = join(host.root, "fake-pi", "pi");
  mkdirSync(dirname(program), { recursive: true });
  writeFileSync(program, `#!/bin/sh\necho 1.6.0\n`);
  chmodSync(program, 0o755);
  return program;
}

/** A model provider on this computer that answers every request and keeps the path and headers of each. */
async function modelProviderHere() {
  const requests: { path: string; headers: IncomingHttpHeaders }[] = [];
  const server = createServer((request, response) => {
    requests.push({ path: request.url ?? "", headers: request.headers });
    response.writeHead(200, { "content-type": "application/json" }).end(`{"answered":true}`);
  });
  await new Promise<void>((listening) => server.listen(0, "127.0.0.1", listening));
  return { baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, requests, close: () => server.close() };
}

/** A connection as the VM's relays pass a program's on, past the byte Mirador says as it takes it. */
const takenConnection = (socketPath: string) =>
  new Promise<Socket>((taken, failed) => {
    const socket = connect(socketPath);
    socket.once("error", failed);
    socket.once("readable", () => {
      socket.read(1);
      taken(socket);
    });
  });

/** What the model proxy answers a request the VM's model relay passes on, by the socket the VM was given. */
async function askedThroughModelSocket(socketPath: string, path: string, headers: Record<string, string>) {
  const socket = await takenConnection(socketPath);
  return new Promise<string>((answered, failed) => {
    const asking = httpRequest({ createConnection: () => socket, path, method: "POST", headers: { host: "127.0.0.1:7702", "content-type": "application/json", connection: "close", ...headers } }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => (body += chunk));
      response.on("end", () => answered(`${response.statusCode} ${body.trim()}`));
    });
    asking.on("error", failed);
    asking.end("{}");
  });
}

test("a pi profile's agent runs in the sandbox on the pi of this computer, reaching its model through Mirador, which adds its key and headers; one on a model pi knows by itself is refused saying why", async ({ page }) => {
  test.skip(!sandboxesRunHere, "Sandboxes run on macOS 26 on Apple silicon only.");
  const provider = await modelProviderHere();
  try {
    const piAgent = piAgentFolder(
      "pi-agent",
      {
        providers: {
          gateway: {
            api: "openai-completions",
            baseUrl: provider.baseUrl,
            apiKey: "$PIPER_KEY",
            headers: { "x-team": "${PIPER_TEAM}" },
            models: [{ id: "e2e-model", name: "E2E model" }, { id: "elsewhere", baseUrl: "http://127.0.0.1:9/v1" }],
          },
        },
      },
      { defaultProvider: "gateway", defaultModel: "e2e-model", defaultThinkingLevel: "low", packages: ["npm:an-extension-of-this-computer"] },
    );
    const builtInAgent = piAgentFolder("pi-agent-built-in", {}, { defaultProvider: "anthropic", defaultModel: "claude-sonnet-4-5" });
    const pi = piSayingItsVersion();
    mkdirSync(piWorkspace(), { recursive: true });
    execFileSync("git", ["init", "-q", piWorkspace()]);

    await signIn(page, host);
    for (const [name, folder, more] of [
      ["Piper", piAgent, `\nPIPER_KEY=${PI_KEY}\nPIPER_TEAM=${PI_TEAM}`],
      ["Builtin", builtInAgent, ""],
    ]) {
      const profiles = await createProfile(page, name!, `PI_CODING_AGENT_DIR=${folder}\nPI_ACP_PI_COMMAND=${pi}\nPI_OFFLINE=1${more}`, "", "pi");
      await profiles.getByRole("button", { name: "Close" }).click();
    }
    await addWorkspaceFromSidebar(page, piWorkspace());
    const card = workspaceCard(page, piWorkspace());
    await card.getByLabel("Agent", { exact: true }).selectOption({ label: "Builtin · pi" });

    await test.step("the sandbox's settings say why the pi profile on a model pi knows by itself can't run there, and offer the one that can", async () => {
      const dialog = await openSandboxOf(page, card, "pi-project");
      await expect(dialog.locator(".workspace-sandbox-starts-on-why")).toHaveText(
        "New conversations here start on a profile that can't run in the sandbox. Builtin uses a model pi knows by itself. A sandbox reaches only a model that pi's models.json sets up: add it there with its key.",
      );
      await expect(startOnPicker(dialog).locator("option:not([disabled])")).toHaveText(["Piper · pi"]);
      await keepScreenshot(dialog, "pi-starts-on-refused");
      await startOnPicker(dialog).selectOption({ label: "Piper · pi" });
      await expect(dialog.locator(".workspace-sandbox-starts-on")).toHaveCount(0);
      await sandboxSwitch(dialog).check();
      await expect(dialog.locator(".room-sandbox-setup")).toHaveText("Set up on this Mac.");
      await dialog.getByRole("button", { name: "Done" }).click();
    });

    const previousUrl = page.url();
    await card.getByRole("button", { name: "+ New conversation" }).click();
    await expect(page).not.toHaveURL(previousUrl);
    await expect(chatHeader(page).locator(".conversation-sandboxed")).toHaveText("Sandboxed");
    const seen = join(host.root, "pi-seen");
    const shown = ["MIRADOR_PI_MODELS", "MIRADOR_PI_SETTINGS", "PI_ACP_PI_COMMAND", "PI_CODING_AGENT_DIR", "PIPER_KEY", "PIPER_TEAM"].map((name) => `{{env:${name}}}`).join("\n");
    await sendMessage(page, `WRITE ${JSON.stringify([{ edit: seen, content: shown }])}`);
    await waitForTurnToEnd(page);
    const [models, settings, piCommand, agentFolder, ...keys] = readFileSync(seen, "utf8").split("\n");
    const { providers } = JSON.parse(models!) as { providers: Record<string, { baseUrl: string }> };
    const relayed = /^http:\/\/127\.0\.0\.1:7702\/p\/[A-Za-z0-9-]+$/;

    await test.step("pi in the VM gets the default model's provider with the relay for its address and a key that is none, the settings that choose its model, and none of the key's values", () => {
      expect(providers).toEqual({ gateway: { api: "openai-completions", baseUrl: expect.stringMatching(relayed), apiKey: "kept-by-mirador", models: [{ id: "e2e-model", name: "E2E model" }] } });
      expect(JSON.parse(settings!)).toEqual({ defaultProvider: "gateway", defaultModel: "e2e-model", defaultThinkingLevel: "low" });
      expect(piCommand).toBe("/mirador/sandbox/pi.sh");
      expect(agentFolder!.startsWith(join(host.dataDir, "sandbox"))).toBe(true);
      expect(keys).toEqual(["", ""]);
    });

    const calls = containerCalls();
    const run = calls.findLast(([command, ...rest]) => command === "run" && rest.some((argument) => argument.startsWith("mirador.owner=workspace:")) && JSON.stringify(rest).includes(realpathSync(piWorkspace())))!;

    await test.step("the sandbox runs the pi on this computer, installed in Mirador's tools folder on the base image, with that folder and Mirador's scripts read-only and nothing of the profile's own pi folder", () => {
      expect(toolInstalls().some((install) => install.some((argument) => argument.includes("@earendil-works/pi-coding-agent@1.6.0")))).toBe(true);
      expect(run).toContainEqual(expect.stringMatching(/^mirador-sandbox-base:[0-9a-f]{10}$/));
      expect(run.some((argument) => argument.endsWith(":/opt/mirador:ro"))).toBe(true);
      expect(run.some((argument) => argument.endsWith(":/mirador/sandbox:ro"))).toBe(true);
      expect(calls.some(([command, ...rest]) => command === "exec" && rest.some((argument) => argument.startsWith("PATH=/opt/mirador/pi-1.6.0/bin:")))).toBe(true);
      expect(JSON.stringify(calls)).not.toContain(piAgent);
      expect(JSON.stringify([calls, toolInstalls()])).not.toContain(PI_KEY);
      expect(JSON.stringify(calls)).not.toContain(PI_TEAM);
    });

    await test.step("the model proxy passes the agent's requests on to its provider's path with the key and headers added, the VM's own key dropped, and refuses another API's path", async () => {
      const socket = run.find((argument) => argument.endsWith(":/run/mirador/model.sock"))!.split(":")[0]!;
      const routed = new URL(providers.gateway!.baseUrl).pathname;
      const inVm = { authorization: "Bearer kept-by-mirador", "x-pi-session-id": "a-session" };
      expect(await askedThroughModelSocket(socket, `${routed}/chat/completions`, inVm)).toBe(`200 {"answered":true}`);
      expect(await askedThroughModelSocket(socket, `${routed}/v1/messages`, inVm)).toBe("404 not a path of the model API");
      expect(provider.requests.map(({ path, headers }) => ({ path, authorization: headers.authorization, team: headers["x-team"], session: headers["x-pi-session-id"] }))).toEqual([
        { path: "/v1/chat/completions", authorization: `Bearer ${PI_KEY}`, team: PI_TEAM, session: "a-session" },
      ]);
    });
  } finally {
    provider.close();
  }
});

test("a Claude Code profile with CLAUDE_CODE_OAUTH_TOKEN runs in the sandbox with a placeholder token while the model proxy adds the real Bearer token", async ({ page }) => {
  test.skip(!sandboxesRunHere, "Sandboxes run on macOS 26 on Apple silicon only.");
  const OAUTH_TOKEN = "sk-ant-oat01-e2e-setup-token-7654";
  const oauthWorkspace = join(host.root, "oauth-project");
  const provider = await modelProviderHere();
  const providerOrigin = new URL(provider.baseUrl).origin;
  try {
    mkdirSync(oauthWorkspace, { recursive: true });
    execFileSync("git", ["init", "-q", oauthWorkspace]);

    await signIn(page, host);
    const profiles = await createProfile(page, "Personal", `CLAUDE_CODE_OAUTH_TOKEN=${OAUTH_TOKEN}\nANTHROPIC_BASE_URL=${providerOrigin}`, "", "Claude Code");
    await profiles.getByRole("button", { name: "Close" }).click();
    await addWorkspaceFromSidebar(page, oauthWorkspace);
    const card = workspaceCard(page, oauthWorkspace);
    await card.getByLabel("Agent", { exact: true }).selectOption({ label: "Personal · Claude Code" });

    const dialog = await openSandboxOf(page, card, "oauth-project");
    await expect(dialog.locator(".workspace-sandbox-starts-on")).toHaveCount(0);
    await sandboxSwitch(dialog).check();
    await expect(dialog.locator(".room-sandbox-setup")).toHaveText("Set up on this Mac.");
    await dialog.getByRole("button", { name: "Done" }).click();

    const previousUrl = page.url();
    await card.getByRole("button", { name: "+ New conversation" }).click();
    await expect(page).not.toHaveURL(previousUrl);
    await expect(chatHeader(page).locator(".conversation-sandboxed")).toHaveText("Sandboxed");

    const seen = join(host.root, "oauth-seen");
    const shown = ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_BASE_URL", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"].map((name) => `{{env:${name}}}`).join("\n");
    await sendMessage(page, `WRITE ${JSON.stringify([{ edit: seen, content: shown }])}`);
    await waitForTurnToEnd(page);
    const [oauthInVm, baseUrlInVm, apiKeyInVm, authTokenInVm] = readFileSync(seen, "utf8").split("\n");
    expect(oauthInVm).toBe("kept-by-mirador");
    expect(baseUrlInVm).toMatch(/^http:\/\/127\.0\.0\.1:7702\/p\/[A-Za-z0-9-]+$/);
    expect([apiKeyInVm, authTokenInVm]).toEqual(["", ""]);

    const calls = containerCalls();
    expect(JSON.stringify(calls)).not.toContain(OAUTH_TOKEN);
    const run = calls.findLast(([command, ...rest]) => command === "run" && rest.some((argument) => argument.startsWith("mirador.owner=workspace:")) && JSON.stringify(rest).includes(realpathSync(oauthWorkspace)))!;
    const socket = run.find((argument) => argument.endsWith(":/run/mirador/model.sock"))!.split(":")[0]!;
    const routed = new URL(baseUrlInVm!).pathname;
    expect(await askedThroughModelSocket(socket, `${routed}/v1/messages?beta=true`, { authorization: "Bearer kept-by-mirador", "anthropic-beta": "claude-code-20250219,oauth-2025-04-20" })).toBe(`200 {"answered":true}`);
    expect(provider.requests.map(({ path, headers }) => ({ path, authorization: headers.authorization, beta: headers["anthropic-beta"], xApiKey: headers["x-api-key"] }))).toEqual([
      { path: "/v1/messages?beta=true", authorization: `Bearer ${OAUTH_TOKEN}`, beta: "claude-code-20250219,oauth-2025-04-20", xApiKey: undefined },
    ]);
  } finally {
    provider.close();
  }
});
