import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { release } from "node:os";
import { dirname, join } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type { ServerMessage } from "../shared/protocol.ts";
import { addWorkspace, clickWorkspaceButton, createProfile, lastAgentMessage, sendMessage, signIn, waitForTurnToEnd, workspaceCard } from "./helpers.ts";
import { bunProgramPath, scratchPath, TestHost, writeBunProgram } from "./test-host.ts";

const sandboxesRunHere = process.platform === "darwin" && process.arch === "arm64" && Number(release().split(".")[0]) >= 25;

/** The owner's home, without links, so the page shows its folders under `~` as Mirador stores them. */
const home = (() => {
  const folder = scratchPath("sandbox-folders-home");
  mkdirSync(folder, { recursive: true });
  return realpathSync(folder);
})();
const notes = join(home, "notes");
const docs = join(home, "docs");

const host = new TestHost({ fakePrograms: true, environment: () => ({ HOME: home, ANTHROPIC_BASE_URL: "http://127.0.0.1:9", MIRADOR_SANDBOX: fakeContainer() }) });
const fakeContainer = () => bunProgramPath(join(host.root, "fake-container"), "container");
const containerState = () => join(host.root, "fake-container-state");
const agentLog = () => join(host.root, "agent-log");
const promptsFile = () => join(host.root, "prompts");
const promptsSoFar = () => (existsSync(promptsFile()) ? readFileSync(promptsFile(), "utf8") : "");

test.describe.configure({ mode: "serial" });

/** The `container` the host is given: e2e/fake-container.ts, its agents the fake ACP agent, which resumes sessions and logs them. */
function writeFakeContainer() {
  mkdirSync(containerState(), { recursive: true });
  writeBunProgram(dirname(fakeContainer()), "container", join(import.meta.dirname, "fake-container.ts"), {
    FAKE_CONTAINER_STATE: containerState(),
    FAKE_ACP_PROMPTS: promptsFile(),
    FAKE_ACP_RESUMES: "1",
    FAKE_ACP_LOG: agentLog(),
  });
  const claude = join(host.fakeProgramsDir, "claude");
  writeFileSync(claude, `#!/bin/sh\necho "2.1.330 (Claude Code)"\n`);
  chmodSync(claude, 0o755);
}

test.beforeAll(async () => {
  [notes, docs, join(home, ".ssh")].forEach((folder) => mkdirSync(folder, { recursive: true }));
  mkdirSync(host.fakeProgramsDir, { recursive: true });
  writeFakeContainer();
  mkdirSync(host.projectDir, { recursive: true });
  execFileSync("git", ["init", "-q", host.projectDir]);
  execFileSync("git", ["-C", host.projectDir, "-c", "user.name=e2e", "-c", "user.email=e2e@example.com", "commit", "-q", "--allow-empty", "-m", "first"]);
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
  rmSync(home, { recursive: true, force: true });
});

const projectCard = (page: Page) => workspaceCard(page, host.projectDir);
const sandboxDialog = (page: Page) => page.getByRole("dialog", { name: "Sandbox for project" });
const folderList = (dialog: Locator) => dialog.getByRole("region", { name: "Folders from this computer" });
const folderRow = (dialog: Locator, path: string) => folderList(dialog).locator(`li[data-folder-path="${path}"]`);
const waitingNote = (dialog: Locator) => folderList(dialog).getByRole("status");

/** Each call the fake `container` got, by its arguments. */
const containerCalls = (): string[][] =>
  readFileSync(join(containerState(), "calls.log"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
const containerRuns = () => containerCalls().filter(([command]) => command === "run");
const mountsOf = (run: string[]) => run.filter((_, index) => run[index - 1] === "-v");

const agentLogLines = () => (existsSync(agentLog()) ? readFileSync(agentLog(), "utf8").trim().split("\n") : []);

async function openSandbox(page: Page) {
  await clickWorkspaceButton(projectCard(page), "Sandbox…");
  const dialog = sandboxDialog(page);
  await expect(dialog.getByText("Checking whether this workspace can have a sandbox…")).toBeHidden();
  return dialog;
}

async function closeSandbox(dialog: Locator) {
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toBeHidden();
}

async function startConversation(page: Page) {
  const previousUrl = page.url();
  await projectCard(page).getByRole("button", { name: "+ New conversation" }).click();
  await expect(page).not.toHaveURL(previousUrl);
  return page.url().match(/#\/c\/(.+)$/)![1]!;
}

const openConversation = (page: Page, conversationId: string) => page.locator(`li[data-reorder-id="${conversationId}"] .conversation-title`).click();

/** Types the folder into the list's add control and adds it, leaving the control open where it was refused. */
async function addFolder(dialog: Locator, typed: string) {
  const list = folderList(dialog);
  if ((await list.getByRole("textbox", { name: "Folder to add" }).count()) === 0) await list.getByRole("button", { name: "Add a folder" }).click();
  await list.getByRole("textbox", { name: "Folder to add" }).fill(typed);
  await list.getByRole("button", { name: "Add", exact: true }).click();
}

/** What the page is sent by the host, from the moment this is called. */
function receivedBy(page: Page) {
  const received: ServerMessage[] = [];
  page.on("websocket", (socket) => socket.on("framereceived", ({ payload }) => received.push(JSON.parse(String(payload)))));
  return received;
}

/** What the host answers each message sent on a socket of the page's own, by the problem it gives. */
const problemsAnswering = (page: Page, messages: object[]) =>
  page.evaluate(async (sent) => {
    const socket = new WebSocket(new URL("/ws", location.href).href.replace(/^http/, "ws"));
    const problems: string[] = [];
    await new Promise<void>((resolve) => socket.addEventListener("open", () => resolve()));
    socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(String(data));
      if (message.type === "error") problems.push(message.problem?.code ?? message.message);
    });
    sent.forEach((message) => socket.send(JSON.stringify(message)));
    const deadline = Date.now() + 5000;
    while (problems.length < sent.length && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
    socket.close();
    return problems;
  }, messages);

test("the owner gives the workspace's sandbox folders of this computer, read only; a change waits for the turns at work or is applied at once, and the agent keeps its session through each restart", async ({ page, browser }) => {
  test.skip(!sandboxesRunHere, "Sandboxes run on macOS 26 on Apple silicon only.");
  const mia = host.admitPerson("Mia");
  const miaContext = await browser.newContext();
  await miaContext.addCookies([mia.cookie]);
  const miaPage = await miaContext.newPage();
  const miaReceived = receivedBy(miaPage);
  await miaPage.goto(host.origin);
  await expect(miaPage.locator(".sidebar")).toBeVisible();

  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, "Builder", "ANTHROPIC_API_KEY=sk-e2e-sandbox-folders-key", "", "Claude Code");
  await profiles.getByRole("button", { name: "Close" }).click();
  await projectCard(page).getByLabel("Agent", { exact: true }).selectOption({ label: "Builder · Claude Code" });

  await test.step("the folder list shows once the sandbox is on, empty", async () => {
    const dialog = await openSandbox(page);
    await expect(folderList(dialog)).toHaveCount(0);
    await dialog.getByRole("switch", { name: "Run this workspace's agents in a sandbox" }).check();
    await expect(dialog.locator(".room-sandbox-setup")).toHaveText("Set up on this Mac.");
    await expect(folderList(dialog)).toBeVisible();
    await expect(folderList(dialog).locator("li")).toHaveCount(0);
    await closeSandbox(dialog);
  });

  const conversation = await startConversation(page);
  await sendMessage(page, "ADDED FOLDERS");
  await waitForTurnToEnd(page);
  await expect(lastAgentMessage(page)).toHaveText("Added folders: none");
  const sessionId = agentLogLines()
    .find((line) => line.startsWith("agent new "))!
    .slice("agent new ".length);

  await test.step("a folder that isn't there, or is a hidden one of home, is refused saying why; one in home goes in, read only, the VM restarting with it at once while no turn runs", async () => {
    const dialog = await openSandbox(page);
    await addFolder(dialog, "~/gone");
    await expect(folderList(dialog).getByRole("alert")).toHaveText("There is no folder there.");
    await addFolder(dialog, "~/.ssh");
    await expect(folderList(dialog).getByRole("alert")).toHaveText("It is or lies inside .ssh, a hidden folder of your home, which holds settings and keys.");
    await addFolder(dialog, "~/notes");
    const row = folderRow(dialog, notes);
    await expect(row.locator(".sandbox-folder-path")).toHaveText("~/notes");
    await expect(row.locator(".sandbox-folder-access")).toHaveText("Read only");
    await expect(row.locator(".sandbox-folder-state")).toHaveText("In the sandbox");
    await expect(folderList(dialog).getByRole("textbox", { name: "Folder to add" })).toHaveCount(0);
    await expect(waitingNote(dialog)).toHaveCount(0);
    await expect.poll(() => containerCalls().filter(([command]) => command === "stop").length).toBeGreaterThan(0);
    await closeSandbox(dialog);
  });

  await test.step("the agent resumes its session in the new VM, which mounts the folder read-only at its own path, and is given it", async () => {
    await sendMessage(page, "ADDED FOLDERS");
    await waitForTurnToEnd(page);
    await expect(lastAgentMessage(page)).toHaveText(`Added folders: ${notes}`);
    expect(mountsOf(containerRuns().at(-1)!)).toContain(`${notes}:${notes}:ro`);
    expect(agentLogLines()).toContain(`agent resumed ${sessionId}`);
  });

  const turnMayEnd = join(host.root, "turn-may-end");
  let waitingConversation = "";
  await test.step("a folder added while a turn is at work waits for it, and a new turn waits at its start, saying so", async () => {
    await sendMessage(page, `WRITE ${JSON.stringify([{ waitFor: turnMayEnd }])}`);
    await expect.poll(promptsSoFar).toContain(turnMayEnd);
    const runsBefore = containerRuns().length;
    const dialog = await openSandbox(page);
    await addFolder(dialog, "~/docs");
    await expect(folderRow(dialog, docs).locator(".sandbox-folder-state")).toHaveText("Waiting for the agents to finish");
    await expect(waitingNote(dialog)).toContainText("The sandbox restarts with its folders once the agents finish their turns.");
    await expect(waitingNote(dialog).getByRole("button", { name: "Apply now" })).toHaveAttribute("data-hint", "Stops the turns at work in the sandbox and restarts it with its folders now. The agents keep their context.");
    await closeSandbox(dialog);
    waitingConversation = await startConversation(page);
    await sendMessage(page, "SAY Hello from the new VM");
    await expect(page.locator(".status-detail:visible")).toHaveText("Waiting for the sandbox to restart with its folders…");
    expect(containerRuns()).toHaveLength(runsBefore);
  });

  await test.step("Apply now stops the turn at work and restarts the sandbox with the folder, and the waiting turn goes on there", async () => {
    const dialog = await openSandbox(page);
    await waitingNote(dialog).getByRole("button", { name: "Apply now" }).click();
    await expect(waitingNote(dialog)).toHaveCount(0);
    await expect(folderRow(dialog, docs).locator(".sandbox-folder-state")).toHaveText("In the sandbox");
    await closeSandbox(dialog);
    await expect(lastAgentMessage(page)).toHaveText("Hello from the new VM");
    expect(mountsOf(containerRuns().at(-1)!)).toEqual(expect.arrayContaining([`${notes}:${notes}:ro`, `${docs}:${docs}:ro`]));
  });

  await test.step("a folder removed while no turn runs leaves the sandbox at once", async () => {
    const dialog = await openSandbox(page);
    await folderList(dialog).getByRole("button", { name: "Remove ~/notes" }).click();
    await expect(folderRow(dialog, notes)).toHaveCount(0);
    await expect(waitingNote(dialog)).toHaveCount(0);
    await closeSandbox(dialog);
    await openConversation(page, conversation);
    await sendMessage(page, "ADDED FOLDERS");
    await waitForTurnToEnd(page);
    await expect(lastAgentMessage(page)).toHaveText(`Added folders: ${docs}`);
    expect(mountsOf(containerRuns().at(-1)!).some((mount) => mount.startsWith(`${notes}:`))).toBe(false);
  });

  await test.step("the agent kept one session through every restart, resumed at its next turn after the folder went in and after it went out, its context never cleared", async () => {
    const ofSession = agentLogLines().filter((line) => line.endsWith(` ${sessionId}`));
    expect(ofSession.filter((line) => line === `agent new ${sessionId}`)).toHaveLength(1);
    expect(ofSession.filter((line) => line === `agent resumed ${sessionId}`)).toHaveLength(2);
    await expect(page.locator(".timeline:visible")).not.toContainText("Context cleared");
  });

  await test.step("Mia, let into this machine, is sent no folder of the owner's, and may not add, remove or apply one", async () => {
    expect(miaReceived.length).toBeGreaterThan(0);
    expect(JSON.stringify(miaReceived)).not.toContain(home);
    expect(miaReceived.filter(({ type }) => type === "sandbox.folders" || type === "sandbox.folder-added")).toEqual([]);
    const owner = { kind: "workspace", id: await projectCard(page).getAttribute("data-reorder-id") };
    const problems = await problemsAnswering(miaPage, [
      { type: "sandbox.add-folder", requestId: "probe", owner, path: home },
      { type: "sandbox.remove-folder", owner, path: docs },
      { type: "sandbox.apply-folders-now", owner },
    ]);
    expect(problems).toEqual(["only-the-owner", "only-the-owner", "only-the-owner"]);
    const dialog = await openSandbox(page);
    await expect(folderList(dialog).locator("li")).toHaveCount(1);
    await expect(folderRow(dialog, docs)).toBeVisible();
    await closeSandbox(dialog);
  });
  await miaContext.close();
});
