import type { PermissionOptionKind, StopReason, ToolCallUpdate } from "@agentclientprotocol/sdk/unstable";
import { askModeLabels, harnessLabels, type ConversationEvent, type HarnessId, type StoredEvent, type TurnUsage } from "../shared/model.ts";
import { toolNameOf } from "../shared/tool-title.ts";
import { PLUGIN_INSTALL_TOOL } from "./canvas/guidance.ts";
import { BUILT_IN_CANVAS_TOOLS, canvasToolName } from "./canvas/tool-names.ts";
import type { UsageConversation, UsageData, UsageWorkspace } from "./usage-data.ts";

/** What a report covers; every field may be left out. */
export interface UsageQuery {
  /** How far back: `7d`, `12h`, `2w`, or a date or time such as `2026-10-01`. Thirty days when left out. */
  since?: string;
  /** Until when, a date or time; a date counts whole. Now when left out. */
  until?: string;
  /** A workspace's name or folder; every workspace when left out or `all`. */
  workspace?: string;
  /** A profile's name; every profile when left out or `all`. */
  profile?: string;
  /** Also count the same length of time before the period, to compare with. It doubles the events read. */
  compare?: boolean;
}

export interface ReportOptions {
  now?: number;
  /** The plugin each plugin tool comes from; without it, plugin tools count as canvas plugins. */
  pluginTools?: PluginToolTitles | null;
  /** Quote the user's work: samples of requests and questions, conversation titles, and examples of calls. On unless false. */
  excerpts?: boolean;
}

/** The title of the canvas plugin each plugin tool comes from, by the tool's name. */
export type PluginToolTitles = Record<string, string>;

export type ToolCallOutcome = "succeeded" | "failed" | "denied" | "cancelled";

export interface UsageReport {
  period: { from: string; to: string };
  workspace: string;
  profile: string;
  definitions: Record<string, string>;
  totals: Totals;
  /** When asked to compare. */
  previousPeriod: { from: string; to: string; totals: Totals | null } | null;
  findings: Finding[];
  profiles: ProfileUsage[];
  tools: ToolUsage[];
  otherTools: { tools: number; calls: number } | null;
  sources: SourceUsage[];
  permissions: PermissionUsage;
  responses: ResponseTimes;
  turns: TurnStats;
  models: ModelUsage[];
  days: DayUsage[];
  /** Left out with the excerpts, as the titles quote the user's work. */
  conversations: { busiest: BusyConversation[]; untouchedLongest: UntouchedConversation[] } | null;
  /** Left out with the excerpts. */
  samples: UsageSamples | null;
}

/** One tool looked into: its calls by profile, more of its failures, and its slowest calls. */
export interface ToolReport {
  period: { from: string; to: string };
  workspace: string;
  profile: string;
  definitions: Record<string, string>;
  tool: ToolDetail;
  findings: Finding[];
}

export interface Totals {
  conversations: number;
  turns: number;
  toolCalls: number;
  failedCalls: number;
  successPercent: number | null;
  permissionPrompts: number;
  medianTurnSeconds: number | null;
  medianReplySeconds: number | null;
  inputTokens: number;
  outputTokens: number;
  cachedReadTokens: number;
  cachedWriteTokens: number;
  outputTokensPerSecond: number | null;
}

export type FindingKind = "allow-always" | "missing-tool" | "failing-tool" | "waiting-questions" | "turn-errors" | "got-worse" | "idle-conversations";

export interface Finding {
  kind: FindingKind;
  /** What the numbers show. */
  seen: string;
  /** A change worth trying. */
  suggestion: string;
  profile?: string;
  tool?: string;
  /** How many calls, prompts, turns or conversations it is about; findings of a kind are ranked by it. */
  count: number;
}

export interface ProfileUsage {
  profile: string;
  agent: string;
  models: string[];
  totals: Totals;
  /** Its totals in the previous period, when it was used then. */
  before: Totals | null;
  tools: { tool: string; calls: number; failed: number; successPercent: number | null; successPercentBefore: number | null }[];
  failureReasons: { tool: string; reason: string; calls: number }[];
}

export interface ToolUsage {
  tool: string;
  kind: string;
  source: string;
  profiles: string[];
  calls: number;
  succeeded: number;
  failed: number;
  denied: number;
  cancelled: number;
  successPercent: number | null;
  /** Its calls and success in the previous period, when it was called then. */
  before: { calls: number; successPercent: number | null } | null;
  bySubagents: number;
  medianSeconds: number | null;
  p90Seconds: number | null;
  failureReasons: { reason: string; calls: number }[];
  failureExamples: { input: string; result: string; at: string }[];
}

export interface ToolDetail extends ToolUsage {
  byProfile: { profile: string; calls: number; failed: number; successPercent: number | null }[];
  slowestCalls: { input: string; seconds: number; at: string }[];
}

export interface SourceUsage {
  source: string;
  calls: number;
  sharePercent: number;
  failed: number;
  tools: { tool: string; calls: number }[];
}

export interface PermissionUsage {
  asked: number;
  allowedOnce: number;
  allowedAlways: number;
  rejected: number;
  unanswered: number;
  medianSecondsToAnswer: number | null;
  allowedOnceRepeatedly: { profile: string; tool: string; command?: string; times: number }[];
}

export interface ResponseTimes {
  afterTurns: { replies: number; medianSeconds: number | null; p90Seconds: number | null; cameBackLater: number };
  toQuestions: { asked: number; answered: number; medianSeconds: number | null; p90Seconds: number | null; timedOut: number };
}

export interface TurnStats {
  count: number;
  endedBy: Partial<Record<StopReason | "error", number>>;
  medianSeconds: number | null;
  p90Seconds: number | null;
  medianToolCalls: number | null;
}

export interface ModelUsage {
  model: string;
  turns: number;
  turnsWithTokens: number;
  inputTokens: number;
  outputTokens: number;
  cachedReadTokens: number;
  cachedWriteTokens: number;
  cacheHitPercent: number | null;
  outputTokensPerSecond: number | null;
}

export interface DayUsage {
  date: string;
  turns: number;
  toolCalls: number;
  failed: number;
  outputTokens: number;
}

export interface BusyConversation {
  title: string;
  workspace: string;
  profile: string;
  turns: number;
  toolCalls: number;
  lastActivity: string;
}

export interface UntouchedConversation {
  title: string;
  workspace: string;
  profile: string;
  lastActivity: string;
  idleDays: number;
}

export interface UsageSamples {
  yourRequests: { total: number; shown: { text: string; profile: string; at: string }[] };
  agentQuestions: { total: number; shown: { question: string; profile: string; waitedSeconds: number | null; at: string }[] };
}

export const USAGE_DEFINITIONS = {
  outcomes:
    "succeeded: the tool finished. failed: it reported an error, such as a command's non-zero exit code. denied: the user or a permission rule refused it. cancelled: its turn stopped before it finished.",
  successPercent: "succeeded / (succeeded + failed) × 100. Denied and cancelled calls are left out: they show the user's choices, not how well the tool works.",
  seconds:
    "A tool call's time runs from the agent starting it to its end, so it includes waiting for a permission or for the user's answer; denied and cancelled calls are left out. A turn's runs from the user's message to the agent's last word.",
  profiles:
    "The profile a conversation ran on at the time, as it can change profile; one without a profile goes by its agent's name. \"an earlier profile\": one a conversation left before Mirador noted which profile it left.",
  previousPeriod: "With compare: the same length of time just before the period, and each number's value then (before), to tell whether things got better.",
  findings:
    "What Mirador's fixed rules noticed: what was seen, and a change worth trying. Ranked by kind, from turns ending in errors and missing or failing tools to idle conversations, then by how many turns, calls or prompts each concerns. Explain them to the user, and check the evidence before acting on one.",
  sources: "Where the tools called come from: the agent's own tools, Mirador's canvas, each canvas plugin, and other MCP servers. sharePercent is of all tool calls.",
  replies:
    "responses.afterTurns and medianReplySeconds: from a turn's end to the user's next message in that conversation, when it came within an hour; later ones count as cameBackLater. Messages sent within a second of the end, queued ones, are left out.",
  questions: "responses.toQuestions: how long the agents' questions, asked with Mirador's ask tool, waited for the user's answer.",
  tokens: "As the agent reports them when each turn ends; Claude Code does, other agents may not (turnsWithTokens counts the turns that did). inputTokens leaves out the cached tokens.",
  cacheHitPercent: "cachedReadTokens / (inputTokens + cachedReadTokens + cachedWriteTokens) × 100.",
  outputTokensPerSecond:
    "Output tokens per second of model time, the turn's time outside its tool calls. It includes waiting for each answer to begin, so it is below the model's raw speed.",
  allowedOnceRepeatedly: "Tools, and the commands of command-line tools, the user allowed once three times or more: candidates for allowing always.",
  samples:
    "Up to 20 of each, spread over the period, shortened and with secrets masked: requests the user typed to start a turn (four words or more), and questions agents asked with the ask tool. For grouping by kind; total says how many there were.",
  excerpts: "Samples, conversation titles and examples of calls quote the user's work, so a report the usage_stats tool gives beyond its caller's workspace leaves them out.",
  times: "Local time of the machine Mirador runs on.",
};

const TOP_TOOLS = 25;
const TOP_TOOLS_OF_PROFILE = 8;
const EXAMPLES = 3;
const EXAMPLES_FOR_ONE_TOOL = 10;
const REPEATED_ALLOWANCE = 3;
const LISTED_CONVERSATIONS = 5;
const SAMPLES = 20;
const MOST_FINDINGS = 10;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const QUEUED_MS = 1_000;

interface ToolCallRecord {
  conversationId: string;
  profile: string;
  tool: string;
  kind: string;
  startedAt: number;
  endedAt: number | null;
  status: "completed" | "failed" | null;
  /** Its turn ended without the call reporting its end. */
  leftOpen: boolean;
  title: string;
  rawInput: Record<string, unknown>;
  failureText: string;
  bySubagent: boolean;
  permission: PermissionRecord | null;
}

interface PermissionRecord {
  call: ToolCallRecord | null;
  title: string;
  askedAt: number;
  answeredAt: number | null;
  answer: PermissionOptionKind | null;
  options: Map<string, PermissionOptionKind>;
}

interface TurnRecord {
  conversationId: string;
  startedAt: number | null;
  endedAt: number;
  endedBy: StopReason | "error";
  /** Why a turn that ended in an error did, alike for alike errors. */
  error: string | null;
  usage: TurnUsage | null;
  model: string | null;
  toolCalls: number;
  toolIntervals: [number, number][];
}

/** A message the user typed that started a turn. */
interface RequestRecord {
  text: string;
  at: number;
}

/**
 * The tool calls, turns and permissions of one conversation's events, in the order they were written.
 *
 * An error ends a turn when the turn failed with it, as `endsTurn` marks. Errors from before that mark end a turn only
 * when it goes no further, as others, such as a session that couldn't be resumed, come at a turn's start or between turns.
 */
export function foldConversation(conversationId: string, profile: string, events: StoredEvent[]) {
  const calls = new Map<string, ToolCallRecord>();
  const permissions = new Map<string, PermissionRecord>();
  /** Permissions asked for a call the agent had not announced yet, by its id. */
  const askedAhead = new Map<string, PermissionRecord>();
  const turns: TurnRecord[] = [];
  const replyGaps: number[] = [];
  const requests: RequestRecord[] = [];
  let turnStart: number | null = null;
  let lastTurnEnd: number | null = null;
  let turnCalls: ToolCallRecord[] = [];
  let open = new Set<ToolCallRecord>();
  /** An unmarked error in the open turn, which ended it if no turn-end follows before the next message or the end. */
  let unmarkedError: { at: number; event: ConversationError } | null = null;

  const endTurn = (at: number, ending: TurnEnd | ConversationError) => {
    for (const call of open) call.leftOpen = true;
    const mainCalls = turnCalls.filter((call) => !call.bySubagent);
    turns.push({
      conversationId,
      startedAt: turnStart,
      endedAt: at,
      endedBy: ending.type === "error" ? "error" : ending.stopReason,
      error: ending.type === "error" ? errorReason(ending) : null,
      usage: ending.usage ?? null,
      model: ending.model ?? null,
      toolCalls: turnCalls.length,
      toolIntervals: mainCalls.map((call) => [call.startedAt, call.endedAt ?? at]),
    });
    turnStart = null;
    lastTurnEnd = at;
    turnCalls = [];
    open = new Set();
    unmarkedError = null;
  };

  for (const { at, event } of events) {
    if (event.type === "user-message") {
      if (unmarkedError) endTurn(unmarkedError.at, unmarkedError.event);
      const typed = !event.fromScript && !event.fromMirador && !event.fromPlugin;
      if (turnStart === null && typed) {
        if (lastTurnEnd !== null) replyGaps.push(at - lastTurnEnd);
        if (event.text) requests.push({ text: event.text, at });
      }
      if (turnStart === null) lastTurnEnd = null;
      turnStart ??= at;
    } else if (event.type === "turn-end") {
      endTurn(at, event);
    } else if (event.type === "error") {
      if (event.endsTurn) endTurn(at, event);
      else if (turnStart !== null) unmarkedError = { at, event };
    } else if (event.type === "permission") {
      const call = calls.get(event.toolCall.toolCallId) ?? null;
      const permission: PermissionRecord = {
        call,
        title: event.toolCall.title ?? "unknown",
        askedAt: at,
        answeredAt: null,
        answer: null,
        options: new Map(event.options.map((option) => [option.optionId, option.kind])),
      };
      if (call) call.permission = permission;
      else askedAhead.set(event.toolCall.toolCallId, permission);
      permissions.set(event.permissionId, permission);
    } else if (event.type === "permission-resolved") {
      const permission = permissions.get(event.permissionId);
      if (!permission) continue;
      permission.answeredAt = at;
      permission.answer = event.optionId === null ? null : (permission.options.get(event.optionId) ?? null);
    } else if (event.type === "acp" && event.update.sessionUpdate === "tool_call") {
      const update = event.update;
      const record: ToolCallRecord = {
        conversationId,
        profile,
        tool: toolNameOf(update),
        kind: update.kind ?? "other",
        startedAt: at,
        endedAt: null,
        status: null,
        leftOpen: false,
        title: "",
        rawInput: {},
        failureText: "",
        bySubagent: parentToolUseIdOf(update) !== undefined,
        permission: askedAhead.get(update.toolCallId) ?? null,
      };
      if (record.permission) record.permission.call = record;
      calls.set(update.toolCallId, record);
      turnCalls.push(record);
      open.add(record);
      noteProgress(record, update);
    } else if (event.type === "acp" && event.update.sessionUpdate === "tool_call_update") {
      const record = calls.get(event.update.toolCallId);
      if (!record) continue;
      noteProgress(record, event.update);
      if (event.update.status === "completed" || event.update.status === "failed") {
        record.status = event.update.status;
        record.endedAt = at;
        open.delete(record);
        if (event.update.status === "failed") record.failureText = contentText(event.update);
      }
    }
  }

  if (unmarkedError) endTurn(unmarkedError.at, unmarkedError.event);
  return { calls: [...calls.values()], turns, permissions: [...permissions.values()], replyGaps, requests };
}

type ConversationError = Extract<ConversationEvent, { type: "error" }>;
type TurnEnd = Extract<ConversationEvent, { type: "turn-end" }>;

const errorReason = ({ message, usageLimit, authRequired }: ConversationError) =>
  usageLimit ? "usage limit reached" : authRequired ? "sign-in needed" : failureReason(message);

const parentToolUseIdOf = (update: ToolCallUpdate) => ((update._meta?.claudeCode ?? {}) as { parentToolUseId?: unknown }).parentToolUseId;

function noteProgress(record: ToolCallRecord, update: ToolCallUpdate) {
  if (update.title) record.title = update.title;
  if (update.rawInput && typeof update.rawInput === "object" && Object.keys(update.rawInput).length > 0) record.rawInput = update.rawInput as Record<string, unknown>;
}

/** The call's input as the user would recognise it: the command, address, file or search it took, else its title, else all it was given. */
function inputOf({ rawInput, title, tool }: Pick<ToolCallRecord, "rawInput" | "title" | "tool">): string {
  const described = [rawInput.command, rawInput.url, rawInput.file_path, rawInput.path, rawInput.query, rawInput.pattern].find(
    (value): value is string => typeof value === "string" && value !== "",
  );
  if (described) return described;
  if (title && title !== tool) return title;
  return Object.keys(rawInput).length > 0 ? JSON.stringify(rawInput) : "";
}

const contentText = (update: ToolCallUpdate) =>
  (update.content ?? [])
    .map((block) => (block.type === "content" && block.content.type === "text" ? block.content.text : ""))
    .join("\n")
    .trim();

/** Where a tool comes from: the agent itself, Mirador's canvas, one of its plugins, or another MCP server. */
export function sourceOf(tool: string, pluginTools: PluginToolTitles | null): string {
  const canvasTool = canvasToolName(tool);
  if (canvasTool !== null) {
    if (BUILT_IN_CANVAS_TOOLS.includes(canvasTool) || canvasTool === PLUGIN_INSTALL_TOOL) return "Mirador canvas";
    if (!pluginTools) return "canvas plugins";
    return pluginTools[canvasTool] ? `${pluginTools[canvasTool]} plugin` : "canvas plugins no longer installed";
  }
  const server = /^mcp__(.+?)__/.exec(tool)?.[1];
  return server ? `MCP server ${server}` : "the agent's own tools";
}

export function outcomeOf(call: Pick<ToolCallRecord, "status" | "leftOpen" | "failureText" | "permission">): ToolCallOutcome | "running" {
  if (call.permission?.answer === "reject_once" || call.permission?.answer === "reject_always") return "denied";
  if (call.status === "completed") return "succeeded";
  if (call.status === null) return call.leftOpen ? "cancelled" : "running";
  const text = unfenced(call.failureText);
  // The host fails the calls a broken-off turn leaves open, without a word.
  if (text === "" || /^\[?Request interrupted|^Interrupted/i.test(text)) return "cancelled";
  if (/^Permission denied|doesn't want to proceed|was rejected|^User (rejected|refused|denied)/i.test(text)) return "denied";
  return "failed";
}

/**
 * What a failure's message says went wrong, alike for alike failures so they count together: addresses, the machines
 * it names, and long numbers, such as ids, go.
 */
export function failureReason(failureText: string): string {
  const text = unfenced(failureText);
  const exit = /^Exit code (\d+)/.exec(text);
  if (exit) return `exit code ${exit[1]}`;
  const firstLine = text.replace(/<\/?[a-z_]+>/g, "").trim().split("\n")[0]?.trim() ?? "";
  return cut(withoutMachines(masked(firstLine).replace(/\bhttps?:\/\/[^\s)"']+/g, "<url>")).replace(/\d{4,}/g, "N"), 80) || "no message";
}

const TOP_LEVEL_DOMAINS = "com|net|org|io|dev|ai|co|me|cloud|tech|xyz|info|biz|edu|gov|eu|uk|de|fr|nl|hu|local|lan|internal|home|localdomain";

/** Hides the machines a message names: user@host, IP addresses, the host after "host:", "to host" or ENOTFOUND and the like, and domain names. */
function withoutMachines(text: string): string {
  return text
    .replace(/\b[\w.+-]+@[a-z][\w-]*(?:\.[\w-]+)*/gi, "<user@host>")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "<ip>")
    .replace(/\[[0-9a-f.]*:[0-9a-f:.]*\]/gi, "<ip>")
    .replace(/(?<![\w:])(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{1,4}(?!\w|:\w)/gi, (address) => (/::|[a-f]/i.test(address) || address.split(":").length > 4 ? "<ip>" : address))
    .replace(/\b(ENOTFOUND|EAI_AGAIN|ECONNREFUSED|EHOSTUNREACH|ETIMEDOUT|to host)\s+(?!<)[\w.-]+/g, "$1 <host>")
    .replace(/\b(host(?:name)?|server)(\s*[=:]\s*)(?!<)['"]?[\w.-]+['"]?/gi, "$1$2<host>")
    .replace(new RegExp(`\\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+(?:${TOP_LEVEL_DOMAINS})\\b`, "gi"), "<host>");
}

const unfenced = (text: string) => text.replace(/^```[^\n]*\n?/, "").replace(/\n?```\s*$/, "").trim();

/** Hides what looks like a secret: values of variables named like keys or tokens, bearer tokens, and long random strings. */
export function masked(text: string): string {
  return text
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/g, "$1 •••")
    .replace(/\b([A-Za-z0-9_]*(?:token|key|secret|password|passwd|auth)[A-Za-z0-9_]*)(\s*[=:]\s*)(?!(?:Bearer|Basic) )("[^"]*"|'[^']*'|[^\s&"']+)/gi, "$1$2•••")
    .replace(/[A-Za-z0-9_+=-]{24,}/g, (run) => (/[0-9]/.test(run) && /[A-Za-z]/.test(run) ? "•••" : run));
}

const cut = (text: string, length: number) => (text.length <= length ? text : `${text.slice(0, length - 1)}…`);

const example = (text: string, length: number) => cut(masked(text.replace(/\s+/g, " ").trim()), length);

/** Turns `since` and `until` into the period's first and last moment, in epoch milliseconds. */
export function usagePeriod({ since, until }: Pick<UsageQuery, "since" | "until">, now: number): { from: number; to: number } {
  const to = until ? momentOf(until, now, "end") : now;
  const from = since ? momentOf(since, now, "start") : now - 30 * DAY_MS;
  if (from >= to) throw new UsageQueryError(`The period is empty: ${since ?? "30 days ago"} is not before ${until ?? "now"}.`);
  return { from, to };
}

export class UsageQueryError extends Error {}

function momentOf(text: string, now: number, end: "start" | "end"): number {
  const relative = /^(\d+)\s*([hdw])$/i.exec(text.trim());
  if (relative) return now - Number(relative[1]) * { h: HOUR_MS, d: DAY_MS, w: 7 * DAY_MS }[relative[2]!.toLowerCase() as "h" | "d" | "w"];
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (date) {
    const start = new Date(Number(date[1]), Number(date[2]) - 1, Number(date[3])).getTime();
    return end === "start" ? start : new Date(Number(date[1]), Number(date[2]) - 1, Number(date[3]) + 1).getTime();
  }
  const moment = Date.parse(text);
  if (Number.isNaN(moment)) throw new UsageQueryError(`"${text}" is no period: give a number of hours, days or weeks back (12h, 7d, 2w), or a date such as 2026-10-01.`);
  return moment;
}

const localDate = (at: number) => {
  const date = new Date(at);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

const localTime = (at: number) => {
  const date = new Date(at);
  return `${localDate(at)} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};

function quantile(values: number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)] ?? sorted[0]!;
}

const seconds = (ms: number | null) => (ms === null ? null : Math.round(ms / 100) / 10);
const percent = (part: number, whole: number) => (whole === 0 ? null : Math.round((part / whole) * 1000) / 10);

/** A duration as people say it: 40 s, 3 min, 2 h. */
const spoken = (ms: number) => (ms < 60_000 ? `${Math.round(ms / 1000)} s` : ms < HOUR_MS ? `${Math.round(ms / 60_000)} min` : `${Math.round(ms / HOUR_MS)} h`);

const times = (count: number) => (count === 1 ? "once" : `${count} times`);

/** How long the intervals cover together, counting overlaps once. */
function covered(intervals: [number, number][]): number {
  let total = 0;
  let reach = -Infinity;
  for (const [start, end] of [...intervals].sort((a, b) => a[0] - b[0])) {
    const from = Math.max(start, reach);
    if (end > from) total += end - from;
    reach = Math.max(reach, end);
  }
  return total;
}

/** `count` of the items, spread evenly from first to last. */
const spread = <T>(items: T[], count: number) =>
  items.length <= count ? items : Array.from({ length: count }, (_, index) => items[Math.floor((index * items.length) / count)]!);

/** The first word of a command, after a `cd <folder> &&` that only says where it runs. */
const commandWord = (command: string) => command.replace(/^\s*cd\s+\S+\s*&&\s*/, "").trim().split(/\s+/)[0] ?? "";

export function workspaceMatching(workspaces: UsageWorkspace[], wanted: string): UsageWorkspace {
  const match = workspaces.find(({ name, path }) => path === wanted || name.toLowerCase() === wanted.toLowerCase());
  if (!match) throw new UsageQueryError(`No workspace is called or kept in "${wanted}". The workspaces: ${workspaces.map(({ name }) => name).join(", ")}.`);
  return match;
}

/** The name a conversation's profile goes by in reports. */
export const profileOf = ({ profileId, profileName, harness }: Pick<UsageConversation, "profileId" | "profileName" | "harness">) =>
  profileName ?? (profileId ? "a deleted profile" : harnessLabels[harness]);

function profileMatching(names: string[], wanted: string): string {
  const match = names.find((name) => name.toLowerCase() === wanted.toLowerCase());
  if (!match) throw new UsageQueryError(`No profile is called "${wanted}". The profiles: ${names.join(", ")}.`);
  return match;
}

/** A conversation's time on one profile. */
interface Piece {
  conversation: UsageConversation;
  profile: string;
  harness: HarnessId;
  events: StoredEvent[];
}

type ProfileChange = Extract<ConversationEvent, { type: "profile-changed" }>;

/**
 * A conversation's events split where it changed profile, each piece with the profile it ran on then: the one it has
 * now for the last, else the one each change says it left. A change from before Mirador noted that leaves the time
 * before it to "an earlier profile".
 */
function piecesOf(conversation: UsageConversation, events: StoredEvent[]): Piece[] {
  const changes = events.flatMap(({ event }) => (event.type === "profile-changed" ? [event] : []));
  const harnesses = [conversation.harness];
  for (const change of changes.toReversed()) harnesses.unshift(change.from?.harness ?? harnesses[0]!);
  const nameBefore = (change: ProfileChange, index: number) => {
    if (change.from) return profileOf(change.from);
    if (index === 0) return "an earlier profile";
    return changes[index - 1]!.profileName ?? harnessLabels[harnesses[index]!];
  };
  const pieces: Piece[] = [
    ...changes.map((change, index) => ({ conversation, profile: nameBefore(change, index), harness: harnesses[index]!, events: [] })),
    { conversation, profile: profileOf(conversation), harness: conversation.harness, events: [] },
  ];
  let index = 0;
  for (const stored of events) {
    if (stored.event.type === "profile-changed") index += 1;
    else pieces[index]!.events.push(stored);
  }
  return pieces.filter(({ events }) => events.length > 0);
}

interface FoldedConversation extends ReturnType<typeof foldConversation> {
  conversation: UsageConversation;
  profile: string;
  harness: HarnessId;
}

/** What a report is made from: the conversations asked about, folded by profile for the period and, to compare, for the one before. */
interface Gathered {
  from: number;
  to: number;
  now: number;
  workspaceName: string | null;
  profileName: string | null;
  /** The conversations of the workspace asked about that are on the profile asked about now. */
  conversations: UsageConversation[];
  current: FoldedConversation[];
  previous: FoldedConversation[] | null;
  pluginTools: PluginToolTitles | null;
  excerpts: boolean;
}

function gather(data: UsageData, query: UsageQuery, options: ReportOptions): Gathered {
  const now = options.now ?? Date.now();
  const { from, to } = usagePeriod(query, now);
  const before = from - (to - from);
  const workspace = !query.workspace || query.workspace === "all" ? null : workspaceMatching(data.workspaces(), query.workspace);
  const ofWorkspace = data.conversations().filter((conversation) => !workspace || conversation.workspaceId === workspace.id);
  const profileNames = [...new Set([...data.profiles().map(({ name }) => name), ...ofWorkspace.map(profileOf)])].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );
  const profileName = !query.profile || query.profile === "all" ? null : profileMatching(profileNames, query.profile);
  const events = data.events(query.compare ? before : from, to, workspace ? ofWorkspace.map(({ id }) => id) : null);
  const pieces = ofWorkspace
    .flatMap((conversation) => piecesOf(conversation, events.get(conversation.id) ?? []))
    .filter(({ profile }) => !profileName || profile === profileName);
  const fold = (since: number, until: number) =>
    pieces.flatMap(({ conversation, profile, harness, events }) => {
      const own = events.filter(({ at }) => at >= since && at < until);
      if (own.length === 0) return [];
      return [{ conversation, profile, harness, ...foldConversation(conversation.id, profile, own) }];
    });
  return {
    from,
    to,
    now,
    workspaceName: workspace?.name ?? null,
    profileName,
    conversations: ofWorkspace.filter((conversation) => !profileName || profileOf(conversation) === profileName),
    current: fold(from, to),
    previous: query.compare ? fold(before, from) : null,
    pluginTools: options.pluginTools ?? null,
    excerpts: options.excerpts !== false,
  };
}

export function usageReport(data: UsageData, query: UsageQuery, options: ReportOptions = {}): UsageReport {
  return reportOf(gather(data, query, options));
}

export function toolReport(data: UsageData, query: UsageQuery & { tool: string }, options: ReportOptions = {}): ToolReport {
  const gathered = gather(data, query, options);
  const calls = countedCalls(gathered.current);
  const name = [...new Set(calls.map(({ tool }) => tool))].find((tool) => tool.toLowerCase() === query.tool.toLowerCase());
  if (!name) throw new UsageQueryError(`No call of a tool named "${query.tool}" in this period.`);
  const ofTool = calls.filter(({ tool }) => tool === name);
  const finished = ofTool.filter(({ outcome }) => outcome === "succeeded" || outcome === "failed");
  return {
    ...framing(gathered),
    tool: {
      ...toolUsage(name, ofTool, gathered.previous && countedCalls(gathered.previous), gathered.pluginTools, gathered.excerpts ? EXAMPLES_FOR_ONE_TOOL : 0),
      byProfile: [...Map.groupBy(ofTool, ({ profile }) => profile).entries()]
        .map(([profile, ofProfile]) => ({ profile, calls: ofProfile.length, failed: outcomes(ofProfile).failed, successPercent: outcomes(ofProfile).successPercent }))
        .sort((a, b) => b.calls - a.calls),
      slowestCalls: finished
        .toSorted((a, b) => b.endedAt! - b.startedAt - (a.endedAt! - a.startedAt))
        .slice(0, gathered.excerpts ? 5 : 0)
        .map((call) => ({ input: example(inputOf(call), 160), seconds: seconds(call.endedAt! - call.startedAt)!, at: localTime(call.startedAt) })),
    },
    findings: findingsOf(gathered).filter(({ tool }) => tool === name),
  };
}

const framing = ({ from, to, workspaceName, profileName }: Gathered) => ({
  period: { from: localTime(from), to: localTime(to) },
  workspace: workspaceName ?? "all workspaces",
  profile: profileName ?? "all profiles",
  definitions: USAGE_DEFINITIONS,
});

type CountedCall = ToolCallRecord & { outcome: ToolCallOutcome };

const countedCalls = (folded: FoldedConversation[]): CountedCall[] =>
  folded.flatMap(({ calls }) =>
    calls.flatMap((call) => {
      const outcome = outcomeOf(call);
      return outcome === "running" ? [] : [{ ...call, outcome }];
    }),
  );

function outcomes(calls: CountedCall[]) {
  const count = (outcome: ToolCallOutcome) => calls.filter((call) => call.outcome === outcome).length;
  const succeeded = count("succeeded");
  const failed = count("failed");
  return { succeeded, failed, denied: count("denied"), cancelled: count("cancelled"), finished: succeeded + failed, successPercent: percent(succeeded, succeeded + failed) };
}

const duration = (call: CountedCall) => call.endedAt! - call.startedAt;
const isFinished = (call: CountedCall) => call.outcome === "succeeded" || call.outcome === "failed";

/** Reply gaps from a turn's end to the user's next message: the ones within an hour, and how many came later. */
function repliesOf(folded: FoldedConversation[]) {
  const gaps = folded.flatMap(({ replyGaps }) => replyGaps).filter((gap) => gap >= QUEUED_MS);
  const within = gaps.filter((gap) => gap <= HOUR_MS);
  return { within, later: gaps.length - within.length };
}

/** Output tokens per second of the turns' model time, from the turns that reported tokens and spent a second or more outside tools. */
function speedOf(turns: TurnRecord[]): number | null {
  const timed = turns
    .filter((turn): turn is TurnRecord & { usage: TurnUsage; startedAt: number } => turn.usage !== null && turn.startedAt !== null)
    .map((turn) => ({ outputTokens: turn.usage.outputTokens, modelMs: turn.endedAt - turn.startedAt - covered(turn.toolIntervals) }))
    .filter(({ modelMs }) => modelMs >= 1000);
  const timedMs = timed.reduce((total, { modelMs }) => total + modelMs, 0);
  return timedMs === 0 ? null : Math.round((timed.reduce((total, { outputTokens }) => total + outputTokens, 0) / timedMs) * 10_000) / 10;
}

const turnMs = (turns: TurnRecord[]) => turns.flatMap((turn) => (turn.startedAt === null ? [] : [turn.endedAt - turn.startedAt]));

function totalsOf(folded: FoldedConversation[]): Totals {
  const calls = outcomes(countedCalls(folded));
  const turns = folded.flatMap(({ turns }) => turns);
  const tokens = turns.flatMap(({ usage }) => (usage ? [usage] : []));
  const sum = (key: keyof TurnUsage) => tokens.reduce((total, usage) => total + usage[key], 0);
  return {
    conversations: new Set(folded.flatMap(({ conversation, calls, turns }) => (calls.length > 0 || turns.length > 0 ? [conversation.id] : []))).size,
    turns: turns.length,
    toolCalls: calls.succeeded + calls.failed + calls.denied + calls.cancelled,
    failedCalls: calls.failed,
    successPercent: calls.successPercent,
    permissionPrompts: folded.reduce((total, { permissions }) => total + permissions.length, 0),
    medianTurnSeconds: seconds(quantile(turnMs(turns), 0.5)),
    medianReplySeconds: seconds(quantile(repliesOf(folded).within, 0.5)),
    inputTokens: sum("inputTokens"),
    outputTokens: sum("outputTokens"),
    cachedReadTokens: sum("cachedReadTokens"),
    cachedWriteTokens: sum("cachedWriteTokens"),
    outputTokensPerSecond: speedOf(turns),
  };
}

const activeTotals = (folded: FoldedConversation[]) => {
  const totals = totalsOf(folded);
  return totals.turns === 0 && totals.toolCalls === 0 ? null : totals;
};

function toolUsage(name: string, ofTool: CountedCall[], previousCalls: CountedCall[] | null, pluginTools: PluginToolTitles | null, examples: number): ToolUsage {
  const counts = outcomes(ofTool);
  const failed = ofTool.filter((call) => call.outcome === "failed");
  const durations = ofTool.filter(isFinished).map(duration);
  const before = (previousCalls ?? []).filter(({ tool }) => tool === name);
  return {
    tool: name,
    kind: ofTool[0]!.kind,
    source: sourceOf(name, pluginTools),
    profiles: [...new Set(ofTool.map((call) => call.profile))],
    calls: ofTool.length,
    succeeded: counts.succeeded,
    failed: counts.failed,
    denied: counts.denied,
    cancelled: counts.cancelled,
    successPercent: counts.successPercent,
    before: before.length === 0 ? null : { calls: before.length, successPercent: outcomes(before).successPercent },
    bySubagents: ofTool.filter((call) => call.bySubagent).length,
    medianSeconds: seconds(quantile(durations, 0.5)),
    p90Seconds: seconds(quantile(durations, 0.9)),
    failureReasons: reasonsOf(failed).slice(0, 5),
    failureExamples: failed
      .toReversed()
      .slice(0, examples)
      .map((call) => ({ input: example(inputOf(call), 160), result: example(unfenced(call.failureText), 200), at: localTime(call.startedAt) })),
  };
}

const reasonsOf = (failed: CountedCall[]) =>
  [...Map.groupBy(failed, (call) => failureReason(call.failureText)).entries()].map(([reason, ofReason]) => ({ reason, calls: ofReason.length })).sort((a, b) => b.calls - a.calls);

function reportOf(gathered: Gathered): UsageReport {
  const { now, conversations, current, previous, pluginTools, excerpts } = gathered;
  const calls = countedCalls(current);
  const previousCalls = previous && countedCalls(previous);
  const turns = current.flatMap(({ turns }) => turns);
  const ranked = [...Map.groupBy(calls, (call) => call.tool).entries()].sort((a, b) => b[1].length - a[1].length);
  const unlisted = ranked.slice(TOP_TOOLS);

  return {
    ...framing(gathered),
    totals: totalsOf(current),
    previousPeriod: previous && { from: localTime(gathered.from - (gathered.to - gathered.from)), to: localTime(gathered.from), totals: activeTotals(previous) },
    findings: findingsOf(gathered).slice(0, MOST_FINDINGS),
    profiles: profileUsage(current, previous),
    tools: ranked.slice(0, TOP_TOOLS).map(([name, ofTool]) => toolUsage(name, ofTool, previousCalls, pluginTools, excerpts ? EXAMPLES : 0)),
    otherTools: unlisted.length === 0 ? null : { tools: unlisted.length, calls: unlisted.reduce((total, [, ofTool]) => total + ofTool.length, 0) },
    sources: sourceUsage(calls, pluginTools),
    permissions: permissionUsage(current),
    responses: responseTimes(current, calls),
    turns: {
      count: turns.length,
      endedBy: Object.fromEntries([...Map.groupBy(turns, (turn) => turn.endedBy).entries()].map(([reason, ofReason]) => [reason, ofReason.length])),
      medianSeconds: seconds(quantile(turnMs(turns), 0.5)),
      p90Seconds: seconds(quantile(turnMs(turns), 0.9)),
      medianToolCalls: quantile(turns.map((turn) => turn.toolCalls), 0.5),
    },
    models: modelUsage(turns),
    days: dayUsage(turns, calls),
    conversations: !excerpts
      ? null
      : {
          busiest: busiestConversations(current),
          untouchedLongest: conversations
            .filter((conversation) => conversation.lastEventAt !== null)
            .sort((a, b) => a.lastEventAt! - b.lastEventAt!)
            .slice(0, LISTED_CONVERSATIONS)
            .map((conversation) => ({
              title: conversation.title,
              workspace: conversation.workspaceName,
              profile: profileOf(conversation),
              lastActivity: localTime(conversation.lastEventAt!),
              idleDays: Math.floor((now - conversation.lastEventAt!) / DAY_MS),
            })),
        },
    samples: excerpts ? samplesOf(current, calls) : null,
  };
}

function profileUsage(current: FoldedConversation[], previous: FoldedConversation[] | null): ProfileUsage[] {
  const previousByProfile = Map.groupBy(previous ?? [], ({ profile }) => profile);
  return [...Map.groupBy(current, ({ profile }) => profile).entries()]
    .map(([profile, folded]) => {
      const calls = countedCalls(folded);
      const callsBefore = countedCalls(previousByProfile.get(profile) ?? []);
      const models = Map.groupBy(
        folded.flatMap(({ turns }) => turns.flatMap(({ model }) => (model ? [model] : []))),
        (model) => model,
      );
      return {
        profile,
        agent: harnessLabels[folded[0]!.harness],
        models: [...models.entries()].sort((a, b) => b[1].length - a[1].length).map(([model]) => model),
        totals: totalsOf(folded),
        before: activeTotals(previousByProfile.get(profile) ?? []),
        tools: [...Map.groupBy(calls, ({ tool }) => tool).entries()]
          .sort((a, b) => b[1].length - a[1].length)
          .slice(0, TOP_TOOLS_OF_PROFILE)
          .map(([tool, ofTool]) => {
            const before = callsBefore.filter((call) => call.tool === tool);
            return {
              tool,
              calls: ofTool.length,
              failed: outcomes(ofTool).failed,
              successPercent: outcomes(ofTool).successPercent,
              successPercentBefore: before.length === 0 ? null : outcomes(before).successPercent,
            };
          }),
        failureReasons: [...Map.groupBy(calls.filter(({ outcome }) => outcome === "failed"), ({ tool, failureText }) => JSON.stringify([tool, failureReason(failureText)])).entries()]
          .map(([key, ofReason]) => {
            const [tool, reason] = JSON.parse(key) as [string, string];
            return { tool, reason, calls: ofReason.length };
          })
          .sort((a, b) => b.calls - a.calls)
          .slice(0, 5),
      };
    })
    .sort((a, b) => b.totals.turns - a.totals.turns || b.totals.toolCalls - a.totals.toolCalls);
}

function sourceUsage(calls: CountedCall[], pluginTools: PluginToolTitles | null): SourceUsage[] {
  return [...Map.groupBy(calls, ({ tool }) => sourceOf(tool, pluginTools)).entries()]
    .map(([source, ofSource]) => ({
      source,
      calls: ofSource.length,
      sharePercent: percent(ofSource.length, calls.length)!,
      failed: outcomes(ofSource).failed,
      tools: [...Map.groupBy(ofSource, ({ tool }) => tool).entries()]
        .map(([tool, ofTool]) => ({ tool, calls: ofTool.length }))
        .sort((a, b) => b.calls - a.calls)
        .slice(0, 5),
    }))
    .sort((a, b) => b.calls - a.calls);
}

/** Groups permissions the user allowed once by profile, tool and command, where it happened often enough to allow always. */
function repeatedAllowances(folded: FoldedConversation[]) {
  const allowedOnce = folded.flatMap(({ profile, permissions }) => permissions.filter(({ answer }) => answer === "allow_once").map((permission) => ({ profile, permission })));
  return [
    ...Map.groupBy(allowedOnce, ({ profile, permission: { call, title } }) =>
      JSON.stringify([profile, call?.tool ?? title, call?.kind === "execute" && typeof call.rawInput.command === "string" ? commandWord(call.rawInput.command) : ""]),
    ).entries(),
  ]
    .filter(([, times]) => times.length >= REPEATED_ALLOWANCE)
    .map(([key, times]) => {
      const [profile, tool, command] = JSON.parse(key) as [string, string, string];
      return { profile, tool, ...(command && { command }), times: times.length };
    })
    .sort((a, b) => b.times - a.times);
}

function permissionUsage(folded: FoldedConversation[]): PermissionUsage {
  const asked = folded.flatMap(({ permissions }) => permissions);
  const answered = (kind: PermissionOptionKind) => asked.filter(({ answer }) => answer === kind).length;
  return {
    asked: asked.length,
    allowedOnce: answered("allow_once"),
    allowedAlways: answered("allow_always"),
    rejected: answered("reject_once") + answered("reject_always"),
    unanswered: asked.filter(({ answer }) => answer === null).length,
    medianSecondsToAnswer: seconds(quantile(asked.flatMap(({ askedAt, answeredAt }) => (answeredAt === null ? [] : [answeredAt - askedAt])), 0.5)),
    allowedOnceRepeatedly: repeatedAllowances(folded),
  };
}

const isQuestion = ({ tool }: CountedCall) => canvasToolName(tool) === "ask";
const timedOut = ({ outcome, failureText }: CountedCall) => outcome === "failed" && /timed out/i.test(failureText);

function responseTimes(folded: FoldedConversation[], calls: CountedCall[]): ResponseTimes {
  const replies = repliesOf(folded);
  const questions = calls.filter(isQuestion);
  const waits = questions.filter(({ outcome }) => outcome === "succeeded").map(duration);
  return {
    afterTurns: {
      replies: replies.within.length,
      medianSeconds: seconds(quantile(replies.within, 0.5)),
      p90Seconds: seconds(quantile(replies.within, 0.9)),
      cameBackLater: replies.later,
    },
    toQuestions: {
      asked: questions.length,
      answered: waits.length,
      medianSeconds: seconds(quantile(waits, 0.5)),
      p90Seconds: seconds(quantile(waits, 0.9)),
      timedOut: questions.filter(timedOut).length,
    },
  };
}

const questionsIn = ({ question, questions }: Record<string, unknown>): string[] => {
  if (typeof question === "string") return [question];
  if (!Array.isArray(questions)) return [];
  return questions.flatMap((each) => (each && typeof each === "object" && typeof each.question === "string" ? [each.question as string] : []));
};

function samplesOf(folded: FoldedConversation[], calls: CountedCall[]): UsageSamples {
  const typed = folded
    .flatMap(({ profile, requests }) => requests.map((request) => ({ ...request, profile })))
    .filter(({ text }) => text.trim().split(/\s+/).length >= 4)
    .sort((a, b) => a.at - b.at);
  const requests = [...Map.groupBy(typed, ({ text }) => text).values()].map(([first]) => first!);
  const questions = calls
    .filter(isQuestion)
    .flatMap((call) => questionsIn(call.rawInput).map((question) => ({ question, call })))
    .sort((a, b) => a.call.startedAt - b.call.startedAt);
  return {
    yourRequests: {
      total: requests.length,
      shown: spread(requests, SAMPLES).map(({ text, profile, at }) => ({ text: example(text, 200), profile, at: localTime(at) })),
    },
    agentQuestions: {
      total: questions.length,
      shown: spread(questions, SAMPLES).map(({ question, call }) => ({
        question: example(question, 160),
        profile: call.profile,
        waitedSeconds: call.outcome === "succeeded" ? seconds(duration(call)) : null,
        at: localTime(call.startedAt),
      })),
    },
  };
}

const MISSING_TOOL = /No tool named|Unknown tool|tool .{0,60}(?:not found|not available|isn't available)/i;
const FAILING_TOOL_FAILURES = 3;
const FAILING_TOOL_BELOW_PERCENT = 80;
const QUESTION_WAIT_MS = 5 * 60_000;
const QUESTIONS_TIMED_OUT = 2;
const TURN_ERRORS = 3;
const TURN_ERROR_SHARE = 0.05;
const COMPARED_CALLS = 20;
const WORSE_POINTS = 5;
const WORSE_TOOL_POINTS = 10;
const COMPARED_TOOL_CALLS = 10;
const COMPARED_TURNS = 10;
const SLOWER = 1.5;
const IDLE_MS = 14 * DAY_MS;
/** Kinds of findings from the ones that cost the most, failed turns, to the ones that cost the least. */
const SEVERITY: FindingKind[] = ["turn-errors", "missing-tool", "failing-tool", "got-worse", "waiting-questions", "allow-always", "idle-conversations"];

/** What to try about a tool whose calls keep failing, by what most of the failures say. */
function suggestionFor(tool: string, reason: string): string {
  if (/\b(401|403|429)\b|non 2xx/i.test(reason)) return "The sites refused the requests (HTTP 403 and the like), so retrying won't help: a browser tool gets further on such sites.";
  if (/^exit code/.test(reason)) return `Most are commands that exited with an error: look into ${tool} with the tool option to see whether the same command keeps failing.`;
  if (/timed? ?out/i.test(reason)) return "Most calls ran out of time: give long jobs more time, or run them in the background.";
  if (/invalid arg|invalid input|expected/i.test(reason))
    return "The agent called it with wrong arguments, so its model doesn't know the tool well: a stronger model on this profile, or a line about the tool in its instructions, helps.";
  return `Look into ${tool} with the tool option for its failures and examples.`;
}

function findingsOf({ now, conversations, current, previous, excerpts }: Gathered): Finding[] {
  const findings: Finding[] = [];
  const previousByProfile = Map.groupBy(previous ?? [], ({ profile }) => profile);
  for (const [profile, folded] of Map.groupBy(current, ({ profile }) => profile)) {
    const calls = countedCalls(folded);
    const callsBefore = countedCalls(previousByProfile.get(profile) ?? []);

    for (const { tool, command, times: allowed } of repeatedAllowances(folded)) {
      const what = command ? `${tool} ${command}` : tool;
      findings.push({
        kind: "allow-always",
        profile,
        tool,
        count: allowed,
        seen: `You allowed ${what} once ${allowed} times in ${profile}.`,
        suggestion: `When ${profile} next asks about ${what}, choose the answer that allows it always, so it stops asking.`,
      });
    }

    const missing = calls.filter(({ outcome, failureText }) => outcome === "failed" && MISSING_TOOL.test(failureText));
    for (const [tool, ofTool] of Map.groupBy(missing, ({ tool }) => tool)) {
      findings.push({
        kind: "missing-tool",
        profile,
        tool,
        count: ofTool.length,
        seen: `${profile} called ${tool} ${times(ofTool.length)} and was told no such tool is available, last on ${localTime(Math.max(...ofTool.map(({ startedAt }) => startedAt)))}.`,
        suggestion: `Find out why ${profile} doesn't get ${tool}: a plugin not installed or not offered to this agent, a tool loaded only on demand, or an old name the agent remembers.`,
      });
    }

    for (const [tool, ofTool] of Map.groupBy(calls, ({ tool }) => tool)) {
      const failed = ofTool.filter(({ outcome, failureText }) => outcome === "failed" && !MISSING_TOOL.test(failureText));
      const finished = failed.length + outcomes(ofTool).succeeded;
      const success = percent(finished - failed.length, finished);
      if (failed.length < FAILING_TOOL_FAILURES || success === null || success >= FAILING_TOOL_BELOW_PERCENT) continue;
      const reason = reasonsOf(failed)[0]!.reason;
      findings.push({
        kind: "failing-tool",
        profile,
        tool,
        count: failed.length,
        seen: `${tool} failed ${failed.length} of ${finished} calls in ${profile} (${success}% succeeded), most often with: ${reason}.`,
        suggestion: suggestionFor(tool, reason),
      });
    }

    const questions = calls.filter(isQuestion);
    const waits = questions.filter(({ outcome }) => outcome === "succeeded").map(duration);
    const medianWait = quantile(waits, 0.5);
    const lapsed = questions.filter(timedOut).length;
    if (lapsed >= QUESTIONS_TIMED_OUT || (waits.length >= 3 && medianWait! > QUESTION_WAIT_MS)) {
      findings.push({
        kind: "waiting-questions",
        profile,
        count: questions.length,
        seen: `${profile} asked you ${questions.length} questions${medianWait === null ? "" : `, which waited ${spoken(medianWait)} for your answer (median)`}${lapsed > 0 ? `; ${lapsed} timed out` : ""}.`,
        suggestion: `Where you answer later, set the profile or conversation to "${askModeLabels["next-message"]}": the agent then ends its turn instead of waiting, and nothing times out.`,
      });
    }

    const turns = folded.flatMap(({ turns }) => turns);
    const errors = turns.filter(({ endedBy }) => endedBy === "error");
    if (errors.length >= TURN_ERRORS && errors.length >= turns.length * TURN_ERROR_SHARE) {
      const [error, ofError] = [...Map.groupBy(errors, ({ error }) => error ?? "no message").entries()].sort((a, b) => b[1].length - a[1].length)[0]!;
      findings.push({
        kind: "turn-errors",
        profile,
        count: errors.length,
        seen: `${errors.length} of ${profile}'s ${turns.length} turns ended in an error, ${ofError.length === errors.length ? "all" : `${ofError.length} of them`} with: ${error}.`,
        suggestion:
          error === "usage limit reached"
            ? "The plan's usage limit stopped them: keep a profile on another model or provider to switch to when it happens."
            : "Errors that share a cause, such as a model server out of reach, have one fix: deal with the most frequent first.",
      });
    }

    if (!previous) continue;
    const lately = outcomes(calls);
    const earlier = outcomes(callsBefore);
    if (lately.finished >= COMPARED_CALLS && earlier.finished >= COMPARED_CALLS && earlier.successPercent! - lately.successPercent! >= WORSE_POINTS) {
      findings.push({
        kind: "got-worse",
        profile,
        count: lately.failed,
        seen: `${profile}'s tool calls succeeded ${lately.successPercent}% of the time, down from ${earlier.successPercent}% in the period before.`,
        suggestion: "See which of its tools fail more now, and what changed in between: its model, its settings, or the work.",
      });
    }
    for (const [tool, ofTool] of Map.groupBy(calls, ({ tool }) => tool)) {
      const toolNow = outcomes(ofTool);
      const toolBefore = outcomes(callsBefore.filter((call) => call.tool === tool));
      if (toolNow.finished < COMPARED_TOOL_CALLS || toolBefore.finished < COMPARED_TOOL_CALLS || toolBefore.successPercent! - toolNow.successPercent! < WORSE_TOOL_POINTS) continue;
      findings.push({
        kind: "got-worse",
        profile,
        tool,
        count: toolNow.failed,
        seen: `${tool} in ${profile} succeeded ${toolNow.successPercent}% of the time, down from ${toolBefore.successPercent}% in the period before.`,
        suggestion: `Look into ${tool} with the tool option to see what fails now.`,
      });
    }
    const turnsBefore = (previousByProfile.get(profile) ?? []).flatMap(({ turns }) => turns);
    const medianTurn = quantile(turnMs(turns), 0.5);
    const medianTurnBefore = quantile(turnMs(turnsBefore), 0.5);
    if (turnMs(turns).length >= COMPARED_TURNS && turnMs(turnsBefore).length >= COMPARED_TURNS && medianTurn! >= medianTurnBefore! * SLOWER) {
      findings.push({
        kind: "got-worse",
        profile,
        count: turns.length,
        seen: `${profile}'s turns took ${spoken(medianTurn!)} (median), up from ${spoken(medianTurnBefore!)} in the period before.`,
        suggestion: "Compare its model's speed and its tool time with before; bigger tasks take longer too, so check which it is before changing anything.",
      });
    }
  }

  const idle = conversations.filter(({ lastEventAt }) => lastEventAt !== null && now - lastEventAt >= IDLE_MS).sort((a, b) => a.lastEventAt! - b.lastEventAt!);
  if (idle.length > 0) {
    const days = Math.floor((now - idle[0]!.lastEventAt!) / DAY_MS);
    const title = `"${idle[0]!.title}"`;
    findings.push({
      kind: "idle-conversations",
      count: idle.length,
      seen:
        idle.length === 1
          ? excerpts
            ? `One conversation has been left for two weeks or more: ${title}, for ${days} days.`
            : `One conversation has been left for ${days} days.`
          : `${idle.length} conversations have been left for two weeks or more, the oldest${excerpts ? `, ${title},` : ""} for ${days} days.`,
      suggestion: `Finish or delete ${idle.length === 1 ? "it" : "them"}, so the list shows what you're working on.`,
    });
  }
  return findings.sort((a, b) => SEVERITY.indexOf(a.kind) - SEVERITY.indexOf(b.kind) || b.count - a.count);
}

function modelUsage(turns: TurnRecord[]): ModelUsage[] {
  return [...Map.groupBy(turns, (turn) => turn.model ?? "not reported").entries()]
    .map(([model, ofModel]) => {
      const withTokens = ofModel.filter((turn): turn is TurnRecord & { usage: TurnUsage } => turn.usage !== null);
      const sum = (key: keyof TurnUsage) => withTokens.reduce((total, turn) => total + turn.usage[key], 0);
      return {
        model,
        turns: ofModel.length,
        turnsWithTokens: withTokens.length,
        inputTokens: sum("inputTokens"),
        outputTokens: sum("outputTokens"),
        cachedReadTokens: sum("cachedReadTokens"),
        cachedWriteTokens: sum("cachedWriteTokens"),
        cacheHitPercent: percent(sum("cachedReadTokens"), sum("inputTokens") + sum("cachedReadTokens") + sum("cachedWriteTokens")),
        outputTokensPerSecond: speedOf(withTokens),
      };
    })
    .sort((a, b) => b.turns - a.turns);
}

function dayUsage(turns: TurnRecord[], calls: CountedCall[]): DayUsage[] {
  const days = new Map<string, DayUsage>();
  const day = (at: number) => {
    const date = localDate(at);
    if (!days.has(date)) days.set(date, { date, turns: 0, toolCalls: 0, failed: 0, outputTokens: 0 });
    return days.get(date)!;
  };
  for (const turn of turns) {
    day(turn.endedAt).turns += 1;
    day(turn.endedAt).outputTokens += turn.usage?.outputTokens ?? 0;
  }
  for (const call of calls) {
    day(call.startedAt).toolCalls += 1;
    if (call.outcome === "failed") day(call.startedAt).failed += 1;
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** The conversations with the most turns; one that changed profile goes by the last profile it was on in the period. */
function busiestConversations(folded: FoldedConversation[]): BusyConversation[] {
  return [...Map.groupBy(folded, ({ conversation }) => conversation.id).values()]
    .map((pieces) => ({ ...pieces.at(-1)!, turns: pieces.flatMap(({ turns }) => turns), calls: pieces.flatMap(({ calls }) => calls) }))
    .filter(({ turns }) => turns.length > 0)
    .sort((a, b) => b.turns.length - a.turns.length || b.calls.length - a.calls.length)
    .slice(0, LISTED_CONVERSATIONS)
    .map(({ conversation, profile, turns, calls }) => ({
      title: conversation.title,
      workspace: conversation.workspaceName,
      profile,
      turns: turns.length,
      toolCalls: calls.length,
      lastActivity: localTime(conversation.lastEventAt!),
    }));
}
