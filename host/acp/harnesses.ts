import { RequestError, type SystemPrompt } from "@agentclientprotocol/sdk/unstable";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { HostProblemError } from "../../shared/host-problems.ts";
import { harnessIds, harnessLabels, type CanvasUse, type HarnessId, type Profile } from "../../shared/model.ts";
import { canvasInstructions, canvasPluginInstructions, canvasUseGuidance, NO_CANVAS_PLUGINS, titleGuidance, type CanvasPluginGuidance } from "../canvas/guidance.ts";
import { PRE_ALLOWED_CANVAS_TOOLS, ROOM_CANVAS_TOOLS, ROOMS_WORKSPACE_CANVAS_TOOLS } from "../canvas/tool-names.ts";
import { jobWaitGuidance } from "../job-waits.ts";
import { sandboxGuidance, type SessionInSandbox } from "../sandbox/agent-guidance.ts";
import { applyEnvironment, parseEnvironment, type ProfileEnvironment } from "../../shared/profile-environment.ts";
import { ALL_OF_CLAUDE_SETUP, NONE_OF_CLAUDE_SETUP, type ClaudeSetup } from "../../shared/room-agent-setup.ts";
import { commandValues, readCommandValues, readMissingCommandValues } from "./environment-commands.ts";
import { claudeProgramMissing, findClaudeProgram } from "./claude-program.ts";
import { NO_PROTECTIONS, SETTING_SOURCES, type ClaudeProtections, type SettingSource } from "./claude-protections.ts";
import { findAntigravity } from "./antigravity-program.ts";
import { findCopilot } from "./copilot-program.ts";
import { agentEnvironment } from "./environment.ts";
import type { HarnessSpec } from "./harness.ts";
import { commandShell, powershellInvocation } from "../command-shell.ts";
import { currentPath, hostEnvironment } from "../current-path.ts";

const claudeAgentEntry = join(
  dirname(Bun.resolveSync("@agentclientprotocol/claude-agent-acp/package.json", import.meta.dir)),
  "dist/index.js",
);

/** Where opencode's installers put it, for hosts started without a login shell's PATH (e.g. by launchd). */
const opencodeInstallDirectories = ["/opt/homebrew/bin", "/usr/local/bin", join(homedir(), ".opencode", "bin")];

export const findOpencode = (path = currentPath()) => Bun.which("opencode", { PATH: path }) ?? Bun.which("opencode", { PATH: opencodeInstallDirectories.join(delimiter) });

/**
 * pi-acp is the ACP side of pi: it starts one `pi --mode rpc` per session. Looked up when pi starts, so a checkout whose
 * packages predate it still runs the other agents.
 */
const piAcpEntry = () => join(dirname(Bun.resolveSync("pi-acp/package.json", import.meta.dir)), "dist/index.js");

const findPi = (path = currentPath()) => Bun.which("pi", { PATH: path });

/** Where Codex's installers put it, for hosts started without a login shell's PATH (e.g. by launchd). */
const codexInstallDirectories = ["/opt/homebrew/bin", "/usr/local/bin", join(homedir(), ".local", "bin")];

const findCodex = (path = currentPath()) => Bun.which("codex", { PATH: path }) ?? Bun.which("codex", { PATH: codexInstallDirectories.join(delimiter) });

/** Looked up when Codex starts, as pi-acp is. */
const codexAcpEntry = () => join(dirname(Bun.resolveSync("@agentclientprotocol/codex-acp/package.json", import.meta.dir)), "dist/index.js");

function opencodeCommand(): string[] {
  const executable = findOpencode();
  if (!executable) throw new HostProblemError({ code: "opencode-not-installed" });
  return [executable, "acp"];
}

/** Copilot asks permission for MCP tools, so the canvas tools that only show things in Mirador are allowed up front, as Claude Code's allowedTools are. */
const copilotCommand = (environment: Record<string, string>): string[] => [
  environment.COPILOT_PATH!,
  "--acp",
  "--allow-all-mcp-server-instructions",
  ...PRE_ALLOWED_CANVAS_TOOLS.flatMap((tool) => ["--allow-tool", `${CANVAS_SERVER_NAME}(${tool})`]),
];

/** The agents this machine has a program for. */
export function installedHarnesses(claudeProgramSetting: string): HarnessId[] {
  const programOf: Record<HarnessId, () => string | null> = {
    claude: () => findClaudeProgram(claudeProgramSetting),
    opencode: findOpencode,
    pi: () => findPi(),
    codex: () => findCodex(),
    copilot: () => findCopilot(currentPath()),
    antigravity: () => findAntigravity(currentPath()),
  };
  return harnessIds.filter((harness) => programOf[harness]() !== null);
}

const commandFor: Record<HarnessId, (environment: Record<string, string>) => string[]> = {
  claude: () => [process.execPath, claudeAgentEntry],
  opencode: opencodeCommand,
  pi: () => [process.execPath, piAcpEntry()],
  codex: () => [process.execPath, codexAcpEntry()],
  copilot: copilotCommand,
  antigravity: (environment) => [environment.AGY_PATH!, "acp"],
};

const AUTH_REQUIRED_CODE = RequestError.authRequired().code;

/** The agent refuses prompts until the user signs in again. */
export const isAuthRequiredError = (error: unknown) =>
  typeof error === "object" && error !== null && (error as { code?: unknown }).code === AUTH_REQUIRED_CODE;

/**
 * Each harness's own sign-in, run by the program the agent runs, so it signs in that installation. Codex's browser
 * sign-in finishes on the host's localhost, which a browser on another machine can't reach; from there it signs in with
 * a code instead.
 */
const loginCommandFor: Record<HarnessId, (environment: Record<string, string>, pageOnHost: boolean) => string[]> = {
  claude: (environment) => [environment.CLAUDE_CODE_EXECUTABLE!, "auth", "login"],
  opencode: () => [opencodeCommand()[0]!, "auth", "login"],
  pi: (environment) => [environment.PI_ACP_PI_COMMAND!],
  codex: (environment, pageOnHost) => [environment.CODEX_PATH!, "login", ...(pageOnHost ? [] : ["--device-auth"])],
  copilot: (environment) => [environment.COPILOT_PATH!, "login"],
  antigravity: (environment) => [environment.AGY_PATH!],
};

const powershellKeepOpenOnFailure = (command: string[]) =>
  [
    powershellInvocation(command),
    "if ($?) { exit 0 }",
    "$status = if ($LASTEXITCODE) { $LASTEXITCODE } else { 1 }",
    'Write-Host -NoNewline "`nSigning in ended with status $status. Press Enter to close this tab."',
    "[void][Console]::ReadLine()",
    "exit $status",
  ].join("\n");

/**
 * A failed sign-in keeps its tab open until Enter, so its output can be read; one that worked closes it. The command
 * comes in as arguments, so nothing in it is quoted for the shell.
 */
export function loginCommand(harness: HarnessId, environment: Record<string, string>, shell = commandShell(() => "/bin/sh", environment), pageOnHost = true): string[] {
  const signIn = loginCommandFor[harness](environment, pageOnHost);
  if (shell.kind === "powershell") return [shell.program, "-NoLogo", "-NoProfile", "-Command", powershellKeepOpenOnFailure(signIn)];
  const keepOpenOnFailure = '"$@" && exit 0; status=$?; printf "\\nSigning in ended with status %s. Press Enter to close this tab." "$status"; read -r _; exit "$status"';
  return [shell.program, "-c", keepOpenOnFailure, "mirador-login", ...signIn];
}

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * The profile's environment goes on the agent process itself, not on the session:
 * claude-agent-acp picks a session's model from its own ANTHROPIC_MODEL, and opencode
 * reads its configuration (OPENCODE_CONFIG_CONTENT, XDG_CONFIG_HOME, ...) at startup.
 */
export function harnessSpec(profile: Profile, claudeProgramSetting: string, given = allOfIt): HarnessSpec {
  const { harness } = profile;
  const environment = launchEnvironment(harness, profile, claudeProgramSetting, given);
  return {
    id: harness,
    command: commandFor[harness](environment),
    startsOneAtATime: harness === "opencode" || harness === "codex",
    label: `${harnessLabels[harness]} (${profile.name})`,
    logName: `${harness}-${slug(profile.name) || "profile"}-${profile.id.slice(0, 8)}`,
    environment,
    ...(hasCommandValues(profile) && {
      readEnvironment: async (signal) => {
        await readCommandValues(profile, profileEnvironment(profile), signal);
        return launchEnvironment(harness, profile, claudeProgramSetting, given);
      },
    }),
    prelaunch: profile.prelaunch,
  };
}

/** The agent started with its environment changed, also as read again when it starts. */
export const withEnvironment = (spec: HarnessSpec, changed: (environment: Record<string, string>) => Record<string, string>): HarnessSpec => {
  const { readEnvironment } = spec;
  return {
    ...spec,
    environment: changed(spec.environment),
    ...(readEnvironment && { readEnvironment: async (signal) => changed(await readEnvironment(signal)) }),
  };
};

const hasCommandValues = ({ environment }: Profile) => Object.keys(parseEnvironment(environment).commands).length > 0;

export const CANVAS_SERVER_NAME = "canvas";

export const opencodeCanvasPlugin = { package: join(import.meta.dir, "opencode-canvas-plugin"), options: { server: CANVAS_SERVER_NAME } };

/**
 * opencode 2 loads the plugin that gives the agent the canvas tools themselves, after the profile's own plugins; opencode 1
 * ignores `plugins`. A configuration that is not plain JSON, such as JSONC with comments, stays as it is, and the agent
 * reaches the canvas tools through Code Mode.
 */
function withCanvasToolsPlugin(environment: Record<string, string>): Record<string, string> {
  const config: unknown = (() => {
    try {
      return JSON.parse(environment.OPENCODE_CONFIG_CONTENT ?? "{}");
    } catch {
      return null;
    }
  })();
  if (typeof config !== "object" || config === null || Array.isArray(config)) return environment;
  const { plugins = [] } = config as { plugins?: unknown };
  if (!Array.isArray(plugins)) return environment;
  return { ...environment, OPENCODE_CONFIG_CONTENT: JSON.stringify({ ...config, plugins: [...plugins, opencodeCanvasPlugin] }) };
}

/**
 * git status locks the index to save what it learned about the files. pi kills a command with SIGKILL on a timeout or a
 * cancel, which leaves the lock behind and stops the owner's own git add and commit.
 */
const GIT_STATUS_WITHOUT_LOCK = { GIT_OPTIONAL_LOCKS: "0" };

/**
 * The agent's environment, with the profile's on top. claude-agent-acp runs the Claude Code in CLAUDE_CODE_EXECUTABLE
 * rather than the copy its SDK bundles; a profile may name its own.
 */
export function launchEnvironment(harness: HarnessId, profile: Profile | null, claudeProgramSetting: string, given = allOfIt): Record<string, string> {
  const environment: Record<string, string> = { ...GIT_STATUS_WITHOUT_LOCK, ...profileEnvironment(profile, given) };
  if (harness === "opencode") return withCanvasToolsPlugin(environment);
  if (harness === "pi") return piAcpEnvironment(environment);
  if (harness === "codex") return codexAcpEnvironment(environment);
  if (harness === "copilot") return copilotEnvironment(environment);
  if (harness === "antigravity") return antigravityEnvironment(environment);
  if (environment.CLAUDE_CODE_EXECUTABLE) return environment;
  const program = findClaudeProgram(claudeProgramSetting, environment.PATH);
  if (!program) throw new HostProblemError(claudeProgramMissing(claudeProgramSetting));
  return { ...environment, CLAUDE_CODE_EXECUTABLE: program };
}

/**
 * pi-acp runs the pi in PI_ACP_PI_COMMAND, rather than whichever its own PATH finds, and keeps its startup notes (pi's
 * version, every skill) out of the conversation. A profile may set either itself. Mirador's patch leaves the check for a
 * newer pi to the host, which makes it without holding up the session (host/pi-updates.ts).
 */
function piAcpEnvironment(profileEnvironment: Record<string, string>): Record<string, string> {
  const environment: Record<string, string> = { PI_ACP_QUIET_STARTUP: "true", ...profileEnvironment, PI_ACP_UPDATE_CHECK: "off" };
  if (environment.PI_ACP_PI_COMMAND) return environment;
  const program = findPi(environment.PATH);
  if (!program) throw new HostProblemError({ code: "pi-not-installed" });
  return { ...environment, PI_ACP_PI_COMMAND: program };
}

/** codex-acp runs the Codex in CODEX_PATH, else the one its package bundles: Mirador runs the user's, as it does Claude Code. */
function codexAcpEnvironment(environment: Record<string, string>): Record<string, string> {
  if (environment.CODEX_PATH) return environment;
  const program = findCodex(environment.PATH);
  if (!program) throw new HostProblemError({ code: "codex-not-installed" });
  return { ...environment, CODEX_PATH: program };
}

/** Copilot runs the program in COPILOT_PATH, else the Copilot on the profile's PATH, as Codex does CODEX_PATH. */
function copilotEnvironment(environment: Record<string, string>): Record<string, string> {
  if (environment.COPILOT_PATH) return environment;
  const program = findCopilot(environment.PATH);
  if (!program) throw new HostProblemError({ code: "copilot-not-installed" });
  return { ...environment, COPILOT_PATH: program };
}

/** Antigravity runs the `agy` in AGY_PATH, else the one on the profile's PATH, as Copilot does COPILOT_PATH. */
function antigravityEnvironment(environment: Record<string, string>): Record<string, string> {
  if (environment.AGY_PATH) return environment;
  const program = findAntigravity(environment.PATH);
  if (!program) throw new HostProblemError({ code: "antigravity-not-installed" });
  return { ...environment, AGY_PATH: program };
}

/** An agent process's environment of the host's and its profile's: the profile's on top of all the host's, or only what a room gives its agent. */
export type EnvironmentGiven = (host: Record<string, string>, profile: ProfileEnvironment) => Record<string, string>;

const allOfIt: EnvironmentGiven = applyEnvironment;

/** The profile's environment, once each command that gives a value of it has run since Mirador started. */
export async function profileEnvironmentOnceRead(profile: Profile | null): Promise<Record<string, string>> {
  if (profile) await readMissingCommandValues(profile, () => profileEnvironment(profile));
  return profileEnvironment(profile);
}

/** The profile's environment, with what its commands last printed; a command that has not run since Mirador started gives nothing yet. */
export function profileEnvironment(profile: Profile | null, given = allOfIt): Record<string, string> {
  if (!profile) return agentEnvironment(hostEnvironment());
  const environment = parseEnvironment(profile.environment);
  if (environment.errors.length > 0) {
    throw new HostProblemError({ code: "profile-environment-invalid", profile: profile.name, errors: environment.errors.join("; ") });
  }
  return given(agentEnvironment(hostEnvironment()), { ...environment, set: { ...environment.set, ...commandValues(profile) } });
}

/** The names the profile's agent will have once it starts: a command that has not run since Mirador started stands in for what it will print. */
export function profileEnvironmentToCome(profile: Profile, given = allOfIt): Record<string, string> {
  return profileEnvironment(profile, (host, environment) => given(host, { ...environment, set: { ...environment.commands, ...environment.set } }));
}

/**
 * opencode needs nothing: it offers no question tool over ACP, puts the canvas server's own instructions in its prompt,
 * and the user's own opencode permission settings apply unchanged. An agent in a room hears of no canvas tool but the
 * room's.
 */
export function sessionMeta(
  harness: HarnessId,
  canvasUse: CanvasUse,
  {
    canvasAssetsOrigin,
    withoutUserSettings = false,
    canvasPlugins = NO_CANVAS_PLUGINS,
    idleCompaction = true,
    keepCacheWarm = false,
    inRoom = false,
    inRoomsWorkspace = false,
    claudeSetup = ALL_OF_CLAUDE_SETUP,
    keptProtections = NO_PROTECTIONS,
    sandbox = null,
  }: {
    canvasAssetsOrigin: string;
    withoutUserSettings?: boolean;
    canvasPlugins?: CanvasPluginGuidance;
    idleCompaction?: boolean;
    keepCacheWarm?: boolean;
    inRoom?: boolean;
    inRoomsWorkspace?: boolean;
    claudeSetup?: ClaudeSetup;
    keptProtections?: ClaudeProtections;
    /** The sandbox the agent works in; null where it works on this computer. */
    sandbox?: SessionInSandbox | null;
  },
) {
  if (harness === "claude" && inRoomsWorkspace) return claudeRoomsWorkspaceSessionMeta(canvasUse, idleCompaction, canvasPlugins);
  if (harness === "claude")
    return inRoom
      ? claudeRoomSessionMeta(canvasUse, { withoutUserSettings, canvasPlugins, idleCompaction, claudeSetup, keptProtections, sandbox })
      : claudeSessionMeta(canvasUse, { withoutUserSettings, canvasPlugins, idleCompaction, keepCacheWarm, sandbox });
  if (harness === "pi")
    return inRoom ? { systemPrompt: { append: [roomCanvasPromptAppendix(canvasUse, canvasAssetsOrigin, canvasPlugins), ...sandboxGuidance(sandbox)].join("\n\n") } } : piSessionMeta(canvasUse, canvasAssetsOrigin, canvasPlugins, sandbox);
  if (harness === "antigravity")
    return inRoom ? { antigravity: { systemPrompt: { append: roomCanvasPromptAppendix(canvasUse, canvasAssetsOrigin, canvasPlugins) } } } : antigravitySessionMeta(canvasUse, canvasAssetsOrigin, canvasPlugins);
  return undefined;
}

/**
 * ACP's own appended system prompt, which Codex takes; the others get theirs through `_meta`. The canvas server's
 * instructions reach Codex as the description of the canvas tools, and its job waits go through the when_done tool.
 */
export function sessionSystemPrompt(harness: HarnessId, canvasUse: CanvasUse, canvasPlugins = NO_CANVAS_PLUGINS): SystemPrompt | undefined {
  if (harness !== "codex" || canvasUse !== "often") return undefined;
  return { mode: "append", content: [{ type: "text", text: canvasUseGuidance(canvasPlugins) }] };
}

/**
 * pi leaves the instructions of MCP servers whose tools it declares directly out of its prompt, so the canvas server's
 * come in the text Mirador's pi-acp patch appends. Its job waits go through the canvas's when_done tool, as opencode's do.
 */
export function piSessionMeta(canvasUse: CanvasUse, canvasAssetsOrigin: string, canvasPlugins = NO_CANVAS_PLUGINS, sandbox: SessionInSandbox | null = null) {
  return { systemPrompt: { append: [canvasPromptAppendix(canvasUse, canvasAssetsOrigin, canvasPlugins), ...sandboxGuidance(sandbox)].join("\n\n") } };
}

/**
 * Antigravity keeps the instructions of MCP servers from its model, so the canvas server's come in the text it appends
 * to its system prompt (`_meta.antigravity.systemPrompt.append`), as pi's do. Its job waits go through when_done.
 */
export function antigravitySessionMeta(canvasUse: CanvasUse, canvasAssetsOrigin: string, canvasPlugins = NO_CANVAS_PLUGINS) {
  return { antigravity: { systemPrompt: { append: canvasPromptAppendix(canvasUse, canvasAssetsOrigin, canvasPlugins) } } };
}

function canvasPromptAppendix(canvasUse: CanvasUse, canvasAssetsOrigin: string, canvasPlugins: CanvasPluginGuidance) {
  return [...canvasPromptParts(canvasUse, canvasAssetsOrigin, canvasPlugins), titleGuidance()].join("\n\n");
}

/** A room's agent is not asked to name its conversation, which only the owner opens, and hears only of plugins enabled for its room. */
const roomCanvasPromptAppendix = (canvasUse: CanvasUse, canvasAssetsOrigin: string, canvasPlugins = NO_CANVAS_PLUGINS) =>
  canvasPromptParts(canvasUse, canvasAssetsOrigin, canvasPlugins).join("\n\n");

const canvasPromptParts = (canvasUse: CanvasUse, canvasAssetsOrigin: string, canvasPlugins: CanvasPluginGuidance) => [
  `# Canvas server instructions\n${canvasInstructions(canvasAssetsOrigin, canvasPlugins)}`,
  ...(canvasUse === "often" ? [canvasUseGuidance(canvasPlugins)] : []),
];

/**
 * Session options Claude Code reads from `_meta.claudeCode.options` (claude-agent-acp).
 * AskUserQuestion is disabled so questions go through the visual `ask` tool instead. Idle compaction left on sends no
 * setting, so a user's own `idleCompaction: false` in their Claude Code settings still holds. Keeping the cache warm
 * puts the conversation on the five-minute prompt cache, which Mirador's keep-alive requests renew.
 */
export function claudeSessionMeta(
  canvasUse: CanvasUse,
  { withoutUserSettings = false, canvasPlugins = NO_CANVAS_PLUGINS, idleCompaction = true, keepCacheWarm = false, sandbox = null as SessionInSandbox | null } = {},
) {
  const settings = { ...(!idleCompaction && { idleCompaction: false }), ...(keepCacheWarm && { promptCacheTtl: "5m" }) };
  return {
    systemPrompt: {
      append: [...(canvasUse === "often" ? [canvasUseGuidance(canvasPlugins)] : []), canvasPluginInstructions(canvasPlugins), jobWaitGuidance(), ...sandboxGuidance(sandbox)].filter(Boolean).join("\n\n"),
    },
    claudeCode: {
      options: {
        ...(withoutUserSettings && { settingSources: ["project", "local"] }),
        ...(Object.keys(settings).length > 0 && { settings }),
        env: { CLAUDE_NOTIFIER: "0" },
        allowedTools: [...PRE_ALLOWED_CANVAS_TOOLS, ...canvasPlugins.toolNames].map((tool) => `mcp__${CANVAS_SERVER_NAME}__${tool}`),
        disallowedTools: ["AskUserQuestion"],
      },
    },
  };
}

/**
 * Claude Code's accept-edits mode changes a CLAUDE.md unasked, and later sessions load it; it asks before the rest of
 * these itself. In a room they ask, so the host can leave them to the owner.
 */
const ROOM_ASKS_BEFORE_EDITING = ["Edit(**/CLAUDE.md)", "Edit(**/CLAUDE.local.md)", "Edit(**/.claude/**)", "Edit(**/.mcp.json)"];

/**
 * A room's agent hears of no job waits, and only the room's canvas tools and plugins enabled for the room run without
 * asking. It loads of the owner's Claude Code setup what the room's owner chose, keeping the protections of the settings
 * it leaves out.
 */
export function claudeRoomSessionMeta(
  canvasUse: CanvasUse,
  {
    withoutUserSettings = false,
    canvasPlugins = NO_CANVAS_PLUGINS,
    idleCompaction = true,
    claudeSetup = ALL_OF_CLAUDE_SETUP,
    keptProtections = NO_PROTECTIONS,
    sandbox = null,
  }: { withoutUserSettings?: boolean; canvasPlugins?: CanvasPluginGuidance; idleCompaction?: boolean; claudeSetup?: ClaudeSetup; keptProtections?: ClaudeProtections; sandbox?: SessionInSandbox | null } = {},
) {
  const { env, disallowedTools } = claudeSessionMeta(canvasUse).claudeCode.options;
  const { deny, ask, sandbox: claudeSandbox } = keptProtections;
  const settings = {
    ...(!idleCompaction && { idleCompaction: false }),
    ...settingsLeavingOut(claudeSetup),
    permissions: { ...(deny.length > 0 && { deny }), ask: [...ask, ...ROOM_ASKS_BEFORE_EDITING] },
    ...(claudeSandbox && { sandbox: claudeSandbox }),
  };
  const loaded = settingSourcesLoaded(claudeSetup, withoutUserSettings);
  return {
    systemPrompt: { append: [canvasUse === "often" ? canvasUseGuidance(canvasPlugins) : "", canvasPluginInstructions(canvasPlugins), ...sandboxGuidance(sandbox)].filter(Boolean).join("\n\n") },
    claudeCode: {
      options: {
        ...(loaded.length < SETTING_SOURCES.length && { settingSources: loaded }),
        settings,
        ...(!claudeSetup.mcpServers && { strictMcpConfig: true }),
        env,
        allowedTools: [...ROOM_CANVAS_TOOLS, ...canvasPlugins.toolNames].map((tool) => `mcp__${CANVAS_SERVER_NAME}__${tool}`),
        disallowedTools,
      },
    },
  };
}

/** Claude Code starts its Chrome server on the user's own word, kept in its variable or its config, whatever MCP servers a session is held to. */
const NO_CLAUDE_IN_CHROME = { CLAUDE_CODE_ENABLE_CFC: "0" };

/**
 * An agent you brought to work in a room's workspace has none of Claude Code's own tools and loads nothing of your setup,
 * so that nothing the room says has it read, change or run anything of this computer, nor hears of a repository its empty
 * folder may be inside.
 */
export function claudeRoomsWorkspaceSessionMeta(canvasUse: CanvasUse, idleCompaction = true, canvasPlugins = NO_CANVAS_PLUGINS) {
  const meta = claudeRoomSessionMeta(canvasUse, { idleCompaction, canvasPlugins, claudeSetup: NONE_OF_CLAUDE_SETUP });
  const { options } = meta.claudeCode;
  const allowedTools = [...ROOMS_WORKSPACE_CANVAS_TOOLS, ...canvasPlugins.toolNames].map((tool) => `mcp__${CANVAS_SERVER_NAME}__${tool}`);
  return {
    ...meta,
    claudeCode: { options: { ...options, tools: [] as string[], allowedTools, env: { ...options.env, ...NO_CLAUDE_IN_CHROME }, settings: { ...options.settings, includeGitInstructions: false } } },
  };
}

/** Claude Code loads every source of settings unless told which: the owner's own, and the workspace's shared and local ones. */
const settingSourcesLoaded = ({ ownSettings, workspaceSettings }: ClaudeSetup, withoutUserSettings: boolean): SettingSource[] =>
  SETTING_SOURCES.filter((source) => (source === "user" ? ownSettings && !withoutUserSettings : workspaceSettings));

/** The sources of settings a room's owner leaves out, whose protections its Claude Code sessions keep; a test host's skip the user's own altogether. */
export const settingSourcesLeftOut = (claudeSetup: ClaudeSetup, withoutUserSettings: boolean) =>
  SETTING_SOURCES.filter((source) => !settingSourcesLoaded(claudeSetup, false).includes(source) && !(withoutUserSettings && source === "user"));

/** Claude Code's own settings that leave hooks, and CLAUDE.md files, rules and memory, out of a session, wherever they come from. */
const settingsLeavingOut = ({ hooks, claudeMdAndMemory }: ClaudeSetup) => ({
  ...(!hooks && { disableAllHooks: true }),
  ...(!claudeMdAndMemory && { claudeMdExcludes: ["**/CLAUDE.md", "**/CLAUDE.local.md", "**/rules/**"], autoMemoryEnabled: false }),
});
