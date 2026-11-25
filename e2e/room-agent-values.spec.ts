import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { addWorkspace, createProfile, createRoom, openNewRoom, openProfiles, openProfileTab, openRoomAgent, openRoomSettings, sendMessage, signIn, startConversation, whatItMeans } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

const HOSTS_SECRET = "hosts-own-secret";
const HOSTS_DEPLOY_TOKEN = "hosts-deploy-token";
const host = new TestHost({ fakePrograms: true, environment: { HOSTS_SECRET, DEPLOY_TOKEN: HOSTS_DEPLOY_TOKEN } });
const promptsFile = () => join(host.root, "builder-prompts");
const heldUntil = () => join(host.root, "held-until");
const sessionsHeld = () => join(host.root, "sessions-held");
const MODEL_KEY = "sk-room-model-key";
const DEPLOY_TOKEN = "room-deploy-token";
const VAULT_TOKEN = "room-vault-token";

test.beforeAll(async ({ browser }) => {
  writeBunProgram(host.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"), { FAKE_ACP_PROMPTS: promptsFile() });
  writeFileSync(promptsFile(), "");
  await host.start();
  const page = await browser.newPage();
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  for (const [name, environment] of [
    ["Builder", `OPENAI_API_KEY=${MODEL_KEY}\nDEPLOY_TOKEN=${DEPLOY_TOKEN}`],
    ["Plain", ""],
    ["Located", `XDG_CACHE_HOME=${join(host.root, "located-cache")}`],
    ["Keyed", "OPENAI_API_KEY=first-key"],
    ["Opener", `OPENCODE_FAKE_ACP_NEW_SESSIONS_HELD_BY=${sessionsHeld()}`],
    ["Vaulted", `VAULT_TOKEN=$(printf %s ${VAULT_TOKEN})`],
  ]) {
    const profiles = await createProfile(page, name!, environment!, "", "opencode");
    await profiles.getByRole("button", { name: "Close" }).click();
  }
  await page.close();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const roomComposer = (page: Page, room: string) => page.getByRole("textbox", { name: `Write in ${room}, @ tags an agent…` });
const answerSaying = (page: Page, text: string) => page.locator(".room-timeline .room-entry .message.agent", { hasText: text });
const introductions = () => readFileSync(promptsFile(), "utf8").split('You are an attendee of the room "Values"').length - 1;

async function tagAgent(page: Page, room: string, agent: string, rest: string) {
  await roomComposer(page, room).fill(`@${agent.slice(0, 2)}`);
  await page.getByRole("listbox", { name: "Agents and people of the room" }).getByRole("option", { name: `@${agent}` }).click();
  await roomComposer(page, room).fill(`@${agent} ${rest}`);
  await roomComposer(page, room).press("Enter");
}

const tagBuilder = (page: Page, room: string, rest: string) => tagAgent(page, room, "Builder", rest);

const agentRow = (settings: Locator, agent: string) => settings.getByRole("list", { name: "Agents", exact: true }).getByRole("listitem").filter({ hasText: agent });

const heldBackFrom = (settings: Locator, agent: string) => settings.getByRole("list", { name: `Values held back from ${agent}` });
const givenTo = (settings: Locator, agent: string) => settings.getByRole("list", { name: `Values ${agent} gets from its profile` });

const wholeHostEnvironment = (settings: Locator) => settings.getByRole("switch", { name: "Everything from this computer's environment" });

async function builderValues(page: Page) {
  const settings = await openRoomSettings(page, "Values", "Agents");
  await openRoomAgent(settings, "Builder");
  return { settings, heldBack: heldBackFrom(settings, "Builder") };
}

const valueSwitch = (values: Locator, name: string) => values.getByRole("switch", { name });

/** Whether the room's people list shows its agent at work. */
async function builderWorking(page: Page) {
  await page.locator(".room-header .room-here-count").click();
  const listed = page.getByRole("dialog", { name: "People in the room" });
  const working = await listed.getByRole("list", { name: "Agents" }).locator(".room-agent-working").count();
  await page.locator(".room-header .room-here-count").click();
  await expect(listed).toHaveCount(0);
  return working > 0;
}

test("a room's agent gets only the values of its profile it needs to run and those the owner turns on, starting afresh for a change once it works there", async ({ page }) => {
  await signIn(page, host);
  await createRoom(page, "Values", ["Builder"]);

  await test.step("the owner sees each value's name with whether the agent gets it, and never a value", async () => {
    const { settings, heldBack } = await builderValues(page);
    await expect(settings.getByText("Can act without asking")).toBeVisible();
    await expect(heldBack.getByRole("switch")).toHaveCount(1);
    await expect(valueSwitch(heldBack, "DEPLOY_TOKEN")).not.toBeChecked();
    await expect(givenTo(settings, "Builder")).toBeHidden();
    await settings.getByText("Given (1)").click();
    await expect(valueSwitch(givenTo(settings, "Builder"), "OPENAI_API_KEY")).toBeChecked();
    expect(await settings.innerHTML()).not.toMatch(new RegExp(`${MODEL_KEY}|${DEPLOY_TOKEN}`));
    await valueSwitch(heldBack, "DEPLOY_TOKEN").check();
    await expect(settings.getByText("Held back (0)")).toBeVisible();
    await expect(settings.getByText("Given (2)")).toBeVisible();
    await expect(valueSwitch(heldBack, "DEPLOY_TOKEN")).toBeChecked();
    await valueSwitch(heldBack, "DEPLOY_TOKEN").uncheck();
    await expect(settings.getByText("Held back (1)")).toBeVisible();
    await expect(settings.locator(".room-starts-afresh")).toHaveCount(0);
    await settings.getByRole("button", { name: "Agents", exact: true }).click();
    await expect(agentRow(settings, "Builder")).toContainText("Can act without asking · 1 of 2 profile values");
    await settings.getByRole("button", { name: "Close" }).click();
  });

  await tagBuilder(page, "Values", "ENV DEPLOY_TOKEN");
  await expect(answerSaying(page, "DEPLOY_TOKEN is not set")).toBeVisible();
  await tagBuilder(page, "Values", "ENV OPENAI_API_KEY");
  await expect(answerSaying(page, `OPENAI_API_KEY is ${MODEL_KEY}`)).toBeVisible();
  expect(introductions()).toBe(1);

  await test.step("turning one on for an agent at work there waits for the owner to confirm what it costs", async () => {
    const { settings, heldBack } = await builderValues(page);
    await valueSwitch(heldBack, "DEPLOY_TOKEN").check();
    const warning = settings.locator(".room-starts-afresh");
    await expect(warning).toContainText("Builder starts afresh and reads the room again, once.");
    await warning.getByRole("button", { name: "Cancel" }).click();
    await expect(valueSwitch(heldBack, "DEPLOY_TOKEN")).not.toBeChecked();
    await valueSwitch(heldBack, "DEPLOY_TOKEN").check();
    await warning.getByRole("button", { name: "Change" }).click();
    await expect(warning).toHaveCount(0);
    await settings.getByRole("tab", { name: "Agents" }).click();
    await expect(agentRow(settings, "Builder")).toContainText("2 of 2 profile values");
    await settings.getByRole("button", { name: "Close" }).click();
  });

  await tagBuilder(page, "Values", "ENV DEPLOY_TOKEN");
  await expect(answerSaying(page, `DEPLOY_TOKEN is ${DEPLOY_TOKEN}`)).toBeVisible();
  expect(introductions()).toBe(2);
  expect(readFileSync(promptsFile(), "utf8").split('You are an attendee of the room "Values"').at(-1)).toContain("ENV OPENAI_API_KEY");
});

test("a room's agent gets this computer's environment only when the owner turns it on, and a change that gives it less stops its turn at once", async ({ page }) => {
  await signIn(page, host);
  await createRoom(page, "Hosts", ["Builder"]);

  await tagBuilder(page, "Hosts", "ENV HOSTS_SECRET");
  await expect(answerSaying(page, "HOSTS_SECRET is not set")).toBeVisible();
  await tagBuilder(page, "Hosts", "ENV DEPLOY_TOKEN");
  await expect(answerSaying(page, "DEPLOY_TOKEN is not set")).toBeVisible();

  await test.step("turning on everything from this computer's environment starts the agent afresh, once the owner confirms", async () => {
    const settings = await openRoomSettings(page, "Hosts", "Agents");
    await openRoomAgent(settings, "Builder");
    await expect(settings.locator("label", { hasText: "Everything from this computer's environment" })).toHaveAttribute("data-hint", /^It can hold tokens and your SSH agent/);
    await wholeHostEnvironment(settings).check();
    await expect(settings.locator(".room-starts-afresh")).toContainText("Builder starts afresh and reads the room again, once.");
    await settings.locator(".room-starts-afresh").getByRole("button", { name: "Change" }).click();
    await settings.getByRole("button", { name: "Agents", exact: true }).click();
    await expect(agentRow(settings, "Builder")).toContainText("1 of 2 profile values · Everything from this computer's environment");
    await settings.getByRole("button", { name: "Close" }).click();
  });

  await tagBuilder(page, "Hosts", "ENV HOSTS_SECRET");
  await expect(answerSaying(page, `HOSTS_SECRET is ${HOSTS_SECRET}`)).toBeVisible();
  await tagBuilder(page, "Hosts", "ENV DEPLOY_TOKEN");
  await expect(answerSaying(page, "DEPLOY_TOKEN is not set").nth(1)).toBeVisible();

  await test.step("turning it off again stops the turn under way at once, before the agent answers", async () => {
    await tagBuilder(page, "Hosts", `WAIT ${heldUntil()} SAY Held answer`);
    await expect.poll(() => builderWorking(page)).toBe(true);
    const settings = await openRoomSettings(page, "Hosts", "Agents");
    await openRoomAgent(settings, "Builder");
    await wholeHostEnvironment(settings).uncheck();
    await expect(settings.locator(".room-starts-afresh")).toContainText("Builder stops any turn under way, starts afresh and reads the room again, once.");
    await settings.locator(".room-starts-afresh").getByRole("button", { name: "Change" }).click();
    await settings.getByRole("button", { name: "Close" }).click();
    await expect.poll(() => builderWorking(page)).toBe(false);
    writeFileSync(heldUntil(), "");
  });

  await tagBuilder(page, "Hosts", "ENV HOSTS_SECRET");
  await expect(answerSaying(page, "HOSTS_SECRET is not set").nth(1)).toBeVisible();
  await expect(answerSaying(page, "Held answer")).toHaveCount(0);
});

async function giveHostsEnvironmentTo(page: Page, room: string, agent: string, given: boolean) {
  const settings = await openRoomSettings(page, room, "Agents");
  await openRoomAgent(settings, agent);
  await wholeHostEnvironment(settings).setChecked(given);
  const confirm = settings.locator(".room-starts-afresh").getByRole("button", { name: "Change" });
  if (await confirm.isVisible()) await confirm.click();
  await settings.getByRole("button", { name: "Agents", exact: true }).click();
  await expect(agentRow(settings, agent).getByText("Everything from this computer's environment")).toHaveCount(given ? 1 : 0);
  await settings.getByRole("button", { name: "Close" }).click();
}

const workingLine = (page: Page, agent: string) => page.locator(".room-timeline > .room-thread-line", { hasText: `${agent} is working…` });

test("a change made while an agent's session opens stops the turn when it gives the agent less, saying so in the room, and the next turn runs under it", async ({ page }) => {
  await signIn(page, host);
  await createRoom(page, "Opening", ["Opener"]);
  await giveHostsEnvironmentTo(page, "Opening", "Opener", true);
  writeFileSync(sessionsHeld(), "");
  await tagAgent(page, "Opening", "Opener", "ENV HOSTS_SECRET");
  await expect(workingLine(page, "Opener")).toBeVisible();
  await giveHostsEnvironmentTo(page, "Opening", "Opener", false);
  await expect(page.locator(".room-timeline")).toContainText("Stopped before it finished.");
  await page.locator(".room-timeline").getByRole("button", { name: "Open thread" }).click();
  const thread = page.getByRole("complementary", { name: "Thread of Opener" });
  await expect(thread.getByText("Turn ended: cancelled")).toBeVisible();
  await expect(thread.getByText(/agent process/)).toHaveCount(0);
  await thread.getByRole("button", { name: "Close thread" }).click();
  rmSync(sessionsHeld());

  await tagAgent(page, "Opening", "Opener", "ENV HOSTS_SECRET");
  await expect(answerSaying(page, "HOSTS_SECRET is not set")).toBeVisible();
  await expect(answerSaying(page, HOSTS_SECRET)).toHaveCount(0);
});

test("a change made while an agent's session opens that gives it more lets the turn go on as it started, and holds from the next turn on", async ({ page }) => {
  await signIn(page, host);
  await createRoom(page, "Widening", ["Opener"]);
  writeFileSync(sessionsHeld(), "");
  await tagAgent(page, "Widening", "Opener", "ENV HOSTS_SECRET");
  await expect(workingLine(page, "Opener")).toBeVisible();
  await giveHostsEnvironmentTo(page, "Widening", "Opener", true);
  rmSync(sessionsHeld());
  await expect(answerSaying(page, "HOSTS_SECRET is not set")).toBeVisible();

  await tagAgent(page, "Widening", "Opener", "ENV HOSTS_SECRET");
  await expect(answerSaying(page, `HOSTS_SECRET is ${HOSTS_SECRET}`)).toBeVisible();
});

test("a value that says where an agent's files are is always given, and an agent whose profile sets none still offers this computer's environment", async ({ page }) => {
  await signIn(page, host);
  await createRoom(page, "Kinds", ["Plain", "Located"]);
  const settings = await openRoomSettings(page, "Kinds", "Agents");
  await expect(agentRow(settings, "Plain")).toContainText("Its profile sets no values");
  await openRoomAgent(settings, "Plain");
  await expect(settings.getByText("Its profile sets no values")).toBeVisible();
  await expect(wholeHostEnvironment(settings)).not.toBeChecked();
  await settings.getByRole("button", { name: "Agents", exact: true }).click();
  await expect(agentRow(settings, "Located")).toContainText("1 of 1 profile values");
  await openRoomAgent(settings, "Located");
  await settings.getByText("Given (1)").click();
  const located = valueSwitch(givenTo(settings, "Located"), "XDG_CACHE_HOME");
  await expect(located).toBeChecked();
  await expect(located).toBeDisabled();
});

test("a value that a command prints is held back by its name like one the profile sets, and given once the owner turns it on", async ({ page }) => {
  await signIn(page, host);
  await createRoom(page, "Vault", ["Vaulted"]);
  await tagAgent(page, "Vault", "Vaulted", "ENV VAULT_TOKEN");
  await expect(answerSaying(page, "VAULT_TOKEN is not set")).toBeVisible();

  const settings = await openRoomSettings(page, "Vault", "Agents");
  await expect(agentRow(settings, "Vaulted")).toContainText("0 of 1 profile values");
  await openRoomAgent(settings, "Vaulted");
  const vaultToken = valueSwitch(heldBackFrom(settings, "Vaulted"), "VAULT_TOKEN");
  await expect(vaultToken).not.toBeChecked();
  expect(await settings.innerHTML()).not.toContain(VAULT_TOKEN);
  await vaultToken.check();
  await settings.locator(".room-starts-afresh").getByRole("button", { name: "Change" }).click();
  await settings.getByRole("button", { name: "Agents", exact: true }).click();
  await expect(agentRow(settings, "Vaulted")).toContainText("1 of 1 profile values");
  await settings.getByRole("button", { name: "Close" }).click();

  await tagAgent(page, "Vault", "Vaulted", "ENV VAULT_TOKEN");
  await expect(answerSaying(page, `VAULT_TOKEN is ${VAULT_TOKEN}`)).toBeVisible();
});

test("a value edited in the profile reaches a room's agent with its next turn", async ({ page }) => {
  await signIn(page, host);
  await createRoom(page, "Edited", ["Keyed"]);
  await tagAgent(page, "Edited", "Keyed", "ENV OPENAI_API_KEY");
  await expect(answerSaying(page, "OPENAI_API_KEY is first-key")).toBeVisible();

  const profiles = await openProfiles(page);
  await profiles.locator(".profile-list li", { hasText: "Keyed" }).click();
  await openProfileTab(profiles, "Launch");
  await profiles.getByRole("button", { name: "Edit environment" }).click();
  await profiles.getByLabel("Environment", { exact: true }).fill("OPENAI_API_KEY=second-key");
  await profiles.getByRole("button", { name: "Save" }).click();
  await expect(profiles.locator(".saved")).toHaveText("Saved");
  await profiles.getByRole("button", { name: "Close" }).click();

  await tagAgent(page, "Edited", "Keyed", "ENV OPENAI_API_KEY");
  await expect(answerSaying(page, "OPENAI_API_KEY is second-key")).toBeVisible();
});

test("whether a room's agents read what guests write stays as the owner set it", async ({ page }) => {
  await signIn(page, host);
  await createRoom(page, "Guests", ["Builder"]);
  const settings = await openRoomSettings(page, "Guests", "People");
  const readsGuests = settings.getByRole("switch", { name: "Agents read what guests write" });
  await expect(readsGuests).toBeChecked();
  await readsGuests.uncheck();
  await settings.getByRole("button", { name: "Close" }).click();
  const again = await openRoomSettings(page, "Guests", "People");
  await expect(again.getByRole("switch", { name: "Agents read what guests write" })).not.toBeChecked();
  expect((await whatItMeans(page, again, "What reaches the agents")).join("\n")).toContain("Turned off, no agent reads it");
});

test("an agent the host can't hold to asking carries a warning when a room is made with it, and a room without Claude agents offers no Claude setup", async ({ page }) => {
  await signIn(page, host);
  const dialog = await openNewRoom(page);
  const chosen = dialog.getByRole("list", { name: "Agents" }).getByRole("button", { name: /^Remove / });
  while ((await chosen.count()) > 0) await chosen.first().click();
  await dialog.getByRole("combobox", { name: "Find an agent" }).fill("Builder");
  await dialog.getByRole("combobox", { name: "Find an agent" }).press("Enter");
  await expect(dialog.locator(".room-agent-chip", { hasText: "Builder" }).getByRole("img", { name: "Can act without asking" })).toBeVisible();
  await dialog.getByLabel("Room name").fill("Marks");
  await dialog.getByRole("button", { name: "Create room" }).click();
  const settings = await openRoomSettings(page, "Marks", "Agents");
  await expect(settings.getByText("Your Claude Code setup")).toHaveCount(0);
  expect((await whatItMeans(page, settings, "Agents")).join("\n")).toContain("Codex reads any file on this computer unasked");
});

test("an agent's git status takes no lock that a killed command would leave behind, in its own conversation and in a room", async ({ page }) => {
  const optionalLocks = join(host.projectDir, "optional-locks");
  await signIn(page, host);
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "Plain · opencode" });
  await startConversation(page, { withModels: false });
  await sendMessage(page, `WRITE ${JSON.stringify([{ shell: optionalLocks, content: "{{env:GIT_OPTIONAL_LOCKS}}" }])}`);
  await expect.poll(() => existsSync(optionalLocks) && readFileSync(optionalLocks, "utf8")).toBe("0");

  await createRoom(page, "Locks", ["Plain"]);
  await tagAgent(page, "Locks", "Plain", "ENV GIT_OPTIONAL_LOCKS");
  await expect(answerSaying(page, "GIT_OPTIONAL_LOCKS is 0")).toBeVisible();
});
