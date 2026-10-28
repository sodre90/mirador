import type {
  ContentBlock,
  ImageContent,
  Notice,
  PermissionOption,
  SessionUpdate,
  PlanEntry,
  StopReason,
  ToolCallContent,
  ToolCallLocation,
  ToolCallStatus,
  ToolCallUpdate,
  ToolKind,
} from "@agentclientprotocol/sdk";
import { hookNoticeIn } from "./hook-message.ts";
import { jobWaitEndedNotice } from "./job-waits.ts";
import { harnessLabels, type HarnessId, type StoredEvent } from "./model.ts";
import type { EditDiff } from "./review.ts";
import { turnTitle, whatWasLeft } from "./reverts.ts";
import { leavesFailedTurnBehind, offersTryAgain } from "./try-again.ts";
import { UserCommandLog, type UserCommand } from "./user-commands.ts";

function profileChangedNotice(profileName: string | null, agent: HarnessId | undefined) {
  if (!profileName) return "Now using the agent's own setup, without a profile";
  return agent ? `Now using ${harnessLabels[agent]}, with the profile “${profileName}”` : `Now using the profile “${profileName}”`;
}

/** The stored event a block starts with: its sequence number keys the block, and its time is the block's time. */
export interface Origin {
  key: string;
  at: number;
}

export interface ToolBlock extends Origin {
  kind: "tool";
  toolCallId: string;
  title: string;
  toolKind?: ToolKind | null;
  status?: ToolCallStatus | null;
  content: ToolCallContent[];
  locations: ToolCallLocation[];
  rawInput?: unknown;
  rawOutput?: unknown;
  /** A command's output and exit code as pi-acp sends them, in the update's `_meta` rather than its content. */
  terminalOutput?: string;
  terminalExitCode?: number;
  toolName?: string;
  endedAt?: number;
  /** The turn it belongs to ended with the call still unfinished. */
  leftUnfinished?: true;
  /** Set on the Agent (or Task) tool call that started a subagent. */
  subagent?: Subagent;
  /** Claude Code answered the call at once and left its subagent working on, as it does for subagents by default. */
  launchedInBackground?: true;
}

/** What a subagent did, kept under the tool call that started it: claude-agent-acp marks its updates with that call's id. */
export interface Subagent {
  blocks: TimelineBlock[];
  lastActivityAt: number;
  /** How the turn that started it ended, once it has. */
  turnEnded: StopReason | null;
  /** How it ended, when claude-agent-acp said: one in the background can end before the turn that started it. */
  ended?: Exclude<SubagentState, "running">;
}

export type SubagentBlock = ToolBlock & { subagent: Subagent };

export type SubagentState = "running" | "done" | "failed" | "stopped";

const SUBAGENT_TOOLS = new Set(["Agent", "Task", "subagent"]);

export const subagentInput = (block: ToolBlock) => {
  const input = (block.rawInput ?? {}) as { description?: unknown; prompt?: unknown; subagent_type?: unknown; agent?: unknown; model?: unknown };
  return {
    description: input.description,
    prompt: input.prompt,
    subagent_type: input.subagent_type ?? input.agent,
    model: input.model,
  };
};

export const runsInBackground = (block: ToolBlock) => block.launchedInBackground === true;

/**
 * A subagent works until its tool call completes; one started in the background, whose call completes at once, works
 * until claude-agent-acp says it ended, or else until the turn that started it ends, since claude-agent-acp holds the
 * turn open for it.
 */
export function subagentState(block: SubagentBlock, conversationBusy: boolean): SubagentState {
  if (block.status === "failed") return "failed";
  if (!runsInBackground(block) && block.status === "completed") return "done";
  const { ended, turnEnded } = block.subagent;
  if (ended) return ended;
  if (turnEnded) return turnEnded === "end_turn" ? "done" : "stopped";
  return conversationBusy ? "running" : "stopped";
}

/** When the subagent stopped working: its last activity when it ran in the background, else when its call completed. */
export const subagentEndedAt = (block: SubagentBlock) =>
  runsInBackground(block) ? block.subagent.lastActivityAt : (block.endedAt ?? block.subagent.lastActivityAt);

const isServerToolCall = (block: ToolBlock) => block.toolCallId.startsWith("srvtoolu_");

/**
 * The calls of a running subagent's work still at work: claude-agent-acp reports them pending until they end. The API
 * runs a server tool, such as the advisor, within its reply, so once anything follows one it has ended, even when
 * Claude Code never said so.
 */
export function stepsAtWork(work: TimelineBlock[], waitingForPermission: ReadonlySet<string> = new Set()): Set<string> {
  const unfinished = work.flatMap((block, index) =>
    block.kind === "tool" && block.endedAt === undefined && !waitingForPermission.has(block.toolCallId) && !(isServerToolCall(block) && index < work.length - 1)
      ? [block.toolCallId]
      : [],
  );
  return new Set(unfinished);
}

export const toolCallsAwaitingPermission = (timeline: TimelineBlock[]) =>
  new Set(timeline.flatMap((block) => (block.kind === "permission" && !block.resolved ? [block.toolCall.toolCallId] : [])));

export const approvalsWaiting = (timeline: TimelineBlock[]) => timeline.filter((block): block is PermissionBlock => block.kind === "permission" && !block.resolved);

/** The subagent whose tool call the approval is for; none when the agent asks for its own. */
export const subagentAsking = (timeline: TimelineBlock[], approval: PermissionBlock) =>
  subagentsIn(timeline).find((block) => block.subagent.blocks.some((child) => child.kind === "tool" && child.toolCallId === approval.toolCall.toolCallId));

/**
 * The calls at work in the conversation's own timeline: those of the turn still open, not waiting for the user's
 * permission. A background subagent works on after its turn ends, so its card keeps to stepsAtWork.
 */
export function stepsRunning(timeline: TimelineBlock[]): Set<string> {
  const leftUnfinished = new Set(timeline.flatMap((block) => (block.kind === "tool" && block.leftUnfinished ? [block.toolCallId] : [])));
  return new Set([...stepsAtWork(timeline, toolCallsAwaitingPermission(timeline))].filter((toolCallId) => !leftUnfinished.has(toolCallId)));
}

/** Every subagent in the timeline in the order they started, each followed by the ones it started. */
export function subagentsIn(blocks: TimelineBlock[]): SubagentBlock[] {
  return blocks.flatMap((block) => (block.kind === "tool" && block.subagent ? [block as SubagentBlock, ...subagentsIn(block.subagent.blocks)] : []));
}

export interface PermissionBlock extends Origin {
  kind: "permission";
  permissionId: string;
  toolCall: ToolCallUpdate;
  options: PermissionOption[];
  edits?: EditDiff[];
  resolved: boolean;
  chosenOptionId: string | null;
}

type PlanBlock = Origin & { kind: "plan"; entries: PlanEntry[] };

/** Images a message carried in the agent's own updates: ones the agent sent, or those of a session's replayed history. */
type CarriedImages = { images?: ImageContent[] };

/**
 * What an agent's `notice` update said, shown as a line of its own rather than as the agent's reply: a title that
 * stands alone, optional detail whose line breaks are its own, and how loudly to say it.
 */
export interface AgentNoticeBlock extends Origin {
  kind: "agent-notice";
  severity: string;
  title: string;
  description?: string;
}

/** The word a screen reader says before a notice that stands out, which the page shows by its colour alone. */
export const spokenSeverity = ({ severity }: Pick<AgentNoticeBlock, "severity">) => (severity === "error" ? "Error" : severity === "warning" ? "Warning" : null);

export type TimelineBlock =
  | (Origin & { kind: "agent" | "thought" | "notice" | "info"; text: string } & CarriedImages)
  | (Origin & { kind: "user"; text: string; imageIds?: string[]; fromScript?: true; fromPlugin?: string; turnSeq?: number; filesKept?: true } & CarriedImages)
  | AgentNoticeBlock
  | ToolBlock
  | PlanBlock
  | PermissionBlock
  | (Origin & { kind: "command"; command: UserCommand })
  | ErrorBlock;

/**
 * `authRequired` until a sign-in started from the conversation succeeds, then `signedInSince`.
 * `tryAgainSeq`: the error ended the latest turn, which the user can try again by naming this error.
 */
type ErrorBlock = Origin & { kind: "error"; message: string; usageLimit?: true; authRequired?: true; signedInSince?: true; tryAgainSeq?: number };

/** A plugin is named by its title. */
export type Author = "user" | "script" | "agent" | { plugin: string };

export function authorOf(block: TimelineBlock | undefined): Author | null {
  if (!block || block.kind === "notice" || block.kind === "agent-notice") return null;
  if (block.kind === "user" && block.fromPlugin) return { plugin: block.fromPlugin };
  if (block.kind === "user" && block.fromScript) return "script";
  return block.kind === "user" || block.kind === "command" ? "user" : "agent";
}

const sameAuthor = (one: Author | null, other: Author | null) =>
  typeof one === "object" && one !== null && typeof other === "object" && other !== null ? one.plugin === other.plugin : one === other;

export function startsAuthorGroup(timeline: TimelineBlock[], index: number) {
  const author = authorOf(timeline[index]);
  return author !== null && !sameAuthor(author, authorOf(timeline[index - 1]));
}

type TextBlockKind = "user" | "agent" | "thought";

export function contentText(content: ContentBlock): string {
  switch (content.type) {
    case "text":
      return content.text;
    case "resource_link":
      return `[${content.name}](${content.uri})`;
    case "resource":
      return "text" in content.resource ? content.resource.text : `(binary resource ${content.resource.uri})`;
    default:
      return `(${content.type} content)`;
  }
}

/** claude-agent-acp tags hook output and similar notices this way; they are not part of the reply. */
export function isInformational(meta: { [key: string]: unknown } | null | undefined) {
  const claudeCode = meta?.claudeCode as { kind?: unknown } | undefined;
  return claudeCode?.kind === "informational";
}

const COALESCED_KEY = "mirador/coalesced";

/** Streamed chunks the host sends as one chunk: how many, and where and when the first one came. */
interface Coalesced {
  chunks: number;
  firstSeq: number;
  firstAt: number;
}

const coalescedIn = (update: { _meta?: { [key: string]: unknown } | null }) => (update._meta?.[COALESCED_KEY] as Coalesced | undefined) ?? null;

type Streamed = { text: string; chunks: number };

/** Some gateways follow a streamed message with one chunk that holds all of it again, under the message's id. */
const repeatsWhole = (streamed: Streamed, text: string) => streamed.chunks >= 2 && text.trim() !== "" && text === streamed.text;

class StreamedMessages {
  private readonly messages = new Map<string, Streamed>();

  soFar(messageId: string): Streamed {
    return this.messages.get(messageId) ?? { text: "", chunks: 0 };
  }

  /** Whether the text only repeats the message streamed so far; if not, it adds to the message. */
  repeats(messageId: string | null | undefined, text: string, chunks: number) {
    if (!messageId) return false;
    const streamed = this.soFar(messageId);
    const repeats = repeatsWhole(streamed, text);
    if (!repeats) this.messages.set(messageId, { text: streamed.text + text, chunks: streamed.chunks + chunks });
    return repeats;
  }
}

function claudeCodeMeta(update: { _meta?: { [key: string]: unknown } | null }) {
  const claudeCode = (update._meta?.claudeCode ?? {}) as { toolName?: unknown; parentToolUseId?: unknown; toolResponse?: { isAsync?: unknown } | null; subagentTaskStatus?: unknown };
  return {
    toolName: typeof claudeCode.toolName === "string" ? claudeCode.toolName : undefined,
    parentToolUseId: typeof claudeCode.parentToolUseId === "string" ? claudeCode.parentToolUseId : undefined,
    launchedInBackground: claudeCode.toolResponse?.isAsync === true,
    subagentTaskStatus: typeof claudeCode.subagentTaskStatus === "string" ? claudeCode.subagentTaskStatus : undefined,
  };
}

/** How a subagent ended, by the status claude-agent-acp's patch gives its task; none for one still at work, or resumed. */
const subagentEnds = new Map<string, Exclude<SubagentState, "running">>([
  ["completed", "done"],
  ["failed", "failed"],
  ["stopped", "stopped"],
  ["killed", "stopped"],
]);

function followSubagentTask(subagent: Subagent, status: string) {
  const ended = subagentEnds.get(status);
  if (ended) subagent.ended = ended;
  else delete subagent.ended;
}

interface OpencodeChild {
  id: string;
  parentID?: string;
  depth?: number;
  title?: string;
}

type ToolUpdate = ToolCallUpdate & { title?: string | null; name?: string | null };

/** Zed's convention for a command's output, which pi-acp follows: each update carries the output added since the last. */
function terminalMeta(update: ToolUpdate) {
  const meta = update._meta as { terminal_output?: { data?: unknown } | null; terminal_exit?: { exit_code?: unknown } | null } | null | undefined;
  const output = meta?.terminal_output?.data;
  const exitCode = meta?.terminal_exit?.exit_code;
  return { output: typeof output === "string" ? output : "", exitCode: typeof exitCode === "number" ? exitCode : undefined };
}

const OPENCODE_SUBAGENT_TOOL = "subagent";

/** opencode puts the id of the child session that made a call before the call's id; the conversation's own calls have none. */
const opencodeSessionOfCall = (toolCallId: string) => /^(ses_[^:]+):/.exec(toolCallId)?.[1] ?? null;

function opencodeChildMeta(update: { _meta?: { [key: string]: unknown } | null } | SessionUpdate): OpencodeChild | null {
  const meta = "_meta" in update ? update._meta : undefined;
  const child = meta?.["opencode/child-session"] as { id?: unknown; parentID?: unknown; depth?: unknown; title?: unknown } | undefined;
  if (child && typeof child.id === "string") {
    return {
      id: child.id,
      ...(typeof child.parentID === "string" && { parentID: child.parentID }),
      ...(typeof child.depth === "number" && { depth: child.depth }),
      ...(typeof child.title === "string" && { title: child.title }),
    };
  }
  const session = "toolCallId" in update && typeof update.toolCallId === "string" ? opencodeSessionOfCall(update.toolCallId) : null;
  return session ? { id: session } : null;
}

/** opencode puts the title of the child session that made a call before the call's own title. */
function ownTitle(update: ToolUpdate) {
  const childTitle = opencodeChildMeta(update)?.title;
  return childTitle && update.title?.startsWith(`${childTitle}: `) ? update.title.slice(childTitle.length + 2) : update.title;
}

const toolNameIn = (update: ToolUpdate, title = ownTitle(update)) =>
  typeof update.name === "string" ? update.name : title && SUBAGENT_TOOLS.has(title) ? title : undefined;

/** As a subagent's call ends, its result names the session: `<subagent sessionID="…">`, or `(sessionID: …)` when it failed, was cancelled or went on in the background. */
const OPENCODE_SESSION_NAMED = /sessionID(?:="|: )(ses_[\w-]+)/;

const opencodeSessionNamedIn = (content: ToolCallContent[]) =>
  content.map((item) => (item.type === "content" && item.content.type === "text" ? OPENCODE_SESSION_NAMED.exec(item.content.text)?.[1] : undefined)).find(Boolean);

/** The subagent call each opencode child session is the work of, for the sessions whose calls' results name them. */
function opencodeCallBySession(events: StoredEvent[]) {
  const toolUpdates = events.flatMap(({ event }) =>
    event.type === "acp" && (event.update.sessionUpdate === "tool_call" || event.update.sessionUpdate === "tool_call_update") ? [event.update] : [],
  );
  const subagentCalls = new Set(toolUpdates.filter((update) => toolNameIn(update) === OPENCODE_SUBAGENT_TOOL).map((update) => update.toolCallId));
  const callBySession = new Map<string, string>();
  for (const update of toolUpdates) {
    const session = update.content && subagentCalls.has(update.toolCallId) ? opencodeSessionNamedIn(update.content) : undefined;
    if (session && !callBySession.has(session)) callBySession.set(session, update.toolCallId);
  }
  return callBySession;
}

/** A child of depth 1 is started by one of the conversation's own calls, a deeper one by a call of its parent session. */
function madeByParentOf(block: ToolBlock, child: OpencodeChild) {
  if (child.depth === undefined) return true;
  return opencodeSessionOfCall(block.toolCallId) === (child.depth > 1 ? child.parentID : null);
}

/** A reply as short as "Done." can turn up inside an unrelated error message by chance. */
const SHORTEST_ERROR_ECHO = 16;

class TimelineBuilder {
  readonly blocks: TimelineBlock[] = [];
  private readonly toolBlocks = new Map<string, ToolBlock>();
  private readonly permissionBlocks = new Map<string, PermissionBlock>();
  private currentPlan: PlanBlock | null = null;
  private readonly subagentsOfThisTurn: Subagent[] = [];
  private readonly toolsOfThisTurn: ToolBlock[] = [];
  private readonly subagentByOpencodeSession = new Map<string, Subagent>();
  private readonly takenSubagents = new Set<Subagent>();
  private readonly callsNamingASession: Set<string>;
  private readonly commands = new UserCommandLog();
  private readonly errorsAwaitingSignIn: ErrorBlock[] = [];
  private failedTurn: ErrorBlock | null = null;
  private readonly streamedMessages = new StreamedMessages();
  /** What each turn began with, for the note a revert leaves. */
  private readonly messageTexts = new Map<number, string>();

  constructor(private readonly opencodeCallBySession: Map<string, string>) {
    this.callsNamingASession = new Set(opencodeCallBySession.values());
  }

  add({ seq, at, event }: StoredEvent) {
    const origin = { key: String(seq), at };
    this.commands.apply(event);
    if (leavesFailedTurnBehind(event)) this.leaveFailedTurnBehind();
    switch (event.type) {
      case "user-command":
        return this.push({ kind: "command", ...origin, command: this.commands.get(event.commandId)! });
      case "user-command-output":
      case "user-command-ended":
      case "user-command-dropped":
        return;
      case "steered-messages-returned":
        return this.dropUserBlocks(event.seqs);
      case "user-message":
        this.currentPlan = null;
        this.messageTexts.set(seq, event.text);
        return this.push({
          kind: "user",
          ...origin,
          text: event.text,
          ...(event.imageIds && { imageIds: event.imageIds }),
          ...(event.fromScript && { fromScript: event.fromScript }),
          ...(event.fromPlugin && { fromPlugin: event.fromPlugin }),
          ...(seq > 0 && { turnSeq: seq }),
          ...(event.checkpoint && { filesKept: true as const }),
        });
      case "files-kept": {
        const message = this.blocks.findLast((block) => block.kind === "user" && block.key === String(event.turnSeq));
        if (message?.kind === "user") message.filesKept = true;
        return;
      }
      case "revert":
        return this.push({
          kind: "notice",
          ...origin,
          text: [`Files put back to how they were before the turn of “${this.messageAt(event.toSeq)}”.`, whatWasLeft(event)].filter(Boolean).join(" "),
        });
      case "turn-end":
        this.endTurn(event.stopReason);
        if (event.stopReason === "end_turn") return;
        return this.push({ kind: "notice", ...origin, text: `Turn ended: ${event.stopReason.replaceAll("_", " ")}` });
      case "error": {
        this.endTurn("cancelled");
        this.dropAgentEchoOf(event.message);
        const block: ErrorBlock = {
          kind: "error",
          ...origin,
          message: event.message,
          ...(event.usageLimit && { usageLimit: true as const }),
          ...(event.authRequired && { authRequired: true as const }),
        };
        if (block.authRequired) this.errorsAwaitingSignIn.push(block);
        if (offersTryAgain(event)) {
          this.leaveFailedTurnBehind();
          block.tryAgainSeq = seq;
          this.failedTurn = block;
        }
        return this.push(block);
      }
      case "login-ended":
        if (event.signedIn) this.errorsAwaitingSignIn.splice(0).forEach((block) => (block.signedInSince = true));
        return this.push({ kind: "notice", ...origin, text: event.signedIn ? "Signed in. Send your message again." : "Signing in did not finish." });
      case "usage-limit-wait-stopped":
        return this.push({ kind: "notice", ...origin, text: "Stopped waiting for the usage limit to reset" });
      case "job-wait-ended":
        return this.push({ kind: "notice", ...origin, text: jobWaitEndedNotice(event.wait, event.end) });
      case "context-cleared":
        return this.push({ kind: "notice", ...origin, text: "Context cleared: the agent starts afresh" });
      case "profile-changed":
        return this.push({ kind: "notice", ...origin, text: profileChangedNotice(event.profileName, event.agent) });
      case "permission": {
        const block: PermissionBlock = {
          kind: "permission",
          ...origin,
          permissionId: event.permissionId,
          toolCall: event.toolCall,
          options: event.options,
          ...(event.edits && { edits: event.edits }),
          resolved: false,
          chosenOptionId: null,
        };
        this.permissionBlocks.set(event.permissionId, block);
        return this.push(block);
      }
      case "permission-resolved": {
        const block = this.permissionBlocks.get(event.permissionId);
        if (block) Object.assign(block, { resolved: true, chosenOptionId: event.optionId });
        return;
      }
      case "acp":
        return this.addUpdate(coalescedOrigin(event.update) ?? origin, event.update, at);
    }
  }

  /** The start of the message a turn began with, which a revert's note names; a turn not loaded yet has none. */
  private messageAt(seq: number) {
    return turnTitle(this.messageTexts.get(seq) ?? "");
  }

  private addUpdate(origin: Origin, update: SessionUpdate, at: number) {
    const subagent = this.subagentOf(update, at);
    if (subagent) subagent.lastActivityAt = at;
    const into = subagent?.blocks ?? this.blocks;
    switch (update.sessionUpdate) {
      case "user_message_chunk":
        if (update.content.type === "image") return this.appendImage("user", origin, update.content, into);
        return this.appendText("user", origin, contentText(update.content), into);
      case "agent_message_chunk":
        if (update.content.type === "image") return this.appendImage("agent", origin, update.content, into);
        if (isInformational(update._meta)) return this.push({ kind: "info", ...origin, text: contentText(update.content) }, into);
        if (this.streamedMessages.repeats(update.messageId, contentText(update.content), coalescedIn(update)?.chunks ?? 1)) return;
        return this.appendText("agent", origin, contentText(update.content), into);
      case "agent_thought_chunk":
        return this.appendText("thought", origin, contentText(update.content), into);
      case "tool_call":
      case "tool_call_update":
        return this.upsertTool(origin, update, into);
      case "plan":
        if (subagent) return;
        if (this.currentPlan) {
          this.currentPlan.entries = update.entries;
          return;
        }
        this.currentPlan = { kind: "plan", ...origin, entries: update.entries };
        return this.push(this.currentPlan);
      case "current_mode_update":
        return this.push({ kind: "notice", ...origin, text: `Mode: ${update.currentModeId}` });
      case "notice":
        return this.push(agentNoticeBlock(origin, update), into);
      default:
        return;
    }
  }

  /** The subagent that made the update, when its tool call is known. */
  private subagentOf(update: SessionUpdate, at: number) {
    const { parentToolUseId } = claudeCodeMeta(update);
    if (parentToolUseId) return this.toolBlocks.get(parentToolUseId)?.subagent;
    const child = opencodeChildMeta(update);
    return child ? this.opencodeSubagent(child, at) : undefined;
  }

  /**
   * A child session's work goes under the call that started it. Until a call can be taken to be that one, the work is
   * held aside, where nothing shows it, rather than shown as the conversation's own.
   */
  private opencodeSubagent(child: OpencodeChild, at: number) {
    const known = this.subagentByOpencodeSession.get(child.id);
    if (known) return known;
    const subagent = this.callNaming(child.id)?.subagent ?? this.likelyCallOf(child)?.subagent ?? { blocks: [], lastActivityAt: at, turnEnded: null };
    this.subagentByOpencodeSession.set(child.id, subagent);
    this.takenSubagents.add(subagent);
    return subagent;
  }

  private callNaming(sessionId: string) {
    const toolCallId = this.opencodeCallBySession.get(sessionId);
    return toolCallId === undefined ? undefined : this.toolBlocks.get(toolCallId);
  }

  /** A call whose result names no session yet: one of the parent's that still runs and no session took, best one about the child's title. */
  private likelyCallOf(child: OpencodeChild) {
    const candidates = [...this.toolBlocks.values()].filter((block) => this.mayHaveStarted(block, child));
    return candidates.find((block) => child.title !== undefined && subagentInput(block).description === child.title) ?? candidates[0];
  }

  private mayHaveStarted(block: ToolBlock, child: OpencodeChild) {
    return (
      block.toolName === OPENCODE_SUBAGENT_TOOL &&
      block.subagent !== undefined &&
      block.endedAt === undefined &&
      !this.takenSubagents.has(block.subagent) &&
      !this.callsNamingASession.has(block.toolCallId) &&
      madeByParentOf(block, child)
    );
  }

  /** Whether the turn ended of its own accord, was stopped, or was cut short by an error: its subagents end with it. */
  private endTurn(stopReason: StopReason) {
    this.currentPlan = null;
    this.subagentsOfThisTurn.splice(0).forEach((subagent) => (subagent.turnEnded = stopReason));
    this.toolsOfThisTurn.splice(0).filter((block) => block.endedAt === undefined).forEach((block) => (block.leftUnfinished = true));
  }

  private dropUserBlocks(seqs: number[]) {
    const keys = new Set(seqs.map(String));
    const kept = this.blocks.filter((block) => block.kind !== "user" || !keys.has(block.key));
    this.blocks.splice(0, this.blocks.length, ...kept);
  }

  private leaveFailedTurnBehind() {
    delete this.failedTurn?.tryAgainSeq;
    this.failedTurn = null;
  }

  /** Claude Code says an API error as the agent's message, and the failed prompt reports it again as an error. */
  private dropAgentEchoOf(errorMessage: string) {
    const last = this.blocks.at(-1);
    const echo = last?.kind === "agent" ? last.text.trim() : "";
    if (echo.length >= SHORTEST_ERROR_ECHO && errorMessage.includes(echo)) this.blocks.pop();
  }

  private appendText(kind: TextBlockKind, origin: Origin, text: string, into: TimelineBlock[]) {
    const last = into.at(-1);
    if (last && last.kind === kind) {
      last.text += text;
      return;
    }
    this.push({ kind, ...origin, text }, into);
  }

  private appendImage(kind: "user" | "agent", origin: Origin, image: ImageContent, into: TimelineBlock[]) {
    const last = into.at(-1);
    if (last && last.kind === kind) {
      last.images = [...(last.images ?? []), image];
      return;
    }
    this.push({ kind, ...origin, text: "", images: [image] }, into);
  }

  private upsertTool(origin: Origin, update: ToolUpdate, into: TimelineBlock[]) {
    const existing = this.toolBlocks.get(update.toolCallId);
    const ends = update.status === "completed" || update.status === "failed";
    const { toolName, launchedInBackground, subagentTaskStatus } = claudeCodeMeta(update);
    const title = ownTitle(update);
    const name = toolName ?? toolNameIn(update, title);
    const background = launchedInBackground || (update.rawInput as { background?: unknown } | undefined)?.background === true;
    const terminal = terminalMeta(update);
    if (existing) {
      if (name) this.name(existing, name, origin.at);
      if (background) existing.launchedInBackground = true;
      if (title) existing.title = title;
      if (update.kind) existing.toolKind = update.kind;
      if (update.status) existing.status = update.status;
      if (ends) existing.endedAt = origin.at;
      if (update.content) existing.content = update.content;
      if (update.locations) existing.locations = update.locations;
      if (update.rawInput !== undefined) existing.rawInput = update.rawInput;
      if (update.rawOutput !== undefined) existing.rawOutput = update.rawOutput;
      if (terminal.output) existing.terminalOutput = (existing.terminalOutput ?? "") + terminal.output;
      if (terminal.exitCode !== undefined) existing.terminalExitCode = terminal.exitCode;
      if (existing.subagent && subagentTaskStatus) followSubagentTask(existing.subagent, subagentTaskStatus);
      return;
    }
    const block: ToolBlock = {
      kind: "tool",
      ...origin,
      toolCallId: update.toolCallId,
      title: title ?? "Tool call",
      toolKind: update.kind,
      status: update.status,
      content: update.content ?? [],
      locations: update.locations ?? [],
      rawInput: update.rawInput,
      rawOutput: update.rawOutput,
      ...(terminal.output && { terminalOutput: terminal.output }),
      ...(terminal.exitCode !== undefined && { terminalExitCode: terminal.exitCode }),
      ...(ends && { endedAt: origin.at }),
      ...(background && { launchedInBackground: true }),
    };
    if (name) this.name(block, name, origin.at);
    this.toolBlocks.set(update.toolCallId, block);
    this.toolsOfThisTurn.push(block);
    this.push(block, into);
  }

  /** The name may come with a later update of the call; a subagent's work gathers under its call from then on. */
  private name(block: ToolBlock, toolName: string, at: number) {
    block.toolName = toolName;
    if (!SUBAGENT_TOOLS.has(toolName) || block.subagent) return;
    block.subagent = { blocks: [], lastActivityAt: at, turnEnded: null };
    this.subagentsOfThisTurn.push(block.subagent);
  }

  private push(block: TimelineBlock, into = this.blocks) {
    into.push(block);
  }
}

/**
 * A notice as a block of its own. Hook output arrives with its "<Hook> says:" prefix on every line, which the block
 * says once, in its title, so the lines themselves read as the hook said them.
 */
function agentNoticeBlock(origin: Origin, update: Notice): AgentNoticeBlock {
  const hook = hookNoticeIn(update.title, update.description);
  const description = hook ? hook.lines.join("\n") : update.description;
  return {
    kind: "agent-notice",
    ...origin,
    severity: update.severity,
    title: hook ? `${hook.hook} hook` : update.title,
    ...(description ? { description } : {}),
  };
}

const coalescedOrigin = (update: SessionUpdate): Origin | null => {
  const coalesced = "_meta" in update ? coalescedIn(update) : null;
  return coalesced && { key: String(coalesced.firstSeq), at: coalesced.firstAt };
};

/** The newest plan the agent itself made, not one of its subagents'; a plan it emptied leaves the one before it standing. */
export function latestPlan(events: StoredEvent[]): PlanEntry[] | null {
  const update = events.findLast(({ event }) => {
    if (event.type !== "acp" || event.update.sessionUpdate !== "plan") return false;
    return event.update.entries.length > 0 && !claudeCodeMeta(event.update).parentToolUseId && !opencodeChildMeta(event.update);
  });
  return update?.event.type === "acp" && update.event.update.sessionUpdate === "plan" ? update.event.update.entries : null;
}

export function buildTimeline(events: StoredEvent[]): TimelineBlock[] {
  const builder = new TimelineBuilder(opencodeCallBySession(events));
  events.forEach((event) => builder.add(event));
  return builder.blocks;
}

type ChunkUpdate = Extract<SessionUpdate, { sessionUpdate: "agent_message_chunk" | "agent_thought_chunk" }>;

/** Streamed text of the reply or of the thinking, which may go out together with the chunks before it. */
function coalescibleChunk({ event }: StoredEvent): { update: ChunkUpdate; text: string } | null {
  if (event.type !== "acp") return null;
  const { update } = event;
  if (update.sessionUpdate !== "agent_message_chunk" && update.sessionUpdate !== "agent_thought_chunk") return null;
  return update.content.type === "text" && !isInformational(update._meta) ? { update, text: update.content.text } : null;
}

/** A chunk of the reply that the timeline checks for a repeat of the whole message. */
function countedChunk({ event }: StoredEvent): { messageId: string; text: string } | null {
  if (event.type !== "acp" || event.update.sessionUpdate !== "agent_message_chunk") return null;
  const { messageId, content, _meta } = event.update;
  return messageId && content.type !== "image" && !isInformational(_meta) ? { messageId, text: contentText(content) } : null;
}

const sameMessage = (update: ChunkUpdate, other: ChunkUpdate) =>
  update.sessionUpdate === other.sessionUpdate && update.messageId === other.messageId && JSON.stringify(update._meta ?? null) === JSON.stringify(other._meta ?? null);

/** Consecutive chunks of one message, with nothing between them, that go out as one. */
class ChunkRun {
  private readonly texts: string[];
  private length: number;
  private last: StoredEvent;

  constructor(
    private readonly first: StoredEvent,
    private readonly update: ChunkUpdate,
    text: string,
    private readonly streamedBefore: Streamed | null,
  ) {
    this.texts = [text];
    this.length = text.length;
    this.last = first;
  }

  /** The timeline would read the run as a repeat of the whole message if it came to hold just that. */
  takes(update: ChunkUpdate, text: string) {
    return sameMessage(update, this.update) && !this.wouldRepeatWhole(text);
  }

  private wouldRepeatWhole(text: string) {
    if (!this.streamedBefore || this.length + text.length !== this.streamedBefore.text.length) return false;
    return repeatsWhole(this.streamedBefore, this.texts.join("") + text);
  }

  add(stored: StoredEvent, text: string) {
    this.texts.push(text);
    this.length += text.length;
    this.last = stored;
  }

  /** Under the last chunk's number, so a phone that asks for what came after it gets none of them again. */
  asEvent(): StoredEvent {
    if (this.texts.length === 1) return this.first;
    const coalesced: Coalesced = { chunks: this.texts.length, firstSeq: this.first.seq, firstAt: this.first.at };
    const content = { ...(this.update.content as Extract<ContentBlock, { type: "text" }>), text: this.texts.join("") };
    return { seq: this.last.seq, at: this.last.at, event: { type: "acp", update: { ...this.update, content, _meta: { ...this.update._meta, [COALESCED_KEY]: coalesced } } } };
  }
}

/**
 * Agents stream their replies and thinking a few words per chunk, each stored as an event of its own; a long
 * conversation holds hundreds of thousands. Sent as one chunk per message, its history is a fraction of the size, and
 * its timeline the same. The events must start at a turn, so no message's chunks start before them.
 */
export function withChunksCoalesced(events: StoredEvent[]): StoredEvent[] {
  const coalesced: StoredEvent[] = [];
  const streamed = new StreamedMessages();
  let run: ChunkRun | null = null;
  const endRun = () => {
    if (run) coalesced.push(run.asEvent());
    run = null;
  };
  for (const stored of events) {
    const counted = countedChunk(stored);
    const streamedBefore = counted && streamed.soFar(counted.messageId);
    const chunk = coalescibleChunk(stored);
    const repeat = counted !== null && streamed.repeats(counted.messageId, counted.text, 1);
    if (!chunk || repeat) {
      endRun();
      coalesced.push(stored);
    } else if (run?.takes(chunk.update, chunk.text)) {
      run.add(stored, chunk.text);
    } else {
      endRun();
      run = new ChunkRun(stored, chunk.update, chunk.text, streamedBefore);
    }
  }
  endRun();
  return coalesced;
}

/**
 * The events with one more that streamed in, its chunk joined to the chunks before it as withChunksCoalesced joins
 * them, so a conversation followed for hours holds one event per message rather than one per chunk.
 */
export function withStreamedEvent(events: StoredEvent[], stored: StoredEvent): StoredEvent[] {
  const joined = joinedToLastRun(events, stored);
  return joined ? [...events.slice(0, -1), joined] : [...events, stored];
}

function joinedToLastRun(events: StoredEvent[], stored: StoredEvent): StoredEvent | null {
  const last = events.at(-1);
  const chunk = coalescibleChunk(stored);
  const run = last && coalescibleChunk(last);
  if (!last || !chunk || !run || !sameMessage(chunk.update, asFirstChunk(run.update))) return null;
  const counted = countedChunk(stored);
  if (counted && !joinsWithoutRepeating(events, counted.messageId, run.text + chunk.text, counted.text)) return null;
  const coalesced = coalescedIn(run.update);
  const joinedRun: Coalesced = { chunks: (coalesced?.chunks ?? 1) + 1, firstSeq: coalesced?.firstSeq ?? last.seq, firstAt: coalesced?.firstAt ?? last.at };
  const content = { ...(run.update.content as Extract<ContentBlock, { type: "text" }>), text: run.text + chunk.text };
  return { seq: stored.seq, at: stored.at, event: { type: "acp", update: { ...run.update, content, _meta: { ...run.update._meta, [COALESCED_KEY]: joinedRun } } } };
}

/** A joined run's update as its first chunk had it, which the chunks after it are compared with. */
function asFirstChunk(update: ChunkUpdate): ChunkUpdate {
  if (!coalescedIn(update)) return update;
  const { [COALESCED_KEY]: _, ...meta } = update._meta!;
  return { ...update, _meta: Object.keys(meta).length > 0 ? meta : undefined };
}

/**
 * Whether withChunksCoalesced would have kept the last event's run going with this chunk: the run is not a lone repeat
 * of the message, the chunk doesn't repeat all of it, and the run would not come to hold just what streamed before it.
 */
function joinsWithoutRepeating(events: StoredEvent[], messageId: string, joinedText: string, text: string) {
  const streamed = new StreamedMessages();
  const replay = (stored: StoredEvent) => {
    const counted = countedChunk(stored);
    return counted?.messageId === messageId && streamed.repeats(messageId, counted.text, chunksIn(stored));
  };
  events.slice(0, -1).forEach(replay);
  const beforeRun = streamed.soFar(messageId);
  if (replay(events.at(-1)!)) return false;
  const runWouldRepeatWhole = joinedText.length === beforeRun.text.length && repeatsWhole(beforeRun, joinedText);
  return !repeatsWhole(streamed.soFar(messageId), text) && !runWouldRepeatWhole;
}

const chunksIn = ({ event }: StoredEvent) => (event.type === "acp" ? (coalescedIn(event.update)?.chunks ?? 1) : 1);
