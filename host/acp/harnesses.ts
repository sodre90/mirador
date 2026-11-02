import { RequestError } from "@agentclientprotocol/sdk";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { HostProblemError } from "../../shared/host-problems.ts";
import { harnessIds, harnessLabels, type CanvasUse, type HarnessId, type Profile } from "../../shared/model.ts";
import { canvasInstructions, canvasUseGuidance, NO_CANVAS_PLUGINS, type CanvasPluginGuidance } from "../canvas/guidance.ts";
import { PRE_ALLOWED_CANVAS_TOOLS } from "../canvas/tool-names.ts";
import { jobWaitGuidance } from "../job-waits.ts";
import { applyEnvironment, parseEnvironment } from "../../shared/profile-environment.ts";
import { claudeProgramMissing, findClaudeProgram } from "./claude-program.ts";
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

const findOpencode = () => Bun.which("opencode", { PATH: currentPath() }) ?? Bun.which("opencode", { PATH: opencodeInstallDirectories.join(delimiter) });

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
  };
  return harnessIds.filter((harness) => programOf[harness]() !== null);
}

const commandFor: Record<HarnessId, (environment: Record<string, string>) => string[]> = {
  claude: () => [process.execPath, claudeAgentEntry],
  opencode: opencodeCommand,
  pi: () => [process.execPath, piAcpEntry()],
  codex: () => [process.execPath, codexAcpEntry()],
  copilot: copilotCommand,
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
export function harnessSpec(profile: Profile, claudeProgramSetting: string): HarnessSpec {
  const { harness } = profile;
  const environment = launchEnvironment(harness, profile, claudeProgramSetting);
  return {
    id: harness,
    command: commandFor[harness](environment),
    startsOneAtATime: harness === "opencode",
    label: `${harnessLabels[harness]} (${profile.name})`,
    logName: `${harness}-${slug(profile.name) || "profile"}-${profile.id.slice(0, 8)}`,
    environment,
    prelaunch: profile.prelaunch,
  };
}

export const CANVAS_SERVER_NAME = "canvas";

const opencodeCanvasPlugin = { package: join(import.meta.dir, "opencode-canvas-plugin"), options: { server: CANVAS_SERVER_NAME } };

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
 * The agent's environment, with the profile's on top. claude-agent-acp runs the Claude Code in CLAUDE_CODE_EXECUTABLE
 * rather than the copy its SDK bundles; a profile may name its own.
 */
export function launchEnvironment(harness: HarnessId, profile: Profile | null, claudeProgramSetting: string): Record<string, string> {
  const environment = profileEnvironment(profile);
  if (harness === "opencode") return withCanvasToolsPlugin(environment);
  if (harness === "pi") return piAcpEnvironment(environment);
  if (harness === "codex") return codexAcpEnvironment(environment);
  if (harness === "copilot") return copilotEnvironment(environment);
  if (environment.CLAUDE_CODE_EXECUTABLE) return environment;
  const program = findClaudeProgram(claudeProgramSetting, environment.PATH);
  if (!program) throw new HostProblemError(claudeProgramMissing(claudeProgramSetting));
  return { ...environment, CLAUDE_CODE_EXECUTABLE: program };
}

/**
 * pi-acp runs the pi in PI_ACP_PI_COMMAND, rather than whichever its own PATH finds, and keeps its startup notes (pi's
 * version, every skill) out of the conversation. A profile may set either itself.
 */
function piAcpEnvironment(profileEnvironment: Record<string, string>): Record<string, string> {
  const environment: Record<string, string> = { PI_ACP_QUIET_STARTUP: "true", ...profileEnvironment };
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

export function profileEnvironment(profile: Profile | null): Record<string, string> {
  if (!profile) return agentEnvironment(hostEnvironment());
  const environment = parseEnvironment(profile.environment);
  if (environment.errors.length > 0) {
    throw new HostProblemError({ code: "profile-environment-invalid", profile: profile.name, errors: environment.errors.join("; ") });
  }
  return applyEnvironment(agentEnvironment(hostEnvironment()), environment);
}

/**
 * opencode needs nothing: it offers no question tool over ACP, puts the canvas server's own instructions in its prompt,
 * and the user's own opencode permission settings apply unchanged.
 */
export function sessionMeta(
  harness: HarnessId,
  canvasUse: CanvasUse,
  { canvasAssetsOrigin, withoutUserSettings = false, canvasPlugins = NO_CANVAS_PLUGINS }: { canvasAssetsOrigin: string; withoutUserSettings?: boolean; canvasPlugins?: CanvasPluginGuidance },
) {
  if (harness === "claude") return claudeSessionMeta(canvasUse, { withoutUserSettings, canvasPlugins });
  if (harness === "pi") return piSessionMeta(canvasUse, canvasAssetsOrigin, canvasPlugins);
  return undefined;
}

/**
 * ACP's own appended system prompt, which Codex takes; the others get theirs through `_meta`. The canvas server's
 * instructions reach Codex as the description of the canvas tools, and its job waits go through the when_done tool.
 */
export function sessionSystemPrompt(harness: HarnessId, canvasUse: CanvasUse, canvasPlugins = NO_CANVAS_PLUGINS) {
  if (harness !== "codex" || canvasUse !== "often") return undefined;
  return { mode: "append", content: [{ type: "text", text: canvasUseGuidance(canvasPlugins) }] };
}

/**
 * pi leaves the instructions of MCP servers whose tools it declares directly out of its prompt, so the canvas server's
 * come in the text Mirador's pi-acp patch appends. Its job waits go through the canvas's when_done tool, as opencode's do.
 */
export function piSessionMeta(canvasUse: CanvasUse, canvasAssetsOrigin: string, canvasPlugins = NO_CANVAS_PLUGINS) {
  const canvasServerInstructions = `# Canvas server instructions\n${canvasInstructions(canvasAssetsOrigin, canvasPlugins)}`;
  return { systemPrompt: { append: [canvasServerInstructions, ...(canvasUse === "often" ? [canvasUseGuidance(canvasPlugins)] : [])].join("\n\n") } };
}

/**
 * Session options Claude Code reads from `_meta.claudeCode.options` (claude-agent-acp).
 * AskUserQuestion is disabled so questions go through the visual `ask` tool instead.
 */
export function claudeSessionMeta(canvasUse: CanvasUse, { withoutUserSettings = false, canvasPlugins = NO_CANVAS_PLUGINS } = {}) {
  return {
    systemPrompt: { append: [...(canvasUse === "often" ? [canvasUseGuidance(canvasPlugins)] : []), jobWaitGuidance()].join("\n\n") },
    claudeCode: {
      options: {
        ...(withoutUserSettings && { settingSources: ["project", "local"] }),
        env: { CLAUDE_NOTIFIER: "0" },
        allowedTools: [...PRE_ALLOWED_CANVAS_TOOLS, ...canvasPlugins.toolNames].map((tool) => `mcp__${CANVAS_SERVER_NAME}__${tool}`),
        disallowedTools: ["AskUserQuestion"],
      },
    },
  };
}
