import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { addWorkspace, createProfile, signIn, openProfileTab } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

const host = new TestHost({ fakePrograms: true });
const agentLogFile = join(host.root, "probe-log");

/** Changes the agent was asked to make to its own settings; the probe changes nothing but its own session's model. */
const optionChanges = () => agentLogLines().filter((line) => line.includes(" set "));

const agentLogLines = () =>
  readFileSync(agentLogFile, "utf8")
    .split("\n")
    .filter((line) => line !== "");

const startsOf = (name: string) => agentLogLines().filter((line) => line === `${name} started`).length;

const processAlive = (pidFile: string) => {
  try {
    process.kill(Number(readFileSync(pidFile, "utf8")), 0);
    return true;
  } catch {
    return false;
  }
};

test.beforeAll(async () => {
  writeBunProgram(host.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"));
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

test("a profile editor lists the modes and efforts its agent offers before one of its conversations has run", async ({ page }) => {
  writeFileSync(agentLogFile, "");
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, "asked", `FAKE_ACP_MODES=1\nFAKE_ACP_LOG=${agentLogFile}`, "", "opencode");
  await openProfileTab(profiles, "Defaults");
  await expect(profiles.getByLabel("Profile mode", { exact: true }).locator("option")).toHaveText(["Agent's default", "Default", "Plan"]);
  await expect(profiles.getByLabel("Profile effort").locator("option")).toHaveText(["Agent's default", "Low", "High"]);
  expect(optionChanges()).toEqual([]);
});

test("a profile editor asks its agent again once the profile launches it differently, and lets go of the process it asked with", async ({ page }) => {
  writeFileSync(agentLogFile, "");
  const pidFile = join(host.root, "probe.pid");
  const kept = `FAKE_ACP_NAME=re-asked\nFAKE_ACP_LOG=${agentLogFile}\nFAKE_ACP_PID_FILE=${pidFile}`;
  await signIn(page, host);
  const editor = await createProfile(page, "re-asked", `FAKE_ACP_MODES=1\n${kept}`, "", "opencode");
  await openProfileTab(editor, "Defaults");
  await expect(editor.getByLabel("Profile mode", { exact: true }).locator("option")).toHaveText(["Agent's default", "Default", "Plan"]);
  expect(startsOf("re-asked")).toBe(1);

  await openProfileTab(editor, "Launch");
  await editor.getByRole("button", { name: "Edit environment" }).click();
  await editor.getByLabel("Environment", { exact: true }).fill(kept);
  await editor.getByRole("button", { name: "Save" }).click();
  await expect(editor.getByText("Saved")).toBeVisible();
  await expect.poll(() => startsOf("re-asked")).toBe(2);
  await openProfileTab(editor, "Defaults");
  await expect(editor.getByLabel("Profile questions")).toBeVisible();
  await expect(editor.getByLabel("Profile mode", { exact: true }), "an agent that offers no modes gets no Mode row").toHaveCount(0);
  expect(optionChanges()).toEqual([]);

  await editor.getByRole("button", { name: "Close" }).click();
  await expect.poll(() => processAlive(pidFile)).toBe(false);
});

test("a profile editor lists the efforts of the model the profile names, asking on that model", async ({ page }) => {
  writeFileSync(agentLogFile, "");
  await signIn(page, host);
  const editor = await createProfile(page, "on-model", `FAKE_ACP_MODES=1\nFAKE_ACP_MODELS=1\nFAKE_ACP_NAME=on-model\nFAKE_ACP_LOG=${agentLogFile}`, "", "opencode");
  await openProfileTab(editor, "Defaults");
  const models = editor.getByLabel("Profile model");
  const efforts = editor.getByLabel("Profile effort");
  const asked = async (model: string) => {
    await models.selectOption(model);
    await editor.getByRole("button", { name: "Save" }).click();
    await expect.poll(optionChanges).toContain(`on-model set model to ${model}`);
    await expect(models.locator("option"), "the agent itself answered").toHaveText(["Agent's default", "Default (recommended)", "Opus", "Haiku"]);
  };
  await expect(efforts.locator("option")).toHaveText(["Agent's default", "Low", "High"]);

  await asked("haiku");
  await expect(efforts, "Haiku has no effort levels").toHaveCount(0);

  await asked("opus");
  await expect(efforts.locator("option")).toHaveText(["Agent's default", "Low", "High"]);
  expect(optionChanges(), "the probe sets nothing but the model, on its own session").toEqual(["on-model set model to haiku", "on-model set model to opus"]);
});
