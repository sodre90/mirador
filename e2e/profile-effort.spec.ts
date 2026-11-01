import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, createProfile, openProfiles, signIn } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

const host = new TestHost({ fakePrograms: true });
const agentLogFile = join(host.root, "agent-log");

test.beforeAll(async () => {
  writeBunProgram(host.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"), { FAKE_ACP_LOG: agentLogFile });
  writeFileSync(agentLogFile, "");
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

/** The option changes the agents with a FAKE_ACP_NAME were asked for. */
const optionChanges = () =>
  readFileSync(agentLogFile, "utf8")
    .split("\n")
    .filter((line) => line.includes(" set "));

/** The stub agent offers no model to pick, so this is `startConversation` without that wait. */
async function startConversationWithoutModel(page: Page) {
  const previousUrl = page.url();
  await page.getByRole("button", { name: "+ New conversation" }).click();
  await expect(page).not.toHaveURL(previousUrl);
  return page.url().match(/#\/c\/(.+)$/)![1]!;
}

/** Saved as a page could save it, with an effort level the editor only offers once the agent has listed it. */
async function saveProfileWithEffort(page: Page, name: string, environment: string, effort: string) {
  await page.evaluate(
    (profile) =>
      new Promise((resolve) => {
        const socket = new WebSocket(`${location.origin.replace(/^http/, "ws")}/ws`);
        socket.onopen = () => socket.send(JSON.stringify({ type: "profile.save", requestId: "save-effort", profile }));
        socket.onmessage = ({ data }) => JSON.parse(String(data)).type === "profile.saved" && resolve(socket.close());
      }),
    { name, harness: "opencode", environment, prelaunch: "", mode: null, effort, bypassPermissions: false, askMode: "wait", color: null },
  );
}

test("a profile sets the effort of the conversations that start with it or move to it, when their agent offers the level", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  for (const name of ["plain", "thorough"]) {
    const profiles = await createProfile(page, name, `FAKE_ACP_MODES=1\nFAKE_ACP_NAME=${name}`, "", "opencode");
    await expect(profiles.getByLabel("Profile effort").locator("option")).toHaveText(["Agent's default"]);
    await profiles.getByRole("button", { name: "Close" }).click();
  }
  const effort = page.getByLabel("Effort", { exact: true }).filter({ visible: true });
  const profilePicker = page.getByLabel("Profile", { exact: true }).filter({ visible: true });
  const timeline = page.locator(".timeline:visible");
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "plain · opencode" });
  const plain = await startConversationWithoutModel(page);
  await expect(effort).toHaveValue("low");

  await test.step("the profile offers the effort levels the agent listed, and keeps one", async () => {
    const editor = await openProfiles(page);
    await editor.locator(".profile-list li", { hasText: "thorough" }).click();
    await expect(editor.getByLabel("Profile effort").locator("option")).toHaveText(["Agent's default", "Low", "High"]);
    await editor.getByLabel("Profile effort").selectOption("high");
    await editor.getByRole("button", { name: "Save" }).click();
    await expect(editor.locator(".saved")).toHaveText("Saved");
    await editor.getByRole("button", { name: "Close" }).click();
  });

  await test.step("a conversation that starts with the profile takes it", async () => {
    await page.getByLabel("Agent", { exact: true }).selectOption({ label: "thorough · opencode" });
    await startConversationWithoutModel(page);
    await expect(effort).toHaveValue("high");
    expect(optionChanges()).toEqual(["thorough set effort to high"]);
  });

  await test.step("a conversation moved to the profile takes it too", async () => {
    await page.locator(`li[data-reorder-id="${plain}"]`).click();
    await expect(effort).toHaveValue("low");
    await profilePicker.selectOption({ label: "thorough" });
    await expect(timeline).toContainText("Now using the profile “thorough”");
    await expect(effort).toHaveValue("high");
  });

  await test.step("a level the agent does not offer leaves the conversation's own, without an error", async () => {
    await saveProfileWithEffort(page, "maxed", "FAKE_ACP_MODES=1\nFAKE_ACP_NAME=maxed", "max");
    await profilePicker.selectOption({ label: "maxed" });
    await expect(timeline).toContainText("Now using the profile “maxed”");
    await expect.poll(optionChanges).toContain("maxed set effort to high");
    await expect(effort).toHaveValue("high");
    expect(optionChanges()).not.toContain("maxed set effort to max");
    await expect(timeline.locator(".error-line")).toHaveCount(0);
  });
});
