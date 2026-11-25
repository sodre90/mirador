import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOMS_WORKSPACE_CANVAS_TOOLS } from "../canvas/tool-names.ts";
import { piAgentFolderOf } from "../sandbox/pi-setup.ts";

/** The settings that choose pi's model and how it asks for it; everything else stays out of a brought pi session. */
const KEPT_SETTINGS = ["defaultProvider", "defaultModel", "defaultThinkingLevel", "enabledModels", "compaction", "httpIdleTimeoutMs", "retry"];

const STRIPPED_FROM_ISOLATED = ["mcp.json", "SYSTEM.md", "APPEND_SYSTEM.md", "AGENTS.md", "CLAUDE.md"];

export const PI_ROOMS_WORKSPACE_TOOLS = ROOMS_WORKSPACE_CANVAS_TOOLS.map((tool) => `mcp__canvas__${tool}`);

export const PI_ROOMS_WORKSPACE_SYSTEM_PROMPT =
  "You are an assistant brought into a shared room to work in the room's workspace. Use only the tools offered to you: room_read, room_edit, and room_run act on the room's workspace, and show and ask draw on the canvas. You have no access to the computer you run on.";

type JsonObject = Record<string, unknown>;

const isJsonObject = (value: unknown): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value);

function readJsonObject(path: string): JsonObject | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return isJsonObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function mirrorSecretFile(source: string, destination: string) {
  if (!existsSync(source)) {
    rmSync(destination, { force: true });
    return;
  }
  copyFileSync(source, destination);
  if (process.platform !== "win32") chmodSync(destination, 0o600);
}

/**
 * Prepares an isolated PI_CODING_AGENT_DIR for a brought pi agent working in a room's workspace, carrying over only
 * provider/model config (models.json, auth.json, and model-selection keys of settings.json) with no user mcp.json,
 * extensions, skills, prompts or instruction files, and sets the pi-acp lockdown environment variables.
 */
export function piRoomsWorkspaceEnvironment(
  environment: Record<string, string>,
  isolatedDir: string,
  profileModel: string | null = null,
): Record<string, string> {
  const sourceDir = piAgentFolderOf(environment);
  mkdirSync(isolatedDir, { recursive: true, mode: 0o700 });
  mirrorSecretFile(join(sourceDir, "models.json"), join(isolatedDir, "models.json"));
  mirrorSecretFile(join(sourceDir, "auth.json"), join(isolatedDir, "auth.json"));
  const userSettings = readJsonObject(join(sourceDir, "settings.json"));
  const keptSettings: JsonObject = { quietStartup: true };
  if (userSettings) {
    for (const key of KEPT_SETTINGS) {
      if (key in userSettings) keptSettings[key] = userSettings[key];
    }
  }
  writeFileSync(join(isolatedDir, "settings.json"), `${JSON.stringify(keptSettings, null, 2)}\n`, { mode: 0o600 });
  for (const name of STRIPPED_FROM_ISOLATED) rmSync(join(isolatedDir, name), { recursive: true, force: true });

  const expectedFromSettings =
    typeof userSettings?.defaultProvider === "string" && typeof userSettings?.defaultModel === "string"
      ? `${userSettings.defaultProvider}/${userSettings.defaultModel}`
      : "";
  const expectedModel = profileModel?.trim() || expectedFromSettings;

  return {
    ...environment,
    PI_CODING_AGENT_DIR: isolatedDir,
    PI_ACP_ONLY_TOOLS: PI_ROOMS_WORKSPACE_TOOLS.join(","),
    PI_ACP_SYSTEM_PROMPT: PI_ROOMS_WORKSPACE_SYSTEM_PROMPT,
    PI_ACP_EXPECTED_MODEL: expectedModel,
  };
}
