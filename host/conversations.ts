import { realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { worksInRoomsWorkspaces } from "../shared/brought-agents.ts";
import { assertOpencodeModelAvailable, OPENCODE_EXPECTED_MODEL_ENV, opencodeRoomsWorkspaceEnvironment } from "./acp/rooms-workspace-opencode.ts";
import { piRoomsWorkspaceEnvironment } from "./acp/rooms-workspace-pi.ts";
import type { PluginActivity } from "../shared/canvas-plugins.ts";
import { activityOf, turnEndedAs } from "../shared/plugin-activity.ts";
import { canvasToolName, toolNameOf } from "../shared/tool-title.ts";
import { isDeepStrictEqual } from "node:util";
import type * as acp from "@agentclientprotocol/sdk/unstable";
import {
  busyTexts,
  endsTurnWithSpend,
  harnessIds,
  harnessLabels,
  isConversationPlace,
  isSideChatAccess,
  placeOfNewConversation,
  isUntitled,
  UNTITLED,
  worksForARoom,
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
  type KeptWarm,
  type Launch,
  type PendingAsk,
  type PendingPermissionRequest,
  type PendingRequest,
  type Profile,
  type QueuedMessage,
  type RestoreFiles,
  type RestorePlan,
  type SessionSearchHit,
  type SideChatAccess,
  type StartedBy,
  type StoredEvent,
  type TerminalActivity,
  type TurnSpend,
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
import { COMPACT_COMMAND, isClearCommand, isReloadCommand, replacesSession, toSlashCommand } from "../shared/slash-commands.ts";
import { parseEnvironment } from "../shared/profile-environment.ts";
import { isPending, isPutAway, isReminder, reminderCommandIn, reminderFromCommand, type Reminder } from "../shared/reminders.ts";
import { agentAnsweredIn, lastWordsOf, replyOf } from "../shared/last-words.ts";
import { isRealModel } from "../shared/claude-models.ts";
import { cutWithEllipsis, firstGraphemes } from "../shared/text-cut.ts";
import { isInformational } from "../shared/timeline.ts";
import type { ConversationChoices, ConversationReply, ConversationUsage, ModelRequestSample, RanOn, StartedConversation, WorkspaceConversationStart } from "../shared/canvas-plugins.ts";
import { canTryAgain } from "../shared/try-again.ts";
import { currentActivity, isAgentsNextStep, OpenToolCalls } from "./activity.ts";
import { editDiffsOf } from "./edit-diff.ts";
import { askedPermissionOf, pendingAsk, pendingPermission } from "./pending-requests.ts";
import { allowsBroughtMode, askingDefaultModeOf, askingModeOf, presetModeOf, type AskedPermission } from "../shared/room-permissions.ts";
import { END_OF_OTHERS_WORDS, PROFILES_MODEL, type Room, type RoomAgentModel } from "../shared/rooms.ts";
import { newestWaitingAsk } from "../shared/ask.ts";
import { launchEditor } from "./editor.ts";
import { openAsText, openWithSystemDefault } from "./system-open.ts";
import { mentionSuggestions } from "./mentions.ts";
import { AntigravityQuotaReader, readAntigravityQuotas, type ModelIdentity } from "./antigravity-quotas.ts";
import { PlanQuotasByProfile, reportedQuotas } from "./plan-quotas.ts";
import { turnEndReason, type TurnOutcome } from "../shared/system-notifications.ts";
import { hasBegun, sessionHasRecord, updatesTheAgentRecords } from "../shared/conversation-begun.ts";
import { antigravityErrorReplyIn, isAntigravityAuthError } from "../shared/antigravity-error.ts";
import { antigravityQuotaNoticeIn, isUsageLimitError, usageLimitMessage, usageLimitReplyIn, usageLimitResetIn, type UsageLimitWords } from "../shared/usage-limit.ts";
import { summarizeWaiting, waitingTones, type WaitingConversation, type WaitingSummary } from "../shared/waiting.ts";
import { awaitingDelivery, USER_COMMAND_EVENT_TYPES, userCommandsIn, withCommandOutputs, type UserCommand } from "../shared/user-commands.ts";
import { withCanvasNotes, type CanvasNote } from "./canvas/notes.ts";
import { NO_CANVAS_PLUGINS, type CanvasPluginGuidance } from "./canvas/guidance.ts";
import { forkPointThrough, forkTitle, shownSessionTitle, withoutForkMarks } from "../shared/forks.ts";
import { askedOutsideQuotes, conversationAsText, fileChangingModeOf, keepsModeThroughTurn, sideChatAccessIsAChoice, sideChatAccessNote, sideChatAccessOf, sideChatBrief, sideChatMayChangeFiles, sideChatModeOf } from "../shared/side-chats.ts";
import { endsTurn, joinedRunningTurn, lastAgentMessageId, pendingReverts, REVERT_EVENT_TYPES, rewindPointBefore, turnTitle, turnsFrom, whyNoRewindTo, withRevertNotes, type Revert } from "../shared/reverts.ts";
import { MODE_NAME_META_KEY } from "../shared/notices.ts";
import { returnedSteerSeqs } from "../shared/steered-messages.ts";
import { loginShell, miradorCommandEnvironment } from "./acp/environment.ts";
import {
  CANVAS_SERVER_NAME,
  harnessSpec,
  isAuthRequiredError,
  launchEnvironment,
  loginCommand,
  profileEnvironment,
  profileEnvironmentOnceRead,
  sessionMeta,
  sessionSystemPrompt,
  settingSourcesLeftOut,
  withEnvironment,
  type EnvironmentGiven,
} from "./acp/harnesses.ts";
import { NO_PROTECTIONS, protectionsKept, settingsFiles, type SettingSource } from "./acp/claude-protections.ts";
import { ALL_OF_CLAUDE_SETUP, environmentInRoom, NO_ENVIRONMENT_CHOICES, roomSetupFingerprint, type EnvironmentChoices } from "../shared/room-agent-setup.ts";
import { canvasFollowUp, canvasUseOf, isCanvasFollowUp, type TurnToolCall } from "./canvas/reply-check.ts";
import { HarnessProcess, type AgentLaunch, type ConfigValue } from "./acp/harness.ts";
import type { SessionInSandbox } from "./sandbox/agent-guidance.ts";
import { repositoryHooksOff } from "./sandbox/hooks-off.ts";
import { belongsToSandbox, NO_SANDBOXES, sandboxCanvasAddress, sandboxConfigFolder, sandboxOfConversation, type AgentInSandbox, type ConversationSandbox, type SandboxedAgents, type SandboxStartStep } from "./sandbox/sandboxes.ts";
import { SandboxNotReady } from "./sandbox/vm-launcher.ts";
import { agentVersionIn } from "./sandbox/agent-version.ts";
import { BUN_IN_VM } from "./sandbox/tools-folder.ts";
import { modelInSandbox } from "./sandbox/sandbox-control.ts";
import { NO_SANDBOX, ownerKey, type SandboxOwner } from "../shared/sandbox.ts";
import { awaitsItsInput, ToolCallReportsHeard, withReportedToolCall } from "./acp/reported-tool-call.ts";
import { canvasToolAskedFor, isPreAllowedCanvasTool } from "./canvas/permission.ts";
import { ROOM_CANVAS_TOOLS, ROOMS_WORKSPACE_CANVAS_TOOLS } from "./canvas/tool-names.ts";
import { agentLogsDirectory, type HostConfig } from "./config.ts";
import type { Hub } from "./hub.ts";
import type { DroppedFiles } from "./dropped-files.ts";
import type { ImageStore } from "./images.ts";
import { asyncTaskUpdateOf, AsyncTasks, tailTaskOutput } from "./async-tasks.ts";
import { followJobProgram, JobWaits } from "./job-waits.ts";
import type { NotifierMute } from "./notifier.ts";
import { agentEditsIn, Changes } from "./changes.ts";
import type { Landable, Landed } from "../shared/changes.ts";
import { Checkpoints, SNAPSHOTS_KEPT } from "./checkpoints.ts";
import { profileNamed, profileToLaunch } from "./profiles.ts";
import type { ProfileDraft, ProfileTestResult } from "../shared/protocol.ts";
import type { Store, UnseenTurnEnd } from "./store.ts";
import type { SystemNotifications } from "./system-notifications.ts";
import type { TerminalProgram } from "./terminals.ts";
import { claudeConfigDir } from "./terminal-sessions.ts";
import { TerminalWork, updatesAfter } from "./terminal-catch-up.ts";
import { copilotHomeOf, copilotSessionCredits } from "./copilot-credits.ts";
import { claudeTranscript, claudeTranscriptEndAt, claudeTranscriptFile, lastAnsweringModel, modelChoiceFor, recordsUserMessage, userMessageTakenInAt } from "./claude-transcript.ts";
import { claudeTranscriptPaths, messageSnippetOf, openOpencodeDatabase, opencodeDatabasePath } from "./session-transcripts.ts";
import { UserCommandRunner } from "./user-commands.ts";
import { newerPiThan } from "./pi-updates.ts";
import { commandShell, shellInvocation } from "./command-shell.ts";
import { isInWorktreesDirectory, Worktrees, workingCopyOf } from "./worktrees.ts";
import { ConversationSessions } from "./conversation-sessions.ts";
import { SubagentSessions } from "./subagent-sessions.ts";
import { SubagentUsageReader } from "./subagent-usage.ts";
import { ClaudeRequestLog } from "./claude-requests.ts";
import { IDLE_COMPACT_MIN_TOKENS, idleCompactionFrom, KEEP_WARM_PROMPT, PromptCacheKeepAlive, type KeepAliveHost } from "./prompt-cache-keep-alive.ts";
import { UnknownSessionUpdates } from "./unknown-session-updates.ts";
import { conversationCanvasToken } from "./canvas-token.ts";
import { holdsAFavourite, restsWithAllItHolds } from "../shared/deleting-together.ts";

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
/** A keep-alive goes from the conversation's requests of this long back: the hour it is kept warm, and an hour to spare. */
const RECENT_REQUESTS_FOR_KEEP_ALIVES_MS = 2 * 60 * 60_000;
/** A keep-alive is a short answer, and a compaction a longer one: either still unanswered after this long is stopped, so messages queued behind it go on. */
const KEEP_ALIVE_ANSWERED_WITHIN_MS = 2 * 60_000;
const COMPACTION_ANSWERED_WITHIN_MS = 10 * 60_000;
/** How long a Stop waits for Claude Code to record the prompt it is stopping, bounded so a wedged agent can't hang it. */
const PROMPT_RECORD_WAIT_MS = 3_000;
/** Letting go of a session is a courtesy to its agent; one that doesn't answer must not hold up what comes next. */
const SESSION_CLOSE_TIMEOUT_MS = 5_000;
const REMINDER_CHECK_MS = 30_000;
const OPTION_ANSWER_TIMEOUT_MS = 10_000;
/** On a busy machine Claude Code asks about an edit before its input has reached Mirador; past this the request shows without it. */
const EDIT_REPORT_WAIT_MS = 5_000;
const UNUSED_PICTURES_KEPT_MS = 30 * 24 * 60 * 60 * 1000;
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
/** `keepsUncommittedWork` keeps a worktree that holds uncommitted files; `keepsUnmergedBranch` false deletes its branch even with commits the workspace's branch lacks. */
export interface DeleteOptions {
  keepsUncommittedWork?: boolean;
  keepsUnmergedBranch?: boolean;
}

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
  asked: AskedPermission;
  /** When it began waiting. */
  at: number;
}

export type WaitingPermission = Pick<PendingPermission, "request" | "asked" | "at">;

/** Hears the turns of every conversation, by the seq of the message that began each. */
export interface TurnListener {
  turnStarted(conversationId: string, turnSeq: number): void;
  turnEnded(conversationId: string, turnSeq: number): void;
  /** Called on startup for conversations whose turn was not resumed after a stop or crash. */
  turnLost?(conversationId: string, cutShortByCrash: boolean): void;
  /** Called when an event is appended to a conversation, e.g. to stream room-workspace brought agent steps. */
  eventAppended?(conversationId: string, event: ConversationEvent): void;
}

/** What the rooms decide for their agents' conversations: which permission requests go through, and what an agent that lost its session hears. */
export interface RoomRules {
  /** Whether the host lets the request of a room's agent through without asking anyone. */
  allowsByItself(conversationId: string, asked: AskedPermission): boolean;
  /** A request of one of the room's agents started or stopped waiting. */
  waitingChanged(roomId: string): void;
  /** What a room's agent on a new session, which lost all it was told in the room, is sent for the turn begun at `turnSeq` with `text`. */
  reintroduced(conversationId: string, turnSeq: number, text: string): string;
}

const NO_ROOM_RULES: RoomRules = { allowsByItself: () => false, waitingChanged: () => {}, reintroduced: (_, __, text) => text };

/** What the tasks rooms of other machines give the agents you brought there say of their conversations. */
export interface BroughtTaskRules {
  /** The conversations with a task that waits for your OK, which wait for you as for a permission. */
  conversationsHoldingTasks(): ReadonlySet<string>;
  /** Whether a task queued in a conversation, by its id here, still goes to the agent once its turn comes. */
  stillToRun(taskId: string): boolean;
  /** The conversation may have let go of tasks it will not work on: each that it no longer has in hand is answered. */
  settleLost(conversationId: string): void;
}

const NO_BROUGHT_TASKS: BroughtTaskRules = { conversationsHoldingTasks: () => new Set(), stillToRun: () => false, settleLost: () => {} };

type TurnFailure = Extract<TurnOutcome, { error: string }>;

interface PromptStart {
  imageIds?: string[];
  /** The person who wrote it. */
  authorId?: string;
  fromScript?: boolean;
  fromMirador?: boolean;
  fromPlugin?: string;
  roomMessageId?: string;
  broughtTaskId?: string;
  /** A message of the user's starts a turn of its own, so the files are snapshotted and that turn can be undone. */
  startsTurn?: boolean;
}

/** Who wrote a new conversation's first message: a person, or a plugin by its title. */
type WrittenBy = Pick<PromptStart, "authorId" | "fromPlugin">;

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
  /** The task of a room of another machine it works on. */
  broughtTaskId?: string;
  /** The user stopped the turn before its prompt went out, as while the turn's files are kept. */
  stoppedBeforePrompt?: boolean;
  /** The stop found the turn waiting for its sandbox's folders, so it must not start at all. */
  stoppedWaitingForSandboxFolders?: boolean;
  /** The reply whose chunks last streamed, so the late chunks of a turn a stop cancelled can be recognised. */
  lastReplyMessageId: string | null;
  /** The turn waits on the user, so no reply of its own can still be on its way. */
  awaitedUser: boolean;
  /** The turn began with a script's message (`mirador message`, or a job wait's resume): part of a run nobody may be watching. */
  fromScript: boolean;
  /** The turn's own reply since its last tool call: whether it stopped at a step it announced, or asked in chat what ask should have. */
  reply: string;
  /** The text of the turn's last message on its own, which is, or with Antigravity ends in, the agent program's words when a usage limit ended the turn as if it ended by itself. */
  lastMessage: string;
  /** The turn's last non-empty text chunk, which with Antigravity holds "\n⚠ …\n" when a model error ended the turn as if it ended by itself. */
  lastChunk: string;
  /** The turn's own tool calls, to tell whether a page it showed was its last step. */
  toolCalls: TurnToolCall[];
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
const isTurnsOwnToolCall = (update: acp.SessionUpdate): update is Extract<acp.SessionUpdate, { sessionUpdate: "tool_call" }> =>
  update.sessionUpdate === "tool_call" && !isSubagentReport(update);

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
  /** What the room or workspace gave its agents as the session was begun to be opened, which it runs under. */
  openedUnder?: string | null;
  /** A session Continue found held by Codex's daemon: the next message tries to continue it again, once the user has freed it, so its history replays ahead of that message. */
  heldCodexSession?: string;
  /** What a side chat's brief hands over to its agent, until the first question takes the brief along; null where its session holds the conversation. */
  sideChatHandover?: { conversation: string | null };
  /** What a side chat was switched to since its agent last heard what it may do. */
  sideChatAccessToTell?: SideChatAccess;
  /** A room's agent on a new session after an earlier one, which lost all it was told in the room: its next prompt tells it again. */
  roomContextLost?: boolean;
  /** The latest permission request still reading the files it would edit; the next one shows after it. */
  permissionArriving?: Promise<unknown>;
  queuedMessages: QueuedMessage[];
  /** The latest steer still on its way to the agent; the next one goes after it, so messages join the turn in the order they were sent. */
  steering?: Promise<void>;
  /** Messages taken out of the queue to join the turn, until the agent says whether it took them: a turn ending meanwhile must not send what was queued behind them. */
  steerInFlight?: boolean;
  openToolCalls: OpenToolCalls;
  toolCallReportsHeard: ToolCallReportsHeard;
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
  /** A prompt of Mirador's own between the user's turns, a keep-alive or an idle compaction, until it is answered; `shown` lets its updates show. */
  outsideTurn?: { shown: boolean; settled: Promise<void> };
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

/** A change to the folders of a sandbox whose VM runs without it, waiting for no turn to run there to start the VM again. */
interface FolderChange {
  owner: SandboxOwner;
  /** The turns held at their start meanwhile, by conversation, each with what lets it go on as it is stopped. */
  held: Map<string, () => void>;
  taken: Promise<void>;
  take: () => void;
  restarting: boolean;
}

/**
 * What of an agent's session/load is the session's state rather than its history: the history is in the transcript
 * already, and the mode it reports comes back with the session's configuration.
 */
const SESSION_STATE_UPDATES = new Set<acp.SessionUpdate["sessionUpdate"]>(["available_commands_update", "config_option_update", "session_info_update", "usage_update"]);

/** Antigravity sends the whole history again on session/resume, as on session/load, so its sessions reopen by a load whose replay is left out. */
const replaysHistoryOnResume = (harness: HarnessId) => harness === "antigravity";

/**
 * Claude Code reads the files named with an @ in the last block of a prompt, wherever they lie, into it without asking:
 * seen in 2.1.330, documented nowhere, and held to by e2e/room-file-mentions.spec.ts.
 */
const readsFilesNamedInLastBlock = (harness: HarnessId) => harness === "claude";

/**
 * Agents that read their settings, MCP servers among them, anew for each session they open, so a /reload reopens only the
 * conversation's session. opencode reads them once per process, so a /reload starts that again, as it does Antigravity's,
 * which serves only its own conversation.
 */
const readsSettingsPerSession = (harness: HarnessId) => harness === "claude" || harness === "pi" || harness === "codex" || harness === "copilot";

/** The mode a sandboxed Claude Code agent works in without asking, which it has only where it does not run as root. */
const WORKS_FREELY_MODE = "bypassPermissions";

/**
 * What of a session's choices carries into one that replaces it under another setup: never its mode, which a sandbox may
 * have set to ask for nothing, and which on this computer would let the agent do anything.
 */
const choicesBesideMode = (options: acp.SessionConfigOption[]) => options.filter(({ category }) => category !== "mode");

/** Marks a sandboxed workspace conversation's process apart from one of its own on this computer, so neither is ever taken for the other. */
const SANDBOXED_KEY_SUFFIX = "sandboxed";

/**
 * What picks the agent process a conversation runs on: its launch, and, for a conversation that exists, its id, its
 * workspace and the room it works for.
 */
export type ProcessLaunch = Launch & { id?: string; workspaceId?: string } & Pick<Conversation, "roomId" | "broughtIntoRoom" | "worksInRoomsWorkspace" | "outsideSandbox">;

/** An agent you brought that works in the workspace of its room: of this computer it has nothing. */
const HELD_TO_A_ROOMS_WORKSPACE = { broughtIntoRoom: true, worksInRoomsWorkspace: true } as const;

/**
 * The agent process serving a conversation. Antigravity keeps one canvas MCP server per process, the one its first
 * session registered, so every conversation on one profile would reach that first conversation's canvas; it takes a
 * process of its own. So does a conversation that works for a room, on every agent: opencode keeps one canvas server per
 * folder, and a room's agent shares no process, canvas server or environment with the owner's conversations or another
 * room's. A conversation of a sandboxed workspace takes one of its own too, which starts in the workspace's sandbox or
 * not at all. The others share one per profile.
 */
export function agentProcessKey(profile: Pick<Profile, "id" | "harness">, launch: ProcessLaunch, inSandboxedWorkspace: boolean) {
  if (!launch.id) return profile.id;
  if (inSandboxedWorkspace) return `${profile.id}/${launch.id}/${SANDBOXED_KEY_SUFFIX}`;
  return profile.harness === "antigravity" || worksForARoom(launch) ? `${profile.id}/${launch.id}` : profile.id;
}

export class ConversationService {
  private readonly runtimes = new Map<string, Runtime>();
  /** Agent processes by `agentProcessKey`: one per profile, except those of Antigravity's, rooms' and sandboxed workspaces' conversations, which each get their own. */
  private readonly agentProcesses = new Map<string, HarnessProcess>();
  /** Room and sandboxed workspace conversations' agent processes, each stopped once it has sat idle for `roomAgentIdleMs` since its last turn ended. */
  private readonly idleOwnProcesses = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly sessions = new ConversationSessions();
  private readonly subagentSessions = new SubagentSessions();
  /** Sessions whose agent left an option change unanswered for too long, so their next changes don't wait. */
  private readonly sessionsSlowToAnswer = new Set<string>();
  private readonly startChoicesTimeoutMs = START_CHOICES_TIMEOUT_MS;
  private readonly updatesForUnknownSessions = new UnknownSessionUpdates();
  /** What each profile's agent last said it offers, and the probe asking one now. */
  private readonly profileChoicesCache = new Map<string, { at: number; model: string | null; options: acp.SessionConfigOption[] }>();
  private readonly profileChoiceProbes = new Map<string, { model: string | null; probe: Promise<acp.SessionConfigOption[] | null> }>();
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
  /** What each agent process starting in its sandbox waits for now: its sandbox set up, or its VM started. */
  private readonly sandboxStartSteps = new Map<HarnessProcess, SandboxStartStep>();
  /** The conversations whose sessions wait for each agent process to start. */
  private readonly waitingForProcess = new Map<HarnessProcess, Set<string>>();
  /** Each workspace's last save of where its new conversations work, which checks the repository first; settled, failed or not. */
  private readonly worktreeSettingsSaved = new Map<string, Promise<unknown>>();
  private readonly planQuotas = new PlanQuotasByProfile();
  private readonly antigravityQuotas = new AntigravityQuotaReader((profileId, groups, conversationIds) => {
    if (this.planQuotas.recordGroups(profileId, groups, Date.now())) {
      conversationIds.forEach((conversationId) => this.republish(conversationId));
    }
  });
  private readonly unseenTurnEnds: Map<string, UnseenTurnEnd>;
  private readonly lastWords = new Map<string, string>();
  private readonly asksWaitedOn: Map<string, PendingAsk>;
  private readonly commands = new UserCommandRunner();
  private readonly subagentUsageReader = new SubagentUsageReader();
  private readonly claudeRequestLog = new ClaudeRequestLog();
  private readonly promptCacheKeepAlive: PromptCacheKeepAlive;
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
  private withdrawQuestions: (conversationId: string) => void = () => {};
  private hearReply: HearReply = () => {};
  private pluginTellsItsCaller: (plugin: string) => boolean = () => false;
  private hearActivity: (conversationId: string, activity: PluginActivity) => void = () => {};
  private turnsHeard: TurnListener = { turnStarted: () => {}, turnEnded: () => {} };
  private broughtTasks = NO_BROUGHT_TASKS;
  private roomRules = NO_ROOM_RULES;
  private sandboxes: SandboxedAgents = NO_SANDBOXES;
  /** The agent processes that run in their room's or workspace's sandbox, each by the start that put it there. */
  private readonly sandboxStarts = new WeakMap<HarnessProcess, object>();
  /** Changes to the folders of sandboxes, by `ownerKey`, until their VM starts again with them. */
  private readonly folderChanges = new Map<string, FolderChange>();
  /** The room agents' and sandboxed workspaces' own processes that started on this computer, as they had no sandbox then. */
  private readonly startedOnThisComputer = new WeakSet<HarnessProcess>();
  private hearWorktreeRemoval: (folderId: string) => void = () => {};
  private deletesWithAllItHolds: (conversationId: string, options: DeleteOptions) => void = (conversationId, options) => this.delete(conversationId, options);
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
    const waitingAsksNewestLast = store.listCanvasItemsWithStatus("waiting").filter((item) => item.kind === "ask").sort((a, b) => a.createdAt - b.createdAt);
    this.asksWaitedOn = new Map(waitingAsksNewestLast.map((item) => [item.conversationId, pendingAsk(item)]));
    this.jobWaits = new JobWaits(store, {
      changed: (conversationId) => this.republish(conversationId),
      ended: (conversationId, wait, end) => this.jobWaitEnded(conversationId, wait, end),
    });
    this.promptCacheKeepAlive = new PromptCacheKeepAlive(this.keepAliveHost(), config.keepWarmEveryMs, config.keepWarmForMs);
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

  /** Whether the conversation's agent is in a turn now. */
  isAtWork(conversationId: string) {
    return this.runtimes.get(conversationId)?.running === true;
  }

  get(conversationId: string): Conversation {
    const conversation = this.store.findConversation(conversationId);
    if (!conversation) throw new HostProblemError({ code: "no-such-conversation", id: conversationId });
    return this.withRuntimeStatus(conversation);
  }

  planQuotasOf(conversationId: string, now: number) {
    const conversation = this.get(conversationId);
    if (conversation.harness === "antigravity") this.refreshAntigravityQuotas(conversationId, false, now);
    return this.planQuotasOfProfile(conversation.profileId, now, chosenModel(conversation.configOptions));
  }

  planQuotasOfProfile(profileId: string | null, now: number, model?: ModelIdentity | null) {
    return this.planQuotas.of(profileId, now, model);
  }

  slashCommands(conversationId: string) {
    return this.store.latestAvailableCommands(this.get(conversationId)).map(toSlashCommand);
  }

  agentHasCommand(conversationId: string, name: string) {
    return this.store.latestAvailableCommands(this.get(conversationId)).some((command) => command.name === name);
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

  /** The model requests the main thread of a conversation made from `since` on, from Claude Code's transcript of it; none for other agents. */
  async modelRequestsOf(conversationId: string, since: number): Promise<ModelRequestSample[]> {
    const conversation = this.store.findConversation(conversationId);
    if (conversation?.harness !== "claude" || !conversation.acpSessionId) return [];
    const requests = await this.claudeRequestLog.requestsOf(this.claudeConfigDirOf(conversation), conversation.acpSessionId, since);
    return requests.map((request) => ({ conversationId, ...request }));
  }

  /** The keep-alives that kept the conversation's prompt cache warm since the user's last turn; null where none went. */
  keptWarmOf(conversationId: string): KeptWarm | null {
    return this.promptCacheKeepAlive.keptWarm(conversationId);
  }

  private keepAliveHost(): KeepAliveHost {
    return {
      recentRequestsOf: (conversationId) => this.modelRequestsOf(conversationId, Date.now() - RECENT_REQUESTS_FOR_KEEP_ALIVES_MS),
      mayKeepWarm: (conversationId) => this.mayKeepCacheWarmNow(conversationId),
      sendKeepAlive: async (conversationId) => (await this.promptOutsideTurns(conversationId, KEEP_WARM_PROMPT, { shown: false })) === "end_turn",
      compactsAt: (conversationId, contextTokens) => this.compactsIdleAt(conversationId, contextTokens),
      compact: async (conversationId) => void (await this.promptOutsideTurns(conversationId, `/${COMPACT_COMMAND}`, { shown: true })),
      keptWarmChanged: (conversationId) => this.republish(conversationId),
    };
  }

  /** Claude Code's own conversations on a profile that keeps the prompt cache warm, but not a room's agents' or side chats, which the user isn't away from. */
  private keepsCacheWarm(conversationId: string) {
    const conversation = this.store.findConversation(conversationId);
    const profile = conversation?.profileId == null ? undefined : this.store.findProfile(conversation.profileId);
    return conversation?.harness === "claude" && profile?.keepCacheWarm === true && !worksForARoom(conversation) && conversation.sideChatOf === undefined;
  }

  /** Idle on the session already open, with nothing on its way in or waiting on the user. */
  private mayKeepCacheWarmNow(conversationId: string) {
    const runtime = this.runtimes.get(conversationId);
    if (this.stopping || !runtime?.harness || !runtime.sessionId || !this.keepsCacheWarm(conversationId)) return false;
    const busy = runtime.running || runtime.outsideTurn || this.holdsQueue(runtime) || runtime.queuedMessages.length > 0 || runtime.pendingPermissions.size > 0;
    return !busy && this.asyncTasks.in(conversationId).length === 0;
  }

  /** Where Claude Code's own idle compaction would compact it, as the profile and CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS ask. */
  private compactsIdleAt(conversationId: string, contextTokens: number) {
    const { profileId } = this.get(conversationId);
    const profile = profileId === null ? undefined : this.store.findProfile(profileId);
    const minTokensSetting = parseEnvironment(profile?.environment ?? "").set[IDLE_COMPACT_MIN_TOKENS] ?? process.env[IDLE_COMPACT_MIN_TOKENS];
    return profile?.idleCompaction !== false && this.agentHasCommand(conversationId, COMPACT_COMMAND) && contextTokens >= idleCompactionFrom(minTokensSetting);
  }

  /**
   * Sends Claude Code a prompt of Mirador's own between the user's turns: a keep-alive, or an idle compaction. No
   * message, turn end or notification shows for it, and messages sent meanwhile wait for it to be answered; only a
   * compaction's own updates show. It goes on the session already open, never opening one, and asks the user nothing,
   * as what it asks permission for is turned down. One not answered in a while is stopped, so the queue goes on.
   * Settles with how it ended, null where it failed.
   */
  private async promptOutsideTurns(conversationId: string, text: string, { shown }: { shown: boolean }): Promise<acp.StopReason | null> {
    const runtime = this.runtime(conversationId);
    const { harness, sessionId } = runtime;
    if (!harness || !sessionId || runtime.outsideTurn) return null;
    let settle = () => {};
    runtime.outsideTurn = { shown, settled: new Promise<void>((resolve) => (settle = resolve)) };
    let stopUnanswered: ReturnType<typeof setTimeout> | undefined;
    try {
      const openSession = await sessionId;
      const answeredWithin = shown ? COMPACTION_ANSWERED_WITHIN_MS : KEEP_ALIVE_ANSWERED_WITHIN_MS;
      stopUnanswered = setTimeout(() => void harness.cancel(openSession).catch(() => {}), answeredWithin);
      const { stopReason } = await harness.prompt(openSession, [{ type: "text", text }]);
      return stopReason;
    } catch (error) {
      console.error(`Mirador's own prompt to conversation ${conversationId} failed: ${errorMessage(error)}`);
      return null;
    } finally {
      clearTimeout(stopUnanswered);
      runtime.outsideTurn = undefined;
      settle();
      this.sendQueueAfterPromptsThatWaited(conversationId);
      this.stopOwnProcessOnceIdle(conversationId);
    }
  }

  /**
   * Without a launch, on the workspace's default as the host has it, which a browser may not have heard of yet; with a
   * prompt, working on it at once; with a title that isn't blank, named as if by the user, so neither its first message
   * nor its agent renames it; with `choices`, on that model and effort from its first message on; with a `worktree`,
   * working there rather than in the workspace's folder; `writtenBy` a person or a plugin, its first message shown as theirs.
   */
  create(
    workspaceId: string,
    launch: Launch = this.existingWorkspace(workspaceId).defaultLaunch,
    prompt?: string,
    title?: string,
    choices: ConversationChoices = {},
    worktree?: ConversationWorktree,
    writtenBy: WrittenBy = {},
  ): Conversation {
    const givenTitle = titleFrom(title ?? "");
    const conversation = this.insertConversation(workspaceId, launch, givenTitle || UNTITLED, givenTitle !== "", worktree);
    if (choices.model || choices.effort) this.runtime(conversation.id).startChoices = choices;
    const opened = this.ensureSession(conversation.id);
    if (prompt?.trim()) {
      const startTurn = () => this.prompt(conversation.id, prompt, { startsTurn: true, ...writtenBy });
      if (worktree) opened.then(startTurn).catch(() => {});
      else {
        opened.catch(() => {});
        startTurn().catch(() => {});
      }
    } else opened.catch(() => {});
    return conversation;
  }

  /** Like `create`, where the workspace starts its conversations unless `startsIn` names the other place. */
  async start(workspaceId: string, launch?: Launch, prompt?: string, startsIn?: ConversationPlace, authorId?: string): Promise<Conversation> {
    const worktree = await this.worktreeOfNewConversation(workspaceId, startsIn);
    return this.create(workspaceId, launch, prompt, undefined, {}, worktree, { authorId });
  }

  /** A new conversation's own worktree, where the workspace, its settings saved, starts it in one, or `startsIn` says so. */
  private async worktreeOfNewConversation(workspaceId: string, startsIn?: ConversationPlace) {
    await this.worktreeSettingsSaved.get(workspaceId);
    const workspace = this.existingWorkspace(workspaceId);
    return placeOfNewConversation(workspace, startsIn) === "worktree" ? await this.worktrees.plan(workspace) : undefined;
  }

  /**
   * Where the workspace's new conversations work, and the command that sets each new worktree up. Saves go one after
   * another, so the last one asked for stays, and a conversation started meanwhile starts where it says.
   */
  setWorktreeSettings(workspaceId: string, newConversationsIn: ConversationPlace, worktreeSetup: string) {
    const previous = this.worktreeSettingsSaved.get(workspaceId) ?? Promise.resolve();
    const saved = previous.then(() => this.saveWorktreeSettings(workspaceId, newConversationsIn, worktreeSetup));
    this.worktreeSettingsSaved.set(workspaceId, saved.catch(() => {}));
    return saved;
  }

  private async saveWorktreeSettings(workspaceId: string, newConversationsIn: ConversationPlace, worktreeSetup: string) {
    const workspace = this.existingWorkspace(workspaceId);
    if (!isConversationPlace(newConversationsIn)) return;
    if (newConversationsIn === "worktree") await this.worktrees.mustHold(workspace);
    this.store.setWorktreeSettings(workspaceId, newConversationsIn, worktreeSetup.trim());
    this.hub.broadcast({ type: "workspace.upserted", workspace: this.existingWorkspace(workspaceId) });
  }

  /** What the workspace's new side chats may do; null for what Settings say. Side chats already open stay as they started. */
  setSideChatAccess(workspaceId: string, sideChatAccess: SideChatAccess | null) {
    this.existingWorkspace(workspaceId);
    if (sideChatAccess !== null && !isSideChatAccess(sideChatAccess)) throw new HostProblemError({ code: "unknown-side-chat-access", value: String(sideChatAccess) });
    this.store.setWorkspaceSideChatAccess(workspaceId, sideChatAccess);
    this.hub.broadcast({ type: "workspace.upserted", workspace: this.existingWorkspace(workspaceId) });
  }

  /**
   * For a plugin's tool: a conversation beside the caller's, on another profile, working on `prompt` at once, in the
   * caller's worktree if it has one. It works for the caller, which hears through the plugin how its work ended. A
   * `title` names it for good, and `choices` set its model and effort, as `create` does.
   */
  startBeside(callerId: string, plugin: string, profileName: string, prompt: string, title?: string, choices?: ConversationChoices): StartedConversation {
    const caller = this.callerThatMayStart(callerId);
    const conversation = this.createFor(caller, plugin, profileNamed(this.store, profileName), title, choices, caller.worktree);
    this.prompt(conversation.id, prompt, { startsTurn: true }).catch(() => {});
    return this.startedOf(conversation);
  }

  /**
   * Like `startBeside`, in a new git worktree of its own, on a new branch from what the workspace has checked out, or
   * from the commit `from` names when given. Its first message waits until the worktree is made; one that can't be
   * made ends its work as failed, and one its plugin stopped meanwhile as stopped.
   */
  async startInOwnWorktree(callerId: string, plugin: string, profileName: string, prompt: string, title?: string, choices?: ConversationChoices, from?: string): Promise<StartedConversation> {
    const caller = this.callerThatMayStart(callerId);
    const profile = profileNamed(this.store, profileName);
    const workspace = this.existingWorkspace(caller.workspaceId);
    if (workspace.sandbox.on) throw new Error("This workspace runs its agents in a sandbox, which sees only the workspace's folder and no worktree: start the conversation beside you instead.");
    const worktree = await this.worktrees.plan(workspace, { from });
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
    if (caller.sideChatOf) throw new Error("This is a side chat, which only answers questions, so it can't start another conversation.");
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
   * its conversations, on the profile with that id, working on `prompt` at once, its first message shown as the plugin's.
   * It works for nobody, so it stands in the sidebar as any other and tells the user when its turns end.
   */
  async startForPlugin(workspaceId: string, pluginTitle: string, { profileId, prompt, title, model, effort }: WorkspaceConversationStart): Promise<StartedConversation> {
    const profile = this.profileWithId(profileId);
    const worktree = await this.worktreeOfNewConversation(workspaceId);
    return this.startedOf(this.create(workspaceId, { harness: profile.harness, profileId: profile.id }, prompt, title, { model, effort }, worktree, { fromPlugin: pluginTitle }));
  }

  private profileWithId(profileId: string) {
    const profile = this.store.findProfile(profileId);
    if (!profile) throw new Error(`No profile has the id ${profileId}: it may have been deleted.`);
    return profile;
  }

  /**
   * For a plugin's tool or action: stops the turn of a conversation it started from the caller's, as the user's Stop does,
   * so the plugin's `replied` hears it end as "stopped", and no job it left running wakes it any more; one still waiting
   * for its worktree ends so once that is made, without starting. One that no longer exists, or whose work already ended,
   * is let be; one this plugin didn't start from that conversation throws.
   */
  async stopStarted(callerId: string, plugin: string, conversationId: string): Promise<void> {
    const conversation = this.store.findConversation(conversationId);
    if (!conversation) return;
    const startedBy = conversation.startedBy;
    if (!this.startedFromCallerBy(startedBy, callerId, plugin)) {
      throw new Error(`Conversation ${conversationId} wasn't started by the ${plugin} plugin from this conversation, so it can't be stopped here.`);
    }
    const runtime = this.runtime(conversationId);
    if (runtime.running) {
      this.stopJobsWakingIt(conversationId);
      return this.cancel(conversationId);
    }
    if (this.resumedByAJob(conversationId)) {
      this.deliverOwedReply(conversationId, "stopped");
      this.stopJobsWakingIt(conversationId);
    } else if (!startedBy.reply) runtime.stoppedBeforeItsFirstTurn = true;
  }

  /**
   * For a plugin's tool or action: deletes a conversation it started from the caller's, as the user's delete does, its
   * worktree going once no other conversation works there, uncommitted work and all, with its branch even when that
   * holds commits the workspace's branch lacks. One that no longer exists is let be; one this plugin didn't start from
   * that conversation throws.
   */
  async deleteStarted(callerId: string, plugin: string, conversationId: string): Promise<void> {
    const conversation = this.store.findConversation(conversationId);
    if (!conversation) return;
    if (!this.startedFromCallerBy(conversation.startedBy, callerId, plugin)) {
      throw new Error(`Conversation ${conversationId} wasn't started by the ${plugin} plugin from this conversation, so it can't be deleted from here.`);
    }
    this.deletesWithAllItHolds(conversationId, { keepsUnmergedBranch: false });
  }

  /**
   * For a plugin's tool or action: sends a conversation it started from the caller's a message, shown as the plugin's,
   * which starts its next turn or waits for the turn it is in to end. One that no longer exists, or that this plugin
   * didn't start from that conversation, throws.
   */
  async promptStarted(callerId: string, plugin: string, pluginTitle: string, conversationId: string, text: string): Promise<void> {
    const conversation = this.store.findConversation(conversationId);
    if (!conversation) throw new Error(`There is no conversation ${conversationId}.`);
    if (!this.startedFromCallerBy(conversation.startedBy, callerId, plugin)) {
      throw new Error(`Conversation ${conversationId} wasn't started by the ${plugin} plugin from this conversation, so it can't be messaged from here.`);
    }
    await this.send(conversationId, text, [], { afterTurn: true, fromPlugin: pluginTitle });
  }

  /**
   * For a plugin's tool or action: the tokens and cost of a conversation it started from the caller's, so far. One that
   * no longer exists, or that this plugin didn't start from that conversation, throws.
   */
  usageOf(callerId: string, plugin: string, conversationId: string): ConversationUsage {
    const conversation = this.store.findConversation(conversationId);
    if (!conversation) throw new Error(`There is no conversation ${conversationId}.`);
    if (!this.startedFromCallerBy(conversation.startedBy, callerId, plugin)) {
      throw new Error(`Conversation ${conversationId} wasn't started by the ${plugin} plugin from this conversation, so its usage can't be read from here.`);
    }
    const tokens = this.store.listEventsFrom(conversationId, 0).flatMap(({ event }) => (endsTurnWithSpend(event) && event.usage ? [event.usage] : []));
    const sum = (key: keyof TurnUsage) => tokens.reduce((total, usage) => total + usage[key], 0);
    return {
      inputTokens: sum("inputTokens"),
      outputTokens: sum("outputTokens"),
      cachedReadTokens: sum("cachedReadTokens"),
      cachedWriteTokens: sum("cachedWriteTokens"),
      cost: this.contextUsage.get(conversationId)?.cost ?? null,
      turns: tokens.length,
    };
  }

  /** Whether this plugin's tool or action started the conversation from the caller's. */
  private startedFromCallerBy(startedBy: StartedBy | undefined, callerId: string, plugin: string): startedBy is StartedBy {
    return startedBy?.conversationId === callerId && startedBy.plugin === plugin;
  }

  /** Mirador stops waiting for the jobs that would wake its agent, as the user stopping each wait does. */
  private stopJobsWakingIt(conversationId: string) {
    this.jobWaits
      .in(conversationId)
      .filter(({ resume }) => resume)
      .forEach(({ id }) => this.stopWaitingForJob(conversationId, id));
  }

  /** A job it left running will wake its agent, so the turn that ended isn't the end of its work. */
  private resumedByAJob(conversationId: string) {
    return this.jobWaits.in(conversationId).some(({ resume }) => resume);
  }

  /** The plugin whose tool or action started a conversation hears how its work ended; `tellsItsCaller` says whether it passes that on. */
  hearRepliesWith(hearReply: HearReply, tellsItsCaller: (plugin: string) => boolean) {
    this.hearReply = hearReply;
    this.pluginTellsItsCaller = tellsItsCaller;
  }

  /** Hears each turn as it starts, and as it ends while the host runs on, by the seq of the message that began it. */
  hearTurnsWith(listener: TurnListener) {
    this.turnsHeard = listener;
  }

  /** A conversation holding a task from a room of another machine until you let it through waits for you as for a permission, and a queued task no longer to run is left out. */
  followsBroughtTasksOf(rules: BroughtTaskRules) {
    this.broughtTasks = rules;
  }

  /** Takes the tasks, by their ids here, out of the conversation's queue: the room that sent them no longer waits for them. */
  dropQueuedBroughtTasks(conversationId: string, taskIds: string[]) {
    if (!this.store.hasConversation(conversationId)) return;
    const runtime = this.runtime(conversationId);
    const dropped = new Set(taskIds);
    const kept = runtime.queuedMessages.filter(({ broughtTaskId }) => broughtTaskId === undefined || !dropped.has(broughtTaskId));
    if (kept.length === runtime.queuedMessages.length) return;
    this.setQueue(conversationId, runtime, kept);
    this.publish(this.get(conversationId));
  }

  /** The tasks of rooms of other machines, by their ids here, that wait in the conversation's queue or that its running turn works on. */
  broughtTasksInHand(conversationId: string): string[] {
    const runtime = this.runtimes.get(conversationId);
    const queued = runtime?.queuedMessages ?? this.store.findConversation(conversationId)?.queuedMessages ?? [];
    const running = runtime?.running ? runtime.turn?.broughtTaskId : undefined;
    return [running, ...queued.map(({ broughtTaskId }) => broughtTaskId)].filter((taskId) => taskId !== undefined);
  }

  heldTasksChanged(conversationId: string) {
    this.republish(conversationId);
  }

  /**
   * A room's agent asks its room's rules first, the room hears whenever one of its agents' requests starts or stops
   * waiting, and an agent on a new session after an earlier one is told of the room again.
   */
  followsRoomRulesOf(rules: RoomRules) {
    this.roomRules = rules;
  }

  /** Where the agents of sandboxed rooms start. */
  startsSandboxedAgentsIn(sandboxes: SandboxedAgents) {
    this.sandboxes = sandboxes;
  }

  /** Plugins hear what happens in every conversation: the user's messages, turns and tool calls. */
  hearActivityWith(hearActivity: (conversationId: string, activity: PluginActivity) => void) {
    this.hearActivity = hearActivity;
  }

  /** The host's own delete, which also closes the conversation's terminals, documents, questions and side chats, for a plugin's delete to go through. */
  deletesWithAllItHoldsBy(deleteWithAllItHolds: (conversationId: string, options: DeleteOptions) => void) {
    this.deletesWithAllItHolds = deleteWithAllItHolds;
  }

  /** Deletes the conversation as the user's delete does, its terminals, documents, questions and side chats with it. */
  deleteWithAllItHolds(conversationId: string) {
    this.deletesWithAllItHolds(conversationId, {});
  }

  /** What keeps documents in a worktree hears that its folder is gone, so nothing is left open or stored for it. */
  hearWorktreeRemovalsWith(hearWorktreeRemoval: (folderId: string) => void) {
    this.hearWorktreeRemoval = hearWorktreeRemoval;
  }

  /** The user takes a started conversation off its caller's list of delegated tasks, and with it off the sidebar, so its mark and open questions go too. */
  dismissDelegation(conversationId: string) {
    if (this.store.dismissDelegation(conversationId)) this.stopWaitingForUser(conversationId);
    this.republish(conversationId);
  }

  /** The user dismisses finished delegated tasks of this caller; with `plugin`, only that plugin's. */
  clearFinishedDelegations(callerId: string, plugin?: string) {
    for (const id of this.store.dismissFinishedDelegations(callerId, plugin)) {
      this.stopWaitingForUser(id);
      this.republish(id);
    }
  }

  private stopWaitingForUser(conversationId: string) {
    this.forgetUnseenTurnEnd(conversationId);
    this.withdrawQuestions(conversationId);
  }

  /**
   * Once, when the work of a conversation a plugin's tool or action started ends. The reply is kept before the plugin hears it, so
   * a crash in between can't tell it twice; a caller deleted since hears nothing. What it ran on is read as it ended.
   * A turn that ends waiting for a job that will wake the agent isn't that end: the turn after the wake-up is.
   */
  private deliverOwedReply(conversationId: string, endedAs?: ConversationReply["ended"]) {
    const conversation = this.store.findConversation(conversationId);
    const startedBy = conversation?.startedBy;
    if (!conversation || !startedBy || startedBy.reply) return;
    if (!endedAs && this.resumedByAJob(conversationId)) return;
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

  /** The newest sessions the harness knows for the workspace or its worktrees, including ones started outside the app. */
  async listSessionsInWorkspace(workspaceId: string, launch: Launch): Promise<ExternalSession[]> {
    const { sessions } = await this.harnessSessions(workspaceId, launch, { limit: LISTED_SESSIONS });
    return sessions;
  }

  /** Sessions in the workspace or its worktrees whose title or messages hold what the user is looking for, newest first; a search the user has moved on from stops. */
  async searchSessionsInWorkspace(workspaceId: string, launch: Launch, query: string, outdated?: AbortSignal): Promise<SessionSearchHit[]> {
    const lowerQuery = query.trim().toLowerCase();
    if (lowerQuery.length < MIN_SEARCH_LENGTH) return [];
    const { profile, sessions } = await this.harnessSessions(workspaceId, launch, { outdated });
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
        if (titleMatch || match !== null) hits.push({ ...session, match });
        if (hits.length >= SEARCHED_SESSIONS) break;
      }
      return hits;
    } finally {
      database?.close();
    }
  }

  /**
   * The harness's sessions for the workspace directory and its worktrees (including ones already removed), newest first,
   * with the app's conversation on each. A session a conversation of another workspace holds is that workspace's, though
   * both may name one folder under two spellings, and one an agent works on a room's tasks in is the room's.
   */
  private async harnessSessions(workspaceId: string, launch: Launch, { limit, outdated }: { limit?: number; outdated?: AbortSignal } = {}) {
    this.refuseSessionsFromThisComputerIn(workspaceId);
    const workspace = this.existingWorkspace(workspaceId);
    const [directory, worktreesDir] = await Promise.all([recordedDirectory(workspace), this.worktrees.directoryOf(workspace)]);
    const profile = profileToLaunch(this.store, launch);
    const harness = this.harnessFor(launch);
    const capabilities = await harness.start();
    if (!capabilities.agentCapabilities?.sessionCapabilities?.list) throw new HostProblemError({ code: "agent-cannot-list-sessions", agent: harness.spec.label });
    const conversations = this.store.listConversations();
    const conversationIdBySession = new Map(conversations.map(({ acpSessionId, id }) => [acpSessionId, id]));
    const heldElsewhere = new Set(conversations.filter((conversation) => conversation.workspaceId !== workspaceId || conversation.roomId).map(({ acpSessionId }) => acpSessionId));
    const sessions: ExternalSession[] = [];
    const seenSessions = new Set<string>();
    const seenCursors = new Set<string>();
    let cursor: string | undefined;
    while (true) {
      outdated?.throwIfAborted();
      const page = await harness.listSessions(undefined, cursor);
      for (const session of page.sessions) {
        if (seenSessions.has(session.sessionId) || heldElsewhere.has(session.sessionId)) continue;
        const inWorktree = isInWorktreesDirectory(session.cwd, worktreesDir);
        if (session.cwd !== directory && !inWorktree) continue;
        seenSessions.add(session.sessionId);
        sessions.push(externalSession(session, conversationIdBySession, inWorktree));
        if (limit !== undefined && sessions.length >= limit) return { profile, sessions };
      }
      if (!page.nextCursor || seenCursors.has(page.nextCursor)) break;
      seenCursors.add(page.nextCursor);
      cursor = page.nextCursor;
    }
    return { profile, sessions };
  }

  /**
   * Continues (or forks) a session started elsewhere, e.g. in a terminal or a deleted worktree, replaying its history
   * into the conversation. A session that ran in a worktree gets a fresh worktree of its own; one from the project
   * folder stays there. A sandboxed workspace's agents keep their sessions in its sandbox, which holds none from this
   * computer.
   */
  async adopt(workspaceId: string, launch: Launch, session: Pick<ExternalSession, "sessionId" | "title" | "inWorktree">, mode: AdoptMode): Promise<Conversation> {
    this.refuseSessionsFromThisComputerIn(workspaceId);
    if (mode === "continue" && this.store.listConversations().some(({ acpSessionId }) => acpSessionId === session.sessionId)) {
      throw new HostProblemError({ code: "session-already-open" });
    }
    const worktree = session.inWorktree ? await this.worktrees.plan(this.existingWorkspace(workspaceId)) : undefined;
    return this.adoptSession(workspaceId, launch, session, mode, null, worktree);
  }

  private refuseSessionsFromThisComputerIn(workspaceId: string) {
    if (this.existingWorkspace(workspaceId).sandbox.on) throw new HostProblemError({ code: "sandboxed-workspace-outside-session" });
  }

  private adoptSession(
    workspaceId: string,
    launch: Launch,
    session: Pick<ExternalSession, "sessionId" | "title"> & { titleSetByUser?: boolean },
    mode: AdoptMode,
    forkPoint: SessionForkPoint | null = null,
    worktree?: ConversationWorktree,
    heldTo: Pick<Conversation, "broughtIntoRoom" | "worksInRoomsWorkspace" | "outsideSandbox"> = {},
  ): Conversation {
    if (mode === "continue" && this.store.listConversations().some(({ acpSessionId }) => acpSessionId === session.sessionId)) {
      throw new HostProblemError({ code: "session-already-open" });
    }
    const title = session.title || UNTITLED;
    const conversation = this.insertConversation(workspaceId, launch, mode === "fork" ? forkTitle(title) : withoutForkMarks(title), session.titleSetByUser, worktree, undefined, heldTo);
    this.ensureSession(conversation.id, () => this.loadExternalSession(conversation.id, session.sessionId, mode, forkPoint)).catch(() => {});
    return conversation;
  }

  /**
   * Copies the agent's session into a new conversation on the same profile: as it stands, or through the turn begun
   * with the message at `throughTurnSeq`, its reply included. A turn running in it goes on undisturbed. A title the
   * user or a plugin gave it stays theirs in the fork, safe from the agent's renaming. The fork works where the
   * conversation does, as the agent keeps a session by its folder, with no more of this computer than it has.
   */
  fork(conversationId: string, throughTurnSeq?: number): Conversation {
    const source = this.get(conversationId);
    const { workspaceId, harness, profileId, acpSessionId, title, titleSetByUser, worktree, roomId, broughtIntoRoom, worksInRoomsWorkspace, outsideSandbox } = source;
    if (!acpSessionId || !this.canFork(conversationId)) throw new HostProblemError({ code: "nothing-to-fork-yet" });
    const forkPoint = throughTurnSeq === undefined ? null : this.forkPointThrough(conversationId, throughTurnSeq);
    const forked = this.adoptSession(workspaceId, { harness, profileId }, { sessionId: acpSessionId, title, titleSetByUser }, "fork", forkPoint, worktree, {
      broughtIntoRoom: broughtIntoRoom || roomId !== undefined ? true : undefined,
      worksInRoomsWorkspace,
      outsideSandbox,
    });
    this.store.copyLoadedPlugins(conversationId, forked.id);
    return forked;
  }

  private forkPointThrough(conversationId: string, seq: number): SessionForkPoint | null {
    if (this.store.findEvent(conversationId, seq)?.event.type !== "user-message") throw new HostProblemError({ code: "rewind-only-to-own-message" });
    const point = forkPointThrough(this.get(conversationId).harness, this.store.listEvents(conversationId), seq);
    if (point && !("messageId" in point)) throw new HostProblemError(point);
    return point && { messageId: point.messageId, canvasShownBefore: point.canvasBefore };
  }

  /**
   * The agent has a session to copy once it has worked on a message there, and only while the session was started
   * where the agent runs now: one from before its workspace's sandbox was turned on or off stays where it was.
   */
  canFork(conversationId: string): boolean {
    const conversation = this.get(conversationId);
    return !(conversation.roomId && this.sandboxOf(conversation)) && conversation.acpSessionId !== null && sessionHasRecord(this.store.listEvents(conversationId)) && this.keepsSessionSetup(conversation);
  }

  /**
   * A side chat about the conversation, asking `text` at once, while the conversation goes on undisturbed. It works
   * where the conversation does, on the same profile. Unless the conversation, else its workspace, else Settings, lets it
   * change files, it works in its agent's read-only mode and whatever its agent asks permission for is turned down; one
   * the owner didn't open, or of a conversation that works for a room, always does. Asked from a side chat, it is about
   * the conversation that one is beside.
   */
  startSideChat(conversationId: string, text: string, authorId?: string): Conversation {
    const asked = this.get(conversationId);
    const parent = asked.sideChatOf ? this.get(asked.sideChatOf) : asked;
    if (parent.roomId && this.sandboxOf(parent)) throw new HostProblemError({ code: "sandboxed-room-side-chat" });
    const { workspaceId, harness, profileId, worktree, roomId, broughtIntoRoom, worksInRoomsWorkspace } = parent;
    const mayChangeFiles = sideChatMayChangeFiles({
      parent,
      openedByOwner: authorId !== undefined && authorId === this.store.ownerId(),
      workspaceChoice: this.existingWorkspace(workspaceId).sideChatAccess,
      setting: this.store.sideChatAccess(),
    });
    const title = titleFrom(askedOutsideQuotes(text)) || UNTITLED;
    const sideChat = this.insertConversation(workspaceId, { harness, profileId }, title, true, worktree, { of: parent.id, mayChangeFiles }, {
      broughtIntoRoom: broughtIntoRoom || roomId !== undefined ? true : undefined,
      worksInRoomsWorkspace,
      outsideSandbox: parent.outsideSandbox,
    });
    this.store.copyLoadedPlugins(parent.id, sideChat.id);
    this.ensureSession(sideChat.id, () => this.openSideChatSession(sideChat.id, parent.id)).catch(() => {});
    this.send(sideChat.id, text, [], { authorId }).catch(() => {});
    return sideChat;
  }

  /**
   * A copy of the conversation's agent session where the agent can make one, which keeps its cached context; else a new
   * session, whose agent hears the conversation as text with the first question. Either goes on the conversation's model
   * and effort.
   */
  private async openSideChatSession(sideChatId: string, parentId: string): Promise<string> {
    const sideChat = this.get(sideChatId);
    const parent = this.store.findConversation(parentId);
    const harness = this.processToOpenOn(sideChat);
    const runtime = this.runtime(sideChatId);
    const capabilities = (await harness.start()).agentCapabilities;
    const sessionRequest = await this.sessionRequest(sideChatId);
    const copied = parent?.acpSessionId && capabilities?.sessionCapabilities?.fork && capabilities.loadSession && this.canFork(parentId) ? parent.acpSessionId : null;
    const { sessionId, configOptions } = copied ? await this.sideChatCopyOf(harness, copied, sessionRequest) : await harness.newSession(sessionRequest);
    this.closeSessionIfConversationDeleted(sideChatId, harness, sessionId);
    this.muteNotifier(sideChat, sessionId);
    this.bindSession(sideChatId, sessionId, configOptions);
    const modelAndEffort = (parent?.configOptions ?? []).filter(({ category }) => category === "model" || category === "thought_level");
    await this.restoreConfigChoices(sideChatId, sessionId, modelAndEffort);
    await this.applySideChatMode(sideChatId, sessionId);
    runtime.sideChatHandover = { conversation: copied ? null : conversationAsText(this.store.listEvents(parentId)) };
    return sessionId;
  }

  /** The agent's copy of the session, opened without replaying the history the side chat doesn't show. */
  private async sideChatCopyOf(harness: HarnessProcess, sessionId: string, sessionRequest: Awaited<ReturnType<ConversationService["sessionRequest"]>>) {
    const { sessionId: copyId } = await harness.forkSession({ sessionId, cwd: sessionRequest.cwd });
    const { configOptions } = await this.loadWithoutReplay(harness, copyId, sessionRequest, []);
    return { sessionId: copyId, configOptions };
  }

  /**
   * An agent brought into someone else's room asks as usual, so its profile's mode holds only where that mode still asks,
   * and the one that asks holds otherwise; one that works in the room's workspace runs in the mode that asks, whatever its
   * profile or the user's own settings say.
   */
  private profileModeFor(conversation: Conversation, profile: Profile | undefined) {
    if (conversation.worksInRoomsWorkspace) return askingDefaultModeOf(conversation.harness) ?? undefined;
    return conversation.broughtIntoRoom ? askingModeOf(conversation.harness, profile?.mode) : profile?.mode;
  }

  /**
   * The mode a room's or sandboxed workspace's conversation runs in: none that asks where it works freely in its sandbox,
   * otherwise its room's preset's, where its agent has one for it; null for any other conversation, which takes its
   * profile's.
   */
  private sandboxOrRoomMode(conversation: Conversation) {
    if (this.worksFreelyInSandbox(conversation)) return WORKS_FREELY_MODE;
    const room = conversation.roomId ? this.store.findRoom(conversation.roomId) : undefined;
    return room ? presetModeOf(conversation.harness, room.permissions) : null;
  }

  /**
   * Only an agent whose process runs in its sandbox's VM, while that VM is known to run and its room or workspace lets it
   * work freely there. A side chat is held to reading or asks, and an agent brought into someone else's room asks as usual.
   */
  private worksFreelyInSandbox(conversation: Conversation) {
    const sandbox = this.sandboxOf(conversation);
    if (!sandbox?.setting.workFreely || conversation.sideChatOf || conversation.broughtIntoRoom) return false;
    return this.runsInSandbox(conversation) && this.sandboxes.confirmedRunning(sandbox.owner);
  }

  /** The sandbox the conversation's agent runs in, as the store has the conversation now where it has one. */
  private sandboxOf(conversation: { id?: string; roomId?: string; workspaceId?: string; outsideSandbox?: true }) {
    const stored = conversation.id === undefined ? undefined : this.store.findConversation(conversation.id);
    return sandboxOfConversation(this.store, stored ?? conversation);
  }

  /** A launch of a conversation outside any room whose agent runs in its workspace's sandbox, as the store has it now. */
  private inSandboxedWorkspace(launch: ProcessLaunch) {
    return launch.id !== undefined && launch.roomId === undefined && this.sandboxOf(launch) !== null;
  }

  private processKeyOf(profile: Profile, launch: ProcessLaunch) {
    return agentProcessKey(profile, launch, this.inSandboxedWorkspace(launch));
  }

  /** The process the conversation's agent runs on now, as its profile, room and workspace pick it; none before it is made. */
  private currentProcessOf(conversation: Conversation) {
    const profile = conversation.profileId === null ? undefined : this.store.findProfile(conversation.profileId);
    return profile && this.agentProcesses.get(this.processKeyOf(profile, conversation));
  }

  private runsInSandbox(conversation: Conversation) {
    const harness = this.currentProcessOf(conversation);
    return harness !== undefined && this.sandboxStarts.has(harness);
  }

  /**
   * YOLO approves whatever the agent asks, outside rooms only; in a sandboxed workspace only for an agent whose process
   * runs in its VM while that VM is known to run.
   */
  private approvesEverything(conversation: Conversation) {
    if (!conversation.bypassPermissions || worksForARoom(conversation) || isToReadOnly(conversation)) return false;
    const sandbox = this.sandboxOf(conversation);
    return sandbox === null || (this.runsInSandbox(conversation) && this.sandboxes.confirmedRunning(sandbox.owner));
  }

  /**
   * A room's or sandboxed workspace's session goes to its mode as it opens, new or resumed, and as the room's preset
   * changes. A mode the agent switches to in between, as an option on its request can, holds until then.
   */
  private async keepToRoomPreset(conversationId: string, sessionId: string) {
    const mode = this.sandboxOrRoomMode(this.get(conversationId));
    const modeOption = this.get(conversationId).configOptions.find(({ category }) => category === "mode");
    if (mode && modeOption && offersValue(modeOption, mode)) await this.trySetConfigOption(conversationId, sessionId, modeOption.id, mode);
  }

  /** The model and effort the room's owner chose for the agent of a room's conversation; none for any other conversation. */
  private roomAgentModel({ roomId, profileId }: Conversation): RoomAgentModel {
    const room = roomId ? this.store.findRoom(roomId) : undefined;
    return room?.agents.find((agent) => agent.profileId === profileId) ?? PROFILES_MODEL;
  }

  /**
   * A room's session takes the model and effort its room's owner chose for its agent as it opens, new or resumed, and
   * as they change: the model first, as the efforts on offer depend on it. One the agent does not offer now is left out
   * without a word, as each session opening would otherwise say it again.
   */
  private async keepToRoomAgentModel(conversationId: string, sessionId: string) {
    const { model, effort } = this.roomAgentModel(this.get(conversationId));
    const modelOption = this.get(conversationId).configOptions.find(({ category }) => category === "model");
    const modelChoice = model && modelOption ? modelChoiceFor(this.get(conversationId).configOptions, model) : null;
    if (modelOption && modelChoice) await this.trySetConfigOption(conversationId, sessionId, modelOption.id, modelChoice);
    const effortOption = this.get(conversationId).configOptions.find(({ category }) => category === "thought_level");
    if (effort && effortOption && offersValue(effortOption, effort)) await this.trySetConfigOption(conversationId, sessionId, effortOption.id, effort);
  }

  /**
   * A room's agent takes up what its room now gives it on a fresh session of a fresh process, and is introduced to the
   * room again. One at work stops at once when the change leaves it with less; otherwise it finishes its turn, and its
   * next starts afresh, as its session was started under another setup than its room's.
   */
  startAfreshInRoom(conversationId: string, { stopsTurn }: { stopsTurn: boolean }) {
    if (!this.runtimes.get(conversationId)?.running) return this.startAfresh(conversationId);
    if (stopsTurn) this.stopTurnUnderOldSetup(conversationId);
  }

  /**
   * A workspace's own conversations that went into its sandbox or out of it, or whose sandbox changed, leave the
   * processes they ran on, in the sandbox or on this computer, at once, or, at work, once their turn ends; one at work
   * stops at once when the change leaves it with less. Each starts afresh as it next goes on, as its session was started
   * under another setup than it has now, so the conversations nobody goes back to keep theirs on screen untouched.
   */
  startAfreshUnderNewSetup(conversationIds: string[], { stopsTurn }: { stopsTurn: boolean }) {
    conversationIds.forEach((id) => {
      if (!this.runtimes.get(id)?.running) this.leaveProcess(id);
      else if (stopsTurn) this.stopTurnUnderOldSetup(id);
    });
    this.republishAll(conversationIds);
  }

  /** Tells the pages what the conversations are now. */
  republishAll(conversationIds: string[]) {
    conversationIds.forEach((id) => this.republish(id));
  }

  private startAfresh(conversationId: string) {
    const conversation = this.store.findConversation(conversationId);
    if (this.stopping || !conversation) return;
    this.leaveProcess(conversationId);
    if (conversation.acpSessionId === null) return;
    this.forgetContextUsage(conversationId);
    this.save({ ...conversation, acpSessionId: null });
    this.append(conversationId, { type: "context-cleared" });
  }

  /**
   * The conversation's own processes stop; on the process its profile shares with other conversations, which goes on
   * serving them, only its session is let go.
   */
  private leaveProcess(conversationId: string) {
    const runtime = this.runtimes.get(conversationId);
    if (runtime?.harness && !this.isOwnProcess(conversationId, runtime.harness)) void this.releaseSession(conversationId, runtime, this.get(conversationId).acpSessionId);
    this.ownProcessesOf(conversationId).forEach((harness) => void this.killAgent(harness, { kind: "stopped" }));
  }

  /**
   * A turn on the process the profile shares is cancelled, as stopping that process would stop every other
   * conversation's, and its session, with the background shells it runs, is let go once the turn ends.
   */
  private stopTurnUnderOldSetup(conversationId: string) {
    const runtime = this.runtimes.get(conversationId);
    const harness = runtime?.harness;
    if (harness && this.isOwnProcess(conversationId, harness)) return void this.killAgent(harness, { kind: "stopped" });
    const sessionId = this.get(conversationId).acpSessionId;
    void this.cancel(conversationId).catch(() => {});
    if (runtime && harness) void runtime.turnEnded?.then(() => this.releaseSessionStillOn(conversationId, runtime, harness, sessionId));
  }

  /**
   * The owner added a folder to the sandbox or took one out. Its VM can't take up a mount while it runs, so one running
   * with other folders starts again once no turn runs in it: each conversation of it leaves its process, keeping its
   * session, to resume it on the new VM. Turns meanwhile wait at their start. Settles once the change is taken up.
   */
  sandboxFoldersChanged(owner: SandboxOwner): Promise<void> {
    const pending = this.folderChanges.get(ownerKey(owner));
    if (pending?.restarting) return pending.taken;
    if (!this.sandboxes.runsWithOtherFolders(owner)) {
      if (pending) this.folderChangeTaken(pending);
      return Promise.resolve();
    }
    const change = pending ?? this.newFolderChange(owner);
    this.restartForFoldersOnceIdle(change);
    return change.taken;
  }

  /** Whether the sandbox's VM waits for its agents to finish to start again with the folders the owner has given it. */
  waitsForSandboxFolders(owner: SandboxOwner) {
    return this.folderChanges.has(ownerKey(owner));
  }

  /** The turns at work in the sandbox stop, as under a change that leaves them with less, for its VM to start again with its folders now. */
  applySandboxFoldersNow(owner: SandboxOwner) {
    const change = this.folderChanges.get(ownerKey(owner));
    if (change) this.turnsAtWorkIn(change).forEach((conversationId) => this.stopTurnUnderOldSetup(conversationId));
  }

  /** A deleted room's or workspace's change of folders is dropped, and the turns it held go on. */
  sandboxFoldersGone(owner: SandboxOwner) {
    const change = this.folderChanges.get(ownerKey(owner));
    if (change) this.folderChangeTaken(change);
  }

  private newFolderChange(owner: SandboxOwner) {
    let take = () => {};
    const taken = new Promise<void>((resolve) => (take = resolve));
    const change: FolderChange = { owner, held: new Map(), taken, take, restarting: false };
    this.folderChanges.set(ownerKey(owner), change);
    return change;
  }

  private folderChangeTaken(change: FolderChange) {
    if (this.folderChanges.get(ownerKey(change.owner)) === change) this.folderChanges.delete(ownerKey(change.owner));
    change.take();
  }

  /** The conversations whose agents run in the sandbox; an agent brought into someone else's room runs on this computer. */
  private conversationsInSandbox(owner: SandboxOwner) {
    return this.store.listConversations().filter((conversation) => !conversation.broughtIntoRoom && belongsToSandbox(conversation, owner));
  }

  private turnsAtWorkIn(change: FolderChange) {
    return this.conversationsInSandbox(change.owner)
      .map(({ id }) => id)
      .filter((id) => this.runtimes.get(id)?.running && !change.held.has(id));
  }

  private restartForFoldersOnceIdle(change: FolderChange) {
    if (this.stopping || change.restarting || this.turnsAtWorkIn(change).length > 0) return;
    change.restarting = true;
    void this.restartForFolders(change)
      .catch((error: unknown) => console.error(`starting the sandbox of ${ownerKey(change.owner)} again with its folders failed:`, error))
      .finally(() => this.folderChangeTaken(change));
  }

  /** Each conversation of the sandbox leaves its process in the VM, keeping its session, and the VM stops; the next turn starts it with its folders. */
  private async restartForFolders({ owner }: FolderChange) {
    const processes = this.conversationsInSandbox(owner).flatMap(({ id }) => this.ownProcessesOf(id));
    await Promise.all(processes.map((harness) => this.killAgent(harness, { kind: "stopped" })));
    await this.sandboxes.stop(owner);
  }

  /**
   * A turn in a sandbox whose VM is to start again with other folders waits at its start until it has, or until the
   * turn is stopped. It leaves its process at once, so stopping that process never waits for the turn.
   */
  private async waitForSandboxFolders(conversationId: string) {
    const runtime = this.runtime(conversationId);
    const conversation = this.get(conversationId);
    const sandbox = conversation.broughtIntoRoom ? null : this.sandboxOf(conversation);
    const change = sandbox && this.folderChanges.get(ownerKey(sandbox.owner));
    if (!change || runtime.turn?.stoppedWaitingForSandboxFolders) return;
    const stopped = new Promise<void>((resolve) => change.held.set(conversationId, resolve));
    runtime.harness = undefined;
    runtime.sessionId = undefined;
    this.forgetAsyncTasks(conversationId);
    this.setBusy(conversationId, "waiting-for-sandbox-folders");
    this.restartForFoldersOnceIdle(change);
    await Promise.race([change.taken, stopped]);
    change.held.delete(conversationId);
    if (!runtime.turn?.stoppedWaitingForSandboxFolders) this.setStatus(conversationId, "starting");
  }

  private letHeldTurnGo(conversationId: string) {
    this.folderChanges.forEach(({ held }) => held.get(conversationId)?.());
  }

  /** The turn that ends may be the last one a change of its sandbox's folders waited for. */
  private takeUpFolderChangesAfterTurn(conversationId: string) {
    const conversation = this.store.findConversation(conversationId);
    if (!conversation) return;
    [...this.folderChanges.values()].filter(({ owner }) => belongsToSandbox(conversation, owner)).forEach((change) => this.restartForFoldersOnceIdle(change));
  }

  /** A session another start took the conversation off meanwhile is left to that start. */
  private async releaseSessionStillOn(conversationId: string, runtime: Runtime, harness: HarnessProcess, sessionId: string | null) {
    if (runtime.harness === harness) await this.releaseSession(conversationId, runtime, sessionId);
  }

  /** The keys of the processes that serve only this conversation: its Antigravity, room or sandboxed workspace process. */
  private isOwnProcessKey(key: string, conversationId: string) {
    return key.endsWith(`/${conversationId}`) || key.endsWith(`/${conversationId}/${SANDBOXED_KEY_SUFFIX}`);
  }

  private ownProcessesOf(conversationId: string) {
    return [...this.agentProcesses].filter(([key]) => this.isOwnProcessKey(key, conversationId)).map(([, harness]) => harness);
  }

  private isOwnProcess(conversationId: string, harness: HarnessProcess) {
    return this.ownProcessesOf(conversationId).includes(harness);
  }

  /** A conversation whose session was started under another setup than its room's or workspace's now starts afresh before its next turn. */
  private startAfreshOnChangedSetup(conversationId: string) {
    const conversation = this.get(conversationId);
    if (conversation.acpSessionId !== null && !this.keepsSessionSetup(conversation)) this.startAfresh(conversationId);
  }

  private keepsSessionSetup(conversation: Conversation) {
    return this.store.setupOfSession(conversation.id) === this.sessionSetupOf(conversation);
  }

  /**
   * What a session is started under, which it can't take up once open: a room's agent's setup, or whether its
   * workspace's sandbox lets it work freely. Null for a conversation that runs on this computer outside any room.
   */
  private sessionSetupOf(conversation: Conversation) {
    if (conversation.roomId) return this.roomSetupOf(conversation);
    const sandbox = this.sandboxOf(conversation);
    return sandbox && JSON.stringify({ sandbox: sandbox.setting.workFreely ? "works-freely" : "profile-mode" });
  }

  private roomSetupOf({ roomId, profileId }: Conversation) {
    const profile = profileId === null ? undefined : this.store.findProfile(profileId);
    if (!roomId || !profile) return null;
    const room = this.store.findRoom(roomId);
    return roomSetupFingerprint(profile.harness, profile.environment, this.environmentChoicesOf(roomId, profile.id), room?.claudeSetup ?? ALL_OF_CLAUDE_SETUP, room?.sandbox ?? NO_SANDBOX, room?.plugins ?? []);
  }

  /**
   * A process that started on this computer before its room or workspace was sandboxed, or the other way round, is not
   * taken up again; nor is one the conversation no longer runs on, nor a session still open on such a process.
   */
  private leaveProcessStartedElsewhere(conversationId: string) {
    const conversation = this.get(conversationId);
    const runtime = this.runtime(conversationId);
    const harness = this.currentProcessOf(conversation);
    this.ownProcessesOf(conversationId)
      .filter((own) => own !== harness)
      .forEach((own) => void this.killAgent(own, { kind: "stopped" }));
    if (runtime.harness && runtime.harness !== harness) void this.releaseSession(conversationId, runtime, conversation.acpSessionId);
    if (!harness) return;
    const startedElsewhere = this.sandboxOf(conversation) ? this.startedOnThisComputer.has(harness) : this.sandboxStarts.has(harness);
    if (startedElsewhere) void this.killAgent(harness, { kind: "stopped" });
  }

  /** A room agent's model and effort reach its open session at once; one not open takes them as it next opens. */
  async followRoomAgentModel(conversationId: string) {
    const sessionId = await this.runtimes.get(conversationId)?.sessionId?.catch(() => null);
    if (sessionId) await this.keepToRoomAgentModel(conversationId, sessionId);
  }

  /**
   * What the conversation's next side chats may do, ahead of its workspace and Settings. Switched on a side chat, that one
   * follows at once; the conversation's other side chats stay as they are.
   */
  async switchSideChatAccess(conversationId: string, access: SideChatAccess) {
    if (!isSideChatAccess(access)) throw new HostProblemError({ code: "unknown-side-chat-access", value: String(access) });
    const { id, harness, sideChatOf } = this.get(conversationId);
    const parent = this.get(sideChatOf ?? id);
    if (!sideChatAccessIsAChoice({ ...parent, harness })) throw new HostProblemError({ code: "side-chat-access-no-choice" });
    this.store.setConversationSideChatAccess(parent.id, access);
    this.republish(parent.id);
    if (sideChatOf) await this.switchOpenSideChat(id, access);
  }

  /** Its session, when one is open, goes to its new mode at once; one not open does as it next opens. */
  private async switchOpenSideChat(sideChatId: string, access: SideChatAccess) {
    if (sideChatAccessOf(this.get(sideChatId)) === access) return;
    const runtime = this.runtime(sideChatId);
    this.store.setSideChatMayChangeFiles(sideChatId, access === "can-change-files");
    runtime.sideChatAccessToTell = access;
    this.republish(sideChatId);
    if (access === "read-only") this.turnDownWaitingPermissions(sideChatId);
    const open = await runtime.sessionId?.catch(() => null);
    const mode = this.sideChatModeOffered(sideChatId);
    if (!open || !mode) return;
    const modeSet = this.setConfigOption(sideChatId, mode.configId, mode.value);
    await Promise.all([modeSet, this.stopTurnThatCouldStillChangeFiles(sideChatId)]);
  }

  private async stopTurnThatCouldStillChangeFiles(sideChatId: string) {
    const { harness, sideChatMayChangeFiles } = this.get(sideChatId);
    const { running, turn } = this.runtime(sideChatId);
    if (!sideChatMayChangeFiles && keepsModeThroughTurn(harness) && running && turn?.promptSent) await this.cancel(sideChatId);
  }

  private turnDownWaitingPermissions(conversationId: string) {
    this.runtime(conversationId).pendingPermissions.forEach(({ settle, request }) => settle(optionThatRejects(request.options)));
  }

  /** The mode the side chat's session works in, where its agent offers it: `modeOfFileChangingSideChat` for one that may change files, for any other its agent's read-only mode. */
  private sideChatModeOffered(sideChatId: string) {
    const sideChat = this.get(sideChatId);
    const value = sideChat.sideChatMayChangeFiles ? this.modeOfFileChangingSideChat(sideChat) : sideChatModeOf(sideChat.harness);
    const modeOption = modeOptionOf(sideChat);
    return value && modeOption && offersValue(modeOption, value) ? { configId: modeOption.id, value } : null;
  }

  private async applySideChatMode(sideChatId: string, sessionId: string) {
    const mode = this.sideChatModeOffered(sideChatId);
    if (mode) await this.trySetConfigOption(sideChatId, sessionId, mode.configId, mode.value);
  }

  /** A session reopens in the mode it was left in, which a switch of what the side chat may do while it was closed calls for leaving. */
  private async followSideChatAccess(sideChatId: string, sessionId: string) {
    const sideChat = this.get(sideChatId);
    const readsOnly = modeOptionOf(sideChat)?.currentValue === sideChatModeOf(sideChat.harness);
    if (readsOnly === Boolean(sideChat.sideChatMayChangeFiles)) await this.applySideChatMode(sideChatId, sessionId);
  }

  /**
   * The mode the conversation it is beside is in, else the one it would start in by itself: its profile's, or in a sandbox
   * the one that asks. Never the mode a sandboxed conversation works freely in, as a side chat in a sandbox never works
   * freely, nor the agent's read-only mode, which the conversation or the profile may plan in and which would hold the side
   * chat to reading: one left without another mode changes files in its agent's most asking one that can.
   */
  private modeOfFileChangingSideChat(sideChat: Conversation) {
    const parent = sideChat.sideChatOf === undefined ? undefined : this.store.findConversation(sideChat.sideChatOf);
    const parentMode = parent && modeOptionOf(parent)?.currentValue;
    const worksFreelyInSandbox = parent !== undefined && parentMode === WORKS_FREELY_MODE && this.sandboxOf(parent) !== null;
    const readOnlyMode = sideChatModeOf(sideChat.harness);
    if (typeof parentMode === "string" && !worksFreelyInSandbox && parentMode !== readOnlyMode) return parentMode;
    const profile = sideChat.profileId === null ? undefined : this.store.findProfile(sideChat.profileId);
    const startingMode = this.startingModeOf(sideChat, profile);
    const wouldReadOnly = (startingMode ?? modeOptionOf(sideChat)?.currentValue) === readOnlyMode;
    return wouldReadOnly ? fileChangingModeOf(sideChat.harness) : startingMode;
  }

  /** The side chat goes on as a conversation of its own, in the mode the conversation it was beside is in, else its profile's. */
  async promoteSideChat(sideChatId: string) {
    const { sideChatOf, profileId } = this.get(sideChatId);
    if (!sideChatOf) return;
    this.store.endSideChat(sideChatId);
    this.runtime(sideChatId).sideChatAccessToTell = undefined;
    this.save(this.get(sideChatId));
    const parentMode = this.store.findConversation(sideChatOf)?.configOptions.find(({ category }) => category === "mode")?.currentValue;
    const mode = parentMode ?? (profileId === null ? undefined : this.store.findProfile(profileId)?.mode);
    const modeOption = this.get(sideChatId).configOptions.find(({ category }) => category === "mode");
    if (mode !== undefined && mode !== null && modeOption) await this.setConfigOption(sideChatId, modeOption.id, mode);
  }

  /**
   * An agent's conversation in a room, which no list of conversations shows: it works in the room's workspace, its agent's
   * questions don't wait for an answer, and it never runs in YOLO, whatever its profile says: the room's preset rules it.
   */
  startInRoom(roomId: string, workspaceId: string, launch: Launch, title: string): Conversation {
    return this.insertConversation(workspaceId, launch, title, true, undefined, undefined, { roomId });
  }

  /**
   * The conversation of an agent you brought into a room of someone else's machine, which shows with your others and asks
   * you as they do; as the room's text drives it, it gets of Mirador no more than a room's agent does. One that works in
   * the room's own workspace gets nothing else of this computer either, nor does anything started in that one's folder,
   * where the agent's session, with the room's text in it, could be taken up again.
   */
  createBroughtIntoRoom(workspaceId: string, launch: Launch, title: string, inRoomsWorkspace: boolean): Conversation {
    const conversation = this.insertConversation(workspaceId, launch, title, true, undefined, undefined, inRoomsWorkspace ? HELD_TO_A_ROOMS_WORKSPACE : { broughtIntoRoom: true });
    this.ensureSession(conversation.id).catch(() => {});
    return conversation;
  }

  private insertConversation(
    workspaceId: string,
    launch: Launch,
    title: string,
    titleSetByUser = false,
    worktree?: ConversationWorktree,
    sideChat?: { of: string; mayChangeFiles: boolean },
    worksFor: Pick<Conversation, "roomId" | "broughtIntoRoom" | "worksInRoomsWorkspace" | "outsideSandbox"> = {},
  ): Conversation {
    const { roomId, broughtIntoRoom, worksInRoomsWorkspace, outsideSandbox } = this.existingWorkspace(workspaceId).forBroughtAgents ? { ...worksFor, ...HELD_TO_A_ROOMS_WORKSPACE } : worksFor;
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
      askMode: roomId ? "next-message" : profile.askMode,
      bypassPermissions: sideChat === undefined && !worksForARoom({ roomId, broughtIntoRoom, worksInRoomsWorkspace }) && profile.bypassPermissions,
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
      ...(sideChat && { sideChatOf: sideChat.of }),
      ...(sideChat?.mayChangeFiles && { sideChatMayChangeFiles: true as const }),
      ...(roomId && { roomId }),
      ...(broughtIntoRoom && { broughtIntoRoom }),
      ...(worksInRoomsWorkspace && { worksInRoomsWorkspace }),
      ...(outsideSandbox && roomId === undefined && { outsideSandbox }),
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

  /** The conversations, the tasks their plugin tools started and their side chats, which deleting them closes with them. */
  private closingWith(conversationIds: string[]): Set<string> {
    const closing = new Set<string>();
    const close = (id: string) => {
      if (closing.has(id)) return;
      closing.add(id);
      [...this.store.conversationsStartedBy(id), ...this.store.sideChatsOf(id)].forEach(close);
    };
    conversationIds.forEach(close);
    return closing;
  }

  /**
   * The worktrees deleting the conversations removes — their own and their delegated tasks' — each once, with the
   * uncommitted files it holds: none while a conversation that stays works there too.
   */
  async worktreesLostWith(...conversationIds: string[]): Promise<{ worktree: ConversationWorktree; uncommittedFiles: number }[]> {
    const closing = this.closingWith(conversationIds);
    const worktrees = new Map<string, ConversationWorktree>();
    for (const id of closing) {
      const { worktree } = this.get(id);
      if (worktree) worktrees.set(worktree.id, worktree);
    }
    const lost = [...worktrees.values()].filter((worktree) => this.store.conversationsInWorktree(worktree.id).every((id) => closing.has(id)));
    return Promise.all(lost.map(async (worktree) => ({ worktree, uncommittedFiles: await this.worktrees.uncommittedFiles(worktree) })));
  }

  /** How the conversation's worktree commits stand against its project folder's branch; null for a conversation without a worktree. */
  async landable(conversationId: string): Promise<Landable | null> {
    const { workspaceId, worktree } = this.get(conversationId);
    if (!worktree || !(await this.worktrees.isMade(worktree))) return null;
    const workspace = this.existingWorkspace(workspaceId);
    return this.worktrees.landable(workspace, worktree, this.hooksOffIn(workspace, worktree));
  }

  /**
   * Brings the worktree's commits onto the project folder's branch. A rebase rewrites the worktree's files, so it waits
   * while any conversation working there, its forks included, is in a turn; the calling agent's own turn is the exception,
   * as it waits for the answer.
   */
  async land(conversationId: string, { byAgent }: { byAgent: boolean }): Promise<Landed> {
    const { workspaceId, worktree } = this.get(conversationId);
    if (!worktree) throw new HostProblemError({ code: "landing-needs-worktree" });
    const waitsForTheAnswer = (id: string) => byAgent && id === conversationId;
    const mayRebase = this.store.conversationsInWorktree(worktree.id).every((id) => waitsForTheAnswer(id) || !this.runtimes.get(id)?.running);
    const workspace = this.existingWorkspace(workspaceId);
    return this.worktrees.land(workspace, worktree, { mayRebase, ownersHooks: !this.hooksOffIn(workspace, worktree) });
  }

  /** A worktree's repository is its workspace's, so its hooks are off where either folder lies where a sandbox works. */
  private hooksOffIn(workspace: Workspace, worktree: ConversationWorktree) {
    return repositoryHooksOff(this.store, [workspace.path, worktree.root]);
  }

  /** Those of the conversations still there that rest with all deleting them takes, which deleting several together may take; none that is or holds a favourite. */
  stillResting(conversationIds: string[]) {
    const heldBy = ({ id }: Conversation) => [...this.store.conversationsStartedBy(id), ...this.store.sideChatsOf(id)].filter((held) => this.store.hasConversation(held)).map((held) => this.get(held));
    const takenTogether = (conversation: Conversation) => !holdsAFavourite(conversation, heldBy) && restsWithAllItHolds(conversation, heldBy);
    return conversationIds.filter((id) => this.store.hasConversation(id) && takenTogether(this.get(id)));
  }

  /** The uncommitted files deleting the conversations removes with their worktrees and their delegated tasks'. */
  async uncommittedFilesLostWith(...conversationIds: string[]) {
    return (await this.worktreesLostWith(...conversationIds)).reduce((sum, { uncommittedFiles }) => sum + uncommittedFiles, 0);
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

  /**
   * Its worktree goes once no other conversation works there; with `keepsUncommittedWork`, only one that holds none.
   * Its branch goes too unless it holds commits the workspace's branch lacks, which git keeps; `keepsUnmergedBranch`
   * false deletes it even then.
   */
  delete(conversationId: string, { keepsUncommittedWork = false, keepsUnmergedBranch = true }: DeleteOptions = {}) {
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
    this.broughtTasks.settleLost(conversationId);
    this.images.deleteConversation(conversationId);
    this.droppedFiles.deleteConversation(conversationId);
    this.hub.broadcast({ type: "conversation.deleted", conversationId });
    this.announceWaiting();
    if (wasRunning) this.announceRunningTurnsCount();
    if (workspace && conversation.worktree && this.store.conversationsInWorktree(conversation.worktree.id).length === 0)
      this.removeWorktree(workspace, conversation.worktree, keepsUncommittedWork, keepsUnmergedBranch).catch((error: unknown) => console.error(`could not remove the worktree ${conversation.worktree?.root}:`, error));
  }

  private async removeWorktree(workspace: Workspace, worktree: ConversationWorktree, keepsUncommittedWork: boolean, keepsUnmergedBranch: boolean) {
    if (keepsUncommittedWork && (await this.worktrees.uncommittedFiles(worktree)) > 0) return;
    await this.worktrees.remove(workspace, worktree, { keepsUnmergedBranch });
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
    const { harness, worksInRoomsWorkspace } = this.get(conversationId);
    const target = this.store.findProfile(profileId);
    if (target && worksInRoomsWorkspace) assertWorksInRoomsWorkspaces(target.harness);
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
    const harness = this.agentProcesses.get(this.processKeyOf(this.profileOf(conversation), conversation));
    if (!harness) return;
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
    if (bypassPermissions && worksForARoom(this.get(conversationId))) throw new Error("A conversation that works for a room always asks.");
    this.save({ ...this.get(conversationId), bypassPermissions });
    if (!bypassPermissions) return;
    this.runtime(conversationId).pendingPermissions.forEach(({ settle, allowOptionId }) => allowOptionId && settle(allowOptionId));
  }

  async setConfigOption(conversationId: string, configId: string, value: ConfigValue) {
    this.assertModeAllowed(this.get(conversationId), configId, value);
    const sessionId = await this.ensureSession(conversationId);
    const conversation = this.get(conversationId);
    this.assertModeAllowed(conversation, configId, value);
    const response = await this.harnessFor(conversation).setConfigOption(sessionId, configId, value);
    this.save({ ...this.get(conversationId), configOptions: response.configOptions });
  }

  private assertModeAllowed(conversation: Conversation, configId: string, value: ConfigValue) {
    if (!conversation.broughtIntoRoom || typeof value !== "string") return;
    const option = conversation.configOptions.find(({ id }) => id === configId);
    if ((option?.category === "mode" || configId === "mode") && !allowsBroughtMode(conversation, value)) {
      throw new Error("A conversation that works for a room always asks.");
    }
  }

  /**
   * What a profile's agent offers, from the agent itself, so a profile editor can list modes and efforts before one of
   * its conversations has run; null when the agent was not there to answer, and the editor keeps what its own
   * conversations last listed. An answer stands until the profile launches its agent differently or names another model.
   */
  async profileChoices(profileId: string): Promise<acp.SessionConfigOption[] | null> {
    const model = this.store.findProfile(profileId)?.model ?? null;
    const remembered = this.profileChoicesCache.get(profileId);
    if (remembered?.model === model && Date.now() - remembered.at < PROFILE_CHOICES_TTL_MS) return remembered.options;
    const asking = this.profileChoiceProbes.get(profileId);
    if (asking?.model === model) return asking.probe;
    const probe: Promise<acp.SessionConfigOption[] | null> = this.askProfileChoices(profileId).then((options) => {
      if (options && this.profileChoiceProbes.get(profileId)?.probe === probe) this.profileChoicesCache.set(profileId, { at: Date.now(), model, options });
      return options;
    });
    this.profileChoiceProbes.set(profileId, { model, probe });
    void probe.finally(() => {
      if (this.profileChoiceProbes.get(profileId)?.probe === probe) this.profileChoiceProbes.delete(profileId);
    });
    return probe;
  }

  /** As `profileChoices`, for a plugin; rejects when no profile has that id. */
  async profileChoicesForPlugin(profileId: string): Promise<acp.SessionConfigOption[] | null> {
    return this.profileChoices(this.profileWithId(profileId).id);
  }

  /**
   * Starts the profile's agent as a conversation would, asks a new session what it offers, and stops it again. It logs
   * apart: nobody reads what its pre-launch command wrote, and a test or conversation starting meanwhile would find
   * their own output mixed with it.
   */
  private async askProfileChoices(profileId: string): Promise<acp.SessionConfigOption[] | null> {
    const profile = this.store.findProfile(profileId);
    if (!profile) return null;
    const probe = await this.probeProfile(profile, profileId, PROFILE_PROBE_TIMEOUT_MS, { logApart: true });
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
      ...(draft.keepCacheWarm && { keepCacheWarm: true }),
      color: draft.color,
      ...(draft.pluginSettings && { pluginSettings: draft.pluginSettings }),
      pluginsOff: draft.pluginsOff,
      createdAt: Date.now(),
    };
    const probe = await this.probeProfile(profile, `test-${crypto.randomUUID()}`, PROFILE_TEST_TIMEOUT_MS);
    if ("error" in probe) throw probe.error;
    return { ok: true, configOptions: probe.configOptions ?? [], tookMs: probe.tookMs };
  }

  /**
   * Starts the profile's agent, asks a new session on the profile's model what it offers, and stops it again. `key`
   * names the process for a profile restart to stop. The agent's answer is null when it listed no options at all.
   */
  private async probeProfile(
    profile: Profile,
    key: string,
    timeoutMs: number,
    { logApart = false }: { logApart?: boolean } = {},
  ): Promise<{ configOptions: acp.SessionConfigOption[] | null; tookMs: number } | { error: unknown }> {
    const startedAt = Date.now();
    let harness: HarnessProcess | null = null;
    try {
      const spec = harnessSpec(profile, this.store.claudeProgramSetting());
      harness = new HarnessProcess(
        { ...withEnvironment(spec, (environment) => ({ ...environment, ...this.scriptEnvironment(environment.PATH) })), logName: logApart ? `${spec.logName}.check` : spec.logName },
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
      return { configOptions: await offeredOnModel(agent, created, profile.model), tookMs: Date.now() - startedAt };
    } catch (error) {
      return { error };
    } finally {
      if (this.activeProbeHarnesses.get(key) === harness) this.activeProbeHarnesses.delete(key);
      void harness?.stop();
    }
  }

  async prompt(conversationId: string, text: string, { imageIds = [], authorId, fromScript = false, fromMirador = false, fromPlugin, roomMessageId, broughtTaskId, startsTurn = false }: PromptStart = {}) {
    const runtime = this.runtime(conversationId);
    this.promptCacheKeepAlive.disarm(conversationId);
    if (runtime.outsideTurn) await runtime.outsideTurn.settled;
    if (runtime.running) throw new HostProblemError({ code: "agent-still-working" });
    if (isClearCommand(text)) return this.clearContext(conversationId);
    if (isReloadCommand(text)) return this.reloadAgent(conversationId);
    this.startAfreshOnChangedSetup(conversationId);
    this.leaveProcessStartedElsewhere(conversationId);
    runtime.running = true;
    this.announceRunningTurnsCount();
    this.endUsageLimitWait(runtime);
    let endTurn = () => {};
    runtime.turnEnded = new Promise((resolve) => (endTurn = resolve));
    const turn: TurnInProgress = { steered: [], ended: false, lastReplyMessageId: null, awaitedUser: false, fromScript, reply: "", lastMessage: "", lastChunk: "", toolCalls: [], ...(broughtTaskId && { broughtTaskId }) };
    runtime.turn = turn;
    runtime.openToolCalls.clear();
    this.forgetUnseenTurnEnd(conversationId);
    this.retitleFromFirstMessage(conversationId, text);
    const notes = this.notesForAgent(conversationId);
    if (!this.showsSandboxStart(conversationId)) this.setStatus(conversationId, "starting");
    this.store.turnStarted(conversationId);
    this.hearActivity(conversationId, { kind: "turn-started" });
    if (runtime.heldCodexSession) await this.ensureSession(conversationId).catch(() => {});
    const turnSeq = this.appendUserMessage(
      conversationId,
      {
        text,
        imageIds,
        ...(authorId && { authorId }),
        ...(fromScript && { fromScript }),
        ...(fromMirador && { fromMirador }),
        ...(fromPlugin && { fromPlugin }),
        ...(roomMessageId && { roomMessageId }),
        ...(broughtTaskId && { broughtTaskId }),
      },
      notes,
    );
    if (turnSeq !== undefined) this.turnsHeard.turnStarted(conversationId, turnSeq);
    if (startsTurn && turnSeq !== undefined) await this.keepFilesOfTurn(conversationId, turnSeq);
    let response: acp.PromptResponse | undefined;
    let endedOnItsOwn: acp.PromptResponse | undefined;
    let sessionOpened = false;
    try {
      await this.waitForSandboxFolders(conversationId);
      if (turn.stoppedWaitingForSandboxFolders) {
        this.append(conversationId, { type: "turn-end", stopReason: "cancelled", ...this.measuredTurn(conversationId, turn) });
        this.notifyTurnEnded(conversationId, { stopReason: "cancelled" });
        this.setStatus(conversationId, "idle");
        this.turnIsOver(conversationId, turn, turnSeq, undefined);
        return;
      }
      this.lookThroughSandboxFolders(conversationId);
      const sessionId = await this.ensureSession(conversationId);
      sessionOpened = true;
      this.setStatus(conversationId, "running");
      const sent = this.takeRoomContextLost(runtime) && turnSeq !== undefined ? this.roomRules.reintroduced(conversationId, turnSeq, text) : text;
      const prompt = [...this.takeSideChatWords(conversationId), ...(await this.promptContent(conversationId, withNotes(notes, sent), imageIds))];
      const harness = this.harnessFor(this.get(conversationId));
      turn.promptSent = { text, sentAt: Date.now() };
      const answered = harness.prompt(sessionId, prompt);
      if (turn.stoppedBeforePrompt) this.cancel(conversationId).catch((error) => console.error(`stopping the turn of conversation ${conversationId} failed:`, error));
      response = await answered;
      this.showHeldBackReply(conversationId);
      const harnessId = this.get(conversationId).harness;
      const limitReply = usageLimitReplyIn({ stopReason: response.stopReason, lastMessage: turn.lastMessage, messageId: turn.lastReplyMessageId }, harnessId);
      const errorReply = limitReply === null ? antigravityErrorReplyIn({ stopReason: response.stopReason, lastChunk: turn.lastChunk }, harnessId) : null;
      const model = runtime.reportedModel ?? chosenModel(this.get(conversationId).configOptions)?.id;
      const spent = { ...turnUsageOf(response), ...(model && { model }), ...this.measuredTurn(conversationId, turn), ...this.filesEditedSince(conversationId, turnSeq) };
      if (limitReply !== null) {
        this.notifyTurnEnded(conversationId, this.recordUsageLimit(conversationId, { message: limitReply }, true, spent));
      } else if (errorReply !== null) {
        const authRequired = isAntigravityAuthError(errorReply);
        this.append(conversationId, { type: "error", message: errorReply, continuable: true, ...(authRequired && { authRequired: true as const }), endsTurn: true, ...spent });
        this.notifyTurnEnded(conversationId, { error: errorReply });
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
        this.append(conversationId, { type: "turn-end", stopReason: "cancelled", ...this.measuredTurn(conversationId, turn) });
        this.notifyTurnEnded(conversationId, { stopReason: "cancelled" });
      } else {
        this.notifyTurnEnded(conversationId, this.recordTurnFailure(conversationId, error, turn.promptSent !== undefined, this.measuredTurn(conversationId, turn)));
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
      if (turn.promptSent !== undefined) this.refreshAntigravityQuotas(conversationId, true);
      if (sessionOpened) this.setStatus(conversationId, "idle");
      endTurn();
    }
    this.turnIsOver(conversationId, turn, turnSeq, endedOnItsOwn);
  }

  /** What follows a turn once it has ended, however it ended: the plugin that started it hears, and the queue moves on. */
  private turnIsOver(conversationId: string, turn: TurnInProgress, turnSeq: number | undefined, endedOnItsOwn: acp.PromptResponse | undefined) {
    if (endedOnItsOwn && !this.stopping && this.keepsCacheWarm(conversationId)) this.keepCacheWarmAfterTurn(conversationId);
    if (!this.stopping) this.deliverOwedReply(conversationId);
    if (!this.stopping && turnSeq !== undefined) this.turnsHeard.turnEnded(conversationId, turnSeq);
    this.takeUpFolderChangesAfterTurn(conversationId);
    this.sendNextQueuedMessage(conversationId);
    if (!this.nudgeAfterStall(conversationId, turn, endedOnItsOwn)) this.followUpOnCanvasUse(conversationId, turn, endedOnItsOwn);
    this.lookAtHeldFilesAgain(conversationId);
    this.leaveSandboxTurnedOff(conversationId);
    this.stopOwnProcessOnceIdle(conversationId);
  }

  /**
   * A prompt that waited for Mirador's own to be answered starts its turn first, and the queue goes on after it. The
   * waiting prompts resume in the microtasks that settling queued, so a microtask queued after them comes last.
   */
  private sendQueueAfterPromptsThatWaited(conversationId: string) {
    queueMicrotask(() => this.sendNextQueuedMessage(conversationId));
  }

  /** Armed before anything that may start the next turn, which disarms it. */
  private keepCacheWarmAfterTurn(conversationId: string) {
    this.promptCacheKeepAlive.armAfterTurn(conversationId).catch((error: unknown) => console.error(`keeping the prompt cache of conversation ${conversationId} warm failed:`, error));
  }

  /**
   * A turn that went on in a sandbox's VM after its sandbox was turned off leaves the VM as it ends, so the VM stops once
   * no conversation works in it. The conversation's next turn starts on this computer.
   */
  private leaveSandboxTurnedOff(conversationId: string) {
    const harness = this.runtimes.get(conversationId)?.harness;
    const conversation = this.store.findConversation(conversationId);
    if (harness && conversation && this.sandboxStarts.has(harness) && !this.sandboxOf(conversation)) void this.killAgent(harness, { kind: "stopped" });
  }

  /** As a turn starts, the folders its sandbox's VM works in are looked through for repositories made there since it started, in the background. */
  private lookThroughSandboxFolders(conversationId: string) {
    const conversation = this.store.findConversation(conversationId);
    const owner = conversation && !conversation.broughtIntoRoom && this.sandboxOf(conversation)?.owner;
    if (owner) void this.sandboxes.turnStarted(owner).catch((error: unknown) => console.error(`looking through the folders of ${ownerKey(owner)} failed:`, error));
  }

  /** A sandbox's agent config files are looked at again as each turn ends, in case a change went unnoticed. */
  private lookAtHeldFilesAgain(conversationId: string) {
    const conversation = this.store.findConversation(conversationId);
    const owner = conversation && this.sandboxOf(conversation)?.owner;
    if (owner) void this.sandboxes.turnEnded(owner).catch((error: unknown) => console.error(`looking at the held files of ${ownerKey(owner)} failed:`, error));
  }

  /**
   * A room's agents are tagged now and then, and a sandboxed workspace's conversations each keep a process in its VM, so
   * their processes, one per conversation, would otherwise pile up.
   */
  private stopOwnProcessOnceIdle(conversationId: string) {
    const conversation = this.store.findConversation(conversationId);
    if (!conversation || (!conversation.roomId && !this.sandboxOf(conversation))) return;
    clearTimeout(this.idleOwnProcesses.get(conversationId));
    const timer = setTimeout(() => this.stopIdleOwnProcess(conversationId), this.config.roomAgentIdleMs);
    timer.unref();
    this.idleOwnProcesses.set(conversationId, timer);
  }

  private stopIdleOwnProcess(conversationId: string) {
    this.idleOwnProcesses.delete(conversationId);
    const runtime = this.runtimes.get(conversationId);
    const busy = runtime?.running || runtime?.outsideTurn || runtime?.pendingPermissions.size || runtime?.queuedMessages.length;
    if (this.stopping || !runtime?.harness || busy || !this.isOwnProcess(conversationId, runtime.harness)) return;
    void this.killAgent(runtime.harness, { kind: "stopped" });
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
      !this.get(conversationId).startedBy &&
      !worksForARoom(this.get(conversationId));
    const carriedOnOtherwise = this.stopping || runtime.running || runtime.queuedMessages.length > 0 || (runtime.steerInFlight ?? false);
    if (!checked || carriedOnOtherwise) return;
    const followUp = canvasFollowUp({
      reply: turn.reply,
      ...canvasUseOf({
        startedAt: promptSent.sentAt,
        toolCalls: turn.toolCalls,
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
    {
      authorId,
      fromScript = false,
      fromMirador = false,
      fromPlugin,
      afterTurn = false,
      roomMessageId,
      broughtTaskId,
    }: { authorId?: string; fromScript?: boolean; fromMirador?: boolean; fromPlugin?: string; afterTurn?: boolean; roomMessageId?: string; broughtTaskId?: string } = {},
  ) {
    const fromUser = !fromScript && !fromMirador && !fromPlugin;
    if (fromUser && this.tookReminderCommand(conversationId, text)) return;
    if (fromUser && this.get(conversationId).reminder) this.setReminder(conversationId, null);
    const runtime = this.runtime(conversationId);
    const sendsAtOnce = !runtime.running && !this.holdsQueue(runtime) && runtime.queuedMessages.length === 0;
    if (sendsAtOnce) return this.prompt(conversationId, text, { imageIds, authorId, fromScript, fromMirador, fromPlugin, roomMessageId, broughtTaskId, startsTurn: true });
    const message: QueuedMessage = {
      id: crypto.randomUUID(),
      text,
      imageIds,
      ...(authorId && { authorId }),
      ...(fromScript && { fromScript }),
      ...(fromMirador && { fromMirador }),
      ...(fromPlugin && { fromPlugin }),
      ...(afterTurn && { afterTurn }),
      ...(roomMessageId && { roomMessageId }),
      ...(broughtTaskId && { broughtTaskId }),
    };
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
    const plan = await this.restoredWithNoVmAtWork(this.workspaceOf(conversationId), checkpoint);
    this.append(conversationId, { type: "revert", revertId: crypto.randomUUID(), toSeq: seq, ...plan });
    return plan;
  }

  /** The files back as the checkpoint keeps them, once no sandbox's VM works in them to race the restore. */
  private async restoredWithNoVmAtWork(workspace: Workspace, checkpoint: Parameters<Checkpoints["restore"]>[1]) {
    await this.sandboxes.stopSandboxesWorkingIn(workspace.path);
    return this.checkpoints.restore(workspace, checkpoint);
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
      if (!keepFiles && checkpoint && (await this.checkpoints.keeps(this.workspaceOf(conversationId), checkpoint))) await this.restoredWithNoVmAtWork(this.workspaceOf(conversationId), checkpoint);
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
   *
   * The session-defining fields ride along as the resume sends them: claude-agent-acp keeps its Claude Code process
   * when a resume asks for what the fork asked for, and starts another one when it doesn't (vcs-awsl9).
   */
  private async forkSessionAt(conversationId: string, point: string, atSteeredMessage: boolean) {
    const conversation = this.get(conversationId);
    const harness = this.harnessFor(conversation);
    this.runtime(conversationId).harness = harness;
    const capabilities = await harness.start();
    if (!capabilities.agentCapabilities?.sessionCapabilities?.fork) throw new HostProblemError({ code: "agent-cannot-go-back-in-session" });
    const sessionRequest = await this.sessionRequest(conversationId);
    const { sessionId } = await harness.forkSession({
      ...sessionRequest,
      sessionId: conversation.acpSessionId!,
      _meta: { ...sessionRequest._meta, ...forkPointMeta(point, atSteeredMessage) },
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

  /**
   * Continues before the usage limit's reset, e.g. after switching to a profile that signs in to another account. Asked
   * for by a person, the message to continue is theirs; one that continues by itself at the reset is nobody's.
   */
  continueAfterUsageLimit(conversationId: string, { automatically = false, authorId }: { automatically?: boolean; authorId?: string } = {}) {
    const runtime = this.runtime(conversationId);
    if (!runtime.usageLimit || this.stopping) return;
    runtime.automaticContinues = automatically ? runtime.automaticContinues + 1 : 0;
    this.prompt(conversationId, CONTINUE_AFTER_INTERRUPTION, { authorId }).catch(() => {});
  }

  /** The agent still holds the message its failed turn began with, so trying again asks it to continue, as the person who tries again. */
  tryAgainAfterError(conversationId: string, errorSeq: number, authorId?: string) {
    if (this.runtime(conversationId).running || this.stopping) return;
    if (!canTryAgain(this.store.listEventsFrom(conversationId, errorSeq), errorSeq)) return;
    this.prompt(conversationId, CONTINUE_AFTER_INTERRUPTION, { authorId }).catch(() => {});
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
    if (!wait) return;
    this.append(conversationId, { type: "job-wait-ended", wait, end: "stopped" });
    if (!this.runtime(conversationId).running) this.deliverOwedReply(conversationId);
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
    const waiting = newestWaitingAsk(this.store.listCanvasItems(conversationId));
    if (waiting) this.asksWaitedOn.set(conversationId, pendingAsk(waiting));
    else this.asksWaitedOn.delete(conversationId);
    if (this.store.hasConversation(conversationId)) this.publish(this.get(conversationId));
  }

  /**
   * Runs a `!` command from the message box where the conversation works, with the environment its agent gets. A
   * sandboxed conversation's would run on this computer, so it is not run.
   */
  async runCommand(conversationId: string, command: string, authorId?: string) {
    this.refuseCommandsInSandbox(this.get(conversationId));
    const environment = await profileEnvironmentOnceRead(this.profileOf(this.get(conversationId)));
    const conversation = this.get(conversationId);
    this.refuseCommandsInSandbox(conversation);
    const workspace = this.store.findWorkspace(conversation.workspaceId);
    if (!workspace) throw new HostProblemError({ code: "conversation-workspace-gone" });
    void this.commands.run(command, workingCopyOf(workspace, conversation).path, environment, (event) => this.append(conversationId, event), authorId);
  }

  private refuseCommandsInSandbox(conversation: Conversation) {
    if (this.sandboxOf(conversation)) throw new HostProblemError({ code: conversation.roomId ? "sandboxed-room-command" : "sandboxed-workspace-command" });
  }

  /** Claude Code's own panels and sign-in would run the agent on this computer, in the folder a sandboxed conversation's agents change. */
  private refuseAgentHereFor(conversation: Conversation) {
    if (this.sandboxOf(conversation)) throw new HostProblemError({ code: "sandboxed-agent-here" });
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

  setQueuedMessageAfterTurn(conversationId: string, messageId: string, afterTurn: boolean) {
    const switched = ({ afterTurn: _, ...message }: QueuedMessage): QueuedMessage => ({ ...message, ...(afterTurn && { afterTurn }) });
    this.replaceQueue(conversationId, (queue) => queue.map((message) => (message.id === messageId ? switched(message) : message)), messageId);
    if (!afterTurn) this.steerQueuedMessages(conversationId);
  }

  /** The agent's own sign-in, with the environment of the conversation's profile, so a profile with its own account signs that one in. */
  async loginProgram(conversationId: string, pageOnHost: boolean): Promise<TerminalProgram> {
    const conversation = this.get(conversationId);
    this.refuseAgentHereFor(conversation);
    const environment = await this.programEnvironment(conversation);
    return { tabName: `${harnessLabels[conversation.harness]} sign-in`, command: loginCommand(conversation.harness, environment, undefined, pageOnHost), environment, runsTheAgent: true };
  }

  /** A command Claude Code shows a panel for only in its own terminal, run in a tab of the conversation's terminals. */
  async panelCommandProgram(conversationId: string, line: string): Promise<TerminalProgram> {
    const command = panelCommandRun(line);
    if (command === null) throw new HostProblemError({ code: "not-a-slash-command", line });
    const conversation = this.get(conversationId);
    this.refuseAgentHereFor(conversation);
    if (conversation.harness !== "claude") throw new HostProblemError({ code: "agent-has-no-such-command", agent: harnessLabels[conversation.harness], line });
    const environment = await this.programEnvironment(conversation);
    return { tabName: command, command: [environment.CLAUDE_CODE_EXECUTABLE!, command], environment, key: `panel ${command}`, runsTheAgent: true };
  }

  /** Reading it may take a while, in which the conversation may have become a sandboxed one. */
  private async programEnvironment(conversation: Conversation) {
    const profile = this.profileOf(conversation);
    await profileEnvironmentOnceRead(profile);
    this.refuseAgentHereFor(this.get(conversation.id));
    return launchEnvironment(conversation.harness, profile, this.store.claudeProgramSetting());
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
    const carried = this.picturesUsedIn(conversationId);
    imageIds.filter((imageId) => !carried.has(imageId)).forEach((imageId) => this.images.delete(conversationId, imageId));
  }

  /** Pictures of drafts given up on, or of a message the host never took, go once they have gone unused for a month. */
  deleteUnusedPictures(now = Date.now()) {
    return this.images.deleteUnused((conversationId) => this.picturesUsedIn(conversationId), now - UNUSED_PICTURES_KEPT_MS);
  }

  private picturesUsedIn(conversationId: string) {
    const queued = this.runtimes.get(conversationId)?.queuedMessages ?? this.store.findConversation(conversationId)?.queuedMessages ?? [];
    return new Set([...this.store.sentImageIds(conversationId), ...queued.flatMap((message) => message.imageIds)]);
  }

  takeQueuedRoomPrompts(conversationId: string): { roomMessageId: string; authorId?: string }[] {
    const runtime = this.runtime(conversationId);
    const taken = runtime.queuedMessages.flatMap(({ roomMessageId, authorId }) => (roomMessageId ? [{ roomMessageId, ...(authorId && { authorId }) }] : []));
    if (taken.length === 0) return [];
    this.setQueue(conversationId, runtime, runtime.queuedMessages.filter(({ roomMessageId }) => !roomMessageId));
    this.publish(this.get(conversationId));
    return taken;
  }

  removeQueuedMessage(conversationId: string, messageId: string) {
    this.replaceQueue(conversationId, (queue) => queue.filter(({ id }) => id !== messageId), messageId);
    this.broughtTasks.settleLost(conversationId);
  }

  /** The stop reaches the process the turn runs on, which a sandbox turned on or off since no longer picks. */
  async cancel(conversationId: string, { force = false } = {}): Promise<void> {
    if (force) return this.forceCancel(conversationId);
    const runtime = this.runtime(conversationId);
    if (runtime.setupCommandId) this.commands.stop(runtime.setupCommandId);
    runtime.pendingPermissions.forEach(({ settle }) => settle(null));
    const conversation = this.get(conversationId);
    if (runtime.running && runtime.turn && !runtime.turn.promptSent) {
      runtime.turn.stoppedBeforePrompt = true;
      if (this.statusOverrides.get(conversationId)?.busyWith === "waiting-for-sandbox-folders") runtime.turn.stoppedWaitingForSandboxFolders = true;
      this.letHeldTurnGo(conversationId);
      return;
    }
    if (runtime.running && conversation.acpSessionId) {
      await this.awaitRecordedPrompt(conversation, runtime.turn);
      await (runtime.harness ?? this.harnessFor(conversation)).cancel(conversation.acpSessionId);
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
    let path: string | null = null;
    while (Date.now() < deadline) {
      path ??= await claudeTranscriptFile(this.claudeConfigDirOf(conversation), sessionId);
      if (path && userMessageTakenInAt(await claudeTranscriptEndAt(path), prompt.text, prompt.sentAt) !== null) return;
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
   * before its exit is noticed, which on Windows, where ending a process tree takes a while, it would. Its background
   * tasks end with the process, and once moved off it, its exit no longer finds the conversation to forget them for.
   */
  private moveIdleConversationsOff(harness: HarnessProcess) {
    this.agentProcesses.forEach((current, profileId) => {
      if (current === harness) this.agentProcesses.delete(profileId);
    });
    this.runtimes.forEach((runtime, conversationId) => {
      if (runtime.harness !== harness || runtime.running) return;
      runtime.harness = undefined;
      runtime.sessionId = undefined;
      this.forgetAsyncTasks(conversationId);
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

  /** Allows a waiting request with the agent's option that allows it once, or turns it down with its option that rejects it. */
  answerPermission(conversationId: string, permissionId: string, allowed: boolean) {
    const pending = this.runtime(conversationId).pendingPermissions.get(permissionId);
    if (!pending) throw new HostProblemError({ code: "permission-no-longer-pending" });
    pending.settle(allowed ? pending.allowOptionId : optionThatRejects(pending.request.options));
  }

  /** The permission requests the conversation's agent waits on, oldest first. */
  waitingPermissions(conversationId: string): WaitingPermission[] {
    return [...(this.runtimes.get(conversationId)?.pendingPermissions.values() ?? [])].map(({ request, asked, at }) => ({ request, asked, at }));
  }

  /** A room's changed preset reaches its agent's open session at once; a closed one takes it as it opens again. */
  async followRoomPreset(conversationId: string) {
    const sessionId = await this.runtimes.get(conversationId)?.sessionId?.catch(() => null);
    if (sessionId) await this.keepToRoomPreset(conversationId, sessionId);
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
    this.planQuotas.forget(profileId);
    this.antigravityQuotas.forget(profileId);
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
    this.jobWaits.startAll();
    this.store.listConversations().forEach(({ id, acpSessionId }) => {
      if (stoppedTurns.includes(id)) return void this.resumeStoppedTurn(id, acpSessionId).catch(() => {});
      this.broughtTasks.settleLost(id);
      const cutShort = this.turnsCutShortByCrash.has(id);
      this.turnsHeard.turnLost?.(id, cutShort);
      this.deliverOwedReply(id, cutShort ? "failed" : undefined);
      if (!this.resumeUsageLimitWait(id)) this.sendNextQueuedMessage(id);
    });
    this.announceWaiting();
  }

  shutdown() {
    this.stopping = true;
    clearTimeout(this.reminderTimer);
    this.jobWaits.stopAll();
    this.antigravityQuotas.stopAll();
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
    await this.worktrees.make(workspace, worktree, { ownersHooks: !this.hooksOffIn(workspace, worktree) });
    if (!this.store.hasConversation(conversation.id)) {
      await this.worktrees.remove(workspace, worktree);
      throw new HostProblemError({ code: "conversation-deleted-while-opening" });
    }
    if (!workspace.worktreeSetup) return;
    this.setBusy(conversation.id, "setting-up-worktree");
    const environment = { ...(await profileEnvironmentOnceRead(this.profileOf(conversation))), MIRADOR_WORKSPACE: workspace.path };
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
   * A conversation's own agent process, an Antigravity conversation's, a room's or a sandboxed workspace's, serves only
   * it, so it goes with the conversation or with the profile it moves off. With no profile left to name it by, as when
   * the conversation was deleted already, its id finds the key.
   */
  private stopDedicatedHarness(profileId: string | null, conversationId: string) {
    const keys = [...this.agentProcesses.keys()].filter((key) => this.isOwnProcessKey(key, conversationId) && (profileId === null || key.startsWith(`${profileId}/`)));
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
      this.broughtTasks.settleLost(conversationId);
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
    const broughtTaskId = request.broughtTaskId !== undefined && this.broughtTasks.stillToRun(request.broughtTaskId) ? request.broughtTaskId : undefined;
    return this.prompt(conversationId, continuation.text, { imageIds: continuation.imageIds, authorId: request.authorId, broughtTaskId });
  }

  /** The turn a stop cut short gets no message of the host's: it waits for the user, whose next one carries it on. */
  private letTheTurnRest(conversationId: string) {
    this.setStatus(conversationId, "idle");
    this.deliverOwedReply(conversationId);
    this.broughtTasks.settleLost(conversationId);
    this.sendNextQueuedMessage(conversationId);
  }

  private waitingAskAt(conversationId: string) {
    return newestWaitingAsk(this.store.listCanvasItems(conversationId))?.createdAt ?? null;
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

  /** A change of what its room or workspace gives its agents while the session opens is not what it was opened under. */
  private processToOpenOn(conversation: Conversation) {
    const runtime = this.runtime(conversation.id);
    runtime.openedUnder = this.sessionSetupOf(conversation);
    runtime.harness = this.harnessFor(conversation);
    return runtime.harness;
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
    const setupKept = this.keepsSessionSetup(conversation);
    const harness = this.processToOpenOn(conversation);
    const capabilities = await this.startedFor(conversationId, harness);
    const sessionRequest = await this.sessionRequest(conversationId);

    const canResume = Boolean(capabilities.agentCapabilities?.sessionCapabilities?.resume) && !replaysHistoryOnResume(conversation.harness);
    const canLoad = Boolean(capabilities.agentCapabilities?.loadSession);
    if (conversation.acpSessionId && (canResume || canLoad) && this.agentHasRecorded(conversationId) && setupKept) {
      try {
        const replay: acp.SessionNotification[] = [];
        const resumed = canResume
          ? await harness.resumeSession({ ...sessionRequest, sessionId: conversation.acpSessionId })
          : await this.loadWithoutReplay(harness, conversation.acpSessionId, sessionRequest, replay);
        this.assertRoomsWorkspaceModel(conversation, harness, conversation.acpSessionId, resumed);
        this.bindSession(conversationId, conversation.acpSessionId, resumed.configOptions);
        replay.filter(({ update }) => SESSION_STATE_UPDATES.has(update.sessionUpdate)).forEach((notification) => this.handleSessionUpdate(notification));
        await this.restoreConfigChoices(conversationId, conversation.acpSessionId, conversation.configOptions);
        if (conversation.sideChatOf) await this.followSideChatAccess(conversationId, conversation.acpSessionId);
        await this.keepToRoomPreset(conversationId, conversation.acpSessionId);
        await this.keepToRoomAgentModel(conversationId, conversation.acpSessionId);
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
    this.assertRoomsWorkspaceModel(conversation, harness, created.sessionId, created);
    this.muteNotifier(conversation, created.sessionId);
    this.bindSession(conversationId, created.sessionId, created.configOptions);
    runtime.roomContextLost = Boolean(conversation.roomId) && (!isFirstSession || this.contextClearedBefore(conversationId));
    await this.restoreConfigChoices(conversationId, created.sessionId, setupKept ? conversation.configOptions : choicesBesideMode(conversation.configOptions));
    if (conversation.sideChatOf) await this.applySideChatMode(conversationId, created.sessionId);
    else await this.applyNewSessionChoices(conversation, created.sessionId, { isFirstSession, setupKept });
    await this.keepToRoomPreset(conversationId, created.sessionId);
    await this.keepToRoomAgentModel(conversationId, created.sessionId);
    runtime.startChoices = undefined;
    if (isFirstSession && conversation.harness === "pi" && !conversation.sideChatOf) this.offerNewerPi(conversationId, harness).catch(() => {});
    return created.sessionId;
  }

  /**
   * Says so when a newer pi is out than the one the agent runs, with the command that updates that pi. Only a
   * conversation nothing has happened in yet hears of it: in one under way, the notice would land in the middle of a reply.
   */
  private async offerNewerPi(conversationId: string, harness: HarnessProcess) {
    const program = harness.spec.environment.PI_ACP_PI_COMMAND;
    if (!this.config.piReleaseUrl || !program) return;
    const newer = await newerPiThan(program, harness.spec.environment, this.config.piReleaseUrl);
    if (!newer || !this.store.hasConversation(conversationId)) return;
    if (this.runtime(conversationId).running || hasBegun(this.store.listEvents(conversationId))) return;
    const shell = commandShell(loginShell, profileEnvironment(this.profileOf(this.get(conversationId))));
    this.append(conversationId, { type: "update-available", harness: "pi", ...newer, command: shellInvocation(shell, [program, "update"]) });
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

  /** Refuses an isolated opencode session that fell back to another provider's model. */
  private assertRoomsWorkspaceModel(
    conversation: Conversation,
    harness: HarnessProcess,
    sessionId: string,
    session: { configOptions?: acp.SessionConfigOption[] | null; models?: { currentModelId?: string; availableModels?: { modelId: string }[] } | null },
  ) {
    if (!conversation.worksInRoomsWorkspace || conversation.harness !== "opencode") return;
    try {
      assertOpencodeModelAvailable(harness.spec.environment[OPENCODE_EXPECTED_MODEL_ENV], session);
    } catch (error) {
      harness.closeSession(sessionId).catch(() => {});
      throw error;
    }
  }

  /** Replayed history arrives as session updates before the load request returns, so the session is bound first. */
  private async loadExternalSession(conversationId: string, sessionId: string, mode: AdoptMode, forkPoint: SessionForkPoint | null): Promise<string> {
    const conversation = this.get(conversationId);
    const harness = this.processToOpenOn(conversation);
    const capabilities = await harness.start();
    if (!capabilities.agentCapabilities?.loadSession) throw new HostProblemError({ code: "agent-cannot-load-sessions", agent: harness.spec.label });
    if (mode === "fork" && !capabilities.agentCapabilities.sessionCapabilities?.fork) throw new HostProblemError({ code: "agent-cannot-fork-sessions", agent: harness.spec.label });
    this.setBusy(conversationId, "loading-history");
    const sessionRequest = await this.sessionRequest(conversationId);
    const loadedId =
      mode === "fork"
        ? (await harness.forkSession({ ...sessionRequest, sessionId, ...(forkPoint && { _meta: { ...sessionRequest._meta, ...forkPointMeta(forkPoint.messageId) } }) })).sessionId
        : sessionId;
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
    this.assertRoomsWorkspaceModel(conversation, harness, loadedId, loaded);
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
    const harness = this.processToOpenOn(conversation);
    const capabilities = await harness.start();
    if (!capabilities.agentCapabilities?.loadSession) throw new HostProblemError({ code: "agent-cannot-load-sessions", agent: harness.spec.label });
    this.setBusy(conversationId, "reading-terminal-turns");
    const replay: acp.SessionNotification[] = [];
    this.replaysBeingRead.set(sessionId, replay);
    try {
      const loaded = await harness.loadSession({ ...(await this.sessionRequest(conversationId)), sessionId });
      this.assertRoomsWorkspaceModel(conversation, harness, sessionId, loaded);
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

  /** The canvas tools that only show things in Mirador run without asking; for a room, the room's own tools and its enabled plugins' tools. */
  private preAllowsCanvasTool(conversationId: string, tool: string | null) {
    const conversation = this.get(conversationId);
    if (conversation.worksInRoomsWorkspace) return tool !== null && (ROOMS_WORKSPACE_CANVAS_TOOLS.includes(tool) || this.canvasPlugins(conversationId).toolNames.includes(tool));
    if (worksForARoom(conversation)) return tool !== null && (ROOM_CANVAS_TOOLS.includes(tool) || this.canvasPlugins(conversationId).toolNames.includes(tool));
    return isPreAllowedCanvasTool(tool, this.canvasPlugins(conversationId).toolNames);
  }

  /** A test host's own Claude Code works without the settings and instructions of the user who runs the tests. */
  private async sessionRequest(conversationId: string) {
    const conversation = this.get(conversationId);
    if (conversation.worksInRoomsWorkspace) assertWorksInRoomsWorkspaces(conversation.harness);
    const withoutUserSettings = this.config.testSkipsUserSettings && this.onUsersOwnSetup(conversation);
    const canvasUse = this.store.canvasUse();
    const canvasPlugins = this.canvasPlugins(conversationId);
    const systemPrompt = sessionSystemPrompt(conversation.harness, canvasUse, canvasPlugins);
    const profile = conversation.profileId === null ? undefined : this.store.findProfile(conversation.profileId);
    const idleCompaction = profile?.idleCompaction !== false;
    const keepCacheWarm = profile?.keepCacheWarm === true;
    const claudeSetup = conversation.roomId ? (this.store.findRoom(conversation.roomId)?.claudeSetup ?? ALL_OF_CLAUDE_SETUP) : ALL_OF_CLAUDE_SETUP;
    const cwd = await recordedDirectory(this.workspaceOf(conversationId));
    if (!this.runsInSandbox(conversation)) await this.sandboxes.settleHeldFilesFor(cwd);
    const sandbox = this.sessionSandboxOf(conversation);
    const folders = sandbox?.folders ?? [];
    const additionalDirectories = folders.length > 0 && (await this.currentProcessOf(conversation)?.takesAdditionalDirectories()) ? folders.map(({ path }) => path) : [];
    return {
      cwd,
      mcpServers: [this.runsInSandbox(conversation) ? this.canvasServerFor(conversationId, sandboxCanvasAddress(conversationId)) : this.canvasServerFor(conversationId)],
      _meta: sessionMeta(conversation.harness, canvasUse, {
        canvasAssetsOrigin: this.config.canvasAssetsOrigin,
        withoutUserSettings,
        canvasPlugins,
        idleCompaction,
        keepCacheWarm,
        inRoom: worksForARoom(conversation),
        inRoomsWorkspace: conversation.worksInRoomsWorkspace === true,
        claudeSetup,
        keptProtections: await this.claudeProtectionsKept(conversation, settingSourcesLeftOut(claudeSetup, withoutUserSettings), cwd),
        sandbox,
      }),
      ...(systemPrompt && { systemPrompt }),
      ...(additionalDirectories.length > 0 && { additionalDirectories }),
    };
  }

  /** The sandbox the conversation's agent runs in, with the folders of this computer its VM mounted beside its workspace. */
  private sessionSandboxOf(conversation: Conversation): SessionInSandbox | null {
    if (!this.runsInSandbox(conversation)) return null;
    const sandbox = this.sandboxOf(conversation);
    return { folders: sandbox ? this.sandboxes.mountedFolders(sandbox.owner) : [] };
  }

  /** A room's Claude Code session keeps the deny and ask rules and the sandbox of the settings it leaves out. */
  private async claudeProtectionsKept(conversation: Conversation, leftOut: SettingSource[], cwd: string) {
    if (!conversation.roomId || conversation.harness !== "claude" || leftOut.length === 0) return NO_PROTECTIONS;
    return protectionsKept(leftOut, await settingsFiles(this.claudeConfigDirOf(conversation), cwd));
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
    const runtime = this.runtime(conversationId);
    this.sessions.bind(conversationId, sessionId);
    runtime.cancelledReply = undefined;
    this.save({ ...this.get(conversationId), acpSessionId: sessionId, configOptions: configOptions ?? [] });
    this.store.setSetupOfSession(conversationId, runtime.openedUnder ?? null);
    this.updatesForUnknownSessions.take(sessionId).forEach((notification) => this.handleSessionUpdate(notification));
  }

  /** Claude Code resumes a session on the model that answered last, but claude-agent-acp moves it to the model the settings name. */
  private async restoreTranscriptModel(conversationId: string, sessionId: string, recordedSessionId: string) {
    const model = lastAnsweringModel(await claudeTranscript(this.claudeConfigDirOf(this.get(conversationId)), recordedSessionId));
    const choice = model && modelChoiceFor(this.get(conversationId).configOptions, model);
    if (choice) await this.trySetConfigOption(conversationId, sessionId, "model", choice);
  }

  /** A sandbox's agents keep their Claude Code config in a folder of their room's or workspace's, which their VM is given. */
  private claudeConfigDirOf(conversation: Conversation) {
    const sandbox = this.sandboxOf(conversation);
    if (sandbox) return sandboxConfigFolder(this.config.dataDir, sandbox.owner, "claude");
    const profile = conversation.profileId === null ? undefined : this.store.findProfile(conversation.profileId);
    return claudeConfigDir(profileEnvironment(profile ?? null, profile && this.environmentGivenTo(conversation, profile)));
  }

  /**
   * A room's agent gets the environment its room gives it, or, its room gone, what a room gives by default. A sandboxed
   * workspace's agent gets what a room gives by default: of this computer's own environment, only what every program needs.
   */
  private environmentGivenTo(launch: ProcessLaunch, profile: Profile): EnvironmentGiven | undefined {
    const choices = launch.roomId ? this.environmentChoicesOf(launch.roomId, profile.id) : this.inSandboxedWorkspace(launch) ? NO_ENVIRONMENT_CHOICES : null;
    return choices ? (host, environment) => environmentInRoom(profile.harness, host, environment, choices) : undefined;
  }

  /** This computer's whole environment never goes into a sandboxed room's VM, whatever the room's agent was given. */
  private environmentChoicesOf(roomId: string, profileId: string): EnvironmentChoices {
    const room = this.store.findRoom(roomId);
    const agent = room?.agents.find((each) => each.profileId === profileId);
    return agent ? { variables: agent.variables, wholeHostEnvironment: agent.wholeHostEnvironment && !room!.sandbox.on } : NO_ENVIRONMENT_CHOICES;
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

  /**
   * A conversation takes its profile's mode and effort when it starts with the profile or moves to it; after that its own
   * choice stands. A room's conversation takes its room's mode instead, where the agent has one for the room's preset.
   */
  private async applyProfileChoices(conversationId: string, sessionId: string) {
    const profile = await this.applyStartingMode(conversationId, sessionId);
    const effortOption = this.get(conversationId).configOptions.find(({ category }) => category === "thought_level");
    if (profile?.effort && effortOption && offersValue(effortOption, profile.effort)) {
      await this.trySetConfigOption(conversationId, sessionId, effortOption.id, profile.effort);
    }
  }

  /** Sets the mode the session starts in, as `startingModeOf` says; returns the conversation's profile. */
  private async applyStartingMode(conversationId: string, sessionId: string) {
    const conversation = this.get(conversationId);
    const profile = conversation.profileId === null ? undefined : this.store.findProfile(conversation.profileId);
    const mode = this.startingModeOf(conversation, profile);
    const modeOption = conversation.configOptions.find(({ category }) => category === "mode");
    if (mode && modeOption) await this.trySetConfigOption(conversationId, sessionId, modeOption.id, mode);
    return profile;
  }

  /**
   * Its sandbox's or room's mode, else its profile's. A sandbox's agents can write the Claude Code settings its sessions
   * start from, so a sandboxed session whose profile names no mode is set to the one that asks all the same, and no
   * default mode they planted there holds.
   */
  private startingModeOf(conversation: Conversation, profile: Profile | undefined) {
    const sandboxDefault = this.sandboxOf(conversation) ? askingDefaultModeOf(conversation.harness) : null;
    return this.sandboxOrRoomMode(conversation) ?? this.profileModeFor(conversation, profile) ?? sandboxDefault;
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
   * out on them, though for no longer than `startChoicesTimeoutMs` in all. One that replaces a session started under
   * another setup, in a sandbox or out of one, takes its starting mode rather than the mode that session had.
   */
  private async applyNewSessionChoices(conversation: Conversation, sessionId: string, { isFirstSession, setupKept }: { isFirstSession: boolean; setupKept: boolean }) {
    const { id } = conversation;
    const test = this.onUsersOwnSetup(conversation) ? this.config.testModelOverride : {};
    const chosen = this.runtime(id).startChoices ?? {};
    const holdUntil = Date.now() + this.startChoicesTimeoutMs;
    if (isFirstSession) await this.applyProfileModel(id, sessionId, holdUntil);
    if (test.model) await this.trySetConfigOption(id, sessionId, "model", test.model);
    if (chosen.model) await this.applyChosenModel(id, sessionId, chosen.model, holdUntil);
    if (isFirstSession) await this.applyProfileChoices(id, sessionId);
    else if (!setupKept) await this.applyStartingMode(id, sessionId);
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

  private canvasServerFor(conversationId: string, url = `${this.config.appOrigin}/mcp/${conversationId}`): acp.McpServer {
    return {
      type: "http",
      name: CANVAS_SERVER_NAME,
      url,
      headers: [{ name: "Authorization", value: `Bearer ${conversationCanvasToken(this.config.mcpToken, conversationId)}` }],
    };
  }

  private harnessFor(launch: ProcessLaunch): HarnessProcess {
    const profile = this.profileOf(launch);
    const key = this.processKeyOf(profile, launch);
    const existing = this.agentProcesses.get(key);
    if (existing) return existing;
    const spec = harnessSpec(profile, this.store.claudeProgramSetting(), this.environmentGivenTo(launch, profile));
    const lockForRoomsWorkspace = this.roomsWorkspaceEnvironment(launch, profile);
    const onThisComputer = withEnvironment(spec, (environment) =>
      lockForRoomsWorkspace({ ...environment, ...this.scriptEnvironmentFor(launch, environment.PATH), ...this.testModelEnvironment(launch) }),
    );
    const mayBeSandboxed = launch.roomId !== undefined || this.inSandboxedWorkspace(launch);
    const harness: HarnessProcess = new HarnessProcess(
      mayBeSandboxed
        ? { ...onThisComputer, launching: (environment) => this.sandboxedAgentLaunch(harness, launch, profile, { command: onThisComputer.command, environment }) }
        : onThisComputer,
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

  /**
   * A room's agent starts in its room's sandbox while the room has one, and a sandboxed workspace's in the workspace's, as
   * decided the moment it starts, so a sandbox turned on meanwhile is never missed. One that can't start there fails its
   * turn; it never starts on this computer. A sandboxed workspace's process never does at all: one whose workspace had
   * its sandbox turned off as it started fails too, and the conversation's next turn starts on a process of this computer.
   * An agent brought into someone else's room never starts beside the workspace's own conversations in its sandbox.
   */
  private async sandboxedAgentLaunch(harness: HarnessProcess, launch: ProcessLaunch, profile: Profile, onThisComputer: AgentLaunch): Promise<AgentLaunch> {
    this.sandboxStarts.delete(harness);
    this.startedOnThisComputer.delete(harness);
    if (launch.roomId && !this.store.findRoom(launch.roomId)) throw new HostProblemError({ code: "room-gone" });
    const sandbox = this.sandboxOf(launch);
    if (!sandbox && !launch.roomId) throw new HostProblemError({ code: "workspace-sandbox-turned-off" });
    if (sandbox && (launch.broughtIntoRoom || launch.worksInRoomsWorkspace)) throw new HostProblemError({ code: "brought-agent-in-sandboxed-workspace" });
    if (!sandbox) {
      this.startedOnThisComputer.add(harness);
      return onThisComputer;
    }
    const launching = this.agentInSandbox(sandbox, launch, profile, onThisComputer).then((agent) => this.sandboxes.launch(agent, (step) => this.tellSandboxStart(harness, step)));
    const launched = await launching
      .catch((error: unknown) => {
        throw sandbox.owner.kind === "workspace" && error instanceof SandboxNotReady ? new HostProblemError({ code: "workspace-sandbox-not-ready", why: error.why }) : error;
      })
      .finally(() => this.sandboxStartSteps.delete(harness));
    const start = {};
    this.sandboxStarts.set(harness, start);
    return {
      ...launched,
      gone: () => {
        if (this.sandboxStarts.get(harness) === start) this.sandboxStarts.delete(harness);
        launched.gone?.();
      },
    };
  }

  private tellSandboxStart(harness: HarnessProcess, step: SandboxStartStep) {
    this.sandboxStartSteps.set(harness, step);
    this.waitingForProcess.get(harness)?.forEach((conversationId) => this.setBusy(conversationId, step));
  }

  /**
   * The agent's process, started: a conversation waiting for it says meanwhile what a sandbox starting for it waits for,
   * a conversation that joins the wait part-way through too, and goes back to what it was doing once it started.
   */
  private async startedFor(conversationId: string, harness: HarnessProcess) {
    const waiting = this.waitingForProcess.get(harness) ?? new Set<string>();
    this.waitingForProcess.set(harness, waiting.add(conversationId));
    const step = this.sandboxStartSteps.get(harness);
    if (step) this.setBusy(conversationId, step);
    try {
      return await harness.start();
    } finally {
      waiting.delete(conversationId);
      if (waiting.size === 0 && this.waitingForProcess.get(harness) === waiting) this.waitingForProcess.delete(harness);
      if (this.showsSandboxStart(conversationId)) this.setStatus(conversationId, this.runtime(conversationId).running ? "starting" : "idle");
    }
  }

  private showsSandboxStart(conversationId: string) {
    const busyWith = this.statusOverrides.get(conversationId)?.busyWith;
    return busyWith === "preparing-sandbox" || busyWith === "starting-sandbox";
  }

  /** A sandbox sees its workspace's folder alone, so a workspace's conversation that works in a worktree of its own can't start in it. */
  private async agentInSandbox({ owner, setting }: ConversationSandbox, launch: ProcessLaunch, profile: Profile, { command, environment }: AgentLaunch): Promise<AgentInSandbox> {
    const model = modelInSandbox(profile, launch.roomId ? this.environmentChoicesOf(launch.roomId, profile.id) : NO_ENVIRONMENT_CHOICES, environment);
    if ("blocker" in model) throw new SandboxNotReady({ kind: "blocked", blocker: model.blocker });
    if (owner.kind === "workspace" && launch.id && this.get(launch.id).worktree) throw new SandboxNotReady({ kind: "blocked", blocker: { kind: "conversation-in-worktree" } });
    const { harness } = model.kind;
    const version = await agentVersionIn(harness, environment);
    if (!version) throw new SandboxNotReady({ kind: "no-agent-version", harness });
    const workspace = launch.id ? this.workspaceOf(launch.id) : this.existingWorkspace(this.store.findRoom(owner.id)?.workspaceId ?? "");
    return {
      owner,
      allowsSharedKernel: setting.allowsSharedKernel,
      profileId: profile.id,
      kind: model.kind,
      version,
      workingDirectory: await recordedDirectory(workspace),
      given: environment,
      route: model.route,
      agent: [BUN_IN_VM, ...command.slice(1)],
    };
  }

  /** Locks an agent process down when its conversation works in a room's workspace on another machine. */
  private roomsWorkspaceEnvironment(launch: ProcessLaunch, profile: Profile): (environment: Record<string, string>) => Record<string, string> {
    if (!launch.worksInRoomsWorkspace) return (environment) => environment;
    if (profile.harness === "pi") {
      const isolatedDir = join(this.config.dataDir, "brought-agents-config", "pi", launch.id ?? profile.id);
      return (environment) => piRoomsWorkspaceEnvironment(environment, isolatedDir, profile.model);
    }
    if (profile.harness === "opencode") {
      const isolatedDir = join(this.config.dataDir, "brought-agents-config", "opencode", launch.id ?? profile.id);
      return (environment) => opencodeRoomsWorkspaceEnvironment(environment, isolatedDir, profile.model);
    }
    return (environment) => environment;
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

  /**
   * A room's agent works on tasks of people other than the owner too, and a sandboxed workspace's is kept from this
   * computer, so neither gets a token to reach the host with as the owner's scripts do.
   */
  private scriptEnvironmentFor(launch: ProcessLaunch, path: string | undefined) {
    return worksForARoom(launch) || this.inSandboxedWorkspace(launch) ? {} : this.scriptEnvironment(path);
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
      if (quotas) this.planQuotas.record(this.get(conversationId).profileId, quotas, Date.now());
      this.publish(this.get(conversationId));
      return;
    }
    if (update.sessionUpdate === "config_option_update") {
      this.save({ ...this.get(conversationId), configOptions: update.configOptions });
    }
    if (update.sessionUpdate === "session_info_update" && update.title && !this.get(conversationId).titleSetByUser) {
      this.save({ ...this.get(conversationId), title: shownSessionTitle(this.get(conversationId).title, update.title) });
    }
    if (this.runtimes.get(conversationId)?.outsideTurn?.shown === false && !SESSION_STATE_UPDATES.has(update.sessionUpdate)) return;
    if (this.dropsCancelledReplyChunk(conversationId, update)) return;
    if (this.handledAntigravityNoticeOutsideTurn(conversationId, update)) return;
    if (isTurnsOwnToolCall(update)) this.showHeldBackReply(conversationId);
    this.trackReplyProgress(conversationId, update);
    this.append(conversationId, { type: "acp", update: this.withModeName(conversationId, update) });
    if (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update") this.runtime(conversationId).toolCallReportsHeard.heard(update.toolCallId);
    this.followToolCalls(conversationId, update);
  }

  /** What Mirador saw of the turn itself, whatever the agent reports of its tokens. */
  private measuredTurn(conversationId: string, turn: TurnInProgress): TurnSpend {
    const reported = this.contextUsage.get(conversationId);
    return {
      ...(turn.promptSent && { startedAt: turn.promptSent.sentAt }),
      toolCalls: turn.toolCalls.length,
      ...(reported && reported.size > 0 && { context: { used: reported.used, size: reported.size } }),
      ...(reported?.cost && { costSoFar: reported.cost }),
    };
  }

  private filesEditedSince(conversationId: string, turnSeq: number | undefined): Pick<TurnSpend, "filesEdited"> {
    const filesEdited = turnSeq === undefined ? 0 : agentEditsIn(this.store.listEventsFrom(conversationId, turnSeq)).length;
    return filesEdited > 0 ? { filesEdited } : {};
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
      const profile = this.profileOf(conversation);
      copilotHome = copilotHomeOf(profileEnvironment(profile, this.environmentGivenTo(conversation, profile)));
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

  /** Antigravity's ACP server does not report plan quotas in usage_update, so Mirador reads them with `agy -p /usage --output-format json`. */
  private refreshAntigravityQuotas(conversationId: string, force: boolean, now = Date.now()) {
    if (this.stopping || !this.store.hasConversation(conversationId)) return;
    const conversation = this.get(conversationId);
    if (conversation.harness !== "antigravity") return;
    let profile: Profile | undefined;
    let given: ReturnType<ConversationService["environmentGivenTo"]>;
    try {
      profile = this.profileOf(conversation);
      given = this.environmentGivenTo(conversation, profile);
    } catch {
      return;
    }
    const claudeProgram = this.store.claudeProgramSetting();
    const hasExpiredWindow = this.planQuotas.hasExpiredWindow(conversation.profileId, now);
    this.antigravityQuotas.refresh(
      conversation.profileId,
      conversationId,
      async (signal) => {
        let environment: Record<string, string>;
        try {
          if (profile) await profileEnvironmentOnceRead(profile);
          environment = launchEnvironment("antigravity", profile, claudeProgram, given);
        } catch {
          return null;
        }
        const program = environment.AGY_PATH;
        if (!program) return null;
        return readAntigravityQuotas(program, environment, { signal });
      },
      { force, hasExpiredWindow },
    );
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

  /**
   * Antigravity goes on outside a turn when a background task's end, a schedule or a subagent wakes it, and reports
   * a quota or model error as one agent_message_chunk. Arm the usage limit wait when none is running, and keep late
   * notices from showing as agent messages under the usage limit line.
   */
  private handledAntigravityNoticeOutsideTurn(conversationId: string, update: acp.SessionUpdate) {
    const runtime = this.runtime(conversationId);
    if (runtime.running && runtime.turn && !runtime.turn.ended) return false;
    if (this.get(conversationId).harness !== "antigravity") return false;
    if (update.sessionUpdate !== "agent_message_chunk" || update.content.type !== "text" || isInformational(update._meta)) return false;
    const quota = antigravityQuotaNoticeIn(update.content.text);
    if (quota) {
      if (quota.before.trim().length > 0) this.append(conversationId, { type: "acp", update: { ...update, content: { type: "text", text: quota.before } } });
      const resetsAt = usageLimitResetIn(quota.notice);
      if (runtime.usageLimit) {
        if (runtime.usageLimit.wait.resetsAt === null && resetsAt !== null) {
          this.endUsageLimitWait(runtime);
          this.waitForUsageLimitReset(conversationId, resetsAt);
          this.republish(conversationId);
        }
        return true;
      }
      const failure = this.recordUsageLimit(conversationId, { message: quota.notice }, false, {});
      this.notifyTurnEnded(conversationId, failure);
      this.republish(conversationId);
      this.refreshAntigravityQuotas(conversationId, true);
      return true;
    }
    const errorReply = antigravityErrorReplyIn({ stopReason: "end_turn", lastChunk: update.content.text }, "antigravity");
    if (errorReply === null) return false;
    if (!runtime.usageLimit) {
      const authRequired = isAntigravityAuthError(errorReply);
      this.append(conversationId, { type: "error", message: errorReply, ...(authRequired && { authRequired: true as const }), endsTurn: true });
      this.notifyTurnEnded(conversationId, { error: errorReply });
    }
    return true;
  }

  /** Which reply the running turn has streamed, so its stop can tell a late chunk of it from the next turn's, and how that reply ends since the turn's last tool call. */
  private trackReplyProgress(conversationId: string, update: acp.SessionUpdate) {
    const turn = this.runtime(conversationId).turn;
    if (!turn || turn.ended) return;
    if (isTurnsOwnToolCall(update)) {
      turn.reply = "";
      turn.lastMessage = "";
      turn.lastChunk = "";
      turn.toolCalls.push({ at: Date.now(), canvasTool: canvasToolName(toolNameOf(update)) });
    }
    if (!isAgentReplyChunk(update) || isSubagentReport(update)) return;
    turn.awaitedUser = false;
    if (typeof update.messageId === "string") {
      if (update.messageId !== turn.lastReplyMessageId) turn.lastMessage = "";
      turn.lastReplyMessageId = update.messageId;
    }
    if (update.sessionUpdate === "agent_thought_chunk") turn.lastChunk = "";
    if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text" && !isInformational(update._meta)) {
      turn.reply += update.content.text;
      turn.lastMessage += update.content.text;
      if (update.content.text) turn.lastChunk = update.content.text;
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
   * running command to the background, and a question or permission prompt the agent waits on with it. Its subagents
   * and their calls don't count: Claude Code moves a subagent the agent waits for to the background, where it keeps
   * running, and claude-agent-acp holds the turn open for the subagents it started.
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
    const toldAccess = runtime.sideChatAccessToTell;
    const switchWords = sideChatSwitchWords(runtime);
    this.showHeldBackReply(conversationId);
    runtime.steerInFlight = true;
    const outcome = await this.promptContent(conversationId, withNotes(notes, text), imageIds)
      .then((prompt) => harness.steer(sessionId, [...switchWords, ...prompt]))
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
    if (runtime.sideChatAccessToTell === toldAccess) runtime.sideChatAccessToTell = undefined;
    const seqs = [this.appendUserMessage(conversationId, first, notes), ...rest.map((message) => this.appendUserMessage(conversationId, message, NO_NOTES))];
    const steered = { sessionId, steeredAt, messages, seqs: seqs.filter((seq) => seq !== undefined), commandIds: notes.commands.map(({ commandId }) => commandId) };
    if (turn && !turn.ended) return void turn.steered.push(steered);
    await this.returnUnansweredSteers(conversationId, runtime, [steered]);
    this.sendNextQueuedMessage(conversationId);
  }

  private oldestOwnToolCall({ openToolCalls }: Runtime) {
    const toolCallId = openToolCalls.oldestOfMainAgentStartingNoSubagent();
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

  /** The canvas takes back a conversation's open questions, telling any tool call that waits on one. */
  withdrawsQuestionsWith(withdrawQuestions: (conversationId: string) => void) {
    this.withdrawQuestions = withdrawQuestions;
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

  /** A room's agent on a fresh session after one it was cleared of, as a change of what its room gives it does, lost all it was told there. */
  private contextClearedBefore(conversationId: string) {
    return this.store.listEventsOfTypes(conversationId, ["context-cleared"]).length > 0;
  }

  private takeRoomContextLost(runtime: Runtime) {
    const lost = runtime.roomContextLost === true;
    runtime.roomContextLost = undefined;
    return lost;
  }

  /** What a side chat's agent hears ahead of a message that starts a turn: its brief with the first question, later what it was switched to since it last heard. */
  private takeSideChatWords(conversationId: string): acp.ContentBlock[] {
    const runtime = this.runtime(conversationId);
    const handover = runtime.sideChatHandover;
    const words = handover ? [textBlock(sideChatBrief(handover.conversation, this.get(conversationId).sideChatMayChangeFiles === true))] : sideChatSwitchWords(runtime);
    runtime.sideChatHandover = undefined;
    runtime.sideChatAccessToTell = undefined;
    return words;
  }

  private async promptContent(conversationId: string, text: string, imageIds: string[]): Promise<acp.ContentBlock[]> {
    const images = await Promise.all(imageIds.map((imageId) => this.images.contentBlock(conversationId, imageId)));
    const conversation = this.get(conversationId);
    const endsInMiradorsWords = worksForARoom(conversation) && readsFilesNamedInLastBlock(conversation.harness);
    return [{ type: "text", text }, ...images, ...(endsInMiradorsWords ? [{ type: "text" as const, text: END_OF_OTHERS_WORDS }] : [])];
  }

  private async handlePermissionRequest(
    request: acp.RequestPermissionRequest,
    signal: AbortSignal,
  ): Promise<acp.RequestPermissionResponse> {
    const conversationId = this.sessions.conversationOf(request.sessionId);
    if (!conversationId) return { outcome: { outcome: "cancelled" } };
    if (this.runtimes.get(conversationId)?.outsideTurn) return turnedDown(request.options);
    const allowOptionId = optionThatAllows(request.options);
    if (allowOptionId && this.approvesEverything(this.get(conversationId))) {
      return { outcome: { outcome: "selected", optionId: allowOptionId } };
    }
    const reports = this.store.toolCallReports(conversationId, request.toolCall.toolCallId);
    if (allowOptionId && this.preAllowsCanvasTool(conversationId, canvasToolAskedFor(request.toolCall, reports))) {
      return { outcome: { outcome: "selected", optionId: allowOptionId } };
    }
    if (isToReadOnly(this.get(conversationId)) || this.get(conversationId).worksInRoomsWorkspace) return turnedDown(request.options);
    const runtime = this.runtime(conversationId);
    const askedAbout = this.toolCallAskedAbout(conversationId, request.toolCall, signal).then(async (toolCall) => ({ toolCall, edits: await this.editsAskedFor(conversationId, toolCall) }));
    const inArrivalOrder = (runtime.permissionArriving ?? Promise.resolve()).then(() => askedAbout);
    runtime.permissionArriving = inArrivalOrder;
    const { toolCall, edits } = await inArrivalOrder;
    if (signal.aborted || !this.store.hasConversation(conversationId)) return { outcome: { outcome: "cancelled" } };
    // YOLO switched on while the files were read approves only the requests already waiting.
    if (allowOptionId && this.approvesEverything(this.get(conversationId))) return { outcome: { outcome: "selected", optionId: allowOptionId } };
    if (isToReadOnly(this.get(conversationId))) return turnedDown(request.options);
    const kindSeenBefore = runtime.openToolCalls.kindOf(request.toolCall.toolCallId);
    const asked = askedPermissionOf(toolCall, kindSeenBefore);
    const conversation = this.get(conversationId);
    const { roomId } = conversation;
    const allowedByItself = this.worksFreelyInSandbox(conversation) || (roomId !== undefined && this.roomRules.allowsByItself(conversationId, asked));
    if (allowOptionId && allowedByItself) return { outcome: { outcome: "selected", optionId: allowOptionId } };
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
        if (roomId) this.roomRules.waitingChanged(roomId);
        resolve(optionId ? { outcome: { outcome: "selected", optionId } } : { outcome: { outcome: "cancelled" } });
      };
      runtime.pendingPermissions.set(permissionId, { settle, allowOptionId, request: pendingPermission(permissionId, asked, { toolCall, options: request.options }), asked, at: Date.now() });
      this.publish(this.get(conversationId));
      if (roomId) this.roomRules.waitingChanged(roomId);
      signal.addEventListener("abort", () => settle(null), { once: true });
    });
  }

  /** The tool call a permission asks about, with what the agent reported of it, once the agent has reported an edit's input. */
  private async toolCallAskedAbout(conversationId: string, requested: acp.ToolCallUpdate, signal: AbortSignal) {
    const reported = () => withReportedToolCall(requested, this.store.toolCallReports(conversationId, requested.toolCallId));
    const giveUpAt = Date.now() + EDIT_REPORT_WAIT_MS;
    let toolCall = reported();
    while (awaitsItsInput(toolCall) && Date.now() < giveUpAt && !signal.aborted) {
      await this.runtime(conversationId).toolCallReportsHeard.next(requested.toolCallId, giveUpAt - Date.now(), signal);
      toolCall = reported();
    }
    return toolCall;
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
    if (runtime.outsideTurn) return "the queue waits for Mirador's keep-alive or idle compaction to be answered";
    return null;
  }

  /** Returns the failure, as a notification tells it. */
  private recordTurnFailure(conversationId: string, error: unknown, promptSent: boolean, spent: TurnSpend): TurnFailure {
    const conversation = this.store.findConversation(conversationId);
    if (conversation && isUsageLimitError(error, conversation.harness)) return this.recordUsageLimit(conversationId, usageLimitMessage(error), promptSent, spent);
    const failure = { message: errorMessage(error), ...problemOf(error) };
    this.append(conversationId, { type: "error", ...failure, ...(promptSent && { continuable: true as const }), ...(isAuthRequiredError(error) && { authRequired: true as const }), endsTurn: true, ...spent });
    return { error: failure.message, ...problemOf(error) };
  }

  /** Returns the failure, as a notification tells it. A turn the agent's usage limit stopped holds the queue until the limit resets. */
  private recordUsageLimit(conversationId: string, limit: UsageLimitWords, promptSent: boolean, spent: TurnSpend): TurnFailure {
    const resetsAt = usageLimitResetIn(limit.message);
    this.append(conversationId, { type: "error", ...limit, usageLimit: { resetsAt }, ...(promptSent && { continuable: true as const }), endsTurn: true, ...spent });
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

  /** A turn that started meanwhile, e.g. while a /clear opened the fresh session, sends the queue on once it ends; a task no longer to run is left out. */
  private sendNextQueuedMessage(conversationId: string): void {
    const runtime = this.store.hasConversation(conversationId) ? this.runtime(conversationId) : undefined;
    const [next, ...rest] = runtime?.queuedMessages ?? [];
    if (!runtime || !next || runtime.running || this.holdsQueue(runtime)) return;
    this.setQueue(conversationId, runtime, rest);
    if (next.broughtTaskId !== undefined && !this.broughtTasks.stillToRun(next.broughtTaskId)) {
      this.publish(this.get(conversationId));
      return this.sendNextQueuedMessage(conversationId);
    }
    this.prompt(conversationId, next.text, {
      imageIds: next.imageIds,
      authorId: next.authorId,
      fromScript: next.fromScript,
      fromMirador: next.fromMirador,
      fromPlugin: next.fromPlugin,
      roomMessageId: next.roomMessageId,
      broughtTaskId: next.broughtTaskId,
      startsTurn: true,
    }).catch(() => {});
  }

  private appendUserMessage(
    conversationId: string,
    { text, imageIds, authorId, fromScript, fromMirador, fromPlugin, roomMessageId, broughtTaskId }: Omit<QueuedMessage, "id">,
    { commands, reverts, canvas }: NotesForAgent,
  ) {
    canvas.forEach((note) => note.heard());
    const attachedCommandIds = commands.map(({ commandId }) => commandId);
    const attachedRevertIds = reverts.map(({ revertId }) => revertId);
    return this.append(conversationId, {
      type: "user-message",
      text,
      ...(authorId && { authorId }),
      ...(attachedCommandIds.length > 0 && { attachedCommandIds }),
      ...(attachedRevertIds.length > 0 && { attachedRevertIds }),
      ...(imageIds.length > 0 && { imageIds }),
      ...(fromScript && { fromScript }),
      ...(fromMirador && { fromMirador }),
      ...(fromPlugin && { fromPlugin }),
      ...(roomMessageId && { roomMessageId }),
      ...(broughtTaskId && { broughtTaskId }),
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
      runtime = { running: false, holdingQueue: false, pendingPermissions: new Map(), queuedMessages, openToolCalls: new OpenToolCalls(), toolCallReportsHeard: new ToolCallReportsHeard(), automaticContinues: 0, stallNudges: 0 };
      this.runtimes.set(conversationId, runtime);
    }
    return runtime;
  }

  /** Returns the event's seq. A turn that was still running when its conversation got deleted ends without a trace. */
  private append(conversationId: string, event: ConversationEvent) {
    if (!this.store.hasConversation(conversationId)) return;
    const stored = this.store.appendEvent(conversationId, event);
    this.hub.publishEvent(conversationId, stored);
    this.turnsHeard.eventAppended?.(conversationId, event);
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
      resumedByAJob: this.resumedByAJob(conversationId),
      holdsQueue: runtime.holdingQueue || this.holdsQueue(runtime),
    });
    if (!reason || this.stopping) return;
    if (this.itsPluginTellsTheCaller(conversationId) || worksForARoom(this.get(conversationId))) return;
    this.notifications.notify(conversationId, reason);
    if (this.hub.isWatched(conversationId)) return;
    this.unseenTurnEnds.set(conversationId, reason.kind);
    this.store.setUnseenTurnEnd(conversationId, reason.kind);
    this.keepLastWords(conversationId);
  }

  /**
   * A plugin's tool or action started this conversation for a caller that is still here, and the plugin, which tells its
   * caller, is yet to hear how its work ended: it hears of this turn and tells that caller, whose own turn end notifies the
   * user. It hears only once, so the turns after notify as any conversation's do, as do those whose caller is gone or whose plugin
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

  /** Every conversation `waitingFor` could find waiting, from the four things it reads, so only those that wait are read from the database. */
  private conversationsThatMayWait() {
    return new Set([...this.runtimes.keys(), ...this.asksWaitedOn.keys(), ...this.unseenTurnEnds.keys(), ...this.broughtTasks.conversationsHoldingTasks()]);
  }

  private waitingFor(conversationId: string): WaitingFor | null {
    if ((this.runtimes.get(conversationId)?.pendingPermissions.size ?? 0) > 0 || this.broughtTasks.conversationsHoldingTasks().has(conversationId)) return "permission";
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
  /** Who wrote the message that started the turn, so the request made again is theirs too. */
  authorId?: string;
  /** The task of a room of another machine the turn works on, which the turn that continues it goes on with. */
  broughtTaskId?: string;
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
    ...(first.authorId && { authorId: first.authorId }),
    ...(first.broughtTaskId && { broughtTaskId: first.broughtTaskId }),
    imageIds: messages.flatMap(({ imageIds = [] }) => imageIds),
    beganAt: first.at,
  };
}

interface SteeringState {
  hasSession: boolean;
  /** An open tool call of the agent's own that started no subagent: its id, and its kind when the agent said. */
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

const modeOptionOf = ({ configOptions }: Pick<Conversation, "configOptions">) => configOptions.find(({ category }) => category === "mode");

const textBlock = (text: string): acp.ContentBlock => ({ type: "text", text });

const sideChatSwitchWords = ({ sideChatAccessToTell }: Pick<Runtime, "sideChatAccessToTell">) => (sideChatAccessToTell ? [textBlock(sideChatAccessNote(sideChatAccessToTell))] : []);

function assertWorksInRoomsWorkspaces(harness: HarnessId) {
  if (!worksInRoomsWorkspaces(harness)) throw new HostProblemError({ code: "agent-cannot-work-in-rooms-workspace" });
}

/** A side chat that is to read and search only, whether its agent holds it to that or is only asked to. */
const isToReadOnly = ({ sideChatOf, sideChatMayChangeFiles }: Pick<Conversation, "sideChatOf" | "sideChatMayChangeFiles">) => sideChatOf !== undefined && !sideChatMayChangeFiles;

/** The agent is told no once, so it can still ask for something else. */
function turnedDown(options: acp.PermissionOption[]): acp.RequestPermissionResponse {
  const rejecting = optionThatRejects(options);
  return rejecting ? { outcome: { outcome: "selected", optionId: rejecting } } : { outcome: { outcome: "cancelled" } };
}

/** No once, so the agent can still ask for something else. */
function optionThatRejects(options: acp.PermissionOption[]): string | null {
  const rejecting = options.find(({ kind }) => kind === "reject_once") ?? options.find(({ kind }) => kind === "reject_always");
  return rejecting?.optionId ?? null;
}

/**
 * What a new session offers once it is on the model a profile names, as the profile's conversations will be: a model
 * can have effort levels of its own. A model the agent does not offer, refuses, or takes longer than `waitMs` to switch
 * to leaves what the session started with, so a probe never fails for want of the switch.
 */
export async function offeredOnModel(
  agent: Pick<HarnessProcess, "setConfigOption">,
  created: acp.NewSessionResponse,
  model: string | null,
  waitMs = OPTION_ANSWER_TIMEOUT_MS,
): Promise<acp.SessionConfigOption[] | null> {
  const startedWith = created.configOptions ?? null;
  const modelOption = startedWith?.find(({ category }) => category === "model");
  const choice = model && startedWith ? modelChoiceFor(startedWith, model) : null;
  if (!modelOption || choice === null || modelOption.currentValue === choice) return startedWith;
  const onModel = agent.setConfigOption(created.sessionId, modelOption.id, choice).then(
    ({ configOptions }) => configOptions ?? startedWith,
    () => startedWith,
  );
  return Promise.race([onModel, Bun.sleep(waitMs).then(() => startedWith)]);
}

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
  inWorktree = false,
): ExternalSession => ({
  sessionId,
  title: title ?? null,
  updatedAt: updatedAt ?? null,
  conversationId: conversationIdBySession.get(sessionId) ?? null,
  ...(inWorktree && { inWorktree: true }),
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
