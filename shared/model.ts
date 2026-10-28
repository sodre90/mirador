import type {
  PermissionOption,
  SessionConfigOption,
  SessionUpdate,
  StopReason,
  ToolCallUpdate,
  ToolKind,
} from "@agentclientprotocol/sdk";
import type { ConversationReply, PluginItemPlacement } from "./canvas-plugins.ts";
import type { EditDiff } from "./review.ts";
import type { TerminalLayout } from "./terminal-layout.ts";

export type HarnessId = "claude" | "opencode" | "pi";

export const harnessLabels: Record<HarnessId, string> = {
  claude: "Claude Code",
  opencode: "opencode",
  pi: "pi",
};

export const harnessIds = Object.keys(harnessLabels) as HarnessId[];

/**
 * Whether the agent can be sent back to a point in its own session, which is what takes a conversation back to an
 * earlier turn. Claude Code and pi answer the fork point Mirador names; opencode takes `session/fork` but ignores the
 * point, so it would copy the whole session rather than leave anything behind.
 */
export const harnessRewinds: Record<HarnessId, boolean> = { claude: true, opencode: false, pi: true };

export type AskMode = "wait" | "next-message";

export const askModeLabels: Record<AskMode, string> = {
  wait: "Agent waits for my answer",
  "next-message": "My answer is sent as the next message",
};

/** Another machine's Mirador opened from this one, e.g. a server the agents keep working on while this computer sleeps. */
export interface Machine {
  id: string;
  name: string;
  origin: string;
  createdAt: number;
  /** Where this host shows the machine on this computer; null until it first does. */
  relayPort: number | null;
  /** This host has joined the machine and signs in there as one of its devices. */
  joined: boolean;
  /** To tell the machine apart in the rail. */
  color: Pastel | null;
}

/** What this host last heard from a joined machine: whether it answers, and what each conversation waiting for you there waits for. */
export interface MachineStatus {
  machineId: string;
  reachable: boolean;
  waiting: WaitingFor[];
}

/** A device that asked to join this machine, waiting for someone to approve it by typing the number it shows. */
export interface JoinRequest {
  id: string;
  name: string;
  /** The network address it asked from. */
  fromAddress: string;
  /** Who it is signed in to Tailscale as, when it asked through tailscale serve. */
  tailscaleUser: string | null;
  expiresAt: number;
}

/** Another browser or app that joined this machine with an invite; it signs in with a token of its own, which revoking it ends. */
export interface Device {
  id: string;
  name: string;
  joinedAt: number;
  /** When it last connected or left. */
  lastSeenAt: number;
}

/** Where a device reaches the host from: its address, and its Tailscale login when it comes through `tailscale serve`. */
export interface ClientAddress {
  fromAddress: string;
  tailscaleUser: string | null;
}

/** A joined device's connections to the host right now, and where the latest one comes from. */
export interface DeviceConnection extends ClientAddress {
  /** Pages of the app open on it; none while only the desktop or phone app listens in the background. */
  pages: number;
}

export interface ListedDevice extends Device {
  connection: DeviceConnection | null;
}

/** Where other devices reach a host, and where its canvas pages load their libraries from. */
export interface PublicAddress {
  origin: string;
  canvasOrigin: string;
}

/** An address that answered as this Mirador, and where the search found it. */
export interface FoundAddress extends PublicAddress {
  /** tailnet: this machine's own name on its tailnet. devices: an address some device already reached it at. */
  how: "tailnet" | "devices";
}

/** How other devices reach a host, as it runs and as saved for its next start; the environment's settings can't be changed in Settings. */
export interface ReachabilitySettings {
  publicAddress: PublicAddress | null;
  savedPublicAddress: PublicAddress | null;
  publicAddressSetByEnvironment: boolean;
  /** The ports this host serves on: its own pages, and the libraries canvas pages load. */
  port: number;
  canvasAssetsPort: number;
  /** Whether the host listens for other devices over HTTPS itself, and on which port. */
  network: boolean;
  savedNetwork: boolean;
  networkSetByEnvironment: boolean;
  networkPort: number;
  networkCanvasPort: number;
  /** What is saved differs from what the host runs with. */
  restartNeeded: boolean;
  /** Of the certificate authority Mirador made for itself; invite links carry it so joining machines can pin it. */
  authorityFingerprint: string | null;
}

/** An entry of a conversation that holds the query, with the line around its first occurrence. */
export interface SearchHit {
  entryKey: string;
  at: number;
  snippet: { before: string; match: string; after: string };
}

/** An entry of a conversation's timeline, by its key, and how often a query occurs in it. */
export interface EntryMatchCount {
  key: string;
  count: number;
}

/** Its newest hits first. */
export interface ConversationMatches {
  conversationId: string;
  matches: number;
  hits: SearchHit[];
}

/** A prompt the user sends often, with {{parameters}} filled in each time. */
export interface PromptTemplate {
  id: string;
  name: string;
  text: string;
  createdAt: number;
}

export interface Profile {
  id: string;
  name: string;
  /** Fixed once created: the profile's conversations keep running on this agent. */
  harness: HarnessId;
  environment: string;
  prelaunch: string;
  /** The agent's mode a conversation takes when it starts with the profile or moves to it; null leaves the agent's own. */
  mode: string | null;
  /** The agent's effort level, taken like the mode; skipped when the conversation's model does not offer it. */
  effort: string | null;
  /** YOLO, taken like the mode. */
  bypassPermissions: boolean;
  /** Questions, taken like the mode. */
  askMode: AskMode;
  /** Shown as a dot wherever the profile is named, so a workspace on the wrong one stands out. */
  color: Pastel | null;
  /** What it set for plugins' profile settings, by plugin and setting id; a setting it didn't set has its default. */
  pluginSettings?: Record<string, Record<string, string>>;
  createdAt: number;
}

/** What a new conversation starts: a profile, on its agent. No profile only until the first one is set up. */
export interface Launch {
  harness: HarnessId;
  profileId: string | null;
}

/** A profile's name, then its agent's unless the name already is it. */
export function launchLabel(launch: Launch, profiles: Profile[]): string {
  const profile = profiles.find(({ id }) => id === launch.profileId);
  if (!profile) return "No profile";
  const agent = harnessLabels[profile.harness];
  return profile.name === agent ? agent : `${profile.name} · ${agent}`;
}

export type ConversationStatus = "idle" | "starting" | "running" | "error";

/** What Claude Code is doing with the conversation's session in a terminal, when it is open in one too. */
export type TerminalActivity = "working" | "waiting" | "idle";

export const terminalActivityLabels: Record<TerminalActivity, string> = { working: "working", waiting: "waiting for you", idle: "idle" };

export type Pastel = "rose" | "peach" | "butter" | "mint" | "teal" | "sky" | "lavender" | "lilac";

export const pastelLabels: Record<Pastel, string> = {
  rose: "Rose",
  peach: "Peach",
  butter: "Butter",
  mint: "Mint",
  teal: "Teal",
  sky: "Sky",
  lavender: "Lavender",
  lilac: "Lilac",
};

export const isPastel = (value: unknown): value is Pastel => typeof value === "string" && Object.hasOwn(pastelLabels, value);

/** How readily Claude Code puts things on the canvas: "often" adds guidance to its system prompt. */
export type CanvasUse = "as-needed" | "often";

export const canvasUseLabels: Record<CanvasUse, string> = { "as-needed": "As needed", often: "Often" };

/** The Claude Code the host runs: `configured` is the path set in Settings, empty to find claude on its own. */
export interface ClaudeProgram {
  configured: string;
  found: string | null;
  version: string | null;
  /** Where the host looks for claude after PATH, and the command that installs Claude Code, both for the host's platform. */
  installFolders: string;
  installCommand: string;
}

export const isCanvasUse = (value: unknown): value is CanvasUse => typeof value === "string" && Object.hasOwn(canvasUseLabels, value);

export interface Workspace {
  id: string;
  name: string;
  path: string;
  defaultLaunch: Launch;
  /** Picked by the user to tell workspaces apart in the sidebar. */
  color: Pastel | null;
  /** Its place in the sidebar's one order of workspaces and groups: among its group's workspaces, or among the groups and the workspaces in none. */
  position: number;
  /** The group it is shown in, or null for one among the groups. */
  groupId: string | null;
  createdAt: number;
}

/** A folding heading in the sidebar for some of the workspaces, e.g. a project's or a client's. */
export interface WorkspaceGroup {
  id: string;
  name: string;
  /** Its place in the order it shares with the workspaces in no group. */
  position: number;
  createdAt: number;
}

/** What putting a workspace's files back to how they were before a turn does. */
export interface RestorePlan {
  restored: number;
  removed: number;
  /** Submodules that moved since: a restore leaves them as they are, since their files are their own repository's. */
  submodulesLeft?: number;
  /** Files that commits since changed, which a restore leaves as committed. */
  committed?: CommittedFiles;
}

/**
 * The files that differ from the turn's start because commits came in since, such as a pull's: how many, how many of
 * them were edited after the commits too, and how many commits, unless HEAD went to a commit not ahead of where it was.
 */
export interface CommittedFiles {
  files: number;
  editedSince: number;
  commits: number | null;
}

/** The paths a restore would touch, by what it does to them, for a dialog to list. */
export interface RestoreFiles {
  /** Created since, so a restore deletes them. */
  deleted: ListedPaths;
  putBack: ListedPaths;
  /** Changed by commits since, so a restore leaves them. */
  committed: ListedPaths;
}

/** The first paths of a kind, from the workspace's folder, and how many more there are. */
export interface ListedPaths {
  paths: string[];
  more: number;
}

export interface QueuedMessage {
  id: string;
  text: string;
  imageIds: string[];
  /** Posted by a script the agent started (mirador message) rather than typed by the user. */
  fromScript?: true;
  /** Sent by a plugin on its own, such as Delegate with a delegated task's reply: the plugin's title, as it was then. */
  fromPlugin?: string;
  /** Waits for the running turn to end, then goes out as the next message, instead of joining the turn (⌥Enter). */
  afterTurn?: true;
}

export interface ContextUsage {
  used: number;
  size: number;
  cost: { amount: number; currency: string } | null;
}

/** How much of a plan usage limit's window is used, 0 to 100, and when the window starts over, in epoch milliseconds. */
export interface QuotaWindow {
  usedPercent: number;
  resetsAt: number;
}

/** The usage limits of a Claude subscription: the rolling five-hour window and the weekly one. */
export interface PlanQuotas {
  fiveHour: QuotaWindow | null;
  sevenDay: QuotaWindow | null;
}

/** The host's part of a conversation's statusline; the page adds what it already knows. */
export interface StatuslineRender {
  gitBranch: string | null;
  /** Claude Code's `statusLine` command from the conversation's Claude settings, when one is set. */
  command: string | null;
  /** What the command printed, ANSI colours and all; null when it was not run or did not succeed. */
  output: string | null;
  error: string | null;
  /** The plan's usage limits as the agent last reported them for the conversation's profile; null until it has. */
  quotas: PlanQuotas | null;
}

/**
 * Why the conversation waits for you: a tool to approve, a canvas question to answer, a turn that ended (or failed) while
 * you looked elsewhere, or your own Unread mark.
 */
export type WaitingFor = "permission" | "question" | "finished" | "error" | "unread";

/** A tool the agent waits for your approval of: what it would do, and the answers the agent offers. */
export interface PendingPermissionRequest {
  kind: "permission";
  permissionId: string;
  title: string;
  /**
   * The kind of tool, as the agent says (read, edit, fetch, switch_mode for a plan…), so a list can answer a tool its
   * title says enough about and leave edits and plans to the conversation; null when the agent does not say.
   */
  toolKind: ToolKind | null;
  /**
   * The shell command it would run, cut short, and the agent's description of it; null for other tools, whose input,
   * diffs or plan only the conversation shows.
   */
  command: string | null;
  description: string | null;
  options: PermissionOption[];
}

/** A canvas question the agent waits on: its first question and that question's answers, without their pages. */
export interface PendingAsk {
  kind: "ask";
  itemId: string;
  question: string;
  choices: Pick<AskOption, "label" | "description">[];
  allowOther: boolean;
  /** How many questions it asks; the ones after the first show only in the conversation. */
  questions: number;
  /** It shows a page or previews, which only the conversation shows. */
  previews: boolean;
}

/** What the agent waits on, so a list of waiting conversations can answer it without loading their events. */
export type PendingRequest = PendingPermissionRequest | PendingAsk;

/** While Claude's usage limit is reached, queued messages wait; the agent continues by itself at `continuesAt`, or only when told to (null). */
export interface UsageLimitWait {
  resetsAt: number | null;
  continuesAt: number | null;
}

/** A job an agent left running: a process, or a Docker or Podman container. */
export type WaitedJob = { kind: "process"; pid: number } | { kind: "container"; name: string };

/** Set up by `mirador when-done`: once the job ends, its message goes to the agent as your next message, or only to you. */
export interface JobWait {
  id: string;
  job: WaitedJob;
  /** The machine the job runs on, reached over ssh; null for this one. */
  sshHost: string | null;
  message: string;
  /** The agent gets the message and carries on; otherwise only you are told. */
  resume: boolean;
  since: number;
}

/** `gave-up`: the job could not be checked for too long, e.g. its machine stopped answering, so it may still run. */
export type JobWaitEnd = "ended" | "gave-up" | "stopped";

export type AsyncTaskState = "running" | "paused" | "completed" | "failed" | "stopped";

/**
 * One of Claude Code's own background tasks, its commands started with run_in_background and the like, as the agent
 * reports them; they live and die with the agent process, so the host keeps them in memory only.
 */
export interface AsyncTask {
  id: string;
  /** What kind of task the agent says it is: "shell", "workflow", or another name. */
  taskType: string;
  description: string;
  state: AsyncTaskState;
  /** Whether the agent can still stop it; false once it ended. */
  canStop: boolean;
  /** The latest thing the agent said of the task, a progress beat or its end. */
  summary: string | null;
  /** The file the task writes its output to, once the agent names one. */
  outputFilePath: string | null;
  /** When the task appeared in Mirador; the agent's own start time does not reach us. */
  since: number;
}

/** A tool the agent waits for permission to run, or the tool call it started last that has not finished, by its title. */
export interface Activity {
  kind: "permission" | "tool";
  title: string;
}

export interface Conversation {
  id: string;
  workspaceId: string;
  harness: HarnessId;
  profileId: string | null;
  title: string;
  /** Once the user names a conversation, titles from the agent or the first message no longer replace it. */
  titleSetByUser: boolean;
  acpSessionId: string | null;
  askMode: AskMode;
  /** YOLO: the app approves whatever the agent asks permission for, without asking the user. */
  bypassPermissions: boolean;
  status: ConversationStatus;
  statusDetail: string | null;
  openInTerminal: TerminalActivity | null;
  /** The agent's latest report of its context window; kept with the conversation, so it survives a host restart and empties when its context does. */
  contextUsage: ContextUsage | null;
  /** Messages sent while the agent was busy, oldest first: each joins the running turn at the agent's next step, or waits for the turn to end. */
  queuedMessages: QueuedMessage[];
  usageLimit: UsageLimitWait | null;
  jobWaits: JobWait[];
  /** Claude Code's own background tasks it reported this agent process; kept in memory only, as they die with it. */
  asyncTasks: AsyncTask[];
  /** A question, a turn that ended unseen and an Unread mark outlast a host restart; a permission request ends with its agent. */
  waitingFor: WaitingFor | null;
  /** The permission request or question it waits for, the oldest first; worked out from those, never stored. */
  pendingRequest: PendingRequest | null;
  /** The end of what the agent said last in a turn that ended unseen, for a phone's Waiting card; worked out from its events, never stored. */
  lastWords: string | null;
  /** What the agent does now, while a turn runs; kept in memory only. */
  activity: Activity | null;
  configOptions: SessionConfigOption[];
  /** Its place among its workspace's conversations in the sidebar. */
  position: number;
  /** Only on a conversation a plugin's tool started, such as a delegated task. */
  startedBy?: StartedBy;
  /** What the user chose in its top bar for plugins' profile settings, by plugin and setting id; a setting not here follows the profile. */
  pluginSettings?: Record<string, Record<string, string>>;
  createdAt: number;
  updatedAt: number;
}

/** The conversation another one works for, which shows it above its composer and under it in the sidebar. */
export interface StartedBy {
  conversationId: string;
  plugin: string;
  /** Null until the plugin heard how its work ended, in this run of Mirador or the next. */
  reply: DelegatedReply | null;
  /** The user took it off the caller's list of delegated tasks. */
  dismissed: boolean;
}

/** How a started conversation's work ended, and the start of its agent's last message, for the caller's list. */
export interface DelegatedReply {
  ended: ConversationReply["ended"];
  opening: string | null;
}

export type CommandStream = "stdout" | "stderr";

/** Shells side by side in one tab of a workspace's terminal pane; the title is what the first shell last set, if anything. */
export const MAX_TERMINALS_PER_TAB = 4;

export interface TabTerminal {
  id: string;
  title: string | null;
}

export interface TerminalTab {
  id: string;
  name: string;
  /** In reading order. */
  terminals: TabTerminal[];
  layout: TerminalLayout;
}

export type ConversationEvent =
  | {
      type: "user-message";
      text: string;
      attachedCommandIds?: string[];
      /** Revert notes that went to the agent ahead of this message, so they are not sent again. */
      attachedRevertIds?: string[];
      imageIds?: string[];
      fromScript?: true;
      fromPlugin?: string;
      /** The workspace's files as they were when this turn started, so the turn can be undone. Older logs only: newer ones say it in files-kept. */
      checkpoint?: string;
    }
  /** The workspace's files as they were when the turn that began with the message at `turnSeq` started, so it can be undone. */
  | { type: "files-kept"; turnSeq: number; checkpoint: string }
  | { type: "user-command"; commandId: string; command: string }
  | { type: "user-command-output"; commandId: string; stream: CommandStream; text: string }
  | { type: "user-command-ended"; commandId: string; exitCode: number | null }
  | { type: "user-command-dropped"; commandIds: string[] }
  /**
   * Messages that joined a turn the user stopped before the agent answered them, by the seqs of their user-message
   * events: they go out again as the next turn and show there. `commandIds`: the commands whose output went with them.
   */
  | { type: "steered-messages-returned"; seqs: number[]; commandIds?: string[] }
  | { type: "acp"; update: SessionUpdate }
  /** `edits`: the files the tool would change, as the host found the change in each, for a request that changes files. */
  | { type: "permission"; permissionId: string; toolCall: ToolCallUpdate; options: PermissionOption[]; edits?: EditDiff[] }
  | { type: "permission-resolved"; permissionId: string; optionId: string | null }
  | { type: "turn-end"; stopReason: StopReason }
  /** `agent`: the conversation moved to another agent, which it may do before it has begun. */
  | { type: "profile-changed"; profileName: string | null; agent?: HarnessId }
  /** From here on the agent works in a fresh session, with nothing of the conversation before in its context. */
  | { type: "context-cleared" }
  /**
   * `usageLimit`: Claude's usage limit stopped the turn; it resets at `resetsAt`, when the message names a time.
   * `authRequired`: the agent refused the prompt until the user signs in again.
   * `continuable`: the error ended a turn after its message went to the agent, so the agent can continue from it.
   */
  | { type: "error"; message: string; usageLimit?: { resetsAt: number | null }; authRequired?: true; continuable?: true }
  /** The agent's sign-in, started from the conversation in a terminal tab, ended. */
  | { type: "login-ended"; signedIn: boolean }
  | { type: "usage-limit-wait-stopped" }
  /** The user put the workspace's files back to how they were before one of its turns. */
  | { type: "revert"; revertId: string; toSeq: number; restored: number; removed: number; submodulesLeft?: number; committed?: CommittedFiles }
  | { type: "job-wait-ended"; wait: JobWait; end: JobWaitEnd };

/** A harness session in a workspace directory, possibly started outside the app. */
export interface ExternalSession {
  sessionId: string;
  title: string | null;
  updatedAt: string | null;
  /** The conversation already driving this session in the app, if any. */
  conversationId: string | null;
}

export type AdoptMode = "continue" | "fork";

/** An external session found by a search, with the line of its messages that matched. */
export interface SessionSearchHit extends ExternalSession {
  match: string | null;
}

export interface StoredEvent {
  seq: number;
  at: number;
  event: ConversationEvent;
}

export interface AskOption {
  label: string;
  description?: string;
  html?: string;
  /** The one the agent recommends: marked on the canvas, and read first in a spoken conversation. */
  recommended?: boolean;
}

/** One question of an ask: what the user is asked, and what they can choose from. */
export interface AskQuestion {
  question: string;
  html?: string;
  options: AskOption[];
  allowOther?: boolean;
  /** The least width, in CSS pixels, the agent asked for each answer box. */
  optionWidth?: number;
}

/** What the user answered to one question: the option or their own words, and an optional note. */
export interface AskAnswerEntry {
  label: string;
  note?: string;
}

export type CanvasItemStatus = "shown" | "waiting" | "answered" | "cancelled";

export interface CanvasAnswer {
  /** The answer, or for several questions a short summary of all of them. */
  label: string;
  note?: string;
  /** For an ask of several questions: each answer beside its question. */
  answers?: (AskAnswerEntry & { question: string })[];
  deliveredAs: "tool-result" | "next-message";
}

export type CanvasItemKind = "show" | "ask" | "plugin";

/** What every canvas item carries, whatever its kind. */
export interface CanvasItemBase {
  id: string;
  conversationId: string;
  kind: CanvasItemKind;
  title: string;
  status: CanvasItemStatus;
  createdAt: number;
  /** When the item last changed, so a client catching up after a reconnect gets only the items that changed since. */
  updatedAt?: number;
}

export interface ShowItem extends CanvasItemBase {
  kind: "show";
  html?: string;
  /** Shown while nobody viewed the conversation, so what its first view reports goes to the agent. */
  unverified?: boolean;
  /** Script errors its first view reported, which the agent hears of with the user's next message. */
  errorsForAgent?: string[];
}

/** A question the user answers from options: the one question in the item's own fields, or several in `questions`. */
export interface AskItem extends CanvasItemBase {
  kind: "ask";
  question?: string;
  /** HTML shown above the options: the explanation or mockup the question is about. */
  html?: string;
  options?: AskOption[];
  allowOther?: boolean;
  /** The least width, in CSS pixels, the agent asked for each answer box. */
  optionWidth?: number;
  /** An ask of several questions, one page each; then `title` and `question` say so and name the first, for readers that know one question. */
  questions?: AskQuestion[];
  answer?: CanvasAnswer;
  /** Pages the agent showed since the user last wrote or answered, which a question carries so both are seen together. */
  shownBefore?: string[];
  /** The official plugin Mirador installs when the user answers Install. */
  installsPlugin?: string;
}

/** An item a plugin's tool published; the plugin's canvas view draws it in a frame. */
export interface PluginCanvasItem extends CanvasItemBase {
  kind: "plugin";
  plugin: string;
  /** Which of the plugin's kinds of item it is. */
  type: string;
  icon: string;
  placement: PluginItemPlacement;
  /** An item in the tab: how far along it is, on the tab's toggle. */
  count?: string;
  data: unknown;
  /** The user took it out of the tab; only publishing a new one brings one back. */
  dismissed?: boolean;
  /** When the agent last changed it in place, for the tab's toggle to flash. */
  agentEditedAt?: number;
  /** What came of it, in a few words, beside its title. */
  outcome?: string;
  /** A new one takes room: full screen, or where its plugin's setting of `roomSetting` says. */
  opensWithRoom?: boolean;
  roomSetting?: string;
}

export type CanvasItem = ShowItem | AskItem | PluginCanvasItem;
