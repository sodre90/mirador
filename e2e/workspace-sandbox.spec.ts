import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { release } from "node:os";
import { dirname, join } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { addWorkspace, addWorkspaceFromSidebar, clickWorkspaceButton, createProfile, lastAgentMessage, openProfiles, sendMessage, signIn, waitForTurnToEnd, workspaceCard } from "./helpers.ts";
import { bunProgramPath, TestHost, writeBunProgram } from "./test-host.ts";

const sandboxesRunHere = process.platform === "darwin" && process.arch === "arm64" && Number(release().split(".")[0]) >= 25;
const KEY = "sk-e2e-sandboxed-workspace-key-8765";

const host = new TestHost({ fakePrograms: true, environment: () => ({ ANTHROPIC_BASE_URL: "http://127.0.0.1:9", MIRADOR_SANDBOX: fakeContainer() }) });
const fakeContainer = () => bunProgramPath(join(host.root, "fake-container"), "container");
const containerState = () => join(host.root, "fake-container-state");
const buildHeldBy = () => join(host.root, "build-may-go-on");
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
const sandboxSwitch = (dialog: Locator) => dialog.getByRole("switch", { name: "Run this workspace's agents in a sandbox" });
const reasons = (dialog: Locator) => dialog.locator(".room-sandbox-reasons");
const startOnPicker = (dialog: Locator) => dialog.getByRole("combobox", { name: "Start new conversations on" });
const heldCard = (scope: Page | Locator) => scope.getByRole("region", { name: "Agent config change held for you" });
const chatHeader = (page: Page) => page.locator(".chat-header:visible");

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

/** Each call the fake `container` got, by its arguments. */
const containerCalls = (): string[][] =>
  readFileSync(join(containerState(), "calls.log"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

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

test("turned on, the workspace's sandbox is set up with its progress shown, marked in the sidebar and the conversation, and its agent works in a VM of its own without the key", async ({ page }) => {
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
  const setup = dialog.locator(".room-sandbox-setup");
  await expect(setup).toHaveText("Building the agents' image on this Mac: step 2 of 3…");
  await keepScreenshot(dialog, "setup-progress");
  writeFileSync(buildHeldBy(), "");
  await expect(setup).toHaveText("Set up on this Mac.");
  await keepScreenshot(dialog, "switch-on");
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toBeHidden();

  const sidebarMark = card.locator(".workspace-sandboxed");
  await expect(sidebarMark).toHaveAccessibleName("Sandboxed");
  await expect(sidebarMark).toHaveAttribute("data-hint", "This workspace's agents run in a sandbox. Click for its settings.");
  await keepScreenshot(card.locator(":scope > header"), "sidebar-mark");

  builderConversation = await startConversation(page);
  const headerMark = chatHeader(page).locator(".conversation-sandboxed");
  await expect(headerMark).toHaveText("Sandboxed");
  await keepScreenshot(chatHeader(page), "header-mark");

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

  await test.step("the project's .gitconfig, which its git config includes, is read-only in the VM, from a copy", () => {
    const includedMount = run.find((argument) => argument.endsWith(`:${realpathSync(inProject(".gitconfig"))}:ro`));
    const copy = includedMount!.split(":")[0]!;
    expect(copy.startsWith(`${join(host.dataDir, "sandbox", "workspaces")}/`)).toBe(true);
    expect(readFileSync(copy, "utf8")).toBe("[mirador]\n\tteam = shared\n");
  });

  await test.step("the conversation's mark opens the workspace's sandbox", async () => {
    await headerMark.click();
    await expect(sandboxSwitch(dialog)).toBeChecked();
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

test("while the workspace is sandboxed, a Codex profile is refused with what to do instead, and new conversations can't start in worktrees", async ({ page }) => {
  test.skip(!sandboxesRunHere, "Sandboxes run on macOS 26 on Apple silicon only.");
  await signIn(page, host);
  const card = projectCard(page);
  const refusedCodex =
    "Coder isn't a Claude Code agent: sandboxes run Claude Code agents only for now, other kinds are coming. Pick a Claude profile that signs in with an API key, or turn the sandbox off for this workspace.";
  await card.getByLabel("Agent", { exact: true }).selectOption({ label: "Coder · Codex" });

  await test.step("the sandbox's settings say new conversations start on a profile that can't run there", async () => {
    const dialog = await openSandboxOf(page, card, "project");
    await expect(dialog.locator(".workspace-sandbox-starts-on-why")).toHaveText(
      "New conversations here start on a profile that can't run in the sandbox. Coder isn't a Claude Code agent: sandboxes run Claude Code agents only for now, other kinds are coming.",
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
  await expect(dialog.locator(".workspace-sandbox-no-profile-runs")).toHaveText("None of your profiles can run in the sandbox. A Claude Code profile that signs in with an API key can.");
  await expect(startOnPicker(dialog)).toHaveCount(0);
  await dialog.getByRole("button", { name: "Done" }).click();
});
