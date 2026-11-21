import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { ROOM_MESSAGES_HEADING } from "../shared/rooms.ts";
import { addWorkspace, createProfile, literally, reloadFromRestartedHost, signIn } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

const ROOM_AGENT_IDLE_MS = 1_500;

const roomComposer = (page: Page) => page.getByRole("textbox", { name: "Write in Launch, @ tags an agent…" });
const answerSaying = (page: Page, text: string) => page.locator(".room-timeline .room-entry").filter({ has: page.locator(".message.agent", { hasText: text }) });
const thread = (page: Page) => page.getByRole("complementary", { name: "Thread of Builder" });
/** A message of the owner's as an agent is sent it: a line with its number, its author's role and name and the time, then its text after "> ". */
const framed = (text: string) => `#\\d+ \\[owner\\] Owner, \\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2} UTC:\\n> ${literally(text)}\\n`;

const isRunning = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** A test host whose Builder is the fake agent, which closes and resumes sessions, logging its resumes, and keeps the prompts it is sent. */
function hostWithBuilder(environment: Record<string, string> = {}) {
  const host = new TestHost({ fakePrograms: true, environment });
  const promptsFile = () => join(host.root, "builder-prompts");
  const agentLog = () => join(host.root, "builder-agent.log");
  test.beforeAll(async () => {
    writeBunProgram(host.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"));
    await host.start();
    writeFileSync(promptsFile(), "");
  });
  test.afterAll(async () => {
    await host.stop();
    await host.cleanUp();
  });
  /** The fake agent's own lines in the host's logs of the profile's agent processes, its probe's among them, oldest first. */
  const agentTraces = () => {
    const logs = join(host.dataDir, "logs");
    const builderLogs = existsSync(logs) ? readdirSync(logs).filter((file) => file.startsWith("opencode-builder-")) : [];
    return builderLogs.flatMap((file) => readFileSync(join(logs, file), "utf8").split("\n")).toSorted();
  };
  return {
    host,
    profileEnvironment: () => [`FAKE_ACP_PROMPTS=${promptsFile()}`, "FAKE_ACP_RESUMES=1", `FAKE_ACP_LOG=${agentLog()}`, "FAKE_ACP_NAME=Builder"].join("\n"),
    prompts: () => readFileSync(promptsFile(), "utf8"),
    agentLogLines: () => (existsSync(agentLog()) ? readFileSync(agentLog(), "utf8").split("\n").filter(Boolean) : []),
    /** Each prompt the agent took: the process that took it, and the session it went to. */
    promptsTaken: () =>
      agentTraces().flatMap((line) => {
        const [, pid, sessionId] = line.match(/fake agent (\d+): prompt in (\S+):/) ?? [];
        return pid && sessionId ? [{ pid: Number(pid), sessionId }] : [];
      }),
  };
}
type Builder = ReturnType<typeof hostWithBuilder>;

async function write(page: Page, text: string) {
  await roomComposer(page).fill(text);
  await roomComposer(page).press("Enter");
}

async function tagBuilder(page: Page, rest: string) {
  await roomComposer(page).fill("@Bu");
  await page.getByRole("listbox", { name: "Agents of the room" }).getByRole("option", { name: "@Builder" }).click();
  await roomComposer(page).pressSequentially(rest);
  await roomComposer(page).press("Enter");
}

async function openRoomWithBuilder(page: Page, builder: Builder) {
  await signIn(page, builder.host);
  await addWorkspace(page, builder.host.projectDir);
  const profiles = await createProfile(page, "Builder", builder.profileEnvironment(), "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "New room" }).click();
  const dialog = page.getByRole("dialog", { name: "New room" });
  await dialog.getByLabel("Room name").fill("Launch");
  await dialog.getByLabel("Builder").check();
  await dialog.getByRole("button", { name: "Create room" }).click();
  await expect(page.getByRole("heading", { name: "# Launch" })).toBeVisible();
}

/** The agent's first answer, and the process and session its room conversation took the prompt in. */
async function firstAnswer(page: Page, builder: Builder) {
  await write(page, "Morning all");
  await tagBuilder(page, "SAY First answer");
  await expect(answerSaying(page, "First answer").locator(".room-quote")).toContainText("@Builder SAY First answer");
  const prompt = builder.prompts();
  expect(prompt).toContain('You are an attendee of the room "Launch"');
  expect(prompt).toMatch(new RegExp(`${framed("Morning all")}${framed("@Builder SAY First answer")}$`));
  await expect.poll(() => builder.promptsTaken()).toHaveLength(1);
  return { ...builder.promptsTaken()[0]!, promptsSoFar: prompt.length, agentLogLinesSoFar: builder.agentLogLines().length };
}

/** Tagged again with its earlier process gone, the agent comes back on a process of its own in the session it had. */
async function secondAnswerResumes(page: Page, builder: Builder, first: Awaited<ReturnType<typeof firstAnswer>>) {
  await write(page, "The build went green meanwhile");
  await tagBuilder(page, "SAY Second answer");
  const answer = answerSaying(page, "Second answer");
  await expect(answer.locator(".room-quote")).toContainText("@Builder SAY Second answer");

  await expect.poll(() => builder.promptsTaken()).toHaveLength(2);
  const [, second] = builder.promptsTaken();
  expect(second!.sessionId, "the second prompt went to the session the first did, not a blank one").toBe(first.sessionId);
  expect(second!.pid, "a new process took it").not.toBe(first.pid);
  expect(builder.agentLogLines().slice(first.agentLogLinesSoFar)).toContain(`Builder resumed ${first.sessionId}`);
  expect(builder.prompts().slice(first.promptsSoFar), "sent only what it had not seen, with no second introduction").toMatch(
    new RegExp(`^${literally(ROOM_MESSAGES_HEADING)}\\n${framed("The build went green meanwhile")}${framed("@Builder SAY Second answer")}$`),
  );

  await answer.getByRole("button", { name: "Open thread" }).click();
  await expect(thread(page).locator(".message.agent")).toHaveText(["Second answer"]);
  await expect(thread(page).locator(".error-line")).toHaveCount(0);
  await expect(thread(page)).not.toContainText("Could not resume");
  await thread(page).getByRole("button", { name: "Close thread" }).click();
  await answerSaying(page, "First answer").getByRole("button", { name: "Open thread" }).click();
  await expect(thread(page).locator(".message.agent")).toHaveText(["First answer"]);
  await expect(thread(page).locator(".error-line")).toHaveCount(0);
  await thread(page).getByRole("button", { name: "Close thread" }).click();
}

test.describe("a room's agent whose process stopped once it sat idle", () => {
  const builder = hostWithBuilder({ MIRADOR_ROOM_AGENT_IDLE_MS: String(ROOM_AGENT_IDLE_MS) });

  test("tagged again, resumes its session on a new process, is sent only what it missed, and answers in a new thread", async ({ page }) => {
    await openRoomWithBuilder(page, builder);
    const first = await firstAnswer(page, builder);
    await expect.poll(() => isRunning(first.pid), { message: "the agent's process stops once it sat idle", timeout: 20_000 }).toBe(false);
    await secondAnswerResumes(page, builder, first);
  });
});

test.describe("a room's agent across a host restart", () => {
  const builder = hostWithBuilder();

  test("tagged after the restart, resumes its session on a new process, is sent only what it missed, and answers in a new thread", async ({ page }) => {
    await openRoomWithBuilder(page, builder);
    const first = await firstAnswer(page, builder);
    expect(isRunning(first.pid), "the agent's process is still up as the host restarts").toBe(true);
    await builder.host.restart();
    await reloadFromRestartedHost(page);
    await expect(page.getByRole("heading", { name: "# Launch" })).toBeVisible();
    expect(isRunning(first.pid), "the host's stop ended the agent's process").toBe(false);
    await secondAnswerResumes(page, builder, first);
  });
});
