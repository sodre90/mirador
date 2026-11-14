import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { addWorkspace, createProfile, primaryModifier, reloadFromRestartedHost, sendMessage, signIn, waitForTurnToEnd } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

const host = new TestHost({ fakePrograms: true });
const promptsFile = join(host.root, "prompts");
const PRELAUNCH_SECONDS = 5;
const FINISHED_TURN = "the report";

/** An opencode that is an agent of its own, which answers every prompt at once. */
function fakeOpencode() {
  writeBunProgram(host.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"), { FAKE_ACP_PROMPTS: promptsFile });
}

const prompts = () =>
  readFileSync(promptsFile, "utf8")
    .split("\n")
    .filter((text) => text !== "");

const hostStarts = () => host.log.match(/Mirador is running/g)?.length ?? 0;

/** Writes when it began and ended into the agent's log, beside the fake agent's own lines. */
const sleepNotingItsSpan = (seconds: number) => `echo "pre-launch began $(date -u +%T)"; sleep ${seconds}; echo "pre-launch ended $(date -u +%T)"`;

/** A new conversation on a new opencode profile whose pre-launch command sleeps that long. */
async function newConversationStartingSlowly(page: Page, profile: string, seconds: number) {
  await test.step(`a new conversation on "${profile}", whose pre-launch command sleeps ${seconds} s`, async () => {
    const profiles = await createProfile(page, profile, "", sleepNotingItsSpan(seconds), "opencode");
    await profiles.getByRole("button", { name: "Close" }).click();
    await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${profile} · opencode` });
    const previousUrl = page.url();
    await page.getByRole("button", { name: "+ New conversation" }).click();
    await expect(page).not.toHaveURL(previousUrl);
  });
}

async function firstTurn(page: Page, text: string, { timeout }: { timeout: number }) {
  await test.step(`"${text}" reaches the agent once its pre-launch command ends, and its turn ends`, async () => {
    await sendMessage(page, text);
    await expect.poll(prompts, { timeout }).toContain(text);
    await waitForTurnToEnd(page);
  });
}

test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  fakeOpencode();
  writeFileSync(promptsFile, "");
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

test("Cmd+Shift+R while a turn's agent is still starting restarts the host, and messages go out after it", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  await newConversationStartingSlowly(page, "slow start", PRELAUNCH_SECONDS);
  await firstTurn(page, "first", { timeout: 30_000 });

  await test.step("after a restart from outside, the next turn waits for the agent's pre-launch command", async () => {
    await host.restart();
    await sendMessage(page, "second");
    await expect(page.locator(".chat-header:visible .badge")).toHaveText("starting");
  });

  await test.step("Cmd+Shift+R restarts the host then, rather than leave it holding every message", async () => {
    const startsBefore = hostStarts();
    await page.keyboard.press(`${await primaryModifier(page)}+Shift+R`);
    await expect.poll(hostStarts, { timeout: 60_000 }).toBe(startsBefore + 1);
    await sendMessage(page, "third");
    await expect.poll(prompts, { timeout: 60_000 }).toContain("third");
    await expect(page.locator(".queue:visible .queued-text")).toHaveCount(0);
    // The turn Cmd+Shift+R stopped finished on its own during the wait, so the next host must not send its message again.
    expect(prompts()).toEqual(["first", "second", "third"]);
  });
});

test("a turn the agent finished during the stop for a restart is not sent again after it", async ({ page }) => {
  await signIn(page, host);
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "slow start · opencode" });
  const previousUrl = page.url();
  await page.getByRole("button", { name: "+ New conversation" }).click();
  await expect(page).not.toHaveURL(previousUrl);
  await sendMessage(page, `FINISHED ON STOP ${FINISHED_TURN}`);
  await expect(page.locator(".timeline:visible .message.agent").last()).toContainText(`Begun on ${FINISHED_TURN}`, { timeout: 30_000 });

  const startsBefore = hostStarts();
  await page.keyboard.press(`${await primaryModifier(page)}+Shift+R`);
  await expect.poll(hostStarts, { timeout: 60_000 }).toBe(startsBefore + 1);
  // The next host decides at its start whether to send the turn again; the page reloads to show what it decided.
  await reloadFromRestartedHost(page);
  await expect(page.locator(".chat-header:visible .badge")).toHaveText("idle");

  await sendMessage(page, "after-stream");
  await expect.poll(prompts, { timeout: 60_000 }).toContain("after-stream");
  const sent = prompts();
  expect(sent.slice(sent.indexOf(`FINISHED ON STOP ${FINISHED_TURN}`))).toEqual([`FINISHED ON STOP ${FINISHED_TURN}`, "after-stream"]);
  await expect(page.locator(".timeline:visible .message.user", { hasText: FINISHED_TURN })).toHaveCount(1);
  await expect(page.locator(".timeline:visible .message.agent", { hasText: `Finished ${FINISHED_TURN}` })).toHaveCount(1);
});

test("a turn whose agent was still starting when the stop ran out waits for its own message to go again, not the previous turn's", async ({ page }) => {
  await signIn(page, host);
  await newConversationStartingSlowly(page, "very slow start", 15);
  await firstTurn(page, "slower first", { timeout: 60_000 });

  await host.restart();
  await sendMessage(page, "slower second");
  await expect(page.locator(".chat-header:visible .badge")).toHaveText("starting");

  const startsBefore = hostStarts();
  await page.keyboard.press(`${await primaryModifier(page)}+Shift+R`);
  await expect.poll(hostStarts, { timeout: 90_000 }).toBe(startsBefore + 1);

  await expect.poll(prompts, { timeout: 90_000 }).toContain("slower second");
  expect(prompts().filter((text) => text === "slower second")).toEqual(["slower second"]);
  expect(prompts().filter((text) => text === "slower first")).toEqual(["slower first"]);
});

test("a message sent while the next host reopens a stopped turn's session waits behind the turn", async ({ page }) => {
  await host.restart();
  await signIn(page, host);
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "very slow start · opencode" });
  const previousUrl = page.url();
  await page.getByRole("button", { name: "+ New conversation" }).click();
  await expect(page).not.toHaveURL(previousUrl);
  await sendMessage(page, "stopped while starting");
  await expect(page.locator(".chat-header:visible .badge")).toHaveText("starting");

  const startsBefore = hostStarts();
  await page.keyboard.press(`${await primaryModifier(page)}+Shift+R`);
  await expect.poll(hostStarts, { timeout: 90_000 }).toBe(startsBefore + 1);
  await reloadFromRestartedHost(page);
  await expect(page.locator(".chat-header:visible .badge")).toHaveText("starting");
  const composer = page.locator(".composer:visible textarea");
  await composer.fill("sent meanwhile");
  await composer.press("Enter");
  await expect(page.locator(".queue:visible .queued-text")).toHaveText("sent meanwhile");

  await expect.poll(prompts, { timeout: 90_000 }).toContain("sent meanwhile");
  const sent = prompts();
  expect(sent.slice(sent.indexOf("stopped while starting"))).toEqual(["stopped while starting", "sent meanwhile"]);
});
