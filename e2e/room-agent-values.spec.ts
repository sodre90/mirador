import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { addWorkspace, createProfile, createRoom, openNewRoom, openRoomSettings, signIn, whatItMeans } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

const HOSTS_SECRET = "hosts-own-secret";
const HOSTS_DEPLOY_TOKEN = "hosts-deploy-token";
const host = new TestHost({ fakePrograms: true, environment: { HOSTS_SECRET, DEPLOY_TOKEN: HOSTS_DEPLOY_TOKEN } });
const promptsFile = () => join(host.root, "builder-prompts");
const heldUntil = () => join(host.root, "held-until");
const MODEL_KEY = "sk-room-model-key";
const DEPLOY_TOKEN = "room-deploy-token";

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

async function tagBuilder(page: Page, room: string, rest: string) {
  await roomComposer(page, room).fill("@Bu");
  await page.getByRole("listbox", { name: "Agents and people of the room" }).getByRole("option", { name: "@Builder" }).click();
  await roomComposer(page, room).fill(`@Builder ${rest}`);
  await roomComposer(page, room).press("Enter");
}

async function builderValues(page: Page) {
  const settings = await openRoomSettings(page, "Values", "Agents");
  await settings.locator(".room-agent-values summary").click();
  return { settings, values: settings.getByRole("list", { name: "Values Builder gets from its profile" }) };
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
    const { settings, values } = await builderValues(page);
    await expect(settings.locator(".room-settings-rows li").first().getByText("Can act without asking")).toBeVisible();
    await expect(settings.locator(".room-agent-values summary")).toHaveText("Values from its profile: 1 of 2");
    await expect(valueSwitch(values, "OPENAI_API_KEY")).toBeChecked();
    await expect(valueSwitch(values, "DEPLOY_TOKEN")).not.toBeChecked();
    expect(await settings.innerHTML()).not.toMatch(new RegExp(`${MODEL_KEY}|${DEPLOY_TOKEN}`));
    await valueSwitch(values, "DEPLOY_TOKEN").check();
    await expect(settings.locator(".room-agent-values summary")).toHaveText("Values from its profile: 2 of 2");
    await valueSwitch(values, "DEPLOY_TOKEN").uncheck();
    await expect(settings.locator(".room-agent-values summary")).toHaveText("Values from its profile: 1 of 2");
    await expect(settings.locator(".room-starts-afresh")).toHaveCount(0);
    await settings.getByRole("button", { name: "Done" }).click();
  });

  await tagBuilder(page, "Values", "ENV DEPLOY_TOKEN");
  await expect(answerSaying(page, "DEPLOY_TOKEN is not set")).toBeVisible();
  await tagBuilder(page, "Values", "ENV OPENAI_API_KEY");
  await expect(answerSaying(page, `OPENAI_API_KEY is ${MODEL_KEY}`)).toBeVisible();
  expect(introductions()).toBe(1);

  await test.step("turning one on for an agent at work there waits for the owner to confirm what it costs", async () => {
    const { settings, values } = await builderValues(page);
    await valueSwitch(values, "DEPLOY_TOKEN").check();
    const warning = settings.locator(".room-starts-afresh");
    await expect(warning).toContainText("Builder starts afresh and reads the room again, once.");
    await warning.getByRole("button", { name: "Cancel" }).click();
    await expect(valueSwitch(values, "DEPLOY_TOKEN")).not.toBeChecked();
    await valueSwitch(values, "DEPLOY_TOKEN").check();
    await warning.getByRole("button", { name: "Change" }).click();
    await expect(warning).toHaveCount(0);
    await expect(settings.locator(".room-agent-values summary")).toHaveText("Values from its profile: 2 of 2");
    await settings.getByRole("button", { name: "Done" }).click();
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
    await settings.locator(".room-agent-values summary").click();
    await expect(settings.locator("label", { hasText: "Everything from this computer's environment" })).toHaveAttribute("data-hint", /^It can hold tokens and your SSH agent/);
    await settings.getByRole("switch", { name: "Everything from this computer's environment" }).check();
    await expect(settings.locator(".room-starts-afresh")).toContainText("Builder starts afresh and reads the room again, once.");
    await settings.locator(".room-starts-afresh").getByRole("button", { name: "Change" }).click();
    await expect(settings.locator(".room-agent-values summary")).toHaveText("Values from its profile: 1 of 2, and everything from this computer's environment");
    await settings.getByRole("button", { name: "Done" }).click();
  });

  await tagBuilder(page, "Hosts", "ENV HOSTS_SECRET");
  await expect(answerSaying(page, `HOSTS_SECRET is ${HOSTS_SECRET}`)).toBeVisible();
  await tagBuilder(page, "Hosts", "ENV DEPLOY_TOKEN");
  await expect(answerSaying(page, "DEPLOY_TOKEN is not set").nth(1)).toBeVisible();

  await test.step("turning it off again stops the turn under way at once, before the agent answers", async () => {
    await tagBuilder(page, "Hosts", `WAIT ${heldUntil()} SAY Held answer`);
    await expect.poll(() => builderWorking(page)).toBe(true);
    const settings = await openRoomSettings(page, "Hosts", "Agents");
    await settings.locator(".room-agent-values summary").click();
    await settings.getByRole("switch", { name: "Everything from this computer's environment" }).uncheck();
    await expect(settings.locator(".room-starts-afresh")).toContainText("Builder stops any turn under way, starts afresh and reads the room again, once.");
    await settings.locator(".room-starts-afresh").getByRole("button", { name: "Change" }).click();
    await settings.getByRole("button", { name: "Done" }).click();
    await expect.poll(() => builderWorking(page)).toBe(false);
    writeFileSync(heldUntil(), "");
  });

  await tagBuilder(page, "Hosts", "ENV HOSTS_SECRET");
  await expect(answerSaying(page, "HOSTS_SECRET is not set").nth(1)).toBeVisible();
  await expect(answerSaying(page, "Held answer")).toHaveCount(0);
});

test("a value that says where an agent's files are is always given, and an agent whose profile sets none still offers this computer's environment", async ({ page }) => {
  await signIn(page, host);
  await createRoom(page, "Kinds", ["Plain", "Located"]);
  const settings = await openRoomSettings(page, "Kinds", "Agents");
  const rowOf = (agent: string) => settings.locator(".room-settings-rows > li", { hasText: agent });
  await expect(rowOf("Plain").locator(".room-agent-values summary")).toHaveText("Its profile sets no values");
  await rowOf("Plain").locator(".room-agent-values summary").click();
  await expect(rowOf("Plain").getByRole("switch", { name: "Everything from this computer's environment" })).not.toBeChecked();
  await expect(rowOf("Located").locator(".room-agent-values summary")).toHaveText("Values from its profile: 1 of 1");
  await rowOf("Located").locator(".room-agent-values summary").click();
  const located = rowOf("Located").getByRole("list", { name: "Values Located gets from its profile" }).getByRole("switch", { name: "XDG_CACHE_HOME" });
  await expect(located).toBeChecked();
  await expect(located).toBeDisabled();
});

test("whether a room's agents read what guests write stays as the owner set it", async ({ page }) => {
  await signIn(page, host);
  await createRoom(page, "Guests", ["Builder"]);
  const settings = await openRoomSettings(page, "Guests", "People");
  const readsGuests = settings.getByRole("switch", { name: "Agents read what guests write" });
  await expect(readsGuests).toBeChecked();
  await readsGuests.uncheck();
  await settings.getByRole("button", { name: "Done" }).click();
  const again = await openRoomSettings(page, "Guests", "People");
  await expect(again.getByRole("switch", { name: "Agents read what guests write" })).not.toBeChecked();
  expect((await whatItMeans(page, again.getByRole("tabpanel"))).join("\n")).toContain("Turned off, no agent reads it");
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
  await expect(settings.getByText("What Claude agents load of your Claude Code setup")).toHaveCount(0);
  expect((await whatItMeans(page, settings.getByRole("tabpanel"))).join("\n")).toContain("Codex reads any file on this computer unasked");
});
