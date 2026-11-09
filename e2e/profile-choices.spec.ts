import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { addWorkspace, createProfile, signIn } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

const host = new TestHost({ fakePrograms: true });
const agentLogFile = join(host.root, "probe-log");

/** Changes the agent was asked to make to its own settings; the probe only ever asks. */
const optionChanges = () =>
  readFileSync(agentLogFile, "utf8")
    .split("\n")
    .filter((line) => line.includes(" set "));

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
