import type { HarnessId } from "./model.ts";
import { parseEnvironment, type ProfileEnvironment } from "./profile-environment.ts";
import type { SandboxSetting } from "./sandbox.ts";

/**
 * What a room's Claude Code agents load of the owner's own Claude Code setup, each part on its own: the owner's settings
 * (their settings file with its hooks, their CLAUDE.md, rules, skills and MCP servers), the workspace's settings (its
 * .claude folder, CLAUDE.md files, rules, skills and MCP servers), every MCP server but Mirador's, every hook, and every
 * CLAUDE.md and rule with the owner's memory of the workspace. All off, they start clean.
 */
export interface ClaudeSetup {
  ownSettings: boolean;
  workspaceSettings: boolean;
  mcpServers: boolean;
  hooks: boolean;
  claudeMdAndMemory: boolean;
}

export type ClaudeSetupPart = keyof ClaudeSetup;

export const CLAUDE_SETUP_PARTS: ClaudeSetupPart[] = ["ownSettings", "workspaceSettings", "mcpServers", "hooks", "claudeMdAndMemory"];

export const ALL_OF_CLAUDE_SETUP: ClaudeSetup = { ownSettings: true, workspaceSettings: true, mcpServers: true, hooks: true, claudeMdAndMemory: true };

/** How much of the owner's Claude Code setup the room's agents load: all of it, none of it, or the parts chosen. */
export type ClaudeSetupChoice = "all" | "none" | "parts";

export const CLAUDE_SETUP_CHOICES: ClaudeSetupChoice[] = ["all", "none", "parts"];

export const NONE_OF_CLAUDE_SETUP: ClaudeSetup = { ownSettings: false, workspaceSettings: false, mcpServers: false, hooks: false, claudeMdAndMemory: false };

export function claudeSetupChoiceOf(setup: ClaudeSetup): ClaudeSetupChoice {
  const loaded = CLAUDE_SETUP_PARTS.filter((part) => setup[part]);
  return loaded.length === CLAUDE_SETUP_PARTS.length ? "all" : loaded.length === 0 ? "none" : "parts";
}

/** Every part the value names as on or off, the rest as a new room has them. */
export function claudeSetupIn(value: unknown): ClaudeSetup {
  const named = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  return Object.fromEntries(CLAUDE_SETUP_PARTS.map((part) => [part, typeof named[part] === "boolean" ? named[part] : ALL_OF_CLAUDE_SETUP[part]])) as unknown as ClaudeSetup;
}

/** Which of its profile's environment values a room's agent gets, by name, where the owner chose otherwise than the default. */
export type VariablesChosen = Record<string, boolean>;

/** What a room's agent gets of the environment beyond what it needs to run, as the room's owner chose. */
export interface EnvironmentChoices {
  variables: VariablesChosen;
  wholeHostEnvironment: boolean;
}

export const NO_ENVIRONMENT_CHOICES: EnvironmentChoices = { variables: {}, wholeHostEnvironment: false };

/** A name a profile's environment can set: the host takes no other as a choice. */
export const isVariableName = (name: unknown): name is string => typeof name === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && name.length <= 200;

const chosenFor = (chosen: VariablesChosen, name: string): boolean | undefined => (Object.hasOwn(chosen, name) ? chosen[name] : undefined);

/** How Claude Code reads a switch such as CLAUDE_CODE_USE_BEDROCK. */
export const switchedOn = (value: string | undefined) => ["1", "true", "yes", "on"].includes((value ?? "").trim().toLowerCase());

const MODEL_PROVIDERS = ["ANTHROPIC_", "OPENAI_", "AZURE_OPENAI_", "GEMINI_", "GOOGLE_GENERATIVE_AI_", "OPENROUTER_", "GROQ_", "MISTRAL_", "DEEPSEEK_", "XAI_", "CEREBRAS_", "OLLAMA_"];

/** Whether a variable is one of a model provider's own, such as its key, as pi and opencode read them. */
export const isModelProviderVariable = (name: string) => MODEL_PROVIDERS.some((prefix) => name.startsWith(prefix));
const BEDROCK = ["AWS_REGION", "AWS_PROFILE", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_BEARER_TOKEN_BEDROCK"];
const VERTEX = ["CLOUD_ML_REGION", "VERTEX_REGION_", "GOOGLE_APPLICATION_CREDENTIALS", "GOOGLE_CLOUD_PROJECT"];
const CLAUDE_CODE_SETTINGS = ["ENABLE_TOOL_SEARCH", "DISABLE_", "MAX_THINKING_TOKENS", "MAX_MCP_OUTPUT_TOKENS", "MCP_TIMEOUT", "MCP_TOOL_TIMEOUT", "BASH_DEFAULT_TIMEOUT_MS", "BASH_MAX_TIMEOUT_MS", "BASH_MAX_OUTPUT_LENGTH", "USE_BUILTIN_RIPGREP"];

/**
 * Where an agent finds its programs and keeps its settings and sign-in. A profile that names one always gives it: kept
 * from the agent, it would fall back to the owner's own folder.
 */
const LOCATIONS = ["PATH", "HOME", "CLAUDE_CONFIG_DIR", "CODEX_HOME", "COPILOT_HOME", "PI_CODING_AGENT_DIR", "OPENCODE_CONFIG", "OPENCODE_CONFIG_DIR", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME"];

/** What every program on this computer expects to find, on Windows in any case: who and where the user is, their language and terminal. */
const BASICS_OF_THIS_COMPUTER = [
  ...["PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "LANG", "LC_", "TERM"],
  ...["SYSTEMROOT", "SYSTEMDRIVE", "WINDIR", "COMSPEC", "PATHEXT", "USERPROFILE", "USERNAME", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP"],
];

/** Claude Code reaches Bedrock and Vertex with their own sign-ins, when its environment turns them on. */
const claudeCloudSignIns = (environment: Record<string, string>) => [
  ...(switchedOn(environment.CLAUDE_CODE_USE_BEDROCK) ? BEDROCK : []),
  ...(switchedOn(environment.CLAUDE_CODE_USE_VERTEX) ? VERTEX : []),
];

/**
 * The variables each agent kind reads for its program, settings, model and sign-in: names, and beginnings of
 * names where they end in `_`.
 */
const agentsOwnVariables: Record<HarnessId, (environment: Record<string, string>) => string[]> = {
  claude: (environment) => ["ANTHROPIC_", "CLAUDE_", ...CLAUDE_CODE_SETTINGS, ...claudeCloudSignIns(environment)],
  opencode: () => ["OPENCODE_", "XDG_", ...MODEL_PROVIDERS],
  pi: () => ["PI_", ...MODEL_PROVIDERS],
  codex: () => ["CODEX_", "OPENAI_"],
  copilot: () => ["COPILOT_", "GH_TOKEN", "GITHUB_TOKEN"],
  antigravity: () => ["AGY_"],
};

const named = (name: string, by: string) => (by.endsWith("_") ? name.startsWith(by) : name === by);

const readByItsKind = (harness: HarnessId, name: string, environment: Record<string, string>) => agentsOwnVariables[harness](environment).some((by) => named(name, by));

const basicOfThisComputer = (name: string) => BASICS_OF_THIS_COMPUTER.some((by) => named(name.toUpperCase(), by));

/** Of a computer's environment, only what every program on it expects to find. */
export const basicEnvironment = (environment: Record<string, string>) => Object.fromEntries(Object.entries(environment).filter(([name]) => basicOfThisComputer(name)));

export const alwaysGiven = (name: string) => LOCATIONS.includes(name);

/** Whether a room's agent gets one of its profile's values unless the owner chooses otherwise: the basics, and what its kind reads to run. */
export function givenByDefault(harness: HarnessId, name: string, environment: ProfileEnvironment) {
  return alwaysGiven(name) || basicOfThisComputer(name) || readByItsKind(harness, name, environment.set);
}

const givenInRoom = (harness: HarnessId, name: string, environment: ProfileEnvironment, chosen: VariablesChosen) =>
  alwaysGiven(name) || (chosenFor(chosen, name) ?? givenByDefault(harness, name, environment));

export interface ProfileVariable {
  name: string;
  given: boolean;
  /** Always given, as `alwaysGiven` says. */
  fixed: boolean;
}

/** The values the profile's environment sets, by name in its order, each with whether the room's agent gets it. */
export function profileVariablesInRoom(harness: HarnessId, environmentText: string, chosen: VariablesChosen): ProfileVariable[] {
  const environment = parseEnvironment(environmentText);
  return Object.keys(environment.set).map((name) => ({ name, given: givenInRoom(harness, name, environment, chosen), fixed: alwaysGiven(name) }));
}

/** Windows reads a name in any case, so a name withheld in one case is withheld in all of them, wherever the host runs. */
const without = (environment: Record<string, string>, withheld: string[]) => {
  const withheldInAnyCase = new Set(withheld.map((name) => name.toUpperCase()));
  return Object.fromEntries(Object.entries(environment).filter(([name]) => !withheldInAnyCase.has(name.toUpperCase())));
};

/**
 * A room's agent's process environment. Of the profile's values, those it is given; every other name the profile sets or
 * unsets stays unset, so the host's value of it never stands in for the profile's. Of the host's environment, the basics
 * every program expects and what its kind reads to run, or, where the owner turned that on, all of it.
 */
export function environmentInRoom(harness: HarnessId, host: Record<string, string>, profile: ProfileEnvironment, { variables, wholeHostEnvironment }: EnvironmentChoices): Record<string, string> {
  const given = Object.fromEntries(Object.entries(profile.set).filter(([name]) => givenInRoom(harness, name, profile, variables)));
  const withheld = [...profile.unset, ...Object.keys(profile.set).filter((name) => !Object.hasOwn(given, name))];
  const hostLeft = without(host, withheld);
  const reaching = { ...hostLeft, ...given };
  const fromHost = wholeHostEnvironment ? hostLeft : Object.fromEntries(Object.entries(hostLeft).filter(([name]) => basicOfThisComputer(name) || readByItsKind(harness, name, reaching)));
  return { ...fromHost, ...given };
}

/** What a room's agent session was started under: a session started under anything else is not taken up again. */
export function roomSetupFingerprint(harness: HarnessId, environmentText: string, { variables, wholeHostEnvironment }: EnvironmentChoices, claudeSetup: ClaudeSetup, sandbox: SandboxSetting) {
  const given = profileVariablesInRoom(harness, environmentText, variables).flatMap(({ name, given: isGiven }) => (isGiven ? [name] : []));
  const loaded = harness === "claude" ? CLAUDE_SETUP_PARTS.filter((part) => claudeSetup[part]) : [];
  return JSON.stringify({ given: given.toSorted(), wholeHostEnvironment, loaded, ...(sandbox.on && { sandbox: sandbox.workFreely ? "works-freely" : "preset" }) });
}

/** Whether a change of what a room's agent gets leaves it with less: then its turn under way stops at once. */
export const narrows = (before: boolean, after: boolean) => before && !after;

export const narrowsClaudeSetup = (before: ClaudeSetup, after: ClaudeSetup) => CLAUDE_SETUP_PARTS.some((part) => narrows(before[part], after[part]));

/**
 * The agents whose room sessions the host can't hold to asking, as found in November 2026: Codex reads any file in its
 * read-only mode without asking, opencode and pi may run tools without asking, and Copilot is untried in rooms.
 */
const UNCONFINED_IN_ROOMS: HarnessId[] = ["codex", "opencode", "pi", "copilot"];

export const heldToAskingInRooms = (harness: HarnessId) => !UNCONFINED_IN_ROOMS.includes(harness);
