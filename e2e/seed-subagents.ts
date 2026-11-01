import { Database } from "bun:sqlite";

/**
 * Run with bun while the test host is stopped: appends to a conversation a turn, still open, in which Claude Code
 * started two subagents, one of them in the background, as claude-agent-acp reports them.
 */
const [databasePath, conversationId] = process.argv.slice(2);
const db = new Database(databasePath!);
const { seq: lastSeq } = db.query("SELECT max(seq) AS seq FROM events WHERE conversation_id = ?").get(conversationId!) as { seq: number };
const start = Date.now() - 120_000;

const update = (update: Record<string, unknown>) => ({ type: "acp", update });
const agentCall = { claudeCode: { toolName: "Agent" } };
const madeBy = (parentToolUseId: string, toolName?: string) => ({ claudeCode: { parentToolUseId, ...(toolName && { toolName }) } });

/** Long enough that the subagent's card is taller than the conversation's view. */
const buildPlan = Array.from({ length: 60 }, (_, index) => `Build step ${index + 1} looks fine.`).join("\n\n");

const turn: [seconds: number, event: Record<string, unknown>][] = [
  [0, { type: "user-message", text: "Split the work" }],
  [
    1,
    update({
      sessionUpdate: "tool_call",
      toolCallId: "toolu_explore",
      title: "Task",
      kind: "think",
      status: "pending",
      rawInput: { description: "Explore the cache", prompt: "Find where the cache lives.", subagent_type: "Explore", model: "haiku" },
      _meta: agentCall,
    }),
  ],
  [2, update({ sessionUpdate: "tool_call", toolCallId: "toolu_read", title: "Read host/cache.ts", kind: "read", status: "pending", _meta: madeBy("toolu_explore", "Read") })],
  [3, update({ sessionUpdate: "tool_call_update", toolCallId: "toolu_read", status: "completed", _meta: madeBy("toolu_explore", "Read") })],
  [4, update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "The cache lives in host/cache.ts." }, _meta: madeBy("toolu_explore") })],
  [5, update({ sessionUpdate: "tool_call", toolCallId: "toolu_grep", title: "grep evict", kind: "search", status: "completed", _meta: madeBy("toolu_explore", "Grep") })],
  [
    40,
    update({
      sessionUpdate: "tool_call_update",
      toolCallId: "toolu_explore",
      status: "completed",
      content: [{ type: "content", content: { type: "text", text: "Report: the cache is in host/cache.ts." } }],
      _meta: agentCall,
    }),
  ],
  [
    50,
    update({
      sessionUpdate: "tool_call",
      toolCallId: "toolu_watch",
      title: "Task",
      kind: "think",
      status: "pending",
      rawInput: { description: "Watch the build", prompt: "Run the build and report.", model: "sonnet" },
      _meta: agentCall,
    }),
  ],
  [
    51,
    update({
      sessionUpdate: "tool_call_update",
      toolCallId: "toolu_watch",
      _meta: { claudeCode: { toolName: "Agent", toolResponse: { isAsync: true, status: "async_launched", agentId: "a1b2c3" } } },
    }),
  ],
  [51, update({ sessionUpdate: "tool_call_update", toolCallId: "toolu_watch", status: "completed", _meta: agentCall })],
  [55, update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: buildPlan }, _meta: madeBy("toolu_watch") })],
  [57, update({ sessionUpdate: "tool_call", toolCallId: "toolu_lockfile", title: "Read bun.lock", kind: "read", status: "completed", _meta: madeBy("toolu_watch", "Read") })],
  [58, update({ sessionUpdate: "tool_call", toolCallId: "srvtoolu_advice", title: "advisor", kind: "other", status: "pending", _meta: madeBy("toolu_watch", "advisor") })],
  [60, update({ sessionUpdate: "tool_call", toolCallId: "toolu_build", title: "bun run build", kind: "execute", status: "pending", _meta: madeBy("toolu_watch", "Bash") })],
  [61, update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Both subagents are on it." } })],
  [62, update({ sessionUpdate: "tool_call", toolCallId: "toolu_lint", title: "bun run lint", kind: "execute", status: "pending", rawInput: { command: "bun run lint" }, _meta: { claudeCode: { toolName: "Bash" } } })],
];

const insert = db.query("INSERT INTO events (conversation_id, seq, at, event) VALUES (?, ?, ?, ?)");
turn.forEach(([seconds, event], index) => insert.run(conversationId!, lastSeq + 1 + index, start + seconds * 1000, JSON.stringify(event)));
