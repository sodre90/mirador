import { Database } from "bun:sqlite";

/**
 * Run with bun: prints, as JSON, every update the host stored for Claude Code's Agent tool calls, with what tells a
 * subagent launched in the background (its input, and the tool's response) and a start of what the call answered.
 */
type AcpEvent = { type: string; update?: { sessionUpdate?: string; toolCallId?: string; status?: string; rawInput?: unknown; rawOutput?: unknown; content?: unknown; _meta?: { claudeCode?: { toolName?: string; toolResponse?: unknown; subagentTaskStatus?: unknown } } } };

const [databasePath] = process.argv.slice(2);
const db = new Database(databasePath!, { readonly: true });
const stored = (db.query("SELECT at, event FROM events WHERE json_extract(event, '$.type') = 'acp' ORDER BY at, seq").all() as { at: number; event: string }[]).map(({ at, event }) => ({
  at,
  update: (JSON.parse(event) as AcpEvent).update ?? {},
}));
const agentCalls = new Set(stored.filter(({ update }) => update._meta?.claudeCode?.toolName === "Agent").map(({ update }) => update.toolCallId));
const startOf = (value: unknown) => (value === undefined ? undefined : JSON.stringify(value).slice(0, 400));
const updates = stored
  .filter(({ update }) => agentCalls.has(update.toolCallId))
  .map(({ at, update }) => ({
    at: new Date(at).toISOString(),
    sessionUpdate: update.sessionUpdate,
    status: update.status,
    rawInput: update.rawInput,
    toolResponse: startOf(update._meta?.claudeCode?.toolResponse),
    taskStatus: update._meta?.claudeCode?.subagentTaskStatus,
    rawOutput: startOf(update.rawOutput),
    content: startOf(update.content),
  }));
console.log(JSON.stringify(updates, null, 2));
