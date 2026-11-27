import { asDisksCompare } from "./disk-names.ts";
import type { HarnessId } from "./model.ts";
import { switchedOn } from "./room-agent-setup.ts";

/**
 * What a sandbox reaches besides the model and Mirador, from the least to the most: nothing; the internet, but neither
 * this computer nor its networks; or those too.
 */
export const SANDBOX_NETWORKS = ["closed", "internet", "everything"] as const;

export type SandboxNetwork = (typeof SANDBOX_NETWORKS)[number];

export const isSandboxNetwork = (value: unknown): value is SandboxNetwork => SANDBOX_NETWORKS.some((network) => network === value);

/** What a sandbox reaches while it is on. */
export const networkWhileOn = ({ on, network }: SandboxSetting): SandboxNetwork | null => (on ? network : null);

export const reachesMoreThan = (network: SandboxNetwork, other: SandboxNetwork) => SANDBOX_NETWORKS.indexOf(network) > SANDBOX_NETWORKS.indexOf(other);

/**
 * Whether a room's or a workspace's agents run in a sandbox of their own rather than on this computer, whether they work
 * there without asking or under the room's permission preset, or their profile's permission mode, still, what it
 * reaches, and the image its VM runs on. Where this computer's sandbox shares its kernel, the owner allowed that for the
 * room or workspace: it is never chosen for them.
 */
export interface SandboxSetting {
  on: boolean;
  workFreely: boolean;
  allowsSharedKernel: boolean;
  network: SandboxNetwork;
  /** The owner's own image, as they named it, for the VM to run on; null for Mirador's base. */
  baseImage: string | null;
}

export const NO_SANDBOX: SandboxSetting = { on: false, workFreely: true, allowsSharedKernel: false, network: "closed", baseImage: null };

/**
 * A sandbox setting as stored or sent; a shared kernel is allowed, and a network open, only while the sandbox is on, so
 * turning it on again starts from neither. A base image is kept only where it is an image's name.
 */
export function sandboxSettingIn(value: unknown): SandboxSetting {
  const named = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const on = named.on === true;
  return {
    on,
    workFreely: named.workFreely !== false,
    allowsSharedKernel: on && named.allowsSharedKernel === true,
    network: on && isSandboxNetwork(named.network) ? named.network : "closed",
    baseImage: isImageName(named.baseImage) ? named.baseImage : null,
  };
}

const IMAGE_NAME_MOST = 255;
const REGISTRY = String.raw`[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)*(?::[0-9]+)?`;
const PATH_PART = String.raw`[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*`;
const TAG = String.raw`[\w][\w.-]{0,127}`;
const IMAGE_NAME = new RegExp(`^(?:${REGISTRY}/)?${PATH_PART}(?:/${PATH_PART})*(?::${TAG})?(?:@sha256:[a-f0-9]{64})?$`);

/** Whether this names an image as Docker reads a name, `[registry[:port]/]path[:tag][@sha256:digest]`, and nothing else. */
export const isImageName = (value: unknown): value is string => typeof value === "string" && value.length <= IMAGE_NAME_MOST && IMAGE_NAME.test(value);

const DOCKER_HUB = "docker.io";

/**
 * An image's name with what Docker takes for granted written out, as each runtime is given it alike: Docker Hub where no
 * registry is named, its `library/` for one of a single part, and `:latest` where neither a tag nor a digest is.
 */
export function fullImageName(name: string) {
  const parts = name.split("/");
  const namesRegistry = parts.length > 1 && (/[.:]/.test(parts[0]!) || parts[0] === "localhost");
  const registry = namesRegistry ? parts[0]! : DOCKER_HUB;
  const path = namesRegistry ? parts.slice(1) : parts;
  const full = [registry, ...(registry === DOCKER_HUB && path.length === 1 ? ["library"] : []), ...path].join("/");
  return /[:@]/.test(path.at(-1)!) ? full : `${full}:latest`;
}

/** The sandbox as it is to be, its network left as it is: that one is set by itself, as a change of it starts nothing afresh. */
export const keepingNetworkOf = (before: SandboxSetting, after: SandboxSetting): SandboxSetting => ({ ...after, network: before.on && after.on ? before.network : "closed" });

export const sameSandbox = (a: SandboxSetting, b: SandboxSetting) =>
  a.on === b.on && a.workFreely === b.workFreely && a.allowsSharedKernel === b.allowsSharedKernel && a.network === b.network && a.baseImage === b.baseImage;

/** Turning the sandbox on, "work freely" off in it, or a shared kernel no longer allowed leaves an agent with less: its turn under way stops at once. */
export const narrowsSandbox = (before: SandboxSetting, after: SandboxSetting) =>
  (!before.on && after.on) || (before.on && after.on && ((before.workFreely && !after.workFreely) || (before.allowsSharedKernel && !after.allowsSharedKernel)));

/**
 * What a sandbox belongs to: a room, whose agents run in it, or a workspace, whose own conversations' agents do. Each has
 * a VM of its own, which sees nothing of another's.
 */
export type SandboxOwner = { kind: "room"; id: string } | { kind: "workspace"; id: string };

export const roomSandbox = (roomId: string): SandboxOwner => ({ kind: "room", id: roomId });

export const workspaceSandbox = (workspaceId: string): SandboxOwner => ({ kind: "workspace", id: workspaceId });

export const sameOwner = (a: SandboxOwner, b: SandboxOwner) => a.kind === b.kind && a.id === b.id;

/** Whether a held change, or anything else of a sandbox, is this one's. */
export const ofSandbox = (owner: SandboxOwner) => (of: { owner: SandboxOwner }) => sameOwner(of.owner, owner);

/** Whether the sandbox is among those that stopped as they hold as many changes as one may. */
export const holdsTooMany = (holdingTooMany: SandboxOwner[], owner: SandboxOwner) => holdingTooMany.some((holding) => sameOwner(holding, owner));

/** The owner as one string, kept apart by its kind, for maps and names. */
export const ownerKey = ({ kind, id }: SandboxOwner) => `${kind}:${id}`;

export function isSandboxOwner(value: unknown): value is SandboxOwner {
  const named = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  return (named.kind === "room" || named.kind === "workspace") && typeof named.id === "string" && named.id !== "";
}

/**
 * What rooms' sandboxes are on this computer: a light VM of Apple's `container` on a Mac; on Linux a rootless Podman
 * container, which shares this computer's kernel.
 */
export type SandboxKind = "apple-container" | "podman";

/** Whether a sandbox of this kind shares this computer's kernel, which keeps the agents in less than a VM does. */
export const sharesKernel = (kind: SandboxKind) => kind === "podman";

/** Why this computer can't run sandboxes at all. */
export type SandboxUnavailable = "unsupported-system" | "not-apple-silicon" | "macos-too-old" | "no-container-tool" | "no-podman" | "podman-fails" | "podman-not-rootless" | "turned-off";

/**
 * Whether this computer runs sandboxes, of which kind, and why not where it doesn't. A Podman container runs outside
 * SELinux's confinement, which Linux may enforce here: in it, Podman would have to relabel the owner's workspace.
 */
export type SandboxAvailability =
  | { available: true; kind: "apple-container" }
  | { available: true; kind: "podman"; selinuxEnforcing: boolean }
  | { available: false; why: SandboxUnavailable };

/** Why a room or workspace can't have its sandbox, as it is set up now; each one is said at the switch. */
export type SandboxBlocker =
  | { kind: "agent-kind-coming"; agent: string; harness: HarnessId }
  | { kind: "agent-signs-in-elsewhere"; agent: string; how: SignInElsewhere }
  | { kind: "pi-model-elsewhere"; agent: string; why: PiModelElsewhere }
  | { kind: "workspace-not-a-repository" }
  | { kind: "workspace-is-worktree" }
  | { kind: "workspace-has-commondir" }
  | { kind: "worktree-points-elsewhere"; worktree: string }
  | { kind: "part-is-link"; part: string }
  /** A config file git reads, or one it includes, that a link leads to, on a way that passes the workspace. */
  | { kind: "config-read-through-link"; file: string; link: string }
  | { kind: "config-includes-missing-file"; file: string }
  | { kind: "config-includes-not-a-file"; file: string }
  /** The hooks folder git's config names is, or holds, a repository in the workspace, which agents must write to work in it. */
  | { kind: "hooks-folder-holds-repository"; folder: string }
  | { kind: "workspace-is-home" }
  | { kind: "workspace-holds-mirador-data" }
  | { kind: "workspace-is-mirador" }
  | { kind: "workspace-holds-computers-own"; folder: string }
  /** A workspace's conversation that works in a worktree of its own, which lies outside the folder its sandbox sees. */
  | { kind: "conversation-in-worktree" }
  /** Another sandbox that is on has a folder read and write that is the workspace, holds it or lies inside it. */
  | { kind: "workspace-overlaps-sandbox-folder"; folder: string }
  | { kind: "workspace-overlaps-sandbox-workspace"; folder: string }
  /** The way to the workspace follows a link inside a folder a sandbox worked in, whose agents could have made it. */
  | { kind: "way-through-link-sandbox-left"; link: string }
  /** Another Mirador on this computer has a VM that writes in the folder, on the way to the workspace, in it, or where the VM is to mount. */
  | { kind: "workspace-overlaps-other-mirador"; folder: string };

/**
 * A folder of this computer the owner added to a room's or workspace's sandbox, which its VM shows at the same path,
 * read-only unless `writable`; its path is the folder's own, without links.
 */
export interface SandboxFolder {
  path: string;
  writable: boolean;
  addedAt: number;
}

/**
 * Why a folder can't go into a sandbox: said as it is added or its access changes, and again where its VM starts
 * without it. From `needs-repository` on they hold for a folder read and write alone, which must be a git repository's
 * own top folder that no other sandbox works in, nor one this computer runs programs from.
 */
export type SandboxFolderRefusal =
  | { kind: "not-a-folder" }
  | { kind: "already-added" }
  | { kind: "path-has-colon" }
  | { kind: "outside-home" }
  | { kind: "is-home" }
  | { kind: "hidden-in-home"; entry: string }
  | { kind: "in-library" }
  | { kind: "holds-mirador-data" }
  | { kind: "is-mirador" }
  | { kind: "holds-computers-own"; folder: string }
  | { kind: "holds-sandbox-files" }
  | { kind: "overlaps-workspace" }
  | { kind: "overlaps-folder"; folder: string }
  | { kind: "now-a-link" }
  | { kind: "needs-repository" }
  | { kind: "repository-refused"; blocker: SandboxBlocker }
  | { kind: "inside-computers-own"; folder: string }
  | { kind: "overlaps-sandbox-workspace"; folder: string }
  | { kind: "overlaps-sandbox-folder"; folder: string }
  | { kind: "inside-where-a-sandbox-writes"; folder: string }
  | { kind: "held-files-refused" }
  | { kind: "could-not-mount"; cause: string };

/**
 * Where an added folder stands: in the sandbox, or to be once it starts; added while its VM runs without it, until its
 * agents' turns end; or left out as its VM last started, gone or refused.
 */
export type SandboxFolderState = { kind: "in-sandbox" } | { kind: "waiting" } | { kind: "missing" } | { kind: "refused"; refusal: SandboxFolderRefusal };

export interface ShownSandboxFolder extends SandboxFolder {
  state: SandboxFolderState;
}

/** A sandbox's added folders, oldest first, and whether a change to them waits for its agents' turns to end. */
export interface SandboxFolders {
  owner: SandboxOwner;
  folders: ShownSandboxFolder[];
  waiting: boolean;
}

/** Why a room or workspace can't have its sandbox: this computer's reason, and each of a room's agents' and its workspace's. */
export interface SandboxCheck {
  availability: SandboxAvailability;
  blockers: SandboxBlocker[];
}

/**
 * A workspace's check, with why the profile its new conversations start on can't run in its sandbox, null where it can,
 * and the profiles that can, by id.
 */
export interface WorkspaceSandboxCheck extends SandboxCheck {
  startsOn: SandboxBlocker | null;
  profilesThatRun: string[];
}

/** What a sandbox's agents need of a base image that one may lack: bash, git, and a glibc of this computer's processor, which Bun and Node.js run on. */
export type BaseImageNeed = "bash" | "git" | "glibc";

/**
 * Why the owner's base image is no use: it couldn't be pulled, nor found here; it couldn't be checked; it lacks what the
 * agents need; or an agent kind's own program, at its version, doesn't run on it.
 */
export type BaseImageProblem =
  | { kind: "pull-failed"; cause: string }
  | { kind: "could-not-check"; cause: string }
  | { kind: "lacks"; needs: BaseImageNeed[] }
  | { kind: "agent-fails"; harness: SandboxedHarness; version: string; cause: string };

/** The owner's base image, as they named it, and why it is no use. */
export interface UnusableBase {
  image: string;
  problem: BaseImageProblem;
}

/** Why a sandboxed room's or workspace's agent did not start: it never starts on this computer instead. */
export type SandboxNotReadyWhy =
  | { kind: "unavailable"; why: SandboxUnavailable }
  | { kind: "blocked"; blocker: SandboxBlocker }
  | { kind: "setup-failed"; cause: string }
  | ({ kind: "base-image-unusable" } & UnusableBase)
  | { kind: "could-not-start"; cause: string }
  | { kind: "no-agent-version"; harness: SandboxedHarness }
  | { kind: "shared-kernel-not-allowed" }
  | { kind: "not-ready-in-time"; seconds: number }
  | { kind: "too-many-held-changes"; most: number };

/** How a Claude profile signs in that the sandbox's model proxy can't stand in for. */
export type SignInElsewhere = "subscription" | "bedrock" | "vertex" | "foundry";

/** The variables whose value is the key or token the model proxy adds, each in the header Anthropic's API reads it from. */
export const MODEL_KEY_VARIABLES = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN"] as const;

export type ModelKeyVariable = (typeof MODEL_KEY_VARIABLES)[number];

/** The agent kinds a sandbox runs in this version. */
export const SANDBOXED_HARNESSES = ["claude", "pi"] as const satisfies readonly HarnessId[];

export type SandboxedHarness = (typeof SANDBOXED_HARNESSES)[number];

export const runsInSandbox = (harness: HarnessId): harness is SandboxedHarness => (SANDBOXED_HARNESSES as readonly HarnessId[]).includes(harness);

/**
 * Why the model proxy can't stand in for how a pi profile reaches its default model: it has none; it is one of pi's own
 * providers rather than one of its models.json; its provider speaks an API the proxy doesn't, or gives a model an address
 * or headers of its own; it signs in with OAuth; its key or a header comes from a command; or it has no key.
 */
export type PiModelElsewhere = "no-default-model" | "built-in-provider" | "unsupported-provider" | "signs-in" | "key-from-command" | "no-key";

/** How a Claude agent with this environment signs in, when the model proxy can't add its key for it: null when it can. */
export function signInElsewhere(environment: Record<string, string>): SignInElsewhere | null {
  if (switchedOn(environment.CLAUDE_CODE_USE_BEDROCK)) return "bedrock";
  if (switchedOn(environment.CLAUDE_CODE_USE_VERTEX)) return "vertex";
  if (switchedOn(environment.CLAUDE_CODE_USE_FOUNDRY)) return "foundry";
  return MODEL_KEY_VARIABLES.some((name) => environment[name]?.trim()) ? null : "subscription";
}

/** The key variable a profile's environment text sets, as the model proxy reads it. */
export const modelKeyVariableOf = (environment: Record<string, string>): ModelKeyVariable | null => MODEL_KEY_VARIABLES.find((name) => environment[name]?.trim()) ?? null;

/**
 * What a sandbox's VM runs from this computer's tools folder: Mirador's guard, the Bun of this computer, and each agent
 * kind's programs at the version it runs here.
 */
export type SandboxTool = { kind: "guard" } | { kind: "bun" | "node"; version: string } | { kind: SandboxedHarness; version: string };

const TOOL_PROGRAMS: Record<SandboxTool["kind"], string> = { guard: "mirador-guard", bun: "Bun", node: "Node.js", claude: "Claude Code", pi: "pi" };

/** A tool by its program's name, and its version where it has one: the same in every language. */
export const toolNameOf = (tool: SandboxTool) => ("version" in tool ? `${TOOL_PROGRAMS[tool.kind]} ${tool.version}` : TOOL_PROGRAMS[tool.kind]);

/**
 * Where setting up a sandbox stands: the service, where its kind has one; then Mirador's base image, built on this
 * computer, or the owner's own, pulled; the tools its agents need, each installed on first use; and the owner's image
 * checked for what they need.
 */
export type SandboxSetupStage = "not-started" | "starting-service" | "building-image" | "pulling-image" | "installing-tool" | "checking-image" | "ready" | "failed";

export interface SandboxSetup {
  stage: SandboxSetupStage;
  /** While the image builds: the step it is on, of how many, as the build says. */
  step?: { at: number; of: number };
  /** While a tool is installed: which. */
  tool?: SandboxTool;
  /** While the owner's base image is pulled or checked: which, as they named it. */
  image?: string;
  /** While the owner's base image is pulled: how much of it is fetched, or unpacked once fetched, out of 100, where the runtime says. */
  percent?: number;
  /** While the owner's base image is pulled: that it is fetched, and now unpacked. */
  unpacking?: boolean;
  /** Only when it failed for another reason than the owner's base image: what went wrong, in a line. */
  problem?: string;
  /** Only when it failed as the owner's base image is no use. */
  unusableBase?: UnusableBase;
}

export const SETUP_NOT_STARTED: SandboxSetup = { stage: "not-started" };

/** Where setting up a room's or workspace's sandbox stands. */
export interface OwnedSetup {
  owner: SandboxOwner;
  setup: SandboxSetup;
}

/** Where setting up this sandbox stands, among all of them; not started where it isn't among them. */
export const setupOf = (setups: OwnedSetup[], owner: SandboxOwner) => setups.find((owned) => sameOwner(owned.owner, owner))?.setup ?? SETUP_NOT_STARTED;

/**
 * An agent's config file in the workspace, or in a folder added read and write, that the sandbox changed, put back as
 * it was and held for the owner's OK: its path from there with /, and whether it was added, changed or deleted. Its
 * text comes on request.
 */
export interface HeldChange {
  id: string;
  owner: SandboxOwner;
  /** The folder added read and write that the file is in; null where it is the workspace's. */
  folder: string | null;
  path: string;
  /** The agents at work in the sandbox when it came, by profile id; the change may be any of theirs. */
  agents: string[];
  /** The conversations at work in the sandbox when it came, which show it. */
  conversationIds: string[];
  kind: "add" | "change" | "delete";
  /** Too long, or not text, to be shown as a diff. */
  unshown?: true;
  at: number;
}

/** A held change's text before and as proposed, null where there was or is no file; or that it can't be shown. */
export type HeldChangeText = { before: string | null; after: string | null } | { unshown: true };

/** The most changes a sandbox holds: past that, its VM stops until the owner has answered some. */
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
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0 || parts.some(isNeverHeldFolder)) return false;
  const compared = parts.map(asDisksCompare);
  const joined = `/${compared.join("/")}/`;
  return HELD_FOLDERS.some((folder) => joined.includes(`/${folder}/`)) || HELD_FILES.includes(compared.at(-1)!);
}

/** Whether everything in a folder of the workspace is held, as in a held folder, each file of it on its own. */
export const holdsAllInside = (path: string) => isHeldConfigPath(`${path}/_`);
