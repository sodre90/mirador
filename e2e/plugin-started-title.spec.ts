import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, callCanvasTool, createProfile, lastAgentMessage, sendMessage, signIn, startConversation } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

const host = new TestHost({ fakePrograms: true });
const promptsFile = join(host.root, "prompts");
const agentSaw = () => readFileSync(promptsFile, "utf8");

test.beforeAll(async () => {
  // The board test plugin's hand_over tool starts the conversations, on an opencode stand-in that titles its sessions on request and forks them.
  cpSync(join(import.meta.dirname, "..", "tests", "fixtures", "canvas-plugins", "board"), join(host.dataDir, "plugins", "board"), { recursive: true });
  writeBunProgram(host.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"), { FAKE_ACP_PROMPTS: promptsFile, FAKE_ACP_FORKS: "1" });
  writeFileSync(promptsFile, "");
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

/** Hands the task over, waiting until its turn ended and the caller heard so, by when its agent has renamed its session. */
async function handOverAndWaitForReply(callerId: string, args: { task: string; title?: string }) {
  const handedOver = await callCanvasTool(host, callerId, "hand_over", { profile: "local", ...args });
  const startedId = handedOver.match(/^Handed over to ([0-9a-f-]+)\.$/)![1]!;
  const renamedTo = args.task.slice("TITLE ".length);
  await expect.poll(agentSaw).toContain(`The handed-over task finished: Titled ${renamedTo}.\n`);
  return startedId;
}

async function titleShownFor(page: Page, conversationId: string) {
  await page.evaluate((id) => (location.hash = `#/c/${id}`), conversationId);
  await expect(page.locator(".sidebar li.selected .conversation-title")).toHaveCount(1);
  return { header: page.locator(".chat-header:visible h2"), sidebar: page.locator(".sidebar li.selected .conversation-title") };
}

test("a conversation a plugin's tool starts with a title keeps that title, where its first message and its agent would rename it", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, "Local", "", "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "Local · opencode" });
  const callerId = await startConversation(page, { withModels: false });

  const titled = await handOverAndWaitForReply(callerId, { task: "TITLE json", title: "Spectra Council 1c7ea32c · Review · Local" });
  const shownTitled = await titleShownFor(page, titled);
  await expect(shownTitled.header).toHaveText("Spectra Council 1c7ea32c · Review · Local");
  await expect(shownTitled.sidebar).toHaveText("Spectra Council 1c7ea32c · Review · Local");

  await test.step("a fork of it keeps the title safe from the agent's renaming too", async () => {
    await page.locator(".chat-header:visible").getByRole("button", { name: "Fork", exact: true }).click();
    await expect(page).not.toHaveURL(new RegExp(`#/c/${titled}$`));
    await expect(shownTitled.header).toHaveText("Fork: Spectra Council 1c7ea32c · Review · Local");
    await sendMessage(page, "TITLE json");
    await expect(lastAgentMessage(page)).toContainText("Titled json.");
    await expect(shownTitled.header).toHaveText("Fork: Spectra Council 1c7ea32c · Review · Local");
    await expect(page.locator(".sidebar li.selected .conversation-title")).toHaveText("Fork: Spectra Council 1c7ea32c · Review · Local");
  });

  const untitled = await handOverAndWaitForReply(callerId, { task: "TITLE Named by the agent" });
  const shownUntitled = await titleShownFor(page, untitled);
  await expect(shownUntitled.header, "without a title, the agent renames it as before").toHaveText("Named by the agent");
  await expect(shownUntitled.sidebar).toHaveText("Named by the agent");
});
