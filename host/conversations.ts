import { realpath } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import type * as acp from "@agentclientprotocol/sdk";
import {
  harnessLabels,
  type Activity,
  type AdoptMode,
  type AskItem,
  type AskMode,
  type ContextUsage,
  type Conversation,
  type ConversationEvent,
  type ConversationStatus,
  type ExternalSession,
  type HarnessId,
  type JobWait,
  type JobWaitEnd,
  type Launch,
  type PendingAsk,
  type PendingPermissionRequest,
  type PendingRequest,
  type QueuedMessage,
  type RestoreFiles,
  type RestorePlan,
  type SessionSearchHit,
  type StartedBy,
  type StoredEvent,
  type TerminalActivity,
  type UsageLimitWait,
  type WaitingFor,
  type Workspace,
} from "../shared/model.ts";
import { offersValue } from "../shared/config-options.ts";
import { MIN_SEARCH_LENGTH } from "../shared/find.ts";
import { messageAtEnd, type JobWaitRequest } from "../shared/job-waits.ts";
import { panelCommandRun } from "../shared/panel-commands.ts";
import { historyEntry } from "../shared/prompt-history.ts";
import { inSidebarOrder, movedBefore } from "../shared/sidebar-order.ts";
import { isClearCommand, toSlashCommand } from "../shared/slash-commands.ts";
import { lastWordsOf, replyOf } from "../shared/last-words.ts";
import { cutWithEllipsis, firstGraphemes } from "../shared/text-cut.ts";
import { isInformational } from "../shared/timeline.ts";
import type { ConversationReply, StartedConversation } from "../shared/canvas-plugins.ts";
import { canTryAgain } from "../shared/try-again.ts";
import { currentActivity, OpenToolCalls } from "./activity.ts";
import { editDiffsOf } from "./edit-diff.ts";
import { pendingAsk, pendingPermission } from "./pending-requests.ts";
import { launchIdea } from "./idea.ts";
import { openAsText, openWithSystemDefault } from "./system-open.ts";
import { mentionSuggestions } from "./mentions.ts";
import { PlanQuotasByProfile, reportedQuotas } from "./plan-quotas.ts";
import { turnEndReason, type TurnOutcome } from "../shared/system-notifications.ts";
import { hasBegun, updatesTheAgentRecords } from "../shared/conversation-begun.ts";
import { isUsageLimitError, usageLimitMessage, usageLimitResetIn } from "../shared/usage-limit.ts";
import { summarizeWaiting, type WaitingSummary } from "../shared/waiting.ts";
import { awaitingDelivery, USER_COMMAND_EVENT_TYPES, userCommandsIn, withCommandOutputs, type UserCommand } from "../shared/user-commands.ts";
import { withCanvasNotes, type CanvasNote } from "./canvas/notes.ts";
import { NO_CANVAS_PLUGINS, type CanvasPluginGuidance } from "./canvas/guidance.ts";
import { endsTurn, joinedRunningTurn, lastAgentMessageId, pendingReverts, REVERT_EVENT_TYPES, rewindPointBefore, turnTitle, turnsFrom, whyNoRewindTo, withRevertNotes, type Revert } from "../shared/reverts.ts";
import { returnedSteerSeqs } from "../shared/steered-messages.ts";
import { miradorCommandEnvironment } from "./acp/environment.ts";
import { CANVAS_SERVER_NAME, harnessSpec, isAuthRequiredError, launchEnvironment, loginCommand, profileEnvironment, sessionMeta } from "./acp/harnesses.ts";
import { HarnessProcess, type ConfigValue } from "./acp/harness.ts";
import { withReportedToolCall } from "./acp/reported-tool-call.ts";
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
import type { Store, UnseenTurnEnd } from "./store.ts";
import type { SystemNotifications } from "./system-notifications.ts";
import type { TerminalProgram } from "./terminals.ts";
import { claudeConfigDir } from "./terminal-sessions.ts";
import { TerminalWork, updatesAfter } from "./terminal-catch-up.ts";
import { claudeTranscript, lastAnsweringModel, modelChoiceFor, recordsUserMessage, userMessageTakenInAt } from "./claude-transcript.ts";
import { claudeTranscriptPaths, messageSnippetOf, openOpencodeDatabase, opencodeDatabasePath } from "./session-transcripts.ts";
import { UserCommandRunner } from "./user-commands.ts";
import { ConversationSessions } from "./conversation-sessions.ts";
import { SubagentSessions } from "./subagent-sessions.ts";
import { SubagentUsageReader } from "./subagent-usage.ts";
import { UnknownSessionUpdates } from "./unknown-session-updates.ts";

const UNTITLED = "New conversation";
const MAX_TITLE_LENGTH = 200;
const LISTED_SESSIONS = 30;
const SEARCHED_SESSIONS = 50;
const TITLE_LENGTH = 60;
const CONTINUE_AFTER_INTERRUPTION = "Continue where you left off.";
const NO_FILES_KEPT = "Mirador kept no files for that turn, so there is nothing to undo it to.";
const AGENT_IS_WORKING = "The agent is still working. Stop its turn before going back.";
const NOT_A_TURN = "A conversation can be taken back only to one of your own messages.";
const AGENT_CANNOT_FORK = "The agent cannot be sent back to an earlier point in its session.";
const ONLY_GIT_REPOSITORIES = "Mirador keeps a turn's files only in a workspace that is a git repository.";
const FILES_NO_LONGER_KEPT = `Mirador no longer keeps the files of that turn: it keeps those of a workspace's newest ${SNAPSHOTS_KEPT} turns.`;
const TURN_STOP_TIMEOUT_MS = 10_000;
/** How long a Stop waits for Claude Code to record the prompt it is stopping, bounded so a wedged agent can't hang it. */
const PROMPT_RECORD_WAIT_MS = 3_000;
/** Letting go of a session is a courtesy to its agent; one that doesn't answer must not hold up what comes next. */
const SESSION_CLOSE_TIMEOUT_MS = 5_000;
const OPTION_ANSWER_TIMEOUT_MS = 10_000;
/** Like Claude Code: the agent continues a minute after its usage limit resets, at most twice in a row by itself. */
const USAGE_LIMIT_RESET_MARGIN_MS = 60_000;
const AUTOMATIC_CONTINUES_IN_A_ROW = 2;
/** A script-driven turn whose reply stops at a step it announced is nudged on at most this many times in a row, so a run that keeps stopping there waits for the user rather than being poked for ever. */
const STALL_NUDGES_IN_A_ROW = 2;
/** What the nudge says: the agent ended its turn on a ":", meaning to go on. */
const CONTINUE_AFTER_STALL = "Continue where you left off: your reply ended announcing a next step without taking it.";
/** How much of the end of a turn's reply is kept, to tell whether it stopped at a ":". */
const REPLY_END_KEPT = 200;
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
  /** The reply whose chunks last streamed, so the late chunks of a turn a stop cancelled can be recognised. */
  lastReplyMessageId: string | null;
  /** The turn waits on the user, so no reply of its own can still be on its way. */
  awaitedUser: boolean;
  /** The turn began with a script's message (`mirador message`, or a job wait's resume): part of a run nobody may be watching. */
  fromScript: boolean;
  /** The end of the turn's own reply since its last tool call, to tell a turn that stopped at a step it announced from one that finished. */
  replyEnd: string;
  /** What kept queued messages out of the turn when the host last tried to steer them in, as the host log says it. */
  queuedMessagesKeptOutBy?: string | null;
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
  /** The reply the last stopped turn still owes: its late chunks are dropped, or held back until another reply's id or the next turn's end tells whether they were the orphan or that turn's answer. */
  cancelledReply?: CancelledReplyChunks;
}

interface StoppedTurn {
  conversationId: string;
  sessionId: string | null;
}

export class ConversationService {
  private readonly runtimes = new Map<string, Runtime>();
  /** One agent process per profile, by its id. */
  private readonly harnessesByProfile = new Map<string, HarnessProcess>();
  private readonly sessions = new ConversationSessions();
  private readonly subagentSessions = new SubagentSessions();
  /** Sessions whose agent left an option change unanswered for too long, so their next changes don't wait. */
  private readonly sessionsSlowToAnswer = new Set<string>();
  private readonly updatesForUnknownSessions = new UnknownSessionUpdates();
  private readonly statusOverrides = new Map<string, Pick<Conversation, "status" | "statusDetail">>();
  private readonly terminalActivity = new Map<string, TerminalActivity>();
  private readonly terminalWork = new TerminalWork();
  private readonly catchingUpWithTerminal = new Set<string>();
  /** A session loaded again replays all of its history; it is held here, so only what the conversation lacks joins it. */
  private readonly replaysBeingRead = new Map<string, acp.SessionNotification[]>();
  private readonly contextUsage: Map<string, ContextUsage>;
  private readonly planQuotas = new PlanQuotasByProfile();
  private readonly unseenTurnEnds: Map<string, UnseenTurnEnd>;
  private readonly lastWords = new Map<string, string>();
  private readonly asksWaitedOn: Map<string, PendingAsk>;
  private readonly commands = new UserCommandRunner();
  private readonly subagentUsageReader = new SubagentUsageReader();
  private readonly jobWaits: JobWaits;
  private readonly asyncTasks = new AsyncTasks();
  private readonly checkpoints: Checkpoints;
  readonly changes: Changes;
  /** While the host stops or restarts, messages wait in the queue for the next host, and turns it ends are not the agent's failures. */
  private stopping = false;
  private canvasNotesOf: (conversationId: string) => CanvasNote[] = () => [];
  private hearReply: HearReply = () => {};
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
    this.changes = new Changes(store, this.checkpoints, (conversationId) => this.workspaceOf(conversationId), launchIdea, openWithSystemDefault, (file) =>
      openAsText(file, store.scriptProgramSetting()),
    );
    this.cancelPermissionsOrphanedByRestart();
    this.cancelAsksOrphanedByRestart();
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
    return summarizeWaiting([...this.conversationsThatMayWait()].map((conversationId) => this.waitingFor(conversationId)).filter((waitingFor) => waitingFor !== null));
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
    if (!conversation) throw new Error(`Unknown conversation ${conversationId}`);
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
    return mentionSuggestions(this.existingWorkspace(this.get(conversationId).workspaceId).path, query);
  }

  /** What the conversation's subagents spent so far, from Claude Code's transcripts of them. */
  async subagentUsage(conversationId: string, toolCallIds: string[]) {
    const conversation = this.get(conversationId);
    if (conversation.harness !== "claude" || !conversation.acpSessionId) return {};
    return this.subagentUsageReader.usageOf(this.claudeConfigDirOf(conversation), conversation.acpSessionId, toolCallIds);
  }

  /** Without a launch, on the workspace's default as the host has it, which a browser may not have heard of yet. */
  create(workspaceId: string, launch: Launch = this.existingWorkspace(workspaceId).defaultLaunch): Conversation {
    const conversation = this.insertConversation(workspaceId, launch, UNTITLED);
    this.ensureSession(conversation.id).catch(() => {});
    return conversation;
  }

  /**
   * For a plugin's tool: a conversation beside the caller's, on another profile, working on `prompt` at once. It works
   * for the caller, which hears through the plugin how its work ended.
   */
  startBeside(callerId: string, plugin: string, profileName: string, prompt: string): StartedConversation {
    const caller = this.get(callerId);
    if (caller.startedBy) throw new Error("A plugin's tool started this conversation, so it can't start another; do the task here.");
    const profiles = this.store.listProfiles();
    const profile = profiles.find(({ name }) => name.toLowerCase() === profileName.trim().toLowerCase());
    if (!profile) throw new Error(`There is no profile named ${profileName}; the profiles are ${profiles.map(({ name }) => name).join(", ")}.`);
    const conversation = this.create(caller.workspaceId, { harness: profile.harness, profileId: profile.id });
    this.store.recordStartedBy(conversation.id, { conversationId: callerId, plugin });
    if (caller.bypassPermissions) this.setBypassPermissions(conversation.id, true);
    this.prompt(conversation.id, prompt, { startsTurn: true }).catch(() => {});
    return { id: conversation.id, profile: profile.name };
  }

  hearRepliesWith(hearReply: HearReply) {
    this.hearReply = hearReply;
  }

  /** The user takes a started conversation off its caller's list of delegated tasks. */
  dismissDelegation(conversationId: string) {
    this.store.dismissDelegation(conversationId);
    this.republish(conversationId);
  }

  /**
   * Once, when the work of a conversation a plugin's tool started ends. The reply is kept before the plugin hears it, so
   * a crash in between can't tell it twice; a caller deleted since hears nothing.
   */
  private deliverOwedReply(conversationId: string, endedAs?: ConversationReply["ended"]) {
    const conversation = this.store.findConversation(conversationId);
    const startedBy = conversation?.startedBy;
    if (!conversation || !startedBy || startedBy.reply) return;
    const turnStart = this.store.latestTurnStart(conversationId)?.seq ?? 0;
    const reply = replyOf(this.store.listEventsFrom(conversationId, turnStart));
    const told = endedAs ? { ...reply, ended: endedAs } : reply;
    this.store.recordDelegatedReply(conversationId, { ended: told.ended, opening: told.text && cutWithEllipsis(told.text, REPLY_OPENING_GRAPHEMES) });
    this.republish(conversationId);
    if (!this.store.hasConversation(startedBy.conversationId)) return;
    const started = { id: conversationId, profile: (conversation.profileId && this.store.findProfile(conversation.profileId)?.name) || harnessLabels[conversation.harness] };
    Promise.resolve()
      .then(() => this.hearReply(started, startedBy, told))
      .catch((error: unknown) => console.error(`the ${startedBy.plugin} plugin failed to hear the reply of ${conversationId}:`, error));
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
    if (harness.spec.id !== "claude" && harness.spec.id !== "opencode") throw new Error(`${harness.spec.label} cannot search its sessions.`);
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
    if (!capabilities.agentCapabilities?.sessionCapabilities?.list) throw new Error(`${harness.spec.label} cannot list its sessions.`);
    const { sessions } = await harness.listSessions(directory);
    const conversationIdBySession = new Map(this.store.listConversations().map(({ acpSessionId, id }) => [acpSessionId, id]));
    return { profile, sessions: sessions.filter(({ cwd }) => cwd === directory), conversationIdBySession };
  }

  /** Continues (or forks) a session started elsewhere, e.g. in a terminal, replaying its history into the conversation. */
  adopt(workspaceId: string, launch: Launch, session: Pick<ExternalSession, "sessionId" | "title">, mode: AdoptMode): Conversation {
    if (mode === "continue" && this.store.listConversations().some(({ acpSessionId }) => acpSessionId === session.sessionId)) {
      throw new Error("That session is already open in the app.");
    }
    const title = session.title || UNTITLED;
    const conversation = this.insertConversation(workspaceId, launch, mode === "fork" ? `Fork: ${title}` : title);
    this.ensureSession(conversation.id, () => this.loadExternalSession(conversation.id, session.sessionId, mode)).catch(() => {});
    return conversation;
  }

  private insertConversation(workspaceId: string, launch: Launch, title: string): Conversation {
    this.existingWorkspace(workspaceId);
    const profile = profileToLaunch(this.store, launch);
    const now = Date.now();
    const conversation = this.store.insertConversation({
      id: crypto.randomUUID(),
      workspaceId,
      harness: launch.harness,
      profileId: launch.profileId,
      title,
      titleSetByUser: false,
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
    this.store.setConversationOrder(movedBefore(siblings.map(({ id }) => id), conversationId, beforeConversationId));
    const positionBefore = new Map(siblings.map(({ id, position }) => [id, position]));
    this.store
      .listConversations()
      .filter(({ id, position }) => positionBefore.has(id) && positionBefore.get(id) !== position)
      .forEach((conversation) => this.publish(conversation));
  }

  delete(conversationId: string) {
    const conversation = this.get(conversationId);
    this.deliverOwedReply(conversationId, "stopped");
    if (conversation.acpSessionId) {
      this.cancel(conversationId).catch(() => {});
      this.notifier.unmute(conversation.acpSessionId);
    }
    this.sessions.forget(conversationId);
    this.subagentSessions.forget(conversationId);
    const runtime = this.runtimes.get(conversationId);
    const wasRunning = runtime?.running ?? false;
    this.asyncTasks.forget(conversationId);
    if (runtime) {
      this.endUsageLimitWait(runtime);
      this.releaseSession(conversationId, runtime, conversation.acpSessionId);
    }
    this.jobWaits.forget(conversationId);
    this.runtimes.delete(conversationId);
    this.statusOverrides.delete(conversationId);
    this.terminalActivity.delete(conversationId);
    this.contextUsage.delete(conversationId);
    this.unseenTurnEnds.delete(conversationId);
    this.lastWords.delete(conversationId);
    this.asksWaitedOn.delete(conversationId);
    this.store.deleteConversation(conversationId);
    this.images.deleteConversation(conversationId);
    this.droppedFiles.deleteConversation(conversationId);
    this.hub.broadcast({ type: "conversation.deleted", conversationId });
    this.announceWaiting();
    if (wasRunning) this.announceRunningTurnsCount();
  }

  deleteAllInWorkspace(workspaceId: string) {
    this.store
      .listConversations()
      .filter((conversation) => conversation.workspaceId === workspaceId)
      .forEach((conversation) => this.delete(conversation.id));
  }

  rename(conversationId: string, title: string) {
    const name = firstGraphemes(title.trim(), MAX_TITLE_LENGTH);
    if (!name) throw new Error("A conversation needs a name.");
    this.save({ ...this.get(conversationId), title: name, titleSetByUser: true });
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
    if (changesAgent) this.forgetContextUsage(conversationId);
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
    this.append(conversationId, { type: "profile-changed", profileName: profile.name, ...(changesAgent && { agent: harness }) });
    this.ensureSession(conversationId, async () => {
      this.setStatus(conversationId, "starting", "Switching profile…");
      await released;
      const sessionId = await this.openSession(conversationId);
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
    throw new Error(`This conversation already runs on ${harnessLabels[harness]}. Start a new conversation to use “${target.name}” on ${harnessLabels[target.harness]}.`);
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
      this.setStatus(conversationId, "starting", "Clearing the context…");
      await released;
      const sessionId = await this.openSession(conversationId);
      this.setStatus(conversationId, "idle");
      return sessionId;
    }).catch(() => {});
    this.sendNextQueuedMessage(conversationId);
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

  async prompt(conversationId: string, text: string, { imageIds = [], fromScript = false, fromPlugin, startsTurn = false }: PromptStart = {}) {
    const runtime = this.runtime(conversationId);
    if (runtime.running) throw new Error("The agent is still working on the previous message.");
    if (isClearCommand(text)) return this.clearContext(conversationId);
    runtime.running = true;
    this.announceRunningTurnsCount();
    this.endUsageLimitWait(runtime);
    let endTurn = () => {};
    runtime.turnEnded = new Promise((resolve) => (endTurn = resolve));
    const turn: TurnInProgress = { steered: [], ended: false, lastReplyMessageId: null, awaitedUser: false, fromScript, replyEnd: "" };
    runtime.turn = turn;
    runtime.openToolCalls.clear();
    this.forgetUnseenTurnEnd(conversationId);
    this.retitleFromFirstMessage(conversationId, text);
    const notes = this.notesForAgent(conversationId);
    this.setStatus(conversationId, "starting");
    this.store.turnStarted(conversationId);
    const turnSeq = this.appendUserMessage(conversationId, { text, imageIds, ...(fromScript && { fromScript }), ...(fromPlugin && { fromPlugin }) }, notes);
    if (startsTurn && turnSeq !== undefined) await this.keepFilesOfTurn(conversationId, turnSeq);
    let response: acp.PromptResponse | undefined;
    try {
      const sessionId = await this.ensureSession(conversationId);
      this.setStatus(conversationId, "running");
      const prompt = await this.promptContent(conversationId, withNotes(notes, text), imageIds);
      const harness = this.harnessFor(this.get(conversationId));
      turn.promptSent = { text, sentAt: Date.now() };
      response = await harness.prompt(sessionId, prompt);
      this.showHeldBackReply(conversationId);
      this.append(conversationId, { type: "turn-end", stopReason: response.stopReason });
      runtime.automaticContinues = 0;
      this.notifyTurnEnded(conversationId, { stopReason: response.stopReason });
    } catch (error) {
      if (runtime.killedOnPurpose) {
        this.append(conversationId, { type: "turn-end", stopReason: "cancelled" });
        this.notifyTurnEnded(conversationId, { stopReason: "cancelled" });
      } else {
        this.notifyTurnEnded(conversationId, { error: this.recordTurnFailure(conversationId, error, turn.promptSent !== undefined) });
      }
    } finally {
      this.showHeldBackReply(conversationId);
      turn.ended = true;
      // Claude Code keeps streaming the reply of a turn its cancel cut short, when the stop found
      // its first request merged with a steer: a reply already streaming, or one the API has yet
      // to answer. A stop that interrupted the request may owe no reply, so a reply beginning in the
      // next turn waits for that turn to tell whose it is. A stop the agent waited on the user for
      // owes no reply, nor does one its tools were busy with, nor a killed process.
      runtime.cancelledReply =
        response?.stopReason === "cancelled" && !turn.awaitedUser && (turn.lastReplyMessageId !== null || runtime.openToolCalls.size === 0)
          ? { messageId: turn.lastReplyMessageId }
          : undefined;
      if (response?.stopReason !== "end_turn") {
        await this.returnUnansweredSteers(conversationId, runtime, turn.steered, response).catch((error: unknown) =>
          console.error(`could not tell whether the agent answered the messages that joined the turn of conversation ${conversationId}: ${errorMessage(error)}`),
        );
      }
      runtime.running = false;
      this.announceRunningTurnsCount();
      runtime.killedOnPurpose = false;
      this.store.turnEnded(conversationId);
      this.setStatus(conversationId, "idle");
      endTurn();
    }
    if (!this.stopping) this.deliverOwedReply(conversationId);
    this.sendNextQueuedMessage(conversationId);
    this.nudgeAfterStall(conversationId, turn, response);
  }

  /**
   * Deep in a long run a model can end its turn on a ":" -- "Closing the round, step (a), verify:" -- without the tool call
   * it announced. When a script drove the turn nobody may be there to notice, and the run would sit idle for good. If
   * nothing else will carry the conversation on, it is nudged to take that step, a couple of times in a row at most; a
   * turn that ends any other way, the user's own included, resets the count.
   */
  private nudgeAfterStall(conversationId: string, turn: TurnInProgress, response: acp.PromptResponse | undefined) {
    const runtime = this.runtime(conversationId);
    const stalled = response?.stopReason === "end_turn" && turn.fromScript && !turn.awaitedUser && stopsAtAnnouncedStep(turn.replyEnd);
    if (!stalled) {
      runtime.stallNudges = 0;
      return;
    }
    const carriedOnOtherwise = {
      stopping: this.stopping,
      running: runtime.running,
      queued: runtime.queuedMessages.length,
      steerInFlight: runtime.steerInFlight ?? false,
      jobWaits: this.jobWaits.in(conversationId).length,
    };
    if (!nudgesAfterStall(runtime.stallNudges, carriedOnOtherwise)) return;
    runtime.stallNudges += 1;
    this.send(conversationId, CONTINUE_AFTER_STALL, [], { fromScript: true }).catch(() => {});
  }

  /**
   * Sends `text` as the next user message, after those already waiting in the queue, such as the ones behind a /clear
   * that is opening the fresh session. While a turn is running it joins the turn: at once, cutting off what the agent is
   * writing, or, while the agent waits on tools, once they have finished. Sent `afterTurn`, it waits in the queue for the
   * turn to end.
   */
  async send(conversationId: string, text: string, imageIds: string[] = [], { fromScript = false, fromPlugin, afterTurn = false }: { fromScript?: boolean; fromPlugin?: string; afterTurn?: boolean } = {}) {
    const runtime = this.runtime(conversationId);
    const sendsAtOnce = !runtime.running && !this.holdsQueue(runtime) && runtime.queuedMessages.length === 0;
    if (sendsAtOnce) return this.prompt(conversationId, text, { imageIds, fromScript, fromPlugin, startsTurn: true });
    const message: QueuedMessage = { id: crypto.randomUUID(), text, imageIds, ...(fromScript && { fromScript }), ...(fromPlugin && { fromPlugin }), ...(afterTurn && { afterTurn }) };
    this.setQueue(conversationId, runtime, [...runtime.queuedMessages, message]);
    this.publish(this.get(conversationId));
    if (!runtime.running) this.sendNextQueuedMessage(conversationId);
    else if (!afterTurn) this.steerQueuedMessages(conversationId);
  }

  /** What undoing the turn that began with this message would do to the files, and to which, or why it cannot be undone. */
  async previewRevert(conversationId: string, seq: number): Promise<{ plan: RestorePlan | null; files?: RestoreFiles; cannotUndo?: string }> {
    const checkpoint = this.checkpointAt(conversationId, seq);
    if (!checkpoint) return { plan: null, cannotUndo: NO_FILES_KEPT };
    const preview = await this.checkpoints.preview(this.workspaceOf(conversationId), checkpoint);
    if (!preview) return { plan: null, cannotUndo: ONLY_GIT_REPOSITORIES };
    return (await this.checkpoints.keeps(this.workspaceOf(conversationId), checkpoint)) ? preview : { plan: null, cannotUndo: FILES_NO_LONGER_KEPT };
  }

  /**
   * Puts the workspace's files back to how they were before the turn that began with this message, deleting what came
   * after it. The conversation itself stays as it is, so the agent's context and its cache survive whole; the note
   * saying what happened goes out with the user's next message.
   */
  async revert(conversationId: string, seq: number): Promise<RestorePlan> {
    if (this.runtime(conversationId).running) throw new Error("The agent is still working. Stop its turn before undoing one.");
    const checkpoint = this.checkpointAt(conversationId, seq);
    if (!checkpoint) throw new Error(NO_FILES_KEPT);
    if (!(await this.checkpoints.keeps(this.workspaceOf(conversationId), checkpoint))) throw new Error(FILES_NO_LONGER_KEPT);
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
  ): Promise<{ turnsLeaving: number; keptFrom: string | null; plan: RestorePlan | null; files?: RestoreFiles; cannotRewind?: string; filesNote?: string }> {
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
    if (cannotRewind) throw new Error(cannotRewind);
    const runtime = this.runtime(conversationId);
    const conversation = this.get(conversationId);
    const events = this.store.listEvents(conversationId);
    const point = rewindPointBefore(events, seq);
    this.setStatus(conversationId, "starting", "Going back…");
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
    if (!capabilities.agentCapabilities?.sessionCapabilities?.fork) throw new Error(AGENT_CANNOT_FORK);
    const { sessionId } = await harness.forkSession({
      sessionId: conversation.acpSessionId!,
      cwd: await recordedDirectory(this.existingWorkspace(conversation.workspaceId)),
      _meta: { jetbrains: { air: { fork: { version: 1, messageId: point } } }, ...(atSteeredMessage && { steering: { atSteeredMessage } }) },
    });
    return sessionId;
  }

  /** Why the conversation cannot go back to this turn, if it cannot. */
  private rewindProblem(conversationId: string, seq: number) {
    if (this.runtime(conversationId).running) return AGENT_IS_WORKING;
    if (this.store.findEvent(conversationId, seq)?.event.type !== "user-message") return NOT_A_TURN;
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

  private workspaceOf(conversationId: string) {
    return this.existingWorkspace(this.get(conversationId).workspaceId);
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
    if (!wait) throw new Error("Mirador no longer waits for that job.");
    return followJobProgram(wait);
  }

  private jobWaitEnded(conversationId: string, wait: JobWait, end: Exclude<JobWaitEnd, "stopped">) {
    this.append(conversationId, { type: "job-wait-ended", wait, end });
    const message = messageAtEnd(wait, end);
    if (wait.resume) this.send(conversationId, message, [], { fromScript: true }).catch(() => {});
    else this.notifications.notify(conversationId, { kind: "job-ended", message });
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

  /** Runs a `!` command from the message box in the conversation's workspace, with the environment its agent gets. */
  runCommand(conversationId: string, command: string) {
    const conversation = this.get(conversationId);
    const directory = this.store.findWorkspace(conversation.workspaceId)?.path;
    if (!directory) throw new Error("This conversation's workspace no longer exists.");
    const environment = profileEnvironment(this.profileOf(conversation));
    void this.commands.run(command, directory, environment, (event) => this.append(conversationId, event));
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
  loginProgram(conversationId: string): TerminalProgram {
    const conversation = this.get(conversationId);
    const environment = launchEnvironment(conversation.harness, this.profileOf(conversation), this.store.claudeProgramSetting());
    return { tabName: `${harnessLabels[conversation.harness]} sign-in`, command: loginCommand(conversation.harness, environment), environment };
  }

  /** A command Claude Code shows a panel for only in its own terminal, run in a tab of the conversation's terminals. */
  panelCommandProgram(conversationId: string, line: string): TerminalProgram {
    const command = panelCommandRun(line);
    if (command === null) throw new Error(`${line} is not a slash command.`);
    const conversation = this.get(conversationId);
    if (conversation.harness !== "claude") throw new Error(`${harnessLabels[conversation.harness]} has no command like ${line}.`);
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
    runtime.pendingPermissions.forEach(({ settle }) => settle(null));
    const conversation = this.get(conversationId);
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
    const stopped = await this.killAgent(harness, "was force stopped");
    this.continueStoppedTurns(stopped.filter((turn) => turn.conversationId !== conversationId));
  }

  /**
   * Every turn the kill ends is the host's doing rather than the agent's failure, so each ends the way a stop ends it.
   * Returns those turns once they all have ended.
   */
  private async killAgent(harness: HarnessProcess, reason: string): Promise<StoppedTurn[]> {
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
    this.harnessesByProfile.forEach((current, profileId) => {
      if (current === harness) this.harnessesByProfile.delete(profileId);
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
    if (!pending) throw new Error("This permission request is no longer pending.");
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
    const harness = this.harnessesByProfile.get(profileId);
    this.harnessesByProfile.delete(profileId);
    if (!harness) return;
    void this.killAgent(harness, "was restarted because its profile changed").then((stopped) => {
      if (this.store.findProfile(profileId)) this.continueStoppedTurns(stopped);
    });
  }

  /** Claude Code agents start again with the program now set, as a profile's agent does when the profile changes. */
  restartClaudeAgents() {
    [...this.harnessesByProfile]
      .filter(([profileId]) => this.store.findProfile(profileId)?.harness === "claude")
      .forEach(([profileId, harness]) => {
        this.harnessesByProfile.delete(profileId);
        void this.killAgent(harness, "was restarted because the Claude Code program changed").then((stopped) => this.continueStoppedTurns(stopped));
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
   * and a reply the previous host owed a plugin, for a turn that ended as it stopped or that it died in, is told.
   */
  resumeAfterRestart(stoppedTurns: string[]) {
    this.store.listConversations().forEach(({ id, acpSessionId }) => {
      if (stoppedTurns.includes(id)) return void this.resumeStoppedTurn(id, acpSessionId).catch(() => {});
      this.deliverOwedReply(id, this.turnsCutShortByCrash.has(id) ? "failed" : undefined);
      if (!this.resumeUsageLimitWait(id)) this.sendNextQueuedMessage(id);
    });
    this.jobWaits.startAll();
  }

  shutdown() {
    this.stopping = true;
    this.jobWaits.stopAll();
    return Promise.all([this.commands.shutdown(), ...[...this.harnessesByProfile.values()].map((harness) => harness.stop())]);
  }

  /** An open that fails after another has replaced it, as when the agent it was on is stopped, leaves the newer one be. */
  private ensureSession(conversationId: string, open = () => this.openSession(conversationId)): Promise<string> {
    const runtime = this.runtime(conversationId);
    if (runtime.sessionId) return runtime.sessionId;
    const opening: Promise<string> = open().catch((error) => {
      if (runtime.sessionId && runtime.sessionId !== opening) throw error;
      runtime.sessionId = undefined;
      this.setStatus(conversationId, "error", errorMessage(error));
      throw error;
    });
    runtime.sessionId = opening;
    return opening;
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
   * Picks up a turn stopped for a restart or a profile switch. Messages sent while the session reopens wait behind the
   * turn, as they would have behind it before the stop.
   */
  private async resumeStoppedTurn(conversationId: string, stoppedSessionId: string | null) {
    const request = unfinishedTurnRequest(this.store.listEvents(conversationId));
    if (!request) {
      this.setStatus(conversationId, "idle");
      this.deliverOwedReply(conversationId);
      this.sendNextQueuedMessage(conversationId);
      return;
    }
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
    return this.prompt(conversationId, continuation.text, { imageIds: continuation.imageIds });
  }

  /**
   * The agent continues where it left off if it is still in the session the turn ran in and recorded the request there;
   * otherwise, as in a fresh session, it gets the request again.
   */
  private async continuationOf(conversationId: string, stoppedSessionId: string | null, request: TurnRequest) {
    const sessionId = await this.ensureSession(conversationId);
    if (sessionId === stoppedSessionId && (await this.sessionRecorded(conversationId, sessionId, request))) return { text: CONTINUE_AFTER_INTERRUPTION, imageIds: [] };
    return { text: request.text, imageIds: request.imageIds };
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
    const conversation = this.get(conversationId);
    const isFirstSession = conversation.acpSessionId === null;
    const harness = this.harnessFor(conversation);
    this.runtime(conversationId).harness = harness;
    const capabilities = await harness.start();
    const sessionRequest = await this.sessionRequest(conversationId, this.existingWorkspace(conversation.workspaceId));

    const canResume = Boolean(capabilities.agentCapabilities?.sessionCapabilities?.resume);
    if (conversation.acpSessionId && canResume && this.agentHasRecorded(conversationId)) {
      try {
        const resumed = await harness.resumeSession({ ...sessionRequest, sessionId: conversation.acpSessionId });
        this.bindSession(conversationId, conversation.acpSessionId, resumed.configOptions);
        await this.restoreConfigChoices(conversationId, conversation.acpSessionId, conversation.configOptions);
        return conversation.acpSessionId;
      } catch (error) {
        this.closeSessionIfConversationDeleted(conversationId, harness, conversation.acpSessionId);
        this.append(conversationId, {
          type: "error",
          message: `Could not resume the previous agent session (${errorMessage(error)}); starting a fresh one.`,
        });
      }
    }

    this.forgetContextUsage(conversationId);
    const created = await harness.newSession(sessionRequest);
    this.closeSessionIfConversationDeleted(conversationId, harness, created.sessionId);
    this.muteNotifier(conversation, created.sessionId);
    this.bindSession(conversationId, created.sessionId, created.configOptions);
    await this.restoreConfigChoices(conversationId, created.sessionId, conversation.configOptions);
    if (isFirstSession) await this.applyProfileChoices(conversationId, created.sessionId);
    if (this.onUsersOwnSetup(conversation)) await this.applyTestModelOverride(conversationId, created.sessionId);
    return created.sessionId;
  }

  /** Delete closes the session a conversation has; one the agent was still opening when the conversation went is closed here. */
  private closeSessionIfConversationDeleted(conversationId: string, harness: HarnessProcess, sessionId: string) {
    if (this.store.findConversation(conversationId)) return;
    harness.closeSession(sessionId).catch(() => {});
    throw new Error("The conversation was deleted while its agent session opened.");
  }

  /** Replayed history arrives as session updates before the load request returns, so the session is bound first. */
  private async loadExternalSession(conversationId: string, sessionId: string, mode: AdoptMode): Promise<string> {
    const conversation = this.get(conversationId);
    const harness = this.harnessFor(conversation);
    this.runtime(conversationId).harness = harness;
    const capabilities = await harness.start();
    if (!capabilities.agentCapabilities?.loadSession) throw new Error(`${harness.spec.label} cannot load existing sessions.`);
    if (mode === "fork" && !capabilities.agentCapabilities.sessionCapabilities?.fork) throw new Error(`${harness.spec.label} cannot fork sessions.`);
    this.setStatus(conversationId, "starting", "Loading the session's history…");
    const sessionRequest = await this.sessionRequest(conversationId, this.existingWorkspace(conversation.workspaceId));
    const loadedId = mode === "fork" ? (await harness.forkSession({ sessionId, cwd: sessionRequest.cwd })).sessionId : sessionId;
    this.muteNotifier(conversation, loadedId);
    this.save({ ...this.get(conversationId), acpSessionId: loadedId });
    this.sessions.bind(conversationId, loadedId);
    const loaded = await harness.loadSession({ ...sessionRequest, sessionId: loadedId }).catch((error: unknown) => {
      this.closeSessionIfConversationDeleted(conversationId, harness, loadedId);
      throw error;
    });
    this.closeSessionIfConversationDeleted(conversationId, harness, loadedId);
    this.bindSession(conversationId, loadedId, loaded.configOptions);
    if (conversation.harness === "claude") await this.restoreTranscriptModel(conversationId, loadedId, sessionId);
    await this.applyProfileChoices(conversationId, loadedId);
    this.setStatus(conversationId, "idle");
    return loadedId;
  }

  private async loadWithTerminalTurns(conversationId: string, sessionId: string): Promise<string> {
    const conversation = this.get(conversationId);
    const harness = this.harnessFor(conversation);
    this.runtime(conversationId).harness = harness;
    const capabilities = await harness.start();
    if (!capabilities.agentCapabilities?.loadSession) throw new Error(`${harness.spec.label} cannot load existing sessions.`);
    this.setStatus(conversationId, "starting", "Reading the turns taken in the terminal…");
    const workspace = this.existingWorkspace(conversation.workspaceId);
    const replay: acp.SessionNotification[] = [];
    this.replaysBeingRead.set(sessionId, replay);
    try {
      const loaded = await harness.loadSession({ ...(await this.sessionRequest(conversationId, workspace)), sessionId });
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
  private async sessionRequest(conversationId: string, workspace: Workspace) {
    const conversation = this.get(conversationId);
    const withoutUserSettings = this.config.testSkipsUserSettings && this.onUsersOwnSetup(conversation);
    return { cwd: await recordedDirectory(workspace), mcpServers: [this.canvasServerFor(conversationId)], _meta: sessionMeta(conversation.harness, this.store.canvasUse(), { canvasAssetsOrigin: this.config.canvasAssetsOrigin, withoutUserSettings, canvasPlugins: this.canvasPlugins(conversationId) }) };
  }

  /** claude-notifier hooks into Claude Code only. */
  private muteNotifier(conversation: Conversation, sessionId: string) {
    if (conversation.harness === "claude") this.notifier.mute(sessionId, conversation.title);
  }

  private existingWorkspace(workspaceId: string) {
    const workspace = this.store.findWorkspace(workspaceId);
    if (!workspace) throw new Error("The workspace no longer exists.");
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

  private async applyTestModelOverride(conversationId: string, sessionId: string) {
    const { model, effort } = this.config.testModelOverride;
    if (model) await this.trySetConfigOption(conversationId, sessionId, "model", model);
    if (effort) await this.trySetConfigOption(conversationId, sessionId, "effort", effort);
  }

  /**
   * Options depend on each other (haiku has no effort option), so one that no longer exists
   * or is refused must not cost the user their session. Nor may an agent that doesn't answer: Claude Code answers one
   * request at a time, and its first, counting its context's tokens, can wait for a model server to load the model.
   * Such a change still lands once the agent answers, and the session's later changes stop waiting for it meanwhile.
   * A session whose agent process has gone has nothing to change.
   */
  private async trySetConfigOption(conversationId: string, sessionId: string, configId: string, value: ConfigValue) {
    const current = this.get(conversationId).configOptions.find(({ id }) => id === configId);
    const harness = this.runtime(conversationId).harness;
    if (!current || current.currentValue === value || !harness) return;
    const answered = harness.setConfigOption(sessionId, configId, value).then(
      (response) => {
        this.sessionsSlowToAnswer.delete(sessionId);
        if (this.isOnSession(conversationId, sessionId)) this.save({ ...this.get(conversationId), configOptions: response.configOptions });
      },
      (error) => {
        if (this.isOnSession(conversationId, sessionId)) this.append(conversationId, { type: "error", message: `Could not set ${current.name} to ${value}: ${errorMessage(error)}` });
      },
    );
    if (this.sessionsSlowToAnswer.has(sessionId)) return;
    const answeredInTime = await Promise.race([answered.then(() => true), Bun.sleep(OPTION_ANSWER_TIMEOUT_MS).then(() => false)]);
    if (answeredInTime) return;
    this.sessionsSlowToAnswer.add(sessionId);
    this.append(conversationId, {
      type: "error",
      message: `${current.name} is still ${current.currentValue}: the agent has not answered the change to ${value} for ${OPTION_ANSWER_TIMEOUT_MS / 1000} seconds. It changes once the agent answers.`,
    });
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

  private harnessFor(launch: Launch): HarnessProcess {
    const profile = this.profileOf(launch);
    const existing = this.harnessesByProfile.get(profile.id);
    if (existing) return existing;
    const spec = harnessSpec(profile, this.store.claudeProgramSetting());
    const harness = new HarnessProcess(
      { ...spec, environment: { ...spec.environment, ...this.scriptEnvironment(spec.environment.PATH), ...this.testModelEnvironment(launch) } },
      {
        onSessionUpdate: (notification) => this.handleSessionUpdate(notification),
        onPermissionRequest: (request, signal) => this.handlePermissionRequest(request, signal),
        onExit: (process) => this.handleHarnessExit(process),
      },
      agentLogsDirectory(this.config.dataDir),
    );
    this.harnessesByProfile.set(profile.id, harness);
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
    if (!profile) throw new Error("This conversation has no profile, or its profile was deleted. Pick a profile at the top of the conversation.");
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
      const usage: ContextUsage = { used: update.used, size: update.size, cost: update.cost ? { amount: update.cost.amount, currency: update.cost.currency } : null };
      this.contextUsage.set(conversationId, usage);
      this.store.setContextUsage(conversationId, usage);
      const quotas = reportedQuotas(update._meta);
      if (quotas) this.planQuotas.record(this.get(conversationId).profileId, quotas);
      this.publish(this.get(conversationId));
      return;
    }
    if (update.sessionUpdate === "config_option_update") {
      this.save({ ...this.get(conversationId), configOptions: update.configOptions });
    }
    if (update.sessionUpdate === "session_info_update" && update.title && !this.get(conversationId).titleSetByUser) {
      this.save({ ...this.get(conversationId), title: update.title });
    }
    if (this.dropsCancelledReplyChunk(conversationId, update)) return;
    if (isTurnsOwnToolCall(update)) this.showHeldBackReply(conversationId);
    this.trackReplyProgress(conversationId, update);
    this.append(conversationId, { type: "acp", update });
    this.followToolCalls(conversationId, update);
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
    if (isTurnsOwnToolCall(update)) turn.replyEnd = "";
    if (!isAgentReplyChunk(update) || isSubagentReport(update)) return;
    turn.awaitedUser = false;
    if (typeof update.messageId === "string") turn.lastReplyMessageId = update.messageId;
    if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text" && !isInformational(update._meta)) {
      turn.replyEnd = (turn.replyEnd + update.content.text).slice(-REPLY_END_KEPT);
    }
  }

  private followToolCalls(conversationId: string, update: acp.SessionUpdate) {
    const runtime = this.runtime(conversationId);
    if (!runtime.running) return;
    const activityBefore = this.activity(conversationId);
    const finishedOne = runtime.openToolCalls.follow(update, isSubagentReport(update));
    if (!isDeepStrictEqual(this.activity(conversationId), activityBefore)) this.publish(this.get(conversationId));
    if (finishedOne) this.steerQueuedMessages(conversationId);
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
    const keptOutBy = whatKeepsQueuedMessagesOut({
      hasSession: harness !== undefined && sessionId !== null,
      ownToolCall: this.oldestOwnToolCall(runtime),
      queueHold: this.whatHoldsQueue(runtime),
      agentSteers: (await harness?.canSteer()) ?? false,
    });
    const messages = queuedBeforeClear(runtime.queuedMessages).filter((message) => !message.afterTurn);
    this.logWhatKeepsQueuedMessagesOut(conversationId, runtime, messages.length > 0 ? keptOutBy : null);
    const [first, ...rest] = messages;
    if (keptOutBy !== null || !harness || !sessionId || !first) return;
    this.setQueue(conversationId, runtime, runtime.queuedMessages.filter((message) => !messages.includes(message)));
    this.publish(this.get(conversationId));
    const notes = this.notesForAgent(conversationId);
    const text = messages.map((message) => message.text).join("\n\n");
    const imageIds = messages.flatMap((message) => message.imageIds);
    const { turn } = runtime;
    const steeredAt = Date.now();
    this.showHeldBackReply(conversationId);
    runtime.steerInFlight = true;
    const outcome = await this.promptContent(conversationId, withNotes(notes, text), imageIds)
      .then((prompt) => harness.steer(sessionId, prompt))
      .catch((error: unknown) => `failed: ${errorMessage(error)}`);
    runtime.steerInFlight = false;
    if (outcome !== "injected") {
      console.error(`could not steer queued messages into the turn of conversation ${conversationId}, so they go back to the queue: ${outcome}`);
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
   * A turn stopped right after a steer can leave the steered messages unanswered: pi says how many in its answer to the
   * stopped turn, and for Claude Code its transcript tells which. They go back to the front of the queue, to go out as
   * the next turn.
   */
  private async returnUnansweredSteers(conversationId: string, runtime: Runtime, steered: SteeredMessages[], response?: acp.PromptResponse) {
    const conversation = this.store.findConversation(conversationId);
    if (!conversation || steered.length === 0) return;
    const unanswered = (response && steersLeftUnread(response, steered)) ?? (await this.steersUnansweredInTranscript(conversation, steered));
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

  /** The canvas keeps what happened there that the agent has not heard of: the user's ticks, the errors of pages nobody saw shown. */
  hearCanvasNotesFrom(canvasNotesOf: (conversationId: string) => CanvasNote[]) {
    this.canvasNotesOf = canvasNotesOf;
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
    const runtime = this.runtime(conversationId);
    const toolCall = withReportedToolCall(request.toolCall, this.store.toolCallReports(conversationId, request.toolCall.toolCallId));
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
      const workspace = this.existingWorkspace(this.get(conversationId).workspaceId);
      return await editDiffsOf(toolCall, [await recordedDirectory(workspace), workspace.path]);
    } catch {
      return undefined;
    }
  }

  private handleHarnessExit(harness: HarnessProcess) {
    this.harnessesByProfile.forEach((current, key) => {
      if (current === harness) this.harnessesByProfile.delete(key);
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
      if (openTurnTheAgentWorkedOn(this.store.listEvents(id))) this.store.appendEvent(id, { type: "turn-end", stopReason: "cancelled" });
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
   * answered as its tool result; only one whose answer was always to be the next message still asks for one.
   */
  private cancelAsksOrphanedByRestart() {
    this.store
      .listCanvasItemsWithStatus("waiting")
      .filter((item): item is AskItem => item.kind === "ask")
      .filter((item) => this.store.findConversation(item.conversationId)?.askMode !== "next-message")
      .forEach((item) => this.store.saveCanvasItem({ ...item, status: "cancelled" }));
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
    if (runtime.usageLimit !== undefined) return "the queue waits for the usage limit to reset";
    if (runtime.steerInFlight) return "messages are on their way into the turn";
    return null;
  }

  /** Returns the failure's message. A turn Claude's usage limit stopped holds the queue until the limit resets. */
  private recordTurnFailure(conversationId: string, error: unknown, promptSent: boolean) {
    const continuable = promptSent && { continuable: true as const };
    const conversation = this.store.findConversation(conversationId);
    if (!conversation || !isUsageLimitError(error, conversation.harness)) {
      this.append(conversationId, { type: "error", message: errorMessage(error), ...continuable, ...(isAuthRequiredError(error) && { authRequired: true as const }) });
      return errorMessage(error);
    }
    const message = usageLimitMessage(error);
    const resetsAt = usageLimitResetIn(message);
    this.append(conversationId, { type: "error", message, usageLimit: { resetsAt }, ...continuable });
    this.waitForUsageLimitReset(conversationId, resetsAt);
    return message;
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
    if (!runtime.queuedMessages.some(({ id }) => id === messageId)) throw new Error("That message was already sent.");
    this.setQueue(conversationId, runtime, change(runtime.queuedMessages));
    this.publish(this.get(conversationId));
  }

  /** A turn that started meanwhile, e.g. while a /clear opened the fresh session, sends the queue on once it ends. */
  private sendNextQueuedMessage(conversationId: string) {
    const runtime = this.store.hasConversation(conversationId) ? this.runtime(conversationId) : undefined;
    const [next, ...rest] = runtime?.queuedMessages ?? [];
    if (!runtime || !next || runtime.running || this.holdsQueue(runtime)) return;
    this.setQueue(conversationId, runtime, rest);
    this.prompt(conversationId, next.text, { imageIds: next.imageIds, fromScript: next.fromScript, fromPlugin: next.fromPlugin, startsTurn: true }).catch(() => {});
  }

  private appendUserMessage(
    conversationId: string,
    { text, imageIds, fromScript, fromPlugin }: Omit<QueuedMessage, "id">,
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
      ...(fromPlugin && { fromPlugin }),
    });
  }

  private retitleFromFirstMessage(conversationId: string, text: string) {
    const conversation = this.get(conversationId);
    if (conversation.title !== UNTITLED || conversation.titleSetByUser) return;
    const firstLine = text.trim().split("\n")[0] ?? "";
    const title = cutWithEllipsis(firstLine, TITLE_LENGTH - 1, TITLE_LENGTH);
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
    return stored.seq;
  }

  private notifyTurnEnded(conversationId: string, outcome: TurnOutcome) {
    if (!this.store.hasConversation(conversationId)) return;
    const reason = turnEndReason(outcome, {
      messagesQueued: this.runtime(conversationId).queuedMessages.length > 0,
      resumedByAJob: this.jobWaits.in(conversationId).some(({ resume }) => resume),
    });
    if (!reason || this.stopping) return;
    this.notifications.notify(conversationId, reason);
    if (this.hub.isWatched(conversationId)) return;
    this.unseenTurnEnds.set(conversationId, reason.kind);
    this.store.setUnseenTurnEnd(conversationId, reason.kind);
    this.keepLastWords(conversationId);
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

  /** Every conversation `waitingFor` could find waiting, from the three things it reads, so counting reads no database. */
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

  private setStatus(conversationId: string, status: ConversationStatus, statusDetail: string | null = null) {
    if (!this.store.hasConversation(conversationId)) return;
    this.statusOverrides.set(conversationId, { status, statusDetail });
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
    this.hub.announceWaiting(this.waiting());
  }

  private announceRunningTurnsCount() {
    this.hub.announceRunningTurnsCount(this.runningTurnsCount());
  }
}


/**
 * Claude Code keeps no record of a session until the agent works on a message in it, so a session without a finished
 * turn, agent output or replayed history cannot be resumed. Since a /clear, only what came after it counts.
 */
export function sessionHasRecord(events: StoredEvent[]) {
  const sinceCleared = events.slice(events.findLastIndex(({ event }) => event.type === "context-cleared") + 1);
  return sinceCleared.some(({ event }) => event.type === "turn-end" || (event.type === "acp" && updatesTheAgentRecords.has(event.update.sessionUpdate)));
}

interface TurnRequest {
  /** The message that started the turn and those that joined it, as one. */
  text: string;
  firstText: string;
  imageIds: string[];
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
export function stopsAtAnnouncedStep(replyEnd: string): boolean {
  return /:[*_\s]*$/.test(replyEnd);
}

/** Whether the last turn in the log is over because the agent finished it, and not because a stop cut it short, it failed, or it is still open. */
export function agentFinishedItsTurn(events: StoredEvent[]): boolean {
  const began = events.findLastIndex(({ event }) => event.type === "user-message" || endsTurn({ event }));
  const end = events[began]?.event;
  return end?.type === "turn-end" && end.stopReason !== "cancelled";
}

function turnRequestWithin(events: StoredEvent[], wholeLog: StoredEvent[]): TurnRequest | null {
  const returned = returnedSteerSeqs(wholeLog);
  const messages = events.flatMap(({ seq, event }) => (event.type === "user-message" && !returned.has(seq) ? [event] : []));
  const [first] = messages;
  if (!first) return null;
  return { text: messages.map(({ text }) => text).join("\n\n"), firstText: first.text, imageIds: messages.flatMap(({ imageIds = [] }) => imageIds) };
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

/** Messages queued after a /clear wait for it, rather than join the turn in the session it ends. */
export const queuedBeforeClear = (queue: QueuedMessage[]) => {
  const clearAt = queue.findIndex(({ text }) => isClearCommand(text));
  return clearAt === -1 ? queue : queue.slice(0, clearAt);
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
