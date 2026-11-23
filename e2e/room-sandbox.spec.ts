import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { release } from "node:os";
import { dirname, join } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { addWorkspace, addWorkspaceFromSidebar, clickWorkspaceButton, createProfile, createRoom, lastAgentMessage, openRoomSettings, roomCard, sendMessage, signIn, waitForTurnToEnd, workspaceCard } from "./helpers.ts";
import { bunProgramPath, TestHost, writeBunProgram } from "./test-host.ts";

const sandboxesRunHere = process.platform === "darwin" && process.arch === "arm64" && Number(release().split(".")[0]) >= 25;
const KEY = "sk-e2e-sandboxed-profile-key-4321";

const host = new TestHost({ fakePrograms: true, environment: () => ({ ANTHROPIC_BASE_URL: "http://127.0.0.1:9", MIRADOR_SANDBOX: fakeContainer() }) });
const fakeContainer = () => bunProgramPath(join(host.root, "fake-container"), "container");
const containerState = () => join(host.root, "fake-container-state");
const buildHeldBy = () => join(host.root, "build-may-go-on");
const worktree = () => join(host.root, "worktree");
const promptsFile = () => join(host.root, "prompts");
const promptsSoFar = () => (existsSync(promptsFile()) ? readFileSync(promptsFile(), "utf8") : "");

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
  writeBunProgram(host.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"), { FAKE_ACP_PROMPTS: join(host.root, "stub-prompts") });
  mkdirSync(host.projectDir, { recursive: true });
  writeFileSync(join(host.projectDir, "CLAUDE.md"), "Be careful.\n");
  execFileSync("git", ["init", "-q", host.projectDir]);
  makeWorktree();
  await host.start();
  const page = await browser.newPage();
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  for (const [name, environment, agent] of [
    ["Builder", `ANTHROPIC_API_KEY=${KEY}`, "Claude Code"],
    ["Subscriber", "", "Claude Code"],
    ["Stub", "", "opencode"],
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

const roomComposer = (page: Page, room: string) => page.getByRole("textbox", { name: `Write in ${room}, @ tags an agent…` });
const answerSaying = (page: Page, text: string | RegExp) => page.locator(".room-timeline .room-entry .message.agent", { hasText: text });
const sandboxSwitch = (dialog: Locator) => dialog.getByRole("switch", { name: "Run the agents in a sandbox" });
const reasons = (dialog: Locator) => dialog.locator(".room-sandbox-reasons");
const heldCard = (page: Page) => page.getByRole("region", { name: "Agent config change held for you" });

async function tag(page: Page, room: string, agent: string, rest: string) {
  await roomComposer(page, room).fill(`@${agent.slice(0, 2)}`);
  await page.getByRole("listbox", { name: "Agents and people of the room" }).getByRole("option", { name: `@${agent}` }).click();
  await roomComposer(page, room).fill(`@${agent} ${rest}`);
  await roomComposer(page, room).press("Enter");
}

/** Each call the fake `container` got, by its arguments. */
const containerCalls = (): string[][] =>
  readFileSync(join(containerState(), "calls.log"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

const containerStateNow = () => JSON.parse(readFileSync(join(containerState(), "state.json"), "utf8")) as { builderRunning: boolean; images: string[]; vms: Record<string, unknown> };

test("the sandbox switch stays off, with the reason under it, where the computer, an agent or the workspace can't have one", async ({ page }) => {
  await signIn(page, host);
  if (!sandboxesRunHere) {
    await createRoom(page, "Anywhere", ["Builder"]);
    const dialog = await openRoomSettings(page, "Anywhere", "Permissions");
    await expect(reasons(dialog)).toBeVisible();
    await expect(sandboxSwitch(dialog)).toBeDisabled();
    return;
  }
  await test.step("an agent of another kind", async () => {
    await createRoom(page, "Mixed", ["Builder", "Stub"]);
    const dialog = await openRoomSettings(page, "Mixed", "Permissions");
    await expect(reasons(dialog)).toHaveText("Stub isn't a Claude Code agent: sandboxes run Claude Code agents only for now, other kinds are coming.");
    await expect(sandboxSwitch(dialog)).toBeDisabled();
    await dialog.getByRole("button", { name: "Done" }).click();
  });
  await test.step("a Claude agent that signs in with a subscription", async () => {
    await createRoom(page, "Subscribed", ["Subscriber"]);
    const dialog = await openRoomSettings(page, "Subscribed", "Permissions");
    await expect(reasons(dialog)).toHaveText(/^Subscriber signs in with a Claude subscription/);
    await expect(sandboxSwitch(dialog)).toBeDisabled();
    await keepScreenshot(dialog, "switch-off-with-reason");
    await dialog.getByRole("button", { name: "Done" }).click();
  });
  await test.step("a workspace that is a git worktree", async () => {
    await addWorkspaceFromSidebar(page, worktree());
    await createRoom(page, "Branched", ["Builder"], { workspace: "worktree" });
    const dialog = await openRoomSettings(page, "Branched", "Permissions");
    await expect(reasons(dialog)).toHaveText(/^The room's workspace is a git worktree/);
    await expect(sandboxSwitch(dialog)).toBeDisabled();
    await dialog.getByRole("button", { name: "Done" }).click();
  });
  expect(containerCalls().filter(([command]) => command !== "system")).toEqual([]);
});

test("turned on, the sandbox is set up on this Mac with its progress shown, and the agent works in its VM as the agent user, without the key", async ({ page }) => {
  test.skip(!sandboxesRunHere, "Sandboxes run on macOS 26 on Apple silicon only.");
  await signIn(page, host);
  await createRoom(page, "Sandboxed", ["Builder"], { workspace: "project" });
  const dialog = await openRoomSettings(page, "Sandboxed", "Permissions");
  await expect(dialog.getByText("Checking whether this room can have a sandbox…")).toBeHidden();
  await sandboxSwitch(dialog).check();

  await expect(dialog.getByText("Network: only the model and Mirador")).toBeVisible();
  await expect(dialog.getByRole("radio", { name: "Agents work freely inside" })).toBeChecked();
  const setup = dialog.locator(".room-sandbox-setup");
  await expect(setup).toHaveText("Building the agents' image on this Mac: step 2 of 3…");
  await expect(setup.getByRole("progressbar")).toHaveAttribute("value", "2");
  await keepScreenshot(dialog, "setup-progress");
  writeFileSync(buildHeldBy(), "");
  await expect(setup).toHaveText("Set up on this Mac.");
  await keepScreenshot(dialog, "switch-on");
  expect(containerStateNow()).toMatchObject({ builderRunning: false, images: [expect.stringMatching(/^mirador-room-agent:claude-2\.1\.330-bun-/)] });
  await dialog.getByRole("button", { name: "Done" }).click();

  await tag(page, "Sandboxed", "Builder", "ENV ANTHROPIC_API_KEY");
  await expect(answerSaying(page, "ANTHROPIC_API_KEY is kept-by-mirador")).toBeVisible();
  await tag(page, "Sandboxed", "Builder", "FOLDER");
  await expect(answerSaying(page, `Working in ${realpathSync(host.projectDir)}`)).toBeVisible();

  const calls = containerCalls();
  const run = calls.find(([command]) => command === "run")!;
  expect(run[run.indexOf("--network") + 1]).toBe("none");
  const execs = calls.filter(([command]) => command === "exec");
  expect(execs.every((exec) => exec[exec.indexOf("--user") + 1] === "0:0" && exec.includes("--reuid=1000") && exec.includes("--no-new-privs"))).toBe(true);
  expect(JSON.stringify(calls)).not.toContain(KEY);
});

test("a change to an agent config file is put back at once and held in the room, until the owner allows or discards it", async ({ page }) => {
  test.skip(!sandboxesRunHere, "Sandboxes run on macOS 26 on Apple silicon only.");
  await signIn(page, host);
  await roomCard(page, "Sandboxed").click();
  const at = (path: string) => join(host.projectDir, path);
  const card = heldCard(page);

  await test.step("a new file comes as Builder works, and is written once allowed", async () => {
    const turnMayEnd = join(host.root, "turn-may-end");
    await tag(page, "Sandboxed", "Builder", `WAIT ${turnMayEnd} SAY Written.`);
    await expect.poll(promptsSoFar).toContain(turnMayEnd);
    writeFileSync(at(".mcp.json"), `{"mcpServers":{"tunnel":{"command":"curl"}}}\n`);
    await expect(card.locator(".room-held-title")).toHaveText("Builder wants to add .mcp.json");
    await expect(card.locator(".diff-added")).toContainText([`{"mcpServers":{"tunnel":{"command":"curl"}}}`]);
    expect(existsSync(at(".mcp.json"))).toBe(false);
    await keepScreenshot(card, "held-card");
    writeFileSync(turnMayEnd, "");
    await expect(answerSaying(page, "Written.")).toBeVisible();
    await card.getByRole("button", { name: "Allow" }).click();
    await expect(card).toBeHidden();
    expect(readFileSync(at(".mcp.json"), "utf8")).toBe(`{"mcpServers":{"tunnel":{"command":"curl"}}}\n`);
  });

  await test.step("a change to a file allowed before stays undone once discarded", async () => {
    writeFileSync(at(".mcp.json"), "{}\n");
    await expect(card.locator(".room-held-title")).toHaveText("An agent of the room wants to change .mcp.json");
    await expect(card.locator(".diff-removed")).toContainText([`{"mcpServers":{"tunnel":{"command":"curl"}}}`]);
    expect(readFileSync(at(".mcp.json"), "utf8")).toBe(`{"mcpServers":{"tunnel":{"command":"curl"}}}\n`);
    await card.getByRole("button", { name: "Discard" }).click();
    await expect(card).toBeHidden();
    expect(readFileSync(at(".mcp.json"), "utf8")).toBe(`{"mcpServers":{"tunnel":{"command":"curl"}}}\n`);
  });

  await test.step("a file there as the VM started is read-only in it, so the owner's own edit on this Mac stays", async () => {
    writeFileSync(at("CLAUDE.md"), "Be careful, says the owner.\n");
    await tag(page, "Sandboxed", "Builder", "SAY Looked.");
    await expect(answerSaying(page, "Looked.")).toBeVisible();
    await expect(card).toBeHidden();
    expect(readFileSync(at("CLAUDE.md"), "utf8")).toBe("Be careful, says the owner.\n");
    const run = containerCalls().findLast(([command]) => command === "run")!;
    expect(run).toContain(`${realpathSync(at("CLAUDE.md"))}:${realpathSync(at("CLAUDE.md"))}:ro`);
  });
});

test("working freely, the agent asks for nothing in its VM; under the room's preset, it asks as on this Mac", async ({ page }) => {
  test.skip(!sandboxesRunHere, "Sandboxes run on macOS 26 on Apple silicon only.");
  await signIn(page, host);
  await roomCard(page, "Sandboxed").click();
  const runLs = `ASK ${JSON.stringify([{ kind: "execute", title: "Run ls", command: "ls" }])}`;

  await tag(page, "Sandboxed", "Builder", runLs);
  await expect(answerSaying(page, "Run ls: allow")).toBeVisible();
  await expect(page.locator(".room-timeline ~ .room-approvals")).toBeHidden();

  const dialog = await openRoomSettings(page, "Sandboxed", "Permissions");
  await dialog.getByRole("radio", { name: "The room's permission preset still applies" }).check();
  await expect(dialog.getByRole("alert")).toContainText("Builder");
  await dialog.getByRole("button", { name: "Change" }).click();
  await expect(dialog.getByRole("radio", { name: "The room's permission preset still applies" })).toBeChecked();
  await dialog.getByRole("button", { name: "Done" }).click();

  await tag(page, "Sandboxed", "Builder", `${runLs} `);
  const strip = page.locator(".room-timeline ~ .room-approvals");
  await expect(strip.locator(".room-approval-subject")).toHaveText("Permission needed: run a shell command");
  await expect(strip.locator(".room-approval-detail")).toHaveText("ls");
  await strip.getByRole("button", { name: "Allow", exact: true }).click();
  await expect(answerSaying(page, "Run ls: allow")).toHaveCount(2);
});

test("in a sandboxed room's workspace a commit or merge runs none of the repository's hooks and says so, and the room's agent values say this computer's environment is ignored", async ({ page }) => {
  test.skip(!sandboxesRunHere, "Sandboxes run on macOS 26 on Apple silicon only.");
  await signIn(page, host);

  await test.step("the agent's values say this computer's environment is ignored while the room is sandboxed", async () => {
    const settings = await openRoomSettings(page, "Sandboxed", "Agents");
    await settings.locator(".room-agent-values summary").click();
    await expect(settings.locator(".room-values-sandboxed")).toHaveText("Ignored while the room is sandboxed: only the values chosen here go into its VM.");
    await settings.getByRole("button", { name: "Done" }).click();
  });

  await test.step("a commit from a conversation on this Mac passes a hook that would refuse it, and says why beforehand", async () => {
    const git = (...args: string[]) => execFileSync("git", ["-C", host.projectDir, ...args], { encoding: "utf8" }).trim();
    git("config", "user.name", "The Owner");
    git("config", "user.email", "owner@example.test");
    writeFileSync(join(host.projectDir, ".git/hooks/pre-commit"), "#!/bin/sh\necho the hook says no >&2\nexit 1\n", { mode: 0o755 });
    await workspaceCard(page, host.projectDir).getByLabel("Agent", { exact: true }).selectOption({ label: "Stub · opencode" });
    const previousUrl = page.url();
    await workspaceCard(page, host.projectDir).getByRole("button", { name: "+ New conversation" }).click();
    await expect(page).not.toHaveURL(previousUrl);
    await sendMessage(page, "SAY Ready.");
    await waitForTurnToEnd(page);

    await page.locator(".canvas-panel:visible .changes").getByRole("button", { name: "Commit…" }).click();
    const dialog = page.getByRole("dialog", { name: "Commit changes" });
    await expect(dialog.locator(".commit-hooks-off")).toHaveText("Hooks of this repository don't run here while it is sandboxed.");
    await dialog.getByText("Other uncommitted changes (2)").click();
    await dialog.locator('.commit-file[data-path="CLAUDE.md"]').getByRole("checkbox").check();
    await dialog.getByLabel("Message").fill("Past the hook");
    await dialog.getByRole("button", { name: "Commit 1 file" }).click();
    await expect(dialog).toHaveCount(0);
    expect(git("log", "-1", "--format=%s")).toBe("Past the hook");
  });

  await test.step("merging a worktree's commit runs none of the repository's hooks either, and says so beside the button", async () => {
    const hookRan = join(host.root, "post-merge-ran");
    writeFileSync(join(host.projectDir, ".git/hooks/post-merge"), `#!/bin/sh\ntouch '${hookRan}'\n`, { mode: 0o755 });
    await clickWorkspaceButton(workspaceCard(page, host.projectDir), "Where conversations work…");
    const where = page.getByRole("dialog", { name: "Where conversations work in project" });
    await where.getByRole("radio", { name: /A worktree of their own/ }).check();
    await where.getByRole("button", { name: "Save" }).click();
    await expect(where).toHaveCount(0);
    const previousUrl = page.url();
    await workspaceCard(page, host.projectDir).getByRole("button", { name: "+ New conversation" }).click();
    await expect(page).not.toHaveURL(previousUrl);
    await sendMessage(page, "FOLDER");
    await waitForTurnToEnd(page);
    const folder = (await lastAgentMessage(page).innerText()).trim().replace(/^Working in /, "");
    expect(folder).not.toBe(host.projectDir);
    writeFileSync(join(folder, "merged.txt"), "from the worktree\n");
    execFileSync("git", ["-C", folder, "add", "merged.txt"]);
    execFileSync("git", ["-C", folder, "commit", "--no-verify", "-qm", "Add merged.txt"]);

    const changes = page.locator(".canvas-panel:visible .changes");
    await changes.getByRole("button", { name: "Refresh" }).click();
    await expect(changes.locator(".merge-hooks-off")).toHaveText("Hooks of this repository don't run here while it is sandboxed.");
    await changes.getByRole("button", { name: /^Merge 1 commit into / }).click();
    await expect(changes.locator(".commit-made")).toHaveText(/^Merged 1 commit into \S+, now at [0-9a-f]+\.$/);
    expect(readFileSync(join(host.projectDir, "merged.txt"), "utf8")).toBe("from the worktree\n");
    expect(existsSync(hookRan)).toBe(false);
  });
});
