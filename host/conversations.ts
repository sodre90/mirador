import { realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { PluginActivity } from "../shared/canvas-plugins.ts";
import { activityOf, turnEndedAs } from "../shared/plugin-activity.ts";
import { isDeepStrictEqual } from "node:util";
import type * as acp from "@agentclientprotocol/sdk/unstable";
import {
  busyTexts,
  harnessIds,
  harnessLabels,
  isConversationPlace,
  isUntitled,
  UNTITLED,
  type Activity,
  type AdoptMode,
  type AskItem,
  type AskMode,
  type BusyWith,
  type ContextUsage,
  type Conversation,
  type ConversationEvent,
  type ConversationPlace,
  type ConversationWorktree,
  type ConversationStatus,
  type ExternalSession,
  type HarnessId,
  type JobWait,
  type JobWaitEnd,
  type Launch,
  type PendingAsk,
  type PendingPermissionRequest,
  type PendingRequest,
  type Profile,
  type QueuedMessage,
  type RestoreFiles,
  type RestorePlan,
  type SessionSearchHit,
  type StartedBy,
  type StoredEvent,
  type TerminalActivity,
  type TurnUsage,
  type UsageLimitWait,
  type WaitingFor,
  type Workspace,
} from "../shared/model.ts";
import { chosenModel, flatSelectOptions, offersValue, ranOnOf } from "../shared/config-options.ts";
import { MIN_SEARCH_LENGTH } from "../shared/find.ts";
import { causeOf, englishProblem, HostProblemError, problemOf, type AgentGone, type HostProblem } from "../shared/host-problems.ts";
import { messageAtEnd, type JobWaitRequest } from "../shared/job-waits.ts";
import { panelCommandRun } from "../shared/panel-commands.ts";
import { historyEntry } from "../shared/prompt-history.ts";
import { customOrderAfterDrag } from "../shared/conversation-order.ts";
import { inSidebarOrder, movedBefore } from "../shared/sidebar-order.ts";
import { isClearCommand, isReloadCommand, replacesSession, toSlashCommand } from "../shared/slash-commands.ts";
import { isPending, isPutAway, isReminder, reminderCommandIn, reminderFromCommand, type Reminder } from "../shared/reminders.ts";
import { agentAnsweredIn, lastWordsOf, replyOf } from "../shared/last-words.ts";
import { isRealModel } from "../shared/claude-models.ts";
import { cutWithEllipsis, firstGraphemes } from "../shared/text-cut.ts";
import { isInformational } from "../shared/timeline.ts";
import type { ConversationChoices, ConversationReply, RanOn, StartedConversation, WorkspaceConversationStart } from "../shared/canvas-plugins.ts";
import { canTryAgain } from "../shared/try-again.ts";
import { currentActivity, isAgentsNextStep, OpenToolCalls } from "./activity.ts";
import { editDiffsOf } from "./edit-diff.ts";
import { pendingAsk, pendingPermission } from "./pending-requests.ts";
import { launchEditor } from "./editor.ts";
import { openAsText, openWithSystemDefault } from "./system-open.ts";
import { mentionSuggestions } from "./mentions.ts";
import { PlanQuotasByProfile, reportedQuotas } from "./plan-quotas.ts";
import { turnEndReason, type TurnOutcome } from "../shared/system-notifications.ts";
import { hasBegun, sessionHasRecord, updatesTheAgentRecords } from "../shared/conversation-begun.ts";
import { isUsageLimitError, usageLimitMessage, usageLimitReplyIn, usageLimitResetIn } from "../shared/usage-limit.ts";
import { summarizeWaiting, waitingTones, type WaitingConversation, type WaitingSummary } from "../shared/waiting.ts";
import { awaitingDelivery, USER_COMMAND_EVENT_TYPES, userCommandsIn, withCommandOutputs, type UserCommand } from "../shared/user-commands.ts";
import { withCanvasNotes, type CanvasNote } from "./canvas/notes.ts";
import { NO_CANVAS_PLUGINS, type CanvasPluginGuidance } from "./canvas/guidance.ts";
import { forkPointThrough, forkTitle, shownSessionTitle, withoutForkMarks } from "../shared/forks.ts";
import { endsTurn, joinedRunningTurn, lastAgentMessageId, pendingReverts, REVERT_EVENT_TYPES, rewindPointBefore, turnTitle, turnsFrom, whyNoRewindTo, withRevertNotes, type Revert } from "../shared/reverts.ts";
import { MODE_NAME_META_KEY } from "../shared/notices.ts";
import { returnedSteerSeqs } from "../shared/steered-messages.ts";
import { miradorCommandEnvironment } from "./acp/environment.ts";
import { CANVAS_SERVER_NAME, harnessSpec, isAuthRequiredError, launchEnvironment, loginCommand, profileEnvironment, sessionMeta, sessionSystemPrompt } from "./acp/harnesses.ts";
import { canvasFollowUp, canvasUseOf, isCanvasFollowUp } from "./canvas/reply-check.ts";
import { HarnessProcess, type ConfigValue } from "./acp/harness.ts";
import { withReportedToolCall } from "./acp/reported-tool-call.ts";
import { canvasToolAskedFor, isPreAllowedCanvasTool } from "./canvas/permission.ts";
import { agentLogsDirectory, type HostConfig } from "./config.ts";
import type { Hub } from "./hub.ts";
import type { DroppedFiles } from "./dropped-files.ts";
import type { ImageStore } from "./images.ts";
import { asyncTaskUpdateOf, AsyncTasks, tailTaskOutput } from "./async-tasks.ts";
import { followJobProgram, JobWaits } from "./job-waits.ts";
import type { NotifierMute } from "./notifier.ts";
import { Changes } from "./changes.ts";
import { Checkpoints, SNAPSHOTS_KEPT } from "./checkpoints.ts";
import { profileToLaunch } from "./profiles.ts";
import type { ProfileDraft, ProfileTestResult } from "../shared/protocol.ts";
import type { Store, UnseenTurnEnd } from "./store.ts";
import type { SystemNotifications } from "./system-notifications.ts";
import type { TerminalProgram } from "./terminals.ts";
import { claudeConfigDir } from "./terminal-sessions.ts";
import { TerminalWork, updatesAfter } from "./terminal-catch-up.ts";
import { copilotHomeOf, copilotSessionCredits } from "./copilot-credits.ts";
import { claudeTranscript, lastAnsweringModel, modelChoiceFor, recordsUserMessage, userMessageTakenInAt } from "./claude-transcript.ts";
import { claudeTranscriptPaths, messageSnippetOf, openOpencodeDatabase, opencodeDatabasePath } from "./session-transcripts.ts";
import { UserCommandRunner } from "./user-commands.ts";
import { Worktrees, workingCopyOf } from "./worktrees.ts";
import { ConversationSessions } from "./conversation-sessions.ts";
import { SubagentSessions } from "./subagent-sessions.ts";
import { SubagentUsageReader } from "./subagent-usage.ts";
import { UnknownSessionUpdates } from "./unknown-session-updates.ts";

const MAX_TITLE_LENGTH = 200;
const LISTED_SESSIONS = 30;
const SEARCHED_SESSIONS = 50;
const TITLE_LENGTH = 60;
/** The text's first line, short enough for the sidebar; empty when the text is blank. */
const titleFrom = (text: string) => cutWithEllipsis(text.trim().split("\n")[0] ?? "", TITLE_LENGTH - 1, TITLE_LENGTH);
const CONTINUE_AFTER_INTERRUPTION = "Continue where you left off.";
const NO_FILES_KEPT: HostProblem = { code: "no-files-kept" };
const FILES_NO_LONGER_KEPT: HostProblem = { code: "files-no-longer-kept", turns: SNAPSHOTS_KEPT };
const TURN_STOP_TIMEOUT_MS = 10_000;
/** How long a Stop waits for Claude Code to record the prompt it is stopping, bounded so a wedged agent can't hang it. */
const PROMPT_RECORD_WAIT_MS = 3_000;
/** Letting go of a session is a courtesy to its agent; one that doesn't answer must not hold up what comes next. */
const SESSION_CLOSE_TIMEOUT_MS = 5_000;
const REMINDER_CHECK_MS = 30_000;
const OPTION_ANSWER_TIMEOUT_MS = 10_000;
/** A plugin's model and effort hold its conversation's first message back through a model server's load, but not for good. */
const START_CHOICES_TIMEOUT_MS = 120_000;
/** What a profile's agent says it offers is kept for its editors this long: it costs starting the agent to ask again. */
const PROFILE_CHOICES_TTL_MS = 15 * 60_000;
/** An agent that does not answer a probe within this leaves the editor with what it knew from its conversations. */
const PROFILE_PROBE_TIMEOUT_MS = 30_000;
/** A test the user asked for waits as long as a conversation's start does before it says the agent did not answer. */
const PROFILE_TEST_TIMEOUT_MS = 60_000;
/** Like Claude Code: the agent continues a minute after its usage limit resets, at most twice in a row by itself. */
const USAGE_LIMIT_RESET_MARGIN_MS = 60_000;
const AUTOMATIC_CONTINUES_IN_A_ROW = 2;
/** A script-driven turn whose reply stops at a step it announced is nudged on at most this many times in a row, so a run that keeps stopping there waits for the user rather than being poked for ever. */
const STALL_NUDGES_IN_A_ROW = 2;
/** What the nudge says: the agent ended its turn on a ":", meaning to go on. */
const CONTINUE_AFTER_STALL = "Continue where you left off: your reply ended announcing a next step without taking it.";
/** setTimeout fires at once when asked to wait longer than this, about 24.8 days. */
const LONGEST_TIMER_MS = 2 ** 31 - 1;
/** How much of a started conversation's reply the caller's list of delegated tasks shows. */
const REPLY_OPENING_GRAPHEMES = 300;

type PermissionResolver = (optionId: string | null) => void;

/** The plugin whose tool started a conversation hears how its work ended, in the conversation that started it. */
export type HearReply = (started: StartedConversation, startedBy: StartedBy, reply: ConversationReply) => void | Promise<void>;

interface NotesForAgent {
  commands: UserCommand[];
  reverts: Revert[];
  canvas: CanvasNote[];
}

/** Asks the user an agent's form, such as Codex's questions, and answers the agent. */
/** Codex's app-server daemon, which its terminal UI runs on, holds a session after the UI quits; the problem says how to free it. */
const asCodexSessionHeld = (error: unknown) => (errorMessage(error).includes("thread_active_writer") ? new HostProblemError({ code: "codex-session-held" }) : error);

type AskForm = (conversationId: string, request: acp.CreateElicitationRequest, signal: AbortSignal) => Promise<acp.CreateElicitationResponse>;

/** The session a conversation was loaded from, and whether it continues it or forked it. */
export interface LoadedSession {
  harness: HarnessId;
  sessionId: string;
  mode: AdoptMode;
  /** A fork cut short at a turn holds the canvas items shown before this time only. */
  canvasShownBefore?: number;
}

/** Where a fork's session copy ends: after the agent's reply with this mark. */
export interface SessionForkPoint {
  messageId: string;
  canvasShownBefore: number;
}

/** The fork point as claude-agent-acp asks for it; an agent that ignores it forks the whole session. */
const forkPointMeta = (messageId: string, atSteeredMessage = false) => ({
  jetbrains: { air: { fork: { version: 1, messageId } } },
  ...(atSteeredMessage && { steering: { atSteeredMessage } }),
});

export type RestoreCanvas = (conversationId: string, source: LoadedSession, events: StoredEvent[]) => Promise<void>;

const NO_NOTES: NotesForAgent = { commands: [], reverts: [], canvas: [] };

const withNotes = ({ commands, reverts, canvas }: NotesForAgent, text: string) =>
  withCanvasNotes(canvas, withCommandOutputs(commands, withRevertNotes(reverts, text)));

interface PendingPermission {
  settle: PermissionResolver;
  allowOptionId: string | null;
  request: PendingPermissionRequest;
}

interface PromptStart {
  imageIds?: string[];
  fromScript?: boolean;
  fromMirador?: boolean;
  fromPlugin?: string;
  /** A message of the user's starts a turn of its own, so the files are snapshotted and that turn can be undone. */
  startsTurn?: boolean;
}

/** Messages that joined a turn together, and what of the user's went to the agent with them. */
export interface SteeredMessages {
  sessionId: string;
  steeredAt: number;
  messages: QueuedMessage[];
  seqs: number[];
  commandIds: string[];
}

interface TurnInProgress {
  /** Until the turn's end shows whether the agent answered them. */
  steered: SteeredMessages[];
  ended: boolean;
  /** The turn's own prompt, once handed to the agent, with the moment it went out. */
  promptSent?: { text: string; sentAt: number };
  /** The user stopped the turn before its prompt went out, as while the turn's files are kept. */
  stoppedBeforePrompt?: boolean;
  /** The reply whose chunks last streamed, so the late chunks of a turn a stop cancelled can be recognised. */
  lastReplyMessageId: string | null;
  /** The turn waits on the user, so no reply of its own can still be on its way. */
  awaitedUser: boolean;
  /** The turn began with a script's message (`mirador message`, or a job wait's resume): part of a run nobody may be watching. */
  fromScript: boolean;
  /** The turn's own reply since its last tool call: whether it stopped at a step it announced, or asked in chat what ask should have. */
  reply: string;
  /** The text of the turn's last message on its own, which is Claude Code's words when a usage limit ended the turn as if it ended by itself. */
  lastMessage: string;
  /** When each of the turn's own tool calls started, to tell whether a page it showed was its last step. */
  toolCallsAt: number[];
  /** What kept queued messages out of the turn when the host last tried to steer them in, as the host log says it. */
  queuedMessagesKeptOutBy?: string | null;
  /**
   * Queued messages came before the agent had taken the turn: its session was still opening, or the agent had the
   * turn's prompt but not yet queued it. Its next step shows it holds the turn, so they are tried again then.
   */
  steersAtAgentsNextStep?: boolean;
}

/**
 * What a stop can still hear from the turn it cancelled: the chunks of the reply the agent is
 * streaming, or will start streaming when the API answers the request it had already sent. After a
 * stop that interrupted the request, a reply that begins while the next turn runs may be that turn's
 * own, so it is held back until the turn tells: a tool call of the turn proves it the turn's, and a
 * reply with another id before any proves it the orphan. A message steered into the turn shows it
 * too, as the agent's answer to that message would start another id and tell nothing.
 */
export interface CancelledReplyChunks {
  messageId: string | null;
  /** The chunks of a reply the running turn began, held back while it may still be the cancelled turn's. */
  held?: acp.SessionUpdate[];
}

/**
 * Whether these chunks belong to the reply a cancelled turn still owes: dropped at once when they
 * continue the reply it was already streaming, or begin one while no turn runs; held back when a
 * reply begins in the running turn. A reply with another id ends the claim, as does one with no id
 * at all, which nothing could tell apart.
 */
export function cancelledReplyChunks(
  pending: CancelledReplyChunks,
  update: acp.SessionUpdate,
  turnRunning: boolean,
): { drop: boolean; pending: CancelledReplyChunks | null } {
  const messageId = isAgentReplyChunk(update) && typeof update.messageId === "string" ? update.messageId : null;
  if (messageId === null || (pending.messageId !== null && pending.messageId !== messageId)) return { drop: false, pending: null };
  if (pending.messageId === null) return { drop: true, pending: turnRunning ? { messageId, held: [update] } : { messageId } };
  pending.held?.push(update);
  return { drop: true, pending };
}

/** A tool call the running turn makes, not one of its subagents': the reply streaming before it is the turn's own. */
const isTurnsOwnToolCall = (update: acp.SessionUpdate) => update.sessionUpdate === "tool_call" && !isSubagentReport(update);

interface Runtime {
  sessionId?: Promise<string>;
  harness?: HarnessProcess;
  running: boolean;
  /** Settles once the running turn has ended. */
  turnEnded?: Promise<void>;
  turn?: TurnInProgress;
  /** While a profile switch stops the running turn, queued messages wait for the new profile. */
  holdingQueue: boolean;
  /** The latest profile switch; the next one starts after it. */
  profileSwitch?: Promise<void>;
  pendingPermissions: Map<string, PendingPermission>;
  /** A session Continue found held by Codex's daemon: the next message tries to continue it again, once the user has freed it, so its history replays ahead of that message. */
  heldCodexSession?: string;
  /** The latest permission request still reading the files it would edit; the next one shows after it. */
  permissionArriving?: Promise<unknown>;
  queuedMessages: QueuedMessage[];
  /** The latest steer still on its way to the agent; the next one goes after it, so messages join the turn in the order they were sent. */
  steering?: Promise<void>;
  /** Messages taken out of the queue to join the turn, until the agent says whether it took them: a turn ending meanwhile must not send what was queued behind them. */
  steerInFlight?: boolean;
  openToolCalls: OpenToolCalls;
  usageLimit?: { wait: UsageLimitWait; timer?: ReturnType<typeof setTimeout> };
  /** How often in a row the agent continued by itself after a usage limit's reset, without a turn that succeeded. */
  automaticContinues: number;
  /** How many times in a row a script-driven turn that stopped at a step it announced was nudged on; any other turn's end resets it. */
  stallNudges: number;
  /** The host kills the agent process this turn runs on on purpose, so the turn ends as a stop, not as a failure. */
  killedOnPurpose?: boolean;
  /** The model the agent last said its answers came from, in its usage updates. */
  reportedModel?: string;
  /** A workspace setup command currently running in this conversation's worktree. */
  setupCommandId?: string;
  /** What a plugin chose for the conversation it started, until a session opens on them: a failed open's retry takes them too. */
  startChoices?: ConversationChoices;
  /** The plugin that started it stopped it while its worktree was being made, so its first message never goes. */
  stoppedBeforeItsFirstTurn?: boolean;
  /** The reply the last stopped turn still owes: its late chunks are dropped, or held back until another reply's id or the next turn's end tells whether they were the orphan or that turn's answer. */
  cancelledReply?: CancelledReplyChunks;
}

/** A change asked of the agent: the option as it stood, and the agent's answer, which settles without failing. */
interface OptionChange {
  current: acp.SessionConfigOption;
  answered: Promise<void>;
}

interface StoppedTurn {
  conversationId: string;
  sessionId: string | null;
}

/**
 * What of an agent's session/load is the session's state rather than its history: the history is in the transcript
 * already, and the mode it reports comes back with the session's configuration.
 */
const SESSION_STATE_UPDATES = new Set<acp.SessionUpdate["sessionUpdate"]>(["available_commands_update", "config_option_update", "session_info_update", "usage_update"]);

/** Antigravity sends the whole history again on session/resume, as on session/load, so its sessions reopen by a load whose replay is left out. */
const replaysHistoryOnResume = (harness: HarnessId) => harness === "antigravity";

/**
 * Agents that read their settings, MCP servers among them, anew for each session they open, so a /reload reopens only the
 * conversation's session. opencode reads them once per process, so a /reload starts that again, as it does Antigravity's,
 * which serves only its own conversation.
 */
const readsSettingsPerSession = (harness: HarnessId) => harness === "claude" || harness === "pi" || harness === "codex" || harness === "copilot";

export class ConversationService {
  private readonly runtimes = new Map<string, Runtime>();
  /** Agent processes by `processKey`: one per profile, except Antigravity's conversations, which each get their own. */
  private readonly agentProcesses = new Map<string, HarnessProcess>();
  private readonly sessions = new ConversationSessions();
  private readonly subagentSessions = new SubagentSessions();
  /** Sessions whose agent left an option change unanswered for too long, so their next changes don't wait. */
  private readonly sessionsSlowToAnswer = new Set<string>();
  private readonly startChoicesTimeoutMs = START_CHOICES_TIMEOUT_MS;
  private readonly updatesForUnknownSessions = new UnknownSessionUpdates();
  /** What each profile's agent last said it offers, and the probe asking one now. */
  private readonly profileChoicesCache = new Map<string, { at: number; options: acp.SessionConfigOption[] }>();
  private readonly profileChoiceProbes = new Map<string, Promise<acp.SessionConfigOption[] | null>>();
  /** The agent each profile's probe runs, so a restart can stop it rather than queue the next probe behind it. */
  private readonly activeProbeHarnesses = new Map<string, HarnessProcess>();
  private readonly statusOverrides = new Map<string, Pick<Conversation, "status" | "statusDetail" | "busyWith" | "statusProblem">>();
  private readonly terminalActivity = new Map<string, TerminalActivity>();
  private readonly terminalWork = new TerminalWork();
  private readonly catchingUpWithTerminal = new Set<string>();
  /** A session loaded again replays all of its history; it is held here, so only what the conversation lacks joins it. */
  private readonly replaysBeingRead = new Map<string, acp.SessionNotification[]>();
  private readonly contextUsage: Map<string, ContextUsage>;
  private readonly creditReads = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly planQuotas = new PlanQuotasByProfile();
  private readonly unseenTurnEnds: Map<string, UnseenTurnEnd>;
  private readonly lastWords = new Map<string, string>();
  private readonly asksWaitedOn: Map<string, PendingAsk>;
  private readonly commands = new UserCommandRunner();
  private readonly subagentUsageReader = new SubagentUsageReader();
  private readonly jobWaits: JobWaits;
  private readonly asyncTasks = new AsyncTasks();
  private readonly checkpoints: Checkpoints;
  private readonly worktrees: Worktrees;
  readonly changes: Changes;
  /** While the host stops or restarts, messages wait in the queue for the next host, and turns it ends are not the agent's failures. */
  private stopping = false;
  private reminderTimer?: ReturnType<typeof setTimeout>;
  private canvasNotesOf: (conversationId: string) => CanvasNote[] = () => [];
  private restoreCanvas: RestoreCanvas = async () => {};
  private askForm: AskForm = async () => ({ action: "decline" });
  private hearReply: HearReply = () => {};
  private pluginTellsItsCaller: (plugin: string) => boolean = () => false;
  private hearActivity: (conversationId: string, activity: PluginActivity) => void = () => {};
  private hearWorktreeRemoval: (folderId: string) => void = () => {};
  /** The turns the previous host died in the middle of, whose replies, if owed, say they failed. */
  private readonly turnsCutShortByCrash: Set<string>;

  constructor(
    private readonly store: Store,
    private readonly hub: Hub,
    private readonly config: HostConfig,
    private readonly notifier: NotifierMute,
    private readonly images: ImageStore,
    private readonly droppedFiles: DroppedFiles,
    private readonly notifications: SystemNotifications,
    private readonly canvasPlugins: (conversationId: string) => CanvasPluginGuidance = () => NO_CANVAS_PLUGINS,
  ) {
    this.checkpoints = new Checkpoints(config.dataDir);
    this.worktrees = new Worktrees(config.dataDir);
    this.changes = new Changes(store, this.checkpoints, (conversationId) => this.workspaceOf(conversationId), (file, line) => launchEditor(store.editorSetting(), file, line), openWithSystemDefault, (file) =>
      openAsText(file, store.scriptProgramSetting()),
    );
    this.cancelPermissionsOrphanedByRestart();
    this.turnsCutShortByCrash = new Set(this.endTurnsOrphanedByRestart());
    this.contextUsage = new Map(store.listContextUsages());
    this.unseenTurnEnds = new Map(store.listUnseenTurnEnds());
    this.unseenTurnEnds.forEach((_, conversationId) => this.keepLastWords(conversationId));
    const waitingAsksOldestLast = store.listCanvasItemsWithStatus("waiting").filter((item) => item.kind === "ask").sort((a, b) => b.createdAt - a.createdAt);
    this.asksWaitedOn = new Map(waitingAsksOldestLast.map((item) => [item.conversationId, pendingAsk(item)]));
    this.jobWaits = new JobWaits(store, {
      changed: (conversationId) => this.republish(conversationId),
      ended: (conversationId, wait, end) => this.jobWaitEnded(conversationId, wait, end),
    });
  }

  list(): Conversation[] {
    return this.store.listConversations().map((conversation) => this.withRuntimeStatus(conversation));
  }

  waiting(): WaitingSummary {
    return summarizeWaiting([...this.conversationsThatMayWait()].flatMap((conversationId) => this.waitingConversation(conversationId) ?? []));
  }

  private waitingConversation(conversationId: string): WaitingConversation | null {
    const waitingFor = this.waitingFor(conversationId);
    const conversation = waitingFor && this.store.findConversation(conversationId);
    if (!waitingFor || !conversation) return null;
    const workspace = this.store.findWorkspace(conversation.workspaceId)?.name ?? "";
    return { conversationId, title: conversation.title, ...(isUntitled(conversation) && { untitled: true as const }), workspace, tone: waitingTones[waitingFor] };
  }

  runningTurnsCount(): number {
    return [...this.runtimes.values()].filter((runtime) => runtime.running).length;
  }

  /** The turn the conversation's agent is in, or last was in: the seq of the message that started it. */
  latestTurnSeq(conversationId: string): number | null {
    return this.store.latestTurnStart(conversationId)?.seq ?? null;
  }

  get(conversationId: string): Conversation {
    const conversation = this.store.findConversation(conversationId);
    if (!conversation) throw new HostProblemError({ code: "no-such-conversation", id: conversationId });
    return this.withRuntimeStatus(conversation);
  }

  planQuotasOf(conversationId: string, now: number) {
    return this.planQuotas.of(this.get(conversationId).profileId, now);
  }

  slashCommands(conversationId: string) {
    return this.store.latestAvailableCommands(this.get(conversationId)).map(toSlashCommand);
  }

  typedElsewhere(conversationId: string) {
    const { id, workspaceId } = this.get(conversationId);
    return this.store.typedInWorkspace(workspaceId, id).flatMap((event) => historyEntry(event)?.text ?? []);
  }

  typedEarlierIn(conversationId: string, beforeSeq: number) {
    return this.store.typedBefore(this.get(conversationId).id, beforeSeq).flatMap((event) => historyEntry(event) ?? []);
  }

  async mentionSuggestions(conversationId: string, query: string) {
    return mentionSuggestions(this.workspaceOf(conversationId).path, query);
  }

  /** What the conversation's subagents spent so far, from Claude Code's transcripts of them. */
  async subagentUsage(conversationId: string, toolCallIds: string[]) {
    const conversation = this.get(conversationId);
    if (conversation.harness !== "claude" || !conversation.acpSessionId) return {};
    return this.subagentUsageReader.usageOf(this.claudeConfigDirOf(conversation), conversation.acpSessionId, toolCallIds);
  }

  /**
   * Without a launch, on the workspace's default as the host has it, which a browser may not have heard of yet; with a
   * prompt, working on it at once; with a title that isn't blank, named as if by the user, so neither its first message
   * nor its agent renames it; with `choices`, on that model and effort from its first message on; with a `worktree`,
   * working there rather than in the workspace's folder; with `fromPlugin`, its first message shown as that plugin's.
   */
  create(
    workspaceId: string,
    launch: Launch = this.existingWorkspace(workspaceId).defaultLaunch,
    prompt?: string,
    title?: string,
    choices: ConversationChoices = {},
    worktree?: ConversationWorktree,
    fromPlugin?: string,
  ): Conversation {
    const givenTitle = titleFrom(title ?? "");
    const conversation = this.insertConversation(workspaceId, launch, givenTitle || UNTITLED, givenTitle !== "", worktree);
    if (choices.model || choices.effort) this.runtime(conversation.id).startChoices = choices;
    const opened = this.ensureSession(conversation.id);
    if (prompt?.trim()) {
      const startTurn = () => this.prompt(conversation.id, prompt, { startsTurn: true, ...(fromPlugin && { fromPlugin }) });
      if (worktree) opened.then(startTurn).catch(() => {});
      else {
        opened.catch(() => {});
        startTurn().catch(() => {});
      }
    } else opened.catch(() => {});
    return conversation;
  }

  /** Like `create`, where the workspace starts its conversations unless `startsIn` names the other place. */
  async start(workspaceId: string, launch?: Launch, prompt?: string, startsIn?: ConversationPlace): Promise<Conversation> {
    const workspace = this.existingWorkspace(workspaceId);
    const worktree = (startsIn ?? workspace.newConversationsIn) === "worktree" ? await this.worktrees.plan(workspace) : undefined;
    return this.create(workspaceId, launch, prompt, undefined, {}, worktree);
  }

  /** Where the workspace's new conversations work, and the command that sets each new worktree up. */
  async setWorktreeSettings(workspaceId: string, newConversationsIn: ConversationPlace, worktreeSetup: string) {
    const workspace = this.existingWorkspace(workspaceId);
    if (!isConversationPlace(newConversationsIn)) return;
    if (newConversationsIn === "worktree") await this.worktrees.mustHold(workspace);
    this.store.setWorktreeSettings(workspaceId, newConversationsIn, worktreeSetup.trim());
    this.hub.broadcast({ type: "workspace.upserted", workspace: this.existingWorkspace(workspaceId) });
  }

  /**
   * For a plugin's tool: a conversation beside the caller's, on another profile, working on `prompt` at once, in the
   * caller's worktree if it has one. It works for the caller, which hears through the plugin how its work ended. A
   * `title` names it for good, and `choices` set its model and effort, as `create` does.
   */
  startBeside(callerId: string, plugin: string, profileName: string, prompt: string, title?: string, choices?: ConversationChoices): StartedConversation {
    const caller = this.callerThatMayStart(callerId);
    const conversation = this.createFor(caller, plugin, this.profileNamed(profileName), title, choices, caller.worktree);
    this.prompt(conversation.id, prompt, { startsTurn: true }).catch(() => {});
    return this.startedOf(conversation);
  }

  /**
   * Like `startBeside`, in a new git worktree of its own, on a new branch from what the workspace has checked out. Its
   * first message waits until the worktree is made; one that can't be made ends its work as failed, and one its plugin
   * stopped meanwhile as stopped.
   */
  async startInOwnWorktree(callerId: string, plugin: string, profileName: string, prompt: string, title?: string, choices?: ConversationChoices): Promise<StartedConversation> {
    const caller = this.callerThatMayStart(callerId);
    const profile = this.profileNamed(profileName);
    const worktree = await this.worktrees.plan(this.existingWorkspace(caller.workspaceId));
    const conversation = this.createFor(caller, plugin, profile, title, choices, worktree);
    this.ensureSession(conversation.id)
      .then(
        () => (this.runtime(conversation.id).stoppedBeforeItsFirstTurn ? this.deliverOwedReply(conversation.id, "stopped") : this.prompt(conversation.id, prompt, { startsTurn: true })),
        () => this.deliverOwedReply(conversation.id, "failed"),
      )
      .catch(() => {});
    return this.startedOf(conversation);
  }

  private callerThatMayStart(callerId: string) {
    const caller = this.get(callerId);
    if (caller.startedBy) throw new Error("A plugin's tool started this conversation, so it can't start another; do the task here.");
    return caller;
  }

  /** A conversation that works for the caller, which hears through the plugin how its work ended. */
  private createFor(caller: Conversation, plugin: string, profile: Profile, title?: string, choices?: ConversationChoices, worktree?: ConversationWorktree) {
    const conversation = this.create(caller.workspaceId, { harness: profile.harness, profileId: profile.id }, undefined, title, choices, worktree);
    this.store.recordStartedBy(conversation.id, { conversationId: caller.id, plugin });
    if (caller.bypassPermissions) this.setBypassPermissions(conversation.id, true);
    return conversation;
  }

  /** A conversation as the plugin that started it knows it: its profile's name, and the worktree it works in. */
  private startedOf({ id, profileId, harness, worktree }: Conversation): StartedConversation {
    const profile = (profileId && this.store.findProfile(profileId)?.name) || harnessLabels[harness];
    return { id, profile, ...(worktree && { worktree: { folder: worktree.folder, branch: worktree.branch } }) };
  }

  /**
   * For a plugin's own work, such as a routine that is due: a conversation in the workspace, where the workspace starts
   * its conversations, on the profile of that name, working on `prompt` at once, its first message shown as the plugin's.
   * It works for nobody, so it stands in the sidebar as any other and tells the user when its turns end.
   */
  async startForPlugin(workspaceId: string, pluginTitle: string, { profile: profileName, prompt, title, model, effort }: WorkspaceConversationStart): Promise<StartedConversation> {
    const workspace = this.existingWorkspace(workspaceId);
    const profile = this.profileNamed(profileName);
    const worktree = workspace.newConversationsIn === "worktree" ? await this.worktrees.plan(workspace) : undefined;
    return this.startedOf(this.create(workspaceId, { harness: profile.harness, profileId: profile.id }, prompt, title, { model, effort }, worktree, pluginTitle));
  }

  private profileNamed(profileName: string) {
    const profiles = this.store.listProfiles();
    const profile = profiles.find(({ name }) => name.toLowerCase() === profileName.trim().toLowerCase());
    if (!profile) throw new Error(`There is no profile named ${profileName}; the profiles are ${profiles.map(({ name }) => name).join(", ")}.`);
    return profile;
  }

  /**
   * For a plugin's tool: stops the turn of a conversation it started from the caller's, as the user's Stop does, so the
   * plugin's `replied` hears it end as "stopped"; one still waiting for its worktree ends so once that is made, without
   * starting. One that no longer exists, or whose turn already ended, is let be; one this plugin's tool didn't start from
   * that conversation throws.
   */
  async stopStarted(callerId: string, plugin: string, conversationId: string): Promise<void> {
    const conversation = this.store.findConversation(conversationId);
    if (!conversation) return;
    const startedBy = conversation.startedBy;
    if (startedBy?.conversationId !== callerId || startedBy.plugin !== plugin) {
      throw new Error(`Conversation ${conversationId} wasn't started by the ${plugin} plugin from this conversation, so it can't be stopped here.`);
    }
    const runtime = this.runtime(conversationId);
    if (!runtime.running) {
      if (!startedBy.reply) runtime.stoppedBeforeItsFirstTurn = true;
      return;
    }
    await this.cancel(conversationId);
  }

  /** The plugin whose tool started a conversation hears how its work ended; `tellsItsCaller` says whether it passes that on. */
  hearRepliesWith(hearReply: HearReply, tellsItsCaller: (plugin: string) => boolean) {
    this.hearReply = hearReply;
    this.pluginTellsItsCaller = tellsItsCaller;
  }

  /** Plugins hear what happens in every conversation: the user's messages, turns and tool calls. */
  hearActivityWith(hearActivity: (conversationId: string, activity: PluginActivity) => void) {
    this.hearActivity = hearActivity;
  }

  /** What keeps documents in a worktree hears that its folder is gone, so nothing is left open or stored for it. */
  hearWorktreeRemovalsWith(hearWorktreeRemoval: (folderId: string) => void) {
    this.hearWorktreeRemoval = hearWorktreeRemoval;
  }

  /** The user takes a started conversation off its caller's list of delegated tasks, and with it off the sidebar, so its mark goes too. */
  dismissDelegation(conversationId: string) {
    if (this.store.dismissDelegation(conversationId)) this.forgetUnseenTurnEnd(conversationId);
    this.republish(conversationId);
  }

  /** The user dismisses finished delegated tasks of this caller; with `plugin`, only that plugin's. */
  clearFinishedDelegations(callerId: string, plugin?: string) {
    for (const id of this.store.dismissFinishedDelegations(callerId, plugin)) {
      this.forgetUnseenTurnEnd(id);
      this.republish(id);
    }
  }

  /**
   * Once, when the work of a conversation a plugin's tool started ends. The reply is kept before the plugin hears it, so
   * a crash in between can't tell it twice; a caller deleted since hears nothing. What it ran on is read as it ended.
   */
  private deliverOwedReply(conversationId: string, endedAs?: ConversationReply["ended"]) {
    const conversation = this.store.findConversation(conversationId);
    const startedBy = conversation?.startedBy;
    if (!conversation || !startedBy || startedBy.reply) return;
    const turnStart = this.store.latestTurnStart(conversationId)?.seq ?? 0;
    const turn = this.store.listEventsFrom(conversationId, turnStart);
    const reply = replyOf(turn);
    const told = endedAs ? { ...reply, ended: endedAs } : reply;
    this.store.recordDelegatedReply(conversationId, { ended: told.ended, opening: told.text && cutWithEllipsis(told.text, REPLY_OPENING_GRAPHEMES) });
    this.republish(conversationId);
    if (!this.store.hasConversation(startedBy.conversationId)) return;
    const started = this.startedOf(conversation);
    this.ranOnOfTurn(conversation, turn, told.ended)
      .then((ranOn) => this.hearReply(started, startedBy, ranOn ? { ...told, ranOn } : told))
      .catch((error: unknown) => {
        console.error(`the ${startedBy.plugin} plugin failed to hear the reply of ${conversationId}:`, error);
        if (this.pluginTellsItsCaller(startedBy.plugin)) {
          this.notifications.notify(conversationId, { kind: "finished" });
        }
      });
  }

  /** A turn that ended before its agent answered anything ran on no model. */
  private async ranOnOfTurn(conversation: Conversation, turn: StoredEvent[], ended: ConversationReply["ended"]): Promise<RanOn | null> {
    return ended === "finished" || agentAnsweredIn(turn) ? this.ranOn(conversation) : null;
  }

  /**
   * The model that answered last, as the agent's usage updates named it, else as Claude Code's transcript does, which
   * outlasts a restart; otherwise the one chosen.
   */
  private async ranOn(conversation: Conversation): Promise<RanOn | null> {
    const reported = this.runtime(conversation.id).reportedModel;
    const answering = isRealModel(reported) ? reported : lastAnsweringModel(await this.claudeTranscriptOf(conversation).catch(() => ""));
    return ranOnOf(conversation.configOptions, answering);
  }

  /** Empty for other agents, and for a conversation whose agent has no session yet. */
  private async claudeTranscriptOf(conversation: Conversation) {
    const { harness, acpSessionId } = conversation;
    return harness === "claude" && acpSessionId ? claudeTranscript(this.claudeConfigDirOf(conversation), acpSessionId) : "";
  }

  /** The newest sessions the harness knows for the workspace directory, including ones started outside the app. */
  async listSessionsInWorkspace(workspaceId: string, launch: Launch): Promise<ExternalSession[]> {
    const { sessions, conversationIdBySession } = await this.harnessSessions(workspaceId, launch);
    return sessions.slice(0, LISTED_SESSIONS).map((session) => externalSession(session, conversationIdBySession));
  }

  /** Sessions in the workspace whose title or messages hold what the user is looking for, newest first; a search the user has moved on from stops. */
  async searchSessionsInWorkspace(workspaceId: string, launch: Launch, query: string, outdated?: AbortSignal): Promise<SessionSearchHit[]> {
    const lowerQuery = query.trim().toLowerCase();
    if (lowerQuery.length < MIN_SEARCH_LENGTH) return [];
    const { profile, sessions, conversationIdBySession } = await this.harnessSessions(workspaceId, launch);
    const harness = this.harnessFor(launch);
    if (harness.spec.id !== "claude" && harness.spec.id !== "opencode") throw new HostProblemError({ code: "agent-cannot-search-sessions", agent: harness.spec.label });
    const environment = profileEnvironment(profile);
    const transcriptPaths =
      harness.spec.id === "claude"
        ? await claudeTranscriptPaths(claudeConfigDir(environment), new Set(sessions.map(({ sessionId }) => sessionId)))
        : null;
    const database = harness.spec.id === "opencode" ? openOpencodeDatabase(opencodeDatabasePath(environment)) : null;
    try {
      const hits: SessionSearchHit[] = [];
      for (const session of sessions) {
        outdated?.throwIfAborted();
        const titleMatch = (session.title ?? "").toLowerCase().includes(lowerQuery);
        const match = titleMatch ? null : await messageSnippetOf(session.sessionId, lowerQuery, transcriptPaths, database);
        if (titleMatch || match !== null) hits.push({ ...externalSession(session, conversationIdBySession), match });
        if (hits.length >= SEARCHED_SESSIONS) break;
      }
      return hits;
    } finally {
      database?.close();
    }
  }

  /** The harness's sessions for the workspace directory, newest first, with the app's conversation on each. */
  private async harnessSessions(workspaceId: string, launch: Launch) {
    const directory = await recordedDirectory(this.existingWorkspace(workspaceId));
    const profile = profileToLaunch(this.store, launch);
    const harness = this.harnessFor(launch);
    const capabilities = await harness.start();
    if (!capabilities.agentCapabilities?.sessionCapabilities?.list) throw new HostProblemError({ code: "agent-cannot-list-sessions", agent: harness.spec.label });
    const { sessions } = await harness.listSessions(directory);
    const conversationIdBySession = new Map(this.store.listConversations().map(({ acpSessionId, id }) => [acpSessionId, id]));
    return { profile, sessions: sessions.filter(({ cwd }) => cwd === directory), conversationIdBySession };
  }

  /** Continues (or forks) a session started elsewhere, e.g. in a terminal, replaying its history into the conversation. */
  adopt(
    workspaceId: string,
    launch: Launch,
    session: Pick<ExternalSession, "sessionId" | "title"> & { titleSetByUser?: boolean },
    mode: AdoptMode,
    forkPoint: SessionForkPoint | null = null,
    worktree?: ConversationWorktree,
  ): Conversation {
    if (mode === "continue" && this.store.listConversations().some(({ acpSessionId }) => acpSessionId === session.sessionId)) {
      throw new HostProblemError({ code: "session-already-open" });
    }
    const title = session.title || UNTITLED;
    const conversation = this.insertConversation(workspaceId, launch, mode === "fork" ? forkTitle(title) : withoutForkMarks(title), session.titleSetByUser, worktree);
    this.ensureSession(conversation.id, () => this.loadExternalSession(conversation.id, session.sessionId, mode, forkPoint)).catch(() => {});
    return conversation;
  }

  /**
   * Copies the agent's session into a new conversation on the same profile: as it stands, or through the turn begun
   * with the message at `throughTurnSeq`, its reply included. A turn running in it goes on undisturbed. A title the
   * user or a plugin gave it stays theirs in the fork, safe from the agent's renaming. The fork works where the
   * conversation does, as the agent keeps a session by its folder.
   */
  fork(conversationId: string, throughTurnSeq?: number): Conversation {
    const { workspaceId, harness, profileId, acpSessionId, title, titleSetByUser, worktree } = this.get(conversationId);
    if (!acpSessionId || !this.canFork(conversationId)) throw new HostProblemError({ code: "nothing-to-fork-yet" });
    const forkPoint = throughTurnSeq === undefined ? null : this.forkPointThrough(conversationId, throughTurnSeq);
    return this.adopt(workspaceId, { harness, profileId }, { sessionId: acpSessionId, title, titleSetByUser }, "fork", forkPoint, worktree);
  }

  private forkPointThrough(conversationId: string, seq: number): SessionForkPoint | null {
    if (this.store.findEvent(conversationId, seq)?.event.type !== "user-message") throw new HostProblemError({ code: "rewind-only-to-own-message" });
    const point = forkPointThrough(this.get(conversationId).harness, this.store.listEvents(conversationId), seq);
    if (point && !("messageId" in point)) throw new HostProblemError(point);
    return point && { messageId: point.messageId, canvasShownBefore: point.canvasBefore };
  }

  /** The agent has a session to copy once it has worked on a message there. */
  canFork(conversationId: string): boolean {
    return this.get(conversationId).acpSessionId !== null && sessionHasRecord(this.store.listEvents(conversationId));
  }

  private insertConversation(workspaceId: string, launch: Launch, title: string, titleSetByUser = false, worktree?: ConversationWorktree): Conversation {
    this.existingWorkspace(workspaceId);
    const profile = profileToLaunch(this.store, launch);
    const now = Date.now();
    const conversation = this.store.insertConversation({
      id: crypto.randomUUID(),
      workspaceId,
      harness: launch.harness,
      profileId: launch.profileId,
      title,
      titleSetByUser,
      acpSessionId: null,
      askMode: profile.askMode,
      bypassPermissions: profile.bypassPermissions,
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
      ...(worktree && { worktree }),
      createdAt: now,
      updatedAt: now,
    });
    this.publish(conversation);
    return conversation;
  }

  /** Reorders the conversation among its workspace's; the others it shifts are published too. */
  move(conversationId: string, beforeConversationId: string | null) {
    const { workspaceId } = this.get(conversationId);
    const siblings = this.store
      .listConversations()
      .filter((conversation) => conversation.workspaceId === workspaceId)
      .sort(inSidebarOrder);
    this.store.setConversationOrder(customOrderAfterDrag(siblings, conversationId, beforeConversationId));
    const positionBefore = new Map(siblings.map(({ id, position }) => [id, position]));
    this.store
      .listConversations()
      .filter(({ id, position }) => positionBefore.has(id) && positionBefore.get(id) !== position)
      .forEach((conversation) => this.publish(conversation));
  }

  /**
   * The files only the conversation's worktree holds, which deleting the conversation deletes with it: none while
   * another conversation works there too, except the tasks that close with it.
   */
  async uncommittedFilesLostWith(conversationId: string) {
    const { worktree } = this.get(conversationId);
    if (!worktree) return 0;
    const closing = new Set([conversationId, ...this.store.conversationsStartedBy(conversationId)]);
    if (this.store.conversationsInWorktree(worktree.id).some((id) => !closing.has(id))) return 0;
    return this.worktrees.uncommittedFiles(worktree);
  }

  /**
   * The files only the workspace's conversations hold, which removing the workspace deletes with it: each worktree
   * counted once, though forks share one.
   */
  async uncommittedFilesLostInWorkspace(workspaceId: string) {
    const worktrees = new Map<string, ConversationWorktree>();
    this.store
      .listConversations()
      .filter((conversation) => conversation.workspaceId === workspaceId)
      .flatMap(({ worktree }) => (worktree ? [worktree] : []))
      .forEach((worktree) => worktrees.set(worktree.id, worktree));
    const counts = await Promise.all([...worktrees.values()].map((worktree) => this.worktrees.uncommittedFiles(worktree)));
    return counts.reduce((sum, count) => sum + count, 0);
  }

  /** Its worktree goes once no other conversation works there; with `keepsUncommittedWork`, only one that holds none. */
  delete(conversationId: string, { keepsUncommittedWork = false } = {}) {
    const conversation = this.get(conversationId);
    this.deliverOwedReply(conversationId, "stopped");
    if (conversation.acpSessionId) {
      this.cancel(conversationId).catch(() => {});
      this.notifier.unmute(conversation.acpSessionId);
    }
    this.sessions.forget(conversationId);
    this.subagentSessions.forget(conversationId);
    const runtime = this.runtimes.get(conversationId);
    if (runtime?.setupCommandId) this.commands.stop(runtime.setupCommandId);
    const wasRunning = runtime?.running ?? false;
    this.asyncTasks.forget(conversationId);
    if (runtime) {
      this.endUsageLimitWait(runtime);
      this.releaseSession(conversationId, runtime, conversation.acpSessionId);
    }
    this.stopDedicatedHarness(conversation.profileId, conversationId);
    this.jobWaits.forget(conversationId);
    this.runtimes.delete(conversationId);
    this.statusOverrides.delete(conversationId);
    this.terminalActivity.delete(conversationId);
    this.contextUsage.delete(conversationId);
    this.stopReadingCredits(conversationId);
    this.unseenTurnEnds.delete(conversationId);
    this.lastWords.delete(conversationId);
    this.asksWaitedOn.delete(conversationId);
    this.keepCanvasOf(conversation);
    const workspace = this.store.findWorkspace(conversation.workspaceId);
    this.store.deleteConversation(conversationId);
    this.images.deleteConversation(conversationId);
    this.droppedFiles.deleteConversation(conversationId);
    this.hub.broadcast({ type: "conversation.deleted", conversationId });
    this.announceWaiting();
    if (wasRunning) this.announceRunningTurnsCount();
    if (workspace && conversation.worktree && this.store.conversationsInWorktree(conversation.worktree.id).length === 0)
      this.removeWorktree(workspace, conversation.worktree, keepsUncommittedWork).catch((error: unknown) => console.error(`could not remove the worktree ${conversation.worktree?.root}:`, error));
  }

  private async removeWorktree(workspace: Workspace, worktree: ConversationWorktree, keepsUncommittedWork: boolean) {
    if (keepsUncommittedWork && (await this.worktrees.uncommittedFiles(worktree)) > 0) return;
    await this.worktrees.remove(workspace, worktree);
    await this.checkpoints.forget(workingCopyOf(workspace, { worktree }), workspace);
    this.store.forgetFolder(worktree.id);
    this.hearWorktreeRemoval(worktree.id);
  }

  /** Continuing the conversation's session later brings its canvas back as it was. */
  private keepCanvasOf({ id, harness, acpSessionId }: Conversation) {
    const items = this.store.listCanvasItems(id);
    if (acpSessionId && items.length > 0) this.store.saveDeletedCanvas(harness, acpSessionId, items, Date.now());
  }

  deleteAllInWorkspace(workspaceId: string) {
    this.store
      .listConversations()
      .filter((conversation) => conversation.workspaceId === workspaceId)
      .forEach((conversation) => this.delete(conversation.id));
  }

  rename(conversationId: string, title: string) {
    const name = firstGraphemes(title.trim(), MAX_TITLE_LENGTH);
    if (!name) throw new HostProblemError({ code: "conversation-needs-name" });
    this.save({ ...this.get(conversationId), title: name, titleSetByUser: true });
  }

  /**
   * The agent working in a conversation names it, as Claude Code does with the title it publishes; a name the user gave
   * the conversation stays. Returns the name it took, or null when there was none to take.
   */
  retitleFromAgent(conversationId: string, title: string): string | null {
    const name = firstGraphemes(title.trim().split("\n")[0]?.trim() ?? "", MAX_TITLE_LENGTH);
    if (!name) throw new HostProblemError({ code: "conversation-needs-name" });
    const conversation = this.get(conversationId);
    if (conversation.titleSetByUser) return null;
    this.save({ ...conversation, title: name });
    return name;
  }

  /**
   * Moves the conversation's session to the agent process of another profile of its agent. A turn in progress
   * is stopped first and, once the session is back, continued under the new profile; queued messages follow.
   * A conversation that has not begun may move to another agent's profile, in a fresh session of that agent.
   */
  setProfile(conversationId: string, profileId: string) {
    const runtime = this.runtime(conversationId);
    const switched = (runtime.profileSwitch ?? Promise.resolve()).then(() => this.switchProfile(conversationId, profileId));
    runtime.profileSwitch = switched.catch(() => {});
    return switched;
  }

  private async switchProfile(conversationId: string, profileId: string) {
    const runtime = this.runtime(conversationId);
    await runtime.sessionId?.catch(() => {});
    if (this.get(conversationId).profileId === profileId) return;
    const harness = this.agentToSwitchTo(conversationId, profileId);
    const changesAgent = harness !== this.get(conversationId).harness;
    const profile = profileToLaunch(this.store, { harness, profileId });
    const interrupted = runtime.running;
    runtime.holdingQueue = interrupted;
    if (interrupted) {
      await this.stopTurnEvenIfIgnored(conversationId).catch((error: unknown) => {
        runtime.holdingQueue = false;
        throw error;
      });
    }
    const conversation = this.get(conversationId);
    const released = this.releaseSession(conversationId, runtime, conversation.acpSessionId);
    this.stopDedicatedHarness(conversation.profileId, conversationId);
    if (changesAgent) this.forgetContextUsage(conversationId);
    runtime.reportedModel = undefined;
    this.save({
      ...conversation,
      harness,
      profileId,
      askMode: profile.askMode,
      bypassPermissions: profile.bypassPermissions,
      pluginSettings: undefined,
      acpSessionId: !changesAgent && this.agentHasRecorded(conversationId) ? conversation.acpSessionId : null,
      configOptions: changesAgent ? [] : conversation.configOptions.filter(({ id }) => id !== "model"),
    });
    const left = conversation.profileId === null ? null : this.store.findProfile(conversation.profileId);
    this.append(conversationId, {
      type: "profile-changed",
      profileName: profile.name,
      ...(changesAgent && { agent: harness }),
      from: { profileId: conversation.profileId, profileName: left?.name ?? null, harness: conversation.harness },
    });
    this.ensureSession(conversationId, async () => {
      this.setBusy(conversationId, "switching-profile");
      await released;
      const sessionId = await this.openSession(conversationId);
      await this.applyProfileModel(conversationId, sessionId, Date.now() + this.startChoicesTimeoutMs);
      await this.applyProfileChoices(conversationId, sessionId);
      this.setStatus(conversationId, "idle");
      return sessionId;
    })
      .finally(() => (runtime.holdingQueue = false))
      .then(() => {
        if (runtime.running) return;
        if (interrupted) return this.resumeStoppedTurn(conversationId, conversation.acpSessionId);
        this.sendNextQueuedMessage(conversationId);
      })
      .catch(() => this.sendNextQueuedMessage(conversationId));
  }

  /** The profile's own agent, which only a conversation that has not begun may move to. */
  private agentToSwitchTo(conversationId: string, profileId: string): HarnessId {
    const { harness } = this.get(conversationId);
    const target = this.store.findProfile(profileId);
    if (!target || target.harness === harness || !hasBegun(this.store.listEvents(conversationId))) return target?.harness ?? harness;
    throw new HostProblemError({ code: "conversation-runs-on-other-agent", agent: harnessLabels[harness], profile: target.name, profileAgent: harnessLabels[target.harness] });
  }

  /** The context its report measured is gone, so the meter starts empty again — in the store, so a restart does not bring it back. */
  private forgetContextUsage(conversationId: string) {
    this.contextUsage.delete(conversationId);
    this.store.setContextUsage(conversationId, null);
  }

  /** Like /clear in Claude Code: the agent goes on in a fresh session, while the conversation so far stays on screen. */
  private async clearContext(conversationId: string) {
    const runtime = this.runtime(conversationId);
    await runtime.sessionId?.catch(() => {});
    const released = this.releaseSession(conversationId, runtime, this.get(conversationId).acpSessionId);
    this.forgetContextUsage(conversationId);
    this.save({ ...this.get(conversationId), acpSessionId: null });
    this.append(conversationId, { type: "context-cleared" });
    await this.ensureSession(conversationId, async () => {
      this.setBusy(conversationId, "clearing-context");
      await released;
      const sessionId = await this.openSession(conversationId);
      this.setStatus(conversationId, "idle");
      return sessionId;
    }).catch(() => {});
    this.sendNextQueuedMessage(conversationId);
  }

  /**
   * The agent starts again on the same session and reads its settings anew, such as an MCP server added since. Other
   * conversations on a process that has to start again lose a turn in progress, which then continues where it left off.
   */
  private async reloadAgent(conversationId: string) {
    const runtime = this.runtime(conversationId);
    await runtime.sessionId?.catch(() => {});
    const conversation = this.get(conversationId);
    const left = readsSettingsPerSession(conversation.harness)
      ? this.releaseSession(conversationId, runtime, conversation.acpSessionId)
      : this.restartAgentProcessOf(conversation);
    this.append(conversationId, { type: "agent-reloaded" });
    await this.ensureSession(conversationId, async () => {
      this.setBusy(conversationId, "reloading-agent");
      await left;
      const sessionId = await this.openSession(conversationId);
      this.setStatus(conversationId, "idle");
      return sessionId;
    }).catch(() => {});
    this.sendNextQueuedMessage(conversationId);
  }

  private async restartAgentProcessOf(conversation: Conversation) {
    const harness = this.agentProcesses.get(this.processKey(this.profileOf(conversation), conversation));
    if (!harness) return;
    this.forgetAsyncTasks(conversation.id);
    this.continueStoppedTurns(await this.killAgent(harness, { kind: "restarted-for-reload" }));
  }

  /** A turn whose agent cannot take the cancel, such as one still starting, is waited for all the same. */
  private async stopTurn(conversationId: string) {
    const { turnEnded } = this.runtime(conversationId);
    await this.cancel(conversationId).catch((error) => console.error(`cancelling the turn failed; waiting for it to end:`, error));
    await turnEnded;
  }

  /** An agent that ignores the cancel has its process killed after a while, as Force stop would. */
  private async stopTurnEvenIfIgnored(conversationId: string) {
    const stopped = await Promise.race([this.stopTurn(conversationId).then(() => true), Bun.sleep(TURN_STOP_TIMEOUT_MS).then(() => false)]);
    if (!stopped) await this.forceCancel(conversationId);
  }

  setAskMode(conversationId: string, askMode: AskMode) {
    this.save({ ...this.get(conversationId), askMode });
  }

  /** Null follows the profile again. */
  setPluginSetting(conversationId: string, plugin: string, setting: string, value: string | null) {
    const conversation = this.get(conversationId);
    const { [setting]: _replaced, ...othersOfPlugin } = conversation.pluginSettings?.[plugin] ?? {};
    const ofPlugin = value === null ? othersOfPlugin : { ...othersOfPlugin, [setting]: value };
    const { [plugin]: _plugin, ...otherPlugins } = conversation.pluginSettings ?? {};
    const pluginSettings = Object.keys(ofPlugin).length > 0 ? { ...otherPlugins, [plugin]: ofPlugin } : otherPlugins;
    this.save({ ...conversation, pluginSettings: Object.keys(pluginSettings).length > 0 ? pluginSettings : undefined });
  }

  /** Switching YOLO on also approves the requests already waiting for the user. */
  setBypassPermissions(conversationId: string, bypassPermissions: boolean) {
    this.save({ ...this.get(conversationId), bypassPermissions });
    if (!bypassPermissions) return;
    this.runtime(conversationId).pendingPermissions.forEach(({ settle, allowOptionId }) => allowOptionId && settle(allowOptionId));
  }

  async setConfigOption(conversationId: string, configId: string, value: ConfigValue) {
    const sessionId = await this.ensureSession(conversationId);
    const response = await this.harnessFor(this.get(conversationId)).setConfigOption(sessionId, configId, value);
    this.save({ ...this.get(conversationId), configOptions: response.configOptions });
  }

  /**
   * What a profile's agent offers, from the agent itself, so a profile editor can list modes and efforts before one of
   * its conversations has run; null when the agent was not there to answer, and the editor keeps what its own
   * conversations last listed. An answer stands until the profile launches its agent differently.
   */
  async profileChoices(profileId: string): Promise<acp.SessionConfigOption[] | null> {
    const remembered = this.profileChoicesCache.get(profileId);
    if (remembered && Date.now() - remembered.at < PROFILE_CHOICES_TTL_MS) return remembered.options;
    const asking = this.profileChoiceProbes.get(profileId);
    if (asking) return asking;
    const probe: Promise<acp.SessionConfigOption[] | null> = this.askProfileChoices(profileId).then((options) => {
      if (options && this.profileChoiceProbes.get(profileId) === probe) this.profileChoicesCache.set(profileId, { at: Date.now(), options });
      return options;
    });
    this.profileChoiceProbes.set(profileId, probe);
    void probe.finally(() => {
      if (this.profileChoiceProbes.get(profileId) === probe) this.profileChoiceProbes.delete(profileId);
    });
    return probe;
  }

  /** Starts the profile's agent as a conversation would, asks a new session what it offers, and stops it again. */
  private async askProfileChoices(profileId: string): Promise<acp.SessionConfigOption[] | null> {
    const profile = this.store.findProfile(profileId);
    if (!profile) return null;
    const probe = await this.probeProfile(profile, profileId, PROFILE_PROBE_TIMEOUT_MS);
    return "error" in probe ? null : probe.configOptions;
  }

  /**
   * What a profile's agent offers, from a profile an editor holds and has not saved yet. A start that fails says why,
   * both as the English its error came in and as the problem the page says in its own language.
   */
  async testProfile(draft: ProfileDraft): Promise<ProfileTestResult> {
    if (!harnessIds.includes(draft.harness)) throw new HostProblemError({ code: "unknown-agent", agent: draft.harness });
    const profile: Profile = {
      id: draft.id ?? crypto.randomUUID(),
      name: draft.name.trim() || harnessLabels[draft.harness],
      harness: draft.harness,
      environment: draft.environment,
      prelaunch: draft.prelaunch,
      model: draft.model || null,
      mode: draft.mode || null,
      effort: draft.effort || null,
      bypassPermissions: draft.bypassPermissions,
      askMode: draft.askMode,
      ...(draft.idleCompaction === false && { idleCompaction: false }),
      color: draft.color,
      ...(draft.pluginSettings && { pluginSettings: draft.pluginSettings }),
      createdAt: Date.now(),
    };
    const probe = await this.probeProfile(profile, `test-${crypto.randomUUID()}`, PROFILE_TEST_TIMEOUT_MS);
    if ("error" in probe) throw probe.error;
    return { ok: true, configOptions: probe.configOptions ?? [], tookMs: probe.tookMs };
  }

  /**
   * Starts the profile's agent, asks a new session what it offers, and stops it again. `key` names the process for a
   * profile restart to stop. The agent's answer is null when it listed no options at all.
   */
  private async probeProfile(
    profile: Profile,
    key: string,
    timeoutMs: number,
  ): Promise<{ configOptions: acp.SessionConfigOption[] | null; tookMs: number } | { error: unknown }> {
    const startedAt = Date.now();
    let harness: HarnessProcess | null = null;
    try {
      const spec = harnessSpec(profile, this.store.claudeProgramSetting());
      harness = new HarnessProcess(
        { ...spec, environment: { ...spec.environment, ...this.scriptEnvironment(spec.environment.PATH) } },
        {
          onSessionUpdate: () => {},
          onPermissionRequest: async () => ({ outcome: { outcome: "cancelled" as const } }),
          onElicitationRequest: async () => ({ action: "decline" as const }),
          onExit: () => {},
        },
        agentLogsDirectory(this.config.dataDir),
      );
      this.activeProbeHarnesses.set(key, harness);
      const agent = harness;
      const session = agent.start().then(() => agent.newSession({ cwd: tmpdir(), mcpServers: [] }));
      // The timed-out agent may still fail the session later; by then the probe has stopped it and no longer cares.
      session.catch(() => {});
      const created = await Promise.race([session, Bun.sleep(timeoutMs).then(() => null)]);
      if (created === null) throw new HostProblemError({ code: "profile-test-unanswered", seconds: timeoutMs / 1000 });
      return { configOptions: created.configOptions ?? null, tookMs: Date.now() - startedAt };
    } catch (error) {
      return { error };
    } finally {
      if (this.activeProbeHarnesses.get(key) === harness) this.activeProbeHarnesses.delete(key);
      void harness?.stop();
    }
  }

  async prompt(conversationId: string, text: string, { imageIds = [], fromScript = false, fromMirador = false, fromPlugin, startsTurn = false }: PromptStart = {}) {
    const runtime = this.runtime(conversationId);
    if (runtime.running) throw new HostProblemError({ code: "agent-still-working" });
    if (isClearCommand(text)) return this.clearContext(conversationId);
    if (isReloadCommand(text)) return this.reloadAgent(conversationId);
    runtime.running = true;
    this.announceRunningTurnsCount();
    this.endUsageLimitWait(runtime);
    let endTurn = () => {};
    runtime.turnEnded = new Promise((resolve) => (endTurn = resolve));
    const turn: TurnInProgress = { steered: [], ended: false, lastReplyMessageId: null, awaitedUser: false, fromScript, reply: "", lastMessage: "", toolCallsAt: [] };
    runtime.turn = turn;
    runtime.openToolCalls.clear();
    this.forgetUnseenTurnEnd(conversationId);
    this.retitleFromFirstMessage(conversationId, text);
    const notes = this.notesForAgent(conversationId);
    this.setStatus(conversationId, "starting");
    this.store.turnStarted(conversationId);
    this.hearActivity(conversationId, { kind: "turn-started" });
    if (runtime.heldCodexSession) await this.ensureSession(conversationId).catch(() => {});
    const turnSeq = this.appendUserMessage(conversationId, { text, imageIds, ...(fromScript && { fromScript }), ...(fromMirador && { fromMirador }), ...(fromPlugin && { fromPlugin }) }, notes);
    if (startsTurn && turnSeq !== undefined) await this.keepFilesOfTurn(conversationId, turnSeq);
    let response: acp.PromptResponse | undefined;
    let endedOnItsOwn: acp.PromptResponse | undefined;
    let sessionOpened = false;
    try {
      const sessionId = await this.ensureSession(conversationId);
      sessionOpened = true;
      this.setStatus(conversationId, "running");
      const prompt = await this.promptContent(conversationId, withNotes(notes, text), imageIds);
      const harness = this.harnessFor(this.get(conversationId));
      turn.promptSent = { text, sentAt: Date.now() };
      const answered = harness.prompt(sessionId, prompt);
      if (turn.stoppedBeforePrompt) this.cancel(conversationId).catch((error) => console.error(`stopping the turn of conversation ${conversationId} failed:`, error));
      response = await answered;
      this.showHeldBackReply(conversationId);
      const limitReply = usageLimitReplyIn({ stopReason: response.stopReason, lastMessage: turn.lastMessage, messageId: turn.lastReplyMessageId }, this.get(conversationId).harness);
      const model = runtime.reportedModel ?? chosenModel(this.get(conversationId).configOptions)?.id;
      const spent = { ...turnUsageOf(response), ...(model && { model }) };
      if (limitReply !== null) {
        this.notifyTurnEnded(conversationId, this.recordTurnFailure(conversationId, { message: limitReply }, true, spent));
      } else {
        endedOnItsOwn = response;
        this.append(conversationId, { type: "turn-end", stopReason: response.stopReason, ...spent });
        runtime.automaticContinues = 0;
        this.notifyTurnEnded(conversationId, { stopReason: response.stopReason });
        this.readCreditsAfterTurn(conversationId);
      }
    } catch (error) {
      this.failOpenToolCalls(conversationId);
      if (runtime.killedOnPurpose) {
        this.append(conversationId, { type: "turn-end", stopReason: "cancelled" });
        this.notifyTurnEnded(conversationId, { stopReason: "cancelled" });
      } else {
        this.notifyTurnEnded(conversationId, this.recordTurnFailure(conversationId, error, turn.promptSent !== undefined));
      }
    } finally {
      this.showHeldBackReply(conversationId);
      turn.ended = true;
      // Claude Code keeps streaming the reply of a turn its cancel cut short, when the stop found
      // its first request merged with a steer: a reply already streaming, or one the API has yet
      // to answer. A stop that interrupted the request may owe no reply, so a reply beginning in the
      // next turn waits for that turn to tell whose it is. A stop the agent waited on the user for
      // owes no reply, nor does one its own tools were busy with, nor a killed process. Its background subagents'
      // tools don't count: they run on beside the turn.
      runtime.cancelledReply =
        response?.stopReason === "cancelled" && !turn.awaitedUser && (turn.lastReplyMessageId !== null || runtime.openToolCalls.oldestOfMainAgent() === null)
          ? { messageId: turn.lastReplyMessageId }
          : undefined;
      await this.returnUnansweredSteers(conversationId, runtime, turn.steered, endedOnItsOwn).catch((error: unknown) =>
        console.error(`could not tell whether the agent answered the messages that joined the turn of conversation ${conversationId}: ${errorMessage(error)}`),
      );
      runtime.running = false;
      this.announceRunningTurnsCount();
      this.hearActivity(conversationId, { kind: "turn-ended", ended: turnEndedAs(endedOnItsOwn?.stopReason, runtime.killedOnPurpose === true) });
      runtime.killedOnPurpose = false;
      this.store.turnEnded(conversationId);
      if (sessionOpened) this.setStatus(conversationId, "idle");
      endTurn();
    }
    if (!this.stopping) this.deliverOwedReply(conversationId);
    this.sendNextQueuedMessage(conversationId);
    if (!this.nudgeAfterStall(conversationId, turn, endedOnItsOwn)) this.followUpOnCanvasUse(conversationId, turn, endedOnItsOwn);
  }

  /**
   * Deep in a long run a model can end its turn on a ":" -- "Closing the round, step (a), verify:" -- without the tool call
   * it announced. When a script drove the turn nobody may be there to notice, and the run would sit idle for good. If
   * nothing else will carry the conversation on, it is nudged to take that step, a couple of times in a row at most; a
   * turn that ends any other way, the user's own included, resets the count.
   */
  private nudgeAfterStall(conversationId: string, turn: TurnInProgress, response: acp.PromptResponse | undefined) {
    const runtime = this.runtime(conversationId);
    const stalled = response?.stopReason === "end_turn" && turn.fromScript && !turn.awaitedUser && stopsAtAnnouncedStep(turn.reply);
    if (!stalled) {
      runtime.stallNudges = 0;
      return false;
    }
    const carriedOnOtherwise = {
      stopping: this.stopping,
      running: runtime.running,
      queued: runtime.queuedMessages.length,
      steerInFlight: runtime.steerInFlight ?? false,
      jobWaits: this.jobWaits.in(conversationId).length,
    };
    if (!nudgesAfterStall(runtime.stallNudges, carriedOnOtherwise)) return false;
    runtime.stallNudges += 1;
    this.sendFromMirador(conversationId, CONTINUE_AFTER_STALL);
    return true;
  }

  /**
   * Late in a long turn, or rushing to end one, an agent told to use the canvas often still asks its question in chat,
   * or repeats in chat the page it just showed. Mirador answers such a turn with one follow-up message saying what to do
   * instead; the turn that follow-up starts goes through unchecked. A delegated conversation is left alone: its reply
   * goes to the conversation that started it.
   */
  private followUpOnCanvasUse(conversationId: string, turn: TurnInProgress, response: acp.PromptResponse | undefined) {
    const runtime = this.runtime(conversationId);
    const { promptSent } = turn;
    const checked =
      response?.stopReason === "end_turn" &&
      promptSent !== undefined &&
      !isCanvasFollowUp(promptSent.text) &&
      this.store.canvasUse() === "often" &&
      !this.get(conversationId).startedBy;
    const carriedOnOtherwise = this.stopping || runtime.running || runtime.queuedMessages.length > 0 || (runtime.steerInFlight ?? false);
    if (!checked || carriedOnOtherwise) return;
    const followUp = canvasFollowUp({
      reply: turn.reply,
      ...canvasUseOf({
        startedAt: promptSent.sentAt,
        toolCallsAt: turn.toolCallsAt,
        items: this.store.listCanvasItems(conversationId),
        jobWaitsSince: this.jobWaits.in(conversationId).map(({ since }) => since),
      }),
    });
    if (followUp) this.sendFromMirador(conversationId, followUp);
  }

  private sendFromMirador(conversationId: string, text: string) {
    this.send(conversationId, text, [], { fromScript: true, fromMirador: true }).catch(() => {});
  }

  /**
   * Sends `text` as the next user message, after those already waiting in the queue, such as the ones behind a /clear
   * that is opening the fresh session. While a turn is running it joins the turn: at once, cutting off what the agent is
   * writing, or, while the agent waits on tools, once they have finished. Sent `afterTurn`, it waits in the queue for the
   * turn to end.
   */
  async send(
    conversationId: string,
    text: string,
    imageIds: string[] = [],
    { fromScript = false, fromMirador = false, fromPlugin, afterTurn = false }: { fromScript?: boolean; fromMirador?: boolean; fromPlugin?: string; afterTurn?: boolean } = {},
  ) {
    const fromUser = !fromScript && !fromMirador && !fromPlugin;
    if (fromUser && this.tookReminderCommand(conversationId, text)) return;
    if (fromUser && this.get(conversationId).reminder) this.setReminder(conversationId, null);
    const runtime = this.runtime(conversationId);
    const sendsAtOnce = !runtime.running && !this.holdsQueue(runtime) && runtime.queuedMessages.length === 0;
    if (sendsAtOnce) return this.prompt(conversationId, text, { imageIds, fromScript, fromMirador, fromPlugin, startsTurn: true });
    const message: QueuedMessage = { id: crypto.randomUUID(), text, imageIds, ...(fromScript && { fromScript }), ...(fromMirador && { fromMirador }), ...(fromPlugin && { fromPlugin }), ...(afterTurn && { afterTurn }) };
    this.setQueue(conversationId, runtime, [...runtime.queuedMessages, message]);
    this.publish(this.get(conversationId));
    if (!runtime.running) this.sendNextQueuedMessage(conversationId);
    else if (!afterTurn) this.steerQueuedMessages(conversationId);
  }

  /** What undoing the turn that began with this message would do to the files, and to which, or why it cannot be undone. */
  async previewRevert(conversationId: string, seq: number): Promise<{ plan: RestorePlan | null; files?: RestoreFiles; cannotUndo?: HostProblem }> {
    const checkpoint = this.checkpointAt(conversationId, seq);
    if (!checkpoint) return { plan: null, cannotUndo: NO_FILES_KEPT };
    const preview = await this.checkpoints.preview(this.workspaceOf(conversationId), checkpoint);
    if (!preview) return { plan: null, cannotUndo: { code: "only-git-repositories" } };
    return (await this.checkpoints.keeps(this.workspaceOf(conversationId), checkpoint)) ? preview : { plan: null, cannotUndo: FILES_NO_LONGER_KEPT };
  }

  /**
   * Puts the workspace's files back to how they were before the turn that began with this message, deleting what came
   * after it. The conversation itself stays as it is, so the agent's context and its cache survive whole; the note
   * saying what happened goes out with the user's next message.
   */
  async revert(conversationId: string, seq: number): Promise<RestorePlan> {
    if (this.runtime(conversationId).running) throw new HostProblemError({ code: "stop-turn-before-undo" });
    const checkpoint = this.checkpointAt(conversationId, seq);
    if (!checkpoint) throw new HostProblemError(NO_FILES_KEPT);
    if (!(await this.checkpoints.keeps(this.workspaceOf(conversationId), checkpoint))) throw new HostProblemError(FILES_NO_LONGER_KEPT);
    const plan = await this.checkpoints.restore(this.workspaceOf(conversationId), checkpoint);
    this.append(conversationId, { type: "revert", revertId: crypto.randomUUID(), toSeq: seq, ...plan });
    return plan;
  }

  /**
   * What rewinding to this turn would do: the conversation loses its turns from here on, and the files go back to how
   * they were when the turn began. `filesNote` says why the files will be left alone, when they will be.
   */
  async previewRewind(
    conversationId: string,
    seq: number,
  ): Promise<{ turnsLeaving: number; keptFrom: string | null; plan: RestorePlan | null; files?: RestoreFiles; cannotRewind?: HostProblem; filesNote?: HostProblem }> {
    const events = this.store.listEvents(conversationId);
    const turnsLeaving = turnsFrom(events, seq).length;
    const before = events.filter(({ seq: at, event }) => at < seq && event.type === "user-message");
    const kept = before.at(-1)?.event;
    const keptFrom = kept?.type === "user-message" ? turnTitle(kept.text) : null;
    const cannotRewind = this.rewindProblem(conversationId, seq);
    if (cannotRewind) return { turnsLeaving, keptFrom, plan: null, cannotRewind };
    const { plan, files, cannotUndo } = await this.previewRevert(conversationId, seq);
    return { turnsLeaving, keptFrom, plan, ...(files && { files }), ...(cannotUndo && { filesNote: cannotUndo }) };
  }

  /**
   * Takes the conversation, the workspace's files and the agent's session back to how they were before the turn that
   * began with the message at `seq`. The agent goes on in a session forked so that it holds only what came before —
   * the prefix is the same bytes it was, so the agent's cached context still counts — and the events from there on are
   * dropped, which leaves what the agent has and what the user sees the same. `keepFiles` leaves the files as they are
   * now, without telling the agent, as Claude Code's own restore of the conversation alone does.
   */
  async rewind(conversationId: string, seq: number, { keepFiles = false } = {}): Promise<{ fromSeq: number }> {
    const cannotRewind = this.rewindProblem(conversationId, seq);
    if (cannotRewind) throw new HostProblemError(cannotRewind);
    const runtime = this.runtime(conversationId);
    const conversation = this.get(conversationId);
    const events = this.store.listEvents(conversationId);
    const point = rewindPointBefore(events, seq);
    this.setBusy(conversationId, "going-back");
    try {
      const forked = point && conversation.acpSessionId ? await this.forkSessionAt(conversationId, point, joinedRunningTurn(events, seq)) : null;
      const checkpoint = this.checkpointAt(conversationId, seq);
      if (!keepFiles && checkpoint && (await this.checkpoints.keeps(this.workspaceOf(conversationId), checkpoint))) await this.checkpoints.restore(this.workspaceOf(conversationId), checkpoint);
      const released = this.releaseSession(conversationId, runtime, conversation.acpSessionId);
      this.store.deleteEventsFrom(conversationId, seq);
      this.forgetContextUsage(conversationId);
      this.save({ ...this.get(conversationId), acpSessionId: forked });
      this.hub.publishToConversation(conversationId, { type: "conversation.rewound", conversationId, fromSeq: seq });
      await released;
      return { fromSeq: seq };
    } finally {
      this.setStatus(conversationId, "idle");
    }
  }

  /**
   * A copy of the agent's session that holds only what it had said up to `point`. The fork point is named the way
   * claude-agent-acp asks for it, in `_meta.jetbrains.air.fork`; an agent that ignores it forks the whole session, so
   * `harnessRewinds` keeps those agents out of here. `atSteeredMessage` tells pi, which keeps the rest of the point's
   * turn, that the message gone back to joined that turn, so the copy ends where that message came in.
   */
  private async forkSessionAt(conversationId: string, point: string, atSteeredMessage: boolean) {
    const conversation = this.get(conversationId);
    const harness = this.harnessFor(conversation);
    this.runtime(conversationId).harness = harness;
    const capabilities = await harness.start();
    if (!capabilities.agentCapabilities?.sessionCapabilities?.fork) throw new HostProblemError({ code: "agent-cannot-go-back-in-session" });
    const { sessionId } = await harness.forkSession({
      sessionId: conversation.acpSessionId!,
      cwd: await recordedDirectory(this.workspaceOf(conversationId)),
      _meta: forkPointMeta(point, atSteeredMessage),
    });
    return sessionId;
  }

  /** Why the conversation cannot go back to this turn, if it cannot. */
  private rewindProblem(conversationId: string, seq: number): HostProblem | undefined {
    if (this.runtime(conversationId).running) return { code: "stop-turn-before-going-back" };
    if (this.store.findEvent(conversationId, seq)?.event.type !== "user-message") return { code: "rewind-only-to-own-message" };
    return whyNoRewindTo(this.get(conversationId).harness, this.store.listEvents(conversationId), seq);
  }

  private checkpointAt(conversationId: string, seq: number) {
    const event = this.store.findEvent(conversationId, seq)?.event;
    if (event?.type !== "user-message") return undefined;
    return event.checkpoint ?? this.store.filesKeptFor(conversationId, seq) ?? undefined;
  }

  /** After the turn's message shows, as it takes seconds in a large repository, but before the agent starts on the turn. */
  private async keepFilesOfTurn(conversationId: string, turnSeq: number) {
    const checkpoint = await this.snapshotFiles(conversationId);
    if (checkpoint) this.append(conversationId, { type: "files-kept", turnSeq, checkpoint });
  }

  /** The folder the conversation works in, as a workspace: its own worktree if it has one. */
  private workspaceOf(conversationId: string) {
    const conversation = this.get(conversationId);
    return workingCopyOf(this.existingWorkspace(conversation.workspaceId), conversation);
  }

  /** A turn works without this, so a failure costs that turn its undo and nothing else. */
  private async snapshotFiles(conversationId: string) {
    try {
      return await this.checkpoints.snapshot(this.workspaceOf(conversationId));
    } catch (error) {
      console.error(`could not keep the files of a turn: ${errorMessage(error)}`);
      return null;
    }
  }

  /** Continues before the usage limit's reset, e.g. after switching to a profile that signs in to another account. */
  continueAfterUsageLimit(conversationId: string, { automatically = false } = {}) {
    const runtime = this.runtime(conversationId);
    if (!runtime.usageLimit || this.stopping) return;
    runtime.automaticContinues = automatically ? runtime.automaticContinues + 1 : 0;
    this.prompt(conversationId, CONTINUE_AFTER_INTERRUPTION).catch(() => {});
  }

  /** The agent still holds the message its failed turn began with, so trying again asks it to continue. */
  tryAgainAfterError(conversationId: string, errorSeq: number) {
    if (this.runtime(conversationId).running || this.stopping) return;
    if (!canTryAgain(this.store.listEventsFrom(conversationId, errorSeq), errorSeq)) return;
    this.prompt(conversationId, CONTINUE_AFTER_INTERRUPTION).catch(() => {});
  }

  /** The agent does not continue by itself after all; messages queued meanwhile go out now. */
  stopWaitingForUsageLimit(conversationId: string) {
    if (!this.endUsageLimitWait(this.runtime(conversationId))) return;
    this.append(conversationId, { type: "usage-limit-wait-stopped" });
    this.publish(this.get(conversationId));
    this.sendNextQueuedMessage(conversationId);
  }

  /** `mirador when-done`: once the job ends, the agent gets the message as your next one, or only you are told. */
  waitForJob(conversationId: string, request: JobWaitRequest) {
    return this.jobWaits.add(conversationId, request);
  }

  stopWaitingForJob(conversationId: string, waitId: string) {
    const wait = this.jobWaits.stop(conversationId, waitId);
    if (wait) this.append(conversationId, { type: "job-wait-ended", wait, end: "stopped" });
  }

  /** Stops one of Claude Code's own background tasks; the turn that started it keeps running. */
  async stopAsyncTask(conversationId: string, asyncTaskId: string) {
    const harness = this.runtimes.get(conversationId)?.harness;
    const sessionId = this.get(conversationId).acpSessionId;
    const stopped = harness && sessionId ? await harness.stopAsyncTask(sessionId, asyncTaskId) : false;
    // A stopped state is coming with the agent's own update, unless it has no task to stop and none is coming.
    if (!stopped && this.asyncTasks.markUnstoppable(conversationId, asyncTaskId)) this.publish(this.get(conversationId));
  }

  dismissAsyncTask(conversationId: string, asyncTaskId: string) {
    if (this.asyncTasks.dismiss(conversationId, asyncTaskId)) this.republish(conversationId);
  }

  clearFinishedAsyncTasks(conversationId: string) {
    if (this.asyncTasks.clearFinished(conversationId)) this.republish(conversationId);
  }

  /** The last part of the file a background task writes its output to; null when there is none to read. */
  asyncTaskOutput(conversationId: string, asyncTaskId: string): string | null {
    const path = this.asyncTasks.outputFileOf(conversationId, asyncTaskId);
    return path === null ? null : tailTaskOutput(path);
  }

  /** A terminal tab that shows what the job runs and follows its output. */
  jobFollowProgram(conversationId: string, waitId: string): TerminalProgram {
    const wait = this.jobWaits.in(conversationId).find(({ id }) => id === waitId);
    if (!wait) throw new HostProblemError({ code: "job-wait-gone" });
    return followJobProgram(wait);
  }

  private jobWaitEnded(conversationId: string, wait: JobWait, end: Exclude<JobWaitEnd, "stopped">) {
    this.append(conversationId, { type: "job-wait-ended", wait, end });
    const message = messageAtEnd(wait, end);
    if (wait.resume) this.send(conversationId, message, [], { fromScript: true }).catch(() => {});
    else this.notifications.notify(conversationId, { kind: "job-ended", message });
  }

  setFavourite(conversationId: string, favourite: boolean) {
    this.get(conversationId);
    this.store.setFavourite(conversationId, favourite);
    this.republish(conversationId);
  }

  /** Put away, an idle conversation's agent session is freed at once, a busy one's once it settles; it resumes when the user next writes. */
  setReminder(conversationId: string, reminder: Reminder | null) {
    if (reminder !== null && !isReminder(reminder)) throw new HostProblemError({ code: "reminder-not-valid" });
    this.get(conversationId);
    this.store.setReminder(conversationId, reminder);
    this.republish(conversationId);
    this.scheduleReminders();
    if (isPutAway(reminder)) void this.freeSessionIfSettled(conversationId, { justPutAway: true });
  }

  /** /later and /remind typed where the page did not take them, as on a phone: the host's clock reads the time. */
  private tookReminderCommand(conversationId: string, text: string) {
    const command = reminderCommandIn(text);
    if (!command) return false;
    const reminder = reminderFromCommand(command, new Date(), this.store.reminderMorning());
    if (!reminder) throw new HostProblemError({ code: "reminder-needs-time" });
    this.setReminder(conversationId, reminder);
    return true;
  }

  /** Starts the reminders' clock; ones whose time passed while the host was down come back at once. */
  startReminders() {
    this.scheduleReminders();
  }

  /**
   * Wakes at the next reminder's time, or sooner: a timer's wait can stop counting while the computer sleeps, so the
   * wall clock is looked at again at least this often.
   */
  private scheduleReminders() {
    clearTimeout(this.reminderTimer);
    if (this.stopping) return;
    const pending = this.store.listConversations().filter(({ reminder }) => isPending(reminder));
    if (pending.length === 0) return;
    const next = Math.min(...pending.map(({ reminder }) => reminder!.at));
    this.reminderTimer = setTimeout(() => this.reminderClockTicked(), Math.max(0, Math.min(next - Date.now(), REMINDER_CHECK_MS)));
  }

  private reminderClockTicked() {
    const now = Date.now();
    const pending = this.store.listConversations().filter(({ reminder }) => isPending(reminder));
    pending.filter(({ reminder }) => reminder!.at <= now).forEach(({ id }) => this.reminderDue(id));
    pending.filter(({ reminder }) => reminder!.at > now && isPutAway(reminder)).forEach(({ id }) => void this.freeSessionIfSettled(id));
    this.scheduleReminders();
  }

  /** Its time came: back at the top of its workspace, marked to come back to, and the user told, with their note. */
  private reminderDue(conversationId: string) {
    const conversation = this.get(conversationId);
    const { reminder } = conversation;
    if (!reminder || reminder.due) return;
    this.store.setReminder(conversationId, { ...reminder, due: true });
    this.republish(conversationId);
    const first = this.store
      .listConversations()
      .filter(({ workspaceId }) => workspaceId === conversation.workspaceId)
      .sort(inSidebarOrder)[0];
    if (first && first.id !== conversationId) this.move(conversationId, first.id);
    this.markUnread(conversationId);
    this.notifications.notify(conversationId, { kind: "reminder", ...(reminder.note && { note: reminder.note }) });
  }

  /**
   * Put away, the conversation lets go of its agent session, but only where the agent frees it on close and can pick it
   * up again with its context, and only once nothing still needs it. Opened again from its Later group, it keeps its
   * session while the user looks at it; the page that just put it away still shows it for a moment, which doesn't count.
   */
  private async freeSessionIfSettled(conversationId: string, { justPutAway = false } = {}) {
    const runtime = this.runtimes.get(conversationId);
    const harness = runtime?.harness;
    if (!runtime?.sessionId || !harness) return;
    const sessionId = await runtime.sessionId.catch(() => null);
    if (!sessionId || !(await this.reopensWithContext(conversationId, harness))) return;
    if (runtime.harness !== harness || !isPutAway(this.store.findConversation(conversationId)?.reminder)) return;
    const settled = sessionIsSettled({
      running: runtime.running,
      holdingQueue: runtime.holdingQueue,
      queuedMessages: runtime.queuedMessages.length,
      pendingPermissions: runtime.pendingPermissions.size,
      waitingAsk: this.asksWaitedOn.has(conversationId),
      usageLimitWait: runtime.usageLimit !== undefined,
      jobWaitsThatResume: this.jobWaits.in(conversationId).filter(({ resume }) => resume).length,
      asyncTasks: this.asyncTasks.in(conversationId).length,
      watched: !justPutAway && this.hub.isWatched(conversationId),
    });
    if (settled) await this.releaseSession(conversationId, runtime, sessionId);
  }

  private async reopensWithContext(conversationId: string, harness: HarnessProcess) {
    const { close, resume, load } = await harness.reopening();
    return close && ((resume && !replaysHistoryOnResume(this.get(conversationId).harness)) || load);
  }

  /** A focused window shows the conversation, or the owner marked it read: either way its Done, Failed or Unread mark goes. */
  markSeen(conversationId: string) {
    if (this.forgetUnseenTurnEnd(conversationId)) this.republish(conversationId);
  }

  /** Marks it to come back to, like a turn that ended unseen; a mark it has already stays as it is. */
  markUnread(conversationId: string) {
    if (!this.store.hasConversation(conversationId) || this.unseenTurnEnds.has(conversationId)) return;
    this.unseenTurnEnds.set(conversationId, "unread");
    this.store.setUnseenTurnEnd(conversationId, "unread");
    this.keepLastWords(conversationId);
    this.republish(conversationId);
  }

  /** The canvas reports each question it opens, has answered or withdraws. */
  questionsChanged(conversationId: string) {
    const waiting = this.store.listCanvasItems(conversationId).find((item): item is AskItem => item.kind === "ask" && item.status === "waiting");
    if (waiting) this.asksWaitedOn.set(conversationId, pendingAsk(waiting));
    else this.asksWaitedOn.delete(conversationId);
    if (this.store.hasConversation(conversationId)) this.publish(this.get(conversationId));
  }

  /** Runs a `!` command from the message box where the conversation works, with the environment its agent gets. */
  runCommand(conversationId: string, command: string) {
    const conversation = this.get(conversationId);
    const workspace = this.store.findWorkspace(conversation.workspaceId);
    if (!workspace) throw new HostProblemError({ code: "conversation-workspace-gone" });
    const environment = profileEnvironment(this.profileOf(conversation));
    void this.commands.run(command, workingCopyOf(workspace, conversation).path, environment, (event) => this.append(conversationId, event));
  }

  /** A command the host no longer runs (it was restarted meanwhile) is marked as stopped, so its card stops waiting. */
  stopCommand(conversationId: string, commandId: string) {
    if (this.commands.isRunning(commandId)) return this.commands.stop(commandId);
    const orphaned = userCommandsIn(this.store.listEvents(conversationId)).some((command) => command.commandId === commandId && !command.ended);
    if (orphaned) this.append(conversationId, { type: "user-command-ended", commandId, exitCode: null });
  }

  dropCommandOutputs(conversationId: string, commandIds: string[]) {
    if (commandIds.length > 0) this.append(conversationId, { type: "user-command-dropped", commandIds });
  }

  editQueuedMessage(conversationId: string, messageId: string, text: string) {
    if (!text.trim()) return this.removeQueuedMessage(conversationId, messageId);
    this.replaceQueue(conversationId, (queue) => queue.map((message) => (message.id === messageId ? { ...message, text } : message)), messageId);
  }

  setQueuedMessageAfterTurn(conversationId: string, messageId: string, afterTurn: boolean) {
    const switched = ({ afterTurn: _, ...message }: QueuedMessage): QueuedMessage => ({ ...message, ...(afterTurn && { afterTurn }) });
    this.replaceQueue(conversationId, (queue) => queue.map((message) => (message.id === messageId ? switched(message) : message)), messageId);
    if (!afterTurn) this.steerQueuedMessages(conversationId);
  }

  /** The agent's own sign-in, with the environment of the conversation's profile, so a profile with its own account signs that one in. */
  loginProgram(conversationId: string, pageOnHost: boolean): TerminalProgram {
    const conversation = this.get(conversationId);
    const environment = launchEnvironment(conversation.harness, this.profileOf(conversation), this.store.claudeProgramSetting());
    return { tabName: `${harnessLabels[conversation.harness]} sign-in`, command: loginCommand(conversation.harness, environment, undefined, pageOnHost), environment };
  }

  /** A command Claude Code shows a panel for only in its own terminal, run in a tab of the conversation's terminals. */
  panelCommandProgram(conversationId: string, line: string): TerminalProgram {
    const command = panelCommandRun(line);
    if (command === null) throw new HostProblemError({ code: "not-a-slash-command", line });
    const conversation = this.get(conversationId);
    if (conversation.harness !== "claude") throw new HostProblemError({ code: "agent-has-no-such-command", agent: harnessLabels[conversation.harness], line });
    const environment = launchEnvironment(conversation.harness, this.profileOf(conversation), this.store.claudeProgramSetting());
    return { tabName: command, command: [environment.CLAUDE_CODE_EXECUTABLE!, command], environment, key: `panel ${command}` };
  }

  loginEnded(conversationId: string, signedIn: boolean) {
    if (this.store.hasConversation(conversationId)) this.append(conversationId, { type: "login-ended", signedIn });
  }

  /** Messages leave the queue from the front, so this changes when one goes out. */
  moveQueuedMessage(conversationId: string, messageId: string, beforeMessageId: string | null) {
    this.replaceQueue(
      conversationId,
      (queue) => {
        const byId = new Map(queue.map((message) => [message.id, message]));
        return movedBefore([...byId.keys()], messageId, beforeMessageId).map((id) => byId.get(id)!);
      },
      messageId,
    );
  }

  /** Images pasted into the message box but left out of what was sent; one that a message carried or a queued one carries stays. */
  discardImages(conversationId: string, imageIds: string[]) {
    if (!this.store.hasConversation(conversationId)) return;
    const carried = new Set([...this.store.sentImageIds(conversationId), ...this.runtime(conversationId).queuedMessages.flatMap((message) => message.imageIds)]);
    imageIds.filter((imageId) => !carried.has(imageId)).forEach((imageId) => this.images.delete(conversationId, imageId));
  }

  removeQueuedMessage(conversationId: string, messageId: string) {
    this.replaceQueue(conversationId, (queue) => queue.filter(({ id }) => id !== messageId), messageId);
  }

  async cancel(conversationId: string, { force = false } = {}): Promise<void> {
    if (force) return this.forceCancel(conversationId);
    const runtime = this.runtime(conversationId);
    if (runtime.setupCommandId) this.commands.stop(runtime.setupCommandId);
    runtime.pendingPermissions.forEach(({ settle }) => settle(null));
    const conversation = this.get(conversationId);
    if (runtime.running && runtime.turn && !runtime.turn.promptSent) {
      runtime.turn.stoppedBeforePrompt = true;
      return;
    }
    if (runtime.running && conversation.acpSessionId) {
      await this.awaitRecordedPrompt(conversation, runtime.turn);
      await this.harnessFor(conversation).cancel(conversation.acpSessionId);
    }
  }

  /**
   * A cancel that beats Claude Code's own record of the turn's prompt can lose that prompt from the agent's history,
   * so the next message is answered as if the stopped one was never sent. The record lands shortly after the request
   * goes out; wait only for it, up to a bound, so Stop stays instant in every case that is already safe.
   */
  private async awaitRecordedPrompt(conversation: Conversation, turn: TurnInProgress | undefined) {
    const prompt = turn?.promptSent;
    const sessionId = conversation.acpSessionId;
    if (!prompt || !sessionId || conversation.harness !== "claude") return;
    const deadline = Date.now() + PROMPT_RECORD_WAIT_MS;
    while (Date.now() < deadline) {
      const transcript = await claudeTranscript(this.claudeConfigDirOf(conversation), sessionId);
      if (userMessageTakenInAt(transcript, prompt.text, prompt.sentAt) !== null) return;
      await Bun.sleep(50);
    }
  }

  /**
   * Unwedges a turn the agent won't cancel (e.g. its model request is blocked) by killing the shared agent process.
   * Siblings on the same process lose their turn too, so they continue where they left off; the conversation the user
   * force-stopped stays stopped.
   */
  private async forceCancel(conversationId: string): Promise<void> {
    const harness = this.runtime(conversationId).harness;
    if (!harness) return this.cancel(conversationId);
    const stopped = await this.killAgent(harness, { kind: "force-stopped" });
    this.continueStoppedTurns(stopped.filter((turn) => turn.conversationId !== conversationId));
  }

  /**
   * Every turn the kill ends is the host's doing rather than the agent's failure, so each ends the way a stop ends it.
   * Returns those turns once they all have ended.
   */
  private async killAgent(harness: HarnessProcess, reason: AgentGone): Promise<StoppedTurn[]> {
    const running = [...this.runtimes].filter(([, runtime]) => runtime.harness === harness && runtime.running);
    running.forEach(([, runtime]) => (runtime.killedOnPurpose = true));
    const stopped = running.map(([conversationId]) => ({ conversationId, sessionId: this.get(conversationId).acpSessionId }));
    this.moveIdleConversationsOff(harness);
    await harness.stop(reason);
    await Promise.all(running.map(([, runtime]) => runtime.turnEnded));
    return stopped;
  }

  /**
   * The next message of a conversation idle on an agent being stopped starts a fresh one, rather than reach this one
   * before its exit is noticed, which on Windows, where ending a process tree takes a while, it would.
   */
  private moveIdleConversationsOff(harness: HarnessProcess) {
    this.agentProcesses.forEach((current, profileId) => {
      if (current === harness) this.agentProcesses.delete(profileId);
    });
    this.runtimes.forEach((runtime) => {
      if (runtime.harness !== harness || runtime.running) return;
      runtime.harness = undefined;
      runtime.sessionId = undefined;
    });
  }

  /** As after a restart, on a fresh agent process. */
  private continueStoppedTurns(turns: StoppedTurn[]) {
    turns.forEach(({ conversationId, sessionId }) => this.resumeStoppedTurn(conversationId, sessionId).catch(() => {}));
  }

  respondToPermission(conversationId: string, permissionId: string, optionId: string | null) {
    const pending = this.runtime(conversationId).pendingPermissions.get(permissionId);
    if (!pending) throw new HostProblemError({ code: "permission-no-longer-pending" });
    pending.settle(optionId);
  }

  /** Where the conversations' Claude Code sessions are registered; a profile may set its own config directory. */
  claudeConfigDirs(): string[] {
    return this.store
      .listConversations()
      .filter(({ harness, acpSessionId }) => harness === "claude" && acpSessionId !== null)
      .map((conversation) => this.claudeConfigDirOf(conversation));
  }

  /** Marks conversations whose Claude Code session is also open in a terminal, e.g. one continued from there. */
  showTerminalActivity(activityBySession: Map<string, TerminalActivity>) {
    this.store.listConversations().forEach((conversation) => {
      const activity = (conversation.harness === "claude" && conversation.acpSessionId && activityBySession.get(conversation.acpSessionId)) || null;
      if (this.terminalWork.seen(conversation.id, activity)) void this.catchUpWithTerminal(conversation.id);
      if ((this.terminalActivity.get(conversation.id) ?? null) === activity) return;
      if (activity) this.terminalActivity.set(conversation.id, activity);
      else this.terminalActivity.delete(conversation.id);
      this.publish(conversation);
    });
  }

  /**
   * Once the user is done in a terminal, the turns they took there join the conversation, and its agent goes on from
   * them rather than from what it last held. A turn running here goes first; the next look at the terminals catches up.
   */
  private async catchUpWithTerminal(conversationId: string) {
    const runtime = this.runtime(conversationId);
    if (runtime.running || this.stopping || this.catchingUpWithTerminal.has(conversationId)) return;
    this.catchingUpWithTerminal.add(conversationId);
    try {
      await runtime.sessionId?.catch(() => {});
      if (runtime.running) return;
      this.terminalWork.caughtUp(conversationId);
      const { acpSessionId } = this.get(conversationId);
      if (!acpSessionId) return;
      const released = this.releaseSession(conversationId, runtime, acpSessionId);
      await this.ensureSession(conversationId, async () => {
        await released;
        return this.loadWithTerminalTurns(conversationId, acpSessionId);
      }).catch(() => {});
    } finally {
      this.catchingUpWithTerminal.delete(conversationId);
    }
  }

  /**
   * Conversations pick up a changed or deleted profile from a fresh agent process. Turns in progress stop; with a
   * changed profile they continue where they left off.
   */
  restartProfile(profileId: string) {
    this.profileChoicesCache.delete(profileId);
    this.profileChoiceProbes.delete(profileId);
    void this.activeProbeHarnesses.get(profileId)?.stop();
    this.activeProbeHarnesses.delete(profileId);
    const keys = [...this.agentProcesses.keys()].filter((key) => key === profileId || key.startsWith(`${profileId}/`));
    if (keys.length === 0) return;
    const harnesses = keys.map((key) => this.agentProcesses.get(key)!);
    keys.forEach((key) => this.agentProcesses.delete(key));
    void Promise.all(harnesses.map((harness) => this.killAgent(harness, { kind: "restarted-for-profile" }))).then((stopped) => {
      if (this.store.findProfile(profileId)) this.continueStoppedTurns(stopped.flat());
    });
  }

  /** Claude Code agents start again with the program now set, as a profile's agent does when the profile changes. */
  restartClaudeAgents() {
    this.store.listProfiles().forEach(({ id, harness }) => {
      if (harness !== "claude") return;
      this.profileChoicesCache.delete(id);
      this.profileChoiceProbes.delete(id);
    });
    [...this.agentProcesses]
      .filter(([key]) => this.store.findProfile(key.split("/")[0])?.harness === "claude")
      .forEach(([key, harness]) => {
        this.agentProcesses.delete(key);
        void this.killAgent(harness, { kind: "restarted-for-claude-program" }).then((stopped) => this.continueStoppedTurns(stopped));
      });
  }

  /**
   * Stops running turns the way Stop does and holds every queue; returns the conversations whose turn the next host
   * must continue — not one the agent finished during the wait, whose message was answered and must not go out twice.
   */
  async prepareForRestart(): Promise<string[]> {
    this.stopping = true;
    const running = [...this.runtimes].filter(([, runtime]) => runtime.running).map(([conversationId]) => conversationId);
    await Promise.all(running.map((conversationId) => Promise.race([this.stopTurn(conversationId), Bun.sleep(TURN_STOP_TIMEOUT_MS)])));
    return running.filter((conversationId) => this.runtime(conversationId).running || !agentFinishedItsTurn(this.store.listEvents(conversationId)));
  }

  /**
   * Picks up where the previous host stopped: a turn it stopped for a restart continues where it left off, if the agent
   * recorded it. Otherwise messages still queued (also after a crash) go out, as they would have when the turn ended,
   * and a reply the previous host owed a plugin, for a turn that ended as it stopped or that it died in, is told. The
   * conversations that wait are announced again, so phones still showing a notification of one read meanwhile get a clear.
   */
  resumeAfterRestart(stoppedTurns: string[]) {
    this.withdrawAsksOrphanedByRestart(stoppedTurns);
    this.store.listConversations().forEach(({ id, acpSessionId }) => {
      if (stoppedTurns.includes(id)) return void this.resumeStoppedTurn(id, acpSessionId).catch(() => {});
      this.deliverOwedReply(id, this.turnsCutShortByCrash.has(id) ? "failed" : undefined);
      if (!this.resumeUsageLimitWait(id)) this.sendNextQueuedMessage(id);
    });
    this.jobWaits.startAll();
    this.announceWaiting();
  }

  shutdown() {
    this.stopping = true;
    clearTimeout(this.reminderTimer);
    this.jobWaits.stopAll();
    return Promise.all([this.commands.shutdown(), ...[...this.agentProcesses.values()].map((harness) => harness.stop())]);
  }

  /** An open that fails after another has replaced it, as when the agent it was on is stopped, leaves the newer one be. */
  private ensureSession(conversationId: string, open = () => this.openSession(conversationId)): Promise<string> {
    const runtime = this.runtime(conversationId);
    if (runtime.sessionId) return runtime.sessionId;
    const opening: Promise<string> = (this.get(conversationId).worktree ? this.openAfterItsWorktree(conversationId, open) : open()).catch((error) => {
      if (runtime.sessionId && runtime.sessionId !== opening) throw error;
      runtime.sessionId = undefined;
      if (this.store.hasConversation(conversationId)) {
        this.setStatus(conversationId, "error", errorMessage(error), problemOf(error).problem);
      }
      throw error;
    });
    runtime.sessionId = opening;
    return opening;
  }

  /** A worktree conversation opens once its worktree is a real checkout, making again one a kill left half-made. */
  private async openAfterItsWorktree(conversationId: string, open: () => Promise<string>) {
    const { worktree } = this.get(conversationId);
    if (!worktree) return open();
    if (!(await this.worktrees.isMade(worktree))) await this.prepareWorktree(conversationId, worktree);
    return open();
  }

  /** Before the agent of a worktree conversation first starts, the worktree is made and set up; a turn waiting for that is starting meanwhile. */
  private async prepareWorktree(conversationId: string, worktree: ConversationWorktree) {
    try {
      await this.makeWorktree(this.get(conversationId), worktree);
    } finally {
      if (this.store.hasConversation(conversationId)) {
        this.setStatus(conversationId, this.runtime(conversationId).running ? "starting" : "idle");
      }
    }
  }

  /**
   * The worktree, then the workspace's setup command in it, which shows in the conversation as a command the user ran,
   * so its output is there to read. The agent starts when the command ends, however it ends, and hears of it with the
   * next message only when it failed.
   */
  private async makeWorktree(conversation: Conversation, worktree: ConversationWorktree) {
    const workspace = this.existingWorkspace(conversation.workspaceId);
    this.setBusy(conversation.id, "making-worktree");
    await this.worktrees.make(workspace, worktree);
    if (!this.store.hasConversation(conversation.id)) {
      await this.worktrees.remove(workspace, worktree);
      throw new HostProblemError({ code: "conversation-deleted-while-opening" });
    }
    if (!workspace.worktreeSetup) return;
    this.setBusy(conversation.id, "setting-up-worktree");
    const environment = { ...profileEnvironment(this.profileOf(conversation)), MIRADOR_WORKSPACE: workspace.path };
    let setupCommandId: string | undefined;
    let succeeded = false;
    const runtime = this.runtimes.get(conversation.id);
    await this.commands.run(workspace.worktreeSetup, worktree.folder, environment, (event) => {
      if (event.type === "user-command") {
        setupCommandId = event.commandId;
        if (runtime) runtime.setupCommandId = setupCommandId;
      }
      if (event.type === "user-command-ended") succeeded = event.exitCode === 0;
      this.append(conversation.id, event);
    });
    if (runtime) runtime.setupCommandId = undefined;
    if (!this.store.hasConversation(conversation.id)) {
      await this.worktrees.remove(workspace, worktree);
      throw new HostProblemError({ code: "conversation-deleted-while-opening" });
    }
    if (succeeded && setupCommandId) this.dropCommandOutputs(conversation.id, [setupCommandId]);
  }

  private releaseSession(conversationId: string, runtime: Runtime, sessionId: string | null) {
    const harness = runtime.harness;
    runtime.harness = undefined;
    runtime.sessionId = undefined;
    if (!harness || !sessionId) return Promise.resolve();
    // Once the session is released, nothing can stop or report its background tasks through this conversation.
    this.forgetAsyncTasks(conversationId);
    return Promise.race([harness.closeSession(sessionId).catch(() => {}), Bun.sleep(SESSION_CLOSE_TIMEOUT_MS)]);
  }

  /**
   * An Antigravity conversation's own agent process serves only it, so it goes with the conversation or with the profile
   * it moves off. With no profile left to name it by, as when the conversation was deleted already, its id finds the key.
   */
  private stopDedicatedHarness(profileId: string | null, conversationId: string) {
    const keys = profileId ? [`${profileId}/${conversationId}`] : [...this.agentProcesses.keys()].filter((key) => key.endsWith(`/${conversationId}`));
    keys.forEach((key) => {
      const harness = this.agentProcesses.get(key);
      if (!harness) return;
      this.agentProcesses.delete(key);
      void harness.stop();
    });
  }

  /**
   * Picks up a turn stopped for a restart or a profile switch. Messages sent while the session reopens wait behind the
   * turn, as they would have behind it before the stop.
   */
  private async resumeStoppedTurn(conversationId: string, stoppedSessionId: string | null) {
    const request = unfinishedTurnRequest(this.store.listEvents(conversationId));
    if (!request) return this.letTheTurnRest(conversationId);
    const runtime = this.runtime(conversationId);
    this.setStatus(conversationId, "starting");
    runtime.holdingQueue = true;
    const continuation = await this.continuationOf(conversationId, stoppedSessionId, request).catch((error: unknown) => {
      runtime.holdingQueue = false;
      this.deliverOwedReply(conversationId, "failed");
      this.sendNextQueuedMessage(conversationId);
      throw error;
    });
    runtime.holdingQueue = false;
    const waitedOnAnswer = turnWaitedOnAnswer({ askMode: this.get(conversationId).askMode, askedAt: this.waitingAskAt(conversationId), turnBeganAt: request.beganAt });
    // The agent has the request in its history and only the user's answer is missing: a continue would take the turn
    // on past the question, whose answer would then reach the agent as a message beside an answer it never gave. A
    // session that starts afresh never asked it, so the question goes and the whole request comes back instead.
    if (waitedOnAnswer && continuation.keptItsPlace) return this.letTheTurnRest(conversationId);
    if (waitedOnAnswer) this.withdrawWaitingAsks(conversationId);
    return this.prompt(conversationId, continuation.text, { imageIds: continuation.imageIds });
  }

  /** The turn a stop cut short gets no message of the host's: it waits for the user, whose next one carries it on. */
  private letTheTurnRest(conversationId: string) {
    this.setStatus(conversationId, "idle");
    this.deliverOwedReply(conversationId);
    this.sendNextQueuedMessage(conversationId);
  }

  /** When the question the canvas still holds an answer for went out, or null when none does. */
  private waitingAskAt(conversationId: string) {
    return this.store.listCanvasItems(conversationId).find((item) => item.kind === "ask" && item.status === "waiting")?.createdAt ?? null;
  }

  /**
   * Takes back the questions a conversation still holds open, telling the pages watching it: no tool call of that
   * conversation waits for their answers any more, and an answer given to a question nobody asked would reach no one.
   */
  private withdrawWaitingAsks(conversationId: string) {
    this.store
      .listCanvasItems(conversationId)
      .filter((item): item is AskItem => item.kind === "ask" && item.status === "waiting")
      .forEach((item) => {
        const withdrawn = { ...item, status: "cancelled" as const, updatedAt: Date.now() };
        this.store.saveCanvasItem(withdrawn);
        this.hub.publishToConversation(conversationId, { type: "canvas.upserted", item: withdrawn });
      });
    this.questionsChanged(conversationId);
  }

  /**
   * The agent continues where it left off if it is still in the session the turn ran in and recorded the request there;
   * otherwise, as in a fresh session, it gets the request again and `keptItsPlace` says the history it had is gone.
   */
  private async continuationOf(conversationId: string, stoppedSessionId: string | null, request: TurnRequest) {
    const sessionId = await this.ensureSession(conversationId);
    if (sessionId === stoppedSessionId && (await this.sessionRecorded(conversationId, sessionId, request)))
      return { text: CONTINUE_AFTER_INTERRUPTION, imageIds: [], keptItsPlace: true };
    return { text: request.text, imageIds: request.imageIds, keptItsPlace: false };
  }

  /** Only Claude Code's transcript tells whether the agent recorded the message that started a turn. */
  private async sessionRecorded(conversationId: string, sessionId: string, request: TurnRequest) {
    const conversation = this.get(conversationId);
    if (conversation.harness !== "claude") return true;
    return recordsUserMessage(await claudeTranscript(this.claudeConfigDirOf(conversation), sessionId), request.firstText);
  }

  private agentHasRecorded(conversationId: string) {
    return sessionHasRecord(this.store.listEvents(conversationId));
  }

  private async openSession(conversationId: string): Promise<string> {
    const runtime = this.runtime(conversationId);
    const held = runtime.heldCodexSession;
    if (held) {
      runtime.heldCodexSession = undefined;
      return this.loadExternalSession(conversationId, held, "continue", null);
    }
    const conversation = this.get(conversationId);
    const isFirstSession = conversation.acpSessionId === null;
    const harness = this.harnessFor(conversation);
    this.runtime(conversationId).harness = harness;
    const capabilities = await harness.start();
    const sessionRequest = await this.sessionRequest(conversationId);

    const canResume = Boolean(capabilities.agentCapabilities?.sessionCapabilities?.resume) && !replaysHistoryOnResume(conversation.harness);
    const canLoad = Boolean(capabilities.agentCapabilities?.loadSession);
    if (conversation.acpSessionId && (canResume || canLoad) && this.agentHasRecorded(conversationId)) {
      try {
        const replay: acp.SessionNotification[] = [];
        const resumed = canResume
          ? await harness.resumeSession({ ...sessionRequest, sessionId: conversation.acpSessionId })
          : await this.loadWithoutReplay(harness, conversation.acpSessionId, sessionRequest, replay);
        this.bindSession(conversationId, conversation.acpSessionId, resumed.configOptions);
        replay.filter(({ update }) => SESSION_STATE_UPDATES.has(update.sessionUpdate)).forEach((notification) => this.handleSessionUpdate(notification));
        await this.restoreConfigChoices(conversationId, conversation.acpSessionId, conversation.configOptions);
        return conversation.acpSessionId;
      } catch (reopenError) {
        this.closeSessionIfConversationDeleted(conversationId, harness, conversation.acpSessionId);
        const error = asCodexSessionHeld(reopenError);
        this.append(conversationId, problemEvent({ code: "could-not-resume", ...causeOf(error, errorMessage(error)) }));
      }
    }

    this.forgetContextUsage(conversationId);
    const created = await harness.newSession(sessionRequest);
    this.closeSessionIfConversationDeleted(conversationId, harness, created.sessionId);
    this.muteNotifier(conversation, created.sessionId);
    this.bindSession(conversationId, created.sessionId, created.configOptions);
    await this.restoreConfigChoices(conversationId, created.sessionId, conversation.configOptions);
    await this.applyNewSessionChoices(conversation, created.sessionId, isFirstSession);
    runtime.startChoices = undefined;
    return created.sessionId;
  }

  /**
   * An agent reopening a session by loading it replays the whole history, which the transcript already
   * holds; what it sends is kept in `replay`, for the session's state (commands, mode) to be read from once it is bound.
   */
  private async loadWithoutReplay(harness: HarnessProcess, sessionId: string, sessionRequest: Omit<Parameters<HarnessProcess["loadSession"]>[0], "sessionId">, replay: acp.SessionNotification[]) {
    this.replaysBeingRead.set(sessionId, replay);
    try {
      return await harness.loadSession({ ...sessionRequest, sessionId });
    } finally {
      this.replaysBeingRead.delete(sessionId);
    }
  }

  /** Delete closes the session a conversation has; one the agent was still opening when the conversation went is closed here. */
  private closeSessionIfConversationDeleted(conversationId: string, harness: HarnessProcess, sessionId: string) {
    if (this.store.findConversation(conversationId)) return;
    harness.closeSession(sessionId).catch(() => {});
    this.stopDedicatedHarness(null, conversationId);
    throw new HostProblemError({ code: "conversation-deleted-while-opening" });
  }

  /** Replayed history arrives as session updates before the load request returns, so the session is bound first. */
  private async loadExternalSession(conversationId: string, sessionId: string, mode: AdoptMode, forkPoint: SessionForkPoint | null): Promise<string> {
    const conversation = this.get(conversationId);
    const harness = this.harnessFor(conversation);
    this.runtime(conversationId).harness = harness;
    const capabilities = await harness.start();
    if (!capabilities.agentCapabilities?.loadSession) throw new HostProblemError({ code: "agent-cannot-load-sessions", agent: harness.spec.label });
    if (mode === "fork" && !capabilities.agentCapabilities.sessionCapabilities?.fork) throw new HostProblemError({ code: "agent-cannot-fork-sessions", agent: harness.spec.label });
    this.setBusy(conversationId, "loading-history");
    const sessionRequest = await this.sessionRequest(conversationId);
    const loadedId =
      mode === "fork" ? (await harness.forkSession({ sessionId, cwd: sessionRequest.cwd, ...(forkPoint && { _meta: forkPointMeta(forkPoint.messageId) }) })).sessionId : sessionId;
    this.muteNotifier(conversation, loadedId);
    this.save({ ...this.get(conversationId), acpSessionId: loadedId });
    this.sessions.bind(conversationId, loadedId);
    const loaded = await harness.loadSession({ ...sessionRequest, sessionId: loadedId }).catch((error: unknown) => {
      this.closeSessionIfConversationDeleted(conversationId, harness, loadedId);
      const problem = asCodexSessionHeld(error);
      if (problem !== error) this.runtime(conversationId).heldCodexSession = loadedId;
      throw problem;
    });
    this.closeSessionIfConversationDeleted(conversationId, harness, loadedId);
    this.bindSession(conversationId, loadedId, loaded.configOptions);
    if (conversation.harness === "claude") await this.restoreTranscriptModel(conversationId, loadedId, sessionId);
    await this.applyProfileChoices(conversationId, loadedId);
    const source: LoadedSession = { harness: conversation.harness, sessionId, mode, ...(forkPoint && { canvasShownBefore: forkPoint.canvasShownBefore }) };
    await this.restoreCanvas(conversationId, source, this.store.listEvents(conversationId)).catch((error: unknown) =>
      console.error(`restoring the canvas of conversation ${conversationId} failed:`, error),
    );
    this.setStatus(conversationId, "idle");
    return loadedId;
  }

  private async loadWithTerminalTurns(conversationId: string, sessionId: string): Promise<string> {
    const conversation = this.get(conversationId);
    const harness = this.harnessFor(conversation);
    this.runtime(conversationId).harness = harness;
    const capabilities = await harness.start();
    if (!capabilities.agentCapabilities?.loadSession) throw new HostProblemError({ code: "agent-cannot-load-sessions", agent: harness.spec.label });
    this.setBusy(conversationId, "reading-terminal-turns");
    const replay: acp.SessionNotification[] = [];
    this.replaysBeingRead.set(sessionId, replay);
    try {
      const loaded = await harness.loadSession({ ...(await this.sessionRequest(conversationId)), sessionId });
      this.bindSession(conversationId, sessionId, loaded.configOptions);
    } finally {
      this.replaysBeingRead.delete(sessionId);
    }
    const anchor = lastAgentMessageId(this.store.listEvents(conversationId));
    if (anchor) updatesAfter(replay, anchor).forEach((notification) => this.handleSessionUpdate(notification));
    await this.restoreConfigChoices(conversationId, sessionId, conversation.configOptions);
    this.setStatus(conversationId, "idle");
    return sessionId;
  }

  /** A test host's own Claude Code works without the settings and instructions of the user who runs the tests. */
  private async sessionRequest(conversationId: string) {
    const conversation = this.get(conversationId);
    const withoutUserSettings = this.config.testSkipsUserSettings && this.onUsersOwnSetup(conversation);
    const canvasUse = this.store.canvasUse();
    const canvasPlugins = this.canvasPlugins(conversationId);
    const systemPrompt = sessionSystemPrompt(conversation.harness, canvasUse, canvasPlugins);
    const idleCompaction = conversation.profileId === null || this.store.findProfile(conversation.profileId)?.idleCompaction !== false;
    return {
      cwd: await recordedDirectory(this.workspaceOf(conversationId)),
      mcpServers: [this.canvasServerFor(conversationId)],
      _meta: sessionMeta(conversation.harness, canvasUse, {
        canvasAssetsOrigin: this.config.canvasAssetsOrigin,
        withoutUserSettings,
        canvasPlugins,
        idleCompaction,
      }),
      ...(systemPrompt && { systemPrompt }),
    };
  }

  /** claude-notifier hooks into Claude Code only. */
  private muteNotifier(conversation: Conversation, sessionId: string) {
    if (conversation.harness === "claude") this.notifier.mute(sessionId, conversation.title);
  }

  private existingWorkspace(workspaceId: string) {
    const workspace = this.store.findWorkspace(workspaceId);
    if (!workspace) throw new HostProblemError({ code: "workspace-gone" });
    return workspace;
  }

  private bindSession(conversationId: string, sessionId: string, configOptions: acp.SessionConfigOption[] | null | undefined) {
    this.sessions.bind(conversationId, sessionId);
    this.runtime(conversationId).cancelledReply = undefined;
    this.save({ ...this.get(conversationId), acpSessionId: sessionId, configOptions: configOptions ?? [] });
    this.updatesForUnknownSessions.take(sessionId).forEach((notification) => this.handleSessionUpdate(notification));
  }

  /** Claude Code resumes a session on the model that answered last, but claude-agent-acp moves it to the model the settings name. */
  private async restoreTranscriptModel(conversationId: string, sessionId: string, recordedSessionId: string) {
    const model = lastAnsweringModel(await claudeTranscript(this.claudeConfigDirOf(this.get(conversationId)), recordedSessionId));
    const choice = model && modelChoiceFor(this.get(conversationId).configOptions, model);
    if (choice) await this.trySetConfigOption(conversationId, sessionId, "model", choice);
  }

  private claudeConfigDirOf({ profileId }: Conversation) {
    return claudeConfigDir(profileEnvironment(profileId === null ? null : (this.store.findProfile(profileId) ?? null)));
  }

  /**
   * A conversation takes its profile's model when it starts with the profile or moves to it, before its own, a plugin's or
   * a test host's choice can move it again; after that its own choice stands. The first message waits for it, as for a
   * plugin's choice: the profile names the model the conversation was started on.
   */
  private async applyProfileModel(conversationId: string, sessionId: string, holdUntil: number) {
    const { profileId } = this.get(conversationId);
    const model = profileId === null ? undefined : this.store.findProfile(profileId)?.model;
    if (model) await this.applyChosenModel(conversationId, sessionId, model, holdUntil);
  }

  /** A conversation takes its profile's mode and effort when it starts with the profile or moves to it; after that its own choice stands. */
  private async applyProfileChoices(conversationId: string, sessionId: string) {
    const { profileId } = this.get(conversationId);
    const profile = profileId === null ? undefined : this.store.findProfile(profileId);
    const modeOption = this.get(conversationId).configOptions.find(({ category }) => category === "mode");
    if (profile?.mode && modeOption) await this.trySetConfigOption(conversationId, sessionId, modeOption.id, profile.mode);
    const effortOption = this.get(conversationId).configOptions.find(({ category }) => category === "thought_level");
    if (profile?.effort && effortOption && offersValue(effortOption, profile.effort)) {
      await this.trySetConfigOption(conversationId, sessionId, effortOption.id, profile.effort);
    }
  }

  /** A resumed or replacement session starts from the agent's defaults, so re-apply what the user had chosen. */
  private async restoreConfigChoices(conversationId: string, sessionId: string, chosen: acp.SessionConfigOption[]) {
    for (const option of chosen) {
      await this.trySetConfigOption(conversationId, sessionId, option.id, option.currentValue);
    }
  }

  /**
   * A new session takes its model before any effort, as the efforts on offer depend on it: the profile's model under a test
   * host's and a plugin's, then the profile's mode and effort, a test host's effort over the profile's, and a plugin's over
   * both. The profile's model and a plugin's choices hold the first message back until the agent has taken them, so it goes
   * out on them, though for no longer than `startChoicesTimeoutMs` in all.
   */
  private async applyNewSessionChoices(conversation: Conversation, sessionId: string, isFirstSession: boolean) {
    const { id } = conversation;
    const test = this.onUsersOwnSetup(conversation) ? this.config.testModelOverride : {};
    const chosen = this.runtime(id).startChoices ?? {};
    const holdUntil = Date.now() + this.startChoicesTimeoutMs;
    if (isFirstSession) await this.applyProfileModel(id, sessionId, holdUntil);
    if (test.model) await this.trySetConfigOption(id, sessionId, "model", test.model);
    if (chosen.model) await this.applyChosenModel(id, sessionId, chosen.model, holdUntil);
    if (isFirstSession) await this.applyProfileChoices(id, sessionId);
    if (test.effort) await this.trySetConfigOption(id, sessionId, "effort", test.effort);
    if (chosen.effort) await this.applyChosenEffort(id, sessionId, chosen.effort, holdUntil);
  }

  /** An agent that offers no models has none to set. */
  private async applyChosenModel(conversationId: string, sessionId: string, model: string, holdUntil: number) {
    const { configOptions } = this.get(conversationId);
    const modelOption = configOptions.find(({ category }) => category === "model");
    if (!modelOption) return;
    const choice = modelChoiceFor(configOptions, model);
    if (choice === null) return this.showChoiceNotOffered(conversationId, modelOption.name, model);
    await this.holdForStartChoice(conversationId, sessionId, modelOption.id, choice, holdUntil);
  }

  /** A model with no effort, such as Claude's Haiku, has none to set. */
  private async applyChosenEffort(conversationId: string, sessionId: string, effort: string, holdUntil: number) {
    const effortOption = this.get(conversationId).configOptions.find(({ category }) => category === "thought_level");
    if (!effortOption) return;
    if (!offersValue(effortOption, effort)) return this.showChoiceNotOffered(conversationId, effortOption.name, effort);
    await this.holdForStartChoice(conversationId, sessionId, effortOption.id, effort, holdUntil);
  }

  /**
   * Unlike other changes, a plugin's choice waits even on a session slow to answer, as it is what the first message must
   * go out on. Past `holdUntil` it is still asked for, without waiting: the agent takes its changes in order.
   */
  private async holdForStartChoice(conversationId: string, sessionId: string, configId: string, value: string, holdUntil: number) {
    const change = this.changeConfigOption(conversationId, sessionId, configId, value);
    const leftMs = holdUntil - Date.now();
    if (change && leftMs > 0) await this.waitForAnswer(conversationId, sessionId, change, value, leftMs);
  }

  private showChoiceNotOffered(conversationId: string, option: string, value: string) {
    const notOffered = new HostProblemError({ code: "not-a-setting-choice", value, setting: option });
    this.append(conversationId, problemEvent({ code: "could-not-set-option", option, value, ...causeOf(notOffered, notOffered.message) }));
  }

  /**
   * Options depend on each other (haiku has no effort option), so one that no longer exists
   * or is refused must not cost the user their session. Nor may an agent that doesn't answer: Claude Code answers one
   * request at a time, and its first, counting its context's tokens, can wait for a model server to load the model.
   * Such a change still lands once the agent answers, and the session's later changes stop waiting for it meanwhile.
   * A session whose agent process has gone has nothing to change.
   */
  private async trySetConfigOption(conversationId: string, sessionId: string, configId: string, value: ConfigValue) {
    const change = this.changeConfigOption(conversationId, sessionId, configId, value);
    if (!change || this.sessionsSlowToAnswer.has(sessionId)) return;
    await this.waitForAnswer(conversationId, sessionId, change, value, OPTION_ANSWER_TIMEOUT_MS);
  }

  /** An agent that hasn't answered a change within `waitMs` leaves the session slow to answer, and the conversation says so. */
  private async waitForAnswer(conversationId: string, sessionId: string, { current, answered }: OptionChange, value: ConfigValue, waitMs: number) {
    const answeredInTime = await Promise.race([answered.then(() => true), Bun.sleep(waitMs).then(() => false)]);
    if (answeredInTime) return;
    this.sessionsSlowToAnswer.add(sessionId);
    this.append(
      conversationId,
      problemEvent({ code: "option-change-unanswered", option: current.name, current: String(current.currentValue), value: String(value), seconds: Math.ceil(waitMs / 1000) }),
    );
  }

  /**
   * Asks the agent for the change, unless the option doesn't exist, has that value already, or its agent process has
   * gone. `answered` settles, never failing, once the agent answered: with the options it reports kept, or with the
   * reason it gave shown. An agent process that goes away fails its unanswered requests, so it settles then too.
   */
  private changeConfigOption(conversationId: string, sessionId: string, configId: string, value: ConfigValue): OptionChange | undefined {
    const current = this.get(conversationId).configOptions.find(({ id }) => id === configId);
    const harness = this.runtime(conversationId).harness;
    if (!current || current.currentValue === value || !harness) return undefined;
    const answered = harness.setConfigOption(sessionId, configId, value).then(
      (response) => {
        this.sessionsSlowToAnswer.delete(sessionId);
        if (this.isOnSession(conversationId, sessionId)) this.save({ ...this.get(conversationId), configOptions: response.configOptions });
      },
      (error) => {
        if (this.isOnSession(conversationId, sessionId)) this.append(conversationId, problemEvent({ code: "could-not-set-option", option: current.name, value: String(value), ...causeOf(error, errorMessage(error)) }));
      },
    );
    return { current, answered };
  }

  /** The conversation whose agent runs a session, or one of its subagents. */
  async conversationOfSession(sessionId: string): Promise<string | undefined> {
    return this.sessions.conversationOf(sessionId) ?? this.subagentSessions.conversationOf(sessionId);
  }

  private isOnSession(conversationId: string, sessionId: string) {
    return this.store.hasConversation(conversationId) && this.get(conversationId).acpSessionId === sessionId;
  }

  private canvasServerFor(conversationId: string): acp.McpServer {
    return {
      type: "http",
      name: CANVAS_SERVER_NAME,
      url: `${this.config.appOrigin}/mcp/${conversationId}`,
      headers: [{ name: "Authorization", value: `Bearer ${this.config.mcpToken}` }],
    };
  }

  /**
   * The agent process serving a conversation. Antigravity keeps one canvas MCP server per process, the one its first
   * session registered, so every conversation on one profile would reach that first conversation's canvas; it takes a
   * process of its own. The others share one per profile.
   */
  private processKey(profile: Profile, launch: Launch & { id?: string }) {
    return profile.harness === "antigravity" && launch.id ? `${profile.id}/${launch.id}` : profile.id;
  }

  private harnessFor(launch: Launch & { id?: string }): HarnessProcess {
    const profile = this.profileOf(launch);
    const key = this.processKey(profile, launch);
    const existing = this.agentProcesses.get(key);
    if (existing) return existing;
    const spec = harnessSpec(profile, this.store.claudeProgramSetting());
    const harness = new HarnessProcess(
      { ...spec, environment: { ...spec.environment, ...this.scriptEnvironment(spec.environment.PATH), ...this.testModelEnvironment(launch) } },
      {
        onSessionUpdate: (notification) => this.handleSessionUpdate(notification),
        onPermissionRequest: (request, signal) => this.handlePermissionRequest(request, signal),
        onElicitationRequest: (request, signal) => this.handleElicitationRequest(request, signal),
        onExit: (process) => this.handleHarnessExit(process),
      },
      agentLogsDirectory(this.config.dataDir),
    );
    this.agentProcesses.set(key, harness);
    return harness;
  }

  /** A test host's Claude Code starts its sessions on the test model, rather than switching to it once a session runs. */
  private testModelEnvironment(launch: Launch): Record<string, string> {
    const { model } = this.config.testModelOverride;
    return this.onUsersOwnSetup(launch) && model ? { ANTHROPIC_MODEL: model } : {};
  }

  /** Claude Code with no profile, or one with no environment of its own: test hosts choose its model and settings, as a profile with an environment does itself. */
  private onUsersOwnSetup({ harness, profileId }: Launch) {
    const profile = profileId === null ? undefined : this.store.findProfile(profileId);
    return harness === "claude" && !profile?.environment.trim();
  }

  /** The mirador command, and where it reaches the host from the agent or a script it starts (mirador message, mirador when-done). */
  private scriptEnvironment(path: string | undefined) {
    return { MIRADOR_URL: this.config.appOrigin, MIRADOR_SCRIPT_TOKEN: this.config.scriptToken, ...miradorCommandEnvironment(path) };
  }

  private profileOf({ profileId }: { profileId: string | null }) {
    const profile = profileId === null ? undefined : this.store.findProfile(profileId);
    if (!profile) throw new HostProblemError({ code: "conversation-has-no-profile" });
    return profile;
  }

  private handleSessionUpdate(notification: acp.SessionNotification) {
    const replay = this.replaysBeingRead.get(notification.sessionId);
    if (replay) return void replay.push(notification);
    const conversationId = this.sessions.conversationOf(notification.sessionId);
    if (!conversationId) {
      this.updatesForUnknownSessions.remember(notification);
      return;
    }
    const update = notification.update;
    const subagentSession = opencodeSubagentSessionOf(update);
    if (subagentSession) this.subagentSessions.record(subagentSession, conversationId);
    const asyncTaskUpdate = asyncTaskUpdateOf(update);
    if (asyncTaskUpdate) {
      // The panel state these carry goes with the conversation; they are no transcript line of their own, so they skip the events.
      if (this.asyncTasks.apply(conversationId, asyncTaskUpdate)) this.publish(this.get(conversationId));
      return;
    }
    if (update.sessionUpdate === "usage_update") {
      const credits = this.contextUsage.get(conversationId)?.credits;
      const usage: ContextUsage = {
        used: update.used,
        size: update.size,
        cost: update.cost ? { amount: update.cost.amount, currency: update.cost.currency } : null,
        ...(credits !== undefined && { credits }),
      };
      this.setContextUsage(conversationId, usage);
      const model = update._meta?.["_claude/model"];
      if (typeof model === "string") this.runtime(conversationId).reportedModel = model;
      const quotas = reportedQuotas(update._meta);
      if (quotas) this.planQuotas.record(this.get(conversationId).profileId, quotas);
      this.publish(this.get(conversationId));
      return;
    }
    if (update.sessionUpdate === "config_option_update") {
      this.save({ ...this.get(conversationId), configOptions: update.configOptions });
    }
    if (update.sessionUpdate === "session_info_update" && update.title && !this.get(conversationId).titleSetByUser) {
      this.save({ ...this.get(conversationId), title: shownSessionTitle(this.get(conversationId).title, update.title) });
    }
    if (this.dropsCancelledReplyChunk(conversationId, update)) return;
    if (isTurnsOwnToolCall(update)) this.showHeldBackReply(conversationId);
    this.trackReplyProgress(conversationId, update);
    this.append(conversationId, { type: "acp", update: this.withModeName(conversationId, update) });
    this.followToolCalls(conversationId, update);
  }

  private setContextUsage(conversationId: string, usage: ContextUsage) {
    this.contextUsage.set(conversationId, usage);
    this.store.setContextUsage(conversationId, usage);
  }

  /**
   * Copilot writes its usage checkpoint a moment after the turn ends, so the file is read again until it shows more than
   * before the turn. Before a conversation's first reading the file may already hold earlier turns; that reading counts
   * as before this turn. A read that lands during a later turn is safe, as credits only grow.
   */
  private readCreditsAfterTurn(conversationId: string) {
    if (this.get(conversationId).harness !== "copilot") return;
    this.stopReadingCredits(conversationId);
    const delaysMs = [0, 250, 750, 2000];
    const readAfter = (attempt: number, beforeTurn: number | undefined) => {
      this.creditReads.set(
        conversationId,
        setTimeout(async () => {
          this.creditReads.delete(conversationId);
          const reading = await this.refreshCopilotCredits(conversationId);
          const before = beforeTurn ?? reading ?? undefined;
          const grew = reading !== null && before !== undefined && reading > before;
          if (!grew && attempt + 1 < delaysMs.length && this.store.hasConversation(conversationId)) readAfter(attempt + 1, before);
        }, delaysMs[attempt]).unref(),
      );
    };
    readAfter(0, this.contextUsage.get(conversationId)?.credits);
  }

  private stopReadingCredits(conversationId: string) {
    clearTimeout(this.creditReads.get(conversationId));
    this.creditReads.delete(conversationId);
  }

  /** Copilot reports no cost, but writes what its session used to its own events file, so the credits are read from there; shown when they are the first or more. The reading, or null without one. */
  private async refreshCopilotCredits(conversationId: string): Promise<number | null> {
    if (!this.store.hasConversation(conversationId)) return null;
    const conversation = this.get(conversationId);
    if (conversation.harness !== "copilot" || !conversation.acpSessionId) return null;
    let copilotHome: string;
    try {
      copilotHome = copilotHomeOf(profileEnvironment(this.profileOf(conversation)));
    } catch {
      return null;
    }
    const credits = await copilotSessionCredits(copilotHome, conversation.acpSessionId);
    if (credits === null || !this.store.hasConversation(conversationId)) return null;
    const usage = this.contextUsage.get(conversationId) ?? { used: 0, size: 0, cost: null };
    if (usage.credits === undefined || credits > usage.credits) {
      this.setContextUsage(conversationId, { ...usage, credits });
      this.publish(this.get(conversationId));
    }
    return credits;
  }

  /** The mode picker's name for the mode, which the notice shows in place of the agent's id for it. */
  private withModeName(conversationId: string, update: acp.SessionUpdate): acp.SessionUpdate {
    if (update.sessionUpdate !== "current_mode_update") return update;
    const picker = this.get(conversationId).configOptions.find((option) => option.category === "mode" && option.type === "select");
    const name = picker?.type === "select" ? flatSelectOptions(picker).find(({ value }) => value === update.currentModeId)?.name : undefined;
    return name ? { ...update, _meta: { ...update._meta, [MODE_NAME_META_KEY]: name } } : update;
  }

  /** The reply held back since a stop, once the running turn proves it its own or a steer leaves that untold: it shows where it streamed, before what came next. */
  private showHeldBackReply(conversationId: string) {
    const runtime = this.runtime(conversationId);
    const held = runtime.cancelledReply?.held;
    if (!held) return;
    runtime.cancelledReply = undefined;
    held.forEach((update) => {
      this.trackReplyProgress(conversationId, update);
      this.append(conversationId, { type: "acp", update });
    });
  }

  /**
   * The late chunks of a reply a stop cancelled: the agent streams the API's answer after
   * 'Turn ended: cancelled', where it would look as if Stop did not stop. A reply beginning in the
   * running turn is held back rather than shown, until another reply's id proves it the orphan, or
   * a tool call of the turn, a message steered into it or the turn's end shows it as the turn's own.
   * A subagent's own reports carry on arriving as usual.
   */
  private dropsCancelledReplyChunk(conversationId: string, update: acp.SessionUpdate) {
    if (!isAgentReplyChunk(update) || isSubagentReport(update)) return false;
    const runtime = this.runtime(conversationId);
    const pending = runtime.cancelledReply;
    if (!pending) return false;
    const turn = runtime.turn;
    const { drop, pending: stillPending } = cancelledReplyChunks(pending, update, runtime.running && turn !== undefined && !turn.ended);
    runtime.cancelledReply = stillPending ?? undefined;
    return drop;
  }

  /** Which reply the running turn has streamed, so its stop can tell a late chunk of it from the next turn's, and how that reply ends since the turn's last tool call. */
  private trackReplyProgress(conversationId: string, update: acp.SessionUpdate) {
    const turn = this.runtime(conversationId).turn;
    if (!turn || turn.ended) return;
    if (isTurnsOwnToolCall(update)) {
      turn.reply = "";
      turn.lastMessage = "";
      turn.toolCallsAt.push(Date.now());
    }
    if (!isAgentReplyChunk(update) || isSubagentReport(update)) return;
    turn.awaitedUser = false;
    if (typeof update.messageId === "string") {
      if (update.messageId !== turn.lastReplyMessageId) turn.lastMessage = "";
      turn.lastReplyMessageId = update.messageId;
    }
    if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text" && !isInformational(update._meta)) {
      turn.reply += update.content.text;
      turn.lastMessage += update.content.text;
    }
  }

  /** A turn that ends in an error or a kill leaves no agent to finish the tool calls it had running. */
  private failOpenToolCalls(conversationId: string) {
    const { openToolCalls } = this.runtime(conversationId);
    openToolCalls.ids().forEach((toolCallId) => this.append(conversationId, { type: "acp", update: { sessionUpdate: "tool_call_update", toolCallId, status: "failed" } }));
    openToolCalls.clear();
  }

  private followToolCalls(conversationId: string, update: acp.SessionUpdate) {
    const runtime = this.runtime(conversationId);
    if (!runtime.running) return;
    const activityBefore = this.activity(conversationId);
    const madeBySubagent = isSubagentReport(update);
    const finishedOne = runtime.openToolCalls.follow(update, madeBySubagent);
    if (!isDeepStrictEqual(this.activity(conversationId), activityBefore)) this.publish(this.get(conversationId));
    if (finishedOne || this.tookTurnSinceSteerCameEarly(runtime.turn, update, madeBySubagent)) this.steerQueuedMessages(conversationId);
  }

  private tookTurnSinceSteerCameEarly(turn: TurnInProgress | undefined, update: acp.SessionUpdate, madeBySubagent: boolean) {
    if (!turn?.steersAtAgentsNextStep || madeBySubagent || !isAgentsNextStep(update)) return false;
    turn.steersAtAgentsNextStep = false;
    return true;
  }

  private steerQueuedMessages(conversationId: string) {
    const runtime = this.runtime(conversationId);
    runtime.steering = (runtime.steering ?? Promise.resolve()).then(() => this.steerWhileNoToolRuns(conversationId)).catch(() => {});
  }

  /**
   * Messages that join the running turn. Not while a tool call of the agent's own is open: Claude Code would move a
   * running command to the background, and a question or permission prompt the agent waits on with it. Its background
   * subagents' calls don't count, as they keep running, and claude-agent-acp holds the turn open for those subagents.
   * Those the agent cannot take go back to the front of the queue, to go out when the turn ends.
   */
  private async steerWhileNoToolRuns(conversationId: string) {
    const runtime = this.runtime(conversationId);
    const { harness } = runtime;
    const sessionId = this.get(conversationId).acpSessionId;
    if (!runtime.running) return;
    const hasSession = harness !== undefined && sessionId !== null;
    const keptOutBy = whatKeepsQueuedMessagesOut({
      hasSession,
      ownToolCall: this.oldestOwnToolCall(runtime),
      queueHold: this.whatHoldsQueue(runtime),
      agentSteers: (await harness?.canSteer()) ?? false,
    });
    const messages = queuedBeforeSessionChange(runtime.queuedMessages).filter((message) => !message.afterTurn);
    this.logWhatKeepsQueuedMessagesOut(conversationId, runtime, messages.length > 0 ? keptOutBy : null);
    const [first, ...rest] = messages;
    const { turn } = runtime;
    if (!hasSession && first && turn) turn.steersAtAgentsNextStep = true;
    if (keptOutBy !== null || !harness || !sessionId || !first) return;
    this.setQueue(conversationId, runtime, runtime.queuedMessages.filter((message) => !messages.includes(message)));
    this.publish(this.get(conversationId));
    const notes = this.notesForAgent(conversationId);
    const text = messages.map((message) => message.text).join("\n\n");
    const imageIds = messages.flatMap((message) => message.imageIds);
    const steeredAt = Date.now();
    this.showHeldBackReply(conversationId);
    runtime.steerInFlight = true;
    const outcome = await this.promptContent(conversationId, withNotes(notes, text), imageIds)
      .then((prompt) => harness.steer(sessionId, prompt))
      .catch((error: unknown) => `failed: ${errorMessage(error)}`);
    runtime.steerInFlight = false;
    if (outcome !== "injected") {
      console.error(`could not steer queued messages into the turn of conversation ${conversationId}, so they go back to the queue: ${outcome}`);
      if (outcome === "promptRequired" && turn && !turn.ended) turn.steersAtAgentsNextStep = true;
      this.setQueue(conversationId, runtime, [...messages, ...runtime.queuedMessages]);
      this.publish(this.get(conversationId));
      if (!runtime.running) this.sendNextQueuedMessage(conversationId);
      return;
    }
    const seqs = [this.appendUserMessage(conversationId, first, notes), ...rest.map((message) => this.appendUserMessage(conversationId, message, NO_NOTES))];
    const steered = { sessionId, steeredAt, messages, seqs: seqs.filter((seq) => seq !== undefined), commandIds: notes.commands.map(({ commandId }) => commandId) };
    if (turn && !turn.ended) return void turn.steered.push(steered);
    await this.returnUnansweredSteers(conversationId, runtime, [steered]);
    this.sendNextQueuedMessage(conversationId);
  }

  private oldestOwnToolCall({ openToolCalls }: Runtime) {
    const toolCallId = openToolCalls.oldestOfMainAgent();
    return toolCallId === null ? null : { toolCallId, kind: openToolCalls.kindOf(toolCallId) };
  }

  /** A line in the host log each time what keeps queued messages out of the running turn changes, so that a stall shows its cause. */
  private logWhatKeepsQueuedMessagesOut(conversationId: string, { turn }: Runtime, keptOutBy: string | null) {
    if (!turn || turn.queuedMessagesKeptOutBy === keptOutBy) return;
    turn.queuedMessagesKeptOutBy = keptOutBy;
    if (keptOutBy) console.log(`queued messages of conversation ${conversationId} wait outside its running turn: ${keptOutBy}`);
  }

  /**
   * A turn stopped right after a steer can leave the steered messages unanswered, and so can one that ends just as a
   * message joins it: pi says how many in its answer to the turn, and for a stopped Claude Code turn its transcript tells
   * which. They go back to the front of the queue, to go out as the next turn.
   */
  private async returnUnansweredSteers(conversationId: string, runtime: Runtime, steered: SteeredMessages[], response?: acp.PromptResponse) {
    const conversation = this.store.findConversation(conversationId);
    if (!conversation || steered.length === 0) return;
    const endedOnItsOwn = response?.stopReason === "end_turn";
    const unanswered =
      (response && steersLeftUnread(response, steered)) ?? (endedOnItsOwn ? [] : await this.steersUnansweredInTranscript(conversation, steered));
    if (unanswered.length === 0) return;
    const commandIds = unanswered.flatMap((steer) => steer.commandIds);
    this.append(conversationId, { type: "steered-messages-returned", seqs: unanswered.flatMap(({ seqs }) => seqs), ...(commandIds.length > 0 && { commandIds }) });
    this.setQueue(conversationId, runtime, [...unanswered.flatMap(({ messages }) => messages), ...runtime.queuedMessages]);
    this.publish(this.get(conversationId));
  }

  private async steersUnansweredInTranscript(conversation: Conversation, steered: SteeredMessages[]) {
    if (conversation.harness !== "claude") return [];
    const transcript = await claudeTranscript(this.claudeConfigDirOf(conversation), steered[0]!.sessionId);
    const events = this.store.listEvents(conversation.id);
    return steered.filter((steer) => !steerAnswered(transcript, events, steer));
  }

  /** What the user did since their last message that the agent should hear of with this one. */
  private notesForAgent(conversationId: string): NotesForAgent {
    const events = this.store.listEventsOfTypes(conversationId, [...USER_COMMAND_EVENT_TYPES, ...REVERT_EVENT_TYPES]);
    return { commands: awaitingDelivery(userCommandsIn(events)), reverts: pendingReverts(events), canvas: this.canvasNotesOf(conversationId) };
  }

  askFormsWith(askForm: AskForm) {
    this.askForm = askForm;
  }

  private async handleElicitationRequest(request: acp.CreateElicitationRequest, signal: AbortSignal): Promise<acp.CreateElicitationResponse> {
    const { sessionId } = request as { sessionId?: string };
    const conversationId = sessionId === undefined ? undefined : this.sessions.conversationOf(sessionId);
    if (!conversationId) return { action: "cancel" };
    return this.askForm(conversationId, request, signal);
  }

  /** The canvas keeps what happened there that the agent has not heard of: the user's ticks, the errors of pages nobody saw shown. */
  hearCanvasNotesFrom(canvasNotesOf: (conversationId: string) => CanvasNote[]) {
    this.canvasNotesOf = canvasNotesOf;
  }

  /** A session Mirador continues or forks gets back on its canvas what the agent put there. */
  restoresCanvasWith(restoreCanvas: RestoreCanvas) {
    this.restoreCanvas = restoreCanvas;
  }

  private async promptContent(conversationId: string, text: string, imageIds: string[]): Promise<acp.ContentBlock[]> {
    const images = await Promise.all(imageIds.map((imageId) => this.images.contentBlock(conversationId, imageId)));
    return [{ type: "text", text }, ...images];
  }

  private async handlePermissionRequest(
    request: acp.RequestPermissionRequest,
    signal: AbortSignal,
  ): Promise<acp.RequestPermissionResponse> {
    const conversationId = this.sessions.conversationOf(request.sessionId);
    if (!conversationId) return { outcome: { outcome: "cancelled" } };
    const allowOptionId = optionThatAllows(request.options);
    if (allowOptionId && this.get(conversationId).bypassPermissions) {
      return { outcome: { outcome: "selected", optionId: allowOptionId } };
    }
    const reports = this.store.toolCallReports(conversationId, request.toolCall.toolCallId);
    if (allowOptionId && isPreAllowedCanvasTool(canvasToolAskedFor(request.toolCall, reports), this.canvasPlugins(conversationId).toolNames)) {
      return { outcome: { outcome: "selected", optionId: allowOptionId } };
    }
    const runtime = this.runtime(conversationId);
    const toolCall = withReportedToolCall(request.toolCall, reports);
    const editsRead = this.editsAskedFor(conversationId, toolCall);
    const inArrivalOrder = (runtime.permissionArriving ?? Promise.resolve()).then(() => editsRead);
    runtime.permissionArriving = inArrivalOrder;
    const edits = await inArrivalOrder;
    if (signal.aborted || !this.store.hasConversation(conversationId)) return { outcome: { outcome: "cancelled" } };
    // YOLO switched on while the files were read approves only the requests already waiting.
    if (allowOptionId && this.get(conversationId).bypassPermissions) return { outcome: { outcome: "selected", optionId: allowOptionId } };
    const permissionId = crypto.randomUUID();
    if (runtime.turn && !runtime.turn.ended) runtime.turn.awaitedUser = true;
    this.append(conversationId, {
      type: "permission",
      permissionId,
      toolCall,
      options: request.options,
      ...(edits && { edits }),
    });
    this.notifications.notify(conversationId, { kind: "permission", tool: toolCall.title });
    return new Promise((resolve) => {
      const settle: PermissionResolver = (optionId) => {
        if (!runtime.pendingPermissions.delete(permissionId)) return;
        this.append(conversationId, { type: "permission-resolved", permissionId, optionId });
        if (this.store.hasConversation(conversationId)) this.publish(this.get(conversationId));
        resolve(optionId ? { outcome: { outcome: "selected", optionId } } : { outcome: { outcome: "cancelled" } });
      };
      runtime.pendingPermissions.set(permissionId, { settle, allowOptionId, request: pendingPermission(permissionId, request, runtime.openToolCalls.kindOf(request.toolCall.toolCallId)) });
      this.publish(this.get(conversationId));
      signal.addEventListener("abort", () => settle(null), { once: true });
    });
  }

  /** Read before the user answers, since the file changes once they allow the edit. */
  private async editsAskedFor(conversationId: string, toolCall: acp.ToolCallUpdate) {
    try {
      const workspace = this.workspaceOf(conversationId);
      return await editDiffsOf(toolCall, [await recordedDirectory(workspace), workspace.path]);
    } catch {
      return undefined;
    }
  }

  private handleHarnessExit(harness: HarnessProcess) {
    this.agentProcesses.forEach((current, key) => {
      if (current === harness) this.agentProcesses.delete(key);
    });
    this.runtimes.forEach((runtime, conversationId) => {
      if (runtime.harness !== harness) return;
      runtime.harness = undefined;
      runtime.sessionId = undefined;
      runtime.pendingPermissions.forEach(({ settle }) => settle(null));
      // The agent's background tasks ran inside its process and went away with it; no terminal update can arrive.
      this.forgetAsyncTasks(conversationId);
    });
  }

  /** A turn the host was killed in the middle of has no end in the log, which leaves its subagent cards working for good. */
  private endTurnsOrphanedByRestart() {
    const turnsInFlight = this.store.takeTurnsInFlight();
    turnsInFlight.forEach((id) => {
      if (openTurnTheAgentWorkedOn(this.store.listEvents(id))) this.store.endTurnCutShortByRestart(id);
    });
    return turnsInFlight;
  }

  private cancelPermissionsOrphanedByRestart() {
    this.store.listConversations().forEach((conversation) => {
      const events = this.store.listEvents(conversation.id);
      const resolved = new Set(
        events.flatMap(({ event }) => (event.type === "permission-resolved" ? [event.permissionId] : [])),
      );
      events
        .flatMap(({ event }) => (event.type === "permission" && !resolved.has(event.permissionId) ? [event.permissionId] : []))
        .forEach((permissionId) =>
          this.store.appendEvent(conversation.id, { type: "permission-resolved", permissionId, optionId: null }),
        );
    });
  }

  /**
   * The canvas MCP server died with the previous host, so no question a waiting turn left open can still be
   * answered as its tool result; only one whose answer was always to be the next message still asks for one, and one
   * whose turn this host takes up again stays open for the answer to go to that turn as its user's next message.
   */
  private withdrawAsksOrphanedByRestart(turnsBeingResumed: string[]) {
    const orphanedConversations = new Set(
      this.store
        .listCanvasItemsWithStatus("waiting")
        .filter((item): item is AskItem => item.kind === "ask")
        .filter((item) => !turnsBeingResumed.includes(item.conversationId))
        .filter((item) => this.store.findConversation(item.conversationId)?.askMode !== "next-message")
        .map(({ conversationId }) => conversationId),
    );
    orphanedConversations.forEach((conversationId) => this.withdrawWaitingAsks(conversationId));
  }

  /** The queue is kept in the database too, so messages waiting for the agent survive a host restart or crash. */
  private setQueue(conversationId: string, runtime: Runtime, queue: QueuedMessage[]) {
    runtime.queuedMessages = queue;
    this.store.saveQueuedMessages(conversationId, queue);
  }

  private holdsQueue(runtime: Runtime) {
    return this.whatHoldsQueue(runtime) !== null;
  }

  private whatHoldsQueue(runtime: Runtime) {
    if (runtime.holdingQueue) return "the queue waits for a profile switch or for a stopped turn to go on";
    if (this.stopping) return "the host is stopping";
    if (runtime.usageLimit?.timer !== undefined) return "the queue waits for the usage limit to reset";
    if (runtime.steerInFlight) return "messages are on their way into the turn";
    return null;
  }

  /** Returns the failure, as a notification tells it. A turn Claude's usage limit stopped holds the queue until the limit resets. */
  private recordTurnFailure(conversationId: string, error: unknown, promptSent: boolean, spent: { usage?: TurnUsage; model?: string } = {}): Extract<TurnOutcome, { error: string }> {
    const continuable = promptSent && { continuable: true as const };
    const conversation = this.store.findConversation(conversationId);
    if (!conversation || !isUsageLimitError(error, conversation.harness)) {
      const failure = { message: errorMessage(error), ...problemOf(error) };
      this.append(conversationId, { type: "error", ...failure, ...continuable, ...(isAuthRequiredError(error) && { authRequired: true as const }), endsTurn: true });
      return { error: failure.message, ...problemOf(error) };
    }
    const limit = usageLimitMessage(error);
    const resetsAt = usageLimitResetIn(limit.message);
    this.append(conversationId, { type: "error", ...limit, usageLimit: { resetsAt }, ...continuable, endsTurn: true, ...spent });
    this.waitForUsageLimitReset(conversationId, resetsAt);
    return { error: limit.message, ...(limit.problem && { problem: limit.problem }) };
  }

  private waitForUsageLimitReset(conversationId: string, resetsAt: number | null) {
    const runtime = this.runtime(conversationId);
    const continuesAt = this.automaticContinueAt(runtime, resetsAt);
    const timer =
      continuesAt === null
        ? undefined
        : setTimeout(() => this.continueAfterUsageLimit(conversationId, { automatically: true }), Math.max(0, continuesAt - Date.now()));
    runtime.usageLimit = { wait: { resetsAt, continuesAt }, timer };
  }

  /** A reset further off than a timer can wait is surely misread, so then the user continues by hand. */
  private automaticContinueAt(runtime: Runtime, resetsAt: number | null) {
    if (resetsAt === null || runtime.automaticContinues >= AUTOMATIC_CONTINUES_IN_A_ROW) return null;
    const continuesAt = resetsAt + USAGE_LIMIT_RESET_MARGIN_MS;
    return continuesAt - Date.now() <= LONGEST_TIMER_MS ? continuesAt : null;
  }

  /** Returns whether it was waiting. */
  private endUsageLimitWait(runtime: Runtime) {
    if (!runtime.usageLimit) return false;
    clearTimeout(runtime.usageLimit.timer);
    runtime.usageLimit = undefined;
    return true;
  }

  /** A conversation the previous host left waiting for a usage limit's reset waits for it again. */
  private resumeUsageLimitWait(conversationId: string) {
    const latest = this.store.latestTurnEvent(conversationId);
    if (latest?.type !== "error" || !latest.usageLimit) return false;
    this.waitForUsageLimitReset(conversationId, latest.usageLimit.resetsAt);
    this.publish(this.get(conversationId));
    return true;
  }

  private replaceQueue(conversationId: string, change: (queue: QueuedMessage[]) => QueuedMessage[], messageId: string) {
    const runtime = this.runtime(conversationId);
    if (!runtime.queuedMessages.some(({ id }) => id === messageId)) throw new HostProblemError({ code: "queued-message-already-sent" });
    this.setQueue(conversationId, runtime, change(runtime.queuedMessages));
    this.publish(this.get(conversationId));
  }

  /** A turn that started meanwhile, e.g. while a /clear opened the fresh session, sends the queue on once it ends. */
  private sendNextQueuedMessage(conversationId: string) {
    const runtime = this.store.hasConversation(conversationId) ? this.runtime(conversationId) : undefined;
    const [next, ...rest] = runtime?.queuedMessages ?? [];
    if (!runtime || !next || runtime.running || this.holdsQueue(runtime)) return;
    this.setQueue(conversationId, runtime, rest);
    this.prompt(conversationId, next.text, { imageIds: next.imageIds, fromScript: next.fromScript, fromMirador: next.fromMirador, fromPlugin: next.fromPlugin, startsTurn: true }).catch(() => {});
  }

  private appendUserMessage(
    conversationId: string,
    { text, imageIds, fromScript, fromMirador, fromPlugin }: Omit<QueuedMessage, "id">,
    { commands, reverts, canvas }: NotesForAgent,
  ) {
    canvas.forEach((note) => note.heard());
    const attachedCommandIds = commands.map(({ commandId }) => commandId);
    const attachedRevertIds = reverts.map(({ revertId }) => revertId);
    return this.append(conversationId, {
      type: "user-message",
      text,
      ...(attachedCommandIds.length > 0 && { attachedCommandIds }),
      ...(attachedRevertIds.length > 0 && { attachedRevertIds }),
      ...(imageIds.length > 0 && { imageIds }),
      ...(fromScript && { fromScript }),
      ...(fromMirador && { fromMirador }),
      ...(fromPlugin && { fromPlugin }),
    });
  }

  private retitleFromFirstMessage(conversationId: string, text: string) {
    const conversation = this.get(conversationId);
    if (conversation.title !== UNTITLED || conversation.titleSetByUser) return;
    const title = titleFrom(text);
    if (title) this.save({ ...conversation, title });
  }

  private runtime(conversationId: string): Runtime {
    let runtime = this.runtimes.get(conversationId);
    if (!runtime) {
      const queuedMessages = this.store.findConversation(conversationId)?.queuedMessages ?? [];
      runtime = { running: false, holdingQueue: false, pendingPermissions: new Map(), queuedMessages, openToolCalls: new OpenToolCalls(), automaticContinues: 0, stallNudges: 0 };
      this.runtimes.set(conversationId, runtime);
    }
    return runtime;
  }

  /** Returns the event's seq. A turn that was still running when its conversation got deleted ends without a trace. */
  private append(conversationId: string, event: ConversationEvent) {
    if (!this.store.hasConversation(conversationId)) return;
    const stored = this.store.appendEvent(conversationId, event);
    this.hub.publishEvent(conversationId, stored);
    if (event.type === "user-message" || event.type === "turn-end" || (event.type === "error" && event.endsTurn)) this.republish(conversationId);
    const activity = activityOf(event);
    if (activity) this.hearActivity(conversationId, activity);
    return stored.seq;
  }

  private notifyTurnEnded(conversationId: string, outcome: TurnOutcome) {
    if (!this.store.hasConversation(conversationId)) return;
    const runtime = this.runtime(conversationId);
    const reason = turnEndReason(outcome, {
      messagesQueued: runtime.queuedMessages.length > 0,
      resumedByAJob: this.jobWaits.in(conversationId).some(({ resume }) => resume),
      holdsQueue: runtime.holdingQueue || this.holdsQueue(runtime),
    });
    if (!reason || this.stopping) return;
    if (this.itsPluginTellsTheCaller(conversationId)) return;
    this.notifications.notify(conversationId, reason);
    if (this.hub.isWatched(conversationId)) return;
    this.unseenTurnEnds.set(conversationId, reason.kind);
    this.store.setUnseenTurnEnd(conversationId, reason.kind);
    this.keepLastWords(conversationId);
  }

  /**
   * A plugin's tool started this conversation for a caller that is still here, and the plugin, which tells its caller, is
   * yet to hear how its work ended: it hears of this turn and tells that caller, whose own turn end notifies the user. It
   * hears only once, so the turns after notify as any conversation's do, as do those whose caller is gone or whose plugin
   * won't tell (uninstalled, with no `replied`, or no `tellsCaller` in its plugin.json). Its permissions and questions ask
   * of the user all the same, through other paths.
   */
  private itsPluginTellsTheCaller(conversationId: string) {
    const startedBy = this.store.findConversation(conversationId)?.startedBy;
    return (
      startedBy !== undefined && startedBy.reply === null && this.store.hasConversation(startedBy.conversationId) && this.pluginTellsItsCaller(startedBy.plugin)
    );
  }

  private forgetUnseenTurnEnd(conversationId: string) {
    if (!this.unseenTurnEnds.delete(conversationId)) return false;
    this.lastWords.delete(conversationId);
    this.store.setUnseenTurnEnd(conversationId, null);
    return true;
  }

  /** Worked out once when a turn ends unseen, since publishing, which happens all the time, must not read the events. */
  private keepLastWords(conversationId: string) {
    const turnStart = this.store.latestTurnStart(conversationId)?.seq ?? 0;
    const words = lastWordsOf(this.store.listEventsFrom(conversationId, turnStart));
    if (words) this.lastWords.set(conversationId, words);
    else this.lastWords.delete(conversationId);
  }

  private activity(conversationId: string): Activity | null {
    const runtime = this.runtimes.get(conversationId);
    if (!runtime?.running) return null;
    return currentActivity(runtime.openToolCalls, [...runtime.pendingPermissions.values()].map(({ request }) => request.title));
  }

  /** Every conversation `waitingFor` could find waiting, from the three things it reads, so only those that wait are read from the database. */
  private conversationsThatMayWait() {
    return new Set([...this.runtimes.keys(), ...this.asksWaitedOn.keys(), ...this.unseenTurnEnds.keys()]);
  }

  private waitingFor(conversationId: string): WaitingFor | null {
    if ((this.runtimes.get(conversationId)?.pendingPermissions.size ?? 0) > 0) return "permission";
    if (this.asksWaitedOn.has(conversationId)) return "question";
    return this.unseenTurnEnds.get(conversationId) ?? null;
  }

  private pendingRequest(conversationId: string): PendingRequest | null {
    const [oldestPermission] = this.runtimes.get(conversationId)?.pendingPermissions.values() ?? [];
    return oldestPermission?.request ?? this.asksWaitedOn.get(conversationId) ?? null;
  }

  private setStatus(conversationId: string, status: ConversationStatus, statusDetail: string | null = null, statusProblem?: HostProblem) {
    if (!this.store.hasConversation(conversationId)) return;
    this.statusOverrides.set(conversationId, { status, statusDetail, ...(statusProblem && { statusProblem }) });
    this.publish(this.get(conversationId));
  }

  private setBusy(conversationId: string, busyWith: BusyWith) {
    if (!this.store.hasConversation(conversationId)) return;
    this.statusOverrides.set(conversationId, { status: "starting", statusDetail: busyTexts[busyWith], busyWith });
    this.publish(this.get(conversationId));
  }

  private withRuntimeStatus(conversation: Conversation): Conversation {
    return {
      ...conversation,
      ...this.statusOverrides.get(conversation.id),
      openInTerminal: this.terminalActivity.get(conversation.id) ?? null,
      contextUsage: this.contextUsage.get(conversation.id) ?? null,
      queuedMessages: this.runtimes.get(conversation.id)?.queuedMessages ?? conversation.queuedMessages,
      usageLimit: this.runtimes.get(conversation.id)?.usageLimit?.wait ?? null,
      jobWaits: this.jobWaits.in(conversation.id),
      asyncTasks: this.asyncTasks.in(conversation.id),
      waitingFor: this.waitingFor(conversation.id),
      pendingRequest: this.pendingRequest(conversation.id),
      lastWords: this.lastWords.get(conversation.id) ?? null,
      activity: this.activity(conversation.id),
    };
  }

  private save(conversation: Conversation) {
    const updated = { ...conversation, updatedAt: Date.now() };
    this.store.updateConversation(updated);
    this.publish(updated);
  }

  private forgetAsyncTasks(conversationId: string) {
    if (this.asyncTasks.in(conversationId).length === 0) return;
    this.asyncTasks.forget(conversationId);
    this.republish(conversationId);
  }

  private republish(conversationId: string) {
    if (this.store.hasConversation(conversationId)) this.publish(this.get(conversationId));
  }

  private publish(conversation: Conversation) {
    this.hub.broadcast({ type: "conversation.upserted", conversation: this.withRuntimeStatus(conversation) });
    this.announceWaiting();
  }

  private announceWaiting() {
    const waiting = this.waiting();
    this.hub.announceWaiting(waiting);
    this.notifications.waitingChanged(new Set(waiting.conversations.map(({ conversationId }) => conversationId)));
  }

  private announceRunningTurnsCount() {
    this.hub.announceRunningTurnsCount(this.runningTurnsCount());
  }
}


interface TurnRequest {
  /** The message that started the turn and those that joined it, as one. */
  text: string;
  firstText: string;
  imageIds: string[];
  /** When the message that started the turn went out, so what the turn was waiting on can be told from what an earlier one left behind. */
  beganAt: number;
}

/**
 * Whether the turn a stop cut short was itself waiting on an answer of the user's: its question went out after the turn
 * began, and its answer was still to come back as the tool's result. A question an earlier turn left open, or one whose
 * answer always comes as the next message, holds nothing up.
 */
export function turnWaitedOnAnswer({ askMode, askedAt, turnBeganAt }: { askMode: AskMode; askedAt: number | null; turnBeganAt: number }) {
  return askMode === "wait" && askedAt !== null && askedAt >= turnBeganAt;
}

/** opencode 2 marks what a subagent does, reported through its conversation's session, with the subagent's own session. */
export function opencodeSubagentSessionOf(update: acp.SessionUpdate): string | null {
  const { id } = (update._meta?.["opencode/child-session"] ?? {}) as { id?: unknown };
  return typeof id === "string" ? id : null;
}

const isAgentReplyChunk = (update: acp.SessionUpdate) =>
  update.sessionUpdate === "agent_message_chunk" || update.sessionUpdate === "agent_thought_chunk";

/** What an agent's subagent wrote or ran, reported through the conversation's session: not the turn's own reply or tool call. */
const isSubagentReport = (update: acp.SessionUpdate) =>
  opencodeSubagentSessionOf(update) !== null ||
  ((update._meta?.claudeCode ?? {}) as { parentToolUseId?: unknown }).parentToolUseId !== undefined;

const turnUsageOf = ({ usage }: acp.PromptResponse) =>
  usage
    ? {
        usage: {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cachedReadTokens: usage.cachedReadTokens ?? 0,
          cachedWriteTokens: usage.cachedWriteTokens ?? 0,
        },
      }
    : {};

/**
 * A turn left open: it began, the agent worked on it, and nothing ended it. A turn the agent never worked on is not one,
 * since an end written for it would claim a session that can be resumed.
 */
export function openTurnTheAgentWorkedOn(events: StoredEvent[]): boolean {
  const began = events.findLastIndex(({ event }) => event.type === "user-message" || endsTurn({ event }));
  if (events[began]?.event.type !== "user-message") return false;
  return events.slice(began + 1).some(({ event }) => event.type === "acp" && updatesTheAgentRecords.has(event.update.sessionUpdate));
}

const agentOutput = new Set<string>(["agent_message_chunk", "agent_thought_chunk", "tool_call"]);

/**
 * The steered messages an agent that says how many of them it never read, as pi does in its answer to a stopped turn,
 * left unanswered: the last ones, as it reads them first in, first out. Null for an agent that does not say.
 */
export function steersLeftUnread(response: acp.PromptResponse, steered: SteeredMessages[]): SteeredMessages[] | null {
  const unread = (response._meta?.steering as { unanswered?: unknown } | undefined)?.unanswered;
  if (typeof unread !== "number" || !Number.isInteger(unread)) return null;
  return steered.slice(Math.max(0, steered.length - unread));
}

/**
 * Whether the agent began answering messages steered into its turn: it took them in, which Claude Code records, and its
 * output came after. Claude Code writes a reply to its transcript only block by block, so a stop in the middle of the
 * first block leaves none there. Messages with no text to find them by count as answered.
 */
export function steerAnswered(transcript: string, events: StoredEvent[], { messages, steeredAt }: Pick<SteeredMessages, "messages" | "steeredAt">) {
  const withText = messages.find(({ text }) => text.trim());
  if (!withText) return true;
  const takenInAt = userMessageTakenInAt(transcript, withText.text, steeredAt);
  return takenInAt !== null && events.some(({ at, event }) => at > takenInAt && event.type === "acp" && agentOutput.has(event.update.sessionUpdate));
}

/** What the user asked in the turn that ended last: the message that started it and any that joined it, but not those that went out again after it. */
export function lastTurnRequest(events: StoredEvent[]): TurnRequest | null {
  const lastEnd = events.findLastIndex(endsTurn);
  const start = events.slice(0, Math.max(lastEnd, 0)).findLastIndex(endsTurn) + 1;
  return turnRequestWithin(events.slice(start, lastEnd === -1 ? undefined : lastEnd), events);
}

/**
 * What the next host has to send again for the turn a stop left unfinished: the messages of the turn still open, or,
 * if the stop ended the turn, of the turn it ended. Null when no turn waits unfinished — the agent finished its own,
 * or the log holds no request — so a resume never sends another turn's message.
 */
export function unfinishedTurnRequest(events: StoredEvent[]): TurnRequest | null {
  const open = turnRequestWithin(events.slice(events.findLastIndex(endsTurn) + 1), events);
  if (open) return open;
  return agentFinishedItsTurn(events) ? null : lastTurnRequest(events);
}

/** Whether a stalled turn gets a nudge: only when nothing else will carry the conversation on, and a couple of times in a row at most. */
export function nudgesAfterStall(
  nudgesInARow: number,
  { stopping, running, queued, steerInFlight, jobWaits }: { stopping: boolean; running: boolean; queued: number; steerInFlight: boolean; jobWaits: number },
): boolean {
  const carriedOn = stopping || running || queued > 0 || steerInFlight || jobWaits > 0;
  return !carriedOn && nudgesInARow < STALL_NUDGES_IN_A_ROW;
}

/** Whether a reply stops where it announces its next step: its last words end in a ":", past any closing emphasis. */
export function stopsAtAnnouncedStep(reply: string): boolean {
  return /:[*_\s]*$/.test(reply);
}

/** Whether the last turn in the log is over because the agent finished it, and not because a stop cut it short, it failed, or it is still open. */
export function agentFinishedItsTurn(events: StoredEvent[]): boolean {
  const began = events.findLastIndex(({ event }) => event.type === "user-message" || endsTurn({ event }));
  const end = events[began]?.event;
  return end?.type === "turn-end" && end.stopReason !== "cancelled";
}

function turnRequestWithin(events: StoredEvent[], wholeLog: StoredEvent[]): TurnRequest | null {
  const returned = returnedSteerSeqs(wholeLog);
  const messages = events.flatMap(({ seq, at, event }) => (event.type === "user-message" && !returned.has(seq) ? [{ at, ...event }] : []));
  const [first] = messages;
  if (!first) return null;
  return {
    text: messages.map(({ text }) => text).join("\n\n"),
    firstText: first.text,
    imageIds: messages.flatMap(({ imageIds = [] }) => imageIds),
    beganAt: first.at,
  };
}

interface SteeringState {
  hasSession: boolean;
  /** An open tool call of the agent's own: its id, and its kind when the agent said. */
  ownToolCall: { toolCallId: string; kind: acp.ToolKind | null } | null;
  queueHold: string | null;
  agentSteers: boolean;
}

/** Why messages queued while a turn runs cannot join it now, or null when they can. Names a tool call by its id and kind, as its title can hold a secret. */
export function whatKeepsQueuedMessagesOut({ hasSession, ownToolCall, queueHold, agentSteers }: SteeringState): string | null {
  if (!hasSession) return "the conversation has no agent session";
  if (ownToolCall) return `the agent's own tool call ${ownToolCall.toolCallId}${ownToolCall.kind ? ` (${ownToolCall.kind})` : ""} is still open`;
  if (queueHold) return queueHold;
  if (!agentSteers) return "its agent cannot take messages into a running turn";
  return null;
}

/** What could still need a conversation's agent session, which putting it away must not cut off. */
export interface SessionUse {
  running: boolean;
  holdingQueue: boolean;
  queuedMessages: number;
  pendingPermissions: number;
  waitingAsk: boolean;
  usageLimitWait: boolean;
  jobWaitsThatResume: number;
  asyncTasks: number;
  /** A focused page shows it: the user reads it, maybe about to write. */
  watched: boolean;
}

export const sessionIsSettled = (use: SessionUse) =>
  !use.running &&
  !use.holdingQueue &&
  use.queuedMessages === 0 &&
  use.pendingPermissions === 0 &&
  !use.waitingAsk &&
  !use.usageLimitWait &&
  use.jobWaitsThatResume === 0 &&
  use.asyncTasks === 0 &&
  !use.watched;

/** Messages queued after a /clear or a /reload wait for it, rather than join the turn in the session it replaces. */
export const queuedBeforeSessionChange = (queue: QueuedMessage[]) => {
  const changeAt = queue.findIndex(({ text }) => replacesSession(text));
  return changeAt === -1 ? queue : queue.slice(0, changeAt);
};

/** Allowing once leaves no trace behind; Claude Code saves an "always" answer into the project's settings. */
export function optionThatAllows(options: acp.PermissionOption[]): string | null {
  const allowing = options.find(({ kind }) => kind === "allow_once") ?? options.find(({ kind }) => kind === "allow_always");
  return allowing?.optionId ?? null;
}

/**
 * The workspace's folder as its agent gets it in every request: with symlinks resolved, as Claude Code and opencode
 * record a session's directory (e.g. /var → /private/var on macOS), and on Windows with 8.3 short names written out
 * long. Claude Code files a session under the spelling it started in, but looks sessions up only under the long one.
 */
const recordedDirectory = (workspace: Workspace) => realpath(workspace.path).catch(() => workspace.path);

const externalSession = (
  { sessionId, title, updatedAt }: { sessionId: string; title?: string | null; updatedAt?: string | null },
  conversationIdBySession: Map<string | null, string>,
): ExternalSession => ({
  sessionId,
  title: title ?? null,
  updatedAt: updatedAt ?? null,
  conversationId: conversationIdBySession.get(sessionId) ?? null,
});

/** An error event the host writes itself: in English, and as the problem for the page to translate. */
const problemEvent = (problem: HostProblem) => ({ type: "error" as const, message: englishProblem(problem), problem });

export function errorMessage(error: unknown): string {
  if (typeof error !== "object" || error === null) return String(error);
  const { message, data } = error as { message?: unknown; data?: unknown };
  const details = detailsWorthShowing(data);
  return details === null ? String(message ?? error) : `${String(message ?? error)}: ${details}`;
}

/**
 * Tags for the host to read, not for people: Claude Code tags an error with its kind, e.g. {"errorKind":"server_error"},
 * and opencode with where it failed, e.g. {"service":"session","errorName":"provider.invalid-request"}.
 */
const ERROR_TAGS = new Set(["errorKind", "service", "errorName"]);

/** opencode hands an error whose message isn't JSON over as {"details": message}, which reads best as the message alone. */
function detailsWorthShowing(data: unknown) {
  if (data === undefined || data === null) return null;
  if (typeof data !== "object") return String(data);
  if (Array.isArray(data)) return JSON.stringify(data);
  const details = Object.fromEntries(Object.entries(data).filter(([key]) => !ERROR_TAGS.has(key)));
  const keys = Object.keys(details);
  if (keys.length === 0) return null;
  return keys.length === 1 && typeof details.details === "string" ? details.details : JSON.stringify(details);
}
