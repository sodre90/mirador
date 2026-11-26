import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { stripVTControlCharacters } from "node:util";
import type * as acp from "@agentclientprotocol/sdk/unstable";
import { ROOMS_WORKSPACE_CANVAS_TOOLS } from "../canvas/tool-names.ts";
import { CANVAS_SERVER_NAME, findOpencode, opencodeCanvasPlugin } from "./harnesses.ts";

/** Config keys carried from the user's opencode setup: model choice and provider definitions alone. */
const CARRIED_KEYS = ["model", "provider", "providers", "enabled_providers", "disabled_providers"] as const;
const CONFIG_FILENAMES = ["config.json", "opencode.json", "opencode.jsonc"] as const;
const VERSION_TIMEOUT_MS = 5_000;

export const OPENCODE_EXPECTED_MODEL_ENV = "MIRADOR_OPENCODE_EXPECTED_MODEL";

export const OPENCODE_ROOMS_WORKSPACE_PERMISSIONS = [
  { action: "*", resource: "*", effect: "deny" as const },
  ...ROOMS_WORKSPACE_CANVAS_TOOLS.map((tool) => ({
    action: `${CANVAS_SERVER_NAME}_${tool}`,
    resource: "*",
    effect: "allow" as const,
  })),
];

type JsonObject = Record<string, unknown>;

const isJsonObject = (value: unknown): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Parses JSONC (JSON with `//` line comments, `/* ... *\/` block comments and trailing commas),
 * leaving comment-like sequences inside string literals intact.
 */
export function parseJsonc(text: string): unknown {
  let out = "";
  let inString = false;
  let escaped = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    const next = text[i + 1];
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === "/" && next === "/") {
      i += 2;
      while (i < text.length && text[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  const withoutTrailingCommas = stripTrailingCommas(out);
  return JSON.parse(withoutTrailingCommas);
}

function stripTrailingCommas(text: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === ",") {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j]!)) j += 1;
      if (text[j] === "}" || text[j] === "]") continue;
    }
    out += ch;
  }
  return out;
}

const TOKEN_PATTERN = /\{(env|file):([^}]+)\}/g;

/**
 * Resolves opencode's `{env:VAR}` and `{file:PATH}` config substitutions inside strings of the
 * carried-over provider/model fields before isolating the config directory.
 */
export function substituteConfigTokens(value: unknown, environment: Record<string, string>, baseDir: string, homeDir: string): unknown {
  if (typeof value === "string") {
    return value.replace(TOKEN_PATTERN, (_match, kind: string, target: string) => {
      if (kind === "env") return environment[target] ?? "";
      const rawPath = target.startsWith("~/") ? join(homeDir, target.slice(2)) : target;
      const filePath = isAbsolute(rawPath) ? rawPath : resolve(baseDir, rawPath);
      return readFileSync(filePath, "utf8").trim();
    });
  }
  if (Array.isArray(value)) return value.map((item) => substituteConfigTokens(item, environment, baseDir, homeDir));
  if (isJsonObject(value)) {
    const result: JsonObject = {};
    for (const [key, entry] of Object.entries(value)) result[key] = substituteConfigTokens(entry, environment, baseDir, homeDir);
    return result;
  }
  return value;
}

function deepMergeObjects(base: JsonObject, override: JsonObject): JsonObject {
  const merged: JsonObject = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const existing = merged[key];
    merged[key] = isJsonObject(existing) && isJsonObject(value) ? deepMergeObjects(existing, value) : value;
  }
  return merged;
}

/** Extracts opencode's major version from `opencode --version` output, coloured where FORCE_COLOR is set, or null when unrecognized. */
export function opencodeMajorVersion(versionOutput: string | null): number | null {
  const match = /(?:^|\bv)(\d+)\.\d+\.\d+/.exec(stripVTControlCharacters(versionOutput ?? ""));
  return match ? Number(match[1]) : null;
}

export function managedOpencodeConfigDirs(platform = process.platform, environment: Record<string, string> = process.env as Record<string, string>): string[] {
  if (platform === "darwin") return ["/Library/Application Support/opencode"];
  if (platform === "win32") return [join(environment.ProgramData || "C:\\ProgramData", "opencode")];
  return ["/etc/opencode"];
}

export function findManagedOpencodeConfig(dirs: string[]): string | null {
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    try {
      if (readdirSync(dir).length > 0) return dir;
    } catch {
      return dir;
    }
  }
  return null;
}

function readOpencodeVersion(program: string, environment: Record<string, string>): string | null {
  const result = spawnSync(program, ["--version"], {
    env: environment,
    encoding: "utf8",
    timeout: VERSION_TIMEOUT_MS,
    shell: process.platform === "win32" && /\.(cmd|bat)$/i.test(program),
  });
  if (result.error || result.status !== 0) return null;
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
}

function extractCarriedFromText(text: string, environment: Record<string, string>, baseDir: string, homeDir: string): JsonObject {
  let parsed: unknown;
  try {
    parsed = parseJsonc(text);
  } catch {
    return {};
  }
  if (!isJsonObject(parsed)) return {};
  const kept: JsonObject = {};
  for (const key of CARRIED_KEYS) {
    if (key in parsed) kept[key] = substituteConfigTokens(parsed[key], environment, baseDir, homeDir);
  }
  return kept;
}

function mergeCarried(into: JsonObject, next: JsonObject) {
  for (const key of CARRIED_KEYS) {
    if (!(key in next)) continue;
    const value = next[key];
    if ((key === "provider" || key === "providers") && isJsonObject(value)) {
      into[key] = isJsonObject(into[key]) ? deepMergeObjects(into[key], value) : value;
    } else {
      into[key] = value;
    }
  }
}

function readConfigDir(dir: string, environment: Record<string, string>, homeDir: string, into: JsonObject) {
  for (const filename of CONFIG_FILENAMES) {
    const filePath = join(dir, filename);
    if (!existsSync(filePath)) continue;
    try {
      mergeCarried(into, extractCarriedFromText(readFileSync(filePath, "utf8"), environment, dir, homeDir));
    } catch (error) {
      throw new Error(`Could not read opencode config ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export interface OpencodeRoomsWorkspaceOptions {
  /** Override version string for testing instead of spawning `opencode --version`. */
  versionOutput?: string | null;
  /** Override managed/system config directories for testing. */
  managedConfigDirs?: string[];
  /** Override home directory for testing. */
  homeDir?: string;
}

/**
 * Prepares an isolated environment for a brought opencode 2+ agent working in a room's workspace:
 * - refuses opencode 1 (which lacks opencode 2's deny-by-default permissions and canvas tools plugin);
 * - refuses machines with managed/system opencode config (which outranks OPENCODE_CONFIG_CONTENT);
 * - carries over ONLY `model`, `provider`/`providers`, `enabled_providers`, `disabled_providers` from the
 *   user's JSONC configs (resolving `{env:}` and `{file:}` in those fields alone);
 * - isolates `XDG_CONFIG_HOME` to an empty directory, disables project & Claude Code config discovery,
 *   loads only Mirador's canvas tools plugin, and denies every tool except the five room-workspace tools.
 */
export function opencodeRoomsWorkspaceEnvironment(
  environment: Record<string, string>,
  isolatedDir: string,
  profileModel: string | null = null,
  options: OpencodeRoomsWorkspaceOptions = {},
): Record<string, string> {
  const homeDir = options.homeDir ?? environment.HOME ?? homedir();
  const managedDirs = options.managedConfigDirs ?? managedOpencodeConfigDirs(process.platform, environment);
  const managed = findManagedOpencodeConfig(managedDirs);
  if (managed) {
    throw new Error(
      `opencode cannot work in a room's workspace while system/managed opencode config exists at ${managed}, because managed config outranks Mirador's tool restrictions.`,
    );
  }

  const versionOutput =
    options.versionOutput !== undefined
      ? options.versionOutput
      : (() => {
          const program = findOpencode(environment.PATH);
          return program ? readOpencodeVersion(program, environment) : null;
        })();
  const major = opencodeMajorVersion(versionOutput);
  if (major === null || major < 2) {
    throw new Error(
      `opencode 2 or newer is required to work in a room's workspace (found ${versionOutput ? versionOutput.trim() : "unknown version"}).`,
    );
  }

  const carried: JsonObject = {};
  const userXdgConfig = environment.XDG_CONFIG_HOME || join(homeDir, ".config");
  readConfigDir(join(userXdgConfig, "opencode"), environment, homeDir, carried);
  if (environment.OPENCODE_CONFIG && existsSync(environment.OPENCODE_CONFIG)) {
    const filePath = environment.OPENCODE_CONFIG;
    mergeCarried(carried, extractCarriedFromText(readFileSync(filePath, "utf8"), environment, dirname(filePath), homeDir));
  }
  if (environment.OPENCODE_CONFIG_DIR) {
    readConfigDir(environment.OPENCODE_CONFIG_DIR, environment, homeDir, carried);
  }
  if (environment.OPENCODE_CONFIG_CONTENT) {
    mergeCarried(carried, extractCarriedFromText(environment.OPENCODE_CONFIG_CONTENT, environment, homeDir, homeDir));
  }

  const expectedModel = profileModel?.trim() || (typeof carried.model === "string" ? carried.model.trim() : "");
  const lockedConfig: JsonObject = {
    ...carried,
    ...(expectedModel ? { model: expectedModel } : {}),
    plugins: [opencodeCanvasPlugin],
    permissions: OPENCODE_ROOMS_WORKSPACE_PERMISSIONS,
  };

  rmSync(isolatedDir, { recursive: true, force: true });
  mkdirSync(isolatedDir, { recursive: true, mode: 0o700 });

  const next: Record<string, string> = { ...environment };
  delete next.OPENCODE_CONFIG;
  delete next.OPENCODE_CONFIG_DIR;
  return {
    ...next,
    XDG_CONFIG_HOME: isolatedDir,
    OPENCODE_DISABLE_PROJECT_CONFIG: "1",
    OPENCODE_DISABLE_CLAUDE_CODE: "1",
    OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: "1",
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    OPENCODE_CONFIG_CONTENT: JSON.stringify(lockedConfig),
    [OPENCODE_EXPECTED_MODEL_ENV]: expectedModel,
  };
}

function modelValuesFromConfigOptions(configOptions: acp.SessionConfigOption[] | null | undefined): { current: string | null; offered: string[] } | null {
  const modelOption = (configOptions ?? []).find((option) => option.type === "select" && (option.category === "model" || option.id === "model"));
  if (!modelOption || modelOption.type !== "select") return null;
  const offered: string[] = [];
  for (const entry of modelOption.options) {
    if ("options" in entry) {
      for (const item of entry.options) offered.push(item.value);
    } else {
      offered.push(entry.value);
    }
  }
  return { current: modelOption.currentValue, offered };
}

/**
 * Refuses to use an opencode rooms-workspace session if the configured model is missing,
 * rather than letting opencode silently fall back to another provider's model.
 */
export function assertOpencodeModelAvailable(
  expectedModel: string | null | undefined,
  session: {
    configOptions?: acp.SessionConfigOption[] | null;
    models?: { currentModelId?: string; availableModels?: { modelId: string }[] } | null;
  },
) {
  const expected = expectedModel?.trim();
  if (!expected) return;
  const fromConfig = modelValuesFromConfigOptions(session.configOptions);
  const fromModels = session.models
    ? {
        current: session.models.currentModelId ?? null,
        offered: (session.models.availableModels ?? []).map(({ modelId }) => modelId),
      }
    : null;
  const offered = new Set([...(fromConfig?.offered ?? []), ...(fromModels?.offered ?? [])]);
  const current = fromConfig?.current ?? fromModels?.current ?? null;
  if (offered.has(expected) || current === expected) return;
  throw new Error(
    `Configured opencode model "${expected}" is not available in the isolated room workspace session (got ${current ?? "none"}); refusing to fall back to another provider.`,
  );
}
