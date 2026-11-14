import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk/unstable";
import { isSideChatBrief } from "../shared/side-chats.ts";

/**
 * An agent that takes every prompt and never finishes it, ignoring `session/cancel`, the way a model request against a
 * llama.cpp still loading its model leaves a turn: the agent is wedged, so only killing its process ends the turn.
 * A prompt starting with CRASH makes the process die in the middle of the turn instead; CRASH LEAVING A CHILD first
 * starts a process that holds the agent's output open for a minute. One of `EDIT ` and a JSON
 * array of edits asks permission for each edit at once, and ends the turn with what the user answered to each; `TOOLS `
 * and a JSON array of `{"kind": toolKind, "title": text}` does the same for tools of any kind.
 * `WRITE ` and a JSON array of steps changes files as it goes: `{"edit": path, "content": text}` writes the file with
 * an edit tool call and its diff, `{"shell": path, "content": text}` writes it from a shell command, `{"read": path}`
 * reads it with a tool call that names it, and `{"waitFor": path}` holds the turn until that file exists. Its paths
 * and texts fill in `{{folder}}` with the folder the session was started in, as `FOLDER` says, and `{{env:NAME}}`
 * with the agent process's environment variable NAME, or nothing when it isn't set; no other command fills them in.
 * `{"usage": "<used> <size> [costUsd]"}` reports that usage as `USAGE ` does, and ends the turn with those tokens as
 * the turn's own, so a run's totals show them, and `{"pause": "<ms>"}` takes that long before the next step. `SAY `
 * followed by text answers with that text, as markdown, `TITLE ` followed by text titles the session so, as agents
 * rename a conversation from its work, and answers,
 * `USAGE ` followed by the tokens used, the window's size and, if given, a cost in US dollars reports that usage,
 * and `/compact` reports the context shrunk to a tenth of the window last reported, as an agent's summary leaves it,
 * and `FAIL ` followed by text fails the turn with that text as its error. `SUBAGENT ASKS ` followed by a title starts a
 * subagent whose step asks permission, and ends the turn with what the user answered.
 * `NOTICE` sends the notices claude-agent-acp sends for hook output, a stopped task and a model fallback: a `notice`
 * update when the client advertised `session.notices` at initialize, the bold-label transcript line when not, and then answers.
 * `STOPPED REPLY ` streams half of a reply and `STOPPED BEFORE ` streams none of it: either ends its turn as cancelled
 * once `session/cancel` arrives, and a moment after the stop streams the reply's rest under the id it streamed under
 * before, together with a subagent's report — the late chunks claude-agent-acp sends for a turn its cancel cut short.
 * `FOLDER` says the folder the session was started in.
 * `STOPPED BESIDE SUBAGENT ` does as `STOPPED BEFORE ` while a background subagent's command is still running at the stop.
 * `STOPPED QUIET ` streams nothing, ends as cancelled on the stop and sends nothing after it, as a stop that interrupted
 * the request leaves things. `FINISHED ON STOP ` begins a reply, and once `session/cancel` arrives finishes it and
 * ends the turn as done, as Claude Code does when its answer was already complete as the stop came.
 * `REPLY TOOL REPLY ` answers as Claude Code does around a tool: a reply under one id, a tool call, and a reply under
 * the next id. `REPLY STEERED ` begins a reply, waits for a message steered into the turn and
 * answers it under the next id. `ENDS UNREAD ` begins a reply, takes a message steered into the turn and ends it without
 * reading it, saying so, as pi does when the message came after its last look at its queue. `TOOL UNTIL ` and a path
 * runs a command until that file exists, then ends the turn at once, before a steer the command's end set off can reach
 * the agent.
 * `ASYNC TASK` starts a background task the way claude-agent-acp does with its `asyncTasks` capability: a spawn update,
 * a progress beat shortly after, and output lines appended to a file under `FAKE_ACP_TASK_OUTPUT_DIR`; with ` DONE`
 * after it the task completes on its own too, with ` STUCK` a Stop fails on it with an error, and with ` LONG` it
 * completes with a many-line command as its description. The
 * `_session/async_task/stop` request stops one and says so, logging it.
 * Prompts are appended to the file in `FAKE_ACP_PROMPTS`, so a test can see a turn was sent again after the kill.
 *
 * Its profile can give it more: `FAKE_ACP_MODES=1` offers Mode and Effort options and lets sessions be closed, with
 * `FAKE_ACP_MODELS=1` a Model option before them too, whose Haiku has no Effort option, as Claude Code's hasn't, and
 * then `CHOICES` answers with what the session is on, such as "On model opus, mode default, effort high.". And
 * `FAKE_ACP_ANSWERS_AFTER_MS` answers option changes and closes that late, as Claude Code does while its first
 * request waits for a model server to load the model. Starts, changes and closes go to the file in `FAKE_ACP_LOG`,
 * each with the name in `FAKE_ACP_NAME`. FAKE_ACP_IGNORES_SIGTERM=1 makes it survive SIGTERM, and FAKE_ACP_PID_FILE
 * names a file it writes its pid to. `FAKE_ACP_STEERS=1` offers claude-agent-acp's `_session/steering`: a message
 * steered into a `REPLY STEERED ` or `ENDS UNREAD ` turn joins it, any other is refused as needing a prompt of its own.
 * `FAKE_ACP_RESUMES=1` closes and resumes sessions, logging new, closed and resumed ones.
 * `FAKE_ACP_COMMANDS`, a JSON list of ACP available commands, is announced as each session starts, for its / menu.
 * A side chat's brief, sent before its first question, is written to the prompts file but leaves the commands alone.
 * Its start, its sessions and the prompts it takes go to stderr, which the host stamps into the agent's log, so a kept
 * test host's log tells how far a turn got.
 */
const promptsFile = process.env.FAKE_ACP_PROMPTS;
const availableCommands: acp.AvailableCommand[] | null = process.env.FAKE_ACP_COMMANDS ? JSON.parse(process.env.FAKE_ACP_COMMANDS) : null;
const offersModes = process.env.FAKE_ACP_MODES === "1";
const offersModels = process.env.FAKE_ACP_MODELS === "1";
const answersAfterMs = Number(process.env.FAKE_ACP_ANSWERS_AFTER_MS ?? 0);
const ignoresSigterm = process.env.FAKE_ACP_IGNORES_SIGTERM === "1";
const offersSteering = process.env.FAKE_ACP_STEERS === "1";
/** Closes and resumes sessions for real, logging both and each new session. */
const resumes = process.env.FAKE_ACP_RESUMES === "1";
/** Offers to resume a session, and cannot: as an agent whose record of the session is gone. */
const resumeFails = process.env.FAKE_ACP_RESUME_FAILS === "1";
/** Forks sessions, and loads a fork as a session of its own with no history to replay. */
const forks = process.env.FAKE_ACP_FORKS === "1";
const forkedSessions = new Set<string>();
/** A session of its own past, to list and load: `{ sessionId, title, updates }`, its updates replayed on load. */
const history: { sessionId: string; title: string; updates: acp.SessionUpdate[] } | null = process.env.FAKE_ACP_HISTORY
  ? JSON.parse(readFileSync(process.env.FAKE_ACP_HISTORY, "utf8"))
  : null;
const startsWith = (prompt: acp.ContentBlock[], word: string) => prompt.every((block) => block.type === "text" && block.text.startsWith(word));

const log = (entry: string) => process.env.FAKE_ACP_LOG && appendFileSync(process.env.FAKE_ACP_LOG, `${process.env.FAKE_ACP_NAME ?? "agent"} ${entry}\n`);
const trace = (step: string) => process.stderr.write(`fake agent ${process.pid}: ${step}\n`);
const answerLate = async <T>(answer: () => T) => {
  await Bun.sleep(answersAfterMs);
  return answer();
};

const chosen = new Map<string, Record<string, string>>();
const choice = (sessionId: string, configId: string, otherwise: string) => chosen.get(sessionId)?.[configId] ?? otherwise;
const configOptions = (sessionId: string): acp.SessionConfigOption[] => [
  {
    id: "mode",
    name: "Mode",
    category: "mode",
    type: "select",
    currentValue: choice(sessionId, "mode", "default"),
    options: [
      { value: "default", name: "Default" },
      { value: "plan", name: "Plan" },
    ],
  },
  {
    id: "effort",
    name: "Effort",
    category: "thought_level",
    type: "select",
    currentValue: choice(sessionId, "effort", "low"),
    options: [
      { value: "low", name: "Low" },
      { value: "high", name: "High" },
    ],
  },
];

/** Its default names the model in its description, as Claude Code's does. */
const modelOption = (sessionId: string): acp.SessionConfigOption => ({
  id: "model",
  name: "Model",
  category: "model",
  type: "select",
  currentValue: choice(sessionId, "model", "default"),
  options: [
    { value: "default", name: "Default (recommended)", description: "Sonnet 5" },
    { value: "opus", name: "Opus" },
    { value: "haiku", name: "Haiku" },
  ],
});

const offeredOptions = (sessionId: string): acp.SessionConfigOption[] => {
  if (!offersModels) return configOptions(sessionId);
  const options = [modelOption(sessionId), ...configOptions(sessionId)];
  return choice(sessionId, "model", "default") === "haiku" ? options.filter(({ category }) => category !== "thought_level") : options;
};

const sayChoices = (client: acp.AgentContext, sessionId: string) =>
  sayText(client, sessionId, `On ${offeredOptions(sessionId).map(({ id, currentValue }) => `${id} ${currentValue}`).join(", ")}.`);

/** Whether the client can present `notice` updates, taken from its initialize request the way claude-agent-acp takes it. */
let noticesAdvertised = false;

/** Whether the client shows background tasks, taken the same way from the advertised AIR capabilities. */
let asyncTasksAdvertised = false;

const taskOutputDir = process.env.FAKE_ACP_TASK_OUTPUT_DIR ?? process.cwd();
const asyncTaskStates = new Map<string, string>();
let nextAsyncTask = 0;

const taskUpdate = (client: acp.AgentContext, sessionId: string, update: object) =>
  client.notify(acp.methods.client.session.update, { sessionId, update: update as acp.SessionUpdate });

/** The task updates one of these own background tasks carries: the spawn, a progress beat, and with `done` its end. */
const tasksThatWillNotStop = new Set<string>();

const LONG_TASK_DESCRIPTION = `cd /work; cat > probe.ts <<'EOF'\n${"const probe = measureEverythingInTheSidebar(); ".repeat(40)}\nEOF\nbun probe.ts`;

async function startAsyncTask(client: acp.AgentContext, sessionId: string, done: boolean, willNotStop = false, description = "sleep 30") {
  if (!asyncTasksAdvertised) return sayText(client, sessionId, "Nothing to run in the background here.");
  const asyncTaskId = `fake-task-${process.pid}-${++nextAsyncTask}`;
  const outputFilePath = `${taskOutputDir}/async-task-${asyncTaskId}.log`;
  writeFileSync(outputFilePath, "the task started\n");
  asyncTaskStates.set(asyncTaskId, "running");
  if (willNotStop) tasksThatWillNotStop.add(asyncTaskId);
  await taskUpdate(client, sessionId, { sessionUpdate: "async_task_spawned", asyncTaskId, taskType: "shell", description, canStop: true, outputFilePath });
  setTimeout(() => {
    if (asyncTaskStates.get(asyncTaskId) !== "running") return;
    appendFileSync(outputFilePath, "still sleeping\n");
    void taskUpdate(client, sessionId, { sessionUpdate: "async_task_progress", asyncTaskId, summary: "Still running after 10s", usage: { totalTokens: 120 }, outputFilePath });
  }, 300);
  if (done) {
    setTimeout(() => {
      if (asyncTaskStates.get(asyncTaskId) !== "running") return;
      asyncTaskStates.set(asyncTaskId, "completed");
      appendFileSync(outputFilePath, "done sleeping\n");
      void taskUpdate(client, sessionId, { sessionUpdate: "async_task_state_update", asyncTaskId, state: "completed", summary: "Task completed", outputFilePath });
    }, 900);
  }
  return { stopReason: "end_turn" as const };
}

/** Ends a running task, the way the adapter claims a stop and then reports the stopped state. */
async function stopAsyncTask(client: acp.AgentContext, sessionId: string, asyncTaskId: string) {
  log(`stopped ${asyncTaskId}`);
  if (tasksThatWillNotStop.has(asyncTaskId)) throw acp.RequestError.internalError(undefined, "The task would not stop");
  if (asyncTaskStates.get(asyncTaskId) !== "running") return { stopped: false };
  asyncTaskStates.set(asyncTaskId, "stopped");
  await taskUpdate(client, sessionId, { sessionUpdate: "async_task_state_update", asyncTaskId, state: "stopped", summary: "Task stopped by user" });
  return { stopped: true };
}

/** A hook's several lines, whose first claude-agent-acp lets stand as the notice's title, ending in the newline hook output ends in, and two shorter notices. */
const NOTICES = [
  {
    severity: "info",
    title: "SessionStart:compact says: <persisted-output>",
    description: ["Recent context, needle in it", "", "Mode: code"].map((line) => `SessionStart:compact says: ${line}\n`).join(""),
  },
  { severity: "warning", title: "PreToolUse:Bash says: rm -rf was blocked" },
  { severity: "warning", title: "Fast mode turned off", description: "Claude could not serve it right now." },
];

/** Each notice as a `notice` update when the client advertised the capability, else as the bold-label transcript line claude-agent-acp falls back to. */
async function sendNotices(client: acp.AgentContext, sessionId: string) {
  for (const { severity, title, description } of NOTICES) {
    const update: acp.SessionUpdate = noticesAdvertised
      ? { sessionUpdate: "notice", severity, title, ...(description ? { description } : {}) }
      : { sessionUpdate: "agent_message_chunk", content: { type: "text", text: description ? `**${title}:** ${description}` : `**${title}**` } };
    await client.notify(acp.methods.client.session.update, { sessionId, update });
  }
  return sayText(client, sessionId, "Carrying on.");
}

let nextSession = 0;

interface ProposedEdit {
  title: string;
  path: string;
  oldText: string | null;
  newText: string;
}

const permissionOptions: acp.PermissionOption[] = [
  { optionId: "allow", name: "Allow", kind: "allow_once" },
  { optionId: "always", name: "Always allow", kind: "allow_always" },
  { optionId: "reject", name: "Reject", kind: "reject_once" },
];

/** Asks permission for every tool call at once, and ends the turn with what the user answered to each. */
async function askPermissions(client: acp.AgentContext, sessionId: string, toolCalls: (acp.ToolCallUpdate & { title: string })[]) {
  const answers = await Promise.all(
    toolCalls.map(async (toolCall) => {
      const response = await client.request(acp.methods.client.session.requestPermission, { sessionId, toolCall, options: permissionOptions });
      return `${toolCall.title}: ${response.outcome.outcome === "selected" ? response.outcome.optionId : "cancelled"}`;
    }),
  );
  await client.notify(acp.methods.client.session.update, { sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: answers.join("; ") } } });
  return { stopReason: "end_turn" as const };
}

const askToEdit = (client: acp.AgentContext, sessionId: string, edits: ProposedEdit[]) =>
  askPermissions(
    client,
    sessionId,
    edits.map(({ title, path, oldText, newText }, index) => ({ toolCallId: `edit-${index}`, title, kind: "edit", status: "pending", locations: [{ path }], content: [{ type: "diff", path, oldText, newText }] })),
  );

/** Tools of any other kind, named by their title alone, as Claude Code asks to read a file or fetch a page. */
const askToUseTools = (client: acp.AgentContext, sessionId: string, tools: { kind: acp.ToolKind; title: string }[]) =>
  askPermissions(client, sessionId, tools.map(({ kind, title }, index) => ({ toolCallId: `tool-${index}`, title, kind, status: "pending" })));

/** A subagent whose own step asks permission, as Claude Code does for a command a subagent wants to run. */
async function askFromSubagent(client: acp.AgentContext, sessionId: string, title: string) {
  const update = (update: acp.SessionUpdate) => client.notify(acp.methods.client.session.update, { sessionId, update });
  await update({
    sessionUpdate: "tool_call",
    toolCallId: "subagent-0",
    title: "Task",
    kind: "think",
    status: "in_progress",
    rawInput: { description: "look around", prompt: "look around" },
    _meta: { claudeCode: { toolName: "Task" } },
  });
  await update({ sessionUpdate: "tool_call", toolCallId: "subagent-0-step", title, kind: "execute", status: "pending", _meta: { claudeCode: { parentToolUseId: "subagent-0" } } });
  return askPermissions(client, sessionId, [{ toolCallId: "subagent-0-step", title, kind: "execute", status: "pending" }]);
}

type WriteStep = { edit: string; content: string } | { shell: string; content: string } | { read: string } | { waitFor: string } | { usage: string } | { pause: string };

let nextToolCall = 0;

async function writeFiles(client: acp.AgentContext, sessionId: string, steps: WriteStep[]) {
  const update = (update: acp.SessionUpdate) => client.notify(acp.methods.client.session.update, { sessionId, update });
  const folder = sessionFolders.get(sessionId) ?? "";
  const expand = (text: string) => text.replaceAll("{{folder}}", folder).replaceAll(/\{\{env:(\w+)\}\}/g, (_, name: string) => process.env[name] ?? "");
  const filledIn = steps.map((step) => Object.fromEntries(Object.entries(step).map(([field, value]) => [field, expand(value)])) as WriteStep);
  let usage: acp.Usage | undefined;
  for (const step of filledIn) {
    if ("usage" in step) {
      const [used = 0, size = 0, costUsd] = step.usage.split(" ").map(Number);
      await reportUsage(client, sessionId, used, size, costUsd);
      usage = { totalTokens: used, inputTokens: used, outputTokens: 0 };
      continue;
    }
    if ("pause" in step) {
      await Bun.sleep(Number(step.pause));
      continue;
    }
    if ("waitFor" in step) {
      while (!existsSync(step.waitFor)) await Bun.sleep(50);
      continue;
    }
    const toolCallId = `write-${++nextToolCall}`;
    if ("read" in step) {
      await update({ sessionUpdate: "tool_call", toolCallId, title: `Read ${step.read}`, kind: "read", status: "completed", locations: [{ path: step.read }] });
      continue;
    }
    const path = "edit" in step ? step.edit : step.shell;
    await update({ sessionUpdate: "tool_call", toolCallId, title: "edit" in step ? `Write ${path}` : `echo > ${path}`, kind: "edit" in step ? "edit" : "execute", status: "pending" });
    const oldText = existsSync(path) ? readFileSync(path, "utf8") : null;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, step.content);
    if ("edit" in step) await update({ sessionUpdate: "tool_call_update", toolCallId, locations: [{ path }], content: [{ type: "diff", path, oldText, newText: step.content }] });
    await update({ sessionUpdate: "tool_call_update", toolCallId, status: "completed" });
  }
  return { stopReason: "end_turn" as const, ...(usage && { usage }) };
}

/** The agent's own plan, as Claude Code sends its to-do list: each entry "done" or not, the first one not done in progress. */
async function makePlan(client: acp.AgentContext, sessionId: string, steps: { content: string; done: boolean }[]) {
  const firstOpen = steps.findIndex(({ done }) => !done);
  const entries = steps.map(({ content, done }, index): acp.PlanEntry => ({
    content,
    priority: "medium",
    status: done ? "completed" : index === firstOpen ? "in_progress" : "pending",
  }));
  await client.notify(acp.methods.client.session.update, { sessionId, update: { sessionUpdate: "plan", entries } });
  return { stopReason: "end_turn" as const };
}

const reportedWindows = new Map<string, number>();

async function reportUsage(client: acp.AgentContext, sessionId: string, used: number, size: number, costUsd?: number) {
  reportedWindows.set(sessionId, size);
  const cost = costUsd === undefined ? {} : { cost: { amount: costUsd, currency: "USD" } };
  await client.notify(acp.methods.client.session.update, { sessionId, update: { sessionUpdate: "usage_update", used, size, ...cost } });
  return { stopReason: "end_turn" as const };
}

async function sayText(client: acp.AgentContext, sessionId: string, text: string) {
  await client.notify(acp.methods.client.session.update, { sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } } });
  return { stopReason: "end_turn" as const };
}

async function titleSession(client: acp.AgentContext, sessionId: string, title: string) {
  await client.notify(acp.methods.client.session.update, { sessionId, update: { sessionUpdate: "session_info_update", title } });
  return sayText(client, sessionId, `Titled ${title}.`);
}

/** The turns waiting for the user's stop, by session. */
const stopWaiters = new Map<string, () => void>();
const sessionFolders = new Map<string, string>();
let nextStoppedReply = 0;

/** A turn the user stops: half a reply streamed, or none yet, ends as cancelled on the stop; the reply's rest and a subagent's report follow it, as claude-agent-acp's late chunks do. */
async function stoppedReply(client: acp.AgentContext, sessionId: string, text: string, streamedHalf: boolean, backgroundSubagentRunning = false) {
  const notify = (update: acp.SessionUpdate) => client.notify(acp.methods.client.session.update, { sessionId, update });
  const messageId = `msg-stopped-${process.pid}-${++nextStoppedReply}`;
  const subagentCallId = `subagent-${++nextToolCall}`;
  if (backgroundSubagentRunning) await startBackgroundSubagentCommand(notify);
  if (streamedHalf) await notify({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: `Half a reply about ${text}` }, messageId });
  await new Promise<void>((resolve) => stopWaiters.set(sessionId, resolve));
  setTimeout(() => {
    void notify({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: `The rest about ${text}` }, messageId });
    void notify({
      sessionUpdate: "tool_call",
      toolCallId: subagentCallId,
      title: "Task",
      kind: "think",
      status: "in_progress",
      rawInput: { description: "look around", prompt: "look around" },
      _meta: { claudeCode: { toolName: "Task" } },
    });
    void notify({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: `A subagent reports on ${text}` }, messageId, _meta: { claudeCode: { parentToolUseId: subagentCallId } } });
    void notify({ sessionUpdate: "tool_call_update", toolCallId: subagentCallId, status: "completed" });
  }, 300);
  return { stopReason: "cancelled" as const };
}

/** A subagent launched in the background, whose own command still runs: its launch has returned, its command's call stays open. */
async function startBackgroundSubagentCommand(notify: (update: acp.SessionUpdate) => Promise<void>) {
  const launchId = `subagent-${++nextToolCall}`;
  await notify({ sessionUpdate: "tool_call", toolCallId: launchId, title: "Task", kind: "think", status: "in_progress", rawInput: { description: "watch", prompt: "watch", run_in_background: true }, _meta: { claudeCode: { toolName: "Task" } } });
  await notify({ sessionUpdate: "tool_call_update", toolCallId: launchId, status: "completed" });
  await notify({ sessionUpdate: "tool_call", toolCallId: `${launchId}-step`, title: "sleep 60", kind: "execute", status: "in_progress", _meta: { claudeCode: { parentToolUseId: launchId } } });
}

/** A turn the user stops before any reply, whose request the stop interrupted, so no late reply follows. */
async function stoppedQuietly(sessionId: string) {
  await new Promise<void>((resolve) => stopWaiters.set(sessionId, resolve));
  return { stopReason: "cancelled" as const };
}

/** A reply, a tool call and another reply, each reply under its own id, as Claude Code starts a message after each tool result. */
async function replyAroundATool(client: acp.AgentContext, sessionId: string, text: string) {
  const notify = (update: acp.SessionUpdate) => client.notify(acp.methods.client.session.update, { sessionId, update });
  const toolCallId = `tool-${++nextToolCall}`;
  await notify({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: `Looking into ${text}` }, messageId: `msg-before-${toolCallId}` });
  await notify({ sessionUpdate: "tool_call", toolCallId, title: `Read ${text}`, kind: "read", status: "in_progress" });
  await notify({ sessionUpdate: "tool_call_update", toolCallId, status: "completed" });
  await notify({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: `Found ${text}` }, messageId: `msg-after-${toolCallId}` });
  return { stopReason: "end_turn" as const };
}

/** Tool calls that run and finish at once, each with the input given, as Claude Code sends `{}` for a tool that takes no parameters. */
async function runTools(client: acp.AgentContext, sessionId: string, tools: { title: string; kind: acp.ToolKind; rawInput: unknown }[]) {
  const notify = (update: acp.SessionUpdate) => client.notify(acp.methods.client.session.update, { sessionId, update });
  for (const { title, kind, rawInput } of tools) {
    const toolCallId = `tool-${++nextToolCall}`;
    await notify({ sessionUpdate: "tool_call", toolCallId, title, kind, status: "in_progress", rawInput });
    await notify({ sessionUpdate: "tool_call_update", toolCallId, status: "completed" });
  }
  return { stopReason: "end_turn" as const };
}

async function toolUntil(client: acp.AgentContext, sessionId: string, path: string) {
  const notify = (update: acp.SessionUpdate) => client.notify(acp.methods.client.session.update, { sessionId, update });
  const toolCallId = `tool-${++nextToolCall}`;
  await notify({ sessionUpdate: "tool_call", toolCallId, title: `wait for ${path}`, kind: "execute", status: "in_progress" });
  while (!existsSync(path)) await Bun.sleep(50);
  await notify({ sessionUpdate: "tool_call_update", toolCallId, status: "completed" });
  return { stopReason: "end_turn" as const };
}

const steerWaiters = new Map<string, (text: string) => void>();
let nextSteeredTurn = 0;

/** A reply the turn begins, then, under the next id, its answer to the message the user steered into it. */
async function replyThenSteered(client: acp.AgentContext, sessionId: string, text: string) {
  const notify = (update: acp.SessionUpdate) => client.notify(acp.methods.client.session.update, { sessionId, update });
  const turn = ++nextSteeredTurn;
  const steered = new Promise<string>((resolve) => steerWaiters.set(sessionId, resolve));
  await notify({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: `Starting on ${text}` }, messageId: `msg-begun-${turn}` });
  await notify({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: `Also ${await steered}` }, messageId: `msg-steered-${turn}` });
  return { stopReason: "end_turn" as const };
}

/** A reply the turn begins, then the turn's end, with the message steered into it unread. */
async function endsWithSteerUnread(client: acp.AgentContext, sessionId: string, text: string) {
  const steered = new Promise<string>((resolve) => steerWaiters.set(sessionId, resolve));
  await client.notify(acp.methods.client.session.update, { sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: `Starting on ${text}` } } });
  await steered;
  return { stopReason: "end_turn" as const, _meta: { steering: { unanswered: 1 } } };
}

function steerInto(sessionId: string, prompt: acp.ContentBlock[]) {
  const joinsTurn = steerWaiters.get(sessionId);
  if (!joinsTurn) return { outcome: "promptRequired" };
  steerWaiters.delete(sessionId);
  const answerAfterTakingIt = () => joinsTurn(prompt.map((block) => (block.type === "text" ? block.text : "")).join(""));
  setTimeout(answerAfterTakingIt, 100);
  return { outcome: "injected" };
}

async function streamWords(client: acp.AgentContext, sessionId: string, count: number) {
  for (const word of Array.from({ length: count }, (_, position) => `word${position + 1} `)) {
    await client.notify(acp.methods.client.session.update, { sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: word } } });
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return { stopReason: "end_turn" as const };
}

async function streamParagraphs(client: acp.AgentContext, sessionId: string, count: number) {
  const paragraphs = Array.from({ length: count }, (_, position) => `Paragraph ${position + 1} is long enough to wrap onto a second line in a narrow chat pane, as replies do.\n\n`);
  for (const paragraph of paragraphs) {
    await client.notify(acp.methods.client.session.update, { sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: paragraph } } });
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return { stopReason: "end_turn" as const };
}

async function finishedOnStop(client: acp.AgentContext, sessionId: string, text: string) {
  const notify = (chunk: string) => client.notify(acp.methods.client.session.update, { sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: chunk } } });
  await notify(`Begun on ${text}. `);
  await new Promise<void>((resolve) => stopWaiters.set(sessionId, resolve));
  await notify(`Finished ${text}.`);
  return { stopReason: "end_turn" as const };
}

if (ignoresSigterm) {
  process.on("SIGTERM", () => {});
  setInterval(() => {}, 60_000);
}
if (process.env.FAKE_ACP_PID_FILE) writeFileSync(process.env.FAKE_ACP_PID_FILE, String(process.pid));

log("started");
trace("started");
acp
  .agent()
  .onRequest(acp.methods.agent.initialize, (ctx) => {
    trace("initialize");
    noticesAdvertised = typeof ctx.params.clientCapabilities?.session?.notices === "object";
    const air = (ctx.params.clientCapabilities?._meta?.jetbrains as { air?: { capabilities?: unknown } } | undefined)?.air;
    asyncTasksAdvertised = Array.isArray(air?.capabilities) && (air.capabilities as unknown[]).includes("asyncTasks");
    return {
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: {
        ...((offersModes || resumeFails || resumes || history || forks) && {
          sessionCapabilities: {
            ...((offersModes || resumes) && { close: {} }),
            ...((resumeFails || resumes) && { resume: {} }),
            ...(history && { list: {} }),
            ...(forks && { fork: {} }),
          },
        }),
        ...((history || forks) && { loadSession: true }),
      },
      ...(offersSteering ? { _meta: { steering: { supported: true } } } : {}),
    };
  })
  .onRequest(acp.methods.agent.session.new, (ctx) => {
    const sessionId = `fake-session-${process.pid}-${++nextSession}`;
    sessionFolders.set(sessionId, ctx.params.cwd);
    trace(`new session ${sessionId}`);
    if (resumes) log(`new ${sessionId}`);
    if (availableCommands)
      setTimeout(() => ctx.client.notify(acp.methods.client.session.update, { sessionId, update: { sessionUpdate: "available_commands_update", availableCommands } }), 50);
    return offersModes ? { sessionId, configOptions: offeredOptions(sessionId) } : { sessionId };
  })
  .onRequest(acp.methods.agent.session.list, (ctx) => ({
    sessions: history ? [{ sessionId: history.sessionId, cwd: ctx.params.cwd ?? process.cwd(), title: history.title, updatedAt: new Date().toISOString() }] : [],
  }))
  .onRequest(acp.methods.agent.session.fork, () => {
    const sessionId = `fake-fork-${process.pid}-${++nextSession}`;
    forkedSessions.add(sessionId);
    return { sessionId };
  })
  .onRequest(acp.methods.agent.session.load, async (ctx) => {
    if (forkedSessions.has(ctx.params.sessionId)) return offersModes ? { configOptions: offeredOptions(ctx.params.sessionId) } : {};
    if (ctx.params.sessionId !== history?.sessionId) throw acp.RequestError.internalError(undefined, "No such session");
    for (const update of history.updates) await ctx.client.notify(acp.methods.client.session.update, { sessionId: history.sessionId, update });
    return {};
  })
  .onRequest(acp.methods.agent.session.resume, (ctx) => {
    if (!resumes) throw acp.RequestError.internalError(undefined, "No such session");
    log(`resumed ${ctx.params.sessionId}`);
    return {};
  })
  .onRequest(acp.methods.agent.session.setConfigOption, (ctx) =>
    answerLate(() => {
      chosen.set(ctx.params.sessionId, { ...chosen.get(ctx.params.sessionId), [ctx.params.configId]: String(ctx.params.value) });
      log(`set ${ctx.params.configId} to ${ctx.params.value}`);
      return { configOptions: offeredOptions(ctx.params.sessionId) };
    }),
  )
  .onRequest(acp.methods.agent.session.close, (ctx) =>
    answerLate(() => {
      log(`closed ${ctx.params.sessionId}`);
      return {};
    }),
  )
  .onRequest(acp.methods.agent.session.prompt, (ctx) => {
    const textOf = (blocks: acp.ContentBlock[]) => blocks.map((block) => (block.type === "text" ? block.text : "")).join("");
    const prompt = ctx.params.prompt.filter((block) => !(block.type === "text" && isSideChatBrief(block.text)));
    const text = textOf(prompt);
    trace(`prompt in ${ctx.params.sessionId}: ${text.split("\n")[0]!.slice(0, 80)}`);
    appendFileSync(promptsFile!, `${textOf(ctx.params.prompt)}\n`);
    if (startsWith(prompt, "EDIT ")) return askToEdit(ctx.client, ctx.params.sessionId, JSON.parse(text.slice("EDIT ".length)));
    if (startsWith(prompt, "RUN TOOLS ")) return runTools(ctx.client, ctx.params.sessionId, JSON.parse(text.slice("RUN TOOLS ".length)));
    if (startsWith(prompt, "TOOLS ")) return askToUseTools(ctx.client, ctx.params.sessionId, JSON.parse(text.slice("TOOLS ".length)));
    if (startsWith(prompt, "WRITE ")) return writeFiles(ctx.client, ctx.params.sessionId, JSON.parse(text.slice("WRITE ".length)));
    if (startsWith(prompt, "SUBAGENT ASKS ")) return askFromSubagent(ctx.client, ctx.params.sessionId, text.slice("SUBAGENT ASKS ".length));
    if (startsWith(prompt, "USAGE ")) {
      const [used = 0, size = 0, costUsd] = text.slice("USAGE ".length).split(" ").map(Number);
      return reportUsage(ctx.client, ctx.params.sessionId, used, size, costUsd);
    }
    if (startsWith(prompt, "/compact")) {
      const size = reportedWindows.get(ctx.params.sessionId) ?? 200_000;
      return reportUsage(ctx.client, ctx.params.sessionId, size / 10, size);
    }
    if (startsWith(prompt, "SAY ")) return sayText(ctx.client, ctx.params.sessionId, text.slice("SAY ".length));
    if (startsWith(prompt, "TITLE ")) return titleSession(ctx.client, ctx.params.sessionId, text.slice("TITLE ".length));
    if (startsWith(prompt, "CHOICES")) return sayChoices(ctx.client, ctx.params.sessionId);
    if (startsWith(prompt, "FOLDER")) return sayText(ctx.client, ctx.params.sessionId, `Working in ${sessionFolders.get(ctx.params.sessionId)}`);
    if (startsWith(prompt, "NOTICE")) return sendNotices(ctx.client, ctx.params.sessionId);
    if (startsWith(prompt, "ASYNC TASK DONE")) return startAsyncTask(ctx.client, ctx.params.sessionId, true);
    if (startsWith(prompt, "ASYNC TASK LONG")) return startAsyncTask(ctx.client, ctx.params.sessionId, true, false, LONG_TASK_DESCRIPTION);
    if (startsWith(prompt, "ASYNC TASK STUCK")) return startAsyncTask(ctx.client, ctx.params.sessionId, false, true);
    if (startsWith(prompt, "ASYNC TASK")) return startAsyncTask(ctx.client, ctx.params.sessionId, false);
    if (startsWith(prompt, "FAIL ")) throw acp.RequestError.internalError(undefined, text.slice("FAIL ".length));
    if (startsWith(prompt, "PLAN ")) return makePlan(ctx.client, ctx.params.sessionId, JSON.parse(text.slice("PLAN ".length)));
    if (startsWith(prompt, "STREAM PARAGRAPHS ")) return streamParagraphs(ctx.client, ctx.params.sessionId, Number(text.slice("STREAM PARAGRAPHS ".length)));
    if (startsWith(prompt, "STREAM ")) return streamWords(ctx.client, ctx.params.sessionId, Number(text.slice("STREAM ".length)));
    if (startsWith(prompt, "FINISHED ON STOP ")) return finishedOnStop(ctx.client, ctx.params.sessionId, text.slice("FINISHED ON STOP ".length));
    if (startsWith(prompt, "STOPPED REPLY ")) return stoppedReply(ctx.client, ctx.params.sessionId, text.slice("STOPPED REPLY ".length), true);
    if (startsWith(prompt, "STOPPED BEFORE ")) return stoppedReply(ctx.client, ctx.params.sessionId, text.slice("STOPPED BEFORE ".length), false);
    if (startsWith(prompt, "STOPPED BESIDE SUBAGENT ")) return stoppedReply(ctx.client, ctx.params.sessionId, text.slice("STOPPED BESIDE SUBAGENT ".length), false, true);
    if (startsWith(prompt, "STOPPED QUIET ")) return stoppedQuietly(ctx.params.sessionId);
    if (startsWith(prompt, "REPLY TOOL REPLY ")) return replyAroundATool(ctx.client, ctx.params.sessionId, text.slice("REPLY TOOL REPLY ".length));
    if (startsWith(prompt, "TOOL UNTIL ")) return toolUntil(ctx.client, ctx.params.sessionId, text.slice("TOOL UNTIL ".length));
    if (startsWith(prompt, "ENDS UNREAD ")) return endsWithSteerUnread(ctx.client, ctx.params.sessionId, text.slice("ENDS UNREAD ".length));
    if (startsWith(prompt, "REPLY STEERED ")) return replyThenSteered(ctx.client, ctx.params.sessionId, text.slice("REPLY STEERED ".length));
    if (startsWith(prompt, "CRASH LEAVING A CHILD")) spawn(process.execPath, ["-e", "setTimeout(() => {}, 60_000)"], { stdio: ["ignore", "inherit", "ignore"] });
    if (startsWith(prompt, "CRASH")) setTimeout(() => process.exit(1), 100);
    return startsWith(prompt, "WEDGE") || startsWith(prompt, "CRASH") ? new Promise(() => {}) : { stopReason: "end_turn" as const };
  })
  .onNotification(acp.methods.agent.session.cancel, (ctx) => {
    stopWaiters.get(ctx.params.sessionId)?.();
    stopWaiters.delete(ctx.params.sessionId);
  })
  .onRequest("_session/steering", (params) => params as { sessionId: string; prompt: acp.ContentBlock[] }, (ctx) => steerInto(ctx.params.sessionId, ctx.params.prompt))
  .onRequest("_session/async_task/stop", (params) => params as { sessionId: string; asyncTaskId: string }, (ctx) =>
    stopAsyncTask(ctx.client, ctx.params.sessionId, ctx.params.asyncTaskId),
  )
  .connect(acp.ndJsonStream(Writable.toWeb(process.stdout) as unknown as WritableStream<Uint8Array>, Readable.toWeb(process.stdin) as unknown as ReadableStream<Uint8Array>));
