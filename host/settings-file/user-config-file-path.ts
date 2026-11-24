import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** Where the user may keep profiles, prompt templates and workspaces; null when MIRADOR_CONFIG_FILE turns it off. */
export function userConfigFilePath(env: Record<string, string | undefined> = process.env, home = homedir()): string | null {
  const chosen = env.MIRADOR_CONFIG_FILE;
  if (chosen === "off") return null;
  return chosen ? resolve(chosen) : join(env.XDG_CONFIG_HOME || join(home, ".config"), "mirador", "config.json");
}
