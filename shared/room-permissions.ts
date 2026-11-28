import type { SessionConfigOption, SessionConfigSelectGroup, SessionConfigSelectOption, ToolKind } from "@agentclientprotocol/sdk/unstable";
import { asDisksCompare } from "./disk-names.ts";
import type { Conversation, HarnessId } from "./model.ts";
import { isSideChat, sideChatModeOf } from "./side-chats.ts";

/** What a room's agents may do without asking, as the room's owner chose it. */
export type PermissionPreset = "ask-everything" | "read-freely" | "work-freely" | "never-asks";

export const PERMISSION_PRESETS: PermissionPreset[] = ["ask-everything", "read-freely", "work-freely", "never-asks"];

export const DEFAULT_PERMISSION_PRESET: PermissionPreset = "read-freely";

export type RoomApprovalAnswer = "allow" | "allow-for-task" | "deny";

const ROOM_APPROVAL_ANSWERS: RoomApprovalAnswer[] = ["allow", "allow-for-task", "deny"];

export const isRoomApprovalAnswer = (value: unknown): value is RoomApprovalAnswer => ROOM_APPROVAL_ANSWERS.includes(value as RoomApprovalAnswer);

export const isPermissionPreset = (value: unknown): value is PermissionPreset => PERMISSION_PRESETS.includes(value as PermissionPreset);

/**
 * The agent's own mode each preset runs a room's conversation in, as each agent offered them in November 2026: Claude
 * Code's and Antigravity's default modes ask before edits and commands, and their accept-edits modes let edits inside
 * the folder through (Claude Code's its filesystem commands there too); Codex's read-only mode sandboxes commands to
 * reading and asks before edits, and its workspace mode lets edits and sandboxed commands inside the folder through. The
 * other agents have no mode for it: what they ask, the host answers by the tool's kind. Never asking takes working
 * freely's mode, and the host answers all the agent still asks; none of the modes that skip asking, so a brought agent's
 * profile mode is judged by these alone.
 */
const presetModes: Record<HarnessId, Record<PermissionPreset, string> | null> = {
  claude: { "ask-everything": "default", "read-freely": "default", "work-freely": "acceptEdits", "never-asks": "acceptEdits" },
  antigravity: { "ask-everything": "default", "read-freely": "default", "work-freely": "accept-edits", "never-asks": "accept-edits" },
  codex: { "ask-everything": "read-only", "read-freely": "read-only", "work-freely": "workspace-write", "never-asks": "workspace-write" },
  opencode: null,
  pi: null,
  copilot: null,
};

/** The mode a room's conversation on this agent runs in; null where the agent has none for the preset, and keeps its profile's. */
export const presetModeOf = (harness: HarnessId, preset: PermissionPreset) => presetModes[harness]?.[preset] ?? null;

/**
 * The mode of an agent brought into someone else's room, whose text it works on and which it asks as usual: its profile's
 * where that is one of the modes a room's preset runs that agent in, otherwise the one that asks before edits and commands
 * alike, as the agent's own default, or what the user's own settings start it in, may not ask. An agent with no modes for
 * a room's presets keeps its profile's.
 */
export const askingModeOf = (harness: HarnessId, mode: string | undefined | null) => {
  const asking = presetModes[harness];
  if (!asking) return mode ?? undefined;
  return mode && Object.values(asking).includes(mode) ? mode : asking["ask-everything"];
};

/** The agent's own mode that asks before edits and commands alike; null for an agent with no modes for a room's presets. */
export const askingDefaultModeOf = (harness: HarnessId) => presetModes[harness]?.["ask-everything"] ?? null;

/** Whether the mode is one a room's presets run that agent in, or any where the agent has none. */
export const isAskingMode = (harness: HarnessId, mode: string) => {
  const asking = presetModes[harness];
  return !asking || Object.values(asking).includes(mode);
};

type ModeRuled = Pick<Conversation, "harness" | "broughtIntoRoom" | "worksInRoomsWorkspace" | "sideChatOf" | "sideChatMayChangeFiles">;

/**
 * Whether the conversation may be switched to this mode: a side chat held to reading only to its agent's read-only mode,
 * where the agent has one, and a brought agent's conversation only as `allowsBroughtMode` says.
 */
export function allowsMode(conversation: ModeRuled, mode: string): boolean {
  const readOnlyMode = sideChatModeOf(conversation.harness);
  if (isSideChat(conversation) && !conversation.sideChatMayChangeFiles && readOnlyMode !== null) return mode === readOnlyMode;
  return allowsBroughtMode(conversation, mode);
}

/**
 * Whether a brought agent's conversation may be switched to this mode: only the asking default for one working in the
 * room's workspace, and any mode a room's preset runs the agent in for one working in the bringer's workspace.
 */
function allowsBroughtMode(conversation: Pick<Conversation, "harness" | "broughtIntoRoom" | "worksInRoomsWorkspace">, mode: string): boolean {
  if (!conversation.broughtIntoRoom) return true;
  if (conversation.worksInRoomsWorkspace) {
    const only = askingDefaultModeOf(conversation.harness);
    return only === null || mode === only;
  }
  return isAskingMode(conversation.harness, mode);
}

/**
 * A config option as the conversation's settings offer it: the Mode picker of a brought agent or of a side chat held to
 * reading lists only modes it may run in, keeping the current one if the agent reported another.
 */
export function offeredConfigOption(conversation: ModeRuled, option: SessionConfigOption): SessionConfigOption {
  if (option.category !== "mode" || option.type !== "select") return option;
  const keep = ({ value }: SessionConfigSelectOption) => allowsMode(conversation, value) || value === option.currentValue;
  const isGrouped = (entries: typeof option.options): entries is SessionConfigSelectGroup[] => entries.length > 0 && "group" in entries[0]!;
  const options = isGrouped(option.options)
    ? option.options.flatMap((group) => {
        const kept = group.options.filter(keep);
        return kept.length > 0 ? [{ ...group, options: kept }] : [];
      })
    : option.options.filter(keep);
  return { ...option, options };
}

/** A permission request as the host judges it: the tool's kind, its title, the whole command it would run, and the paths it names. */
export interface AskedPermission {
  toolKind: ToolKind | null;
  title: string;
  command: string | null;
  paths: string[];
}

const READING: (ToolKind | null)[] = ["read", "search"];
const CHANGING_FILES: (ToolKind | null)[] = ["edit", "delete", "move"];

/** A tool that reads or changes files, which may reach any of them when it names none. */
export const worksOnFiles = (toolKind: ToolKind | null) => READING.includes(toolKind) || CHANGING_FILES.includes(toolKind);

const CLAUDE_SETUP_FILES = ["claude.md", "claude.local.md", ".mcp.json"];

/** Where Claude Code finds what its later sessions load, hooks, allowed commands and MCP servers among it: a `.claude` folder, a CLAUDE.md or .mcp.json, named in any case. */
export const holdsClaudeSetup = (path: string) => {
  const parts = path.split(/[\\/]+/).map(asDisksCompare);
  return parts.includes(".claude") || CLAUDE_SETUP_FILES.includes(parts.at(-1) ?? "");
};

/** A tool that would change what Claude Code's later sessions in the workspace load. */
export const changesClaudeSetup = ({ toolKind, paths }: AskedPermission, placeOf: (path: string) => string | null) =>
  !READING.includes(toolKind) && paths.some((path) => holdsClaudeSetup(path) || holdsClaudeSetup(placeOf(path) ?? ""));

/** The preset under which the room's agents ask for nothing at all, wherever it reaches, Mirador's own data included. */
export const asksForNothing = (preset: PermissionPreset) => preset === "never-asks";

/**
 * Whether the host lets a request of a room's agent through by itself: reading files that all lie inside the room's
 * workspace, unless everything asks; and in the workspace preset, changes to such files too. A read or search that names
 * no path asks, as it may reach anywhere; so do commands and everything else, since the host can't tell where a command
 * reaches. `freelyReachable` says whether a path lies where the room's agents may go unasked. Under never asking, all
 * goes through.
 */
export function allowedByPreset(preset: PermissionPreset, { toolKind, paths }: AskedPermission, freelyReachable: (path: string) => boolean): boolean {
  if (asksForNothing(preset)) return true;
  if (preset === "ask-everything") return false;
  const reachesOnlyFreely = paths.length > 0 && paths.every(freelyReachable);
  if (READING.includes(toolKind)) return reachesOnlyFreely;
  return preset === "work-freely" && CHANGING_FILES.includes(toolKind) && reachesOnlyFreely;
}

/**
 * What "Allow for this task" lets through until the turn ends: the same command, a tool of the same kind, or, for a tool
 * whose kind says nothing of what it does (an MCP tool, say), the same tool. A tool that reads or changes files it lets
 * through only inside the workspace, as `reachedByTaskAllowance` says.
 */
export function taskAllowanceOf({ toolKind, title, command }: AskedPermission): string {
  if (toolKind === "execute") return `command ${command ?? title}`;
  if (toolKind === null || toolKind === "other") return `tool ${title}`;
  return `kind ${toolKind}`;
}

/** "Allow for this task" lets a tool that reads or changes files reach only those inside the room's workspace: one that names a path outside, or none, asks each time. */
export const reachedByTaskAllowance = ({ toolKind, paths }: AskedPermission, freelyReachable: (path: string) => boolean) =>
  !worksOnFiles(toolKind) || (paths.length > 0 && paths.every(freelyReachable));
