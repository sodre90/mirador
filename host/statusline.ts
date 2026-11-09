import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { chosenModel } from "../shared/config-options.ts";
import { harnessLabels, type Conversation, type PlanQuotas, type QuotaWindow, type StatuslineRender } from "../shared/model.ts";
import { profileEnvironment } from "./acp/harnesses.ts";
import type { ConversationService } from "./conversations.ts";
import type { Store } from "./store.ts";
import { claudeConfigDir } from "./terminal-sessions.ts";
import { commandLine, commandShell } from "./command-shell.ts";
import { killProcessTree } from "./windows-processes.ts";
import { englishProblem, HostProblemError, type HostProblem } from "../shared/host-problems.ts";
import { workingCopyOf } from "./worktrees.ts";

const COMMAND_TIMEOUT_MS = 5_000;
/** A command may leave a background job holding its output open; what it printed before exiting is what counts. */
const LATE_OUTPUT_GRACE_MS = 100;
const GIT_TIMEOUT_MS = 2_000;
const MIN_COLUMNS = 20;
const MAX_COLUMNS = 500;

export async function statusLineCommandIn(configDir: string): Promise<string | null> {
  try {
    const { statusLine } = JSON.parse(await readFile(join(configDir, "settings.json"), "utf8"));
    const command = statusLine?.type === "command" ? statusLine.command : null;
    return typeof command === "string" && command.trim() ? command : null;
  } catch {
    return null;
  }
}

/** Claude Code keeps a session's transcript under a directory named after the project path, with every character but letters and digits turned into "-". */
export const claudeTranscriptPath = (configDir: string, directory: string, sessionId: string) => {
  const canonical = (() => {
    try {
      return realpathSync(directory);
    } catch {
      return directory;
    }
  })();
  return join(configDir, "projects", canonical.replace(/[^a-zA-Z0-9]/g, "-"), `${sessionId}.jsonl`);
};

const rateLimitWindow = ({ usedPercent, resetsAt }: QuotaWindow) => ({ used_percentage: usedPercent, resets_at: Math.floor(resetsAt / 1000) });

/** Claude Code's `rate_limits`, with only the windows it knows. */
const rateLimits = ({ fiveHour, sevenDay }: PlanQuotas) => ({
  ...(fiveHour && { five_hour: rateLimitWindow(fiveHour) }),
  ...(sevenDay && { seven_day: rateLimitWindow(sevenDay) }),
});

/** The JSON Claude Code feeds its statusline command, as far as the app knows the same facts. */
export function statuslineInput(conversation: Conversation, directory: string, transcriptPath: string | null, quotas: PlanQuotas | null, now: number) {
  const usage = conversation.contextUsage;
  const usedPercentage = usage && usage.size > 0 ? Math.round((usage.used / usage.size) * 100) : null;
  const model = chosenModel(conversation.configOptions);
  return {
    hook_event_name: "Status",
    session_id: conversation.acpSessionId,
    transcript_path: transcriptPath,
    cwd: directory,
    model: { id: model?.id ?? conversation.harness, display_name: model?.name ?? harnessLabels[conversation.harness] },
    workspace: { current_dir: directory, project_dir: directory },
    version: "mirador",
    output_style: { name: "default" },
    cost: {
      total_cost_usd: usage?.cost?.currency === "USD" ? usage.cost.amount : 0,
      total_duration_ms: now - conversation.createdAt,
      total_api_duration_ms: 0,
      total_lines_added: 0,
      total_lines_removed: 0,
    },
    context_window: {
      context_window_size: usage?.size ?? null,
      used_percentage: usedPercentage,
      remaining_percentage: usedPercentage === null ? null : 100 - usedPercentage,
      current_usage: usage ? { input_tokens: usage.used, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } : null,
    },
    exceeds_200k_tokens: (usage?.used ?? 0) > 200_000,
    ...(quotas && { rate_limits: rateLimits(quotas) }),
  };
}

function collectText(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  const finished = (async () => {
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) text += decoder.decode(chunk.value, { stream: true });
  })().catch(() => {});
  return { finished, text: () => text, stop: () => reader.cancel().catch(() => {}) };
}

function killProcessGroup(pid: number) {
  if (process.platform === "win32") return void killProcessTree(pid);
  try {
    process.kill(-pid, "SIGKILL");
  } catch {}
}

export type CommandResult = { output: string } | { error: string; errorAbout: HostProblem };

export async function runStatusLineCommand(
  command: string,
  {
    input,
    directory,
    environment,
    columns,
    timeoutMs = COMMAND_TIMEOUT_MS,
  }: { input: unknown; directory: string; environment: Record<string, string>; columns: number; timeoutMs?: number },
): Promise<CommandResult> {
  const child = Bun.spawn(commandLine(commandShell(() => "sh", environment), command), {
    cwd: directory,
    env: { ...environment, COLUMNS: String(columns), TERM: "xterm-256color", COLORTERM: "truecolor" },
    stdin: new Blob([JSON.stringify(input)]),
    stdout: "pipe",
    stderr: "pipe",
    // Without a controlling terminal, what the command writes to /dev/tty goes nowhere instead of into the terminal the host was started from.
    detached: true,
  });
  const [output, errors] = [collectText(child.stdout), collectText(child.stderr)];
  const exitedInTime = await Promise.race([child.exited.then(() => true), Bun.sleep(timeoutMs).then(() => false)]);
  if (!exitedInTime) killProcessGroup(child.pid);
  await Promise.race([Promise.all([output.finished, errors.finished]), Bun.sleep(LATE_OUTPUT_GRACE_MS)]);
  output.stop();
  errors.stop();
  if (!exitedInTime) return commandError({ code: "statusline-timed-out", seconds: timeoutMs / 1000 });
  if (child.exitCode !== 0) {
    const firstError = errors.text().trim().split("\n")[0];
    return commandError({ code: "statusline-exited", exitCode: child.exitCode ?? -1, firstError: firstError ?? "" });
  }
  return { output: output.text().replace(/\n+$/, "") };
}

export async function currentGitBranch(directory: string): Promise<string | null> {
  try {
    const git = Bun.spawn(["git", "-C", directory, "branch", "--show-current"], { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
    const timer = setTimeout(() => git.kill(), GIT_TIMEOUT_MS);
    const [branch, exitCode] = await Promise.all([new Response(git.stdout).text(), git.exited]);
    clearTimeout(timer);
    return exitCode === 0 ? branch.trim() || null : null;
  } catch {
    return null;
  }
}

const commandError = (problem: HostProblem): CommandResult => ({ error: englishProblem(problem), errorAbout: problem });

const clampColumns = (columns: number) => Math.min(MAX_COLUMNS, Math.max(MIN_COLUMNS, Math.floor(columns) || MIN_COLUMNS));

export class StatuslineService {
  constructor(
    private readonly store: Store,
    private readonly conversations: ConversationService,
    /** Test hosts share the user's home directory, so they must not run the user's own statusline. */
    private readonly runsUserCommands: boolean,
  ) {}

  async render(conversationId: string, columns: number, runCommand: boolean): Promise<StatuslineRender> {
    const conversation = this.conversations.get(conversationId);
    const workspace = this.store.findWorkspace(conversation.workspaceId);
    if (!workspace) throw new HostProblemError({ code: "unknown-workspace", id: conversation.workspaceId });
    const directory = workingCopyOf(workspace, conversation).path;
    const now = Date.now();
    const quotas = this.conversations.planQuotasOf(conversationId, now);
    const environment = this.environmentOf(conversation);
    const configDir = environment && claudeConfigDir(environment);
    const runsClaudeCode = conversation.harness === "claude";
    const [gitBranch, command] = await Promise.all([
      currentGitBranch(directory),
      configDir && this.runsUserCommands && runsClaudeCode ? statusLineCommandIn(configDir) : null,
    ]);
    if (!command || !configDir || !environment || !runCommand) return { gitBranch, command, output: null, error: null, quotas };
    const transcriptPath = conversation.acpSessionId ? claudeTranscriptPath(configDir, directory, conversation.acpSessionId) : null;
    const result = await runStatusLineCommand(command, {
      input: statuslineInput(conversation, directory, transcriptPath, quotas, now),
      directory,
      environment,
      columns: clampColumns(columns),
    });
    return "output" in result
      ? { gitBranch, command, output: result.output, error: null, quotas }
      : { gitBranch, command, output: null, error: result.error, errorAbout: result.errorAbout, quotas };
  }

  /** A profile whose environment does not parse cannot run anything; its conversation says why elsewhere. */
  private environmentOf(conversation: Conversation) {
    const profile = conversation.profileId === null ? null : (this.store.findProfile(conversation.profileId) ?? null);
    try {
      return profileEnvironment(profile);
    } catch {
      return null;
    }
  }
}
