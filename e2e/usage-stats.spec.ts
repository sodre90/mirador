import { expect, test } from "@playwright/test";
import type { ToolReport, UsageReport } from "../host/usage-stats.ts";
import { FakeClaudeApi, fakeClaudeEnvironment } from "./fake-claude-api.ts";
import { addWorkspace, createProfile, sendMessage, signIn, startConversation, waitForTurnToEnd, conversationSettings } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const api = new FakeClaudeApi();
const host = new TestHost({ environment: () => fakeClaudeEnvironment(api) });
const FAILING = "touch made-by-hand; exit 3";
const DENIED = "rm -rf scratch";
const ASK_FOR_STATS = 'CALL mcp__canvas__usage_stats {"since": "30d"}';
const LOOK_INTO_BASH = 'CALL mcp__canvas__usage_stats {"tool": "bash", "profile": "this"}';
const ASK_ABOUT_ALL = 'CALL mcp__canvas__usage_stats {"workspace": "all"}';

test.beforeAll(async () => {
  api.limited = false;
  await api.start();
  await host.start();
});

test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
  api.stop();
});

test("an agent reads which tools each profile used, how each fared, where they come from and the permissions they took, looks into one, and so does mirador usage, by the profile each turn ran on", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  await startConversation(page);
  const permission = page.locator(".timeline:visible .permission.pending");

  await sendMessage(page, `RUN ${FAILING}`);
  await permission.locator("button.option-allow_once").click({ timeout: 120_000 });
  await waitForTurnToEnd(page);
  await sendMessage(page, `RUN ${DENIED}`);
  await permission.locator("button.option-reject_once").click({ timeout: 60_000 });
  await waitForTurnToEnd(page);

  await sendMessage(page, ASK_FOR_STATS);
  await waitForTurnToEnd(page);
  expect(api.callResults).toHaveLength(1);
  const report = JSON.parse(api.callResults[0]!) as UsageReport;
  expect(report).toMatchObject({ workspace: "project", previousPeriod: null });
  const bash = report.tools.find(({ tool }) => tool === "Bash")!;
  expect(bash).toMatchObject({ calls: 2, succeeded: 0, failed: 1, denied: 1, failureReasons: [{ reason: "exit code 3", calls: 1 }] });
  expect(bash.failureExamples[0]!.input).toBe(FAILING);
  expect(report.permissions).toMatchObject({ asked: 2, allowedOnce: 1, rejected: 1 });
  expect(report.turns.endedBy.end_turn).toBe(2);
  expect(report.models).toEqual([expect.objectContaining({ model: api.models.get(`RUN ${FAILING}`), turnsWithTokens: 2 })]);
  expect(report.totals.outputTokens).toBeGreaterThan(0);
  expect(report.profiles).toEqual([
    expect.objectContaining({
      profile: "Claude Code",
      agent: "Claude Code",
      totals: expect.objectContaining({ turns: 2, toolCalls: 2, failedCalls: 1 }),
      failureReasons: [{ tool: "Bash", reason: "exit code 3", calls: 1 }],
    }),
  ]);
  expect(report.sources).toEqual([{ source: "the agent's own tools", calls: 2, sharePercent: 100, failed: 1, tools: [{ tool: "Bash", calls: 2 }] }]);
  expect(report.samples!.yourRequests.shown.map(({ text }) => text)).toEqual([`RUN ${FAILING}`, `RUN ${DENIED}`, ASK_FOR_STATS]);

  await sendMessage(page, LOOK_INTO_BASH);
  await waitForTurnToEnd(page);
  expect(api.callResults).toHaveLength(2);
  const { tool, profile } = JSON.parse(api.callResults[1]!) as ToolReport;
  expect(profile).toBe("Claude Code");
  expect(tool).toMatchObject({ tool: "Bash", byProfile: [{ profile: "Claude Code", calls: 2, failed: 1, successPercent: 0 }] });
  expect(tool.slowestCalls[0]!.input).toBe(FAILING);

  await sendMessage(page, ASK_ABOUT_ALL);
  await waitForTurnToEnd(page);
  expect(api.callResults).toHaveLength(3);
  const aboutAll = JSON.parse(api.callResults[2]!) as UsageReport;
  expect(aboutAll, "a report beyond the caller's workspace quotes none of the user's work").toMatchObject({ workspace: "all workspaces", samples: null, conversations: null });
  expect(aboutAll.tools.find(({ tool }) => tool === "Bash")).toMatchObject({ failed: 1, failureExamples: [] });

  const fromTheCommandLine = JSON.parse(host.mirador("usage", "--json")) as UsageReport;
  expect(fromTheCommandLine.tools.find(({ tool }) => tool === "Bash")).toMatchObject({ calls: 2, failed: 1, denied: 1 });
  const printed = host.mirador("usage");
  expect(printed).toMatch(/^Bash\s+2\s+0\s+1\s+1\s+0\s+0%/m);
  expect(printed).not.toContain("Before");
  const compared = host.mirador("usage", "--compare");
  expect(compared).toMatch(/^Before, from .*: nothing$/m);
  expect(compared).toMatch(/^Tool\s+Calls\s+Succeeded\s+Failed\s+Denied\s+Cancelled\s+Success\s+Before\s+Median/m);
  expect(printed).toContain("exit code 3 (1)");
  expect(printed).toMatch(/^Claude Code\s+Claude Code\s+\d+\s+\d+\s/m);
  const lookedInto = host.mirador("usage", "--tool", "Bash", "--profile", "claude code");
  expect(lookedInto).toMatch(/^Bash from .*, all workspaces, Claude Code$/m);
  expect(lookedInto).toMatch(/^Claude Code\s+2\s+1\s+0%$/m);

  const profiles = await createProfile(page, "Second", "");
  await profiles.getByRole("button", { name: "Close" }).click();
  await (await conversationSettings(page)).getByLabel("Profile", { exact: true }).selectOption({ label: "Second" });
  await expect(page.locator(".timeline:visible")).toContainText("Now using the profile “Second”");
  await sendMessage(page, "Hello from the second profile");
  await waitForTurnToEnd(page);
  const afterTheSwitch = JSON.parse(host.mirador("usage", "--json")) as UsageReport;
  expect(afterTheSwitch.totals).toMatchObject({ conversations: 1, turns: 6 });
  expect(afterTheSwitch.profiles.map(({ profile, totals }) => [profile, totals.turns])).toEqual([
    ["Claude Code", 5],
    ["Second", 1],
  ]);
  const onTheFirst = JSON.parse(host.mirador("usage", "--profile", "Claude Code", "--json")) as UsageReport;
  expect(onTheFirst.totals, "the turns before the switch stay the first profile's").toMatchObject({ conversations: 1, turns: 5, toolCalls: 5 });
});
