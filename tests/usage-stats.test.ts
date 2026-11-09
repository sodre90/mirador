import { afterAll, afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolKind } from "@agentclientprotocol/sdk/unstable";
import type { Conversation, ConversationEvent, HarnessId, Profile } from "../shared/model.ts";
import { Store } from "../host/store.ts";
import { UsageData } from "../host/usage-data.ts";
import { toolReportApart, usageReportApart } from "../host/usage-reports.ts";
import { failureReason, masked, sourceOf, toolReport, usagePeriod, usageReport, UsageQueryError, type ReportOptions, type UsageQuery } from "../host/usage-stats.ts";

const folder = mkdtempSync(join(tmpdir(), "mirador-usage-"));
const stores: Store[] = [];
afterEach(() => {
  setSystemTime();
  for (const store of stores.splice(0)) store.close();
});
afterAll(() => rmSync(folder, { recursive: true, force: true }));

/** A store in a file of its own, as reports read it on a read-only connection of their own. */
function newStore() {
  const store = new Store(join(folder, `${stores.length}-${crypto.randomUUID()}.sqlite`));
  stores.push(store);
  return store;
}

function reportOn(store: Store, query: UsageQuery = {}, options: ReportOptions = {}) {
  const data = UsageData.open(store.path);
  try {
    return usageReport(data, query, { now: NOW, ...options });
  } finally {
    data.close();
  }
}

function toolReportOn(store: Store, query: UsageQuery & { tool: string }, options: ReportOptions = {}) {
  const data = UsageData.open(store.path);
  try {
    return toolReport(data, query, { now: NOW, ...options });
  } finally {
    data.close();
  }
}

const conversation = (id: string, workspaceId: string, harness: HarnessId, title: string, profileId: string | null = null): Conversation => ({
  id,
  workspaceId,
  harness,
  profileId,
  title,
  titleSetByUser: false,
  acpSessionId: null,
  askMode: "wait",
  bypassPermissions: false,
  status: "idle",
  statusDetail: null,
  openInTerminal: null,
  contextUsage: null,
  queuedMessages: [],
  usageLimit: null,
  jobWaits: [],
  asyncTasks: [],
  waitingFor: null,
  pendingRequest: null,
  lastWords: null,
  activity: null,
  configOptions: [],
  position: 0,
  createdAt: 1,
  updatedAt: 1,
});

function seededStore() {
  const store = newStore();
  store.insertWorkspace({ id: "w1", name: "project", path: "/tmp/project", defaultLaunch: { harness: "claude", profileId: null }, createdAt: 1 });
  store.insertWorkspace({ id: "w2", name: "other", path: "/tmp/other", defaultLaunch: { harness: "claude", profileId: null }, createdAt: 1 });
  store.insertConversation(conversation("c1", "w1", "claude", "Fix the build"));
  store.insertConversation(conversation("c2", "w2", "opencode", "Write docs"));
  return store;
}

const profile = (id: string, name: string, harness: HarnessId): Profile => ({
  id,
  name,
  harness,
  environment: "",
  prelaunch: "",
  mode: null,
  effort: null,
  bypassPermissions: false,
  askMode: "wait",
  color: null,
  createdAt: 1,
});

/** 20 October 2026, 10:00 local time, plus the seconds given: in the 30 days before NOW. */
const october20 = (seconds: number) => new Date(2026, 9, 20, 10, 0, seconds);
/** In the 30 days before those. */
const september20 = (seconds: number) => new Date(2026, 8, 20, 10, 0, seconds);
const NOW = new Date(2026, 9, 31, 12, 0, 0).getTime();

function write(store: Store, conversationId: string, atSeconds: number, event: ConversationEvent, day = october20) {
  setSystemTime(day(atSeconds));
  store.appendEvent(conversationId, event);
}

const started = (toolCallId: string, toolName: string, kind: ToolKind, rawInput: Record<string, unknown> = {}, parentToolUseId?: string): ConversationEvent => ({
  type: "acp",
  update: {
    sessionUpdate: "tool_call",
    toolCallId,
    title: toolName,
    kind,
    status: "pending",
    rawInput,
    _meta: { claudeCode: { toolName, ...(parentToolUseId && { parentToolUseId }) } },
  },
});

const ended = (toolCallId: string, status: "completed" | "failed", text?: string): ConversationEvent => ({
  type: "acp",
  update: { sessionUpdate: "tool_call_update", toolCallId, status, ...(text && { content: [{ type: "content", content: { type: "text", text } }] }) },
});

const asked = (permissionId: string, toolCallId: string): ConversationEvent => ({
  type: "permission",
  permissionId,
  toolCall: { toolCallId, title: "Bash" },
  options: [
    { optionId: "allow", name: "Yes", kind: "allow_once" },
    { optionId: "always", name: "Always", kind: "allow_always" },
    { optionId: "reject", name: "No", kind: "reject_once" },
  ],
});

const message: ConversationEvent = { type: "user-message", text: "go" };
const typed = (text: string): ConversationEvent => ({ type: "user-message", text });
const turnEnd: ConversationEvent = { type: "turn-end", stopReason: "end_turn" };

describe("tool calls", () => {
  test("count by tool, with succeeded, failed, denied and cancelled apart, and success as succeeded of succeeded and failed", () => {
    const store = seededStore();
    write(store, "c1", 0, message);
    write(store, "c1", 1, started("t1", "Bash", "execute", { command: "bun test" }));
    write(store, "c1", 3, ended("t1", "completed"));
    write(store, "c1", 4, started("t2", "Bash", "execute", { command: "grep -rn needle ." }));
    write(store, "c1", 5, ended("t2", "failed", "```\nExit code 1\n\n```"));
    write(store, "c1", 6, started("t3", "Bash", "execute", { command: "rm -rf build" }));
    write(store, "c1", 6, asked("p1", "t3"));
    write(store, "c1", 8, { type: "permission-resolved", permissionId: "p1", optionId: "reject" });
    write(store, "c1", 8, ended("t3", "failed", "The user doesn't want to proceed with this tool use."));
    write(store, "c1", 9, started("t4", "Read", "read", { file_path: "/tmp/project/a.ts" }));
    write(store, "c1", 9, ended("t4", "completed"));
    write(store, "c1", 10, started("t5", "Bash", "execute", { command: "bun run e2e" }));
    write(store, "c1", 12, { type: "turn-end", stopReason: "cancelled" });

    const report = reportOn(store);
    expect(report.totals).toMatchObject({ conversations: 1, turns: 1, toolCalls: 5, successPercent: 66.7 });
    expect(report.tools.map(({ tool, calls }) => [tool, calls])).toEqual([
      ["Bash", 4],
      ["Read", 1],
    ]);
    expect(report.tools[0]).toMatchObject({
      kind: "execute",
      source: "the agent's own tools",
      profiles: ["Claude Code"],
      succeeded: 1,
      failed: 1,
      denied: 1,
      cancelled: 1,
      successPercent: 50,
      medianSeconds: 1,
      failureReasons: [{ reason: "exit code 1", calls: 1 }],
      failureExamples: [{ input: "grep -rn needle .", result: "Exit code 1", at: "2026-10-20 10:00" }],
    });
  });

  test("a call still running when the period ends counts nowhere, and the host's failing of calls a broken turn left open counts as cancelled", () => {
    const store = seededStore();
    write(store, "c1", 0, message);
    write(store, "c1", 1, started("t1", "Bash", "execute", { command: "sleep 5" }));
    write(store, "c1", 2, ended("t1", "failed"));
    write(store, "c1", 2, { type: "error", message: "The agent stopped" });
    write(store, "c1", 3, message);
    write(store, "c1", 4, started("t2", "Bash", "execute", { command: "sleep 600" }));
    const report = reportOn(store);
    expect(report.tools[0]).toMatchObject({ calls: 1, cancelled: 1, failed: 0, successPercent: null });
    expect(report.turns.endedBy).toEqual({ error: 1 });
  });

  test("calls a subagent made are counted and marked as the subagent's", () => {
    const store = seededStore();
    write(store, "c1", 0, message);
    write(store, "c1", 1, started("agent", "Agent", "think", { description: "look around" }));
    write(store, "c1", 2, started("t1", "Grep", "search", { pattern: "TODO" }, "agent"));
    write(store, "c1", 3, ended("t1", "completed"));
    write(store, "c1", 4, ended("agent", "completed"));
    write(store, "c1", 5, { type: "turn-end", stopReason: "end_turn" });
    const { tools } = reportOn(store);
    expect(tools.map(({ tool, bySubagents }) => [tool, bySubagents])).toEqual([
      ["Agent", 0],
      ["Grep", 1],
    ]);
  });

  test("looking into one tool, by any case of its name, gives its calls by profile, more of its failures, its slowest calls and its findings", () => {
    const store = seededStore();
    write(store, "c1", 0, message);
    for (const [index, seconds] of [3, 1, 7, 2, 5].entries()) {
      write(store, "c1", index * 10, started(`t${index}`, "Bash", "execute", { command: `step ${index}` }));
      write(store, "c1", index * 10 + seconds, ended(`t${index}`, "failed", `Exit code ${index}`));
    }
    write(store, "c1", 60, started("r1", "Read", "read", { file_path: "a.ts" }));
    write(store, "c1", 61, ended("r1", "completed"));
    write(store, "c1", 62, turnEnd);
    write(store, "c2", 70, message);
    write(store, "c2", 71, started("o1", "Bash", "execute", { command: "ls" }));
    write(store, "c2", 71, ended("o1", "completed"));
    write(store, "c2", 72, turnEnd);

    expect(reportOn(store).tools[0]!.failureExamples).toHaveLength(3);
    const { tool, findings } = toolReportOn(store, { tool: "bash" });
    expect(tool).toMatchObject({ tool: "Bash", calls: 6 });
    expect(tool.failureExamples).toHaveLength(5);
    expect(tool.byProfile).toEqual([
      { profile: "Claude Code", calls: 5, failed: 5, successPercent: 0 },
      { profile: "opencode", calls: 1, failed: 0, successPercent: 100 },
    ]);
    expect(tool.slowestCalls.map(({ input, seconds }) => [input, seconds])).toEqual([
      ["step 2", 7],
      ["step 4", 5],
      ["step 0", 3],
      ["step 3", 2],
      ["step 1", 1],
    ]);
    expect(findings.map(({ kind, tool }) => [kind, tool])).toEqual([["failing-tool", "Bash"]]);
    expect(() => toolReportOn(store, { tool: "Write" })).toThrow(new UsageQueryError('No call of a tool named "Write" in this period.'));
  });
});

describe("permissions", () => {
  test("count the answers, and name the commands allowed once three times or more", () => {
    const store = seededStore();
    write(store, "c1", 0, message);
    const commands = ["git status", "cd /tmp/project && git diff", "git log", "bun test", "bun test", "npm install"];
    for (const [index, command] of commands.entries()) {
      write(store, "c1", index * 10 + 1, started(`t${index}`, "Bash", "execute", { command }));
      write(store, "c1", index * 10 + 1, asked(`p${index}`, `t${index}`));
      const answer = command === "npm install" ? "reject" : "allow";
      write(store, "c1", index * 10 + 1 + index, { type: "permission-resolved", permissionId: `p${index}`, optionId: answer });
      write(store, "c1", index * 10 + 8, ended(`t${index}`, answer === "allow" ? "completed" : "failed"));
    }
    write(store, "c1", 70, started("w1", "WebFetch", "fetch", { url: "https://example.com" }));
    write(store, "c1", 70, asked("pw", "w1"));
    write(store, "c1", 71, { type: "permission-resolved", permissionId: "pw", optionId: "always" });
    write(store, "c1", 72, ended("w1", "completed"));
    write(store, "c1", 80, started("w2", "WebFetch", "fetch", { url: "https://example.org" }));
    write(store, "c1", 80, asked("pu", "w2"));
    write(store, "c1", 81, { type: "permission-resolved", permissionId: "pu", optionId: null });
    write(store, "c1", 82, { type: "turn-end", stopReason: "end_turn" });

    const report = reportOn(store);
    expect(report.permissions).toEqual({
      asked: 8,
      allowedOnce: 5,
      allowedAlways: 1,
      rejected: 1,
      unanswered: 1,
      medianSecondsToAnswer: 1,
      allowedOnceRepeatedly: [{ profile: "Claude Code", tool: "Bash", command: "git", times: 3 }],
    });
    expect(report.findings).toEqual([
      {
        kind: "allow-always",
        profile: "Claude Code",
        tool: "Bash",
        count: 3,
        seen: "You allowed Bash git once 3 times in Claude Code.",
        suggestion: "When Claude Code next asks about Bash git, choose the answer that allows it always, so it stops asking.",
      },
    ]);
  });
});

describe("turns and models", () => {
  test("a turn a usage limit ended as an error that carries what it spent counts that usage and model", () => {
    const store = seededStore();
    write(store, "c1", 0, message);
    write(store, "c1", 30, {
      type: "error",
      message: "You've hit your 5-hour limit · resets 3:30am (Europe/Zagreb)",
      usageLimit: { resetsAt: 1 },
      endsTurn: true,
      usage: { inputTokens: 100, outputTokens: 400, cachedReadTokens: 800, cachedWriteTokens: 100 },
      model: "claude-opus-5-5",
    });

    expect(reportOn(store).models.find(({ model }) => model === "claude-opus-5-5")).toMatchObject({ turns: 1, turnsWithTokens: 1, inputTokens: 100, outputTokens: 400, cachedReadTokens: 800, cachedWriteTokens: 100 });
  });

  test("tokens and speed per model, where speed is output tokens per second of the turn's time outside its tool calls", () => {
    const store = seededStore();
    write(store, "c1", 0, message);
    write(store, "c1", 5, started("t1", "Bash", "execute", { command: "bun test" }));
    write(store, "c1", 8, started("t2", "Read", "read", { file_path: "a.ts" }));
    write(store, "c1", 9, ended("t2", "completed"));
    write(store, "c1", 15, ended("t1", "completed"));
    const usage = { inputTokens: 100, outputTokens: 400, cachedReadTokens: 800, cachedWriteTokens: 100 };
    write(store, "c1", 30, { type: "turn-end", stopReason: "end_turn", usage, model: "claude-opus-5-5" });
    write(store, "c1", 40, message);
    write(store, "c1", 50, { type: "turn-end", stopReason: "end_turn", usage: { ...usage, outputTokens: 200 }, model: "claude-opus-5-5" });
    write(store, "c2", 60, message);
    write(store, "c2", 70, { type: "turn-end", stopReason: "end_turn" });

    const report = reportOn(store);
    expect(report.models).toEqual([
      {
        model: "claude-opus-5-5",
        turns: 2,
        turnsWithTokens: 2,
        inputTokens: 200,
        outputTokens: 600,
        cachedReadTokens: 1600,
        cachedWriteTokens: 200,
        cacheHitPercent: 80,
        outputTokensPerSecond: 20,
      },
      {
        model: "not reported",
        turns: 1,
        turnsWithTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        cachedReadTokens: 0,
        cachedWriteTokens: 0,
        cacheHitPercent: null,
        outputTokensPerSecond: null,
      },
    ]);
    expect(report.turns).toEqual({ count: 3, endedBy: { end_turn: 3 }, medianSeconds: 10, p90Seconds: 30, medianToolCalls: 0 });
    expect(report.totals).toMatchObject({ conversations: 2, turns: 3, inputTokens: 200, outputTokens: 600 });
    expect(report.days).toEqual([{ date: "2026-10-20", turns: 3, toolCalls: 2, failed: 0, outputTokens: 600 }]);
  });
});

describe("conversations", () => {
  test("the busiest of the period by turns, and those left untouched longest, of all time", () => {
    const store = seededStore();
    store.insertConversation(conversation("c3", "w1", "claude", "Never begun"));
    write(store, "c2", 0, message);
    write(store, "c2", 1, { type: "turn-end", stopReason: "end_turn" });
    write(store, "c1", 100, message);
    write(store, "c1", 101, { type: "turn-end", stopReason: "end_turn" });
    write(store, "c1", 102, message);
    write(store, "c1", 103, { type: "turn-end", stopReason: "end_turn" });

    const { conversations } = reportOn(store);
    expect(conversations!.busiest.map(({ title, turns }) => [title, turns])).toEqual([
      ["Fix the build", 2],
      ["Write docs", 1],
    ]);
    expect(conversations!.untouchedLongest).toEqual([
      { title: "Write docs", workspace: "other", profile: "opencode", lastActivity: "2026-10-20 10:00", idleDays: 11 },
      { title: "Fix the build", workspace: "project", profile: "Claude Code", lastActivity: "2026-10-20 10:01", idleDays: 11 },
    ]);
  });
});

describe("period and workspace", () => {
  test("only events in the period count, and a workspace named by name or folder narrows the report to it", () => {
    const store = seededStore();
    setSystemTime(new Date(2026, 8, 1));
    store.appendEvent("c1", message);
    store.appendEvent("c1", { type: "turn-end", stopReason: "end_turn" });
    write(store, "c1", 0, message);
    write(store, "c1", 1, { type: "turn-end", stopReason: "end_turn" });
    write(store, "c2", 2, message);
    write(store, "c2", 3, { type: "turn-end", stopReason: "end_turn" });

    expect(reportOn(store).turns.count).toBe(2);
    expect(reportOn(store, { since: "2026-09-01" }).turns.count).toBe(3);
    expect(reportOn(store, { since: "2026-09-01", until: "2026-09-01" }).turns.count).toBe(1);
    expect(reportOn(store, { workspace: "Project" })).toMatchObject({ workspace: "project", turns: { count: 1 } });
    expect(reportOn(store, { workspace: "/tmp/other" })).toMatchObject({ workspace: "other", turns: { count: 1 } });
    expect(() => reportOn(store, { workspace: "nowhere" })).toThrow('No workspace is called or kept in "nowhere". The workspaces: other, project.');
  });

  test("since and until take hours, days or weeks back, dates counted whole in local time, or times", () => {
    const now = new Date(2026, 9, 31, 12, 0, 0).getTime();
    expect(usagePeriod({}, now)).toEqual({ from: now - 30 * 86_400_000, to: now });
    expect(usagePeriod({ since: "12h" }, now).from).toBe(now - 12 * 3_600_000);
    expect(usagePeriod({ since: "2w" }, now).from).toBe(now - 14 * 86_400_000);
    expect(usagePeriod({ since: "2026-10-01", until: "2026-10-07" }, now)).toEqual({
      from: new Date(2026, 9, 1).getTime(),
      to: new Date(2026, 9, 8).getTime(),
    });
    expect(usagePeriod({ since: "2026-10-01T08:30:00Z" }, now).from).toBe(Date.UTC(2026, 9, 1, 8, 30));
    expect(() => usagePeriod({ since: "last month" }, now)).toThrow(UsageQueryError);
    expect(() => usagePeriod({ since: "2026-10-07", until: "2026-10-01" }, now)).toThrow("The period is empty");
  });
});

describe("what a report shows of the transcript", () => {
  test("secrets are masked: values named like keys or tokens, bearer tokens, and long random strings", () => {
    expect(masked("ANTHROPIC_API_KEY=sk-ant-abc123 bun test")).toBe("ANTHROPIC_API_KEY=••• bun test");
    expect(masked('curl -H "Authorization: Bearer eyJhbGciOi.abc" http://127.0.0.1:4600/auth?token=f00dbabe')).toBe(
      'curl -H "Authorization: Bearer •••" http://127.0.0.1:4600/auth?token=•••',
    );
    expect(masked("push ghp_1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c to origin")).toBe("push ••• to origin");
    expect(masked("cat /home/me/Projects/mirador/host/conversations.ts")).toBe("cat /home/me/Projects/mirador/host/conversations.ts");
  });

  test("failures that differ only in a number or a fence count as one reason", () => {
    expect(failureReason("```\nExit code 2\ngrep: x: No such file\n```")).toBe("exit code 2");
    expect(failureReason("There is no running process 1530918.")).toBe("There is no running process N.");
    expect(failureReason("StatusCode: non 2xx status code (403 GET https://example.com/a?b=1)")).toBe("StatusCode: non 2xx status code (403 GET <url>)");
    expect(failureReason("<tool_use_error>String to replace not found in file.\nString: foo</tool_use_error>")).toBe("String to replace not found in file.");
    expect(failureReason("")).toBe("no message");
  });

  test("failure reasons leave out the machines they name: user@host, IP addresses, hosts and domain names", () => {
    expect(failureReason("ssh: connect to host gpu-box port 22: Connection refused")).toBe("ssh: connect to host <host> port 22: Connection refused");
    expect(failureReason("Permission denied (publickey) for deploy@build-server.lan")).toBe("Permission denied (publickey) for <user@host>");
    expect(failureReason("connect ECONNREFUSED 10.0.0.12:443")).toBe("connect ECONNREFUSED <ip>:443");
    expect(failureReason("dial tcp [fe80::1]:53: i/o timeout")).toBe("dial tcp <ip>:53: i/o timeout");
    expect(failureReason("lookup 2001:db8::7334: no such host")).toBe("lookup <ip>: no such host");
    expect(failureReason("getaddrinfo ENOTFOUND api.internal.example.com")).toBe("getaddrinfo ENOTFOUND <host>");
    expect(failureReason("Could not resolve host: models")).toBe("Could not resolve host: <host>");
    expect(failureReason("Failed to connect to registry.npmjs.org port 443")).toBe("Failed to connect to <host> port 443");
    expect(failureReason("Cannot find module './foo.ts' at 12:30:45")).toBe("Cannot find module './foo.ts' at 12:30:45");
    expect(failureReason("the server was started without the vision encoder")).toBe("the server was started without the vision encoder");
  });

  test("without excerpts, a report leaves out samples, conversation titles and examples of calls", () => {
    const store = seededStore();
    write(store, "c1", 0, typed("Please fix the failing build now"));
    write(store, "c1", 1, started("t1", "Bash", "execute", { command: "bun test" }));
    write(store, "c1", 2, ended("t1", "failed", "Exit code 1"));
    write(store, "c1", 3, turnEnd);
    write(store, "c2", 0, message, (seconds) => new Date(2026, 8, 10, 10, 0, seconds));

    const report = reportOn(store, {}, { excerpts: false });
    expect(report).toMatchObject({ samples: null, conversations: null });
    expect(report.tools[0]).toMatchObject({ tool: "Bash", failed: 1, failureReasons: [{ reason: "exit code 1", calls: 1 }], failureExamples: [] });
    expect(report.findings.find(({ kind }) => kind === "idle-conversations")!.seen).toBe("One conversation has been left for 51 days.");
    expect(toolReportOn(store, { tool: "Bash" }, { excerpts: false }).tool).toMatchObject({ failed: 1, failureExamples: [], slowestCalls: [] });
  });
});

describe("turns and errors", () => {
  test("an error marked as failing its turn ends it; others end a turn only when it goes no further, so errors between turns and at a turn's start make none", () => {
    const store = seededStore();
    write(store, "c1", 0, { type: "error", message: "Could not resume the session: it is gone." });
    write(store, "c1", 10, message);
    write(store, "c1", 11, { type: "error", message: "Could not set Model to opus: unknown model" });
    write(store, "c1", 15, turnEnd);
    write(store, "c1", 20, message);
    write(store, "c1", 22, { type: "error", message: "API Error: 500", endsTurn: true });
    write(store, "c1", 30, message);
    write(store, "c1", 32, { type: "error", message: "Model server out of reach" });
    write(store, "c1", 40, message);
    write(store, "c1", 41, turnEnd);
    write(store, "c1", 50, message);
    write(store, "c1", 53, { type: "error", message: "Model server out of reach" });

    expect(reportOn(store).turns).toMatchObject({ count: 5, endedBy: { end_turn: 2, error: 3 }, medianSeconds: 2, p90Seconds: 5 });
  });
});

describe("reading the database", () => {
  test("a report reads a database it may not write to, while another connection holds the write lock", () => {
    const store = seededStore();
    write(store, "c1", 0, message);
    write(store, "c1", 1, turnEnd);
    const writer = new Database(store.path);
    writer.run("BEGIN IMMEDIATE");
    chmodSync(store.path, 0o444);
    try {
      expect(reportOn(store).turns.count).toBe(1);
    } finally {
      chmodSync(store.path, 0o644);
      writer.run("ROLLBACK");
      writer.close();
    }
  });

  test("a report reads a database whose -wal and -shm files are gone, as when sqlite3 closed it last, and leaves it as it was", () => {
    const store = seededStore();
    write(store, "c1", 0, message);
    write(store, "c1", 1, turnEnd);
    stores.splice(stores.indexOf(store), 1);
    store.close();
    const closer = new Database(store.path);
    closer.run("PRAGMA wal_checkpoint(TRUNCATE)");
    closer.close();
    for (const suffix of ["-wal", "-shm"]) rmSync(store.path + suffix, { force: true });
    const before = Bun.file(store.path).size;

    expect(reportOn(store).turns.count).toBe(1);
    expect(Bun.file(store.path).size).toBe(before);
    expect(existsSync(store.path)).toBe(true);
  });

  test("reports asked for together are each made, one after another, and a wrong one holds up none after it", async () => {
    const store = seededStore();
    write(store, "c1", 0, message);
    write(store, "c1", 1, turnEnd);

    const wrong = usageReportApart(store.path, { workspace: "nowhere", since: "3d" }, { now: NOW });
    const [, week, month] = await Promise.allSettled([wrong, usageReportApart(store.path, { since: "7d" }, { now: NOW }), usageReportApart(store.path, {}, { now: NOW })]);
    expect(week).toMatchObject({ status: "fulfilled" });
    expect(month).toMatchObject({ status: "fulfilled", value: reportOn(store) });
  });

  test("the host makes reports in a worker, gives the same request within a minute the same report, and fails a wrong query as one", async () => {
    const store = seededStore();
    write(store, "c1", 0, message);
    write(store, "c1", 1, started("t1", "Bash", "execute", { command: "bun test" }));
    write(store, "c1", 2, ended("t1", "failed", "Exit code 1"));
    write(store, "c1", 3, turnEnd);

    const report = usageReportApart(store.path, {}, { now: NOW });
    expect(usageReportApart(store.path, {}, { now: NOW })).toBe(report);
    expect(await report).toEqual(reportOn(store));
    expect(await toolReportApart(store.path, { tool: "bash" }, { now: NOW })).toEqual(toolReportOn(store, { tool: "bash" }));
    const wrong = usageReportApart(store.path, { workspace: "nowhere" }, { now: NOW });
    await expect(wrong).rejects.toBeInstanceOf(UsageQueryError);
    await expect(wrong).rejects.toThrow('No workspace is called or kept in "nowhere". The workspaces: other, project.');
  });
});

describe("profiles and the period before", () => {
  test("a conversation's events count for the profile it was on at the time, as each change names the one it left; before a change that doesn't, an earlier profile's", () => {
    const store = seededStore();
    store.saveProfile(profile("p1", "Work", "claude"));
    store.saveProfile(profile("p2", "Home", "claude"));
    store.insertConversation(conversation("c3", "w1", "claude", "Switches", "p2"));
    store.insertConversation(conversation("c4", "w1", "claude", "Switched before", "p1"));
    write(store, "c3", 0, message);
    write(store, "c3", 1, started("t1", "Bash", "execute", { command: "ls" }));
    write(store, "c3", 2, ended("t1", "completed"));
    write(store, "c3", 3, turnEnd);
    write(store, "c3", 10, { type: "profile-changed", profileName: "Home", from: { profileId: "p1", profileName: "Work", harness: "claude" } });
    write(store, "c3", 20, message);
    write(store, "c3", 21, turnEnd);
    write(store, "c4", 0, message);
    write(store, "c4", 1, turnEnd);
    write(store, "c4", 5, { type: "profile-changed", profileName: "Work" });
    write(store, "c4", 10, message);
    write(store, "c4", 11, turnEnd);

    const report = reportOn(store);
    expect(report.totals).toMatchObject({ conversations: 2, turns: 4 });
    expect(report.profiles.map(({ profile, agent, totals }) => [profile, agent, totals.conversations, totals.turns, totals.toolCalls])).toEqual([
      ["Work", "Claude Code", 2, 2, 1],
      ["Home", "Claude Code", 1, 1, 0],
      ["an earlier profile", "Claude Code", 1, 1, 0],
    ]);
    expect(report.conversations!.busiest.find(({ title }) => title === "Switches")).toMatchObject({ profile: "Home", turns: 2, toolCalls: 1 });
    expect(reportOn(store, { profile: "work" }).totals).toMatchObject({ conversations: 2, turns: 2, toolCalls: 1 });
    expect(reportOn(store, { until: "2026-10-20T10:00:05" }).profiles.map(({ profile }) => profile)).toEqual(["Work", "an earlier profile"]);
  });


  test("each profile gets its own numbers, a conversation without one goes by its agent, and a report narrows to one profile named in any case", () => {
    const store = seededStore();
    store.saveProfile(profile("p1", "Work", "claude"));
    store.insertConversation(conversation("c3", "w1", "claude", "Plan the release", "p1"));
    store.insertConversation(conversation("c4", "w1", "claude", "Old work", "gone"));
    write(store, "c1", 0, message);
    write(store, "c1", 1, started("t1", "Bash", "execute", { command: "ls" }));
    write(store, "c1", 2, ended("t1", "completed"));
    write(store, "c1", 3, { type: "turn-end", stopReason: "end_turn", model: "claude-opus-5-5" });
    write(store, "c3", 10, message);
    write(store, "c3", 11, started("r1", "Read", "read", { file_path: "a.ts" }));
    write(store, "c3", 12, ended("r1", "completed"));
    write(store, "c3", 13, started("r2", "Read", "read", { file_path: "b.ts" }));
    write(store, "c3", 14, ended("r2", "failed", "File does not exist."));
    write(store, "c3", 15, { type: "turn-end", stopReason: "end_turn", model: "claude-sonnet-5-5" });
    write(store, "c3", 20, message);
    write(store, "c3", 25, { type: "turn-end", stopReason: "end_turn", model: "claude-sonnet-5-5" });
    write(store, "c4", 30, message);
    write(store, "c4", 31, turnEnd);

    const report = reportOn(store);
    expect(report.profile).toBe("all profiles");
    expect(report.profiles.map(({ profile, agent, totals }) => [profile, agent, totals.turns])).toEqual([
      ["Work", "Claude Code", 2],
      ["Claude Code", "Claude Code", 1],
      ["a deleted profile", "Claude Code", 1],
    ]);
    expect(report.profiles[0]).toMatchObject({
      models: ["claude-sonnet-5-5"],
      totals: { conversations: 1, toolCalls: 2, failedCalls: 1, successPercent: 50 },
      before: null,
      tools: [{ tool: "Read", calls: 2, failed: 1, successPercent: 50, successPercentBefore: null }],
      failureReasons: [{ tool: "Read", reason: "File does not exist.", calls: 1 }],
    });
    expect(report.tools.find(({ tool }) => tool === "Read")!.profiles).toEqual(["Work"]);

    const narrowed = reportOn(store, { profile: "work" });
    expect(narrowed).toMatchObject({ profile: "Work", totals: { conversations: 1, turns: 2 } });
    expect(narrowed.profiles.map(({ profile }) => profile)).toEqual(["Work"]);
    expect(() => reportOn(store, { profile: "nobody" })).toThrow(
      new UsageQueryError('No profile is called "nobody". The profiles: a deleted profile, Claude Code, opencode, Work.'),
    );
  });

  test("asked to compare, the totals, profiles and tools also give their numbers for the same length of time before the period", () => {
    const store = seededStore();
    write(store, "c1", 0, message, september20);
    write(store, "c1", 1, started("t1", "Bash", "execute", { command: "bun test" }), september20);
    write(store, "c1", 2, ended("t1", "failed", "Exit code 1"), september20);
    write(store, "c1", 3, started("t2", "Bash", "execute", { command: "bun test" }), september20);
    write(store, "c1", 4, ended("t2", "completed"), september20);
    write(store, "c1", 5, turnEnd, september20);
    write(store, "c1", 0, message);
    write(store, "c1", 1, started("t3", "Bash", "execute", { command: "bun test" }));
    write(store, "c1", 2, ended("t3", "completed"));
    write(store, "c1", 3, turnEnd);

    const report = reportOn(store, { compare: true });
    expect(report.totals).toMatchObject({ turns: 1, toolCalls: 1, successPercent: 100 });
    expect(report.previousPeriod).toMatchObject({ from: "2026-09-01 12:00", to: "2026-10-01 12:00", totals: { turns: 1, toolCalls: 2, successPercent: 50 } });
    expect(report.tools[0]!.before).toEqual({ calls: 2, successPercent: 50 });
    expect(report.profiles[0]).toMatchObject({ before: { turns: 1, toolCalls: 2 }, tools: [{ tool: "Bash", successPercent: 100, successPercentBefore: 50 }] });
    expect(reportOn(store, { since: "2026-10-20", compare: true }).previousPeriod!.totals).toBeNull();

    const uncompared = reportOn(store);
    expect(uncompared.previousPeriod).toBeNull();
    expect(uncompared.tools[0]!.before).toBeNull();
    expect(uncompared.profiles[0]).toMatchObject({ before: null, tools: [{ tool: "Bash", successPercentBefore: null }] });
  });
});

describe("findings", () => {
  test("a tool the agent was told it doesn't have, and one that keeps failing, with a change that suits the failures", () => {
    const store = seededStore();
    write(store, "c2", 0, message);
    for (const index of [0, 1]) {
      write(store, "c2", 1 + index, started(`pet${index}`, "canvas_pet", "other"));
      write(store, "c2", 1 + index, ended(`pet${index}`, "failed", "Error: No tool named canvas_pet is available."));
    }
    for (const index of [0, 1, 2, 3, 4]) {
      write(store, "c2", 10 + index, started(`fetch${index}`, "webfetch", "fetch", { url: `https://site${index}.example/page` }));
      write(store, "c2", 10 + index, index === 4 ? ended(`fetch${index}`, "completed") : ended(`fetch${index}`, "failed", `StatusCode: non 2xx status code (403 GET https://site${index}.example/page)`));
    }
    write(store, "c2", 20, turnEnd);

    expect(reportOn(store).findings).toEqual([
      {
        kind: "missing-tool",
        profile: "opencode",
        tool: "canvas_pet",
        count: 2,
        seen: "opencode called canvas_pet 2 times and was told no such tool is available, last on 2026-10-20 10:00.",
        suggestion:
          "Find out why opencode doesn't get canvas_pet: a plugin not installed or not offered to this agent, a tool loaded only on demand, or an old name the agent remembers.",
      },
      {
        kind: "failing-tool",
        profile: "opencode",
        tool: "webfetch",
        count: 4,
        seen: "webfetch failed 4 of 5 calls in opencode (20% succeeded), most often with: StatusCode: non 2xx status code (403 GET <url>).",
        suggestion: "The sites refused the requests (HTTP 403 and the like), so retrying won't help: a browser tool gets further on such sites.",
      },
    ]);
  });

  test("turns that keep ending in the same error", () => {
    const store = seededStore();
    for (const index of [0, 1, 2, 3]) {
      write(store, "c2", index * 10, message);
      write(store, "c2", index * 10 + 1, index === 3 ? turnEnd : { type: "error", message: "this server was started without the vision encoder" });
    }
    expect(reportOn(store).findings).toEqual([
      {
        kind: "turn-errors",
        profile: "opencode",
        count: 3,
        seen: "3 of opencode's 4 turns ended in an error, all with: this server was started without the vision encoder.",
        suggestion: "Errors that share a cause, such as a model server out of reach, have one fix: deal with the most frequent first.",
      },
    ]);
  });

  test("asked to compare, a profile whose calls succeed less often, or whose turns take longer, than in the period before", () => {
    const store = seededStore();
    for (let index = 0; index < 20; index++) {
      write(store, "c1", index * 30, message, september20);
      write(store, "c1", index * 30 + 1, started(`before${index}`, "Bash", "execute", { command: "bun test" }), september20);
      write(store, "c1", index * 30 + 2, ended(`before${index}`, "completed"), september20);
      write(store, "c1", index * 30 + 10, turnEnd, september20);
      write(store, "c1", index * 30, message);
      write(store, "c1", index * 30 + 1, started(`now${index}`, "Bash", "execute", { command: "bun test" }));
      write(store, "c1", index * 30 + 2, index < 5 ? ended(`now${index}`, "failed", "Exit code 1") : ended(`now${index}`, "completed"));
      write(store, "c1", index * 30 + 20, turnEnd);
    }
    expect(reportOn(store).findings.map(({ kind }) => kind)).toEqual(["failing-tool"]);
    expect(reportOn(store, { compare: true }).findings.map(({ kind, tool, count, seen }) => ({ kind, tool, count, seen }))).toEqual([
      { kind: "failing-tool", tool: "Bash", count: 5, seen: "Bash failed 5 of 20 calls in Claude Code (75% succeeded), most often with: exit code 1." },
      { kind: "got-worse", tool: undefined, count: 20, seen: "Claude Code's turns took 20 s (median), up from 10 s in the period before." },
      { kind: "got-worse", tool: undefined, count: 5, seen: "Claude Code's tool calls succeeded 75% of the time, down from 100% in the period before." },
      { kind: "got-worse", tool: "Bash", count: 5, seen: "Bash in Claude Code succeeded 75% of the time, down from 100% in the period before." },
    ]);
  });

  test("conversations left for two weeks or more", () => {
    const store = seededStore();
    write(store, "c2", 0, message, (seconds) => new Date(2026, 8, 10, 10, 0, seconds));
    write(store, "c1", 0, message);
    expect(reportOn(store).findings).toEqual([
      {
        kind: "idle-conversations",
        count: 1,
        seen: 'One conversation has been left for two weeks or more: "Write docs", for 51 days.',
        suggestion: "Finish or delete it, so the list shows what you're working on.",
      },
    ]);
  });
});

describe("where tools come from", () => {
  test("the agent itself, Mirador's canvas, a canvas plugin by its title, or another MCP server", () => {
    const plugins = { review: "Code review" };
    expect(sourceOf("Bash", plugins)).toBe("the agent's own tools");
    expect(sourceOf("mcp__canvas__show", plugins)).toBe("Mirador canvas");
    expect(sourceOf("canvas_ask", plugins)).toBe("Mirador canvas");
    expect(sourceOf("mcp__canvas__plugin_install", plugins)).toBe("Mirador canvas");
    expect(sourceOf("mcp__canvas__review", plugins)).toBe("Code review plugin");
    expect(sourceOf("canvas_review", plugins)).toBe("Code review plugin");
    expect(sourceOf("mcp__canvas__gone", plugins)).toBe("canvas plugins no longer installed");
    expect(sourceOf("mcp__canvas__review", null)).toBe("canvas plugins");
    expect(sourceOf("mcp__github__create_issue", plugins)).toBe("MCP server github");
  });

  test("each source's share of the calls, its failures and its tools", () => {
    const store = seededStore();
    write(store, "c1", 0, message);
    const calls: [string, "completed" | "failed"][] = [
      ["Bash", "completed"],
      ["Bash", "failed"],
      ["Read", "completed"],
      ["mcp__canvas__show", "completed"],
      ["mcp__canvas__review", "completed"],
    ];
    for (const [index, [tool, status]] of calls.entries()) {
      write(store, "c1", index + 1, started(`t${index}`, tool, "other"));
      write(store, "c1", index + 1, ended(`t${index}`, status, status === "failed" ? "Exit code 1" : undefined));
    }
    write(store, "c1", 10, turnEnd);
    write(store, "c2", 20, message);
    write(store, "c2", 21, started("o1", "canvas_show", "other"));
    write(store, "c2", 21, ended("o1", "completed"));
    write(store, "c2", 22, turnEnd);

    expect(reportOn(store, {}, { pluginTools: { review: "Code review" } }).sources).toEqual([
      {
        source: "the agent's own tools",
        calls: 3,
        sharePercent: 50,
        failed: 1,
        tools: [
          { tool: "Bash", calls: 2 },
          { tool: "Read", calls: 1 },
        ],
      },
      {
        source: "Mirador canvas",
        calls: 2,
        sharePercent: 33.3,
        failed: 0,
        tools: [
          { tool: "mcp__canvas__show", calls: 1 },
          { tool: "canvas_show", calls: 1 },
        ],
      },
      { source: "Code review plugin", calls: 1, sharePercent: 16.7, failed: 0, tools: [{ tool: "mcp__canvas__review", calls: 1 }] },
    ]);
  });
});

describe("how the user responds, and what they and the agents ask", () => {
  const ask = (toolCallId: string, rawInput: Record<string, unknown>) => started(toolCallId, "mcp__canvas__ask", "other", rawInput);
  const TIMED_OUT = "MCP error -32001: Request timed out";

  function conversationWithQuestions() {
    const store = seededStore();
    write(store, "c1", 0, typed("Please fix the flaky login test"));
    write(store, "c1", 1, ask("q1", { question: "Which approach do you prefer?" }));
    write(store, "c1", 61, ended("q1", "completed"));
    write(store, "c1", 62, ask("q2", { questions: [{ question: "Ship it now?" }, { question: "Which name?" }] }));
    write(store, "c1", 662, ended("q2", "completed"));
    write(store, "c1", 663, ask("q3", { question: "Still there?" }));
    write(store, "c1", 700, ended("q3", "failed", TIMED_OUT));
    write(store, "c1", 701, ask("q4", { question: "Hello?" }));
    write(store, "c1", 800, ended("q4", "failed", TIMED_OUT));
    write(store, "c1", 801, turnEnd);
    write(store, "c1", 801, typed("and add a test for it"));
    write(store, "c1", 830, turnEnd);
    write(store, "c1", 950, typed("Now update the docs too please"));
    write(store, "c1", 960, turnEnd);
    write(store, "c1", 8160, message);
    write(store, "c1", 8170, turnEnd);
    write(store, "c1", 8171, { type: "user-message", text: "Run the nightly check now", fromScript: true });
    write(store, "c1", 8180, turnEnd);
    write(store, "c1", 9000, typed("Please fix the flaky login test"));
    write(store, "c1", 9010, turnEnd);
    return store;
  }

  test("replies within an hour of a turn's end count, queued ones don't, later ones count as coming back; and how long questions waited", () => {
    const report = reportOn(conversationWithQuestions());
    expect(report.responses).toEqual({
      afterTurns: { replies: 2, medianSeconds: 120, p90Seconds: 820, cameBackLater: 1 },
      toQuestions: { asked: 4, answered: 2, medianSeconds: 60, p90Seconds: 600, timedOut: 2 },
    });
    expect(report.totals.medianReplySeconds).toBe(120);
    expect(report.findings).toEqual([
      {
        kind: "waiting-questions",
        profile: "Claude Code",
        count: 4,
        seen: "Claude Code asked you 4 questions, which waited 1 min for your answer (median); 2 timed out.",
        suggestion:
          'Where you answer later, set the profile or conversation to "My answer is sent as the next message": the agent then ends its turn instead of waiting, and nothing times out.',
      },
    ]);
  });

  test("samples hold the requests the user typed of four words or more, once each, and every question the agents asked", () => {
    const { samples } = reportOn(conversationWithQuestions());
    expect(samples!.yourRequests).toEqual({
      total: 3,
      shown: [
        { text: "Please fix the flaky login test", profile: "Claude Code", at: "2026-10-20 10:00" },
        { text: "and add a test for it", profile: "Claude Code", at: "2026-10-20 10:13" },
        { text: "Now update the docs too please", profile: "Claude Code", at: "2026-10-20 10:15" },
      ],
    });
    expect(samples!.agentQuestions).toEqual({
      total: 5,
      shown: [
        { question: "Which approach do you prefer?", profile: "Claude Code", waitedSeconds: 60, at: "2026-10-20 10:00" },
        { question: "Ship it now?", profile: "Claude Code", waitedSeconds: 600, at: "2026-10-20 10:01" },
        { question: "Which name?", profile: "Claude Code", waitedSeconds: 600, at: "2026-10-20 10:01" },
        { question: "Still there?", profile: "Claude Code", waitedSeconds: null, at: "2026-10-20 10:11" },
        { question: "Hello?", profile: "Claude Code", waitedSeconds: null, at: "2026-10-20 10:11" },
      ],
    });
  });
});
