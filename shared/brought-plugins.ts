/** Wire types and bounds for proxying a room host's enabled canvas and app plugins to brought agents. */

export interface BroughtPluginTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface BroughtRoomPluginCatalog {
  tools: BroughtPluginTool[];
  instructions: string[];
}

export interface BroughtPluginCallResult {
  done: boolean;
  text: string;
}

export const MOST_BROUGHT_PLUGIN_TOOLS = 64;
export const MOST_BROUGHT_PLUGIN_CALLS_A_MINUTE = 60;
export const MOST_BROUGHT_PLUGIN_CALLS_AT_ONCE = 3;
export const BROUGHT_PLUGIN_RESULT_MOST_CHARACTERS = 60_000;
const MOST_TOOL_NAME_CHARACTERS = 100;
const MOST_DESCRIPTION_CHARACTERS = 8_000;
const MOST_SCHEMA_CHARACTERS = 32_000;
const MOST_INSTRUCTIONS_CHARACTERS = 16_000;
const MOST_ARGS_CHARACTERS = 100_000;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Validates a room's proxied plugin tool catalog sent from a room host to a bringer's Mirador. */
export function broughtPluginCatalogIn(value: unknown): BroughtRoomPluginCatalog | null {
  if (!isRecord(value) || !Array.isArray(value.tools) || !Array.isArray(value.instructions)) return null;
  if (value.tools.length > MOST_BROUGHT_PLUGIN_TOOLS) return null;
  const tools: BroughtPluginTool[] = [];
  for (const raw of value.tools) {
    if (!isRecord(raw) || typeof raw.name !== "string" || typeof raw.description !== "string" || !isRecord(raw.inputSchema)) return null;
    if (!raw.name || raw.name.length > MOST_TOOL_NAME_CHARACTERS || raw.description.length > MOST_DESCRIPTION_CHARACTERS) return null;
    try {
      if (JSON.stringify(raw.inputSchema).length > MOST_SCHEMA_CHARACTERS) return null;
    } catch {
      return null;
    }
    tools.push({ name: raw.name, description: raw.description, inputSchema: raw.inputSchema });
  }
  const instructions: string[] = [];
  let instructionChars = 0;
  for (const line of value.instructions) {
    if (typeof line !== "string") return null;
    instructionChars += line.length;
    if (instructionChars > MOST_INSTRUCTIONS_CHARACTERS) return null;
    instructions.push(line);
  }
  return { tools, instructions };
}

/** Validates a proxied plugin tool call sent from a bringer's Mirador to the room host. */
export function broughtPluginCallIn(tool: unknown, args: unknown): { tool: string; args: Record<string, unknown> } | null {
  if (typeof tool !== "string" || !tool || tool.length > MOST_TOOL_NAME_CHARACTERS || !isRecord(args)) return null;
  try {
    if (JSON.stringify(args).length > MOST_ARGS_CHARACTERS) return null;
  } catch {
    return null;
  }
  return { tool, args };
}

/** Validates a proxied plugin call result sent from the room host back to the bringer's Mirador. */
export function broughtPluginResultIn(value: unknown): BroughtPluginCallResult | null {
  if (!isRecord(value) || typeof value.done !== "boolean" || typeof value.text !== "string") return null;
  return { done: value.done, text: value.text.slice(0, BROUGHT_PLUGIN_RESULT_MOST_CHARACTERS) };
}
