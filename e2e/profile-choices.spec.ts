import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { addWorkspace, createProfile, signIn } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

const host = new TestHost({ fakePrograms: true });
const agentLogFile = join(host.root, "probe-log");

/** Changes the agent was asked to make to its own settings; the probe only ever asks. */
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
  await expect(profiles.getByLabel("Profile mode").locator("option")).toHaveText(["Agent's default", "Default", "Plan"]);
  await expect(profiles.getByLabel("Profile effort").locator("option")).toHaveText(["Agent's default", "Low", "High"]);
  expect(optionChanges()).toEqual([]);
});

test("a profile editor asks its agent again once the profile launches it differently, and lets go of the process it asked with", async ({ page }) => {
  writeFileSync(agentLogFile, "");
  const pidFile = join(host.root, "probe.pid");
  const kept = `FAKE_ACP_NAME=re-asked\nFAKE_ACP_LOG=${agentLogFile}\nFAKE_ACP_PID_FILE=${pidFile}`;
  await signIn(page, host);
  const editor = await createProfile(page, "re-asked", `FAKE_ACP_MODES=1\n${kept}`, "", "opencode");
  await expect(editor.getByLabel("Profile mode").locator("option")).toHaveText(["Agent's default", "Default", "Plan"]);
  expect(startsOf("re-asked")).toBe(1);

  await editor.getByRole("button", { name: "Edit environment" }).click();
  await editor.getByLabel("Environment", { exact: true }).fill(kept);
  await editor.getByRole("button", { name: "Save" }).click();
  await expect(editor.getByText("Saved")).toBeVisible();
  await expect.poll(() => startsOf("re-asked")).toBe(2);
  await expect(editor.getByLabel("Profile mode").locator("option")).toHaveText(["Agent's default"]);
  expect(optionChanges()).toEqual([]);

  await editor.getByRole("button", { name: "Close" }).click();
  await expect.poll(() => processAlive(pidFile)).toBe(false);
});
