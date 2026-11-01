import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, createProfile, sendMessage, signIn, waitForTurnToEnd } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

/**
 * Claude Code streams the API's answer to a turn its cancel cut short even after the turn ended, and the host keeps
 * those late chunks out of the transcript. The fake agent repeats claude-agent-acp's shape exactly: the stop ends the
 * turn as cancelled, and a moment later the reply's rest arrives under the id it streamed under, while its turn was
 * still open (STOPPED REPLY) or after it had stopped without any chunk yet (STOPPED BEFORE).
 */
const host = new TestHost({ fakePrograms: true });
const promptsFile = join(host.root, "prompts");

test.beforeAll(async () => {
  writeBunProgram(host.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"), { FAKE_ACP_PROMPTS: promptsFile, FAKE_ACP_STEERS: "1" });
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const agentBubbles = (page: Page) => page.locator(".timeline:visible .message.agent");
const turnEndings = (page: Page) => page.locator(".timeline:visible").getByText("Turn ended: cancelled");

test("the reply a stopped turn keeps streaming after 'Turn ended: cancelled' stays out of the transcript, and the next turn's reply shows", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, "stopped", "", "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "stopped · opencode" });
  await page.getByRole("button", { name: "+ New conversation" }).click();

  const stop = async () => {
    await expect(page.locator(".composer:visible .stop")).toBeVisible();
    await page.locator(".composer:visible textarea").press("Escape");
  };
  const waitTurnCancelled = async (nth: number) => {
    await expect(turnEndings(page).nth(nth)).toBeVisible({ timeout: 60_000 });
    await waitForTurnToEnd(page);
  };
  const waitsForStop = (text: string) =>
    expect.poll(() => existsSync(promptsFile) && readFileSync(promptsFile, "utf8").includes(text), { timeout: 60_000 }).toBe(true);

  await test.step("the half of the reply streamed before the stop shows, its rest arriving after it does not", async () => {
    await sendMessage(page, "STOPPED REPLY the streamed one");
    await waitsForStop("STOPPED REPLY the streamed one");
    await expect(agentBubbles(page)).toHaveText(["Half a reply about the streamed one"]);
    await stop();
    await waitTurnCancelled(0);
    // The late chunks land 300 ms after the stop; a subagent's report among them shows, as its own call keeps reporting.
    await expect(page.locator(".timeline:visible .subagent-work").filter({ hasText: "A subagent reports on the streamed one" })).toHaveCount(1);
    // A late chunk not dropped would join the bubble that streamed before the stop: the half reply stays one bubble, whole.
    await expect(agentBubbles(page).filter({ hasText: "The rest about" })).toHaveCount(0);
    await expect(agentBubbles(page).filter({ hasText: "Half a reply about the streamed one" }).filter({ hasNotText: "The rest about" })).toHaveCount(1);
  });

  await test.step("a turn stopped before its reply began loses that whole reply, even as its id is new", async () => {
    await sendMessage(page, "STOPPED BEFORE the late one");
    await waitsForStop("STOPPED BEFORE the late one");
    await stop();
    await waitTurnCancelled(1);
    await expect(page.locator(".timeline:visible .subagent-work").filter({ hasText: "A subagent reports on the late one" })).toHaveCount(1);
    await expect(agentBubbles(page).filter({ hasText: "The rest about" })).toHaveCount(0);
  });

  await test.step("the turn started after the stops answers as usual", async () => {
    await sendMessage(page, "SAY Carrying on after the stops");
    await waitForTurnToEnd(page);
    await expect(agentBubbles(page).filter({ hasText: "Carrying on after the stops" })).toHaveCount(1);
  });

  await test.step("after a stop no late reply follows, the next turn keeps the reply it began with, before its tool call", async () => {
    await sendMessage(page, "STOPPED QUIET nothing comes");
    await waitsForStop("STOPPED QUIET nothing comes");
    await stop();
    await waitTurnCancelled(2);
    await sendMessage(page, "REPLY TOOL REPLY the file");
    await waitForTurnToEnd(page);
    await expect(agentBubbles(page).filter({ hasText: /Looking into the file|Found the file/ })).toHaveText(["Looking into the file", "Found the file"]);
    const shown = await page.locator(".timeline:visible").innerText();
    expect(shown.indexOf("Looking into the file")).toBeLessThan(shown.indexOf("Read the file"));
    expect(shown.indexOf("Read the file")).toBeLessThan(shown.indexOf("Found the file"));
  });

  await test.step("after a stop, a message steered into the next turn shows the reply that turn began, before it", async () => {
    await sendMessage(page, "STOPPED QUIET nor here");
    await waitsForStop("STOPPED QUIET nor here");
    await stop();
    await waitTurnCancelled(3);
    await sendMessage(page, "REPLY STEERED the plan");
    await waitsForStop("REPLY STEERED the plan");
    await page.locator(".composer:visible textarea").fill("Steered in");
    await page.locator(".composer:visible textarea").press("Enter");
    await waitForTurnToEnd(page);
    await expect(agentBubbles(page).filter({ hasText: /Starting on the plan|Also Steered in/ })).toHaveText(["Starting on the plan", /Also Steered in/]);
    const shown = await page.locator(".timeline:visible").innerText();
    expect(shown.indexOf("Starting on the plan")).toBeLessThan(shown.indexOf("Steered in"));
    expect(shown.indexOf("Steered in")).toBeLessThan(shown.indexOf("Also Steered in"));
  });
});
