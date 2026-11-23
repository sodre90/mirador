import { isModelProviderVariable } from "../../shared/room-agent-setup.ts";
import { MODEL_KEY_VARIABLES, type ModelKeyVariable } from "../../shared/sandbox.ts";
import type { PiModelInVm } from "./pi-setup.ts";

/** What the agent's key variable holds in the VM: the model proxy on this computer puts the real key on each request. */
export const KEY_PLACEHOLDER = "kept-by-mirador";

/** Where the agent runs in the VM: the image's programs and the agent user's home. */
export const IN_VM = {
  PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
  HOME: "/home/node",
  SHELL: "/bin/bash",
  USER: "node",
  LOGNAME: "node",
  TMPDIR: "/tmp",
} as const;

/** The Bun of the image, which runs Mirador's ACP adapters from this computer's packages, mounted read-only. */
export const BUN_IN_VM = "/usr/local/bin/bun";

/** Where the image's agent programs are, installed from npm. */
const CLAUDE_CODE_IN_VM = "/usr/local/bin/claude";

/** Where Mirador's scripts are in the VM: host/sandbox/in-vm, mounted read-only. */
export const SCRIPTS_IN_VM = "/mirador/sandbox";

/** What pi-acp starts for pi in the VM: the image's pi, on the model setup Mirador gives it. */
export const PI_IN_VM = `${SCRIPTS_IN_VM}/pi.sh`;

/** The agent user of the image, never root: root could lift what the VM is held to. */
export const AGENT_USER = "1000:1000";

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
const KEPT_ON_THIS_COMPUTER = [...MODEL_KEY_VARIABLES, "CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_BASE_URL", "ANTHROPIC_CUSTOM_HEADERS", "CLAUDE_CONFIG_DIR", "SSH_AUTH_SOCK", "MIRADOR_URL", "MIRADOR_SCRIPT_TOKEN"];

/** pi's places on this computer, which its VM has none of. */
const PI_PLACES_HERE = ["PI_CODING_AGENT_DIR", "PI_ACP_PI_COMMAND", "PI_CODING_AGENT_SESSION_DIR", "PI_PACKAGE_DIR"];

/** pi in the VM gets no model provider's values, as its key and any other provider's would be among them, nor any its key or headers come from. */
const keptFromPi = (keyVariables: string[]) => (name: string) => PI_PLACES_HERE.includes(name) || isModelProviderVariable(name) || keyVariables.includes(name);

const keptFrom = (kind: SandboxedKind) => (kind.harness === "pi" ? keptFromPi(kind.keyVariables) : () => false);

/** The models.json of the VM's pi: its default provider alone, reached through the model proxy, with a key that is none. */
const piModelsIn = ({ providerId, provider }: PiModelInVm, modelBaseUrl: string) => ({ providers: { [providerId]: { ...provider, baseUrl: modelBaseUrl, apiKey: KEY_PLACEHOLDER } } });

function ownValuesInVm(kind: SandboxedKind, { modelBaseUrl, configFolder }: AgentPlacesInVm): Record<string, string> {
  if (kind.harness === "claude") return { CLAUDE_CONFIG_DIR: configFolder, ANTHROPIC_BASE_URL: modelBaseUrl, [kind.keyVariable]: KEY_PLACEHOLDER, CLAUDE_CODE_EXECUTABLE: CLAUDE_CODE_IN_VM, DISABLE_AUTOUPDATER: "1" };
  return {
    PI_CODING_AGENT_DIR: configFolder,
    PI_ACP_PI_COMMAND: PI_IN_VM,
    PI_OFFLINE: "1",
    MIRADOR_PI_MODELS: JSON.stringify(piModelsIn(kind.model, modelBaseUrl)),
    MIRADOR_PI_SETTINGS: JSON.stringify(kind.model.settings),
  };
}

/** A secret short enough to turn up by chance in any text is no secret worth looking for. */
const SECRET_LEAST_LENGTH = 8;

export const holdsASecret = (secrets: string[]) => (text: string) => secrets.some((secret) => secret.length >= SECRET_LEAST_LENGTH && text.includes(secret));

/**
 * The environment of an agent in the VM: what its room or workspace gives it, without its key or headers, which never
 * enter the VM, nor any value that holds one of them; with the VM's own places, its kind's folder, and the model proxy's
 * relay as its API.
 */
export function environmentInVm(given: Record<string, string>, kind: SandboxedKind, places: AgentPlacesInVm, secrets: string[]): Record<string, string> {
  const kept = keptFrom(kind);
  const holdsOne = holdsASecret(secrets);
  const passedOn = Object.entries(given).filter(([name, value]) => !KEPT_ON_THIS_COMPUTER.includes(name) && !Object.hasOwn(IN_VM, name) && !kept(name) && !holdsOne(value));
  return { ...Object.fromEntries(passedOn), ...IN_VM, ...ownValuesInVm(kind, places) };
}
