import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { windowsPidOf } from "./command-shell.ts";
import { loadConfig } from "./config.ts";
import { DeviceService } from "./devices.ts";
import { JoinRequestService } from "./join-requests.ts";
import { SIGN_IN_CODE_LIFETIME_MINUTES, SignInCodes, signInLink } from "./sign-in-codes.ts";
import { Store } from "./store.ts";
import { connectedFrom, deviceStatus, joinedOn } from "../shared/devices.ts";
import type { JoinRequest, ListedDevice } from "../shared/model.ts";
import { isContainerName, isPid, isSshHost, waitSetUpReply, type JobWaitRequest } from "../shared/job-waits.ts";
import { inviteLink } from "../shared/machines.ts";
import { UsageData } from "./usage-data.ts";
import { toolReport, usageReport, UsageQueryError, type Finding, type ToolReport, type Totals, type UsageReport } from "./usage-stats.ts";

const usage = `usage: mirador <command>

  sign-in    Make a one-time link a browser on this machine signs in to Mirador with
  invite     Make a one-time code another browser or app joins this Mirador with
  approve    Let in the devices that ask to join this Mirador, by typing the number each shows
  devices    List the devices that joined this Mirador, and which are connected now
  when-done  Have Mirador wait for a job an agent left running, then send the agent a message (run it from the agent)
  message    Send the agent's conversation a message as your next one (run it from the agent, or a script it started)
  usage      Show how you work with Mirador's agents: their tools and how often each succeeds, permissions, turns, tokens`;

const usageUsage = `usage: mirador usage [--since <12h|7d|2w|date>] [--until <date>] [--workspace <name or folder>] [--profile <name>] [--tool <name>] [--compare] [--json]

  How you worked with Mirador's agents over a period, the last 30 days unless told otherwise, in every workspace and
  profile or one: what to improve, each profile's numbers, the tools agents call most and how often each succeeds, why
  calls fail, where tools come from, permission prompts, how long you take to reply, turns, tokens and speed per model,
  and the busiest conversations and those left untouched longest. --tool looks into one tool. --compare adds the numbers
  of the period before. --json prints the report as JSON, with the definitions of its numbers and samples of what you
  ask and what agents ask you, for agents and scripts.`;

const whenDoneUsage = `usage: mirador when-done (--pid <pid> | --container <name>) [--host <user@host>] [--no-resume] [--session <agent session id>] ["<message>"]

  Mirador waits for the process or Docker/Podman container to end, on this machine or, with --host, on another one over ssh.
  Then the message goes to the agent's conversation as your next message, so the agent carries on;
  with --no-resume only you are told. Without a message, it says the job ended.
  Run it from an agent in Mirador: it needs MIRADOR_URL, MIRADOR_SCRIPT_TOKEN and CLAUDE_CODE_SESSION_ID, PI_SESSION_ID or CODEX_SESSION_ID (or --session).`;

const messageUsage = `usage: mirador message [--session <agent session id>] ["<message>"]   (no message: read it from stdin)

  The message goes to the agent's conversation as your next message: right away when the agent is idle, else queued behind its turn.
  A job the agent left running can end with it, so the agent picks up where the job leaves off.
  Run it from an agent in Mirador, or a script it started: it needs MIRADOR_URL, MIRADOR_SCRIPT_TOKEN and CLAUDE_CODE_SESSION_ID, PI_SESSION_ID or CODEX_SESSION_ID (or --session).
  opencode gives its commands no session id, so its conversations can only be reached with --session.`;

/** The host prints a sign-in link only to a terminal, and each link works once, so a new browser needs a new link. */
function signIn() {
  const config = loadConfig();
  const store = new Store(config.databasePath);
  const code = new SignInCodes(store).mint();
  store.close();
  console.log(`Open this link in the browser to sign in (it works once, for ${SIGN_IN_CODE_LIFETIME_MINUTES} minutes):\n\n  ${signInLink(config.appOrigin, code)}\n`);
}

/** Makes an invite on this machine, for the first device to join it; joined devices invite more from Settings → Devices. */
function invite() {
  const config = loadConfig();
  const store = new Store(config.databasePath);
  const { code, expiresAt } = new DeviceService(store).invite();
  const publicOrigin = config.publicOrigin ?? store.rememberedPublicAddress()?.origin ?? null;
  const authorityFingerprint = store.rememberedAuthorityFingerprint();
  store.close();

  console.log(`Invite code: ${code} (works once, for ${minutesLeft(expiresAt)} minutes)`);
  if (publicOrigin) console.log(`Open it on the device that joins: ${inviteLink(publicOrigin, code, authorityFingerprint)}`);
  else console.log("Type it where the machine asks for an invite code. To get a link, give this machine its address in Settings → Devices.");
}

const minutesLeft = (until: number) => Math.max(1, Math.round((until - Date.now()) / 60_000));

function describe({ name, fromAddress, tailscaleUser, expiresAt }: JoinRequest) {
  const signedInAs = tailscaleUser ? `, signed in to Tailscale as ${tailscaleUser}` : "";
  return `${name} asks to join, from ${fromAddress}${signedInAs} (${minutesLeft(expiresAt)} minutes left).`;
}

/** Answers each waiting request in turn, on this machine, e.g. over ssh while no page of it is open anywhere. */
async function approve() {
  const store = new Store(loadConfig().databasePath);
  const requests = new JoinRequestService(store, new DeviceService(store), store.rememberedAuthorityFingerprint());
  const waiting = requests.waiting();
  if (waiting.length === 0) console.log("No device is asking to join this Mirador.");
  for (const request of waiting) {
    console.log(describe(request));
    const answer = prompt("Type the number it shows to approve it, d to deny it, or Enter to leave it waiting:")?.trim();
    if (!answer) console.log("Left waiting.");
    else if (answer.toLowerCase() === "d") {
      requests.deny(request.id);
      console.log("Denied.");
    } else if (await requests.approve(request.id, answer)) console.log(`Approved. ${request.name} gets in when it next checks, within seconds.`);
    else console.log("That is not the number it shows, so its request was denied. It can ask again.");
  }
  store.close();
}

/** The running host knows who is connected; without it, the database still knows when each device was last seen. */
async function listDevices() {
  const config = loadConfig();
  const response = await fetch(`${config.appOrigin}/devices`, { headers: { Authorization: `Bearer ${config.browserToken}` } }).catch(() => null);
  if (!response) console.log(`Mirador is not running at ${config.appOrigin}, so no device is connected to it.`);
  else if (!response.ok) console.log(`Mirador at ${config.appOrigin} would not say which devices are connected (${response.status} ${await response.text()}).`);
  const devices = response?.ok ? ((await response.json()) as { devices: ListedDevice[] }).devices : storedDevices(config.databasePath);
  if (devices.length === 0) return console.log("No device has joined this Mirador yet. Let one in with mirador invite.");
  printColumns(devices.map((device) => [device.name, deviceStatus(device), device.connection ? connectedFrom(device.connection) : "", `joined ${joinedOn(device.joinedAt)}`]));
}

function storedDevices(databasePath: string): ListedDevice[] {
  const store = new Store(databasePath);
  const devices = new DeviceService(store).list();
  store.close();
  return devices.map((device) => ({ ...device, connection: null }));
}

/** Lined up, leaving out a column nobody has a value in. */
function printColumns(rows: string[][]) {
  const widths = rows[0]!.map((_, column) => Math.max(...rows.map((row) => row[column]!.length)));
  const filled = (row: string[]) => row.flatMap((cell, column) => (widths[column] ? [cell.padEnd(widths[column])] : []));
  rows.forEach((row) => console.log(filled(row).join("   ").trimEnd()));
}

const startedFromGitBash = process.platform === "win32" && process.env.MSYSTEM !== undefined;

function jobWaitRequest(args: string[]): { session: string | undefined; request: JobWaitRequest } {
  const { values, positionals } = parseArgs({
    args,
    options: { pid: { type: "string" }, container: { type: "string" }, host: { type: "string" }, "no-resume": { type: "boolean" }, session: { type: "string" } },
    allowPositionals: true,
  });
  const { pid, container, host = null, session } = values;
  if ((pid === undefined) === (container === undefined)) throw new Error("name the job with either --pid or --container");
  if (pid !== undefined && !isPid(Number(pid))) throw new Error(`"${pid}" is not a process id`);
  if (container !== undefined && !isContainerName(container)) throw new Error(`"${container}" is not a container name or id`);
  if (host !== null && !isSshHost(host)) throw new Error(`"${host}" is not a host ssh can reach: give user@host or a name from your ssh config`);
  const pidOnThisMachine = (pid: number) => (startedFromGitBash && host === null ? windowsPidOf(pid) : pid);
  const job = pid !== undefined ? { kind: "process" as const, pid: pidOnThisMachine(Number(pid)) } : { kind: "container" as const, name: container! };
  return { session, request: { job, sshHost: host, message: positionals.join(" ") || null, resume: !values["no-resume"] } };
}

/** Plain, unlike console.error, which Bun colours red on a terminal: agents read this. */
function fail(command: string, problem: string, exitCode: number) {
  process.stderr.write(`mirador ${command}: ${problem}\n`);
  process.exitCode = exitCode;
}

class NotFromAnAgent extends Error {}

const problemWithUsage = (error: unknown, usage: string) => (error instanceof NotFromAnAgent ? error.message : `${(error as Error).message}\n\n${usage}`);

/** Mirador gives its agents the URL and token, and Claude Code and pi give every command they run its session id; a script started from there inherits all three. */
function agentConversation(session: string | undefined) {
  const { MIRADOR_URL: url, MIRADOR_SCRIPT_TOKEN: token } = process.env;
  if (!url || !token) throw new NotFromAnAgent("MIRADOR_URL and MIRADOR_SCRIPT_TOKEN are not set; run it from an agent in Mirador, or a script it started");
  const sessionId = session ?? (process.env.CLAUDE_CODE_SESSION_ID || process.env.PI_SESSION_ID || process.env.CODEX_SESSION_ID);
  if (!sessionId) throw new NotFromAnAgent("none of CLAUDE_CODE_SESSION_ID, PI_SESSION_ID and CODEX_SESSION_ID is set; pass --session");
  const post = (path: string, contentType: string, body: string) =>
    fetch(`${url}/sessions/${encodeURIComponent(sessionId)}/${path}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType }, body }).catch(() => null);
  return { post, unreachable: `could not reach Mirador at ${url}` };
}

/** Lets the agent end its turn instead of polling: the host checks on the job, and the agent hears back when it ends. */
async function whenDone(args: string[]) {
  let parsed: ReturnType<typeof jobWaitRequest>;
  let conversation: ReturnType<typeof agentConversation>;
  try {
    parsed = jobWaitRequest(args);
    conversation = agentConversation(parsed.session);
  } catch (error) {
    return fail("when-done", problemWithUsage(error, whenDoneUsage), 2);
  }
  const response = await conversation.post("job-waits", "application/json", JSON.stringify(parsed.request));
  if (!response?.ok) return fail("when-done", response ? await response.text() : conversation.unreachable, 1);
  const { wait } = await response.json();
  console.log(waitSetUpReply(wait));
}

/** Like command substitution in a shell, which drops the newline a piped message ends with. */
const withoutFinalNewlines = (text: string) => text.replace(/[\r\n]+$/, "");

/** The message is the user's next one, sent right away when the agent is idle, else queued behind its turn. */
async function message(args: string[]) {
  let typed: string;
  let conversation: ReturnType<typeof agentConversation>;
  try {
    const { values, positionals } = parseArgs({ args, options: { session: { type: "string" } }, allowPositionals: true });
    typed = positionals.join(" ");
    conversation = agentConversation(values.session);
    if (!typed && process.stdin.isTTY) throw new Error("no message given");
  } catch (error) {
    return fail("message", problemWithUsage(error, messageUsage), 2);
  }
  const text = typed || withoutFinalNewlines(await Bun.stdin.text());
  if (!text) return fail("message", `the message is empty\n\n${messageUsage}`, 2);
  const response = await conversation.post("messages", "text/plain; charset=utf-8", text);
  if (!response?.ok) return fail("message", response ? await response.text() : conversation.unreachable, 1);
}

/** Reads the database directly, so it works with Mirador stopped too, read-only, so it never holds up Mirador's writes. */
function showUsage(args: string[]) {
  let values: { since?: string; until?: string; workspace?: string; profile?: string; tool?: string; compare?: boolean; json?: boolean };
  try {
    ({ values } = parseArgs({
      args,
      options: {
        since: { type: "string" },
        until: { type: "string" },
        workspace: { type: "string" },
        profile: { type: "string" },
        tool: { type: "string" },
        compare: { type: "boolean" },
        json: { type: "boolean" },
      },
    }));
  } catch (error) {
    return fail("usage", problemWithUsage(error, usageUsage), 2);
  }
  const { databasePath } = loadConfig();
  if (!existsSync(databasePath)) return fail("usage", `there is no Mirador database at ${databasePath} yet`, 1);
  const data = UsageData.open(databasePath);
  try {
    const { tool } = values;
    const report = tool ? toolReport(data, { ...values, tool }) : usageReport(data, values);
    if (values.json) console.log(JSON.stringify(report, null, 2));
    else if ("tool" in report) printToolUsage(report);
    else printUsage(report);
  } catch (error) {
    if (!(error instanceof UsageQueryError)) throw error;
    fail("usage", error.message, 2);
  } finally {
    data.close();
  }
}

const count = (value: number) => value.toLocaleString("en-US");
const counted = (value: number, thing: string) => `${count(value)} ${thing}${value === 1 ? "" : "s"}`;
const share = (value: number | null) => (value === null ? "-" : `${value}%`);

function duration(seconds: number | null) {
  if (seconds === null) return "-";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${Math.round(seconds % 60)}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function totalsLine(totals: Totals) {
  return `${counted(totals.conversations, "conversation")}, ${counted(totals.turns, "turn")}, ${counted(totals.toolCalls, "tool call")}, ${share(totals.successPercent)} of them succeeded`;
}

function printFindings(findings: Finding[]) {
  if (findings.length === 0) return;
  console.log("\nWhat to improve");
  for (const { seen, suggestion } of findings) console.log(`- ${seen}\n  ${suggestion}`);
}

function printUsage(report: UsageReport) {
  const { period, workspace, profile, totals, previousPeriod, findings, profiles, tools, otherTools, sources, permissions, responses, turns, models, conversations } = report;
  console.log(`Mirador usage from ${period.from} to ${period.to}, ${workspace}, ${profile}`);
  console.log(totalsLine(totals));
  if (previousPeriod) console.log(`Before, from ${previousPeriod.from}: ${previousPeriod.totals ? totalsLine(previousPeriod.totals) : "nothing"}`);
  const before = <T>(column: T[]) => (previousPeriod ? column : []);
  printFindings(findings);
  if (profiles.length > 0) {
    console.log("");
    printColumns([
      ["Profile", "Agent", "Turns", "Calls", "Success", ...before(["Before"]), "Turn", "Your reply", "Output/s"],
      ...profiles.map((each) => [
        each.profile,
        each.agent,
        count(each.totals.turns),
        count(each.totals.toolCalls),
        share(each.totals.successPercent),
        ...before([share(each.before?.successPercent ?? null)]),
        duration(each.totals.medianTurnSeconds),
        duration(each.totals.medianReplySeconds),
        each.totals.outputTokensPerSecond === null ? "-" : String(each.totals.outputTokensPerSecond),
      ]),
    ]);
  }
  if (tools.length > 0) {
    console.log("");
    printColumns([
      ["Tool", "Calls", "Succeeded", "Failed", "Denied", "Cancelled", "Success", ...before(["Before"]), "Median", "90%"],
      ...tools.map((tool) => [
        tool.tool,
        count(tool.calls),
        count(tool.succeeded),
        count(tool.failed),
        count(tool.denied),
        count(tool.cancelled),
        share(tool.successPercent),
        ...before([share(tool.before?.successPercent ?? null)]),
        duration(tool.medianSeconds),
        duration(tool.p90Seconds),
      ]),
    ]);
    if (otherTools) console.log(`and ${counted(otherTools.tools, "more tool")}, with ${counted(otherTools.calls, "call")}`);
  }
  const failing = tools.filter(({ failureReasons }) => failureReasons.length > 0);
  if (failing.length > 0) {
    console.log("\nWhy calls failed");
    printColumns(failing.map(({ tool, failureReasons }) => [tool, failureReasons.map(({ reason, calls }) => `${reason} (${calls})`).join(", ")]));
  }
  if (sources.length > 0) console.log(`\nWhere tools come from: ${sources.map(({ source, sharePercent }) => `${source} ${share(sharePercent)}`).join(", ")}`);
  console.log(
    `\nPermissions: asked ${counted(permissions.asked, "time")}; allowed once ${count(permissions.allowedOnce)}, always ${count(permissions.allowedAlways)}, rejected ${count(permissions.rejected)}, unanswered ${count(permissions.unanswered)}; answered in ${duration(permissions.medianSecondsToAnswer)} (median)`,
  );
  const { afterTurns, toQuestions } = responses;
  console.log(
    `You: replied ${counted(afterTurns.replies, "time")} within an hour of a turn's end, in ${duration(afterTurns.medianSeconds)} (median), ${duration(afterTurns.p90Seconds)} at 90%, and came back later ${counted(afterTurns.cameBackLater, "time")}; answered ${count(toQuestions.answered)} of ${counted(toQuestions.asked, "question")} in ${duration(toQuestions.medianSeconds)} (median)${toQuestions.timedOut > 0 ? `, ${count(toQuestions.timedOut)} timed out` : ""}`,
  );
  const endedBy = Object.entries(turns.endedBy).map(([reason, times]) => `${reason} ${times}`);
  console.log(
    `Turns: ${count(turns.count)}, ${duration(turns.medianSeconds)} median, ${duration(turns.p90Seconds)} at 90%, ${turns.medianToolCalls ?? "-"} tool calls median${endedBy.length > 0 ? `; ended by ${endedBy.join(", ")}` : ""}`,
  );
  if (models.length > 0) {
    console.log("");
    printColumns([
      ["Model", "Turns", "Input", "Output", "Cache read", "Cache write", "Cache hits", "Output/s"],
      ...models.map((model) => [
        model.model,
        count(model.turns),
        count(model.inputTokens),
        count(model.outputTokens),
        count(model.cachedReadTokens),
        count(model.cachedWriteTokens),
        share(model.cacheHitPercent),
        model.outputTokensPerSecond === null ? "-" : String(model.outputTokensPerSecond),
      ]),
    ]);
  }
  if (conversations && conversations.busiest.length > 0) {
    console.log("\nBusiest conversations");
    printColumns(conversations.busiest.map(({ title, workspace, profile, turns, toolCalls }) => [title, workspace, profile, counted(turns, "turn"), counted(toolCalls, "tool call")]));
  }
  if (conversations && conversations.untouchedLongest.length > 0) {
    console.log("\nUntouched longest");
    printColumns(conversations.untouchedLongest.map(({ title, workspace, profile, lastActivity, idleDays }) => [title, workspace, profile, `${counted(idleDays, "day")}, since ${lastActivity}`]));
  }
  console.log("\nFor agents and scripts: mirador usage --json, which adds samples of what you ask and what agents ask you");
}

function printToolUsage({ period, workspace, profile, tool, findings }: ToolReport) {
  console.log(`${tool.tool} from ${period.from} to ${period.to}, ${workspace}, ${profile}`);
  console.log(
    `${counted(tool.calls, "call")}: ${count(tool.succeeded)} succeeded, ${count(tool.failed)} failed, ${count(tool.denied)} denied, ${count(tool.cancelled)} cancelled; ${share(tool.successPercent)} success${tool.before ? `, ${share(tool.before.successPercent)} before` : ""}; ${duration(tool.medianSeconds)} median, ${duration(tool.p90Seconds)} at 90%`,
  );
  console.log("");
  printColumns([["Profile", "Calls", "Failed", "Success"], ...tool.byProfile.map((each) => [each.profile, count(each.calls), count(each.failed), share(each.successPercent)])]);
  if (tool.failureReasons.length > 0) console.log(`\nWhy calls failed: ${tool.failureReasons.map(({ reason, calls }) => `${reason} (${calls})`).join(", ")}`);
  if (tool.failureExamples.length > 0) {
    console.log("\nFailed calls");
    printColumns(tool.failureExamples.map(({ at, input, result }) => [at, input, result]));
  }
  if (tool.slowestCalls.length > 0) {
    console.log("\nSlowest calls");
    printColumns(tool.slowestCalls.map(({ input, seconds, at }) => [duration(seconds), at, input]));
  }
  printFindings(findings);
}

const commands = new Map<string, (args: string[]) => void | Promise<void>>([
  ["sign-in", signIn],
  ["invite", invite],
  ["approve", approve],
  ["devices", listDevices],
  ["when-done", whenDone],
  ["message", message],
  ["usage", showUsage],
]);
const asksForHelp = (command: string | undefined) => command === undefined || ["help", "--help", "-h"].includes(command);

const [command] = process.argv.slice(2);
const run = command === undefined ? undefined : commands.get(command);
if (run) await run(process.argv.slice(3));
else if (asksForHelp(command)) console.log(usage);
else {
  console.error(`mirador: unknown command "${command}"\n\n${usage}`);
  process.exitCode = 2;
}
