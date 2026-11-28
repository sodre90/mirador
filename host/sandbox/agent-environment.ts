import { isModelProviderVariable } from "../../shared/room-agent-setup.ts";
import { MODEL_KEY_VARIABLES, type ModelKeyVariable } from "../../shared/sandbox.ts";
import type { PiModelInVm } from "./pi-setup.ts";
import { agentProgramsInVm, BUN_FOLDER_IN_VM, NODE_FOLDER_IN_VM, NODE_IN_VM, type AgentTools } from "./tools-folder.ts";
import type { BaseImage } from "./vm-launcher.ts";

/** What the agent's key variable holds in the VM: the model proxy on this computer puts the real key on each request. */
export const KEY_PLACEHOLDER = "kept-by-mirador";

/** The port of the VM's own 127.0.0.1 that leads to the sandbox's web proxy, its only way out besides its canvases and models. */
export const NETWORK_RELAY_PORT = 7703;

const WEB_PROXY = `http://127.0.0.1:${NETWORK_RELAY_PORT}`;
const THE_VMS_OWN = "localhost,127.0.0.1,::1";

/**
 * What has every JVM in the VM, Gradle and its wrapper among them, go through the web proxy: Java reads no proxy from
 * the environment, only from its own properties. Its own default keeps the VM's loopback direct.
 */
const JAVA_THROUGH_THE_PROXY = ["http", "https"].flatMap((scheme) => [`-D${scheme}.proxyHost=127.0.0.1`, `-D${scheme}.proxyPort=${NETWORK_RELAY_PORT}`]).join(" ");

/** The JVM options a room or workspace gives, followed by the proxy's, as the last of a property wins. */
const javaOptionsThroughTheProxy = (given: string | undefined) => (given ? `${given} ${JAVA_THROUGH_THE_PROXY}` : JAVA_THROUGH_THE_PROXY);

/** What has the VM's programs go through the web proxy, as each of them reads it, for anywhere but the VM itself. */
const THROUGH_THE_PROXY = {
  HTTP_PROXY: WEB_PROXY,
  http_proxy: WEB_PROXY,
  HTTPS_PROXY: WEB_PROXY,
  https_proxy: WEB_PROXY,
  NO_PROXY: THE_VMS_OWN,
  no_proxy: THE_VMS_OWN,
  JAVA_TOOL_OPTIONS: JAVA_THROUGH_THE_PROXY,
} as const;

/** The agent user's home, in the VM's own /tmp: made by that user as its commands start, so no image need have it. */
export const HOME_IN_VM = "/tmp/mirador-home";

/** The shell the agents' commands run in. */
export const SHELL_IN_VM = "/bin/bash";

/**
 * What the agent programs read as they did in the image they came in: no updates of their own, nor any traffic besides
 * their model's, and pi only on what it was given.
 */
const AS_INSTALLED = { DISABLE_AUTOUPDATER: "1", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1", PI_OFFLINE: "1" } as const;

/**
 * Where the agent runs in the VM: its kind's programs, then the base image's own, so a project gets the Node.js and Bun
 * its image has, then Bun and Node.js from the tools folder where the image has none; the agent user's home, and its way out.
 */
export const vmEnvironment = (base: BaseImage, agent: AgentTools | null): Record<string, string> => ({
  PATH: [...(agent ? [agentProgramsInVm(agent)] : []), base.path ?? DEFAULT_PATH, BUN_FOLDER_IN_VM, NODE_FOLDER_IN_VM].join(":"),
  HOME: HOME_IN_VM,
  SHELL: SHELL_IN_VM,
  USER: AGENT_NAME,
  LOGNAME: AGENT_NAME,
  TMPDIR: "/tmp",
  ...THROUGH_THE_PROXY,
});

const DEFAULT_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

/** The agent user's name, which no image need know. */
const AGENT_NAME = "mirador";

/** The names the VM sets for every agent, which nothing given to one replaces. */
const SET_BY_THE_VM = [...Object.keys(vmEnvironment({ image: "", path: null }, null)), ...Object.keys(AS_INSTALLED)];

/** Where Mirador's scripts are in the VM: host/sandbox/in-vm, mounted read-only. */
export const SCRIPTS_IN_VM = "/mirador/sandbox";

/** What pi-acp starts for pi in the VM: pi from the tools folder, on the tools folder's Node.js and the model setup Mirador gives it. */
export const PI_IN_VM = `${SCRIPTS_IN_VM}/pi.sh`;

/** The agent user in the VM, never root: root could lift what the VM is held to. */
export const AGENT_USER = "1000:1000";

/**
 * Git in the VM works in any folder whoever owns it, as the VM's files are the owner's or the guard's: said in the
 * environment, which git trusts as it would its command line, after any config the agent was given there.
 */
export function withAnyFolderSafe(environment: Record<string, string>): Record<string, string> {
  const given = Number.parseInt(environment.GIT_CONFIG_COUNT ?? "", 10);
  const at = Number.isInteger(given) && given > 0 ? given : 0;
  return { ...environment, GIT_CONFIG_COUNT: String(at + 1), [`GIT_CONFIG_KEY_${at}`]: "safe.directory", [`GIT_CONFIG_VALUE_${at}`]: "*" };
}

/**
 * The agent kind of an agent in the VM: Claude Code, with the variable its key goes in, or pi, with the model setup it
 * gets in the VM and the variables its key and headers come from.
 */
export type SandboxedKind = { harness: "claude"; keyVariable: ModelKeyVariable } | { harness: "pi"; model: PiModelInVm; keyVariables: string[] };

/** Where an agent finds its own in the VM: its model, through the model proxy's relay, and its kind's folder of settings and sessions. */
export interface AgentPlacesInVm {
  modelBaseUrl: string;
  configFolder: string;
}

/** Values of this computer's that mean nothing in the VM, or that the model proxy keeps on this computer. */
const KEPT_ON_THIS_COMPUTER = [...MODEL_KEY_VARIABLES, "ANTHROPIC_BASE_URL", "ANTHROPIC_CUSTOM_HEADERS", "CLAUDE_CONFIG_DIR", "SSH_AUTH_SOCK", "ALL_PROXY", "all_proxy", "MIRADOR_URL", "MIRADOR_SCRIPT_TOKEN"];

/** What has a program load code from where it says, as the one would that drops from root to the agent user, before it has. */
const loadsCode = (name: string) => name.startsWith("LD_") || name === "GCONV_PATH" || name === "LOCPATH";

/** pi's places on this computer, which its VM has none of. */
const PI_PLACES_HERE = ["PI_CODING_AGENT_DIR", "PI_ACP_PI_COMMAND", "PI_CODING_AGENT_SESSION_DIR", "PI_PACKAGE_DIR"];

/** pi in the VM gets no model provider's values, as its key and any other provider's would be among them, nor any its key or headers come from. */
const keptFromPi = (keyVariables: string[]) => (name: string) => PI_PLACES_HERE.includes(name) || isModelProviderVariable(name) || keyVariables.includes(name);

const keptFrom = (kind: SandboxedKind) => (kind.harness === "pi" ? keptFromPi(kind.keyVariables) : () => false);

/** The models.json of the VM's pi: its default provider alone, reached through the model proxy, with a key that is none. */
const piModelsIn = ({ providerId, provider }: PiModelInVm, modelBaseUrl: string) => ({ providers: { [providerId]: { ...provider, baseUrl: modelBaseUrl, apiKey: KEY_PLACEHOLDER } } });

function ownValuesInVm(kind: SandboxedKind, version: string, { modelBaseUrl, configFolder }: AgentPlacesInVm): Record<string, string> {
  if (kind.harness === "claude") {
    const claudeCode = `${agentProgramsInVm({ harness: "claude", version })}/claude`;
    return { CLAUDE_CONFIG_DIR: configFolder, ANTHROPIC_BASE_URL: modelBaseUrl, [kind.keyVariable]: KEY_PLACEHOLDER, CLAUDE_CODE_EXECUTABLE: claudeCode };
  }
  return {
    PI_CODING_AGENT_DIR: configFolder,
    PI_ACP_PI_COMMAND: PI_IN_VM,
    MIRADOR_PI_MODELS: JSON.stringify(piModelsIn(kind.model, modelBaseUrl)),
    MIRADOR_PI_SETTINGS: JSON.stringify(kind.model.settings),
    MIRADOR_PI_NODE: NODE_IN_VM,
  };
}

/** A secret short enough to turn up by chance in any text is no secret worth looking for. */
const SECRET_LEAST_LENGTH = 8;

export const holdsASecret = (secrets: string[]) => (text: string) => secrets.some((secret) => secret.length >= SECRET_LEAST_LENGTH && text.includes(secret));

/** An agent in the VM: its kind, at the version its programs are, on the base image its VM runs. */
export interface AgentInItsVm {
  kind: SandboxedKind;
  version: string;
  base: BaseImage;
}

/**
 * The environment of an agent in the VM: what its room or workspace gives it, without its key or headers, which never
 * enter the VM, nor any value that holds one of them; with the VM's own places, its kind's folder, and the model proxy's
 * relay as its API.
 */
export function environmentInVm(given: Record<string, string>, { kind, version, base }: AgentInItsVm, places: AgentPlacesInVm, secrets: string[]): Record<string, string> {
  const kept = keptFrom(kind);
  const holdsOne = holdsASecret(secrets);
  const passedOn = Object.entries(given).filter(([name, value]) => !KEPT_ON_THIS_COMPUTER.includes(name) && !loadsCode(name) && !SET_BY_THE_VM.includes(name) && !kept(name) && !holdsOne(value));
  const javaOptionsGiven = given.JAVA_TOOL_OPTIONS;
  const javaOptionsKept = javaOptionsGiven && !holdsOne(javaOptionsGiven) ? javaOptionsGiven : undefined;
  const inVm = { ...vmEnvironment(base, { harness: kind.harness, version }), JAVA_TOOL_OPTIONS: javaOptionsThroughTheProxy(javaOptionsKept) };
  return withAnyFolderSafe({ ...Object.fromEntries(passedOn), ...inVm, ...AS_INSTALLED, ...ownValuesInVm(kind, version, places) });
}
