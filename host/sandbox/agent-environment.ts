import { MODEL_KEY_VARIABLES, type ModelKeyVariable } from "../../shared/sandbox.ts";

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
  CLAUDE_CODE_EXECUTABLE: "/usr/local/bin/claude",
} as const;

/** The Bun of the image, which runs Mirador's claude-agent-acp from this computer's packages, mounted read-only. */
export const BUN_IN_VM = "/usr/local/bin/bun";

/** The agent user of the image, never root: root could lift what the VM is held to. */
export const AGENT_USER = "1000:1000";

/** Values of this computer's that mean nothing in the VM, or that the model proxy keeps on this computer. */
const KEPT_ON_THIS_COMPUTER = [...MODEL_KEY_VARIABLES, "CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_BASE_URL", "ANTHROPIC_CUSTOM_HEADERS", "CLAUDE_CONFIG_DIR", "SSH_AUTH_SOCK", "MIRADOR_URL", "MIRADOR_SCRIPT_TOKEN"];

/**
 * The environment of an agent in the VM: what its room gives it, without the key, which never enters the VM, nor any
 * value that holds it; with the VM's own places, the room's config folder, and the model proxy's relay as its API.
 */
export function environmentInVm(given: Record<string, string>, { configDir, modelBaseUrl, keyVariable }: { configDir: string; modelBaseUrl: string; keyVariable: ModelKeyVariable }): Record<string, string> {
  const key = given[keyVariable] ?? "";
  const holdsTheKey = (value: string) => key.length >= 8 && value.includes(key);
  const passedOn = Object.entries(given).filter(([name, value]) => !KEPT_ON_THIS_COMPUTER.includes(name) && !Object.hasOwn(IN_VM, name) && !holdsTheKey(value));
  return { ...Object.fromEntries(passedOn), ...IN_VM, CLAUDE_CONFIG_DIR: configDir, ANTHROPIC_BASE_URL: modelBaseUrl, [keyVariable]: KEY_PLACEHOLDER, DISABLE_AUTOUPDATER: "1" };
}
