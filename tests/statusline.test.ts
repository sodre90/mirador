import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionConfigOption } from "@agentclientprotocol/sdk/unstable";
import { chosenModel } from "../shared/config-options.ts";
import type { Conversation } from "../shared/model.ts";
import { claudeTranscriptPath, runStatusLineCommand, statusLineCommandIn, statuslineInput } from "../host/statusline.ts";

const modelOption: SessionConfigOption = {
  id: "model",
  name: "Model",
  category: "model",
  type: "select",
  currentValue: "opus",
  options: [{ group: "anthropic", name: "Anthropic", options: [{ value: "opus", name: "Opus 5.5" }] }],
};

const conversation: Conversation = {
  id: "c1",
  workspaceId: "w1",
  harness: "claude",
  profileId: null,
  title: "t",
  titleSetByUser: false,
  acpSessionId: "s1",
  askMode: "wait",
  bypassPermissions: false,
  status: "idle",
  statusDetail: null,
  openInTerminal: null,
  contextUsage: { used: 86_000, size: 200_000, cost: { amount: 0.25, currency: "USD" } },
  queuedMessages: [],
  usageLimit: null,
  jobWaits: [],
  asyncTasks: [],
  waitingFor: null,
  pendingRequest: null,
  lastWords: null,
  activity: null,
  configOptions: [modelOption],
  position: 0,
  createdAt: 1_000,
  updatedAt: 1_000,
};

const configDirWith = (settings: unknown) => {
  const directory = mkdtempSync(join(tmpdir(), "mirador-statusline-"));
  writeFileSync(join(directory, "settings.json"), JSON.stringify(settings));
  return directory;
};

const isRunning = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const run = (command: string) => runStatusLineCommand(command, { input: { hello: "world" }, directory: tmpdir(), environment: { PATH: process.env.PATH! }, columns: 42 });

describe("statusline", () => {
  test("the command comes from Claude Code's statusLine setting", async () => {
    expect(await statusLineCommandIn(configDirWith({ statusLine: { type: "command", command: "~/.claude/statusline.sh" } }))).toBe("~/.claude/statusline.sh");
    expect(await statusLineCommandIn(configDirWith({ statusLine: { type: "static" } }))).toBeNull();
    expect(await statusLineCommandIn(configDirWith({}))).toBeNull();
    expect(await statusLineCommandIn(join(tmpdir(), "no-such-claude-config"))).toBeNull();
  });

  test("the transcript lives in a directory named after the project path", () => {
    expect(claudeTranscriptPath("/home/me/.claude", "/Users/me/.dotfiles/my_app", "s1")).toBe(
      join("/home/me/.claude", "projects", "-Users-me--dotfiles-my-app", "s1.jsonl"),
    );
  });

  test("Copilot's credits are no dollars in the cost", () => {
    const credited = { ...conversation, contextUsage: { used: 1, size: 2, cost: null, credits: 4.5 } };
    expect(statuslineInput(credited, "/work", null, null, 0).cost.total_cost_usd).toBe(0);
  });

  test("the input carries what Claude Code's statusline scripts read", () => {
    const input = statuslineInput(conversation, "/work", "/t.jsonl", null, 61_000);
    expect(input).toMatchObject({
      session_id: "s1",
      transcript_path: "/t.jsonl",
      cwd: "/work",
      model: { id: "opus", display_name: "Opus 5.5" },
      cost: { total_cost_usd: 0.25, total_duration_ms: 60_000 },
      context_window: {
        context_window_size: 200_000,
        used_percentage: 43,
        remaining_percentage: 57,
        current_usage: { input_tokens: 86_000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
    });
    expect(statuslineInput({ ...conversation, contextUsage: null }, "/work", null, null, 0).context_window.current_usage).toBeNull();
    expect(input).not.toHaveProperty("rate_limits");
  });

  test("the plan's usage limits reach the command as Claude Code's rate_limits, with only the windows known", () => {
    const quotas = { fiveHour: { usedPercent: 37, resetsAt: 1_791_149_400_000 }, sevenDay: null };
    expect(statuslineInput(conversation, "/work", null, quotas, 0).rate_limits).toEqual({ five_hour: { used_percentage: 37, resets_at: 1_791_149_400 } });
  });

  test("the command reads the input on stdin and sees the width in COLUMNS", async () => {
    expect(await run(`printf '\\033[1m%s\\033[0m %s\\n\\n' "$(cat)" "$COLUMNS"`)).toEqual({ output: '\x1b[1m{"hello":"world"}\x1b[0m 42' });
  });

  test("a failing command reports its exit code and first error line", async () => {
    expect(await run("echo 'no jq here' >&2; exit 3")).toEqual({
      error: "The statusline command exited with 3: no jq here",
      errorAbout: { code: "statusline-exited", exitCode: 3, firstError: "no jq here" },
    });
  });

  test("a background job left holding the output does not hold up the statusline", async () => {
    const started = Date.now();
    expect(await run("(sleep 3) & echo ready")).toEqual({ output: "ready" });
    expect(Date.now() - started).toBeLessThan(1_500);
  });

  test("a command that runs too long is stopped, with what it started", async () => {
    const directory = mkdtempSync(join(tmpdir(), "mirador-statusline-slow-"));
    const slowProgram = `"${process.execPath}" -e "require('fs').writeFileSync('pid', String(process.pid)); setTimeout(() => {}, 30000)"`;
    const environment = { PATH: process.env.PATH! };
    const result = await runStatusLineCommand(`${slowProgram}; echo after`, { input: {}, directory, environment, columns: 42, timeoutMs: 3_000 });
    expect(result).toEqual({ error: "The statusline command took longer than 3 s and was stopped.", errorAbout: { code: "statusline-timed-out", seconds: 3 } });
    const program = Number(readFileSync(join(directory, "pid"), "utf8"));
    const deadline = Date.now() + 2_000;
    while (isRunning(program) && Date.now() < deadline) await Bun.sleep(20);
    expect(isRunning(program)).toBe(false);
  });

  test("the model shown is the chosen option's name", () => {
    expect(chosenModel([modelOption])).toEqual({ id: "opus", name: "Opus 5.5", multiplier: null });
    expect(chosenModel([])).toBeNull();
  });

  test("a model that Copilot prices carries its multiplier, and a malformed one is ignored", () => {
    const priced = (copilotUsage: unknown): SessionConfigOption => ({
      ...modelOption,
      options: [{ value: "opus", name: "Opus 5.5", _meta: { copilotUsage } }],
    });
    expect(chosenModel([priced("15x")])).toEqual({ id: "opus", name: "Opus 5.5", multiplier: "15x" });
    expect(chosenModel([priced("0.33x")])?.multiplier).toBe("0.33x");
    expect(chosenModel([priced("lots")])?.multiplier).toBeNull();
    expect(chosenModel([priced(15)])?.multiplier).toBeNull();
  });
});
