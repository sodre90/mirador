import type { HarnessId } from "./model.ts";
import { parseEnvironment } from "./profile-environment.ts";
import { switchedOn } from "./room-agent-setup.ts";

/**
 * Whether a room's agents run in a light VM of their own rather than on this computer, and whether they work there
 * without asking or under the room's permission preset still. Its network is only the model and Mirador.
 */
export interface RoomSandbox {
  on: boolean;
  workFreely: boolean;
}

export const NO_SANDBOX: RoomSandbox = { on: false, workFreely: true };

export function roomSandboxIn(value: unknown): RoomSandbox {
  const named = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  return { on: named.on === true, workFreely: named.workFreely !== false };
}

/** Turning the sandbox on, or "work freely" off in it, leaves an agent with less: its turn under way stops at once. */
export const narrowsSandbox = (before: RoomSandbox, after: RoomSandbox) => (!before.on && after.on) || (before.on && after.on && before.workFreely && !after.workFreely);

/** Why this computer can't run sandboxes at all. */
export type SandboxUnavailable = "not-a-mac" | "not-apple-silicon" | "macos-too-old" | "no-container-tool" | "turned-off";

export type SandboxAvailability = { available: true } | { available: false; why: SandboxUnavailable };

/** Why a room can't have its sandbox, as it is set up now; each one is said at the switch. */
export type SandboxBlocker =
  | { kind: "agent-kind-coming"; agent: string; harness: HarnessId }
  | { kind: "agent-signs-in-elsewhere"; agent: string; how: SignInElsewhere }
  | { kind: "workspace-not-a-repository" }
  | { kind: "workspace-is-worktree" }
  | { kind: "workspace-has-commondir" }
  | { kind: "worktree-points-elsewhere"; worktree: string }
  | { kind: "git-part-is-link"; part: string }
  | { kind: "config-includes-workspace-file"; file: string }
  | { kind: "workspace-is-home" }
  | { kind: "workspace-holds-mirador-data" }
  | { kind: "workspace-is-mirador" };

/** Why a room can't have its sandbox: this computer's reason, and each of its agents' and its workspace's. */
export interface SandboxCheck {
  availability: SandboxAvailability;
  blockers: SandboxBlocker[];
}

/** Why a sandboxed room's agent did not start: it never starts on this computer instead. */
export type SandboxNotReadyWhy =
  | { kind: "unavailable"; why: SandboxUnavailable }
  | { kind: "blocked"; blocker: SandboxBlocker }
  | { kind: "setup-failed"; cause: string }
  | { kind: "could-not-start"; cause: string }
  | { kind: "no-claude-code-version" }
  | { kind: "versions-differ" }
  | { kind: "not-ready-in-time"; seconds: number }
  | { kind: "too-many-held-changes"; most: number };

/** How a Claude profile signs in that the sandbox's model proxy can't stand in for. */
export type SignInElsewhere = "subscription" | "bedrock" | "vertex" | "foundry";

/** The variables whose value is the key the model proxy adds, each in the header Anthropic's API reads it from. */
export const MODEL_KEY_VARIABLES = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"] as const;

export type ModelKeyVariable = (typeof MODEL_KEY_VARIABLES)[number];

/** The agent kinds a sandbox runs in this version. */
export const runsInSandbox = (harness: HarnessId) => harness === "claude";

/** How a Claude agent with this environment signs in, when the model proxy can't add its key for it: null when it can. */
export function signInElsewhere(environment: Record<string, string>): SignInElsewhere | null {
  if (switchedOn(environment.CLAUDE_CODE_USE_BEDROCK)) return "bedrock";
  if (switchedOn(environment.CLAUDE_CODE_USE_VERTEX)) return "vertex";
  if (switchedOn(environment.CLAUDE_CODE_USE_FOUNDRY)) return "foundry";
  return MODEL_KEY_VARIABLES.some((name) => environment[name]?.trim()) ? null : "subscription";
}

/** The key variable a profile's environment text sets, as the model proxy reads it. */
export const modelKeyVariableOf = (environment: Record<string, string>): ModelKeyVariable | null => MODEL_KEY_VARIABLES.find((name) => environment[name]?.trim()) ?? null;

export const profileEnvironmentSet = (environmentText: string) => parseEnvironment(environmentText).set;

/** Where first use of the sandbox stands: the service, then the image, built on this computer. */
export type SandboxSetupStage = "not-started" | "starting-service" | "building-image" | "ready" | "failed";

export interface SandboxSetup {
  stage: SandboxSetupStage;
  /** While the image builds: the step it is on, of how many, as the build says. */
  step?: { at: number; of: number };
  /** Only when it failed: what went wrong, in a line. */
  problem?: string;
}

export const SETUP_NOT_STARTED: SandboxSetup = { stage: "not-started" };

/**
 * An agent's config file in the workspace that the sandbox changed, put back as it was and held for the owner's OK:
 * its path from the workspace with /, and whether it was added, changed or deleted. Its text comes on request.
 */
export interface HeldChange {
  id: string;
  roomId: string;
  path: string;
  /** The room's agents at work when it came, by profile id; the change may be any of theirs. */
  agents: string[];
  kind: "add" | "change" | "delete";
  /** Too long, or not text, to be shown as a diff. */
  unshown?: true;
  at: number;
}

/** A held change's text before and as proposed, null where there was or is no file; or that it can't be shown. */
export type HeldChangeText = { before: string | null; after: string | null } | { unshown: true };

/** The most changes a room's sandbox holds: past that, its VM stops until the owner has answered some. */
export const HELD_CHANGES_MOST = 100;

export type HeldChangeAnswer = "allow" | "discard";

export const isHeldChangeAnswer = (value: unknown): value is HeldChangeAnswer => value === "allow" || value === "discard";

/** The most of a held file's text a page is shown. */
export const HELD_TEXT_SHOWN = 100_000;

const AGENT_CONFIG_FOLDERS = [".claude", ".codex", ".opencode", ".pi"];
const AGENT_CONFIG_FILES = ["claude.md", "claude.local.md", "agents.md", ".mcp.json", "opencode.json", "opencode.jsonc"];
const RUN_BY_THEMSELVES_FOLDERS = [".husky", ".githooks", ".vscode"];
const RUN_BY_THEMSELVES_FILES = [".pre-commit-config.yaml", "lefthook.yml", "lefthook.yaml", ".lefthook.yml", ".lefthook.yaml", "lefthook-local.yml", "lefthook-local.yaml", ".envrc"];
const HELD_FOLDERS = [...AGENT_CONFIG_FOLDERS, ...RUN_BY_THEMSELVES_FOLDERS];
const HELD_FILES = [...AGENT_CONFIG_FILES, ...RUN_BY_THEMSELVES_FILES];
const NEVER_HELD_FOLDERS = [".git", "node_modules"];

/** Whether a folder of the workspace is one git and installed packages keep their own, which the held files never reach into. */
export const isNeverHeldFolder = (name: string) => NEVER_HELD_FOLDERS.includes(name.toLowerCase());

/**
 * Whether a path of the workspace, from it with /, is one of the files agents read their settings, instructions or MCP
 * servers from, or one that runs by itself (git hooks, editor tasks, direnv), at any depth; the repository's own folder
 * and installed packages are not looked at.
 */
export function isHeldConfigPath(path: string): boolean {
  const parts = path.toLowerCase().split("/").filter(Boolean);
  if (parts.length === 0 || parts.some((part) => NEVER_HELD_FOLDERS.includes(part))) return false;
  const joined = `/${parts.join("/")}/`;
  return HELD_FOLDERS.some((folder) => joined.includes(`/${folder}/`)) || HELD_FILES.includes(parts.at(-1)!);
}

/** Whether everything in a folder of the workspace is held, as in a held folder, each file of it on its own. */
export const holdsAllInside = (path: string) => isHeldConfigPath(`${path}/_`);

/** Files in the repository's own folder that bring in config of the sandbox's making: they never stay. */
export const GIT_CONFIG_REDIRECTS = ["commondir", "config.worktree"];
