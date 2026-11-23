import { textOfRegularFile } from "../capped-file.ts";
import { join } from "node:path";

/** Claude Code's sources of settings that a room's owner can leave out: the owner's own, and the workspace's shared and local ones. */
export const SETTING_SOURCES = ["user", "project", "local"] as const;

export type SettingSource = (typeof SETTING_SOURCES)[number];

/** What of its settings keeps a Claude Code session from doing things: rules that deny a tool or ask before it, and the sandbox. */
export interface ClaudeProtections {
  deny: string[];
  ask: string[];
  sandbox?: Record<string, unknown>;
}

export const NO_PROTECTIONS: ClaudeProtections = { deny: [], ask: [] };

type Settings = Record<string, unknown>;

const settingsIn = (value: unknown): Settings | undefined => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Settings) : undefined);

const rulesIn = (value: unknown) => (Array.isArray(value) ? value.filter((rule): rule is string => typeof rule === "string") : []);

/** Claude Code's way of laying one source's settings over another's: lists add up, settings of their own merge, the rest the later wins. */
function laidOver(under: Settings, over: Settings): Settings {
  return Object.fromEntries(
    [...new Set([...Object.keys(under), ...Object.keys(over)])].map((key) => {
      const [below, above] = [under[key], over[key]];
      if (Array.isArray(below) && Array.isArray(above)) return [key, [...new Set([...below, ...above])]];
      const [belowSettings, aboveSettings] = [settingsIn(below), settingsIn(above)];
      if (belowSettings && aboveSettings) return [key, laidOver(belowSettings, aboveSettings)];
      return [key, above ?? below];
    }),
  );
}

/**
 * The protections of the sources a session leaves out, kept: their deny and ask rules, and the sandbox as all the
 * sources together set it, since the settings that carry it go over the sources the session loads.
 */
export function protectionsKept(leftOut: SettingSource[], settingsOf: Partial<Record<SettingSource, unknown>>): ClaudeProtections {
  if (leftOut.length === 0) return NO_PROTECTIONS;
  const permissionsOf = (source: SettingSource) => settingsIn(settingsIn(settingsOf[source])?.permissions) ?? {};
  const sandboxes = SETTING_SOURCES.flatMap((source): Settings[] => {
    const sandbox = settingsIn(settingsIn(settingsOf[source])?.sandbox);
    return sandbox ? [sandbox] : [];
  });
  return {
    deny: leftOut.flatMap((source) => rulesIn(permissionsOf(source).deny)),
    ask: leftOut.flatMap((source) => rulesIn(permissionsOf(source).ask)),
    ...(sandboxes.length > 0 && { sandbox: sandboxes.reduce(laidOver) }),
  };
}

const settingsFileOf = (source: SettingSource, configDir: string, workspace: string) =>
  ({ user: join(configDir, "settings.json"), project: join(workspace, ".claude", "settings.json"), local: join(workspace, ".claude", "settings.local.json") })[source];

const SETTINGS_MOST_BYTES = 1024 * 1024;

async function settingsFile(path: string): Promise<unknown> {
  try {
    const text = await textOfRegularFile(path, SETTINGS_MOST_BYTES);
    return text === null ? undefined : JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Each source's settings file as Claude Code would read it for a session in the workspace, where it reads as JSON. */
export async function settingsFiles(configDir: string, workspace: string): Promise<Partial<Record<SettingSource, unknown>>> {
  const read = await Promise.all(SETTING_SOURCES.map(async (source) => [source, await settingsFile(settingsFileOf(source, configDir, workspace))] as const));
  return Object.fromEntries(read);
}
