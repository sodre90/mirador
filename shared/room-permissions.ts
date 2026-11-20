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

/** A permission request as the host judges it: the tool's kind, its title, the whole command it would run, and the paths it names. */
export interface AskedPermission {
  toolKind: ToolKind | null;
  title: string;
  command: string | null;
  paths: string[];
}

const READING: (ToolKind | null)[] = ["read", "search"];
const CHANGING_FILES: (ToolKind | null)[] = ["edit", "delete", "move"];

/**
 * Whether the host lets a request of a room's agent through by itself: reading, unless everything asks; and in the
 * workspace preset, changes to files that all lie inside the room's workspace. Commands and everything else wait for an
 * approver, since the host can't tell where a command reaches.
 */
export function allowedByPreset(preset: PermissionPreset, { toolKind, paths }: AskedPermission, insideWorkspace: (path: string) => boolean): boolean {
  if (preset === "ask-everything") return false;
  if (READING.includes(toolKind)) return true;
  return preset === "work-freely" && CHANGING_FILES.includes(toolKind) && paths.length > 0 && paths.every(insideWorkspace);
}

/**
 * What "Allow for this task" lets through until the turn ends: the same command, a tool of the same kind, or, for a tool
 * whose kind says nothing of what it does (an MCP tool, say), the same tool.
 */
export function taskAllowanceOf({ toolKind, title, command }: AskedPermission): string {
  if (toolKind === "execute") return `command ${command ?? title}`;
  if (toolKind === null || toolKind === "other") return `tool ${title}`;
  return `kind ${toolKind}`;
}
