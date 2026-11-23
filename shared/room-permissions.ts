import type { ToolKind } from "@agentclientprotocol/sdk/unstable";
import type { HarnessId } from "./model.ts";

/** What a room's agents may do without asking, as the room's owner chose it. */
export type PermissionPreset = "ask-everything" | "read-freely" | "work-freely";

export const PERMISSION_PRESETS: PermissionPreset[] = ["ask-everything", "read-freely", "work-freely"];

export const DEFAULT_PERMISSION_PRESET: PermissionPreset = "read-freely";

export type RoomApprovalAnswer = "allow" | "allow-for-task" | "deny";

export const isPermissionPreset = (value: unknown): value is PermissionPreset => PERMISSION_PRESETS.includes(value as PermissionPreset);

/**
 * The agent's own mode each preset runs a room's conversation in, as each agent offered them in November 2026: Claude
 * Code's and Antigravity's default modes ask before edits and commands, and their accept-edits modes let edits inside
 * the folder through (Claude Code's its filesystem commands there too); Codex's read-only mode sandboxes commands to
 * reading and asks before edits, and its workspace mode lets edits and sandboxed commands inside the folder through. The
 * other agents have no mode for it: what they ask, the host answers by the tool's kind.
 */
const presetModes: Record<HarnessId, Record<PermissionPreset, string> | null> = {
  claude: { "ask-everything": "default", "read-freely": "default", "work-freely": "acceptEdits" },
  antigravity: { "ask-everything": "default", "read-freely": "default", "work-freely": "accept-edits" },
  codex: { "ask-everything": "read-only", "read-freely": "read-only", "work-freely": "workspace-write" },
  opencode: null,
  pi: null,
  copilot: null,
};

/** The mode a room's conversation on this agent runs in; null where the agent has none for the preset, and keeps its profile's. */
export const presetModeOf = (harness: HarnessId, preset: PermissionPreset) => presetModes[harness]?.[preset] ?? null;

/**
 * The profile's mode for an agent brought into someone else's room, which asks as usual: kept where it is one of the modes
 * a room's preset runs that agent in, so one that never asks gives way to the agent's own default.
 */
export const askingModeOf = (harness: HarnessId, mode: string | undefined | null) => {
  const asking = presetModes[harness];
  return !mode || !asking || Object.values(asking).includes(mode) ? (mode ?? undefined) : undefined;
};

/** The agent's own mode that asks before edits and commands alike; null for an agent with no modes for a room's presets. */
export const askingDefaultModeOf = (harness: HarnessId) => presetModes[harness]?.["ask-everything"] ?? null;

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
  const parts = path.toLowerCase().split(/[\\/]+/);
  return parts.includes(".claude") || CLAUDE_SETUP_FILES.includes(parts.at(-1) ?? "");
};

/** A tool that would change what Claude Code's later sessions in the workspace load. */
export const changesClaudeSetup = ({ toolKind, paths }: AskedPermission, placeOf: (path: string) => string | null) =>
  !READING.includes(toolKind) && paths.some((path) => holdsClaudeSetup(path) || holdsClaudeSetup(placeOf(path) ?? ""));

/**
 * Whether the host lets a request of a room's agent through by itself: reading files that all lie inside the room's
 * workspace, unless everything asks; and in the workspace preset, changes to such files too. A read or search that names
 * no path asks, as it may reach anywhere; so do commands and everything else, since the host can't tell where a command
 * reaches. `freelyReachable` says whether a path lies where the room's agents may go unasked.
 */
export function allowedByPreset(preset: PermissionPreset, { toolKind, paths }: AskedPermission, freelyReachable: (path: string) => boolean): boolean {
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
