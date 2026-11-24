import { afterAll, beforeAll, expect, test } from "bun:test";
import { launchEnvironment } from "../host/acp/harnesses.ts";
import type { HarnessId, Profile } from "../shared/model.ts";

const ANY_PROGRAM = "CLAUDE_CODE_EXECUTABLE=/opt/claude\nPI_ACP_PI_COMMAND=/opt/pi\nCODEX_PATH=/opt/codex\nCOPILOT_PATH=/opt/copilot\nAGY_PATH=/opt/agy";
const profileWith = (environment = "") => ({ name: "Work", environment: `${ANY_PROGRAM}\n${environment}` }) as Profile;
const harnesses: HarnessId[] = ["claude", "opencode", "pi", "codex", "copilot", "antigravity"];
const runningTests = process.env.GIT_OPTIONAL_LOCKS;

beforeAll(() => {
  delete process.env.GIT_OPTIONAL_LOCKS;
});
afterAll(() => {
  if (runningTests !== undefined) process.env.GIT_OPTIONAL_LOCKS = runningTests;
});

test.each(harnesses)("a git status that %s kills leaves no index.lock behind", (harness) => {
  expect(launchEnvironment(harness, profileWith(), "").GIT_OPTIONAL_LOCKS).toBe("0");
});

test("a profile may have its agent's git take its locks", () => {
  expect(launchEnvironment("pi", profileWith("GIT_OPTIONAL_LOCKS=1"), "").GIT_OPTIONAL_LOCKS).toBe("1");
});

test("a room that gives its agent nothing of this computer still spares it the lock", () => {
  expect(launchEnvironment("opencode", profileWith(), "", () => ({})).GIT_OPTIONAL_LOCKS).toBe("0");
});
